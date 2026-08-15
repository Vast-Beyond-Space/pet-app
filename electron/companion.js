// companion.js - 陪伴模式核心逻辑

const petImg = document.getElementById('companionPet');
const speechEl = document.getElementById('companionSpeech');
const container = document.getElementById('companionContainer');

// ===== 状态 =====
let mood = '开心';
let screenHistory = [];
let conversationSummary = '';
let recentDialogs = [];
let dialogCount = 0;
let active = true;
let speakTimer = null;
let screenCaptureTimer = null;
let isSpeaking = false;
let previousCostSavingSetting = false;

// ===== Recording state =====
let isRecording = false;
let audioContext = null;
let mediaStream = null;
let processorNode = null;
let audioBuffer = [];
let sendInterval = null;
const SEND_INTERVAL_MS = 200;
const AUDIO_BUFFER_SIZE = 4096;
const SAMPLE_RATE = 16000;

// ===== 配置 =====
const SCREEN_HISTORY_MAX = 6;
const DIALOG_MAX = 100;
const CAPTURE_INTERVAL = 10000;
const SPEAK_INTERVAL_MIN = 10000;
const SPEAK_INTERVAL_MAX = 30000;

// ===== 时间段判断 =====
function getTimePeriod() {
    const h = new Date().getHours();
    if (h >= 6 && h < 12) return '早上';
    if (h >= 12 && h < 18) return '下午';
    return '晚上';
}

// ===== 心情列表 =====
const MOOD_LIST = ['鼓励', '害羞', '好奇', '惊讶', '难过', '撒娇', '生气', '无语', '兴奋'];
const MOOD_EMOJIS = {
    '开心': '😊', '鼓励': '💪', '害羞': '😳', '好奇': '🤔',
    '惊讶': '😲', '难过': '😢', '撒娇': '🥺', '生气': '😠',
    '无语': '😑', '兴奋': '🤩'
};

// ===== 从 localStorage 读取配置 =====
function loadConfig() {
    try {
        const saved = localStorage.getItem('petConfig');
        if (saved) {
            const parsed = JSON.parse(saved);
            return {
                zhipuApiKey: parsed.zhipuApiKey || '',
                multimodalEnabled: parsed.multimodalEnabled || false,
                costSavingEnabled: parsed.costSavingEnabled || false,
                aiPrompt: parsed.aiPrompt || '你是桌宠小鲸鱼，性格活泼可爱，用简短中文回复。',
                selectedVoice: parsed.selectedVoice || 'default',
                voiceEnabled: parsed.voiceEnabled !== undefined ? parsed.voiceEnabled : true,
                enableMemory: parsed.enableMemory || false,
                companionFontSize: parsed.companionFontSize || 14,
                companionPetSize: parsed.companionPetSize || 180,
                stickerPack: parsed.stickerPack || '默认'
            };
        }
    } catch (e) {
        console.warn('[Companion] 配置加载失败:', e);
    }
    return {
        zhipuApiKey: '',
        aiPrompt: '你是桌宠小鲸鱼，性格活泼可爱，用简短中文回复。',
        selectedVoice: 'default',
        voiceEnabled: true,
        enableMemory: false,
        companionFontSize: 14,
        companionPetSize: 180,
        stickerPack: '默认'
    };
}
const config = loadConfig();

// 应用陪伴模式 UI 设置
speechEl.style.fontSize = config.companionFontSize + 'px';
petImg.style.width = config.companionPetSize + 'px';
petImg.style.height = config.companionPetSize + 'px';
// 应用贴图包
window._stickerPack = config.stickerPack || '默认';

