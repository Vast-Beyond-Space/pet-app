/* ============================================================
 * ai-fallback.js —— 统一的模型调用编排：重试 + 备选模型 + 跨提供商兜底
 * ------------------------------------------------------------
 * 设计要点：
 *   1. 只做「编排」，不做业务。真正发请求的 transport 由调用方注入，
 *      因此主进程（Node fetch / https.request）与各渲染窗口可以共用同一套
 *      重试与回退规则，行为完全一致。
 *   2. 候选链（chain）顺序固定为：
 *        当前提供商的当前用途模型
 *        → 当前提供商的「备选模型」（设置面板可增删排序）
 *        → 其它已配置提供商的模型（跨提供商兜底，可开关）
 *      同一 (提供商, 地址, 模型) 只保留一次，链长有上限。
 *   3. 失败分类：
 *        retryable（繁忙/限流/超时/5xx）→ 同一候选按策略重试，次数用尽后换下一个候选
 *        fatal（401/403，Key 无效）      → 跳过该提供商的剩余候选，直接换别的提供商
 *        其它 4xx（400/404，模型名或参数问题）→ 不重试，直接换下一个候选
 *   4. 流式调用若已经吐出内容再失败，则不再重试/回退（避免界面出现重复内容），
 *      直接以 partial 结果返回，由调用方决定如何提示。
 *
 * 同时支持两种加载方式：
 *   - 渲染进程：<script src="ai-fallback.js"> → window.AIFallback
 *   - 主进程：  require('./ai-fallback.js')
 * ============================================================ */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.AIFallback = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // ===== 提供商元信息（前缀同时决定 config 字段名与默认地址/模型）=====
    const PROVIDERS = {
        deepseek: {
            prefix: 'deepseek', label: 'DeepSeek',
            defaultModel: 'deepseek-flash',
            defaultUrl: 'https://api.deepseek.com/v1/chat/completions',
            // 思考模式 + tools：官方要求后续所有请求完整回传 reasoning_content，否则 400
            echoReasoningWithTools: true
        },
        zhipu: {
            prefix: 'zhipu', label: '智谱 AI',
            defaultModel: 'glm-4.6v-flash',
            defaultUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
            // 交错思考 + 工具同样要求保留并回传 reasoning content
            echoReasoningWithTools: true
        },
        local: {
            prefix: 'local', label: '本地 LLM',
            defaultModel: '',
            defaultUrl: 'http://localhost:11434/v1/chat/completions',
            // 本地推理框架对未知字段容忍度不一，默认不回传
            echoReasoningWithTools: false
        },
        // 其它厂商 / 中转站：OpenAI 兼容协议，地址与 Key 全部由用户填写
        custom: {
            prefix: 'custom', label: '自定义 / 中转站',
            defaultModel: '',
            defaultUrl: '',
            // 中转站多为严格校验，未知字段可能被拒，默认不回传
            echoReasoningWithTools: false
        }
    };
    const PROVIDER_ORDER = ['deepseek', 'zhipu', 'custom', 'local'];
    const MODES = ['chat', 'companion', 'memory', 'vision'];
    const MAX_CHAIN = 12; // 候选链上限，避免配置异常时无限尝试

    function meta(provider) {
        return PROVIDERS[provider] || PROVIDERS.deepseek;
    }

    // 本提供商在「请求带 tools」时是否必须回传 reasoning_content
    function shouldEchoReasoning(provider, hasTools) {
        if (!hasTools) return false;
        return !!meta(provider).echoReasoningWithTools;
    }

    // config 中存放「某提供商某用途」模型名的字段：<prefix>Model / <prefix>VisionModel ...
    function fieldKey(provider, mode) {
        const p = meta(provider).prefix;
        if (!mode || mode === 'chat') return p + 'Model';
        return p + mode.charAt(0).toUpperCase() + mode.slice(1) + 'Model';
    }

    // 用途模型 → 该提供商的聊天模型 → 提供商默认模型
    function resolveModel(config, provider, mode) {
        const c = config || {};
        const primary = String(c[fieldKey(provider, 'chat')] || '').trim();
        const slot = (mode && mode !== 'chat') ? String(c[fieldKey(provider, mode)] || '').trim() : '';
        return slot || primary || meta(provider).defaultModel;
    }

    // 归一化：无论填的是完整端点还是 base 地址，都补成 .../chat/completions
    function toChatUrl(raw, fallback) {
        const s = String(raw || '').trim() || String(fallback || '').trim();
        if (!s) return '';
        try {
            const u = new URL(s);
            if (/\/chat\/completions\/?$/.test(u.pathname)) return u.href;
            return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}/chat/completions`;
        } catch (e) {
            return s;
        }
    }

    // 提供商的请求地址 / Key 字段名（历史原因：DeepSeek 用无前缀的 apiUrl / apiKey）
    function urlField(provider) { return provider === 'deepseek' ? 'apiUrl' : meta(provider).prefix + 'ApiUrl'; }
    function keyField(provider) { return provider === 'deepseek' ? 'apiKey' : meta(provider).prefix + 'ApiKey'; }

    // 提供商的请求地址 / Key（自定义与本地允许无 Key）
    function credentials(config, provider) {
        const c = config || {};
        const m = meta(provider);
        return {
            apiUrl: toChatUrl(c[urlField(provider)], m.defaultUrl),
            apiKey: String(c[keyField(provider)] || '').trim()
        };
    }

    // 该提供商是否被用户真正配置过（未配置的绝不进入候选链，
    // 避免"本地 LLM 用默认 localhost 地址占位"之类的情况污染回退顺序）
    function isConfigured(config, provider) {
        const c = config || {};
        if (provider === 'local') return !!String(c.localApiUrl || '').trim();
        if (provider === 'zhipu') return !!String(c.zhipuApiKey || '').trim();
        if (provider === 'custom') return !!(String(c.customApiUrl || '').trim() && String(c.customApiKey || '').trim());
        return !!String(c.apiKey || '').trim(); // deepseek
    }

    // 用户配置的备选模型（按顺序），兼容字符串（逗号/换行分隔）与数组
    function fallbackModels(config, provider) {
        const c = config || {};
        const raw = c[meta(provider).prefix + 'FallbackModels'];
        const out = [];
        const push = (v) => { const s = String(v == null ? '' : v).trim(); if (s && out.indexOf(s) === -1) out.push(s); };
        if (Array.isArray(raw)) raw.forEach(push);
        else if (typeof raw === 'string') raw.split(/[\n,，;；]+/).forEach(push);
        return out;
    }

    // 重试策略
    function retryPolicy(config) {
        const c = config || {};
        const maxRetries = clampInt(c.aiMaxRetries, 0, 5, 2);
        const delayMs = clampInt(c.aiRetryDelayMs, 100, 10000, 800);
        return {
            maxRetries,
            delayMs,
            backoff: c.aiRetryBackoff !== false, // 默认指数退避
            maxDelayMs: 8000
        };
    }

    function clampInt(v, min, max, dflt) {
        const n = Number(v);
        if (!isFinite(n)) return dflt;
        return Math.min(max, Math.max(min, Math.round(n)));
    }

    // 单次尝试的间隔（第 t 次重试等待时间，t 从 1 开始）
    function retryDelay(policy, t) {
        const base = policy.delayMs;
        const ms = policy.backoff ? base * Math.pow(2, Math.max(0, t - 1)) : base;
        return Math.min(policy.maxDelayMs, ms);
    }

    // 构造候选链
    function buildChain(config, mode) {
        const c = config || {};
        const active = PROVIDERS[c.multimodalProvider] ? c.multimodalProvider : 'deepseek';
        const chain = [];
        const seen = {};
        const add = (provider, model, tag) => {
            if (chain.length >= MAX_CHAIN) return;
            if (!isConfigured(c, provider)) return;
            const cred = credentials(c, provider);
            if (!cred.apiUrl) return;
            const key = `${provider}|${cred.apiUrl}|${model || ''}`;
            if (seen[key]) return;
            seen[key] = true;
            chain.push({ provider, model: model || '', apiUrl: cred.apiUrl, apiKey: cred.apiKey, tag });
        };

        // 1) 当前提供商：主模型 + 备选模型
        add(active, resolveModel(c, active, mode), 'primary');
        fallbackModels(c, active).forEach((m, i) => add(active, m, 'fallback#' + (i + 1)));

        // 2) 跨提供商兜底（可关闭）：其它已配置提供商的用途模型 + 其备选模型
        if (c.crossProviderFallback !== false) {
            PROVIDER_ORDER.filter(p => p !== active).forEach(p => {
                if (!isConfigured(c, p)) return;
                add(p, resolveModel(c, p, mode), 'cross:' + meta(p).label);
                fallbackModels(c, p).forEach((m, i) => add(p, m, 'cross:' + meta(p).label + '#' + (i + 1)));
            });
        }
        return chain;
    }

    // 失败分类
    function classifyFailure(status, message) {
        const msg = String(message == null ? '' : message);
        const code = Number(status) || 0;
        if (code === 429 || code === 408 || code === 409 || code === 529 || (code >= 500 && code <= 599)) {
            return { retryable: true, fatal: false };
        }
        if (/rate.?limit|too many requests|overloaded|capacity|busy|繁忙|限流|过载|超时|timeout|timed out|aborted|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|socket hang up|fetch failed|network|net::ERR|under maintenance|维护/i.test(msg)) {
            return { retryable: true, fatal: false };
        }
        // Key / 鉴权问题：同一提供商换模型也没用，跳过该提供商
        if (code === 401 || code === 403 || /invalid.?api.?key|unauthor|authentication|api key|密钥|鉴权|无权限/i.test(msg)) {
            return { retryable: false, fatal: true };
        }
        // 模型名/参数/接口路径问题：换备选模型可能成功
        return { retryable: false, fatal: false };
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, Math.max(0, ms || 0)));
    }

    /**
     * 按候选链执行调用。
     * @param {object}   opts
     * @param {Array}    opts.chain        buildChain() 的结果
     * @param {object}   opts.policy       retryPolicy() 的结果
     * @param {Function} opts.attempt      async (candidate, attemptIndex) => {ok, data, content, status, message, retryable, fatal, partial}
     * @param {Function} [opts.onAttempt]  (info) => void，用于界面提示「重试中 / 切换备选」
     * @param {Function} [opts.log]        (level, message) => void
     * @param {Function} [opts.sleepImpl]  便于测试注入
     * @returns {Promise<object>} {ok, content, data, candidate, usedFallback, attempts, error}
     */
    async function runChain(opts) {
        const chain = (opts && opts.chain) || [];
        const policy = (opts && opts.policy) || { maxRetries: 0, delayMs: 0, backoff: false, maxDelayMs: 8000 };
        const attempt = opts && opts.attempt;
        const onAttempt = (opts && opts.onAttempt) || function () {};
        const log = (opts && opts.log) || function () {};
        const sleepImpl = (opts && opts.sleepImpl) || sleep;
        const attempts = [];
        if (typeof attempt !== 'function') throw new Error('runChain 需要 attempt 函数');
        if (!chain.length) {
            return { ok: false, content: '', data: null, candidate: null, usedFallback: false, attempts, error: '没有可用的模型候选（请检查 API 地址 / Key）' };
        }

        const maxTries = 1 + Math.max(0, policy.maxRetries);
        let lastError = '';

        for (let i = 0; i < chain.length; i++) {
            const candidate = chain[i];
            const usedFallback = i > 0;
            const info = { provider: candidate.provider, model: candidate.model, apiUrl: candidate.apiUrl, tag: candidate.tag };
            for (let t = 0; t < maxTries; t++) {
                if (t > 0) {
                    const wait = retryDelay(policy, t);
                    log('info', `[ai-fallback] ${candidate.provider}/${candidate.model || '(默认)'} 繁忙，${wait}ms 后第 ${t + 1} 次尝试`);
                    onAttempt({ phase: 'retry', attempt: t + 1, maxTries, waitMs: wait, candidate: info, usedFallback });
                    await sleepImpl(wait);
                } else {
                    onAttempt({ phase: 'try', attempt: 1, maxTries, candidate: info, usedFallback });
                }

                let result;
                try {
                    result = await attempt(candidate, t);
                } catch (e) {
                    result = { ok: false, message: (e && e.message) || String(e), error: e };
                }
                if (!result) result = { ok: false, message: '未知错误' };

                const cls = result.retryable || result.fatal
                    ? { retryable: !!result.retryable, fatal: !!result.fatal }
                    : classifyFailure(result.status, result.message);
                const record = {
                    provider: candidate.provider, model: candidate.model, tag: candidate.tag,
                    attempt: t + 1, ok: !!result.ok, status: result.status || 0,
                    message: result.message || '', retryable: cls.retryable, fatal: cls.fatal, partial: !!result.partial
                };
                attempts.push(record);

                if (result.ok) {
                    if (usedFallback) log('warn', `[ai-fallback] 已切换到备选：${candidate.provider}/${candidate.model || '(默认)'}（${candidate.tag}）`);
                    return {
                        ok: true, content: result.content != null ? result.content : '', data: result.data || null,
                        candidate: info, usedFallback, attempts, error: ''
                    };
                }

                lastError = result.message || '调用失败';

                if (result.partial) {
                    // 流式已吐出内容：不再重试/回退，避免界面重复
                    log('warn', '[ai-fallback] 流式响应中断且已有输出，停止重试');
                    return { ok: false, partial: true, content: result.content || '', data: null, candidate: info, usedFallback, attempts, error: lastError };
                }
                if (cls.fatal) {
                    log('warn', `[ai-fallback] ${candidate.provider} 鉴权/Key 错误，跳过该提供商剩余候选：${lastError}`);
                    // 跳过同一提供商的后续候选（同一个 Key，再试无意义）
                    for (let k = i + 1; k < chain.length; k++) {
                        if (chain[k].provider === candidate.provider) attempts.push({ provider: chain[k].provider, model: chain[k].model, skipped: true, message: '同提供商鉴权失败，已跳过' });
                        else break;
                    }
                    while (i + 1 < chain.length && chain[i + 1].provider === candidate.provider) i++;
                    break;
                }
                if (!cls.retryable) {
                    log('warn', `[ai-fallback] ${candidate.provider}/${candidate.model || '(默认)'} 失败（不可重试）：${lastError}`);
                    break; // 换下一个候选
                }
                // 可重试：继续 inner loop，直到次数用尽
            }
        }

        return {
            ok: false, content: '', data: null, candidate: null, usedFallback: chain.length > 1,
            attempts, error: lastError || '全部模型候选均调用失败'
        };
    }

    /**
     * OpenAI 兼容 transport：候选 → 一次 HTTP 请求（可选流式）。
     * 主进程与渲染进程都可直接使用；智谱等有特殊网络要求的可在主进程替换成自定义 attempt。
     * @returns {Promise<object>} {ok, data, content, status, message, retryable, fatal, partial}
     */
    async function attemptOpenAi(candidate, body, options) {
        const opt = options || {};
        const onDelta = opt.onDelta;
        const headers = { 'Content-Type': 'application/json' };
        if (candidate.apiKey) headers['Authorization'] = `Bearer ${candidate.apiKey}`;
        const payload = Object.assign({}, body);
        if (candidate.model) payload.model = candidate.model;
        payload.stream = !!onDelta;

        let resp;
        const ctrl = opt.controller || new AbortController();
        const timeoutMs = Number(opt.timeoutMs) > 0 ? Number(opt.timeoutMs) : 60000;
        const timer = setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, timeoutMs);
        let emitted = 0;
        let received = 0;
        try {
            resp = await fetch(candidate.apiUrl, {
                method: 'POST', headers, body: JSON.stringify(payload), signal: ctrl.signal
            });
            if (!resp.ok) {
                const text = await resp.text().catch(() => '');
                let msg = text ? text.slice(0, 300) : '';
                try { const j = JSON.parse(text); msg = (j && j.error && (j.error.message || j.error.code)) || (j && j.message) || msg; } catch (e) {}
                const cls = classifyFailure(resp.status, msg);
                return { ok: false, status: resp.status, message: `HTTP ${resp.status}: ${msg || '请求失败'}`, retryable: cls.retryable, fatal: cls.fatal };
            }
            if (!onDelta) {
                const data = await resp.json().catch(() => null);
                const content = data && data.choices && data.choices[0] && data.choices[0].message
                    ? extractText(data.choices[0].message.content) : '';
                if (!data || !data.choices || !data.choices[0]) {
                    return { ok: false, status: resp.status, message: '响应异常（缺少 choices）', retryable: true, fatal: false };
                }
                return { ok: true, data, content, status: resp.status, message: '' };
            }
            // ===== 流式 =====
            const reader = resp.body && resp.body.getReader ? resp.body.getReader() : null;
            if (!reader) {
                const data = await resp.json().catch(() => null);
                const content = data && data.choices && data.choices[0] && data.choices[0].message ? extractText(data.choices[0].message.content) : '';
                if (content && onDelta) onDelta(content);
                return content ? { ok: true, data, content, status: resp.status, message: '' } : { ok: false, status: resp.status, message: '响应异常（无流式数据）', retryable: true, fatal: false };
            }
            const decoder = new TextDecoder('utf-8');
            let buffer = '';
            let full = '';
            for (;;) {
                const chunk = await reader.read();
                if (chunk.done) break;
                received++;
                buffer += decoder.decode(chunk.value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();
                for (const rawLine of lines) {
                    const line = rawLine.trim();
                    if (!line || !line.startsWith('data:')) continue;
                    const dataStr = line.slice(5).trim();
                    if (dataStr === '[DONE]') continue;
                    let json = null;
                    try { json = JSON.parse(dataStr); } catch (e) { continue; }
                    const delta = json && json.choices && json.choices[0]
                        ? (json.choices[0].delta || json.choices[0].message || null) : null;
                    const piece = delta ? extractText(delta.content) : '';
                    if (piece) { full += piece; emitted++; onDelta(piece); }
                }
            }
            if (!full) {
                return { ok: false, status: resp.status, message: '流式响应为空', retryable: true, fatal: false, partial: emitted > 0 };
            }
            return { ok: true, content: full, data: null, status: resp.status, message: '' };
        } catch (e) {
            const aborted = e && (e.name === 'AbortError');
            const partial = emitted > 0;
            const msg = aborted ? (opt.timeoutMs ? `请求超时（${Math.round(timeoutMs / 1000)}秒）` : '请求被中止') : ((e && e.message) || String(e));
            const cls = classifyFailure(0, msg);
            return { ok: false, status: 0, message: msg, retryable: cls.retryable && !partial, fatal: false, partial, content: '' };
        } finally {
            clearTimeout(timer);
        }
    }

    // 兼容纯文本 与 多模态数组 两种 content 形式
    function extractText(content) {
        if (content == null) return '';
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
            return content.map(part => {
                if (typeof part === 'string') return part;
                if (part && typeof part.text === 'string') return part.text;
                return '';
            }).join('');
        }
        return String(content);
    }

    return {
        PROVIDERS, PROVIDER_ORDER, MODES, MAX_CHAIN,
        meta, fieldKey, resolveModel, toChatUrl, urlField, keyField, credentials, isConfigured,
        shouldEchoReasoning,
        fallbackModels, retryPolicy, retryDelay, buildChain, classifyFailure,
        runChain, attemptOpenAi, extractText
    };
});
