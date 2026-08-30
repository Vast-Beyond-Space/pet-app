// ============================================================
// dsh-pet-link —— DeepSeek Harness ↔ 桌宠 联动插件
// ------------------------------------------------------------
// 职责：
//   1. 监听 DSH 事件（agent/status · session/event · tools/result），
//      维护「当前任务 / todolist / 实时输出（思维链+工具）/ usage」聚合状态
//   2. 每个细分任务完成（turn/end）后，向桌宠推送 { say, state, ... }，
//      桌宠据此说话并切换贴图（state 取自桌宠已注册状态列表）
//   3. 对外提供 HTTP 服务（默认 127.0.0.1:43999）：
//        GET  /status                查询聚合状态
//        POST /send    {message}     向当前 agent 派发任务（followup）
//        POST /cancel                取消当前任务
//   4. 启动时向桌宠状态服务（默认 127.0.0.1:34165/dsh/status）拉取已注册状态列表
//
// 依赖：无（零依赖、原生 node:http / fetch）。RC 版 DSH 事件 payload 存在变动可能，
//       本插件对所有 payload 做深度容错，异常字段不影响主流程。
// ============================================================

import http from 'node:http'
import { randomUUID } from 'node:crypto'

export const name = 'dsh-pet-link'

// 插件行配置（cordis.yml 注入；缺失时走默认值）
// - petUrl:      桌宠本地状态服务地址（默认 http://127.0.0.1:34165）
// - port:        本插件 HTTP 服务端口（默认 43999）
// - say:         细分任务完成后让桌宠说的话（{} 占位符会被替换）
// - states:      事件类型 → 桌宠贴图状态名映射（不填则使用从桌宠拉取的列表智能兜底）
export function apply(ctx, config) {
  const cfg = config || {}
  const petUrl = String(cfg.petUrl || 'http://127.0.0.1:34165').replace(/\/+$/, '')
  const port = parseInt(cfg.port, 10) || 43999

  const log = (...a) => { try { console.log('[pet-link]', ...a) } catch (e) {} }
  const logw = (...a) => { try { console.warn('[pet-link]', ...a) } catch (e) {} }
  log('dsh-pet-link loaded (build 2026-08-30 followup-fixed) petUrl=' + petUrl + ' port=' + port)

  // ---------- 运行期聚合状态 ----------
  const state = {
    agentStatus: 'idle',   // idle / running / unknown
    task: '',
    todolist: [],          // [{ text, status }]
    output: [],            // [{ type, name?, text? , items? }] 尾部为最新
    lastTool: '',
    usage: null,           // 最近一次 assistant/message 的 usage
    totals: { tokens: 0, cost: 0, cacheHit: 0, cacheMiss: 0 },
    agentId: null,         // 最近观察到的 agent / session id（用于派发任务）
    petStates: [],         // 桌宠已注册状态列表（启动时拉取）
    startedAt: null,       // 当前任务开始时间
    pendingConfirm: null,  // 挂起的确认 { resolve, kind: 'approval' }
    minds: [],             // 最近思维/工具/查找内容（供桌宠「上方思维栏」展示）
  }

  // ---------- 工具 ----------
  const pick = (obj, keys) => {
    if (!obj || typeof obj !== 'object') return undefined
    for (const k of keys) {
      if (obj[k] !== undefined && obj[k] !== null) return obj[k]
    }
    return undefined
  }

  // 从任意事件 payload 里尽力提取 agent/session 标识（RC 版字段名不统一，全部尝试）
  function absorbAgentId(payload) {
    if (!payload || typeof payload !== 'object') return
    const id = pick(payload, ['agentId', 'sessionId', 'agent', 'sid', 'id']) ||
      pick(payload, ['session', 'agentInfo']) || null
    if (id && typeof id === 'object') {
      state.agentId = id.id || id.sessionId || id.sid || state.agentId
    } else if (typeof id === 'string' && id) {
      state.agentId = id
    }
  }

  const MODEL_PRICES = { hit: 0.2, miss: 1.0, out: 3.0 } // 元 / 百万 token（deepseek-v4-flash 参考价）

  // 错峰计费（北京时间）：高峰 = 周一至周五 9:00–12:00 / 14:00–18:00，其余空闲；
  // 空闲时段价格 = 高峰一半。与桌宠主进程 ratePeriodNow 保持一致。
  function rateFactorNow() {
    const now = new Date(Date.now() + 8 * 3600 * 1000) // 北京时间
    const day = now.getUTCDay()
    const mins = now.getUTCHours() * 60 + now.getUTCMinutes()
    const isWeekday = day >= 1 && day <= 5
    const isPeak = isWeekday && ((mins >= 540 && mins < 720) || (mins >= 840 && mins < 1080))
    return isPeak ? 1 : 0.5
  }

  function absorbUsage(usage) {
    if (!usage || typeof usage !== 'object') return
    state.usage = usage
    // DSH 归一化 usage（dsh-llm TokenUsage：inputTokens=未命中输入 / cacheReadTokens=缓存命中 /
    // cacheWriteTokens=缓存写入 / outputTokens=输出）优先，兼容原始 DeepSeek 字段兜底。
    // 旧实现只读原始字段，DSH 事件里是归一化字段 → 花费/缓存命中率恒为 0。
    const hit = Number(pick(usage, ['cacheReadTokens', 'prompt_cache_hit_tokens', 'cache_hit'])) || 0
    const miss = Number(pick(usage, ['inputTokens', 'prompt_cache_miss_tokens', 'cache_miss'])) || 0
    const write = Number(pick(usage, ['cacheWriteTokens', 'prompt_cache_write_tokens'])) || 0
    const inTok = Number(pick(usage, ['prompt_tokens', 'input_tokens'])) || (hit + miss + write)
    const outTok = Number(pick(usage, ['completion_tokens', 'outputTokens', 'output_tokens'])) || 0
    state.totals.tokens += inTok + outTok
    state.totals.cacheHit += hit
    state.totals.cacheMiss += miss
    const rf = rateFactorNow()
    state.totals.cost += ((hit / 1e6) * MODEL_PRICES.hit + (miss / 1e6) * MODEL_PRICES.miss + (outTok / 1e6) * MODEL_PRICES.out) * rf
  }

  // todolist：从 plan / todos 类工具调用参数中提取
  const TODO_TOOL_RE = /plan|todo/i
  function absorbTodos(args) {
    if (!args || typeof args !== 'object') return
    const todos = args.todos
    if (Array.isArray(todos) && todos.length) {
      state.todolist = todos.map(t => {
        if (typeof t === 'string') return { text: t, status: 'pending' }
        const text = t.text || t.title || t.description || t.content || ''
        const status = String(t.status || 'pending').toLowerCase()
        return { text, status }
      })
      return true
    }
    return false
  }

  const clamp = (s, n) => String(s == null ? '' : s).slice(0, n)

  // 从 user/message 消息里提取纯文本（DSH 消息 content 为内容块数组；兼容旧版字符串）
  function messageText(message) {
    if (!message || typeof message !== 'object') return ''
    const content = message.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content.map(b => (b && typeof b === 'object' && b.type === 'text' ? b.text : '')).join('')
    }
    return ''
  }

  // 把工具调用参数（DSH 里为 JSON 字符串）解析为对象，失败返回 null
  function parseToolArgs(args) {
    if (!args) return null
    if (typeof args === 'object') return args
    if (typeof args === 'string') {
      try { return JSON.parse(args) } catch (e) { return null }
    }
    return null
  }

  // 从 tool/result 事件里提取文本：data.message.content[0] 是 { type:'tool-result', content:[{type:'text',text}] }
  function toolResultText(data) {
    const msg = data && typeof data.message === 'object' ? data.message : null
    const blocks = msg && Array.isArray(msg.content) ? msg.content : []
    const block = blocks[0]
    const inner = block && typeof block === 'object' && Array.isArray(block.content) ? block.content : []
    return inner.map(b => (b && typeof b === 'object' ? (b.text || '') : b)).filter(Boolean).join(' ')
  }

  function pushOutput(entry) {
    state.output.push(entry)
    if (state.output.length > 300) state.output = state.output.slice(-300)
  }

  function pushMind(kind, text) {
    if (!text) return
    state.minds.push({ kind, text: clamp(text, 300), ts: Date.now() })
    if (state.minds.length > 12) state.minds = state.minds.slice(-12)
  }

  // 工具名 → 环节分类（供桌宠按环节配置贴图状态）
  function categoryOfTool(name) {
    const n = String(name || '').toLowerCase()
    if (/bash|pwsh|powershell|shell|cmd|exec/.test(n)) return 'cmd'
    if (/read|view|show|cat\b/.test(n)) return 'read'
    if (/grep|search|find|rg\b/.test(n)) return 'grep'
    return 'tool'
  }

  // ---------- 向桌宠推送 ----------
  async function pushToPet(payload) {
    const body = { ...payload, totals: state.totals, agentStatus: state.agentStatus, minds: state.minds.slice(-6) }
    try {
      const res = await fetch(`${petUrl}/dsh/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3000),
      })
      if (!res.ok && res.status !== 404) logw('push status', res.status)
    } catch (e) {
      // 桌宠未启动/已退出：静默降级（DSH 依然正常工作，只是桌宠收不到）
    }
  }

  // 每条 turn/end 的「说什么 + 切什么贴图」
  // cfg.say 可用 {} 占位符：{task} 任务、{tool} 最近工具、{dur} 耗时、{hit} 命中率
  async function announceTurnEnd(agentStatus, reason) {
    const dur = state.startedAt ? Math.round((Date.now() - state.startedAt) / 1000) : 0
    const totals = state.totals
    const hit = totals.cacheHit + totals.cacheMiss > 0
      ? ((totals.cacheHit / (totals.cacheHit + totals.cacheMiss)) * 100).toFixed(0) + '%'
      : '—'
    let say = clamp(cfg.say === undefined
      ? (reason === 'error' ? 'DSH 那边似乎出错了，要不要看看？' : 'DSH 刚刚完成了一轮任务，我把过程盯着呢！')
      : String(cfg.say), 200)
      .replace(/\{task\}/g, state.task || '任务')
      .replace(/\{tool\}/g, state.lastTool || '工具')
      .replace(/\{dur\}/g, `${dur}s`)
      .replace(/\{hit\}/g, hit)
    // 贴图状态：优先用户配置映射（cfg.states），其次桌宠状态列表语义匹配
    let stateName = ''
    const map = cfg.states || {}
    if (reason === 'error') {
      stateName = map.error || (state.petStates.includes('难过') ? '难过' : state.petStates[0] || '')
    } else if (reason === 'done') {
      stateName = map.done || (state.petStates.includes('开心') ? '开心' : state.petStates[0] || '')
    } else {
      stateName = map.running || (state.petStates.includes('工作') ? '工作' : state.petStates[0] || '')
    }
    await pushToPet({
      event: reason === 'error' ? 'task/error' : (reason === 'done' ? 'task/done' : 'task/running'),
      category: reason === 'error' ? 'error' : (reason === 'done' ? 'done' : 'run'),
      say,
      state: stateName,
      task: state.task,
      todolist: state.todolist,
      tool: state.lastTool,
      usage: state.usage,
      agentId: state.agentId,
    })
  }

  // ---------- 事件监听 ----------
  // agent/status：运行/空闲切换（payload 结构 RC 版可能不同，容错）
  ctx.on('agent/status', (payload) => {
    try {
      absorbAgentId(payload)
      const st = String(payload ? (payload.status || payload.state) : '').toLowerCase()
      if (st === 'running' || st === 'idle') {
        const prev = state.agentStatus
        state.agentStatus = st
        if (st === 'running' && prev !== 'running') {
          state.startedAt = Date.now()
          state.task = state.task || ''
          pushToPet({ event: 'agent/start', agentStatus: 'running', category: 'run', state: (cfg.states || {}).running || (state.petStates.includes('工作') ? '工作' : ''), say: 'DSH 开始忙活啦，我帮你盯着～' })
        } else if (st === 'idle') {
          pushToPet({ event: 'agent/idle', agentStatus: 'idle', category: 'idle' })
        }
      }
    } catch (e) { logw('agent/status err', e.message) }
  })

  // session/event：持久会话日志（turn/step/tool/assistant 事实）。
  // 官方监听器签名为 (session, event)：第一个参数是会话对象（含 session.id），
  // 第二个参数才是事件本体。旧实现只声明了 (ev)，收到的其实是 Session，
  // ev.type 恒为 undefined → 整个分支全部失效（usage/todolist/思维栏/轮次播报都不工作）。
  ctx.on('session/event', (subject, ev) => {
    try {
      absorbAgentId(subject)
      const type = ev && ev.type ? String(ev.type) : ''
      const data = ev && typeof ev.data === 'object' ? ev.data : ev
      if (!type) return

      if (type === 'turn/start' || type === 'step/start') {
        if (state.agentStatus !== 'running') state.agentStatus = 'running'
        if (!state.startedAt) state.startedAt = Date.now()
        if (state.task && type === 'step/start') {
          // 每步开始都轻量同步一次 todolist / 输出（节流由推送端决定）
          pushToPet({ event: 'progress', task: state.task, todolist: state.todolist })
        }
      } else if (type === 'turn/end') {
        // data = { turn, reason: { kind: 'completed'|'max-tokens'|'blocked'|'error'|'aborted', ... } }
        const kind = data && data.reason ? String(data.reason.kind || '') : ''
        const reason = (kind === 'error' || kind === 'aborted') ? 'error' : 'done'
        state.agentStatus = 'idle'
        announceTurnEnd(reason === 'error' ? 'error' : 'done', reason).catch(() => {})
        state.task = ''
        state.todolist = []
        state.startedAt = null
      } else if (type === 'user/message') {
        // data 就是消息本体 { id, role, content, source }；只认用户来源，避免
        // 插件/运行时上下文消息把「当前任务」覆盖成内部内容
        const src = data && data.source ? data.source : null
        if (src && src.kind === 'user') {
          const text = messageText(data)
          if (text.trim()) {
            state.task = clamp(text, 160)
            pushToPet({ event: 'task/new', task: state.task, agentStatus: 'running' })
          }
        }
      } else if (type === 'assistant/chunk') {
        // data = { turn, step, chunk: { type:'text'|'reasoning'|'tool-call'|'finish', content } }
        const chunk = data && typeof data.chunk === 'object' ? data.chunk : null
        if (!chunk || typeof chunk.content !== 'string' || !chunk.content) return
        if (chunk.type === 'reasoning') {
          pushMind('think', chunk.content)
          pushOutput({ type: 'think', text: clamp(chunk.content, 600) })
          // 思维节流推送（合并连续 chunk），避免刷屏
          const now = Date.now()
          if (!state.lastMindPush || now - state.lastMindPush > 900) {
            state.lastMindPush = now
            pushToPet({ event: 'think', category: 'think', minds: state.minds.slice(-6) })
          }
        } else if (chunk.type === 'text') {
          pushOutput({ type: 'think', text: clamp(chunk.content, 600) })
        }
      } else if (type === 'assistant/message') {
        // 完整 assistant 消息：吸附 usage（{ inputTokens, outputTokens, cacheReadTokens, ... }）
        const usage = pick(data, ['usage', 'modelUsage'])
        absorbUsage(typeof usage === 'object' ? usage : data)
        pushToPet({ event: 'usage', usage: state.usage, totals: state.totals })
      } else if (type === 'todo/write') {
        // DSH 官方 todolist 事件：data = { todos: [{ content, status }] }
        absorbTodos(data)
      } else if (type === 'tool/call') {
        const name = pick(data, ['name', 'toolName']) || pick(data, ['exec', 'tool']) || ''
        const toolName = typeof name === 'object'
          ? (name.name || name.toolName || '') : String(name)
        const args = parseToolArgs(pick(data, ['arguments', 'args', 'input']))
        state.lastTool = toolName
        if (TODO_TOOL_RE.test(toolName)) absorbTodos(args)
        const category = categoryOfTool(toolName)
        const argPreview = args ? clamp(JSON.stringify(args), 200) : ''
        pushOutput({ type: 'tool', name: toolName, items: argPreview ? [argPreview] : [] })
        pushMind('tool', `${toolName}${argPreview ? ' ' + argPreview : ''}`)
        pushToPet({
          event: 'tool/call', category, tool: toolName, task: state.task,
          todolist: state.todolist, output: [state.output[state.output.length - 1]],
          minds: state.minds.slice(-6), agentStatus: 'running',
        })
      } else if (type === 'tool/result') {
        const content = toolResultText(data)
        pushOutput({ type: 'tool-result', name: state.lastTool || '', text: clamp(content, 400) })
        // 细分任务（每轮工具调用）完成 → 也让桌宠碎碎念一次（频率较高，简短）
        pushToPet({ event: 'tool/result', say: cfg.stepSay || '', task: state.task, todolist: state.todolist })
      }
    } catch (e) { logw('session/event err', e.message) }
  })

  // tools/result：工具执行完成（agent 生命周期事件，独立于 session/event）
  ctx.on('tools/result', (exec, result) => {
    try {
      const name = exec ? (exec.name || '') : ''
      if (name) {
        state.lastTool = name
        absorbTodos(exec && exec.arguments)
        const text = Array.isArray(result && result.content)
          ? result.content.map(b => (b && b.type === 'text' ? b.text : '')).join(' ').slice(0, 300)
          : ''
        pushOutput({ type: 'tool', name, items: text ? [text] : [] })
      }
    } catch (e) { /* 忽略 */ }
  })

  // ---------- 兜底状态监听：DSH RC 版事件名可能变动，多挂几个别名及时捕捉运行/空闲 ----------
  ;['agent/start', 'agent/end', 'agent/finish', 'agent/complete', 'run/start', 'run/end',
    'session/start', 'session/end', 'session/running', 'session/idle'].forEach((evName) => {
    ctx.on(evName, (payload) => {
      try {
        absorbAgentId(payload)
        const lower = String(evName).toLowerCase()
        const toRunning = /start|running/.test(lower)
        const toIdle = /end|finish|complete|idle/.test(lower)
        if (toRunning && state.agentStatus !== 'running') {
          state.agentStatus = 'running'
          if (!state.startedAt) state.startedAt = Date.now()
          pushToPet({ event: 'agent/start', agentStatus: 'running', category: 'run', state: (cfg.states || {}).running || (state.petStates.includes('工作') ? '工作' : ''), say: 'DSH 开始忙活啦，我帮你盯着～' })
        } else if (toIdle && state.agentStatus !== 'idle') {
          state.agentStatus = 'idle'
          announceTurnEnd('done', 'done').catch(() => {})
          state.task = ''
          state.todolist = []
          state.startedAt = null
        }
      } catch (e) { /* 容错 */ }
    })
  })

  // ---------- 启动时拉取桌宠已注册状态列表 ----------
  async function fetchPetStates() {
    try {
      const res = await fetch(`${petUrl}/dsh/status`, { signal: AbortSignal.timeout(3000) })
      if (res.ok) {
        const body = await res.json()
        if (Array.isArray(body.states) && body.states.length) state.petStates = body.states
        log('已从桌宠拉取状态列表:', state.petStates.join(' / '))
      }
    } catch (e) { logw('拉取桌宠状态失败（桌宠未启动？）:', e.message) }
  }
  fetchPetStates()

  // ---------- 原生审批 answerer：改造 DSH 自带的「向用户确认」功能 ----------
  // DSH 的权限确认走 ctx.approval.request()，需要时派发 `approval/request`（waterfall）
  // 由 answerer 应答。默认 Web UI 提供 answerer（在页面里弹确认框）；这里注册一个
  // 「桌宠 answerer」：把确认请求转发到桌宠，桌宠弹出「允许 / 拒绝 / 取消」按钮，
  // 用户在桌宠上选择后，结果经 POST /ask/result 回到这里，waterfall 立即返回
  // ApprovalOutcome（allowed-once / rejected / cancelled）。
  // 依据官方 approval.md：一部署应只挂一个 terminal answerer；本插件作为唯一应答者，
  // 返回 outcome 即认领请求，不调用 next()。
  ctx.on('approval/request', async (req, next) => {
    try {
      const toolName = (req && req.toolName) ? String(req.toolName) : ''
      const reason = (req && req.reason) ? String(req.reason) : ''
      // 统一用中文询问：DSH 侧的 reason 是英文（如 tool "pwsh" requires approval…），
      // 不能直接透传。中文主句 + 英文原因为附注；桌宠弹窗显示 reason || question，
      // 因此把完整中文文案放进 reason，toolName 置空避免桌宠再拼一遍「（工具：…）」。
      let question = `DSH 请求批准一次操作${toolName ? `（工具：${toolName}）` : ''}`
      if (reason) question += `\n原因：${reason}`
      const outcome = await new Promise((resolve) => {
        state.pendingConfirm = { resolve, kind: 'approval', agentId: state.agentId }
        pushToPet({ event: 'approval', toolName: '', reason: question, question })
        // 3 分钟无人应答视为取消
        setTimeout(() => {
          if (state.pendingConfirm && state.pendingConfirm.resolve === resolve) {
            state.pendingConfirm = null
            resolve('cancelled')
          }
        }, 3 * 60 * 1000)
      })
      log('审批应答:', toolName, '→', outcome)
      if (outcome === 'allowed-once' || outcome === 'rejected' || outcome === 'cancelled') return outcome
      return 'cancelled'
    } catch (e) {
      logw('审批 answerer 异常，委托下游:', e.message)
      return (typeof next === 'function') ? next() : 'unavailable'
    }
  })
  log('approval/request answerer 已注册（桌宠弹窗审批，替代 DSH 页面确认框）')

  // ---------- 模拟状态推送（设置面板「测试」按钮使用）----------
  // 依次向桌宠推送 think → cmd → read → grep → done 各环节（整轮模拟），
  // 最后回到 idle（退出覆盖、恢复随机状态机）。body.category 可指定只测单个环节。
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  async function simulateStates({ category } = {}) {
    const cats = category ? [String(category)] : ['think', 'cmd', 'read', 'grep', 'done']
    const wasRunning = state.agentStatus === 'running'
    state.agentStatus = 'running'
    for (const c of cats) {
      await pushToPet({
        event: 'test/send', category: c, agentStatus: 'running', task: '【测试】模拟状态推送',
        tool: c, todolist: [{ text: '模拟推送 ' + c + ' 环节', status: 'running' }],
      })
      if (!category) await sleep(400) // 整轮模拟留出间隔，便于观察桌宠逐环节切换
    }
    if (category) {
      if (!wasRunning) state.agentStatus = 'idle'
    } else {
      // 整轮收尾：先应用「任务完成」贴图（覆盖保持），再退出覆盖恢复随机状态机
      await sleep(400)
      await pushToPet({ event: 'test/done', category: 'done', agentStatus: 'running', task: '【测试】模拟状态推送' })
      await sleep(600)
      state.agentStatus = 'idle'
      await pushToPet({ event: 'test/idle', agentStatus: 'idle', task: '' })
    }
    log('simulation pushed:', cats.join(' / '))
    return { ok: true, categories: cats }
  }

  // ---------- HTTP 服务 ----------
  const server = http.createServer(async (req, res) => {
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(obj))
    }
    let url
    try { url = new URL(req.url, `http://127.0.0.1:${port}`) } catch (e) { return send(400, { ok: false, error: 'bad url' }) }
    const readBody = () => new Promise((resolve) => {
      let data = ''
      req.on('data', c => { data += c; if (data.length > 1e6) req.destroy() })
      req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}) } catch (e) { resolve({}) } })
      req.on('error', () => resolve({}))
    })

    try {
      if (req.method === 'GET' && url.pathname === '/status') {
        return send(200, { ok: true, ...state })
      }
      if (req.method === 'POST' && url.pathname === '/send') {
        const body = await readBody()
        const message = String(body.message || '').trim()
        if (!message) return send(400, { ok: false, error: 'empty message' })
        const result = await dispatchTask(message, body.sessionId)
        return send(result.ok ? 200 : 409, result)
      }
      if (req.method === 'POST' && url.pathname === '/cancel') {
        return send(200, await cancelTask())
      }
      if (req.method === 'POST' && url.pathname === '/test-state') {
        const body = await readBody()
        const result = await simulateStates(body || {})
        return send(200, result)
      }
      if (req.method === 'POST' && url.pathname === '/ask/result') {
        // 桌宠弹窗回传审批结果 → resolve 挂起的 approval/request answerer
        const body = await readBody()
        const pending = state.pendingConfirm
        if (!pending) return send(404, { ok: false, error: 'no pending confirm' })
        state.pendingConfirm = null
        let outcome = 'cancelled'
        if (body.canceled === true) outcome = 'cancelled'
        else if (body.allowed === true || body.answer === '允许') outcome = 'allowed-once'
        else if (body.answer === '拒绝') outcome = 'rejected'
        pending.resolve(outcome)
        send(200, { ok: true })
        await pushToPet({ event: 'approval/answered', outcome })
        return
      }
      send(404, { ok: false, error: 'not found' })
    } catch (e) {
      send(500, { ok: false, error: e.message })
    }
  })
  server.on('error', (e) => logw('HTTP 服务启动失败:', e.message))
  server.listen(port, '127.0.0.1', () => {
    log(`已启动 http://127.0.0.1:${port} (petUrl=${petUrl})`)
    // 就绪即向桌宠推送一条 ready（含当前聚合状态），桌宠据此从「未连接」变为「空闲/已连接」
    pushToPet({ event: 'plugin/ready', agentStatus: 'idle', task: state.task, todolist: state.todolist, totals: state.totals })
  })

  // ---------- 派发 / 取消任务（Agent 接口；RC 版 API 以优雅失败兜底）----------
  async function dispatchTask(message, sessionId) {
    const candidateId = (sessionId && String(sessionId)) || state.agentId
    if (!candidateId) {
      return { ok: false, error: '尚未发现任何 DSH 会话。请先在 DSH Web/桌面端打开一个会话（或从桌宠派发时携带 sessionId）。插件日志里会持续记录可派发的 agentId。' }
    }
    try {
      const agents = ctx.get('agents')
      const agent = agents ? agents.get(candidateId) : undefined
      if (!agent) {
        return { ok: false, error: `找不到 agent 「${candidateId}」。如果会话端和插件端使用的 id 不一致，请在桌宠派发时带上 sessionId。` }
      }
      if (typeof agent.followup !== 'function') {
        return { ok: false, error: 'agent 句柄不完整（RC 版接口变动）。' }
      }
      // 与 Web 对话框输入同构：官方 UI 走 agent.followup(createUserMessage({ content, source:{kind:'user'} }))，
      // 这里手工构造等价消息（content 必须为内容块数组，source.kind='user' 使其表现为用户输入）。
      // 传纯字符串会被逐字符拆成模块，导致上下文显示「未知内容模块」且下游 content.some 报错。
      // id 必须与 createUserMessage 一样为稳定 UUID 字符串：缺失 id 会在会话校验时报
      // 「lacks an identified message」，source 必须是 { kind } 对象（字符串会被判为
      // 「message has invalid source」，历史会话将无法加载）。
      const followupMessage = {
        role: 'user',
        content: [{ type: 'text', text: message }],
        source: { kind: 'user' }, // 与官方 UI createUserMessage 一致：user 来源仅 kind 字段
        id: randomUUID(),
      }
      agent.followup(followupMessage)
      state.agentStatus = 'running'
      state.startedAt = Date.now()
      state.task = clamp(message, 160)
      state.todolist = []
      pushToPet({ event: 'task/sent', task: state.task, agentStatus: 'running', say: '任务已经交给 DSH 开始跑啦！' })
      log('已向 agent 派发任务:', message)
      return { ok: true, agentId: candidateId }
    } catch (e) {
      logw('派发失败:', e.message)
      return { ok: false, error: e.message }
    }
  }

  async function cancelTask() {
    if (!state.agentId) return { ok: false, error: '无活动会话可取消' }
    try {
      const agents = ctx.get('agents')
      const agent = agents ? agents.get(state.agentId) : undefined
      if (!agent) return { ok: false, error: '找不到 agent' }
      if (typeof agent.cancel !== 'function') return { ok: false, error: 'agent 句柄不完整' }
      agent.cancel({ kind: 'user' })
      state.agentStatus = 'idle'
      pushToPet({ event: 'task/canceled', agentStatus: 'idle', say: '收到！已经帮你把 DSH 的任务停下来了。' })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  }

  // 卸载清理
  ctx.effect(() => () => {
    try { server.close() } catch (e) { /* 忽略 */ }
  })
}