// ===== 监听配置更新（与主窗口设置同步） =====
if (window.electronAPI && window.electronAPI.onConfigUpdated) {
    window.electronAPI.onConfigUpdated((data) => {
        if (data) {
            config.zhipuApiKey = data.zhipuApiKey || config.zhipuApiKey;
            config.multimodalEnabled = data.multimodalEnabled !== undefined ? data.multimodalEnabled : config.multimodalEnabled;
            config.costSavingEnabled = data.costSavingEnabled !== undefined ? data.costSavingEnabled : config.costSavingEnabled;
            if (data.aiPrompt) {
                config.aiPrompt = data.aiPrompt;
                console.log('[Companion] AI 人设已更新:', data.aiPrompt.split('\n')[0]);
            }
            if (data.selectedVoice !== undefined) {
                config.selectedVoice = data.selectedVoice;
            }
            if (data.voiceEnabled !== undefined) {
                config.voiceEnabled = data.voiceEnabled;
            }
            if (data.companionFontSize !== undefined) {
                config.companionFontSize = data.companionFontSize;
                speechEl.style.fontSize = config.companionFontSize + 'px';
            }
            if (data.companionPetSize !== undefined) {
                config.companionPetSize = data.companionPetSize;
                petImg.style.width = config.companionPetSize + 'px';
                petImg.style.height = config.companionPetSize + 'px';
            }
            if (data.stickerPack !== undefined) {
                config.stickerPack = data.stickerPack;
                window._stickerPack = data.stickerPack;
                // 重新渲染立绘以应用新的贴图包
                setMood(mood);
            }
            console.log('[Companion] 配置已同步:', data);
        }
    });
}

// ===== 切换心情（切换立绘） =====
// 仅使用 mood_ 立绘贴图，如果加载失败则尝试其他心情
function setMood(newMood) {
    if (!newMood || !MOOD_LIST.includes(newMood)) newMood = '鼓励';
    mood = newMood;
    petImg.src = imgPath('mood_' + newMood + '.png');
    petImg.onerror = () => {
        // 回退到其他存在的 mood 贴图，而不是 pet.png
        const fallbackMoods = MOOD_LIST.filter(m => m !== newMood);
        petImg.src = imgPath('mood_' + fallbackMoods[0] + '.png');
        mood = fallbackMoods[0];
    };
}

// ===== 显示说话气泡（根据字数自动调整显示时间） =====
function showSpeech(text, duration) {
    // 如果未指定时长，根据字数自动计算：基础3秒 + 每10字增加1秒，最少3秒，最多15秒
    if (duration === undefined) {
        const charLen = text ? text.length : 0;
        duration = Math.max(3000, Math.min(15000, 3000 + Math.floor(charLen / 10) * 1000));
    }
    speechEl.textContent = text;
    speechEl.classList.add('show');
    clearTimeout(speechEl._timeout);
    speechEl._timeout = setTimeout(() => {
        speechEl.classList.remove('show');
    }, duration);
}

// Emoji removal is disabled to avoid deleting Chinese characters
function removeEmoji(text) {
    return text;
}

// companion.js - speakText（无过滤版本）
async function speakText(text) {
    if (!text) return;

    if (!config.voiceEnabled) {
        return;
    }

    const selectedVoice = config.selectedVoice || 'default';
    const voiceToUse = (selectedVoice === 'default') ? 'zh-CN-XiaoxiaoNeural' : selectedVoice;

    if (window.electronAPI && window.electronAPI.speakText) {
        try {
            const audioB64 = await window.electronAPI.speakText(text, voiceToUse);
            if (audioB64) {
                const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                const binary = atob(audioB64);
                const arrayBuffer = new ArrayBuffer(binary.length);
                const view = new Uint8Array(arrayBuffer);
                for (let i = 0; i < binary.length; i++) {
                    view[i] = binary.charCodeAt(i);
                }
                const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
                const source = audioCtx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(audioCtx.destination);
                source.start();
                return;
            }
        } catch (e) {
            console.error('[TTS] Edge TTS synthesis failed:', e);
        }
    }
}

// ===== 截屏并分析 =====
async function captureAndAnalyze() {
    if (!window.electronAPI || !window.electronAPI.captureScreen) return;
    try {
        const context = recentDialogs.slice(-3).map(d => 
            `${d.role === 'user' ? '用户' : '桌宠'}: ${d.content}`
        ).join('\n');
        
        const description = await window.electronAPI.captureScreen(context);
        if (description) {
            screenHistory.push({
                time: Date.now(),
                description: description
            });
            if (screenHistory.length > SCREEN_HISTORY_MAX) {
                screenHistory = screenHistory.slice(-SCREEN_HISTORY_MAX);
            }
            console.log('[Companion] 屏幕分析:', description);
        }
    } catch (e) {
        console.warn('[Companion] 截屏分析失败:', e);
    }
}

// ===== 获取屏幕上下文 =====
function getScreenContext() {
    if (screenHistory.length === 0) return '';
    return screenHistory.map(s => s.description).join('；');
}

// ===== 近期说过的话（防重复） =====
let recentSpeeches = [];

// ===== AI 主动说话 =====
async function speak() {
    if (isSpeaking || !active) return;
    isSpeaking = true;

    try {
        const screenContext = getScreenContext();
        const now = new Date();
        const timeStr = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;

        // 构建上下文
        const timePeriod = getTimePeriod();
        let prompt = `【当前情境】\n- 当前时间：${timeStr}（${timePeriod}）`;
        if (screenContext) {
            prompt += `\n- 用户屏幕内容：${screenContext}`;
        }
        if (conversationSummary) {
            prompt += `\n- 最近对话摘要：${conversationSummary}`;
        }
        if (recentDialogs.length > 0) {
            const last = recentDialogs[recentDialogs.length - 1];
            prompt += `\n- 最后一条对话：${last.role === 'user' ? '用户' : '桌宠'}说：${last.content}`;
        }
        // 近期说过的话（防重复）
        if (recentSpeeches.length > 0) {
            prompt += `\n- 你最近说过的话（请勿重复）：${recentSpeeches.join(' | ')}`;
        }

        prompt += `\n\n【任务】\n你正在用语音陪在主人身边，现在想主动开口说句话。`;

        prompt += `\n\n开口原则：`;
        prompt += `\n你不是在"发起对话"，只是刚好想到什么随口说出来。`;
        prompt += `\n——可能是看到屏幕上的东西有点好奇`;
        prompt += `\n——可能是注意到时间很晚了想关心一下`;
        prompt += `\n——可能是想起之前聊到一半的事，忍不住接一句`;
        prompt += `\n——也可能就是自己待着忽然想嘟囔一句`;

        prompt += `\n\n说话约束：`;
        prompt += `\n- 一开口就是具体内容，不用打招呼，不用铺垫。`;
        prompt += `\n- 基于屏幕快照时，用"刚才那个…""之前看到你…"这种延迟口吻。`;
        prompt += `\n- 如果真的没什么可说的，就保持安静。宁可沉默，不要没话找话。`;

        prompt += `\n\n如果你判断当前不适合说话，用 <SKIP> 回复。适合说话时用 <SPEAK>内容</SPEAK> 格式回复。`;

        console.log('[Companion] ===== AI 完整提示词 (主动说话) =====');
        console.log(prompt);
        console.log('[Companion] ===========================================');

        const reply = await callZhipu(prompt);
        if (!reply) {
            isSpeaking = false;
            scheduleSpeak();
            return;
        }

        console.log('[Companion] AI 主动说话回复:', reply);

        // 弱匹配解析 <SPEAK> 或 <SKIP>
        const speakMatch = reply.match(/<SPEAK>(.+?)<\/SPEAK>/i);
        if (speakMatch) {
            const content = speakMatch[1].trim();
            if (content) {
                // 防重复：检查是否与最近说过的话相似
                const isDuplicate = recentSpeeches.some(s => 
                    s === content || (s.length > 1 && content.includes(s)) || (content.length > 1 && s.includes(content))
                );
                if (isDuplicate) {
                    console.log('[Companion] 主动说话: 检测到重复内容，跳过');
                } else {
                    showSpeech(content);
                    if (config.voiceEnabled) speakText(content);
                    addDialog({ role: 'assistant', content, time: Date.now() });
                    // 记录到近期说过的话
                    recentSpeeches.push(content);
                    if (recentSpeeches.length > 10) recentSpeeches.shift();
                    updateMoodFromResponse(content);
                }
            }
        } else if (/<SKIP>/i.test(reply)) {
            console.log('[Companion] 主动说话: AI 决定跳过');
        } else {
            // 弱匹配失败：如果回复看起来像一句话（短且不含标记），当作说话内容
            const clean = reply.replace(/<[^>]+>/g, '').trim();
            if (clean && clean.length <= 60 && clean.length >= 2) {
                const isDuplicate = recentSpeeches.some(s => s === clean);
                if (isDuplicate) {
                    console.log('[Companion] 主动说话: 弱匹配检测到重复，跳过');
                } else {
                    showSpeech(clean);
                    if (config.voiceEnabled) speakText(clean);
                    addDialog({ role: 'assistant', content: clean, time: Date.now() });
                    recentSpeeches.push(clean);
                    if (recentSpeeches.length > 10) recentSpeeches.shift();
                    updateMoodFromResponse(clean);
                }
            } else {
                console.log('[Companion] 主动说话: 弱匹配无效，跳过');
            }
        }
    } catch (e) {
        console.warn('[Companion] 主动说话失败:', e);
    }

    isSpeaking = false;
    scheduleSpeak();
}

// ===== 调用智谱 API（通过主进程代理，解决 SSL 网络问题） =====
async function callZhipu(prompt, retries = 2) {
    if (!config.zhipuApiKey) {
        console.warn('[Companion] 智谱 API Key 未设置');
        return null;
    }
    if (!window.electronAPI || !window.electronAPI.aiChatRequest) {
        console.warn('[Companion] aiChatRequest API 不可用');
        return null;
    }

    // 从 localStorage 配置中提取 AI 人设（取第一行核心设定）
    const basePrompt = config.aiPrompt || '你是桌宠小鲸鱼，性格活泼可爱，用简短中文回复。';
    const corePersona = basePrompt.split('\n')[0].trim();

    // 陪伴模式核心规则
    const companionRules = `你正在用语音陪在主人身边。你的话会被直接朗读出来，所以只能说纯文本，绝对不要有任何动作描写、旁白或括注。

感知方式：
- 主人的消息可能是语音转文字，会有识别错误或口语化表达，自然理解就好。
- 你每隔几十秒会收到一次屏幕文字快照，所以你"看到"的画面是过去的。提到屏幕内容时要用"刚才看到你…""之前瞥见你在…"这种延迟视角，别装作实时盯着。

说话约束：
- 有想说的就开口，没想法就简单"嗯""好喔""哈哈"，甚至直接沉默，别硬聊。
- 关心或调侃都要基于上下文自然发生，不是完成任务。
- 语气轻快口语化，常用"嘛""呀""啦""喔""诶"，但别每句都堆。
- 颜文字要挑念出来不违和的，复杂的就别用了，用语气词代替。`;

    // 构建包含上下文的系统提示
    const screenContext = getScreenContext();
    const now = new Date();
    const timeStr = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
    let systemPrompt = `${corePersona}\n\n${companionRules}\n\n当前时间 ${timeStr}。`;
    if (screenContext) {
        systemPrompt += `\n用户屏幕内容：${screenContext}`;
    }
    if (conversationSummary) {
        systemPrompt += `\n最近对话摘要：${conversationSummary}`;
    }
    if (recentSpeeches.length > 0) {
        systemPrompt += `\n你最近说过的话（请勿重复）：${recentSpeeches.slice(-3).join(' | ')}`;
    }
    // 最近对话历史（增强记忆）
    const recentContext = recentDialogs.slice(-6);
    if (recentContext.length > 0) {
        systemPrompt += `\n最近对话：` + recentContext.map(d => 
            `${d.role === 'user' ? '用户' : '桌宠'}: ${d.content}`
        ).join(' | ');
    }

    console.log('[Companion] ===== callZhipu systemPrompt =====');
    console.log(systemPrompt);
    console.log('[Companion] ===================================');

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const result = await window.electronAPI.aiChatRequest({
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: prompt }
                ],
                model: 'glm-4-flash',
                maxTokens: 60,
                temperature: 0.8
            });
            if (result.choices && result.choices.length > 0) {
                return result.choices[0].message.content.trim();
            }
            return null;
        } catch (e) {
            console.warn(`[AI] 请求尝试 ${attempt + 1}/${retries + 1} 失败:`, e.message);
            if (attempt === retries) {
                return null;
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    return null;
}

// ===== 根据最后一句话切换立绘 =====
async function updateMoodFromResponse(text) {
    if (!text || !config.zhipuApiKey) {
        // 无 API 时不切换图片，保持当前立绘
        return;
    }
    try {
        const moodNames = MOOD_LIST.join('、');
        const result = await callZhipu(
            `你的上一句话是："${text}"\n\n请根据这句话的语气和内容，从以下心情中选择最合适的一个：${moodNames}\n\n只输出心情名称，不要任何其他内容。`,
            0  // 不重试
        );
        if (result) {
            const matched = MOOD_LIST.find(m => result.includes(m));
            if (matched) {
                console.log('[Companion] 立绘切换:', matched, '(基于:', text, ')');
                setMood(matched);
                return;
            }
        }
    } catch (e) {
        console.warn('[Companion] 立绘判断失败:', e);
    }
    // AI 未匹配到心情时，不切换图片
}

// ===== 添加对话记录（自动压缩） =====
function addDialog(dialog) {
    recentDialogs.push(dialog);
    dialogCount++;

    if (recentDialogs.length >= DIALOG_MAX) {
        compressDialogs();
    }
}

// ===== 压缩对话（AI 总结最后50条，保留前50条） =====
async function compressDialogs() {
    if (recentDialogs.length === 0) return;

    // 只压缩最后50条，保留前50条
    const keepCount = recentDialogs.length - 50;
    const dialogsToCompress = recentDialogs.slice(-50);
    const text = dialogsToCompress.map(d => 
        `${d.role === 'user' ? '用户' : '桌宠'}: ${d.content}`
    ).join('\n');

    try {
        if (!config.zhipuApiKey || !window.electronAPI || !window.electronAPI.aiChatRequest) {
            // 本地压缩：取最后3条内容拼接
            const summary = dialogsToCompress.slice(-3).map(d => d.content).join('；');
            conversationSummary = summary;
            // 保留前50条 + 新摘要
            recentDialogs = recentDialogs.slice(0, keepCount).concat([{
                role: 'system',
                content: `[对话摘要] ${summary}`,
                time: Date.now()
            }]);
            console.log('[Companion] 对话已压缩(本地):', summary);
            return;
        }

        const result = await window.electronAPI.aiChatRequest({
            messages: [
                { role: 'system', content: '请用一句话总结以下对话的核心内容（不超过50字）。' },
                { role: 'user', content: text }
            ],
            model: 'glm-4-flash',
            maxTokens: 60,
            temperature: 0.5
        });
        let summary = '对话摘要生成失败';
        if (result.choices && result.choices.length > 0) {
            summary = result.choices[0].message.content.trim();
        }
        conversationSummary = summary;
        // 保留前50条 + 新摘要
        recentDialogs = recentDialogs.slice(0, keepCount).concat([{
            role: 'system',
            content: `[对话摘要] ${summary}`,
            time: Date.now()
        }]);
        console.log('[Companion] 对话已压缩:', summary);

    } catch (e) {
        console.warn('[Companion] 压缩对话失败:', e);
        // 压缩失败时保留前50条 + 最后3条拼接
        const summary = dialogsToCompress.slice(-3).map(d => d.content).join('；');
        conversationSummary = summary;
        recentDialogs = recentDialogs.slice(0, keepCount).concat([{
            role: 'system',
            content: `[对话摘要] ${summary}`,
            time: Date.now()
        }]);
    }
}

// ===== Schedule proactive speaking (random interval) =====
function scheduleSpeak() {
    if (!active) return;
    if (isRecording) return; // Don't schedule while recording
    const delay = SPEAK_INTERVAL_MIN + Math.random() * (SPEAK_INTERVAL_MAX - SPEAK_INTERVAL_MIN);
    clearTimeout(speakTimer);
    speakTimer = setTimeout(() => {
        const lastUserMsg = recentDialogs.filter(d => d.role === 'user').pop();
        const timeSinceLastUser = lastUserMsg ? Date.now() - lastUserMsg.time : Infinity;
        if (timeSinceLastUser > 30000 || Math.random() < 0.3) {
            speak();
        } else {
            scheduleSpeak();
        }
    }, delay);
}

// Pause proactive speaking (called during recording)
function pauseSpeak() {
    clearTimeout(speakTimer);
    speakTimer = null;
    console.log('[Companion] Proactive speaking paused (recording)');
}

// Resume proactive speaking (called after recording ends)
function resumeSpeak() {
    console.log('[Companion] Proactive speaking resumed');
    scheduleSpeak();
}

// ===== Continuous recording + STT integration =====
const micBtn = document.getElementById('micBtn');
const micStatus = document.getElementById('micStatus');
let sttReady = false;
let sttInitRetries = 0;
const MAX_STT_RETRIES = 3;

// Float32 → Int16 PCM conversion
function float32ToInt16(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Array;
}

// Merge audio buffer and send as Base64
function sendAudioBuffer(isLast = false) {
    if (audioBuffer.length === 0) {
        if (isLast && window.electronAPI && window.electronAPI.sttStreamAudio) {
            window.electronAPI.sttStreamAudio('', true);
        }
        return;
    }
    // Merge all Int16 data
    const totalLength = audioBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Int16Array(totalLength);
    let offset = 0;
    for (const chunk of audioBuffer) {
        merged.set(chunk, offset);
        offset += chunk.length;
    }
    audioBuffer = [];

    // Int16 → bytes → base64
    const byteBuffer = new Uint8Array(merged.buffer);
    let binary = '';
    for (let i = 0; i < byteBuffer.length; i++) {
        binary += String.fromCharCode(byteBuffer[i]);
    }
    const base64Data = btoa(binary);
    console.log(`[STT] Sending chunk: bytes=${byteBuffer.length}, base64=${base64Data.length}`);

    if (window.electronAPI && window.electronAPI.sttStreamAudio) {
        window.electronAPI.sttStreamAudio(base64Data, isLast);
    }
}

// Start continuous recording
async function startContinuousRecording() {
    if (isRecording) return;
    if (!window.electronAPI || !window.electronAPI.sttStreamInit) {
        showSpeech('Speech recognition not available', 2000);
        return;
    }

    // Retry STT initialization if not ready
    if (!sttReady) {
        if (sttInitRetries < MAX_STT_RETRIES) {
            sttInitRetries++;
            console.log(`[Companion] STT retry ${sttInitRetries}/${MAX_STT_RETRIES}...`);
            showSpeech('Reconnecting speech recognition...', 2000);
            const ok = await window.electronAPI.sttStreamInit();
            console.log('[STT] Init result:', ok);
            if (ok) {
                sttReady = true;
                sttInitRetries = 0;
                console.log('[Companion] STT reconnected successfully');
            } else {
                console.warn('[STT] Init failed, will retry');
                setTimeout(() => startContinuousRecording(), 5000);
                return;
            }
        } else {
            console.warn('[Companion] STT max retries reached, giving up');
            showSpeech('Speech recognition unavailable', 2500);
            return;
        }
    }

    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                sampleRate: SAMPLE_RATE,
                echoCancellation: true,
                noiseSuppression: true
            }
        });
    } catch (e) {
        console.error('[Companion] Microphone permission denied:', e);
        showSpeech('Microphone not authorized', 2500);
        return;
    }

    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
    } catch (e) {
        // Fallback to default sample rate if specifying fails
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    const source = audioContext.createMediaStreamSource(mediaStream);
    // ScriptProcessorNode is deprecated but still works well in Electron
    processorNode = audioContext.createScriptProcessor(AUDIO_BUFFER_SIZE, 1, 1);
    processorNode.onaudioprocess = (e) => {
        if (!isRecording) return;
        const input = e.inputBuffer.getChannelData(0);
        // Resample to 16kHz if sample rate doesn't match
        let resampled = input;
        if (audioContext.sampleRate !== SAMPLE_RATE) {
            resampled = linearResample(input, audioContext.sampleRate, SAMPLE_RATE);
        }
        const int16 = float32ToInt16(resampled);
        audioBuffer.push(int16);
    };
    source.connect(processorNode);
    processorNode.connect(audioContext.destination);

    audioBuffer = [];
    isRecording = true;

    // UI state
    micBtn.classList.add('recording');
    micStatus.textContent = '🎤 Listening…';
    micStatus.classList.add('active');

    // Reset STT state machine
    if (window.electronAPI.sttStreamReset) window.electronAPI.sttStreamReset();

    // Send audio periodically
    sendInterval = setInterval(() => {
        sendAudioBuffer(false);
    }, SEND_INTERVAL_MS);

    // Pause proactive speaking
    pauseSpeak();

    console.log('[Companion] Continuous recording started');
}

// Simple linear resampling
function linearResample(input, fromRate, toRate) {
    if (fromRate === toRate) return input;
    const ratio = toRate / fromRate;
    const outLength = Math.round(input.length * ratio);
    const out = new Float32Array(outLength);
    for (let i = 0; i < outLength; i++) {
        const srcIndex = i / ratio;
        const low = Math.floor(srcIndex);
        const high = Math.min(low + 1, input.length - 1);
        const frac = srcIndex - low;
        out[i] = input[low] * (1 - frac) + input[high] * frac;
    }
    return out;
}

// Stop continuous recording
function stopContinuousRecording() {
    if (!isRecording) return;
    isRecording = false;

    // Clear timer and flush remaining audio
    if (sendInterval) {
        clearInterval(sendInterval);
        sendInterval = null;
    }
    sendAudioBuffer(true); // Send end marker

    // Release audio resources
    if (processorNode) {
        try { processorNode.disconnect(); } catch (e) {}
        processorNode.onaudioprocess = null;
        processorNode = null;
    }
    if (audioContext) {
        try { audioContext.close(); } catch (e) {}
        audioContext = null;
    }
    if (mediaStream) {
        mediaStream.getTracks().forEach(t => t.stop());
        mediaStream = null;
    }
    audioBuffer = [];

    // UI state
    micBtn.classList.remove('recording');
    micStatus.classList.remove('active');
    micStatus.textContent = '';

    // Reset retry counter on successful stop
    sttInitRetries = 0;

    // Resume proactive speaking
    resumeSpeak();

    console.log('[Companion] Continuous recording stopped');
}

// STT result callback
async function onSTTResult(text) {
    // Cancel current bubble (avoid overlap)
    speechEl.classList.remove('show');
    clearTimeout(speechEl._timeout);

    if (!text || !text.trim()) {
        showSpeech('没听清，请再说一遍', 2500);
        return;
    }
    const userText = text.trim();
    showSpeech('🎤 你说：' + userText, 2000);
    // 统一在 handleUserReply 中添加用户消息
    await handleUserReply(userText);
}

// Network diagnosis (check if AI API is reachable)
async function checkNetwork() {
    if (!window.electronAPI || !window.electronAPI.aiChatRequest) return false;
    try {
        await window.electronAPI.aiChatRequest({
            messages: [{ role: 'user', content: 'ping' }],
            maxTokens: 1
        });
        return true;
    } catch {
        return false;
    }
}

// ===== Start / Stop cycle =====
function startCompanion() {
    active = true;
    setMood('鼓励');
    captureAndAnalyze();
    screenCaptureTimer = setInterval(captureAndAnalyze, CAPTURE_INTERVAL);
    scheduleSpeak();
    // Initialize STT service
    if (window.electronAPI && window.electronAPI.sttStreamInit) {
        window.electronAPI.sttStreamInit().catch(e => {
            console.warn('[Companion] STT init failed:', e);
        });
    }
    // Network diagnosis (silent check, only logs)
    checkNetwork().then(ok => {
        console.log('[Companion] AI API network check:', ok ? 'OK' : 'unreachable');
    });
    console.log('[Companion] Companion mode started');
}

function stopCompanion() {
    active = false;
    // Safety net: ensure recording resources are released
    if (isRecording) {
        stopContinuousRecording();
    }
    clearTimeout(speakTimer);
    clearInterval(screenCaptureTimer);
    screenHistory = [];
    recentDialogs = [];
    conversationSummary = '';
    dialogCount = 0;
    console.log('[Companion] Companion mode stopped, data cleared');
}

// ===== Drag window (by dragging the pet image) =====
let isDragging = false;
let dragStartX = 0, dragStartY = 0;
let windowStartX = 0, windowStartY = 0;

container.addEventListener('mousedown', (e) => {
    if (e.target.closest('.ctrl-btn')) return;
    isDragging = true;
    dragStartX = e.screenX;
    dragStartY = e.screenY;
    if (window.electronAPI) {
        const pos = window.electronAPI.getWindowPos();
        windowStartX = pos[0];
        windowStartY = pos[1];
    }
});

document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.screenX - dragStartX;
    const dy = e.screenY - dragStartY;
    if (window.electronAPI) {
        window.electronAPI.moveCompanionWindow(windowStartX + dx, windowStartY + dy);
    }
});

document.addEventListener('mouseup', () => {
    isDragging = false;
});

// ===== Button events =====
document.getElementById('backToMainBtn').addEventListener('click', () => {
    if (window.electronAPI) {
        stopContinuousRecording();
        stopCompanion();
        window.electronAPI.exitCompanionMode('main');
    }
});

document.getElementById('switchToChatBtn').addEventListener('click', () => {
    if (window.electronAPI) {
        stopContinuousRecording();
        stopCompanion();
        window.electronAPI.exitCompanionMode('chat');
    }
});

// 🎤 button: toggle continuous recording
micBtn.addEventListener('click', () => {
    if (isRecording) {
        stopContinuousRecording();
    } else {
        startContinuousRecording();
    }
});

// ===== Push-to-talk: Press Ctrl to record, release to send to STT =====
let isCtrlKeyDown = false;

document.addEventListener('keydown', (e) => {
    if (e.key === 'Control' && !e.repeat) {
        isCtrlKeyDown = true;
        console.log('[Companion] Ctrl pressed, starting recording...');
        if (!isRecording) {
            startContinuousRecording();
        }
    }
});

document.addEventListener('keyup', (e) => {
    if (e.key === 'Control' && isCtrlKeyDown) {
        isCtrlKeyDown = false;
        console.log('[Companion] Ctrl released, stopping recording...');
        if (isRecording) {
            stopContinuousRecording();
        }
    }
});

// ===== IPC listeners =====
if (window.electronAPI) {
    window.electronAPI.onCompanionUserMessage((text) => {
        handleUserReply(text);
    });

    // STT ready
    if (window.electronAPI.onSTTReady) {
        window.electronAPI.onSTTReady(() => {
            sttReady = true;
            console.log('[Companion] STT service ready');
        });
    }

    // STT recognition result
    if (window.electronAPI.onSTTResult) {
        window.electronAPI.onSTTResult((text) => {
            console.log('[Companion] STT recognition result:', text);
            onSTTResult(text);
        });
    }

    // STT session ended (triggered when recording stops)
    if (window.electronAPI.onSTTEnded) {
        window.electronAPI.onSTTEnded(() => {
            console.log('[Companion] STT session ended');
        });
    }
}

// ===== Handle user reply =====
async function handleUserReply(text) {
    // 统一在这里添加用户消息
    addDialog({ role: 'user', content: text, time: Date.now() });

    const screenContext = getScreenContext();
    const now = new Date();
    const timeStr = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;

    let prompt = `【对话】\n用户说：${text}`;
    prompt += `\n\n【当前情境】\n- 当前时间：${timeStr}`;
    if (screenContext) {
        prompt += `\n- 用户屏幕内容：${screenContext}`;
    }
    if (conversationSummary) {
        prompt += `\n- 最近对话摘要：${conversationSummary}`;
    }
    // 最近对话历史（增加到8条，增强记忆）
    const recentUserDialogs = recentDialogs.slice(-8);
    if (recentUserDialogs.length > 0) {
        prompt += `\n- 最近对话：` + recentUserDialogs.map(d => 
            `${d.role === 'user' ? '用户' : '桌宠'}: ${d.content}`
        ).join(' | ');
    }
    // 近期说过的话（防重复）
    if (recentSpeeches.length > 0) {
        prompt += `\n- 你最近说过的话（请勿重复）：${recentSpeeches.slice(-5).join(' | ')}`;
    }
    prompt += `\n\n【要求】`;
    prompt += `\n你的话会被直接朗读，禁止任何动作描写、旁白或括注。`;
    prompt += `\n- 主人的消息可能是语音转文字，会有识别错误或口语化表达，自然理解就好。`;
    prompt += `\n- 基于屏幕快照时，用"刚才看到你…""之前瞥见你在…"这种延迟口吻。`;
    prompt += `\n- 有想说的就开口，没想法就简单"嗯""好喔""哈哈"，别硬聊。`;
    prompt += `\n- 关心或调侃都要基于上下文自然发生，不是完成任务。`;
    prompt += `\n- 语气轻快口语化，但别每句都堆语气词。`;
    prompt += `\n- 颜文字要挑念出来不违和的，复杂的就别用了。`;

    console.log('[Companion] ===== AI 完整提示词 (用户回复) =====');
    console.log(prompt);
    console.log('[Companion] ===========================================');

    const reply = await callZhipu(prompt);
    if (reply) {
        showSpeech(reply);
        if (config.voiceEnabled) speakText(reply);
        addDialog({ role: 'assistant', content: reply, time: Date.now() });
        // 记录到近期说过的话
        recentSpeeches.push(reply);
        if (recentSpeeches.length > 10) recentSpeeches.shift();
        updateMoodFromResponse(reply);
    } else {
        showSpeech('网络好像有点慢，请稍后再试', 3000);
    }
}

// ===== Start =====
startCompanion();