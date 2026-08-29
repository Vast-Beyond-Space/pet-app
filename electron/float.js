/*
 * float.js 改动说明：
 * 1. 开头检测运行模式：isChatMode = URL 参数 mode === 'chat'
 * 2. 聊天模式：隐藏桌宠元素，只显示聊天界面，不启动游荡
 * 3. 浮窗模式：保持原有逻辑（游荡、拖动、气泡等）
 * 4. 新增记忆系统：与主窗口共享 localStorage
 * 5. 新增立绘系统：与主窗口完全一致的表情插图功能
 */

// ===== 检测运行模式 =====
const isChatMode = new URLSearchParams(window.location.search).get('mode') === 'chat';
// 设置面板模式：float.html?mode=settings（独立设置窗口）
const isSettingsMode = new URLSearchParams(window.location.search).get('mode') === 'settings';

// 版本标记：用于确认渲染进程加载的 float.js 是否最新（排查旧副本/内联缓存问题）
console.log('[float] version 2026-08-29 states-origin+fx-none+preview-fix (isChatMode=' + isChatMode + ', isSettingsMode=' + isSettingsMode + ')');

const floatPet = document.getElementById('floatPet');
const floatPetImg = document.getElementById('floatPetImg');
const floatBubble = document.getElementById('floatBubble');
const petContainer = document.getElementById('petContainer');
const chatContainer = document.getElementById('chatContainer');
const chatCloseBtn = document.getElementById('chatCloseBtn');
const floatChatLog = document.getElementById('floatChatLog');
const floatChatInput = document.getElementById('floatChatInput');
const floatSendBtn = document.getElementById('floatSendBtn');
const floatChatIllust = document.getElementById('floatChatIllust');
const floatIllustHideBtn = document.getElementById('floatIllustHideBtn');
const floatIllustShowBtn = document.getElementById('floatIllustShowBtn');

// ===== 气泡选项点击事件 =====
// 通过事件委托处理气泡内的选项点击
document.addEventListener('click', (e) => {
    const option = e.target.closest('.bubble-option');
    if (!option) return;
    // 确保气泡是可见的（鼠标靠近状态）
    if (!floatBubble.classList.contains('show')) return;

    const action = option.dataset.action;
    if (action === 'chat') {
        enterChatMode();
    } else if (action === 'settings') {
        // 打开设置面板（独立窗口）
        if (window.electronAPI && window.electronAPI.openSettings) {
            window.electronAPI.openSettings();
        }
    } else if (action === 'home') {
        // 回家：唤起主窗口 index.html（次要窗口）
        if (window.electronAPI && window.electronAPI.showIndexWindow) {
            window.electronAPI.showIndexWindow();
        }
    } else if (action === 'companion') {
        if (window.electronAPI) {
            window.electronAPI.enterCompanionMode();
            window.close();
        }
    }
});

let isDragging = false;
let pausedEatingOnDrag = false; // 拖动开始时是否处于吃饭/吃饼干状态（用于拖动结束后恢复缩放动画）
let lastPetMouseEvent = 0;      // 最近一次鼠标事件时间戳（用于看门狗解除卡死的悬停）
let isMoving = false;
let isParabolaRunning = false;
let isWindowMinimized = true;
let floatIsClosing = false;
let currentFloatSessionId = null;
let dragStartX = 0;
let dragStartY = 0;
let windowStartX = 0;
let windowStartY = 0;
let screenWidth = 1920;
let screenHeight = 1080;
let screenX = 0;
let screenY = 0;
let wanderTimer = null;

// 移动模式：'free' 自由游荡 | 'gravity' 重力模式
let moveMode = 'free';

// 是否在重力模式下与非全屏窗口碰撞
let bounceOffWindows = false;

// 固定移动速度
const MOVE_SPEED = 1.2;
const MOVE_INTERVAL_MS = 16;

// 单摆旋转相关状态
let pendulumAngle = 0;
let pendulumVel = 0;
let pendulumTarget = 0;
let pendulumRAF = null;
let lastMouseClientX = 0;
let lastMouseTime = 0;
const ORIGINAL_PET_SRC = () => imgPath('pet.png');
const DRAG_PET_SRC = () => imgPath('被拖动.png');

// 桌宠状态贴图：全部由当前贴图包现场注册（见 registerDynamicStates），
// 不再预设任何"默认"状态集合 —— 贴图包有哪些状态就注册哪些状态。
const PET_IMGS = {};

// 桌宠状态
let petState = 'wandering'; // wandering | eating | daydreaming | working | angry | craving | eating_cookie | sleeping
let petStateTimer = null;

// 行为保持概率（60%维持当前行为，40%切换），可在开发者模式调整
let behaviorKeepProbability = 0.6;

// 开发者模式标记
let devMode = false;

// 饼干相关（IPC方式，饼干在独立窗口）
let cookieSize = 40; // 可调饼干大小，与主进程同步
const COOKIE_CHASE_DISTANCE = 350; // 追逐触发距离(px)
const COOKIE_SPAWN_INTERVAL = 60000; // 1分钟
const ANGRY_PROBABILITY = 0.3; // 超时后生气概率
const cookieState = { active: false, x: 0, y: 0, consumed: false };
let cookieSpawnTimer = null;
let cookieSpawnEnabled = true; // 是否生成饼干（可由主窗口设置）
let cookieFirstSpawn = true; // 首次生成标记

// 当前桌宠大小
let currentPetSize = 80;
// 贴图位置偏移（正数上移）、按钮位置偏移（正数上移）、窗口高度附加
let floatPetBottomOffset = 0;
let floatBubbleOffset = 0;
let floatWindowHeightPad = 0;

// 聊天历史
let chatHistory = [];

// 记忆相关
let memoryItems = [];

// 记忆分页：每页条数 & 当前页码（设置面板用）
const MEMORY_PAGE_SIZE = 10;
let memoryPage = 1;

// 记忆搜索关键字 & 状态链构建器当前序列（设置面板用）
let memorySearchKeyword = '';
let currentChain = [];

// 本次（当前）聊天会话中已上传并缓存的截图（{fileId, imagePath, imageUrl, time}）
// 用于在对话结束前缓存所有截图，并在记忆总结阶段由 AI 判断哪些需要保留
let pendingConversationImages = [];

// 记忆显示过滤：分别控制是否显示 图像记忆 / 文本记忆
let memoryShowImg = true;
let memoryShowText = true;


// 状态相关（与主窗口同步）
let stats = {
    hunger: 70,
    happiness: 70,
    energy: 80,
    bladder: 50,
    hygiene: 70,
    boredom: 50,
    affection: 30
};
const statNames = {
    hunger: '饱食',
    happiness: '快乐',
    energy: '精力',
    bladder: '便意',
    hygiene: '清洁',
    boredom: '无聊',
    affection: '好感'
};
const roomNames = {
    living: '客厅',
    bedroom: '卧室',
    kitchen: '厨房',
    bathroom: '卫生间',
    laundry: '阳台'
};
let behaviorLog = [];
let cachedWeather = null;
let weatherFetchTime = 0;

// 立绘相关
const moodEmojis = {
    '鼓励': '💪',
    '害羞': '😳',
    '好奇': '🤔',
    '惊讶': '😲',
    '难过': '😢',
    '撒娇': '🥺',
    '生气': '😠',
    '无语': '😑',
    '兴奋': '🤩'
};
// moodList 为动态可用心情，见 refreshMoodList()（模块下方声明）

// 配置（从 localStorage 读取）
let config = {
    apiKey: '',
    apiUrl: 'https://api.deepseek.com/v1/chat/completions',
    aiPrompt: '你是一个可爱的桌宠小鲸鱼，性格活泼可爱。请用简短可爱的语气回复，不要超过30字。\n\n【心情标记格式】\n在回复末尾，你必须使用以下格式标记你当前的心情：<MOOD:心情>\n可选心情：鼓励、害羞、好奇、惊讶、难过、撒娇、生气、无语、兴奋\n选择依据：根据你当前的状态和对话内容选择最贴切的心情，而不是随机选择。\n例如：<MOOD:害羞>\n注意：心情标记只出现在回复末尾，不要出现在正文对话中。\n\n【行为指令格式】\n如果用户要求你去某个房间或做某件具体的事，请在回复末尾使用以下格式输出指令：<CMD:指令>\n可用指令：去客厅、去卧室、去厨房、去卫生间、去阳台、吃饭、睡觉、洗澡、上厕所、看电视\n例如：<CMD:去卧室>\n注意：指令标记只出现在回复末尾，不要出现在正文对话中。',
    enableMemory: false,
    floatShowIllust: true,
    zhipuApiKey: '',
    multimodalEnabled: false,
    multimodalProvider: 'deepseek',
    zhipuApiUrl: '',
    selectedVoice: 'default',
    voiceEnabled: true,
    voiceAutoSend: true,
    voiceVolume: 1.0,
    stickerPack: '默认',
    // 设置面板迁移用到的字段（与 index 共用 petConfig，缺省兜底）
    floatMoveMode: 'free',
    floatPetSize: 80,
    bounceWindows: false,
    cookieSpawnEnabled: true,
    cookieSize: 40,
    autoStart: false,
    // ===== 家里(主窗口)专属设置（统一设置窗口内也可调整）=====
    windowOpacity: 1,
    wallOpacity: 1,
    floorOpacity: 1,
    mainPetSize: 7.5,
    furnitureSize: 3.8,
    buttonSize: 40,
    portraitAuto: true,
    companionWidth: 400,
    // ===== 状态链（迁移自 electron-lite）=====
    stateChains: [],
    interruptState: 'wandering',
    // ===== 状态特效 / 切换概率（用户可在设置面板配置）=====
    stateEffects: {},
    probabilityMode: 'relative',
    stateProbabilities: {}
};

// 加载配置
function loadConfig() {
    try {
        const saved = localStorage.getItem('petConfig');
        if (saved) {
            const parsed = JSON.parse(saved);
            config = {
                ...config,
                ...parsed,
                zhipuApiKey: parsed.zhipuApiKey || '',
                multimodalEnabled: parsed.multimodalEnabled || false,
                multimodalProvider: parsed.multimodalProvider || 'deepseek',
                zhipuApiUrl: parsed.zhipuApiUrl || ''
            };
            if (config.floatShowIllust !== undefined) {
                floatShowIllust = config.floatShowIllust;
            }
            // FIX: 问题一 - 修改1：确保 enableMemory 被正确解析为布尔值
            config.enableMemory = parsed.enableMemory === true || parsed.enableMemory === 'true';
            // 确保 selectedVoice 存在
            if (config.selectedVoice === undefined) config.selectedVoice = 'default';
        }
    } catch (e) {}
    // 同步 window._stickerPack，确保 imgPath() 使用正确的贴图包
    window._stickerPack = config.stickerPack || '默认';
    // 从主进程拉取权威配置（float/index/设置窗口共用同一套），覆盖被覆盖的本地缓存，
    // 确保无论从哪个窗口唤起设置面板，都读取 float 已完成的设置而非默认值
    if (window.electronAPI && window.electronAPI.getConfig) {
        window.electronAPI.getConfig().then((unified) => {
            if (unified && typeof unified === 'object') {
                config = { ...config, ...unified };
                if (config.floatShowIllust !== undefined) floatShowIllust = config.floatShowIllust;
                localStorage.setItem('petConfig', JSON.stringify(config));
                window._stickerPack = config.stickerPack || '默认';
                // 若当前是设置面板模式，刷新控件显示值为权威配置
                if (isSettingsMode) refreshSettingsValues();
            }
        }).catch(() => {});
    }
}
loadConfig();

// 保存配置（设置面板复用；与原版共用 petConfig key）
function saveConfig() {
    localStorage.setItem('petConfig', JSON.stringify(config));
    // 全量同步到主进程：由主进程统一管理并广播给 index / 其它 float 窗口，
    // 解决 file:// 各窗口 localStorage 不互通导致的"两套独立设置"
    if (window.electronAPI && window.electronAPI.syncConfig) {
        window.electronAPI.syncConfig(config);
    }
}

// 多模态提供商默认 API 地址与标签
function mmProviderDefaults() {
    return {
        deepseek: { url: 'https://api.deepseek.com/v1/chat/completions', keyLabel: 'DeepSeek API Key', keyPlaceholder: '输入你的 DeepSeek API Key...' },
        zhipu: { url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', keyLabel: '智谱 API Key', keyPlaceholder: '输入你的智谱 API Key...' }
    };
}

// 与主进程 deepseekApiBase 语义一致：无论填入完整端点（.../chat/completions）还是 base 地址，
// 都返回可用的 chat/completions 完整端点，避免"上传能成功、对话/总结却失败"的地址不一致问题。
function toChatCompletionsUrl(raw) {
    const s = String(raw || '').trim();
    if (!s) return 'https://api.deepseek.com/v1/chat/completions';
    try {
        const u = new URL(s);
        if (/\/chat\/completions\/?$/.test(u.pathname)) return u.href;
        return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}/chat/completions`;
    } catch (e) {
        return s;
    }
}

// 当前提供商的聊天凭据（API 设置与多模态设置已合并，只用一家提供商）
function chatCredentials() {
    const p = config.multimodalProvider || 'deepseek';
    if (p === 'zhipu') {
        return { base: toChatCompletionsUrl(config.zhipuApiUrl), key: config.zhipuApiKey || '' };
    }
    return { base: toChatCompletionsUrl(config.apiUrl), key: config.apiKey || '' };
}

// 根据当前 AI 提供商刷新设置面板的 API Key / API 地址输入框与标签。
// API 设置与多模态设置已合并：无论聊天还是多模态，都只用一个提供商，
// 下面这几个控件（提供商下拉、API Key、API 地址）同时代表两者的共享配置。
function refreshMultimodalUI() {
    const $ = (id) => document.getElementById(id);
    const provider = config.multimodalProvider || 'deepseek';
    const sel = $('aiProviderSelect');
    if (sel) sel.value = provider;
    const def = mmProviderDefaults()[provider] || mmProviderDefaults().deepseek;
    const keyLbl = $('apiKeyLabel');
    const keyInput = $('apiKeyInput');
    const urlInput = $('apiUrlInput');
    const keyValue = provider === 'zhipu' ? (config.zhipuApiKey || '') : (config.apiKey || '');
    const urlValue = provider === 'zhipu'
        ? (config.zhipuApiUrl || def.url)
        : (config.apiUrl || def.url);
    if (keyLbl) keyLbl.textContent = def.keyLabel;
    if (keyInput) { keyInput.value = keyValue; keyInput.placeholder = def.keyPlaceholder; }
    if (urlInput) urlInput.value = urlValue;
}

// 仅刷新设置面板控件的显示值（不重新绑定事件/不重拉音色与贴图包），
// 用于配置被其它窗口改动后（config-updated）或启动拉取权威配置后同步展示
function refreshSettingsValues() {
    const $ = (id) => document.getElementById(id);
    const setVal = (id, val, labelId) => { const el = $(id); if (el) el.value = val; if (labelId) { const l = $(labelId); if (l) l.textContent = val; } };
    const setCheck = (id, val) => { const el = $(id); if (el) el.checked = !!val; };

    // 浮窗
    setVal('floatPetSizeSlider', config.floatPetSize || 80, 'floatPetSizeValue');
    const fms = $('floatMoveModeSelect'); if (fms) fms.value = config.floatMoveMode || 'free';
    setCheck('bounceWindowsToggle', config.bounceWindows !== false);
    setCheck('cookieSpawnToggle', config.cookieSpawnEnabled !== false);
    setVal('cookieSizeSlider', config.cookieSize || 40, 'cookieSizeValue');
    setCheck('floatShowIllustToggle', config.floatShowIllust !== false);
    // 贴图/按钮/窗口高度
    setVal('floatPetBottomOffsetSlider', config.floatPetBottomOffset || 0, 'floatPetBottomOffsetValue');
    setVal('floatBubbleOffsetSlider', config.floatBubbleOffset || 0, 'floatBubbleOffsetValue');
    setVal('floatWindowHeightPadSlider', config.floatWindowHeightPad || 0, 'floatWindowHeightPadValue');
    // AI
    const apiKey = $('apiKeyInput'); if (apiKey) apiKey.value = config.apiKey || '';
    const apiUrl = $('apiUrlInput'); if (apiUrl) apiUrl.value = config.apiUrl || 'https://api.deepseek.com/v1/chat/completions';
    // 多模态
    setCheck('multimodalToggle', config.multimodalEnabled);
    refreshMultimodalUI();
    // 人设 / 语音
    const aiPrompt = $('aiPromptInput'); if (aiPrompt) aiPrompt.value = config.aiPrompt || '';
    setVal('aiReplyLengthSlider', config.aiReplyLength || 0, 'aiReplyLengthValue');
    setCheck('voiceToggle', config.voiceEnabled !== false);
    const vol = $('volumeSlider');
    if (vol) { const pct = Math.round((config.voiceVolume != null ? config.voiceVolume : 1) * 100); vol.value = pct; const lbl = $('volumeValue'); if (lbl) lbl.textContent = pct + '%'; }
    const vs = $('voiceSelect'); if (vs && config.selectedVoice) vs.value = config.selectedVoice;
    // 记忆 / 启动 / 状态链
    setCheck('memoryToggle', config.enableMemory);
    setCheck('autoStartToggle', config.autoStart);
    // 状态链芯片选择器随配置同步刷新
    renderChainPicker();
    // 家里(主窗口)专属设置
    const winOp = $('windowOpacitySlider'); if (winOp) { const pct = Math.round((config.windowOpacity != null ? config.windowOpacity : 1) * 100); winOp.value = pct; const l = $('windowOpacityValue'); if (l) l.textContent = pct + '%'; }
    const wallOp = $('wallOpacitySlider'); if (wallOp) { const pct = Math.round((config.wallOpacity != null ? config.wallOpacity : 1) * 100); wallOp.value = pct; const l = $('wallOpacityValue'); if (l) l.textContent = pct + '%'; }
    const floorOp = $('floorOpacitySlider'); if (floorOp) { const pct = Math.round((config.floorOpacity != null ? config.floorOpacity : 1) * 100); floorOp.value = pct; const l = $('floorOpacityValue'); if (l) l.textContent = pct + '%'; }
    setCheck('portraitToggle', config.portraitAuto);
    setVal('mainPetSizeSlider', config.mainPetSize != null ? config.mainPetSize : 7.5, 'mainPetSizeValue');
    setVal('furnitureSizeSlider', config.furnitureSize != null ? config.furnitureSize : 3.8, 'furnitureSizeValue');
    setVal('buttonSizeSlider', config.buttonSize != null ? config.buttonSize : 40, 'buttonSizeValue');
    setVal('companionWidthSlider', config.companionWidth != null ? config.companionWidth : 400, 'companionWidthValue');

    renderChains();
    renderMemoryList();
}

// ===== 状态链（迁移自 electron-lite）=====
// 状态标签（用于设置面板显示）
const STATE_LABELS = {
    wandering: '游荡', eating: '吃饭', daydreaming: '发呆', working: '工作',
    angry: '生气', sleeping: '睡觉', craving: '嘴馋', eating_cookie: '吃饼干'
};
// 可入链/随机触发的状态集合：无任何预设，由 registerDynamicStates 依据当前贴图包现场注册。
// 当前包有哪些 浮窗_*.png 就注册哪些；加载完成前为空（桌宠以 pet.png 兜底显示）。
const KNOWN_STATES = [];

// ===== 状态特效目录（≥10 种差异化特效）=====
// 每种特效按「类型」分组，从而一个状态可组合多个不同类别的特效：
//   - loop    : transform 循环动作（上下拉伸/压扁/弹跳/漂浮/抖动/旋转/扭动/脉冲）。
//              所有 loop 都作用于同一张图的 transform，彼此互斥，一个状态只保留一个；
//   - overlay : 独立叠加标记（Zzz 泡泡），不占 transform，可与 loop 叠加；
//   - particle: 独立 DOM 粒子（爱心/星星/闪光/泡泡），互不干扰，可多选。
// 这样既满足「同一状态可叠加多个特效」，又避免多个缩放类动画互相冲突、看起来停不下来。
const EFFECT_CATALOG = {
    none:    { label: '无',        type: 'none' },
    stretch: { label: '上下拉伸',  type: 'loop',     class: 'fx-stretch' },
    squash:  { label: '压扁回弹',  type: 'loop',     class: 'fx-squash' },
    bounce:  { label: '弹跳',      type: 'loop',     class: 'fx-bounce' },
    floaty:  { label: '轻盈漂浮',  type: 'loop',     class: 'fx-float' },
    shake:   { label: '左右抖动',  type: 'loop',     class: 'fx-shake' },
    spin:    { label: '旋转',      type: 'loop',     class: 'fx-spin' },
    wiggle:  { label: '扭动舞蹈',  type: 'loop',     class: 'fx-wiggle' },
    pulse:   { label: '脉冲放大',  type: 'loop',     class: 'fx-pulse' },
    zzz:     { label: 'Zzz 泡泡',  type: 'overlay',  zzz: true },
    hearts:  { label: '爱心粒子',  type: 'particle', particles: 'heart' },
    stars:   { label: '星星粒子',  type: 'particle', particles: 'star' },
    sparkle: { label: '闪光粒子',  type: 'particle', particles: 'sparkle' },
    bubble:  { label: '泡泡粒子',  type: 'particle', particles: 'bubble' }
};
// 每个状态的缺省特效（可多选，值为 effect key 数组）。吃饭→拉伸，睡觉→Zzz，其余默认无。
const STATE_EFFECT_DEFAULTS = {
    eating: ['stretch'],
    eating_cookie: ['stretch'],
    sleeping: ['zzz']
};
// 某状态配置的特效 key 列表（兼容旧值：单个字符串 / 逗号分隔 → 归一为数组）
function getStateEffects(state) {
    const map = config.stateEffects || {};
    let v = map[state];
    // 缺省特效按语义键取（如原名 '睡觉' → sleeping 的 Zzz）；stateEffects 本身以原名保存
    if (v == null) v = STATE_EFFECT_DEFAULTS[semKey(state)];
    if (Array.isArray(v)) return v.filter(k => k && k !== 'none' && EFFECT_CATALOG[k]);
    if (typeof v === 'string' && v && v !== 'none') {
        return v.split(',').map(s => s.trim()).filter(k => EFFECT_CATALOG[k]);
    }
    return [];
}
// 取第一个 loop 特效 key（transform 动画互斥，一状态只保留一个）；无则 'none'
function getStateLoopKey(state) {
    return getStateEffects(state).find(k => EFFECT_CATALOG[k].type === 'loop') || 'none';
}

// ===== 状态切换概率（相对 / 绝对两种模式）=====
// 未单独配置时给出与旧逻辑一致的分档缺省值，保证默认体验不变。
function defaultStateProb(state) {
    const abs = (config.probabilityMode || 'relative') === 'absolute';
    const defs = {
        wandering: abs ? 35 : 20,
        eating: abs ? 15 : 10,
        daydreaming: abs ? 12 : 10,
        working: abs ? 12 : 10,
        angry: abs ? 8 : 5,
        sleeping: abs ? 15 : 10
    };
    // 缺省权重按语义键取：配置/注册都是贴图原名（如 '游荡'→wandering、'工作'→working）
    if (defs[semKey(state)] != null) return defs[semKey(state)];
    return abs ? 3 : 5; // 图包动态注册的新状态（陌生原名，无内置语义）
}
// 某状态的进入权重：显式配置为 0 表示"不出现"；未配置用缺省。
function stateProb(state) {
    const map = config.stateProbabilities || {};
    if (map[state] != null) return Math.max(0, map[state]);
    return defaultStateProb(state);
}
// 可入链/可配置的特效、概率、行为状态集合统一由 selectableStates() 提供
// （= KNOWN_STATES 去瞬态，KNOWN_STATES 由 registerDynamicStates 现场注册）
// 所有循环动画类特效的 CSS class（Zzz、粒子类由单独逻辑处理）
const CLS_STATE_FX = ['fx-stretch', 'fx-bounce', 'fx-shake', 'fx-spin', 'fx-wiggle', 'fx-pulse', 'fx-squash', 'fx-float'];

// 动态状态（浮窗_*.png / mood_*.png）资产表：主进程扫描后写入
let packAssets = { moods: [], states: [], moodFileMap: {}, stateFileMap: {} };
// 动态状态缺省持续时间（毫秒），有专属 STATE_DURATIONS 时优先使用专属值
const DYNAMIC_STATE_DURATION = 5000;

// 可用心情（动态）：只包含「确实有 mood_*.png 贴图文件」的心情名，
// 加载图包前依据 packAssets.moods 检测；检测不到则退回内置默认心情。
let moodList = Object.keys(moodEmojis);
function refreshMoodList() {
    if (packAssets && Array.isArray(packAssets.moods) && packAssets.moods.length) {
        moodList = packAssets.moods.slice();
    } else {
        moodList = Object.keys(moodEmojis);
    }
}

function getStateChains() {
    return (Array.isArray(config.stateChains) && config.stateChains.length) ? config.stateChains : [];
}
function isKnownState(s) {
    return !!s && KNOWN_STATES.includes(s);
}
// 状态语义层：注册 / 显示 / 配置 / AI 全部使用「贴图扫描原名」（如 游荡、工作、打鼓…），
// 运行时才需要识别内置语义（吃饼干/嘴馋的特殊流程、游荡兜底等）。
// semKey 把原名或英文 key 统一归一为内置英文语义键；陌生状态返回 null（走通用逻辑）。
function semKey(name) {
    const n = String(name == null ? '' : name);
    if (STATE_LABELS[n] !== undefined) return n;          // 已是英文语义键
    return STATE_LABEL_TO_KEY[n] !== undefined ? STATE_LABEL_TO_KEY[n] : null; // 中文原名 → 语义键
}
// 语义键 → 原名（用于 setPetState 传入已注册的贴图名；未知原样返回）
function semName(key) {
    return STATE_LABELS[key] !== undefined ? STATE_LABELS[key] : key;
}
// 状态链的打断后状态：优先用该链自带配置，否则回退全局 interruptState（向后兼容）
function chainInterruptName(chain) {
    const s = chain && chain.interruptState;
    return isKnownState(s) ? s : (isKnownState(config.interruptState) ? config.interruptState : semName('wandering'));
}
let activeChain = null; // { states:[...], index:0, interruptState }
// 状态链被打断：清空链，进入「这一条链」用户指定的打断后状态
function interruptChain() {
    const wasChain = !!activeChain;
    const interruptTo = chainInterruptName(activeChain);
    activeChain = null;
    if (wasChain && !isDragging && interruptTo !== petState) {
        // 避免覆盖已切换进去的吃饼干/嘴馋等盖状态
        if (semKey(petState) !== 'craving' && semKey(petState) !== 'eating_cookie') setPetState(interruptTo);
    }
}
// 状态链随机候选（可被随机切换选中，开启一段连续状态）
function pickStateChain() {
    const chains = getStateChains();
    const chain = chains.length ? chains[Math.floor(Math.random() * chains.length)] : null;
    const states = chain && Array.isArray(chain.states) && chain.states.length ? chain.states : null;
    return states ? { states: states.slice(), index: 0, interruptState: chain.interruptState } : null;
}
// label → 内置 key 反向映射（'游荡'→'wandering'、'工作'→'working'、'吃饭'→'eating' 等）。
// 现场注册的扫描名、AI <STATE:> 输出、历史保存的配置统一归一为内置 key，
// 避免"运行时用英文 key、UI/配置用中文名"双轨制造成的游荡识别失败与特效/概率错位。
const STATE_LABEL_TO_KEY = Object.fromEntries(Object.entries(STATE_LABELS).map(([k, v]) => [v, k]));
// 兼容迁移：历史上状态以英文语义键（'working'）或中文名（'工作'）保存过配置，
// 现统一约定为「贴图原名」（扫描名）。加载时把英文语义键平移到原名，避免配置错位。
function migrateLegacyStateKeys() {
    const mapKey = (k) => (STATE_LABELS[k] !== undefined ? STATE_LABELS[k] : k); // 'working'→'工作'
    const remap = (obj) => {
        if (!obj || typeof obj !== 'object') return false;
        let changed = false;
        Object.keys(obj).forEach(k => {
            const nk = mapKey(k);
            if (nk !== k && obj[nk] === undefined) { obj[nk] = obj[k]; delete obj[k]; changed = true; }
        });
        return changed;
    };
    let changed = remap(config.stateEffects) || remap(config.stateProbabilities);
    if (config.interruptState != null) {
        const ni = mapKey(config.interruptState);
        if (ni !== config.interruptState) { config.interruptState = ni; changed = true; }
    }
    if (Array.isArray(config.stateChains)) {
        config.stateChains.forEach(chain => {
            if (!chain) return;
            if (Array.isArray(chain.states)) chain.states = chain.states.map(mapKey);
            if (chain.interruptState) chain.interruptState = mapKey(chain.interruptState);
        });
        changed = true;
    }
    if (changed) saveConfig();
}
// 从主进程扫描到的 assets 里现场注册所有状态 —— 完全自动：
// 不预设任何"默认"状态集合、不做任何名字特判（嘴馋/吃饼干等瞬态也走同一条自动路径，
// 其特殊流程由运行时 semKey 识别：'嘴馋'→'craving'、'吃饼干'→'eating_cookie'）。
// 当前贴图包有哪些 浮窗_*.png，就现场注册哪些「原名」状态（含陌生贴图，如 浮窗_打鼓.png → '打鼓'），
// 没有对应贴图的状态一律不存在（不进入候选 / 提示词 / UI / 随机切换）。
function registerDynamicStates() {
    // 完全现场重建：清空全部状态与贴图映射（含此前任何静态预设键）
    KNOWN_STATES.length = 0;
    Object.keys(PET_IMGS).forEach(k => { delete PET_IMGS[k]; });
    // 历史英文/中文 key 配置统一平移到当前规则（原名），保证特效/概率/状态链一致
    migrateLegacyStateKeys();

    const fileMap = packAssets.stateFileMap || {};
    // 显示名去重，防重复注册（如同时存在 浮窗_工作.png 与 浮窗_working.png）
    const takenNames = new Set();
    (packAssets.states || []).forEach(name => {
        if (name === '饼干') return; // 饼干窗口专用贴图，不是桌宠状态
        if (takenNames.has(name)) return;
        takenNames.add(name);
        KNOWN_STATES.push(name); // 原名即状态（含陌生贴图与嘴馋/吃饼干等瞬态贴图）
        PET_IMGS[name] = () => imgPath('浮窗_' + name + '.png');
    });
    // 极端兜底：当前包连一张状态贴图都没有时，至少保留游荡作为基底状态，避免状态机空转
    if (KNOWN_STATES.length === 0 && !PET_IMGS[semName('wandering')]) {
        const wanderName = semName('wandering');
        KNOWN_STATES.push(wanderName);
        PET_IMGS[wanderName] = () => imgPath('浮窗_' + wanderName + '.png');
    }
}
// ===== 陌生状态自动注册：运行期周期性重扫贴图包 =====
// 启动与切包时由 loadPackAssets 全量注册；此后每 6s 轻量重扫一次（主进程 readdir 开销极小），
// 检测到新增 浮窗_*.png 时自动补注册，无需重启，并刷新设置面板 / 提示词候选。
let packAssetKey = null; // 当前已注册资产指纹（states+moods），变化才重建
function applyPackAssets(a) {
    if (!a || typeof a !== 'object') return;
    const key = JSON.stringify([a.states, a.moods]);
    if (packAssetKey === key) return; // 无变化：不重建，避免干扰
    const before = KNOWN_STATES.slice();
    packAssets = a;
    registerDynamicStates();
    refreshMoodList();
    const added = KNOWN_STATES.filter(s => !before.includes(s));
    if (added.length) {
        const msg = '[float:settings] auto-registered new states: ' + added.join(',');
        console.log('[float]', msg);
        if (window.electronAPI && window.electronAPI.logToMain) window.electronAPI.logToMain('info', msg);
    }
    if (isSettingsMode) {
        initCollapsibleGroups();
        renderChainPicker();
        renderStateConfig();
    }
    packAssetKey = key;
}
// 加载图包资产：注册动态状态 + 刷新心情 + 刷新设置面板
function loadPackAssets() {
    if (window.electronAPI && window.electronAPI.getPackAssets) {
        window.electronAPI.getPackAssets().then((a) => {
            packAssetKey = null; // 强制走一次 apply，确保首屏注册与指纹一致
            applyPackAssets(a);
        }).catch((e) => console.warn('[PackAssets] fetch failed:', e));
    }
}
// 运行期自动发现新增贴图（每个窗口各自维护注册表；桌宠窗口无 UI，只注册表+提示词更新）
setInterval(() => {
    if (window.electronAPI && window.electronAPI.getPackAssets) {
        window.electronAPI.getPackAssets().then(applyPackAssets).catch(() => {});
    }
}, 6000);

// ===== 设置面板（float.html?mode=settings 独立窗口）=====
function initSettingsPanel() {
    const $ = (id) => document.getElementById(id);
    const on = (node, evt, fn) => { if (node) node.addEventListener(evt, fn); };

    const floatPetSizeSlider = $('floatPetSizeSlider');
    const floatPetSizeValue = $('floatPetSizeValue');
    const floatMoveModeSelect = $('floatMoveModeSelect');
    const bounceWindowsToggle = $('bounceWindowsToggle');
    const cookieSpawnToggle = $('cookieSpawnToggle');
    const cookieSizeSlider = $('cookieSizeSlider');
    const cookieSizeValue = $('cookieSizeValue');
    const floatShowIllustToggle = $('floatShowIllustToggle');
    const floatPetBottomOffsetSlider = $('floatPetBottomOffsetSlider');
    const floatPetBottomOffsetValue = $('floatPetBottomOffsetValue');
    const floatBubbleOffsetSlider = $('floatBubbleOffsetSlider');
    const floatBubbleOffsetValue = $('floatBubbleOffsetValue');
    const floatWindowHeightPadSlider = $('floatWindowHeightPadSlider');
    const floatWindowHeightPadValue = $('floatWindowHeightPadValue');
    const apiKeyInput = $('apiKeyInput');
    const apiUrlInput = $('apiUrlInput');
    const testApiBtn = $('testApiBtn');
    const apiTestResult = $('apiTestResult');
    const multimodalToggle = $('multimodalToggle');
    const aiProviderSelect = $('aiProviderSelect');
    const aiPromptInput = $('aiPromptInput');
    const aiReplyLengthSlider = $('aiReplyLengthSlider');
    const aiReplyLengthValue = $('aiReplyLengthValue');
    const voiceToggle = $('voiceToggle');
    const voiceSelect = $('voiceSelect');
    const volumeSlider = $('volumeSlider');
    const volumeValue = $('volumeValue');
    const testTtsBtn = $('testTtsBtn');
    const memoryToggle = $('memoryToggle');
    const memoryList = $('memoryList');
    const memoryInput = $('memoryInput');
    const addMemBtn = $('addMemBtn');
    const memCount = $('memCount');
    const memorySearch = $('memorySearch');
    const memoryGroupTitle = $('memoryGroupTitle');
    const autoStartToggle = $('autoStartToggle');
    const settingsCloseBtn = $('settingsCloseBtn');
    const openIndexBtn = $('openIndexBtn');
    const quitAppBtn = $('quitAppBtn');
    const chainAddBtn = $('chainAddBtn');
    const chainClearBtn = $('chainClearBtn');
    const chainPicker = $('chainPicker');
    const chainPreview = $('chainPreview');
    const chainInterruptSelect = $('chainInterruptSelect');
    // 家里(主窗口)专属设置控件
    const windowOpacitySlider = $('windowOpacitySlider');
    const windowOpacityValue = $('windowOpacityValue');
    const wallOpacitySlider = $('wallOpacitySlider');
    const wallOpacityValue = $('wallOpacityValue');
    const floorOpacitySlider = $('floorOpacitySlider');
    const floorOpacityValue = $('floorOpacityValue');
    const portraitToggle = $('portraitToggle');
    const mainPetSizeSlider = $('mainPetSizeSlider');
    const mainPetSizeValue = $('mainPetSizeValue');
    const furnitureSizeSlider = $('furnitureSizeSlider');
    const furnitureSizeValue = $('furnitureSizeValue');
    const buttonSizeSlider = $('buttonSizeSlider');
    const buttonSizeValue = $('buttonSizeValue');
    const companionWidthSlider = $('companionWidthSlider');
    const companionWidthValue = $('companionWidthValue');

    // 同步家里专属设置到主进程并广播（让主窗口实时生效）
    function syncHomeSettings() {
        if (window.electronAPI && window.electronAPI.send) {
            window.electronAPI.send('sync-home-settings', {
                windowOpacity: config.windowOpacity,
                wallOpacity: config.wallOpacity,
                floorOpacity: config.floorOpacity,
                mainPetSize: config.mainPetSize,
                furnitureSize: config.furnitureSize,
                buttonSize: config.buttonSize,
                portraitAuto: config.portraitAuto,
                companionWidth: config.companionWidth
            });
        }
    }

    // 回填当前值
    if (floatPetSizeSlider) {
        floatPetSizeSlider.value = config.floatPetSize || 80;
        if (floatPetSizeValue) floatPetSizeValue.textContent = floatPetSizeSlider.value;
    }
    if (floatMoveModeSelect) floatMoveModeSelect.value = config.floatMoveMode || 'free';
    if (bounceWindowsToggle) bounceWindowsToggle.checked = config.bounceWindows !== false;
    if (cookieSpawnToggle) cookieSpawnToggle.checked = config.cookieSpawnEnabled !== false;
    if (cookieSizeSlider) {
        cookieSizeSlider.value = config.cookieSize || 40;
        if (cookieSizeValue) cookieSizeValue.textContent = cookieSizeSlider.value;
    }
    if (floatShowIllustToggle) floatShowIllustToggle.checked = config.floatShowIllust !== false;
    if (apiKeyInput) apiKeyInput.value = config.apiKey || '';
    if (apiUrlInput) apiUrlInput.value = config.apiUrl || 'https://api.deepseek.com/v1/chat/completions';
    if (multimodalToggle) multimodalToggle.checked = !!config.multimodalEnabled;
    if (aiProviderSelect) aiProviderSelect.value = config.multimodalProvider || 'deepseek';
    refreshMultimodalUI();
    if (aiPromptInput) aiPromptInput.value = config.aiPrompt || '';
    if (voiceToggle) voiceToggle.checked = config.voiceEnabled !== false;
    if (volumeSlider) {
        volumeSlider.value = Math.round((config.voiceVolume != null ? config.voiceVolume : 1.0) * 100);
        if (volumeValue) volumeValue.textContent = volumeSlider.value + '%';
    }
    if (memoryToggle) memoryToggle.checked = !!config.enableMemory;
    if (autoStartToggle) autoStartToggle.checked = !!config.autoStart;
    // 记忆模块默认折叠由 initCollapsibleGroups() 统一管理（data-collapsed="1"）

    // 回填家里(主窗口)专属设置
    if (windowOpacitySlider) {
        windowOpacitySlider.value = Math.round((config.windowOpacity != null ? config.windowOpacity : 1) * 100);
        if (windowOpacityValue) windowOpacityValue.textContent = windowOpacitySlider.value + '%';
    }
    if (wallOpacitySlider) {
        wallOpacitySlider.value = Math.round((config.wallOpacity != null ? config.wallOpacity : 1) * 100);
        if (wallOpacityValue) wallOpacityValue.textContent = wallOpacitySlider.value + '%';
    }
    if (floorOpacitySlider) {
        floorOpacitySlider.value = Math.round((config.floorOpacity != null ? config.floorOpacity : 1) * 100);
        if (floorOpacityValue) floorOpacityValue.textContent = floorOpacitySlider.value + '%';
    }
    if (portraitToggle) portraitToggle.checked = !!config.portraitAuto;
    if (mainPetSizeSlider) {
        mainPetSizeSlider.value = config.mainPetSize != null ? config.mainPetSize : 7.5;
        if (mainPetSizeValue) mainPetSizeValue.textContent = mainPetSizeSlider.value;
    }
    if (furnitureSizeSlider) {
        furnitureSizeSlider.value = config.furnitureSize != null ? config.furnitureSize : 3.8;
        if (furnitureSizeValue) furnitureSizeValue.textContent = furnitureSizeSlider.value;
    }
    if (buttonSizeSlider) {
        buttonSizeSlider.value = config.buttonSize != null ? config.buttonSize : 40;
        if (buttonSizeValue) buttonSizeValue.textContent = buttonSizeSlider.value;
    }
    if (companionWidthSlider) {
        companionWidthSlider.value = config.companionWidth != null ? config.companionWidth : 400;
        if (companionWidthValue) companionWidthValue.textContent = companionWidthSlider.value;
    }

    // 语音音色列表
    if (voiceSelect) {
        voiceSelect.innerHTML = '<option value="default">🔄 自动选择（推荐）</option>';
        if (window.electronAPI && window.electronAPI.getTtsVoices) {
            window.electronAPI.getTtsVoices().then(voices => {
                (voices || []).forEach(v => {
                    const opt = document.createElement('option');
                    opt.value = typeof v === 'object' ? v.id : v;
                    opt.textContent = typeof v === 'object' ? (v.id + ' · ' + v.desc) : v;
                    if (opt.value === config.selectedVoice) opt.selected = true;
                    voiceSelect.appendChild(opt);
                });
            }).catch(err => console.warn('[Settings] load voice failed:', err));
        }
        voiceSelect.value = config.selectedVoice || 'default';
    }

    // 贴图包列表（展示每个包内 pet 贴图预览）
    if (window.electronAPI && window.electronAPI.listStickerPacks) {
        window.electronAPI.listStickerPacks().then(packs => {
            const list = $('stickerPackList');
            if (!list || !Array.isArray(packs)) return;
            list.innerHTML = '';
            packs.forEach(pack => {
                const item = document.createElement('div');
                item.className = 'spk-item' + (pack.name === config.stickerPack ? ' selected' : '');
                item.dataset.name = pack.name;
                const preview = document.createElement('img');
                preview.className = 'spk-preview';
                preview.src = pack.preview || '';
                preview.alt = pack.name;
                preview.onerror = () => { preview.style.display = 'none'; };
                const label = document.createElement('span');
                label.className = 'spk-name';
                label.textContent = pack.name;
                item.appendChild(preview);
                item.appendChild(label);
                item.addEventListener('click', () => {
                    config.stickerPack = pack.name;
                    saveConfig();
                    document.querySelectorAll('.spk-item').forEach(el => el.classList.remove('selected'));
                    item.classList.add('selected');
                    if (window.electronAPI && window.electronAPI.setStickerPack) {
                        window.electronAPI.setStickerPack(pack.name);
                    }
                    // 重新扫描该图包的 mood_*/浮窗_* 贴图，动态刷新可心情/状态
                    loadPackAssets();
                });
                list.appendChild(item);
            });
        }).catch(err => console.warn('[Settings] load pack failed:', err));
    }

    // 事件绑定
    on(floatPetSizeSlider, 'input', () => {
        config.floatPetSize = Number(floatPetSizeSlider.value);
        if (floatPetSizeValue) floatPetSizeValue.textContent = floatPetSizeSlider.value;
        saveConfig();
        if (window.electronAPI && window.electronAPI.setFloatPetSize) window.electronAPI.setFloatPetSize(config.floatPetSize);
    });
    on(floatMoveModeSelect, 'change', () => {
        config.floatMoveMode = floatMoveModeSelect.value;
        saveConfig();
        if (window.electronAPI && window.electronAPI.setFloatMoveMode) window.electronAPI.setFloatMoveMode(config.floatMoveMode);
    });
    on(bounceWindowsToggle, 'change', () => {
        config.bounceWindows = bounceWindowsToggle.checked;
        saveConfig();
        if (window.electronAPI && window.electronAPI.setFloatBounceWindows) window.electronAPI.setFloatBounceWindows(config.bounceWindows);
    });
    on(cookieSpawnToggle, 'change', () => {
        config.cookieSpawnEnabled = cookieSpawnToggle.checked;
        saveConfig();
        if (window.electronAPI && window.electronAPI.setCookieSpawnEnabled) window.electronAPI.setCookieSpawnEnabled(config.cookieSpawnEnabled);
    });
    on(cookieSizeSlider, 'input', () => {
        config.cookieSize = Number(cookieSizeSlider.value);
        if (cookieSizeValue) cookieSizeValue.textContent = cookieSizeSlider.value;
        saveConfig();
        if (window.electronAPI && window.electronAPI.setCookieSize) window.electronAPI.setCookieSize(config.cookieSize);
    });
    on(floatShowIllustToggle, 'change', () => {
        config.floatShowIllust = floatShowIllustToggle.checked;
        saveConfig();
        if (window.electronAPI && window.electronAPI.setFloatShowIllust) window.electronAPI.setFloatShowIllust(config.floatShowIllust);
    });
    on(floatPetBottomOffsetSlider, 'input', () => {
        const v = Number(floatPetBottomOffsetSlider.value);
        config.floatPetBottomOffset = v;
        if (floatPetBottomOffsetValue) floatPetBottomOffsetValue.textContent = v;
        saveConfig();
        floatPetBottomOffset = v;
        if (typeof updateWindowSize === 'function') updateWindowSize();
    });
    on(floatBubbleOffsetSlider, 'input', () => {
        const v = Number(floatBubbleOffsetSlider.value);
        config.floatBubbleOffset = v;
        if (floatBubbleOffsetValue) floatBubbleOffsetValue.textContent = v;
        saveConfig();
        floatBubbleOffset = v;
        document.documentElement.style.setProperty('--float-bubble-offset', v + 'px');
        if (typeof updateWindowSize === 'function') updateWindowSize();
    });
    on(floatWindowHeightPadSlider, 'input', () => {
        const v = Number(floatWindowHeightPadSlider.value);
        config.floatWindowHeightPad = v;
        if (floatWindowHeightPadValue) floatWindowHeightPadValue.textContent = v;
        saveConfig();
        floatWindowHeightPad = v;
        if (typeof updateWindowSize === 'function') updateWindowSize();
    });
    // ===== AI 设置：提供商（DeepSeek / 智谱）决定了 API Key 与 API 地址输入框显示的内容，
    // 同一套配置同时服务聊天与多模态，实现"API 设置与多模态设置合并，只用 one 提供商"=====
    on(multimodalToggle, 'change', () => {
        config.multimodalEnabled = multimodalToggle.checked;
        // 开启多模态时，若当前提供商 API 地址为空，则自动填入默认地址
        if (config.multimodalEnabled) {
            const def = mmProviderDefaults()[config.multimodalProvider || 'deepseek'];
            if (def) {
                if (config.multimodalProvider === 'zhipu') {
                    if (!config.zhipuApiUrl) config.zhipuApiUrl = def.url;
                } else {
                    if (!config.apiUrl) config.apiUrl = def.url;
                }
                refreshMultimodalUI();
            }
        }
        saveConfig();
        if (window.electronAPI && window.electronAPI.setMultimodalEnabled) window.electronAPI.setMultimodalEnabled(config.multimodalEnabled);
    });
    on(aiProviderSelect, 'change', () => {
        config.multimodalProvider = aiProviderSelect.value;
        // 切换提供商时自动填入对应默认 API 地址（用户仍可手动修改）
        const def = mmProviderDefaults()[config.multimodalProvider];
        if (def) {
            if (config.multimodalProvider === 'zhipu') {
                if (!config.zhipuApiUrl) config.zhipuApiUrl = def.url;
            } else {
                if (!config.apiUrl) config.apiUrl = def.url;
            }
        }
        refreshMultimodalUI();
        saveConfig();
    });
    // AI 回复最大字数（0 表示不限制）
    on(aiReplyLengthSlider, 'input', () => {
        const v = Number(aiReplyLengthSlider.value);
        config.aiReplyLength = v;
        if (aiReplyLengthValue) aiReplyLengthValue.textContent = v;
        saveConfig();
    });
    // 下方输入框始终写入"当前提供商"对应的凭据字段
    on(apiKeyInput, 'change', () => {
        const v = apiKeyInput.value.trim();
        if (config.multimodalProvider === 'zhipu') {
            config.zhipuApiKey = v;
            if (window.electronAPI && window.electronAPI.setZhipuKey) window.electronAPI.setZhipuKey(v);
        } else {
            config.apiKey = v;
        }
        saveConfig();
    });
    on(apiUrlInput, 'change', () => {
        const v = apiUrlInput.value.trim();
        if (config.multimodalProvider === 'zhipu') {
            config.zhipuApiUrl = v || mmProviderDefaults().zhipu.url;
        } else {
            config.apiUrl = v || mmProviderDefaults().deepseek.url;
        }
        saveConfig();
    });
    on(aiPromptInput, 'change', () => {
        config.aiPrompt = aiPromptInput.value;
        saveConfig();
        if (window.electronAPI && window.electronAPI.send) window.electronAPI.send('set-ai-prompt', config.aiPrompt);
    });
    on(voiceToggle, 'change', () => {
        config.voiceEnabled = voiceToggle.checked;
        saveConfig();
        if (window.electronAPI && window.electronAPI.send) window.electronAPI.send('set-voice-enabled', config.voiceEnabled);
    });
    on(voiceSelect, 'change', () => {
        config.selectedVoice = voiceSelect.value;
        saveConfig();
        if (window.electronAPI && window.electronAPI.send) window.electronAPI.send('set-selected-voice', config.selectedVoice);
    });
    on(volumeSlider, 'input', () => {
        config.voiceVolume = Number(volumeSlider.value) / 100;
        if (volumeValue) volumeValue.textContent = volumeSlider.value + '%';
        saveConfig();
        if (window.electronAPI && window.electronAPI.send) window.electronAPI.send('set-voice-volume', config.voiceVolume);
    });
    on(testTtsBtn, 'click', () => {
        const savedEnabled = config.voiceEnabled;
        config.voiceEnabled = true; // 测试时忽略开关
        speakText('你好，我是你的桌宠，你觉得这个声音怎么样？');
        config.voiceEnabled = savedEnabled;
    });
    // ===== 测试 API 连接：用当前表单里的 Key/地址调用主进程验证 =====
    on(testApiBtn, 'click', async () => {
        if (!apiTestResult) return;
        const provider = (aiProviderSelect && aiProviderSelect.value) || config.multimodalProvider || 'deepseek';
        const url = (apiUrlInput && apiUrlInput.value.trim()) || '';
        const key = (apiKeyInput && apiKeyInput.value.trim()) || '';
        apiTestResult.style.display = 'block';
        apiTestResult.style.color = '#888';
        apiTestResult.textContent = '测试中，请稍候...';
        testApiBtn.disabled = true;
        try {
            const res = await window.electronAPI.testApi({ provider: provider, apiKey: key, apiUrl: url });
            const ok = !!(res && res.ok);
            apiTestResult.style.color = ok ? '#2e9e5b' : '#e05b5b';
            apiTestResult.textContent =
                (ok ? '✅ ' : '❌ ') +
                ((res && res.message) || '未知结果') +
                (res && res.latencyMs != null ? `（耗时 ${res.latencyMs}ms）` : '') +
                (res && res.model ? `\n模型：${res.model}` : '');
        } catch (e) {
            apiTestResult.style.color = '#e05b5b';
            apiTestResult.textContent = '❌ 测试失败：' + (e && e.message ? e.message : e);
        } finally {
            testApiBtn.disabled = false;
        }
    });
    on(memoryToggle, 'change', () => {
        config.enableMemory = memoryToggle.checked;
        saveConfig();
    });
    on(addMemBtn, 'click', () => {
        const text = (memoryInput ? memoryInput.value : '').trim();
        if (!text) return;
        addMemoryItem(text).then(() => {
            if (memoryInput) memoryInput.value = '';
        }).catch(err => console.warn('[Settings] add memory failed:', err));
    });
    // Electron 不支持 window.prompt()，用自绘模态框让用户填写图片记忆描述
    // 返回 Promise<string|null>：有内容返回描述；取消/为空返回 null
    const askMemoryDescription = () => {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;';
            const box = document.createElement('div');
            box.style.cssText = 'background:#fff;border-radius:10px;padding:16px;width:280px;box-shadow:0 6px 24px rgba(0,0,0,0.25);font-family:sans-serif;';
            box.innerHTML =
                '<div style="font-size:13px;color:#333;margin-bottom:10px;">请输入这张图片的记忆描述（必填）：</div>' +
                '<input type="text" id="memDescInput" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #ccc;border-radius:6px;font-size:13px;" placeholder="例如：用户的宠物照片" />' +
                '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px;">' +
                '<button data-act="cancel" style="padding:5px 12px;border:1px solid #ccc;background:#f5f5f5;border-radius:6px;cursor:pointer;font-size:12px;">取消</button>' +
                '<button data-act="ok" style="padding:5px 12px;border:none;background:#d2691e;color:#fff;border-radius:6px;cursor:pointer;font-size:12px;">确定</button>' +
                '</div>';
            overlay.appendChild(box);
            document.body.appendChild(overlay);
            const input = box.querySelector('#memDescInput');
            const finish = (val) => { overlay.remove(); resolve(val); };
            box.querySelector('[data-act="ok"]').addEventListener('click', () => {
                const v = (input.value || '').trim();
                finish(v || null);
            });
            box.querySelector('[data-act="cancel"]').addEventListener('click', () => finish(null));
            overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(null); });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { const v = (input.value || '').trim(); finish(v || null); }
                else if (e.key === 'Escape') finish(null);
            });
            input.focus();
        });
    };
    // 添加图片记忆：选择本地图片 -> 自动上传 Files API 获取 file_id -> 保存为图像记忆。
    // 记忆输入框中若已填文字则作为描述，否则弹出模态框强制填写（取消则中止上传）。删除图像记忆时 deleteMemoryItemAt 会同步 DELETE /files/{file_id}
    const addImageMemBtn = document.getElementById('addImageMemBtn');
    if (addImageMemBtn) {
        addImageMemBtn.addEventListener('click', async () => {
            if (!window.electronAPI || !window.electronAPI.uploadMemoryImage) return;
            // 必须提供图片描述：优先取输入框内容，否则弹出模态框强制填写（取消则中止上传）
            let desc = (memoryInput ? memoryInput.value : '').trim();
            if (!desc) {
                desc = await askMemoryDescription();
                if (!desc) {
                    if (filesListResult) {
                        filesListResult.style.display = 'block';
                        filesListResult.style.color = '#e05b5b';
                        filesListResult.textContent = '❌ 未填写描述，已取消添加图片记忆';
                    }
                    return;
                }
            }
            addImageMemBtn.disabled = true;
            addImageMemBtn.textContent = '⏳ 上传中...';
            try {
                const res = await window.electronAPI.uploadMemoryImage();
                if (!res || res.canceled) return;
                memoryItems.push({
                    type: 'image',
                    fileId: res.fileId,
                    imagePath: res.imagePath,
                    imageUrl: res.imageUrl,
                    description: desc,
                    time: Date.now()
                });
                if (window.electronAPI && window.electronAPI.memorySave) {
                    await window.electronAPI.memorySave(memoryItems);
                }
                if (memoryInput) memoryInput.value = '';
                renderMemoryList();
                if (filesListResult) {
                    filesListResult.style.display = 'block';
                    filesListResult.style.color = '#2e7d32';
                    filesListResult.textContent = '✅ 图像记忆已添加，file_id: ' + res.fileId;
                }
                if (window.electronAPI && window.electronAPI.logToMain) {
                    window.electronAPI.logToMain('info', '[float:memory] image memory added fileId=' + res.fileId);
                }
            } catch (e) {
                console.error('[Settings] add image memory failed:', e);
                if (filesListResult) {
                    filesListResult.style.display = 'block';
                    filesListResult.style.color = '#e05b5b';
                    filesListResult.textContent = '❌ 添加图像记忆失败：' + (e && e.message ? e.message : e);
                }
                if (window.electronAPI && window.electronAPI.logToMain) {
                    window.electronAPI.logToMain('error', '[float:memory] add image memory failed: ' + (e && e.message));
                }
            } finally {
                addImageMemBtn.disabled = false;
                addImageMemBtn.textContent = '🖼 图片记忆';
            }
        });
    }
    // 记忆模块：折叠/展开已由 initCollapsibleGroups() 统一处理（点击标题即可）
    // 记忆搜索：按关键字过滤
    on(memorySearch, 'input', (e) => {
        memorySearchKeyword = (e.target.value || '').toLowerCase().trim();
        memoryPage = 1; // 切换过滤条件时回到第一页
        renderMemoryList();
    });
    // 记忆显示过滤：图片 / 文本 两个开关按钮，独立控制是否显示对应类型
    (document.querySelectorAll('.mem-mode-btn') || []).forEach(btn => {
        const type = btn.getAttribute('data-type'); // 'img' | 'text'
        const syncActive = () => btn.classList.toggle('active', type === 'img' ? memoryShowImg : memoryShowText);
        syncActive();
        btn.addEventListener('click', () => {
            if (type === 'img') memoryShowImg = !memoryShowImg;
            else memoryShowText = !memoryShowText;
            syncActive();
            renderMemoryList();
        });
    });
    // 查询当前账号在 Files API 上所有图片 file_id（GET /files）
    const listFilesBtn = document.getElementById('listFilesBtn');
    const filesListResult = document.getElementById('filesListResult');
    if (listFilesBtn) {
        listFilesBtn.addEventListener('click', async () => {
            if (!window.electronAPI || !window.electronAPI.listDeepSeekFiles) {
                if (filesListResult) {
                    filesListResult.style.display = 'block';
                    filesListResult.textContent = '当前环境不支持查询（非 Electron）';
                }
                return;
            }
            if (filesListResult) filesListResult.textContent = '查询中...';
            if (filesListResult) filesListResult.style.display = 'block';
            try {
                const res = await window.electronAPI.listDeepSeekFiles();
                if (res && res.success) {
                    const ids = Array.isArray(res.ids) ? res.ids : [];
                    filesListResult.textContent = ids.length
                        ? `共 ${ids.length} 个文件：\n` + ids.map((id, idx) => `${idx + 1}. ${id}`).join('\n')
                        : '当前账号下没有文件。';
                    // 查询结果显示后，追加"删除未保存为记忆的图片"按钮：
                    // 与当前记忆列表比对，删除 Files API 上未关联任何记忆的 file_id
                    if (window.electronAPI && window.electronAPI.deleteDeepSeekFile && ids.length > 0) {
                        const delBtn = document.createElement('button');
                        delBtn.className = 'sb-btn';
                        delBtn.style.cssText = 'width:auto;padding:5px 12px;margin:8px 0 2px;background:#fff1f1;border-color:#ff9d9d;color:#d33;font-size:11px;';
                        delBtn.textContent = '🗑 删除未保存为记忆的图片';
                        delBtn.addEventListener('click', async () => {
                            const memoryFileIds = new Set(memoryItems.map(m => m && m.fileId).filter(Boolean));
                            const orphans = ids.filter(id => !memoryFileIds.has(id));
                            if (orphans.length === 0) {
                                filesListResult.textContent = '✅ 没有需要清理的图片，Files API 上所有文件都已关联记忆。';
                                delBtn.parentNode && delBtn.parentNode.removeChild(delBtn);
                                return;
                            }
                            const okOk = window.confirm(`将从 Files API 删除 ${orphans.length} 张未保存为记忆的图片，确定要清理吗？\n\n（提示：包含正在对话中、尚未完成记忆总结的截图，删除后不可恢复）`);
                            if (!okOk) return;
                            let ok = 0, fail = 0, idx = 0;
                            const progress = [];
                            for (const id of orphans) {
                                idx++;
                                try {
                                    await window.electronAPI.deleteDeepSeekFile(id);
                                    ok++;
                                    progress.push(`第 ${idx}/${orphans.length} 删除成功：${id}`);
                                } catch (e) {
                                    fail++;
                                    console.warn('[Settings] delete orphan file failed:', id, e);
                                    progress.push(`第 ${idx}/${orphans.length} 删除失败：${id}`);
                                }
                            }
                            filesListResult.textContent = `清理完成：成功 ${ok} 张，失败 ${fail} 张。\n` + progress.join('\n');
                            delBtn.parentNode && delBtn.parentNode.removeChild(delBtn);
                            if (window.electronAPI && window.electronAPI.logToMain) window.electronAPI.logToMain('info', '[float:memory] delete orphans done ok=' + ok + ' fail=' + fail);
                        });
                        filesListResult.appendChild(delBtn);
                    }
                } else {
                    filesListResult.textContent = '查询失败：' + ((res && res.message) || '未知错误');
                }
            } catch (e) {
                filesListResult.textContent = '查询失败：' + e.message;
            }
        });
    }
    // 状态链：按钮芯片构建序列 + 每一条链独立打断状态
    on(chainAddBtn, 'click', chainAddFromPicker);
    on(chainClearBtn, 'click', () => {
        currentChain = [];
        updateChainPreview();
        renderChainPicker();
    });
    // 状态切换概率模式：相对 / 绝对，切换后重绘数值提示与单位
    on($('probModeSelect'), 'change', (e) => {
        config.probabilityMode = e.target.value;
        saveConfig();
        renderStateConfig();
    });
    // 添加贴图包：打开 img 文件夹
    on($('addStickerPackBtn'), 'click', () => {
        if (window.electronAPI && window.electronAPI.openStickerFolder) {
            window.electronAPI.openStickerFolder();
        } else {
            window.open('img');
        }
    });
    on(autoStartToggle, 'change', () => {
        config.autoStart = autoStartToggle.checked;
        saveConfig();
        if (window.electronAPI && window.electronAPI.setLoginItem) {
            window.electronAPI.setLoginItem(config.autoStart);
        }
    });
    on(settingsCloseBtn, 'click', () => {
        if (window.electronAPI && window.electronAPI.closeSettings) window.electronAPI.closeSettings();
        else window.close();
    });
    on(openIndexBtn, 'click', () => {
        // 在家按钮：唤起主窗口 index.html
        if (window.electronAPI && window.electronAPI.showIndexWindow) {
            window.electronAPI.showIndexWindow();
        }
    });
    on(quitAppBtn, 'click', () => {
        if (window.electronAPI && window.electronAPI.quitApp) {
            window.electronAPI.quitApp();
        }
    });

    // 家里(主窗口)专属设置：改动即保存并同步到主进程，主窗口实时生效
    on(windowOpacitySlider, 'input', () => {
        config.windowOpacity = Number(windowOpacitySlider.value) / 100;
        if (windowOpacityValue) windowOpacityValue.textContent = windowOpacitySlider.value + '%';
        saveConfig(); syncHomeSettings();
    });
    on(wallOpacitySlider, 'input', () => {
        config.wallOpacity = Number(wallOpacitySlider.value) / 100;
        if (wallOpacityValue) wallOpacityValue.textContent = wallOpacitySlider.value + '%';
        saveConfig(); syncHomeSettings();
    });
    on(floorOpacitySlider, 'input', () => {
        config.floorOpacity = Number(floorOpacitySlider.value) / 100;
        if (floorOpacityValue) floorOpacityValue.textContent = floorOpacitySlider.value + '%';
        saveConfig(); syncHomeSettings();
    });
    on(portraitToggle, 'change', () => {
        config.portraitAuto = portraitToggle.checked;
        saveConfig(); syncHomeSettings();
    });
    on(mainPetSizeSlider, 'input', () => {
        config.mainPetSize = Number(mainPetSizeSlider.value);
        if (mainPetSizeValue) mainPetSizeValue.textContent = mainPetSizeSlider.value;
        saveConfig(); syncHomeSettings();
    });
    on(furnitureSizeSlider, 'input', () => {
        config.furnitureSize = Number(furnitureSizeSlider.value);
        if (furnitureSizeValue) furnitureSizeValue.textContent = furnitureSizeSlider.value;
        saveConfig(); syncHomeSettings();
    });
    on(buttonSizeSlider, 'input', () => {
        config.buttonSize = Number(buttonSizeSlider.value);
        if (buttonSizeValue) buttonSizeValue.textContent = buttonSizeSlider.value;
        saveConfig(); syncHomeSettings();
    });
    renderChains();
    renderMemoryList();
    renderChainPicker();
    renderStateConfig();
    loadPackAssets();
}

// ===== 状态链设置：列出 / 添加 / 删除 =====
function renderChains() {
    const box = document.getElementById('chainList');
    if (!box) return;
    box.innerHTML = '';
    const chains = getStateChains();
    chains.forEach((chain, i) => {
        const states = Array.isArray(chain.states) ? chain.states : [];
        const div = document.createElement('div');
        div.className = 'chain-item';
        const text = states.length ? states.map(stateLabel).join(' → ') : '（空）';
        const interrupt = stateLabel(chainInterruptName(chain));
        div.innerHTML = `<span style="flex:1">${text}<br><small style="color:#888;">打断后进入：${interrupt}</small></span><button class="chain-del" data-i="${i}" title="删除该状态链">删</button>`;
        box.appendChild(div);
    });
    box.querySelectorAll('.chain-del').forEach(b => {
        b.onclick = () => {
            const i = Number(b.dataset.i);
            config.stateChains = getStateChains().filter((_, idx) => idx !== i);
            saveConfig(); renderChains();
        };
    });
}

// ===== 状态链构建器（按钮芯片）=====
// 状态标签：贴图原名即显示名（陌生浮窗_xx 贴图原名直显；内置状态也是中文原名）
function stateLabel(s) { return s; }
// 可入链/可配置/可被 AI 切换的状态：KNOWN_STATES 全部现场注册的原名（含嘴馋/吃饼干）。
// 随机切换的候选则在 randomStateTransition 里单独用 semKey 排除瞬态，避免干扰饼干驱动流程。
function selectableStates() {
    return KNOWN_STATES.slice();
}
// 渲染芯片选择器与打断状态下拉
function renderChainPicker() {
    const picker = document.getElementById('chainPicker');
    const interruptSelect = document.getElementById('chainInterruptSelect');
    const states = selectableStates();
    if (picker) {
        picker.innerHTML = '';
        states.forEach(s => {
            const chip = document.createElement('div');
            chip.className = 'chain-chip';
            chip.textContent = stateLabel(s);
            // 点击即"追加"到序列尾部（允许同一个行为出现多次），而非切换选中/移除
            chip.addEventListener('click', () => {
                currentChain.push(s);
                updateChainPreview();
            });
            picker.appendChild(chip);
        });
    }
    if (interruptSelect) {
        interruptSelect.innerHTML = states.map(s => `<option value="${s}">${stateLabel(s)}</option>`).join('');
        if (states.length) interruptSelect.value = config.interruptState && states.includes(config.interruptState) ? config.interruptState : states[0];
    }
}
function updateChainPreview() {
    const el = document.getElementById('chainPreview');
    if (!el) return;
    el.innerHTML = '';
    const label = document.createElement('span');
    label.textContent = currentChain.length ? '当前序列：' : '当前序列：空';
    label.style.marginRight = '6px';
    el.appendChild(label);
    // 每一项单独显示，带 ✕ 按钮可删除该次出现（支持同一行为多次）
    currentChain.forEach((s, i) => {
        const chip = document.createElement('span');
        chip.className = 'chain-chip';
        chip.style.cursor = 'default';
        const txt = document.createElement('span');
        txt.textContent = stateLabel(s);
        const del = document.createElement('button');
        del.textContent = '✕';
        del.title = '移除这一项';
        del.style.cssText = 'border:none;background:transparent;color:#888;cursor:pointer;margin-left:4px;font-size:11px;line-height:1;';
        del.addEventListener('click', (e) => {
            e.stopPropagation();
            currentChain.splice(i, 1);
            updateChainPreview();
        });
        chip.appendChild(txt);
        chip.appendChild(del);
        el.appendChild(chip);
    });
}
// 由芯片序列 + 本链打断状态下拉 构建一条状态链
function chainAddFromPicker() {
    if (!currentChain.length) return;
    const interruptEl = document.getElementById('chainInterruptSelect');
    const interruptState = interruptEl ? interruptEl.value : (config.interruptState || 'wandering');
    config.stateChains = getStateChains().concat([{
        states: currentChain.slice(),
        interruptState: interruptState
    }]);
    saveConfig();
    renderChains();
    currentChain = [];
    updateChainPreview();
    renderChainPicker();
}

// ===== 所有设置卡片可折叠（折叠状态持久化到 localStorage）=====
// 每个 .sb-group 需带 data-gk（唯一键）；标题点击折叠/展开；data-collapsed="1"
// 表示无历史状态时默认折叠。折叠结果写入 localStorage.petCollapseState。
function initCollapsibleGroups() {
    const groups = document.querySelectorAll('.sb-group');
    if (!groups.length) return;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('petCollapseState') || '{}') || {}; } catch (e) { saved = {}; }

    groups.forEach(group => {
        if (group.__collapsible) return; // 避免重复初始化
        const title = group.querySelector(':scope > .sb-group-title');
        if (!title) return;

        // 把标题之后的所有兄弟节点包进 .sb-group-body（每个卡片只包一次）
        let body = group.querySelector(':scope > .sb-group-body');
        let needsWrap = !body;
        if (needsWrap) {
            body = document.createElement('div');
            body.className = 'sb-group-body';
            Array.from(group.children).forEach(c => { if (c !== title) body.appendChild(c); });
            group.appendChild(body);
        }

        // 标题左侧加折叠箭头
        const arrow = document.createElement('span');
        arrow.className = 'sb-garrow';
        arrow.textContent = '▾';
        title.insertBefore(arrow, title.firstChild);

        const key = group.getAttribute('data-gk') || (title.textContent || '').replace(/\s+/g, '');
        const collapsed = (saved[key] !== undefined) ? !!saved[key] : group.getAttribute('data-collapsed') === '1';

        if (collapsed) group.classList.add('collapsed');

        title.addEventListener('click', (ev) => {
            // 若标题内嵌可交互元素（如计数/开关），点到它们不折叠
            if (ev.target.closest('input,select,button,textarea')) return;
            group.classList.toggle('collapsed');
            saved[key] = group.classList.contains('collapsed');
            try { localStorage.setItem('petCollapseState', JSON.stringify(saved)); } catch (e) {}
        });
        group.__collapsible = true;
    });
}

// ===== 状态设置（合并「状态特效 + 切换概率」）：每行一个现场注册的状态 =====
// 状态集合由 registerDynamicStates 依据当前贴图包现场注册（无任何默认预设）；
// 一行 = 状态名 | [循环动作] [叠加标记] / 粒子多选 ☑ | 概率。
// 行为（状态链）属于"多状态序列"编辑，单独一组（chain 部分），但也同样只含现场注册状态。
function renderStateConfig() {
    const box = document.getElementById('stateConfigList');
    const hint = document.getElementById('probHint');
    if (!box) return;
    const mode = config.probabilityMode || 'relative';
    if (hint) hint.textContent = mode === 'absolute'
        ? '越接近 100 越常出现；0 表示不出现。'
        : '数值越大越常出现；0 表示不出现。';
    box.innerHTML = '';
    const states = selectableStates();
    if (!states.length) {
        box.innerHTML = '<div style="font-size:12px;color:#aaa;">当前贴图包暂无可用状态</div>';
        return;
    }

    const loopKeys = Object.keys(EFFECT_CATALOG).filter(k => EFFECT_CATALOG[k].type === 'loop');
    const overlayKeys = Object.keys(EFFECT_CATALOG).filter(k => EFFECT_CATALOG[k].type === 'overlay');
    const particleKeys = Object.keys(EFFECT_CATALOG).filter(k => EFFECT_CATALOG[k].type === 'particle');

    const currentFx = (state) => getStateEffects(state);
    const saveFx = (state, list) => {
        config.stateEffects = config.stateEffects || {};
        config.stateEffects[state] = list;
        saveConfig();
    };

    states.forEach(state => {
        const row = document.createElement('div');
        row.className = 'state-config-row';

        // 状态名（现场注册的状态，含包内自定义贴图）
        const name = document.createElement('span');
        name.className = 'sc-name';
        name.textContent = stateLabel(state);
        name.title = '该状态进入时播放以下特效';
        row.appendChild(name);

        // 预览：立即让桌宠进入该状态并播放其特效（经主进程转发给桌宠窗口）
        const previewBtn = document.createElement('button');
        previewBtn.type = 'button';
        previewBtn.className = 'sc-preview';
        previewBtn.textContent = '▶';
        previewBtn.title = '预览：让桌宠立即进入该状态并播放其特效';
        previewBtn.addEventListener('click', () => {
            if (window.electronAPI && window.electronAPI.previewFloatState) {
                window.electronAPI.previewFloatState(state);
            }
        });
        row.appendChild(previewBtn);

        // 循环动作（下拉单选，transform 动画互斥；首项「无」表示不播放任何循环动画）
        const loopSel = document.createElement('select');
        loopSel.className = 'sc-loop';
        loopSel.title = '循环动作（单选）：上下拉伸/压扁等，一状态只保留一个';
        {
            const optNone = document.createElement('option');
            optNone.value = 'none';
            optNone.textContent = '无（不播放）';
            loopSel.appendChild(optNone);
        }
        loopKeys.forEach(k => {
            const opt = document.createElement('option');
            opt.value = k;
            opt.textContent = EFFECT_CATALOG[k].label;
            loopSel.appendChild(opt);
        });
        loopSel.value = getStateLoopKey(state);
        loopSel.addEventListener('change', () => {
            const list = currentFx(state).filter(k => EFFECT_CATALOG[k].type !== 'loop');
            if (loopSel.value !== 'none') list.push(loopSel.value);
            saveFx(state, list);
        });
        row.appendChild(loopSel);

        // 叠加标记（下拉单选：无 / Zzz），不占 transform，可与循环动作叠加
        const ovSel = document.createElement('select');
        ovSel.className = 'sc-overlay';
        ovSel.title = '叠加标记（单选）：Zzz 泡泡等，可与循环动作叠加';
        {
            const optNone = document.createElement('option');
            optNone.value = 'none';
            optNone.textContent = '无（不播放）';
            ovSel.appendChild(optNone);
        }
        overlayKeys.forEach(k => {
            const opt = document.createElement('option');
            opt.value = k;
            opt.textContent = EFFECT_CATALOG[k].label;
            ovSel.appendChild(opt);
        });
        ovSel.value = currentFx(state).includes('zzz') ? 'zzz' : 'none';
        ovSel.addEventListener('change', () => {
            let list = currentFx(state).filter(k => EFFECT_CATALOG[k].type !== 'overlay');
            if (ovSel.value !== 'none') list.push(ovSel.value);
            saveFx(state, list);
        });
        row.appendChild(ovSel);

        // 粒子（勾选多选，独立 DOM，可与前两者叠加）
        const chks = document.createElement('div');
        chks.className = 'fx-chks';
        particleKeys.forEach(k => {
            const lab = document.createElement('label');
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = k;
            cb.checked = currentFx(state).includes(k);
            cb.addEventListener('change', () => {
                let list = currentFx(state).filter(x => EFFECT_CATALOG[x].type !== 'particle');
                particleKeys.forEach(pk => {
                    const box = chks.querySelector(`input[value="${pk}"]`);
                    if (box && box.checked) list.push(pk);
                });
                saveFx(state, list);
            });
            lab.appendChild(cb);
            lab.appendChild(document.createTextNode(EFFECT_CATALOG[k].label));
            chks.appendChild(lab);
        });
        row.appendChild(chks);

        // 切换概率
        const probInput = document.createElement('input');
        probInput.type = 'number';
        probInput.min = '0';
        probInput.max = '100';
        probInput.step = '1';
        const confVal = config.stateProbabilities && config.stateProbabilities[state] != null
            ? config.stateProbabilities[state]
            : defaultStateProb(state);
        probInput.value = confVal;
        probInput.addEventListener('input', () => {
            config.stateProbabilities = config.stateProbabilities || {};
            config.stateProbabilities[state] = Math.max(0, Number(probInput.value) || 0);
            saveConfig();
        });
        row.appendChild(probInput);
        const unit = document.createElement('span');
        unit.className = 'sc-unit';
        unit.textContent = mode === 'absolute' ? '%' : '';
        row.appendChild(unit);

        box.appendChild(row);
    });

    // 渲染日志：一次即可，确认当前运行的确实是带「无」选项的新代码（经主进程转发打印）
    if (window.electronAPI && window.electronAPI.logToMain && !window.__fxLogDone) {
        window.__fxLogDone = true;
        const first = box.querySelector('select.sc-loop');
        const opts = first ? Array.from(first.options).map(o => o.value) : [];
        window.electronAPI.logToMain('info', '[float:settings] stateFx rows=' + states.length + ' loopOptions=[' + opts.join(',') + ']');
    }
}

// ===== 记忆设置：列出 / 添加 / 删除（支持关键字过滤 + 分页 + 图像记忆 + 最新优先）=====
function memoryItemText(m) {
    if (!m) return '';
    if (m.text != null) return String(m.text);
    if (m.description != null) return String(m.description);
    return '';
}

// 生成图像记忆的缩略图 src，优先本地缓存路径，必要时回退 file:// 路径
function memoryImageSrc(m) {
    if (m && m.imageUrl) return m.imageUrl;
    if (m && m.imagePath) {
        try {
            const { pathToFileURL } = require('url');
            return pathToFileURL(m.imagePath).href;
        } catch (e) {
            return 'file://' + String(m.imagePath).replace(/\\/g, '/');
        }
    }
    return '';
}

// 删除一条记忆：图像记忆额外调用 DELETE /files/{file_id} 并清理本地缓存
async function deleteMemoryItemAt(idx) {
    const m = memoryItems[idx];
    if (!m) return;
    if (m.type === 'image') {
        if (m.fileId && window.electronAPI && window.electronAPI.deleteDeepSeekFile) {
            try { await window.electronAPI.deleteDeepSeekFile(m.fileId); } catch (e) {}
        }
        if (m.imagePath && window.electronAPI && window.electronAPI.deleteScreenshotCache) {
            try { await window.electronAPI.deleteScreenshotCache(m.imagePath); } catch (e) {}
        }
    }
    memoryItems = memoryItems.filter((_, i) => i !== idx);
    if (window.electronAPI && window.electronAPI.memorySave) {
        await window.electronAPI.memorySave(memoryItems);
    }
    renderMemoryList();
}

function renderMemoryList() {
    const box = document.getElementById('memoryList');
    const count = document.getElementById('memCount');
    if (count) count.textContent = String(memoryItems.length);
    if (!box) return;
    const kw = memorySearchKeyword || '';
    const filtered = memoryItems
        .map((m, i) => ({ m, i }))
        .filter(({ m }) => {
            if (!m) return false;
            const isImg = m.type === 'image';
            if (isImg && !memoryShowImg) return false;   // 关闭【图片】时不显示图像记忆
            if (!isImg && !memoryShowText) return false; // 关闭【文本】时不显示文本记忆
            return !kw || memoryItemText(m).toLowerCase().includes(kw);
        });
    // 按时间先后 … 最新优先：数组按时间追加（旧在前），因此倒序展示
    const displayOrder = filtered.slice().reverse();
    const totalFiltered = displayOrder.length;
    const totalPages = Math.max(1, Math.ceil(totalFiltered / MEMORY_PAGE_SIZE));
    if (memoryPage > totalPages) memoryPage = totalPages;
    if (memoryPage < 1) memoryPage = 1;
    const pageStart = (memoryPage - 1) * MEMORY_PAGE_SIZE;
    const pageEntries = displayOrder.slice(pageStart, pageStart + MEMORY_PAGE_SIZE);

    box.innerHTML = '';
    if (!pageEntries.length) {
        box.innerHTML = `<div class="memory-empty" style="font-size:12px;color:#aaa;padding:6px 2px;">${memoryItems.length ? '没有匹配的记忆' : '还没有记忆'}</div>`;
    }
    pageEntries.forEach(({ m, i }) => {
        if (m && m.type === 'image') {
            // 图像记忆：展示图片 + file_id + 描述（可选显示描述），删除调用 DELETE /files/{file_id}
            const div = document.createElement('div');
            div.className = 'mem-item mem-image-item';
            const src = memoryImageSrc(m);
            const inner = document.createElement('div');
            inner.className = 'mem-img-body';
            let imgHtml = '';
            if (src) {
                imgHtml = `<img class="mem-thumb" src="${escapeHtml(src)}" alt="图像记忆" loading="lazy" onerror="this.style.visibility='hidden'"/>`;
            } else {
                imgHtml = `<div class="mem-img-missing">图片缓存缺失</div>`;
            }
            const descHtml = m.description
                ? `<div class="mem-desc">${escapeHtml(m.description)}</div>`
                : '';
            const idHtml = `<div class="mem-fileid" title="${escapeHtml(m.fileId || '')}">${escapeHtml(m.fileId || '')}</div>`;
            inner.innerHTML = imgHtml + descHtml + idHtml;
            div.appendChild(inner);
            const del = document.createElement('button');
            del.className = 'mem-del';
            del.textContent = '删';
            del.title = '删除该图像记忆（同时删除 Files API 上的文件）';
            del.onclick = () => deleteMemoryItemAt(i);
            div.appendChild(del);
            box.appendChild(div);
        } else {
            const div = document.createElement('div');
            div.className = 'mem-item';
            const text = (m && m.text != null) ? String(m.text) : '';
            div.innerHTML = `<span>${escapeHtml(text)}</span><button class="mem-del" data-i="${i}" title="删除该记忆">删</button>`;
            box.appendChild(div);
        }
    });
    box.querySelectorAll('.mem-del').forEach(b => {
        if (b.dataset.i !== undefined) {
            b.onclick = () => deleteMemoryItemAt(Number(b.dataset.i));
        }
    });

    // 分页控件
    const pager = document.getElementById('memoryPager');
    if (pager) {
        pager.innerHTML = '';
        if (totalPages > 1) {
            const pad = (style) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'mp-btn';
                b.style.cssText = style;
                return b;
            };
            const prev = pad(''); 
            prev.textContent = '上一页';
            prev.disabled = memoryPage <= 1;
            prev.onclick = () => { memoryPage--; renderMemoryList(); };

            const info = document.createElement('span');
            info.className = 'mp-info';
            info.textContent = `${memoryPage} / ${totalPages}`;

            const next = pad('');
            next.textContent = '下一页';
            next.disabled = memoryPage >= totalPages;
            next.onclick = () => { memoryPage++; renderMemoryList(); };

            pager.appendChild(prev);
            pager.appendChild(info);
            pager.appendChild(next);
        }
    }
}
function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 启动时把已保存的小窗口配置应用到运行时并同步给主进程（保证独立运作）
function applySavedFloatConfig() {
    // 小窗口大小
    if (config.floatPetSize && Number.isFinite(config.floatPetSize)) {
        currentPetSize = config.floatPetSize;
        if (window.electronAPI && window.electronAPI.send) {
            window.electronAPI.send('set-float-pet-size', currentPetSize);
        }
    }
    // 移动模式
    if (config.floatMoveMode === 'free' || config.floatMoveMode === 'gravity') {
        moveMode = config.floatMoveMode;
        if (window.electronAPI && window.electronAPI.send) {
            window.electronAPI.send('set-float-move-mode', moveMode);
        }
    }
    // 重力模式碰撞窗口
    if (typeof config.bounceWindows === 'boolean') {
        bounceOffWindows = config.bounceWindows;
        if (window.electronAPI && window.electronAPI.send) {
            window.electronAPI.send('set-float-bounce-windows', bounceOffWindows);
        }
    }
    // 饼干生成开关
    if (typeof config.cookieSpawnEnabled === 'boolean') {
        cookieSpawnEnabled = config.cookieSpawnEnabled;
        if (window.electronAPI && window.electronAPI.send) {
            window.electronAPI.send('set-cookie-spawn-enabled', cookieSpawnEnabled);
        }
    }
    // 饼干大小
    if (config.cookieSize && Number.isFinite(config.cookieSize)) {
        cookieSize = config.cookieSize;
        if (window.electronAPI && window.electronAPI.send) {
            window.electronAPI.send('set-cookie-size', cookieSize);
        }
    }
    // 小窗口聊天立绘
    if (typeof config.floatShowIllust === 'boolean') {
        floatShowIllust = config.floatShowIllust;
        if (window.electronAPI && window.electronAPI.send) {
            window.electronAPI.send('set-float-show-illust', floatShowIllust);
        }
    }
    // 贴图/按钮/窗口高度偏移
    if (Number.isFinite(config.floatPetBottomOffset)) {
        floatPetBottomOffset = config.floatPetBottomOffset;
    }
    if (Number.isFinite(config.floatBubbleOffset)) {
        floatBubbleOffset = config.floatBubbleOffset;
    }
    if (Number.isFinite(config.floatWindowHeightPad)) {
        floatWindowHeightPad = config.floatWindowHeightPad;
    }
}

// 立即设置初始贴图，避免启动初期显示空 src（alt/pet 文字和破图图标）
window._stickerPack = config.stickerPack || '默认';
if (floatPetImg) {
    floatPetImg.src = ORIGINAL_PET_SRC();
}

// 加载状态
function loadStats() {
    const saved = localStorage.getItem('petStats');
    if (saved) {
        try {
            const savedStats = JSON.parse(saved);
            stats = { ...stats, ...savedStats };
        } catch (e) {}
    }
}
loadStats();

// 统一判断浮窗是否应暂停数值变化
function shouldPauseFloatStats() {
    return floatIsClosing || isWindowMinimized;
}

// 保存状态
function saveStats() {
    if (shouldPauseFloatStats()) {
        console.log('[float] blocked stats save', {
            isWindowMinimized,
            floatIsClosing,
            currentFloatSessionId
        });
        return;
    }
    localStorage.setItem('petStats', JSON.stringify(stats));
}

// 获取当前时间字符串
function getCurrentTimeStr() {
    const now = new Date();
    const h = now.getHours().toString().padStart(2, '0');
    const m = now.getMinutes().toString().padStart(2, '0');
    const period = h < 6 ? '凌晨' : h < 12 ? '上午' : h < 14 ? '中午' : h < 18 ? '下午' : '晚上';
    return `${period}${h}:${m}`;
}

// 获取天气信息
async function getWeatherStr() {
    const now = Date.now();
    if (cachedWeather && (now - weatherFetchTime) < 600000) {
        return cachedWeather;
    }
    try {
        const resp = await fetch('https://wttr.in/?format=%C+%t&lang=zh', { signal: AbortSignal.timeout(3000) });
        const text = (await resp.text()).trim();
        if (text && text.length < 30) {
            cachedWeather = text;
            weatherFetchTime = now;
            return text;
        }
    } catch (e) {}
    return '';
}

// 构建上下文字符串
async function buildContextStr() {
    const timeStr = getCurrentTimeStr();
    let ctx = `\n当前时间：${timeStr}`;
    const weather = await getWeatherStr();
    if (weather) {
        ctx += `\n当前天气：${weather}`;
    }
    return ctx;
}

// 记录行为
function logBehavior(action) {
    const now = new Date();
    const timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0') + ':' + now.getSeconds().toString().padStart(2, '0');
    behaviorLog.push({ time: timeStr, action: action });
    if (behaviorLog.length > 10) {
        behaviorLog.shift();
    }
}

// 获取行为日志字符串
function getBehaviorLogStr() {
    if (behaviorLog.length === 0) return '';
    return '\n最近行为记录：\n' + behaviorLog.map(b => `- ${b.time} ${b.action}`).join('\n');
}

// ===== 气泡只在鼠标靠近时显示 + 鼠标悬浮时暂停游荡 =====
const BUBBLE_SHOW_DISTANCE = 120;
const HOVER_STOP_DISTANCE = 150;

let isMouseHovering = false;
// 用窗口真实屏幕位置初始化，而非硬编码“屏幕右下角”。窗口由主进程居中创建，
// 若用旧值会导致 lastWindowX/Y 与窗口实际位置脱节，重力物理一启动就把窗口拉到底部/出屏。
let lastWindowX = (typeof window.screenX === 'number' && Number.isFinite(window.screenX)) ? window.screenX : screenX;
let lastWindowY = (typeof window.screenY === 'number' && Number.isFinite(window.screenY)) ? window.screenY : screenY;

let floatShowIllust = true;

// 初始化加载记忆（异步，在模式分流之前加载，确保两种模式都可用）
(async () => {
    try {
        await loadMemory();
    } catch (e) {
        console.warn('[float] load memory failed:', e);
    }
    renderMemoryList();
})();

// 监听记忆更新（其他窗口修改记忆时同步更新）
if (window.electronAPI && window.electronAPI.onMemoryUpdated) {
    window.electronAPI.onMemoryUpdated((items) => {
        if (Array.isArray(items)) {
            memoryItems = items;
            renderMemoryList();
        }
    });
}

// 加载图包资产（所有模式都需要动态心情/状态）
loadPackAssets();

// ===== 模式分流 =====
if (isSettingsMode) {
    // ===== 设置面板模式：只显示设置，不启动桌宠/聊天逻辑 =====
    if (petContainer) petContainer.style.display = 'none';
    if (floatBubble) floatBubble.style.display = 'none';
    if (chatContainer) chatContainer.style.display = 'none';
    const sp = document.getElementById('settingsPanel');
    if (sp) sp.style.display = 'block';
    document.body.classList.add('settings-mode');
    initSettingsPanel();
} else if (isChatMode) {
    // ===== 聊天模式：只显示聊天界面 =====
    petContainer.style.display = 'none';
    floatBubble.style.display = 'none';
    chatContainer.style.display = 'flex';
    chatContainer.style.width = '100%';
    chatContainer.style.height = '100%';
    floatChatInput.focus();

    // FIX: 聊天窗口为无边框透明窗口，保留顶部标题栏作为拖动区域
    const chatHeader = document.querySelector('.chat-header');
    if (chatHeader) {
        // 将立绘显示按钮移到聊天主区域顶部（避免与拖动区域冲突）
        const illustShowBtn = document.getElementById('floatIllustShowBtn');
        const chatLog = document.getElementById('floatChatLog');
        if (illustShowBtn && chatLog && illustShowBtn.parentElement === chatHeader) {
            const chatMain = document.querySelector('.chat-main');
            if (chatMain) {
                chatMain.insertBefore(illustShowBtn, chatMain.firstChild);
            }
        }
    }
    
    // 根据配置初始化立绘显示状态
    if (floatChatIllust) {
        if (floatShowIllust) {
            floatChatIllust.classList.remove('hidden');
        } else {
            floatChatIllust.classList.add('hidden');
        }
    }
    
    // 立绘栏显示/隐藏控制（按钮已移除；保留无按钮的兜底，不影响功能）
    if (floatIllustHideBtn && floatIllustHideBtn.parentNode) {
        floatIllustHideBtn.addEventListener('click', () => {
            if (floatChatIllust) floatChatIllust.classList.add('hidden');
        });
    }
    if (floatIllustShowBtn && floatIllustShowBtn.parentNode) {
        floatIllustShowBtn.addEventListener('click', () => {
            if (floatChatIllust) floatChatIllust.classList.remove('hidden');
        });
    }
    
    // 立绘栏 / 聊天栏比例可调：拖动右侧分隔条（#floatChatDivider）改变立绘栏宽度
    const chatDivider = document.getElementById('floatChatDivider');
    if (chatDivider) {
        const applyIllustWidth = (pct) => {
            pct = Math.max(8, Math.min(70, pct));
            if (chatContainer) chatContainer.style.setProperty('--illust-width', pct + '%');
        };
        let dragging = false;
        const onMove = (e) => {
            if (!dragging) return;
            const rect = chatContainer.getBoundingClientRect();
            if (rect.width <= 0) return;
            const pct = ((e.clientX - rect.left) / rect.width) * 100;
            applyIllustWidth(pct);
        };
        const onUp = () => {
            dragging = false;
            chatDivider.classList.remove('active');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.body.style.cursor = '';
        };
        chatDivider.addEventListener('mousedown', (e) => {
            e.preventDefault();
            dragging = true;
            chatDivider.classList.add('active');
            document.body.style.cursor = 'col-resize';
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }
    
    // 监听立绘显示设置变化
    if (window.electronAPI && window.electronAPI.onFloatShowIllust) {
        window.electronAPI.onFloatShowIllust((enabled) => {
            floatShowIllust = enabled;
            if (floatChatIllust) {
                if (enabled) {
                    floatChatIllust.classList.remove('hidden');
                } else {
                    floatChatIllust.classList.add('hidden');
                }
            }
        });
    }
    
    // 进入聊天时根据状态决定立绘（与主窗口一致）
    decideMoodByState();
    if (!floatShowIllust && floatChatIllust) {
        floatChatIllust.classList.add('hidden');
    }
    
    // 响应主进程请求：把当前聊天历史同步过去
    if (window.electronAPI && window.electronAPI.onRequestSyncChatHistory) {
        window.electronAPI.onRequestSyncChatHistory(() => {
            if (window.electronAPI && window.electronAPI.syncChatHistory) {
                window.electronAPI.syncChatHistory(chatHistory);
            }
        });
    }

    // 窗口关闭时触发记忆总结（通过 IPC 监听原生窗口的关闭请求）
    // FIX: 使用原生标题栏后，通过 IPC 拦截窗口关闭，先完成记忆总结再关闭
    if (window.electronAPI && window.electronAPI.on) {
        window.electronAPI.on('chat-window-close-requested', async () => {
            await summarizeMemoryOnChatClose();
            chatMemorySummarizedOnClose = true;
            hideIllust();
            // 总结完成后，通知主进程真正关闭窗口
            if (window.electronAPI && window.electronAPI.send) {
                window.electronAPI.send('chat-window-confirmed-close');
            }
        });
    }

    // beforeunload 作为后备：如果 IPC 没拦截到，至少尝试同步触发。
    // 若已通过 IPC 路径总结过（chatMemorySummarizedOnClose），则不再重复总结，避免生成重复记忆。
    window.addEventListener('beforeunload', () => {
        if (!chatMemorySummarizedOnClose) {
            summarizeMemoryOnChatClose();
        }
        hideIllust();
    });

    // 关闭按钮（保留以防模拟标题栏仍在）
    // 仅触发主进程关闭聊天窗口；真正的记忆总结由主进程拦截 close 后回发的
    // 'chat-window-close-requested' 统一处理，避免此处直接总结导致与拦截路径重复生成记忆。
    if (chatCloseBtn) {
        chatCloseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log('[float] close button clicked');
            if (window.electronAPI && window.electronAPI.floatExitChatMode) {
                window.electronAPI.floatExitChatMode();
            }
        });
    }
} else {
    // ===== 浮窗模式：保持原有逻辑 =====

    // 启动时应用已保存的小窗口配置（独立运作），并同步到主进程
    applySavedFloatConfig();
    // 立即根据 currentPetSize 设置容器尺寸和 CSS 变量，不等待 IPC 消息。
    // 否则容器停留在默认 160×140、CSS 变量使用 fallback 值，
    // 导致贴图位置在浏览器和 Electron 中不同，也影响后续物理碰撞计算。
    updateWindowSize();

    // mousemove 事件
    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            const dx = e.screenX - dragStartX;
            const dy = e.screenY - dragStartY;

            const now = performance.now();
            const dt = Math.max(now - lastDragTime, 1);
            dragVelocityX = (e.screenX - lastDragX) / dt;
            dragVelocityY = (e.screenY - lastDragY) / dt;
            lastDragX = e.screenX;
            lastDragY = e.screenY;
            lastDragTime = now;

            if (window.electronAPI) {
                const newX = windowStartX + dx;
                const newY = windowStartY + dy;
                if (Number.isFinite(newX) && Number.isFinite(newY)) {
                    moveFloatWindowTo(newX, newY);
                }
                pauseWander();
            }

            feedPendulum(e.clientX);
            return;
        }

        const winX = window.screenX;
        const winY = window.screenY;
        const winW = getContainerWidth();
        const winH = getContainerHeight();

        let dx = 0, dy = 0;
        if (e.screenX < winX) dx = winX - e.screenX;
        else if (e.screenX > winX + winW) dx = e.screenX - (winX + winW);

        if (e.screenY < winY) dy = winY - e.screenY;
        else if (e.screenY > winY + winH) dy = e.screenY - (winY + winH);

        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < BUBBLE_SHOW_DISTANCE) {
            floatBubble.classList.add('show');
        } else {
            floatBubble.classList.remove('show');
        }

        const wasHovering = isMouseHovering;
        isMouseHovering = dist < HOVER_STOP_DISTANCE;
        lastPetMouseEvent = Date.now();
        if (wasHovering && !isMouseHovering && !isDragging && !isParabolaRunning) {
            resumeWander();
        }
    });

    // mouseup 事件
    let dragVelocityX = 0;
    let dragVelocityY = 0;
    let lastDragX = 0;
    let lastDragY = 0;
    let lastDragTime = 0;

    document.addEventListener('mouseup', (e) => {
        if (isDragging) {
            isDragging = false;
            stopPendulum();
            // 拖拽结束：恢复该状态配置的循环动作特效（若是吃饭/吃饼干也会一并恢复）
            pausedEatingOnDrag = false;
            applyStateEffect(petState);
            // 根据当前状态恢复贴图
            floatPetImg.src = (PET_IMGS[petState] || ORIGINAL_PET_SRC)();

            if (moveMode === 'gravity') {
                throwWithParabola(dragVelocityX, dragVelocityY);
            } else {
                setTimeout(() => {
                    if (semKey(petState) === 'craving' && cookieState.active && !cookieState.consumed) {
                        wanderToCookie();
                    } else if (!MOVEMENT_BLOCKED_STATES.includes(semKey(petState))) {
                        resumeWander();
                    }
                }, 3000);
            }
        }
    });

    // mouseleave 事件
    document.addEventListener('mouseleave', () => {
        if (isMouseHovering) {
            isMouseHovering = false;
            floatBubble.classList.remove('show');
            if (!isParabolaRunning) {
                resumeWander();
            }
        }
    });

    // 获取容器尺寸
    // 桌宠脚部与窗口下边的间距（必须与 updateWindowSize 的 --float-pet-bottom 一致）
    function getPetBottomGap() {
        return Math.max(4, Math.ceil(currentPetSize * 0.05)) + floatPetBottomOffset;
    }
    // 顶部为聊天气泡预留的高度（气泡 + 与桌宠头部的间隔）
    function getBubbleBand() {
        return Math.ceil(currentPetSize * 1.05) + 10 + floatBubbleOffset;
    }
    // —— 窗口尺寸唯一来源：updateWindowSize()/physics/碰撞都用这里，保证与实际窗口一致 —
    function getContainerWidth() {
        const bubbleWidth = 200; // 与 float.css 中 .float-bubble 的 width 保持一致
        const sidePad = Math.ceil(currentPetSize * 0.5);
        return Math.max(currentPetSize + sidePad * 2, bubbleWidth);
    }
    function getContainerHeight() {
        return getPetBottomGap() + currentPetSize + getBubbleBand() + floatWindowHeightPad;
    }

    // 桌宠贴图底部/顶部相对于窗口顶部的偏移量（贴合窗口下边缘的可视位置）
    function getPetImageBottomOffset() {
        return getContainerHeight() - getPetBottomGap();
    }
    // 桌宠脚部附近的地面锚点 Y（用于游荡/碰撞/工作区判定）
    function getPetBottomOffset() {
        return getPetImageBottomOffset() - currentPetSize / 2;
    }
    function getPetTopOffset() {
        return getPetImageBottomOffset() - currentPetSize;
    }

    function getPetCenterXOffset() {
        return getContainerWidth() / 2;
    }

    // 异步获取指定坐标所在显示器的工作区
    async function getWorkAreaAt(x, y) {
        if (window.electronAPI && window.electronAPI.getWorkAreaAtPoint) {
            try {
                const wa = await window.electronAPI.getWorkAreaAtPoint(x, y);
                return { x: wa.x, y: wa.y, width: wa.width, height: wa.height };
            } catch (e) {}
        }
        return { x: 0, y: 0, width: screenWidth, height: screenHeight };
    }

    // 初始化屏幕尺寸
    async function initScreenSize() {
        if (window.electronAPI && window.electronAPI.getWorkAreaAtPoint) {
            try {
                const wa = await window.electronAPI.getWorkAreaAtPoint(0, 0);
                screenWidth = wa.width;
                screenHeight = wa.height;
                screenX = wa.x;
                screenY = wa.y;
            } catch (e) {}
        }
    }
    initScreenSize();

    // 获取所有可见非全屏窗口边界
    async function fetchWindowBounds() {
        if (!window.electronAPI || !window.electronAPI.getWindowBounds) return [];
        try {
            return await window.electronAPI.getWindowBounds();
        } catch (e) {
            return [];
        }
    }

    // 检查桌宠中心是否在某个窗口内部
    function findContainerWindow(posX, posY, winBounds) {
        const petCenterX = posX + getPetCenterXOffset();
        const petCenterY = posY + getPetBottomOffset() - currentPetSize / 2;
        for (const wb of winBounds) {
            if (petCenterX > wb.x && petCenterX < wb.x + wb.width &&
                petCenterY > wb.y && petCenterY < wb.y + wb.height) {
                return wb;
            }
        }
        return null;
    }

    // 双击恢复主窗口
    floatPet.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        if (window.electronAPI) {
            window.electronAPI.restoreMainWindow();
        }
    });

    // 单击触发随机特效
    const effects = ['bounce', 'shake', 'hearts', 'stars'];

    floatPet.addEventListener('click', (e) => {
        if (isDragging) return;
        // 互动（点击）会打断正在进行的状态链，进入该链指定的打断后状态
        interruptChain();
        // 生气状态：点击一次后切换到其它状态
        if (semKey(petState) === 'angry') {
            randomStateTransition();
            return;
        }
        const effect = effects[Math.floor(Math.random() * effects.length)];
        triggerEffect(effect);
    });

    function triggerEffect(effect) {
        // 点击/指令特效：粒子类直接放，动画类临时播放后移除（若某状态在持续播放同一动画则保留）
        floatPetImg.classList.remove('effect-bounce', 'effect-shake');
        void floatPetImg.offsetWidth;

        const key = effect === 'heart' ? 'hearts' : effect;
        const eff = EFFECT_CATALOG[key];
        if (!eff) return;
        if (eff.particles) { spawnParticles(eff.particles); return; }
        if (eff.zzz) {
            const z = document.getElementById('zzzEffect');
            if (z) { z.classList.add('show'); setTimeout(() => z.classList.remove('show'), 1600); }
            return;
        }
        const cls = eff.class;
        if (!cls) return;
        const already = floatPetImg.classList.contains(cls);
        floatPetImg.classList.add(cls);
        setTimeout(() => { if (!already) floatPetImg.classList.remove(cls); }, 1200);
    }

    // 生成粒子特效
    function spawnParticles(type) {
        const count = 5 + Math.floor(Math.random() * 4);
        const container = document.querySelector('.float-container');

        for (let i = 0; i < count; i++) {
            setTimeout(() => {
                const particle = document.createElement('div');
                particle.className = `particle ${type}`;
                const SYMBOLS = { heart: '❤️', star: '⭐', sparkle: '✨', bubble: '🫧' };
                particle.textContent = SYMBOLS[type] || '❤️';

                const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
                const startX = 80 + Math.cos(angle) * 20;
                const startY = 80 + Math.sin(angle) * 20;

                particle.style.left = startX + 'px';
                particle.style.top = startY + 'px';

                const flyAngle = angle + (Math.random() - 0.5) * 1;
                const flyDist = 30 + Math.random() * 40;
                particle.style.setProperty('--fly-x', Math.cos(flyAngle) * flyDist + 'px');
                particle.style.setProperty('--fly-y', Math.sin(flyAngle) * flyDist + 'px');

                container.appendChild(particle);
                setTimeout(() => particle.remove(), 1200);
            }, i * 80);
        }
    }

    // 单摆旋转效果
    function startPendulum() {
        pendulumAngle = 0;
        pendulumVel = 0;
        pendulumTarget = 0;
        lastMouseClientX = 0;
        lastMouseTime = 0;
        floatPetImg.classList.add('dragging');
        floatPetImg.style.transition = '';
        if (pendulumRAF) cancelAnimationFrame(pendulumRAF);
        pendulumRAF = requestAnimationFrame(updatePendulum);
    }

    function updatePendulum() {
        const stiffness = 0.15;
        const damping = 0.90;
        pendulumVel += (pendulumTarget - pendulumAngle) * stiffness;
        pendulumVel *= damping;
        pendulumAngle += pendulumVel;
        pendulumTarget *= 0.98;

        floatPetImg.style.transform = `rotate(${pendulumAngle}deg)`;
        pendulumRAF = requestAnimationFrame(updatePendulum);
    }

    function feedPendulum(clientX) {
        const now = performance.now();
        if (lastMouseTime > 0) {
            const dt = Math.max(now - lastMouseTime, 1);
            const vx = (clientX - lastMouseClientX) / dt;
            const target = Math.max(-40, Math.min(40, vx * 60));
            pendulumTarget = target;
        }
        lastMouseClientX = clientX;
        lastMouseTime = now;
    }

    function stopPendulum() {
        if (pendulumRAF) {
            cancelAnimationFrame(pendulumRAF);
            pendulumRAF = null;
        }
        floatPetImg.classList.remove('dragging');
        floatPetImg.style.transition = 'transform 0.3s ease';
        floatPetImg.style.transform = '';
        setTimeout(() => {
            floatPetImg.style.transition = '';
        }, 320);
    }

    // 窗口尺寸自适应（与 getContainerWidth/Height 保持一致，气泡贴近桌宠头部）
    function updateWindowSize() {
        const w = getContainerWidth();
        const h = getContainerHeight();
        const bottomGap = getPetBottomGap();

        document.querySelector('.float-container').style.width = w + 'px';
        document.querySelector('.float-container').style.height = h + 'px';
        document.documentElement.style.setProperty('--float-pet-bottom', bottomGap + 'px');
        document.documentElement.style.setProperty('--float-pet-size', currentPetSize + 'px');
        document.documentElement.style.setProperty('--float-bubble-offset', floatBubbleOffset + 'px');

        if (window.electronAPI && window.electronAPI.resizeFloatWindow) {
            window.electronAPI.resizeFloatWindow(w, h);
        }
    }

    // 拖动窗口
    floatPet.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();

        // 生气状态下不触发拖拽，交给 click 处理状态切换
        if (semKey(petState) === 'angry') {
            return;
        }

        isDragging = true;
        interruptChain(); // 拖拽打断状态链
        // 吃饭/吃饼干状态下拖动：停止上下缩放动画，改为单摆效果（结束拖动后再恢复）
        pausedEatingOnDrag = (semKey(petState) === 'eating' || semKey(petState) === 'eating_cookie');
        // 拖拽期间暂停该状态配置的循环动作特效，避免上下拉伸等动画在拖动时反复缩放停不下来
        CLS_STATE_FX.forEach(c => floatPetImg.classList.remove(c));
        resetPetScale();
        dragStartX = e.screenX;
        dragStartY = e.screenY;
        lastDragX = e.screenX;
        lastDragY = e.screenY;
        lastDragTime = performance.now();
        dragVelocityX = 0;
        dragVelocityY = 0;

        if (window.electronAPI) {
            // 用窗口当前实际位置作为拖拽起点，而不是可能过期的 lastWindowX/lastWindowY，
            // 否则从主进程居中设好的位置拖动时，第一次拖动会跳到旧坐标（通常是屏幕右下）。
            windowStartX = window.screenX;
            windowStartY = window.screenY;
        }

        floatPetImg.src = DRAG_PET_SRC();
        startPendulum();
        feedPendulum(e.clientX);
    });

    floatPet.addEventListener('dragstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });

    floatPetImg.addEventListener('dragstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });

    document.addEventListener('selectstart', (e) => {
        e.preventDefault();
    });

    document.addEventListener('contextmenu', (e) => {
        if (e.target === floatPet || floatPet.contains(e.target)) return;
        e.preventDefault();
    });

    // 重力模式抛物线运动（拖拽释放后）
    // 原理：posX/Y 始终是窗口顶部左上角坐标，窗口底部 = posY + winH。
    // 碰撞边界统一为整窗始终在 workArea 内：
    //   - 上边界 = workArea.y（窗口顶部不超出屏幕顶部）
    //   - 下边界 = workArea.y + workArea.height - winH（窗口底部不超出屏幕底部）
    //   - 左右边界 = workArea.x / workArea.x + workArea.width - winW
    async function throwWithParabola(vx, vy) {
        const gravity = 0.002;
        // 从窗口当前实际位置出发，而非可能过期的 lastWindowX/Y
        let posX = Number.isFinite(window.screenX) ? window.screenX : lastWindowX;
        let posY = Number.isFinite(window.screenY) ? window.screenY : lastWindowY;
        let velX = Math.max(-2.0, Math.min(2.0, vx));
        let velY = Math.max(-2.0, Math.min(2.0, vy));
        if (!Number.isFinite(posX)) posX = 0;
        if (!Number.isFinite(posY)) posY = 0;
        if (!Number.isFinite(velX)) velX = 0;
        if (!Number.isFinite(velY)) velY = 0;
        if (velX === 0 && velY === 0) {
            velX = (Math.random() < 0.5 ? -1 : 1) * 0.5;
        }
        isMoving = true;
        isParabolaRunning = true;
        let lastTime = performance.now();

        let workArea = await getWorkAreaAt(posX + getPetCenterXOffset(), posY + getPetBottomOffset());
        let winBounds = await fetchWindowBounds();
        let containerWin = findContainerWindow(posX, posY, winBounds);
        let boundsRefreshTimer = 0;

        const step = () => {
            if (isDragging || !isMoving) {
                isParabolaRunning = false;
                return;
            }

            const now = performance.now();
            const dt = now - lastTime;
            lastTime = now;

            velY += gravity * dt;
            posX += velX * dt;
            posY += velY * dt;

            if (isNaN(posX) || isNaN(posY) || !isFinite(posX) || !isFinite(posY)) {
                posX = Math.max(0, Math.min(screenWidth - getContainerWidth(), posX || screenWidth / 2));
                posY = Math.max(0, Math.min(screenHeight - getContainerHeight(), posY || screenHeight / 2));
                moveFloatWindowTo(posX, posY);
                isParabolaRunning = false;
                setTimeout(() => {
                    if (semKey(petState) === 'craving' && cookieState.active && !cookieState.consumed) {
                        wanderToCookie();
                    } else if (!MOVEMENT_BLOCKED_STATES.includes(semKey(petState))) {
                        resumeWander();
                    }
                }, 1000);
                return;
            }

            boundsRefreshTimer += dt;
            if (boundsRefreshTimer > 300) {
                boundsRefreshTimer = 0;
                fetchWindowBounds().then(b => {
                    winBounds = b;
                    containerWin = findContainerWindow(posX, posY, winBounds);
                });
                getWorkAreaAt(posX + getPetCenterXOffset(), posY + getPetBottomOffset()).then(wa => {
                    workArea = wa;
                });
            }

            const winW = getContainerWidth();
            const winH = getContainerHeight();

            // 左右边界反弹：整窗始终在 workArea 水平范围内
            if (posX < workArea.x) {
                posX = workArea.x;
                velX = Math.abs(velX) * 0.4;
            } else if (posX + winW > workArea.x + workArea.width) {
                posX = workArea.x + workArea.width - winW;
                velX = -Math.abs(velX) * 0.4;
            }

            // 上下边界反弹：posY 即窗口顶部，整窗完整落在 workArea 内
            const topBound = workArea.y;
            const bottomBound = workArea.y + workArea.height - winH;
            if (posY < topBound) {
                posY = topBound;
                velY = Math.abs(velY) * 0.4;
            } else if (posY >= bottomBound) {
                posY = bottomBound;
                if (Math.abs(velY) > 0.1) {
                    velY = -velY * 0.4;
                    velX *= 0.7;
                } else {
                    velY = 0;
                    velX *= 0.8;
                    if (Math.abs(velX) < 0.01) {
                        velX = 0;
                        moveFloatWindowTo(posX, posY);
                        isParabolaRunning = false;
                        setTimeout(() => {
                            if (semKey(petState) === 'craving' && cookieState.active && !cookieState.consumed) {
                                wanderToCookie();
                            } else if (!MOVEMENT_BLOCKED_STATES.includes(semKey(petState))) {
                                resumeWander();
                            }
                        }, 1500);
                        return;
                    }
                }
            }

            if (!Number.isFinite(posX)) posX = Math.max(0, Math.min(screenWidth - getContainerWidth(), posX || screenWidth / 2));
            if (!Number.isFinite(posY)) posY = Math.max(0, Math.min(screenHeight - getContainerHeight(), posY || screenHeight / 2));

            moveFloatWindowTo(posX, posY);

            if (cookieState.active && !cookieState.consumed && checkCookieCollisionAt(posX, posY)) {
                isParabolaRunning = false;
                eatCookie();
                return;
            }

            requestAnimationFrame(step);
        };

        requestAnimationFrame(step);
    }

    // 追饼干移动
    // 重力模式：Y 始终取地面高度（窗口底部贴屏幕下缘），仅水平移动
    async function wanderToCookie() {
        if (!cookieState.active || cookieState.consumed) return;
        if (isDragging || isMouseHovering) return;

        isMoving = true;
        floatPetImg.classList.add('walking');

        // 计算目标位置（饼干位置）
        let targetX = cookieState.x - getPetCenterXOffset() + cookieSize / 2;

        // 重力模式下 Y 固定为地面高度（窗口底部贴屏幕下缘），仅水平移动
        // 从窗口真实位置获取地面高度，避免 lastWindowY 脱节导致整窗出屏
        let groundY;
        if (moveMode === 'gravity') {
            const wa = await getWorkAreaAt(lastWindowX + getPetCenterXOffset(), lastWindowY + getPetBottomOffset());
            groundY = wa.y + wa.height - getContainerHeight();
        }

        const dx = targetX - lastWindowX;
        const dist = Math.abs(dx);
        if (dist < 5) {
            // 到达饼干
            isMoving = false;
            floatPetImg.classList.remove('walking');
            eatCookie();
            return;
        }

        // 朝饼干方向移动（仅水平）
        const stepX = (dx / dist) * MOVE_SPEED;
        const maxStep = MOVE_SPEED * 2;
        let clampedStepX = Math.max(-maxStep, Math.min(maxStep, stepX));

        // 朝向翻转
        if (clampedStepX > 0) {
            floatPetImg.classList.add('flip');
        } else if (clampedStepX < 0) {
            floatPetImg.classList.remove('flip');
        }

        const totalSteps = Math.ceil(dist / MOVE_SPEED);
        let currentStep = 0;

        const moveStep = () => {
            if (!isMoving || isDragging || !window.electronAPI || isMouseHovering) {
                floatPetImg.classList.remove('walking');
                isMoving = false;
                return;
            }

            // 检查饼干是否还在
            if (!cookieState.active || cookieState.consumed) {
                floatPetImg.classList.remove('walking');
                isMoving = false;
                return;
            }

            currentStep++;
            if (currentStep >= totalSteps) {
                lastWindowX = targetX;
            } else {
                lastWindowX += clampedStepX;
            }

            if (moveMode === 'gravity') {
                // 重力模式下 Y 始终固定在地面
                lastWindowY = groundY;
            }

            // X 方向边界限制
            const winW = getContainerWidth();
            if (lastWindowX < screenX) {
                lastWindowX = screenX;
            } else if (lastWindowX + winW > screenX + screenWidth) {
                lastWindowX = screenX + screenWidth - winW;
            }

            if (!Number.isFinite(lastWindowX)) lastWindowX = 0;
            if (!Number.isFinite(lastWindowY)) lastWindowY = 0;

            moveFloatWindowTo(lastWindowX, lastWindowY);

            // 检查碰撞
            if (checkCookieCollisionAt(lastWindowX, lastWindowY)) {
                floatPetImg.classList.remove('walking');
                isMoving = false;
                eatCookie();
                return;
            }

            // 饼干移动后重新计算方向
            if (currentStep < totalSteps) {
                setTimeout(moveStep, MOVE_INTERVAL_MS);
            } else {
                // 到达后如果饼干还在，继续追
                floatPetImg.classList.remove('walking');
                isMoving = false;
                if (cookieState.active && !cookieState.consumed && semKey(petState) === 'craving') {
                    setTimeout(() => wanderToCookie(), 100);
                }
            }
        };

        moveStep();
    }

    // 随机游荡
    // 重力模式：窗口顶部（posY）始终贴地 → groundY = waY + waH - winH，仅水平移动
    async function wander() {
        if (isMoving || isDragging || isMouseHovering) return;

        // 被阻止移动的状态（吃饭/发呆/工作）
        if (MOVEMENT_BLOCKED_STATES.includes(semKey(petState))) return;

        // 嘴馋状态：追饼干
        if (semKey(petState) === 'craving' && cookieState.active && !cookieState.consumed) {
            wanderToCookie();
            return;
        }

        if (semKey(petState) !== 'wandering') return;

        isMoving = true;

        // 动态获取桌宠当前所在显示器的工作区：避免被拖到副屏后仍按主屏边界移动，导致"瞬移"回/出屏
        let wa;
        try {
            wa = await getWorkAreaAt(lastWindowX + getPetCenterXOffset(), lastWindowY + getPetBottomOffset());
        } catch (e) {
            wa = { x: screenX, y: screenY, width: screenWidth, height: screenHeight };
        }
        const waX = wa.x, waY = wa.y, waW = wa.width, waH = wa.height;

        const margin = 20;
        const winW = getContainerWidth();
        const winH = getContainerHeight();
        // 地面 y 坐标（窗口顶部 y 值）：groundY = waY + waH - winH — 窗口底部正好贴屏幕下缘
        const groundY = waY + waH - winH;
        let targetX, targetY;

        if (moveMode === 'gravity') {
            // 重力模式：仅左右平移，Y 永远固定在地面，x 轴目标不远于当前 1/5 屏宽范围内
            const maxMoveRange = waW / 5;
            const minX = waX + margin;
            const maxX = waX + waW - winW - margin;
            const currentX = Number.isFinite(window.screenX) ? window.screenX : lastWindowX;
            const randomOffset = (Math.random() - 0.5) * 2 * maxMoveRange;
            targetX = Math.max(minX, Math.min(maxX, currentX + randomOffset));
            targetY = groundY;
        } else {
            // 自由模式：目标点距离当前位置不超过屏幕宽度的 1/3，底部留出任务栏高度
            const maxRange = Math.min(waW, waH) / 3;
            const taskbarOffset = 48;
            const minX = waX + margin;
            const maxX = waX + waW - winW - margin;
            const minY = waY + margin;
            const maxY = waY + waH - winH - margin - taskbarOffset;
            const randomOffsetX = (Math.random() - 0.5) * 2 * maxRange;
            const randomOffsetY = (Math.random() - 0.5) * 2 * maxRange;
            targetX = Math.max(minX, Math.min(maxX, lastWindowX + randomOffsetX));
            targetY = Math.max(minY, Math.min(maxY, lastWindowY + randomOffsetY));
        }

        const dx = targetX - lastWindowX;
        const dy = targetY - lastWindowY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) {
            isMoving = false;
            floatPetImg.classList.remove('walking');
            const waitTime = 2000 + Math.random() * 4000;
            wanderTimer = setTimeout(() => {
                if (!isDragging) wander();
            }, waitTime);
            return;
        }

        const stepX = (dx / dist) * MOVE_SPEED;
        const stepY = (dy / dist) * MOVE_SPEED;
        const maxStep = MOVE_SPEED * 2;
        let clampedStepX = Math.max(-maxStep, Math.min(maxStep, stepX));
        let clampedStepY = Math.max(-maxStep, Math.min(maxStep, stepY));
        // 重力模式：只走水平方向，Y 由物理系统管理
        if (moveMode === 'gravity') {
            clampedStepY = 0;
        }
        const totalSteps = Math.ceil((moveMode === 'gravity' ? Math.abs(dx) : dist) / MOVE_SPEED);
        let currentStep = 0;

        floatPetImg.classList.add('walking');

        if (stepX > 0) {
            floatPetImg.classList.add('flip');
        } else if (stepX < 0) {
            floatPetImg.classList.remove('flip');
        }

        const moveStep = () => {
            if (!isMoving || isDragging || !window.electronAPI || isMouseHovering) {
                floatPetImg.classList.remove('walking');
                isMoving = false;
                return;
            }

            currentStep++;
            if (currentStep >= totalSteps) {
                lastWindowX = targetX;
                lastWindowY = targetY;
            } else {
                lastWindowX += clampedStepX;
                lastWindowY += clampedStepY;
            }

            if (!Number.isFinite(lastWindowX)) lastWindowX = 0;
            if (!Number.isFinite(lastWindowY)) lastWindowY = 0;

            // 重力模式：Y 始终固定在地面（窗口底部贴屏幕下缘），避免 lastWindowY 脱节
            if (moveMode === 'gravity') {
                lastWindowY = groundY;
            }

            // 左右边界：整窗始终在 workArea 内
            if (lastWindowX < waX) {
                lastWindowX = waX;
                if (moveMode !== 'gravity') clampedStepX = -Math.abs(clampedStepX) * 0.8;
            } else if (lastWindowX + winW > waX + waW) {
                lastWindowX = waX + waW - winW;
                if (moveMode !== 'gravity') clampedStepX = Math.abs(clampedStepX) * 0.8;
            }

            // 上下边界（仅自由模式：重力模式下 Y 由 groundY 固定，不做边界检测）
            if (moveMode !== 'gravity') {
                if (lastWindowY < waY) {
                    lastWindowY = waY;
                    clampedStepY = Math.abs(clampedStepY) * 0.8;
                } else if (lastWindowY > groundY) {
                    lastWindowY = groundY;
                    clampedStepY = -Math.abs(clampedStepY) * 0.8;
                }
            }

            moveFloatWindowTo(lastWindowX, lastWindowY);

            if (currentStep < totalSteps) {
                setTimeout(moveStep, MOVE_INTERVAL_MS);
            } else {
                floatPetImg.classList.remove('walking');
                isMoving = false;
                const waitTime = 2000 + Math.random() * 4000;
                setTimeout(() => {
                    if (!isDragging) wander();
                }, waitTime);
            }
        };

        moveStep();
    }

    function startWander() {
        if (wanderTimer) clearTimeout(wanderTimer);
        wanderTimer = setTimeout(() => wander(), 3000);
    }

    function pauseWander() {
        isMoving = false;
        if (wanderTimer) {
            clearTimeout(wanderTimer);
            wanderTimer = null;
        }
    }

    function resumeWander() {
        if (wanderTimer) {
            clearTimeout(wanderTimer);
            wanderTimer = null;
        }
        isMoving = false;
        if (!isDragging && !isMouseHovering) {
            wanderTimer = setTimeout(() => wander(), 2000);
        }
    }

    startWander();

    // ===== 桌宠状态管理 =====

    const MOVEMENT_BLOCKED_STATES = ['eating', 'daydreaming', 'working', 'sleeping'];
    const STATE_DURATIONS = {
        eating: 8000,
        daydreaming: 6000,
        working: 7000,
        angry: 4000,
        craving: 30000,
        eating_cookie: 3000,
        sleeping: 10000
    };

    // 对外暴露：设置面板「▶ 预览」按钮 → 主进程转发 float-preview-state → 此处执行
    // （进入该状态并播放其配置特效；状态结束后照常自动随机切换）
    window.__previewPetState = (s) => { if (typeof setPetState === 'function') setPetState(s); };

    function setPetState(newState) {
        if (petStateTimer) {
            clearTimeout(petStateTimer);
            petStateTimer = null;
        }

        // 输入可能是语义键（内部流程 wandering/craving/…）或贴图原名（AI/链/预览/随机切换），
        // 统一归一为「已注册的贴图原名」存储；运行时特殊判断一律走 semKey()，双轨只在此收敛一次。
        const sk = semKey(newState);
        const target = (sk !== null) ? semName(sk) : newState;

        const oldState = petState;
        petState = target;

        // 状态切换动画：小幅度上下拉伸
        if (oldState !== target && sk !== 'wandering') {
            playStateTransitionAnimation();
        }

        // 更新贴图
        if (PET_IMGS[target]) {
            floatPetImg.src = PET_IMGS[target]();
        }

        // 移除之前的特殊状态样式并播放该状态配置的特效
        clearStateEffects();

        // 处理特殊状态（按语义键识别；陌生原名状态走最后通用分支，播放其配置特效）
        if (sk === 'craving') {
            pauseWander();
            applyStateEffect(target);
            if (!isDragging && !isMouseHovering && !isParabolaRunning) {
                wanderToCookie();
            }
        } else if (sk === 'eating_cookie') {
            pauseWander();
            applyStateEffect(target);
        } else if (sk === 'sleeping') {
            pauseWander();
            applyStateEffect(target);
        } else if (sk === 'angry') {
            pauseWander();
            applyStateEffect(target);
        } else if (MOVEMENT_BLOCKED_STATES.includes(sk)) {
            pauseWander();
            applyStateEffect(target);
        } else if (sk === 'wandering') {
            applyStateEffect(target); // 默认无特效
            if (!isDragging && !isMouseHovering && !cookieState.active) {
                resumeWander();
            }
        } else {
            // 通用/陌生原名状态（如 浮窗_打鼓.png → '打鼓'）：正常播放用户配置的特效
            applyStateEffect(target);
        }

        // 定时状态切换：状态结束后进行随机切换（而非强制回到游荡）
        const duration = (STATE_DURATIONS[sk] != null) ? STATE_DURATIONS[sk] : DYNAMIC_STATE_DURATION;
        if (duration) {
            petStateTimer = setTimeout(() => {
                if (petState === target) {
                    // 状态链推进（链中状态优先）
                    if (activeChain && activeChain.states[activeChain.index] === target) {
                        const nextIdx = activeChain.index + 1;
                        if (nextIdx < activeChain.states.length) {
                            activeChain.index = nextIdx;
                            if (sk === 'sleeping') {
                                const zzzEl = document.getElementById('zzzEffect');
                                if (zzzEl) zzzEl.classList.remove('show');
                            }
                            setPetState(activeChain.states[nextIdx]);
                            return;
                        }
                        activeChain = null;
                    }
                    if (sk === 'craving') {
                        // 嘴馋超时：回到游荡
                        setPetState('wandering');
                    } else if (sk === 'eating_cookie') {
                        // 吃饼干结束后恢复比例
                        floatPetImg.classList.remove('eating-stretch');
                        resetPetScale();
                        setPetState('wandering');
                    } else if (sk === 'sleeping') {
                        // 睡觉结束后移除zzz，进行随机切换
                        const zzzEl = document.getElementById('zzzEffect');
                        if (zzzEl) zzzEl.classList.remove('show');
                        randomStateTransition();
                    } else {
                        // 其他状态结束后随机切换（可能继续相同状态或切换到其他状态）
                        randomStateTransition();
                    }
                }
            }, duration);
        }
    }

    // 清除当前状态特效（循环动作类 + Zzz 标记），并复位可能残留的 transform/旧类。
    // 粒子特效为一次性、独立 DOM，会自动消失，无需处理。
    function clearStateEffects() {
        CLS_STATE_FX.forEach(c => floatPetImg.classList.remove(c));
        const zzzEl = document.getElementById('zzzEffect');
        if (zzzEl) zzzEl.classList.remove('show');
        floatPetImg.classList.remove('state-transition', 'eating-stretch');
        resetPetScale();
    }

    // 播放某状态配置的特效：1 个循环动作 + 1 个叠加标记 + 任意粒子，可自由叠加。
    // 先整体清空旧特效/残留缩放，再按类型逐项播放，保证不会有上一下的动画残留停不下来。
    function applyStateEffect(state) {
        clearStateEffects();
        if (isDragging) return;
        getStateEffects(state).forEach(k => {
            const eff = EFFECT_CATALOG[k];
            if (!eff) return;
            if (eff.particles) {
                spawnParticles(eff.particles);
            } else if (eff.zzz) {
                const zzzEl = document.getElementById('zzzEffect');
                if (zzzEl) zzzEl.classList.add('show');
            } else if (eff.class) {
                floatPetImg.classList.add(eff.class);
            }
        });
    }

    // 状态切换动画（小幅度上下拉伸）
    function playStateTransitionAnimation() {
        floatPetImg.classList.remove('state-transition');
        void floatPetImg.offsetWidth; // 强制回流
        floatPetImg.classList.add('state-transition');
        setTimeout(() => {
            floatPetImg.classList.remove('state-transition');
        }, 500);
    }

    // 恢复桌宠原始比例
    function resetPetScale() {
        floatPetImg.style.transform = '';
    }

    // 睡觉状态冒出zzz
    function showZzzEffect() {
        // zzz效果通过CSS动画实现
    }

    // 随机状态切换（所有非饼干状态都可参与）
    function randomStateTransition() {
        if (isDragging || cookieState.active) {
            // 拖拽或饼干期间触发切换：不能直接放弃，否则该阻塞状态将无定时器可推进而永久卡死。
            // 稍后重试，拖拽/饼干恢复后即可继续推进状态机。
            if (petStateTimer) clearTimeout(petStateTimer);
            const current = petState;
            petStateTimer = setTimeout(() => { if (petState === current) randomStateTransition(); }, 2000);
            return;
        }
        if (semKey(petState) === 'craving' || semKey(petState) === 'eating_cookie') return;

        // behaviorKeepProbability概率维持当前行为（包括游荡）
        if (Math.random() < behaviorKeepProbability) {
            // 保持当前状态，重新启动状态定时器
            if (semKey(petState) === 'wandering' && !isMouseHovering) {
                resumeWander();
            } else {
                // 重新启动当前状态的定时器，以便下次再检查
                const duration = (STATE_DURATIONS[semKey(petState)] != null) ? STATE_DURATIONS[semKey(petState)] : DYNAMIC_STATE_DURATION;
                if (duration) {
                    if (petStateTimer) clearTimeout(petStateTimer);
                    const currentState = petState;
                    petStateTimer = setTimeout(() => {
                        if (petState === currentState) {
                            randomStateTransition();
                        }
                    }, duration);
                }
            }
            return;
        }

        // 小概率开启一条可打断的状态链（用户可在设置面板配置）
        if (Math.random() < 0.3) {
            const chain = pickStateChain();
            if (chain) {
                activeChain = null; // 直接覆盖旧链，不做打断状态切换
                activeChain = chain;
                setPetState(chain.states[0]);
                return;
            }
        }

        // 切换到其他状态（含从图包动态注册的新浮窗_* 状态，保证新状态无需入链也可随机触发）
        // 注：wandering 也作为候选，否则离开游荡后就再也回不来，导致状态切换失衡
        // 注：候选按语义键排除瞬态（嘴馋/吃饼干由饼干/预览/AI 驱动，不参与随机）
        const allStates = KNOWN_STATES.filter(s => {
            const sk = semKey(s);
            return sk !== 'craving' && sk !== 'eating_cookie';
        });
        // 过滤掉当前状态
        const otherStates = allStates.filter(s => s !== petState);

        // 使用用户配置的"状态切换概率"做加权随机（相对/绝对模式都归一化为权重）。
        // 未单独配置的状态走缺省权重；配置为 0 的状态不参与候选。
        // 默认缺省中 wandering 的权重随 behaviorKeepProbability 线性变化，保证默认体验与旧版一致。
        const stateW = {};
        let totalW = 0;
        otherStates.forEach(s => {
            const w = stateProb(s);
            stateW[s] = w;
            totalW += w;
        });

        let newState = otherStates[0] || 'wandering';
        if (totalW > 0 && otherStates.length) {
            let r = Math.random() * totalW;
            for (const s of otherStates) {
                r -= stateW[s];
                if (r <= 0) { newState = s; break; }
            }
        }
        setPetState(newState);
    }

    // 移动窗口（饼干窗口独立，无需同步）
    function moveFloatWindowTo(newX, newY) {
        lastWindowX = newX;
        lastWindowY = newY;

        if (window.electronAPI && Number.isFinite(newX) && Number.isFinite(newY)) {
            window.electronAPI.moveFloatWindow(Math.round(newX), Math.round(newY));
        }
    }

    // ===== 饼干系统（IPC方式） =====

    // 计算到饼干的距离
    function getDistanceToCookie(posX, posY) {
        if (!cookieState.active) return Infinity;
        const petCenterX = posX + getPetCenterXOffset();
        const petCenterY = posY + getPetBottomOffset() - currentPetSize / 2;
        const cookieCenterX = cookieState.x + cookieSize / 2;
        const cookieCenterY = cookieState.y + cookieSize / 2;
        const dx = petCenterX - cookieCenterX;
        const dy = petCenterY - cookieCenterY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // 检查桌宠与饼干碰撞（使用指定位置）
    function checkCookieCollisionAt(posX, posY) {
        if (!cookieState.active || cookieState.consumed) return false;

        const petCenterX = posX + getPetCenterXOffset();
        const petCenterY = posY + getPetBottomOffset() - currentPetSize / 2;
        const cookieCenterX = cookieState.x + cookieSize / 2;
        const cookieCenterY = cookieState.y + cookieSize / 2;

        const dx = petCenterX - cookieCenterX;
        const dy = petCenterY - cookieCenterY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        return dist < (currentPetSize / 2 + cookieSize / 2);
    }

    // 启动饼干定时生成
    function startCookieSpawner() {
        if (cookieSpawnTimer) clearTimeout(cookieSpawnTimer);
        if (!cookieSpawnEnabled) return; // 未启用则不生成
        // 首次生成延迟短一些（5秒），后续按正常间隔
        const spawnDelay = cookieFirstSpawn ? 5000 : (COOKIE_SPAWN_INTERVAL + Math.random() * 30000);
        cookieFirstSpawn = false;
        cookieSpawnTimer = setTimeout(() => {
            if (cookieSpawnEnabled && !cookieState.active && !isChatMode && !isDragging) {
                spawnCookie();
            }
            startCookieSpawner();
        }, spawnDelay);
    }

    // 生成饼干（通知主进程创建饼干窗口）
    function spawnCookie() {
        if (cookieState.active || isChatMode) return;

        // 选择屏幕角落位置（基于工作区）
        const margin = 50;
        // 使用 screen API 获取屏幕尺寸，并提供合理的回退值
        const screenW = window.screen ? (window.screen.availWidth || window.screen.width || 1920) : 1920;
        const screenH = window.screen ? (window.screen.availHeight || window.screen.height || 1080) : 1080;
        const availLeft = window.screen ? (window.screen.availLeft || 0) : 0;
        const availTop = window.screen ? (window.screen.availTop || 0) : 0;

        let corners;
        if (moveMode === 'gravity') {
            // 重力模式：桌宠只在底部行走，饼干仅生成在底部左右
            corners = [
                { x: availLeft + margin, y: availTop + screenH - cookieSize - margin },
                { x: availLeft + screenW - cookieSize - margin, y: availTop + screenH - cookieSize - margin }
            ];
        } else {
            // 自由模式：四个角落都可生成
            corners = [
                { x: availLeft + margin, y: availTop + margin },
                { x: availLeft + screenW - cookieSize - margin, y: availTop + margin },
                { x: availLeft + margin, y: availTop + screenH - cookieSize - margin },
                { x: availLeft + screenW - cookieSize - margin, y: availTop + screenH - cookieSize - margin }
            ];
        }
        const corner = corners[Math.floor(Math.random() * corners.length)];

        // 请求主进程创建饼干窗口
        if (window.electronAPI) {
            window.electronAPI.requestSpawnCookie(corner.x, corner.y);
        }
    }

    // 吃饼干
    function eatCookie() {
        if (!cookieState.active || cookieState.consumed) return;

        cookieState.consumed = true;
        interruptChain(); // 发现饼干，打断当前状态链
        setPetState('eating_cookie');

        // 通知主进程吃掉饼干
        if (window.electronAPI) {
            window.electronAPI.requestEatCookie();
        }

        // 吃饼干持续数秒后回到游荡
        setTimeout(() => {
            cookieState.active = false;
            cookieState.consumed = false;
        }, STATE_DURATIONS.eating_cookie);
    }

    // ===== 饼干IPC通信 =====
    if (window.electronAPI) {
        // 监听饼干位置更新（从主进程转发）
        window.electronAPI.onCookiePositionUpdate((pos) => {
            if (pos && pos.active) {
                cookieState.active = true;
                cookieState.x = pos.x;
                cookieState.y = pos.y;
                cookieState.consumed = false;
                // 同步饼干大小
                if (typeof pos.size === 'number') {
                    cookieSize = pos.size;
                }

                // 检查是否在追逐范围内（仅睡觉和工作状态阻止追逐）
                const dist = getDistanceToCookie(lastWindowX, lastWindowY);
                const chaseSk = semKey(petState);
                if (dist < COOKIE_CHASE_DISTANCE &&
                    chaseSk !== 'craving' &&
                    chaseSk !== 'eating_cookie' &&
                    chaseSk !== 'sleeping' &&
                    chaseSk !== 'working' &&
                    !isDragging && !isMouseHovering) {
                    setPetState('craving');
                }
            }
        });

        // 监听饼干拖拽超时
        window.electronAPI.on('cookie-drag-timeout', () => {
            if (cookieState.active && !cookieState.consumed) {
                if (Math.random() < ANGRY_PROBABILITY) {
                    setPetState('angry');
                }
            }
        });

        // 监听饼干被吃掉
        window.electronAPI.on('cookie-consumed', () => {
            cookieState.active = false;
            cookieState.consumed = false;
            if (semKey(petState) === 'eating_cookie') {
                // 保持吃饼干状态直到定时器切换
            } else {
                setPetState('wandering');
            }
        });

        // 监听饼干生成开关
        window.electronAPI.onCookieSpawnEnabled((enabled) => {
            cookieSpawnEnabled = !!enabled;
            if (cookieSpawnEnabled) {
                startCookieSpawner();
            } else {
                if (cookieSpawnTimer) {
                    clearTimeout(cookieSpawnTimer);
                    cookieSpawnTimer = null;
                }
                cookieState.active = false;
                cookieState.consumed = false;
            }
        });
    }

    startCookieSpawner();

    // 双击Ctrl生成饼干由主进程 before-input-event 全局处理

    // 定期上报桌宠地面位置（用于饼干窗口物理）
    setInterval(() => {
        if (!isChatMode && window.electronAPI) {
            // 发送实际地板位置（屏幕底部），让饼干底部对齐地板
            const groundY = screenY + screenHeight;
            window.electronAPI.sendFloatGroundPosition(groundY);
        }
    }, 200);

    // ===== 桌宠状态定时随机切换 =====
    // 游荡被视为与其他状态平等的状态，仅触发概率不同
    // 游荡状态无持续时间，由这个定时器驱动切换
    // 非游荡状态由各自的 STATE_DURATIONS 定时器驱动切换
    setInterval(() => {
        if (cookieState.active || isDragging || isMouseHovering) return;
        // 仅游荡状态由此定时器驱动；其他状态由各自定时器处理
        if (semKey(petState) !== 'wandering') return;
        randomStateTransition();
    }, 5000);

    // ===== 状态机看门狗：长时间运行后若被卡住（悬停/拖动标志滞留、定时器丢失）则解除，避免"卡死不切换状态" =====
    setInterval(() => {
        // 1) 鼠标悬停标志超时自愈：长时间没有鼠标事件却仍标记悬停 → 解除并恢复游荡
        if (isMouseHovering && Date.now() - lastPetMouseEvent > 1200) {
            isMouseHovering = false;
            if (floatBubble) floatBubble.classList.remove('show');
        }
        if (isDragging || isMouseHovering || isParabolaRunning || cookieState.active || isChatMode) return;
        const psk = semKey(petState);
        // 2) 游荡卡住（没有被移动、也没有在悬停/拖拽）→ 重新唤醒游荡
        if (psk === 'wandering' && !isMoving) {
            wander();
        } else if (psk !== 'wandering' && psk !== 'craving' && psk !== 'eating_cookie' && !petStateTimer) {
            // 3) 非游荡状态但状态定时器丢失（被 clear 而没重建）→ 强制推进一次，避免永久停在原地
            randomStateTransition();
        }
    }, 2000);

    // 窗口失焦：若拖拽被中断（鼠标在窗口外松开/切窗口），强制复位拖拽状态，避免 isDragging 永久为 true 卡死
    window.addEventListener('blur', () => {
        if (isDragging) {
            isDragging = false;
            stopPendulum();
            isMouseHovering = false;
            if (floatBubble) floatBubble.classList.remove('show');
            if (pausedEatingOnDrag) {
                pausedEatingOnDrag = false;
                if (semKey(petState) === 'eating' || semKey(petState) === 'eating_cookie') {
                    floatPetImg.classList.add('eating-stretch');
                }
            }
            floatPetImg.src = (PET_IMGS[petState] || ORIGINAL_PET_SRC)();
        }
    });

    // 右键桌宠进入聊天
    floatPet.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        enterChatMode();
    });

    // 监听桌宠大小变化
    if (window.electronAPI) {
        window.electronAPI.onFloatPetSize((size) => {
            currentPetSize = size;
            document.documentElement.style.setProperty('--float-pet-size', size + 'px');
            updateWindowSize();
            // 修复回声循环：float-pet-size 是主进程下发的状态通知（值来自 index 或用户保存），
            // 这里只应用，绝不能再 syncFloatSizeToSettings 上报回去 —— 否则会形成
            // config-updated -> applySizeSettings -> setFloatPetSize -> float 回传 ->
            // sync-float-size -> index onSyncFloatSize -> syncConfig -> 广播 -> …的无限循环，
            // 表现为"打开 index 时 [float] config updated 日志刷屏 + 设置被覆盖"。
        });

        window.electronAPI.onFloatMoveMode((mode) => {
            moveMode = mode;
        });

        // 监听行为保持概率设置
        if (window.electronAPI && window.electronAPI.on) {
            window.electronAPI.on('set-behavior-keep-prob', (event, prob) => {
                if (typeof prob === 'number') {
                    behaviorKeepProbability = Math.max(0, Math.min(1, prob / 100));
                }
            });
            // 监听开发者模式状态
            window.electronAPI.on('set-dev-mode', (event, enabled) => {
                devMode = !!enabled;
            });
            // 监听饼干大小更新
            window.electronAPI.on('cookie-size-update', (event, size) => {
                if (typeof size === 'number') {
                    cookieSize = size;
                }
            });
        }

        window.electronAPI.onFloatBounceWindows((enabled) => {
            bounceOffWindows = !!enabled;
        });

        // 监听窗口最小化事件（兼容兜底）
        window.electronAPI.onWindowMinimized && window.electronAPI.onWindowMinimized(() => {
            isWindowMinimized = true;
        });

        // 监听完整运行状态同步（主进程权威状态）
        if (window.electronAPI && window.electronAPI.onPetRuntimeState) {
            window.electronAPI.onPetRuntimeState((state) => {
                if (!state || typeof state !== 'object') return;

                isWindowMinimized = !!state.isWindowMinimized;

                if (Number.isInteger(state.floatSessionId)) {
                    currentFloatSessionId = state.floatSessionId;
                }

                floatIsClosing = false;

                console.log('[float] runtime state updated', {
                    isWindowMinimized,
                    floatIsClosing,
                    currentFloatSessionId,
                    shouldPauseStats: shouldPauseFloatStats()
                });
            });
        }

        // 监听浮窗准备关闭通知
        if (window.electronAPI && window.electronAPI.onFloatPrepareClose) {
            window.electronAPI.onFloatPrepareClose((payload) => {
                floatIsClosing = true;
                isWindowMinimized = true;

                console.log('[float] prepare close', {
                    payload,
                    currentFloatSessionId
                });
            });
        }
    }
}

// ===== 记忆系统函数（浮窗通过主窗口中转，统一使用同一个记忆池） =====

async function loadMemory() {
    const items = await window.electronAPI.getMemoryItems();
    if (Array.isArray(items)) {
        memoryItems = items;
    } else {
        throw new Error('Memory data format error');
    }
}

async function addMemoryItem(text) {
    if (text && text.trim()) {
        memoryItems.push({ text: text.trim() });
        await window.electronAPI.saveMemoryItem(text.trim());
    }
}

function cleanReply(reply) {
    if (!reply) return '';
    let cleaned = reply.replace(/\[MEMORY:\s*[^\]]+\]/g, '');
    cleaned = cleaned.replace(/\[SHORT_MEMORY:\s*[^\]]+\]/g, '');
    cleaned = cleaned.replace(/<MOOD:[^>]+>/g, '');
    cleaned = cleaned.replace(/<CMD:[^>]+>/g, '');
    cleaned = cleaned.replace(/<EFFECT:[^>]+>/g, '');
    cleaned = cleaned.replace(/<STATE:[^>]+>/g, '');
    cleaned = cleaned.replace(/[\r\n\u2028\u2029]+/g, '');
    cleaned = cleaned.replace(/[\u200b\u200c\u200d\u200e\u200f]+/g, '');
    return cleaned;
}

function parseMoodFromReply(reply) {
    if (!reply) return null;
    const match = reply.match(/<MOOD:([^>]+)>/);
    if (match) {
        const mood = match[1].trim();
        if (moodList.includes(mood)) {
            return mood;
        }
    }
    return null;
}

function parseStateFromReply(reply) {
    if (!reply) return null;
    const match = reply.match(/<STATE:([^>]+)>/);
    if (match) {
        // 状态 = 贴图扫描原名（无映射表）：AI 输出的是设置面板列出的可选原名。
        // 去掉首尾空白与常见引号/标点后再精确匹配，AI 输出 <STATE:"打鼓"> 也能命中。
        const raw = match[1].trim().replace(/^['"“”「」《》\s]+|['"“”「」《》\s]+$/g, '');
        if (isKnownState(raw)) {
            return raw;
        }
    }
    return null;
}

// 将消息 content（可能是字符串 or 文本/图片块数组）展平为纯文本，file_id 以 [截图:<id>] 标注
function flattenMessageContent(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.map(b => {
            if (!b) return '';
            if (b.type === 'text') return b.text || '';
            if (b.type === 'file') return `[截图:${b.file_id || '?'}]`;
            return JSON.stringify(b);
        }).join('\n');
    }
    return String(content == null ? '' : content);
}

// 删除本次对话中未被保留（keepSet 之外）的截图：远程 DELETE /files/{file_id} + 本地缓存
async function cleanupNonMemoryImages(keepSet) {
    for (const img of pendingConversationImages) {
        if (keepSet && keepSet.has(img.fileId)) continue;
        try { if (window.electronAPI && window.electronAPI.deleteDeepSeekFile) await window.electronAPI.deleteDeepSeekFile(img.fileId); } catch (e) {}
        try { if (window.electronAPI && window.electronAPI.deleteScreenshotCache && img.imagePath) await window.electronAPI.deleteScreenshotCache(img.imagePath); } catch (e) {}
    }
}

async function summarizeMemoryOnChatClose() {
    // 防止被 close 拦截路径与 beforeunload 后备路径同时触发而重复生成记忆
    if (memorySummarizeInFlight) return;

    // 若未启用记忆，或没有对话，仍要清理本次上传的截图 file_id，避免在 Files API 上残留
    if (!config.enableMemory || chatHistory.length === 0 || !config.apiKey) {
        const skip = 'memory summary skipped enableMemory=' + config.enableMemory + ' history=' + chatHistory.length + ' hasKey=' + !!config.apiKey;
        console.warn('[float]', skip);
        if (window.electronAPI && window.electronAPI.logToMain) window.electronAPI.logToMain('warn', '[float:summary] ' + skip);
        if (pendingConversationImages.length > 0) {
            await cleanupNonMemoryImages(new Set());
            pendingConversationImages = [];
        }
        return;
    }

    memorySummarizeInFlight = true;
    try {
        // 统一请求变量放在 try 顶部，catch 中也能安全引用
        const cred = chatCredentials();
        const gUrl = cred.base;
        const gKey = cred.key;
        // 渲染进程 console 默认不可见，总结日志统一走主进程打印（renderer-log -> 主进程终端）
        const logMain = (level, msg) => {
            try { if (window.electronAPI && window.electronAPI.logToMain) window.electronAPI.logToMain(level, msg); } catch (e) {}
        };

        // 已保存的记忆（长期），提示AI不要重复
        const existingMemoriesText = memoryItems.length > 0
            ? '\n\n已保存的记忆（请勿重复）：\n' + memoryItems.map((m, i) => `${i + 1}. ${m.text != null ? m.text : (m.description || '')}`).join('\n')
            : '';

        // ===== 文本 + 图像记忆统一交给 vision 模型，混合输入 =====
        // 按对话顺序重建 user content：每条消息 = 文本块，紧接着该消息内嵌的截图文件块，
        // 文本与图片混合交替输入，vision 模型一次性输出文本记忆 + KEEP 图像记忆。
        // 给每张截图按出现顺序编号（imageSequence / 【第N张截图】标记），
        // 让模型用"编号"而非易抄错的长 UUID 引用图片，保证 KEEP 行能被程序解析。
        // 用户回复含 "forcememory" 时：总结动作仍由 AI 完成，但注入强制指令，
        // 要求 AI 必须把最后一张截图输出为 KEEP:<编号>|test（描述固定 test）。
        // 触发关键词（容错常见拼写变体：forcememory / forcemomory / force memory / force-memory / force_memory）
        const FORCE_MEMORY_RE = /forcem(?:em|om)ory|force[- _]?memory/i;
        const FORCE_MEMORY_RE_G = /forcem(?:em|om)ory|force[- _]?memory/gi;
        const hasForceMemory = chatHistory.some(msg => {
            if (!msg || msg.role !== 'user') return false;
            const c = msg.content;
            if (typeof c === 'string') return FORCE_MEMORY_RE.test(c);
            if (Array.isArray(c)) return c.some(b => b && b.type === 'text' && FORCE_MEMORY_RE.test(b.text || ''));
            return false;
        });
        const blocks = [];
        const imageSequence = []; // 顺序与 blocks 中文件块一一对应（存 file_id）
        // 预扫描：按出现顺序收集所有截图 file_id，供"强制图像记忆"指令引用最后一张
        chatHistory.forEach(msg => {
            const c = msg.content;
            if (Array.isArray(c)) {
                c.filter(b => b && b.type === 'file' && b.file_id).forEach(fb => imageSequence.push(fb.file_id));
            }
        });
        // 用户回复含 "forcememory" 且本次对话有截图：注入强制指令，
        // 总结动作仍由 AI 完成，指令直接给出确切编号，要求 AI 必须输出 KEEP:<编号>|test
        const forceText = hasForceMemory && imageSequence.length > 0
            ? '【强制指令】用户要求强制执行图像记忆：本次总结必须将最后一张截图【第' + imageSequence.length + '张截图】输出为 KEEP:' + imageSequence.length + '|test（描述固定为 test，不含引号），不得遗漏、不得更改编号与描述。\n'
            : '';
        blocks.push({
            type: 'text',
            text: '以下是本次对话的完整内容，按发生顺序由 文本 和 屏幕截图 混合组成，每张截图前都有"【第N张截图】"标记（N 从 1 开始）。\n' +
                '请把整段对话（文本 + 截图）当作一个整体来理解：每张截图都出现于具体的对话上下文中，是对话的一部分（例如用户展示的成果、需要记住的画面、你分析过的内容），不要把它当作孤立图片，要结合前后文理解它在对话中的角色。\n' +
                '请统一提取整个对话中真正值得长期记忆的信息（文本条目与 KEEP 截图条目，都属于同一份记忆）：\n' +
                '- 文本条目：只记录用户偏好、重要事实、约定、重大事件，每行一条，不超过20字，没有则输出"无"。\n' +
                '- KEEP 截图条目：判定哪几张截图值得作为长期图像记忆保留（重要画面、关键结果、有价值的信息），只输出需保留项，每行格式 KEEP:<截图编号>|<简短描述>，编号用"【第N张截图】"里的数字（如 KEEP:1|用户的项目预算图），描述需体现该图在对话中的角色，限20字内，无需保留则输出"无"。\n' +
                (forceText ? forceText : '') +
                '先输出文本条目，再输出 KEEP 截图条目。'
        });
        let imgIdx = 0; // 已写入的截图编号（与 imageSequence 一一对应）
        for (const msg of chatHistory) {
            const roleName = msg.role === 'user' ? '用户' : '桌宠';
            const c = msg.content;
            const redact = (t) => hasForceMemory ? (t || '').replace(FORCE_MEMORY_RE_G, '') : (t || '');
            if (typeof c === 'string') {
                blocks.push({ type: 'text', text: `${roleName}：${redact(c)}` });
            } else if (Array.isArray(c)) {
                const textBlocks = c.filter(b => b && b.type === 'text' && b.text);
                const fileBlocks = c.filter(b => b && b.type === 'file' && b.file_id);
                const turnText = textBlocks.map(b => b.text).join('\n') || (fileBlocks.length ? '[截图]' : '');
                blocks.push({ type: 'text', text: `${roleName}：${redact(turnText)}` });
                // 该消息的图片按原顺序紧跟其文本块，实现"文本-图片"混合输入；
                // 每张图片前加一个文字编号标记，模型据此引用（KEEP:<编号>）
                for (const fb of fileBlocks) {
                    imgIdx++;
                    blocks.push({ type: 'text', text: `【第${imgIdx}张截图】` });
                    blocks.push({ type: 'file', file_id: fb.file_id });
                }
            }
        }
        logMain('info', '[float:summary] start model=deepseek-v4-flash-vision-exp images=' + pendingConversationImages.length + ' blocks=' + blocks.length + ' forceMemory=' + hasForceMemory + ' lastIdx=' + imageSequence.length + ' provider=' + (config.multimodalProvider || 'deepseek') + ' url=' + gUrl);

        const response = await fetch(gUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${gKey}`
            },
            body: JSON.stringify({
                model: 'deepseek-v4-flash-vision-exp',
                messages: [
                    {
                        role: 'system',
                        content: `你是一个记忆助手。请把对话文本与其间的屏幕截图当作一个整体来理解：截图不是孤立图片，而是所处对话上下文的组成部分（例如用户展示的画面、要记住的信息、你分析过的对象），提取记忆时要结合上下文判断每张截图的意义。\n\n重要规则：\n1. 只记录用户的偏好、重要事实、约定、重大事件等真正有长期价值的信息。\n2. 不要总结"桌宠做了什么"、"今天聊了什么"等日常琐事，除非涉及非常重大的事件。\n3. 没有值得长期记忆的内容就输出"无"。\n4. 文本记忆每行一条，每条不超过20字。\n5. 截图值得保留时输出 KEEP:<截图编号>|<简短描述>，编号是"【第N张截图】"里的阿拉伯数字（N从1开始），描述需体现该图在对话中的角色，限20字内。\n6. 严格检查已保存的记忆，不要重复保存相同或高度相似的内容。\n7. 先输出文本记忆，再输出 KEEP 行。${existingMemoriesText}`
                    },
                    {
                        role: 'user',
                        content: blocks
                    }
                ],
                max_tokens: 1024,
                temperature: 0.3
            })
        });

        const data = await response.json();
        if (!response.ok) {
            const errDetail = 'vision summary request failed status=' + response.status + ' body=' + JSON.stringify(data).substring(0, 300) + ' url=' + gUrl;
            console.warn('[float]', errDetail);
            logMain('warn', '[float:summary] ' + errDetail);
            throw new Error('summary vision request ' + response.status);
        }
        const summary = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) ? data.choices[0].message.content.trim() : '无';
        console.warn('[float] summary vision response:', JSON.stringify(summary).substring(0, 500));
        logMain('info', '[float:summary] vision response textLen=' + summary.length + ' preview=' + JSON.stringify(summary).substring(0, 300));

        // ===== 解析：文本记忆（非 KEEP 行）+ 图像记忆（KEEP 行）=====
        let textMemories = 0;
        for (const rawLine of summary.split('\n')) {
            const line = rawLine.trim();
            if (!line || /^KEEP:/i.test(line)) continue;
            const clean = line.replace(/^\d+\.\s*/, '').trim();
            if (clean.length > 1 && clean !== '无') {
                await addMemoryItem(clean);
                textMemories++;
            }
        }
        const keepSet = new Set();
        const addedImageMemories = [];
        // 按引用解析图片：优先支持数字编号（KEEP:1|…，对应【第N张截图】），
        // 也兼容直接填 file_id 的旧格式；顺带清理模型可能误输出的完整 URL/多余空白。
        const resolveImageRef = (ref) => {
            let r = ref.trim().replace(/^.*\/files\//, '');
            if (/^\d+$/.test(r)) {
                const idx = parseInt(r, 10) - 1;
                if (idx >= 0 && idx < imageSequence.length) {
                    const fid = imageSequence[idx];
                    return pendingConversationImages.find(im => im.fileId === fid) || null;
                }
                logMain('warn', '[float:summary] KEEP index out of range idx=' + (idx + 1) + ' total=' + imageSequence.length);
                return null;
            }
            return pendingConversationImages.find(im => im.fileId === r) || null;
        };
        for (const rawLine of summary.split('\n')) {
            const line = rawLine.trim();
            const m = line.match(/^KEEP:\s*([^\s|]+)\s*(?:\|\s*([^\n]*))?$/i);
            if (!m) continue;
            const info = resolveImageRef(m[1]);
            const desc = (m[2] || '').trim();
            if (info) {
                keepSet.add(info.fileId);
                addedImageMemories.push({
                    type: 'image',
                    fileId: info.fileId,
                    imagePath: info.imagePath,
                    imageUrl: info.imageUrl,
                    description: desc || '（截图记忆）',
                    time: info.time || Date.now()
                });
            } else {
                logMain('warn', '[float:summary] KEEP references unknown ref=' + m[1]);
            }
        }
        if (addedImageMemories.length > 0) {
            memoryItems.push(...addedImageMemories);
            if (window.electronAPI && window.electronAPI.memorySave) {
                await window.electronAPI.memorySave(memoryItems);
            }
        }
        logMain('info', '[float:summary] done textMemories=' + textMemories + ' imageMemories=' + addedImageMemories.length + ' keptFiles=' + keepSet.size);

        // ===== 清理本次对话中未被保留的截图 file_id（DELETE /files/{file_id}）=====
        await cleanupNonMemoryImages(keepSet);
        pendingConversationImages = [];
    } catch (error) {
        // 总结失败不应崩溃，统一打主进程日志便于排查（此前为静默失败，难以定位"地址/凭据"问题）
        const failDetail = 'memory summarize failed: ' + (error && error.message) + ' | url=' + gUrl + ' hasKey=' + !!gKey + ' provider=' + (config.multimodalProvider || 'deepseek') + ' screenshots=' + (pendingConversationImages ? pendingConversationImages.length : 0);
        console.warn('[float]', failDetail, error);
        if (window.electronAPI && window.electronAPI.logToMain) window.electronAPI.logToMain('error', '[float:summary] ' + failDetail);
    } finally {
        memorySummarizeInFlight = false;
    }
}

// 记忆总结进行中标记（桌面/聊天模式共用，防止重复生成记忆）
let memorySummarizeInFlight = false;
// 本次聊天会话是否已通过 IPC 关闭路径完成过记忆总结（beforeunload 后备据此去重）
let chatMemorySummarizedOnClose = false;

// 对话开始时，AI根据自身状态决定心情（用于立绘）
async function decideMoodByState() {
    if (!config.apiKey) {
        switchIllust(null);
        return;
    }
    try {
        const statsStr = Object.entries(stats)
            .map(([k, v]) => `${statNames[k]}: ${Math.round(v)}%`)
            .join(', ');

        const response = await fetch(config.apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            body: JSON.stringify({
                model: 'deepseek-v4-flash',
                messages: [
                    {
                        role: 'system',
                        content: '你是一个心情分析助手。根据桌宠的当前状态，分析它现在应该是什么心情。'
                    },
                    {
                        role: 'user',
                        content: `当前状态：${statsStr}\n可选心情：${moodList.join('、')}\n请只返回一个心情名称。`
                    }
                ],
                max_tokens: 10,
                temperature: 0.5
            })
        });

        const data = await response.json();
        const mood = data.choices[0].message.content.trim();
        if (moodList.includes(mood)) {
            switchIllust(mood);
        } else {
            switchIllust(null);
        }
    } catch (e) {
        switchIllust(null);
    }
}

const floatIllustImg = document.getElementById('floatIllustImg');

function switchIllust(mood) {
    if (!floatIllustImg) return;

    if (!mood || !moodList.includes(mood)) {
        mood = moodList[Math.floor(Math.random() * moodList.length)];
    }

    const moodImgPath = imgPath('mood_' + mood + '.png');
    const tempImg = new Image();
    tempImg.onload = function() {
        floatIllustImg.src = moodImgPath;
        floatIllustImg.classList.add('show');
    };
    tempImg.onerror = function() {
        floatIllustImg.src = imgPath('pet.png');
        floatIllustImg.classList.add('show');
    };
    tempImg.src = moodImgPath;
}

function bounceIllust() {
    if (!floatIllustImg) return;
    floatIllustImg.classList.remove('bounce');
    void floatIllustImg.offsetWidth;
    floatIllustImg.classList.add('bounce');
}

function hideIllust() {
    if (floatIllustImg) floatIllustImg.classList.remove('show');
}

// ===== 公共逻辑：聊天功能（两种模式都需要） =====

// 进入聊天模式（发送 IPC 给主进程）
function enterChatMode() {
    if (window.electronAPI && window.electronAPI.floatEnterChatMode) {
        window.electronAPI.floatEnterChatMode();
    }
}

// 关闭聊天（仅聊天模式下的关闭按钮使用）
if (!isChatMode) {
    chatCloseBtn.addEventListener('click', () => {
        // 浮窗模式下不应该有关闭按钮，但以防万一
        chatContainer.style.display = 'none';
        petContainer.style.display = 'flex';
    });
}

function addChatMessage(text, isUser, isAgentMode) {
    const msg = document.createElement('div');
    msg.className = `chat-message ${isUser ? 'user' : 'from-pet'}${isAgentMode ? ' agent-mode' : ''}`;

    let safeText = String(text == null ? '' : text);
    safeText = safeText.replace(/\[MEMORY:\s*[^\]]+\]/g, '');
    safeText = safeText.replace(/\[SHORT_MEMORY:\s*[^\]]+\]/g, '');
    safeText = safeText.replace(/<MOOD:[^>]+>/g, '');
    safeText = safeText.replace(/<CMD:[^>]+>/g, '');
    safeText = safeText.replace(/<EFFECT:[^>]+>/g, '');
    safeText = safeText.replace(/<STATE:[^>]+>/g, '');
    safeText = safeText.replace(/[\u200B-\u200F\uFEFF\u00AD\u2060\u180E\uFE00-\uFE0F\u2000-\u200A\u202F\u205F\u3000]+/g, ' ');
    safeText = safeText.replace(/[\uFE0E\uFE0F]/g, '');
    safeText = safeText.replace(/\s+/g, ' ');
    safeText = safeText.trim();

    if (isUser) {
        // 用户消息保持纯文本
        msg.textContent = safeText;
    } else {
        // AI 回复支持富文本渲染
        msg.innerHTML = renderMarkdown(safeText);
    }

    floatChatLog.appendChild(msg);
    floatChatLog.scrollTop = floatChatLog.scrollHeight;
    return msg;
}

// ===== 空回复"重试"按钮：复用上一次完全相同的请求（不自动重试、不重复添加用户消息）=====
let retryChatRequestFn = null; // 空回复时指向 runReply，供重试按钮调用
function addRetryBubble(text) {
    const msg = document.createElement('div');
    msg.className = 'chat-message from-pet';
    const textDiv = document.createElement('div');
    textDiv.textContent = text;
    msg.appendChild(textDiv);
    const btn = document.createElement('button');
    btn.textContent = '🔄 重试';
    btn.style.cssText = 'margin-top:8px;padding:4px 14px;border:1px solid #4f7cff;border-radius:999px;background:#eaf0ff;color:#4f7cff;cursor:pointer;font-size:12px;';
    btn.addEventListener('click', async () => {
        const fn = retryChatRequestFn;
        retryChatRequestFn = null;
        // 移除提示气泡，避免日志重复累积
        if (msg.parentNode) msg.parentNode.removeChild(msg);
        if (typeof fn === 'function') {
            try { await fn(); }
            catch (e) { console.error('[float] retry failed:', e); }
        }
    });
    msg.appendChild(btn);
    floatChatLog.appendChild(msg);
    floatChatLog.scrollTop = floatChatLog.scrollHeight;
    return msg;
}

// ===== Agent 工具系统 =====

// 执行 <CMD:xxx> 指令
function executeCmd(cmd) {
    if (!cmd) return;
    const cmdMap = {
        '去客厅': () => {
            if (typeof moveFloatWindowTo === 'function') {
                moveFloatWindowTo(screenX + 50, screenY + screenHeight - getContainerHeight() - 50);
                logBehavior('去客厅');
            }
        },
        '去卧室': () => {
            if (typeof moveFloatWindowTo === 'function') {
                moveFloatWindowTo(screenX + screenWidth / 2 - 80, screenY + screenHeight - getContainerHeight() - 50);
                logBehavior('去卧室');
            }
        },
        '去厨房': () => {
            if (typeof moveFloatWindowTo === 'function') {
                moveFloatWindowTo(screenX + screenWidth - 200, screenY + screenHeight - getContainerHeight() - 50);
                logBehavior('去厨房');
            }
        },
        '去卫生间': () => {
            if (typeof moveFloatWindowTo === 'function') {
                moveFloatWindowTo(screenX + 20, screenY + 20);
                logBehavior('去卫生间');
            }
        },
        '去阳台': () => {
            if (typeof moveFloatWindowTo === 'function') {
                moveFloatWindowTo(screenX + screenWidth - 200, screenY + 20);
                logBehavior('去阳台');
            }
        },
        '吃饭': () => {
            if (typeof setPetState === 'function') {
                setPetState('eating');
                logBehavior('吃饭');
            }
        },
        '睡觉': () => {
            if (typeof setPetState === 'function') {
                setPetState('sleeping');
                logBehavior('睡觉');
            }
        },
        '洗澡': () => {
            logBehavior('洗澡');
            if (typeof setPetState === 'function') setPetState('daydreaming');
        },
        '上厕所': () => {
            logBehavior('上厕所');
            stats.bladder = 0;
            if (typeof saveStats === 'function') saveStats();
        },
        '看电视': () => {
            logBehavior('看电视');
            if (typeof setPetState === 'function') setPetState('daydreaming');
        }
    };
    const action = cmdMap[cmd];
    if (action) {
        action();
    } else {
        logBehavior(cmd);
    }
}

// 执行 <EFFECT:xxx> 特效
function executeEffect(effect) {
    if (!effect || typeof triggerEffect !== 'function') return;
    // 中文特效名映射到英文
    const effectMap = {
        '弹跳': 'bounce',
        '抖动': 'shake',
        '爱心': 'hearts',
        '星星': 'stars',
        '旋转': 'spin',
        '舞蹈': 'wiggle',
        '脉冲': 'pulse',
        '压扁': 'squash',
        '漂浮': 'floaty',
        '拉伸': 'stretch',
        '睡觉': 'zzz',
        '闪光': 'sparkle',
        '泡泡': 'bubble',
        'bounce': 'bounce',
        'shake': 'shake',
        'hearts': 'hearts',
        'stars': 'stars',
        'stretch': 'stretch',
        'spin': 'spin',
        'wiggle': 'wiggle',
        'pulse': 'pulse',
        'squash': 'squash',
        'floaty': 'floaty',
        'zzz': 'zzz',
        'sparkle': 'sparkle',
        'bubble': 'bubble'
    };
    const mapped = effectMap[effect] || effect.toLowerCase();
    triggerEffect(mapped);
}

// ===== 压缩版 Agent 工具定义（仅用于完整 Agent 模式） =====
const agentTools = [
    {
        type: 'function',
        function: {
            name: 'open_app',
            description: '打开本地应用。支持：计算器、记事本、浏览器、微信、QQ、VS Code、文件管理器',
            parameters: {
                type: 'object',
                properties: {
                    app: { type: 'string', enum: ['计算器', '记事本', '浏览器', '微信', 'QQ', 'VS Code', '文件管理器'] }
                },
                required: ['app']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'open_url',
            description: '在浏览器中打开网址',
            parameters: {
                type: 'object',
                properties: {
                    url: { type: 'string' }
                },
                required: ['url']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_weather',
            description: '查询城市天气',
            parameters: {
                type: 'object',
                properties: {
                    city: { type: 'string' }
                },
                required: ['city']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_time',
            description: '获取当前时间',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'volume',
            description: '音量控制：set 设置 0-100，get 获取当前音量',
            parameters: {
                type: 'object',
                properties: {
                    action: { type: 'string', enum: ['set', 'get'] },
                    level: { type: 'number', minimum: 0, maximum: 100 }
                },
                required: ['action']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'screenshot',
            description: '截屏保存到桌面',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_system_info',
            description: '获取系统信息（CPU/内存/磁盘）',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'program',
            description: '程序管理：list 列出 / describe <id> 查看 / run <id> 执行 / save 保存新程序 / update <id> 更新代码或描述 / delete <id> 删除',
            parameters: {
                type: 'object',
                properties: {
                    action: { type: 'string', enum: ['list', 'describe', 'run', 'save', 'update', 'delete'] },
                    id: { type: 'string' },
                    name: { type: 'string' },
                    description: { type: 'string' },
                    code: { type: 'string' },
                    type: { type: 'string', enum: ['python', 'javascript', 'bash', 'html'] },
                    params: { type: 'object' }
                },
                required: ['action']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'capture_screen',
            description: '捕获当前屏幕截图并返回一段简短描述，帮助理解用户当前环境。',
            parameters: { type: 'object', properties: {}, required: [] }
        }
    },
    {
        type: 'function',
        function: {
            name: 'vision',
            description: '图像识别：截取当前屏幕，用 DeepSeek 视觉模型（deepseek-v4-flash-vision-exp）分析并回答 question。适用于读取截图文字、识别图表、判断界面状态。',
            parameters: {
                type: 'object',
                properties: {
                    question: { type: 'string', description: '针对屏幕图像想了解的完整问题' }
                },
                required: ['question']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'generate_image',
            description: '根据文本描述生成一张图片。',
            parameters: {
                type: 'object',
                properties: {
                    prompt: { type: 'string', description: '图像描述' },
                    size: { type: 'string', enum: ['1024x1024', '1024x768', '768x1024'], default: '1024x1024' }
                },
                required: ['prompt']
            }
        }
    }
];

// ===== 心情检测工具定义 =====
const moodTool = {
    type: 'function',
    function: {
        name: 'set_mood',
        description: '根据对话内容设置当前心情',
        parameters: {
            type: 'object',
            properties: {
                mood: {
                    type: 'string',
                    enum: ['鼓励', '害羞', '好奇', '惊讶', '难过', '撒娇', '生气', '无语', '兴奋']
                }
            },
            required: ['mood']
        }
    }
};

// 解析心情检测返回结果（tool_calls + 弱匹配）
function parseMoodFromToolResponse(data) {
    if (!data || !data.choices || !data.choices[0]) return null;
    const msg = data.choices[0].message;
    // 尝试从 tool_calls 解析
    if (msg.tool_calls && msg.tool_calls.length > 0) {
        try {
            const args = JSON.parse(msg.tool_calls[0].function.arguments || '{}');
            if (args.mood && moodList.includes(args.mood)) return args.mood;
        } catch (e) {}
    }
    // 弱匹配：从文本中提取心情
    if (msg.content) {
        for (const m of moodList) {
            if (msg.content.includes(m)) return m;
        }
    }
    return null;
}

// ===== 辅助函数：解析 <TOOL:xxx> 标记 =====
function parseToolTag(tagContent) {
    if (!tagContent || typeof tagContent !== 'string') {
        return { toolName: null, args: {}, error: '标记内容为空' };
    }
    const trimmed = tagContent.trim();
    const parts = trimmed.split(' ');
    const toolName = parts.shift();
    if (!toolName) {
        return { toolName: null, args: {}, error: '工具名为空' };
    }

    const args = {};
    // 优先匹配 key="value" 或 key='value'
    const regex = /(\w+)=["']([^"']*)["']/g;
    let match;
    let matchedCount = 0;
    while ((match = regex.exec(trimmed)) !== null) {
        args[match[1]] = match[2];
        matchedCount++;
    }
    // 降级方案：如果未匹配到带引号的键值对，尝试 key=value（无空格值）
    if (matchedCount === 0) {
        for (const part of parts) {
            const eqIdx = part.indexOf('=');
            if (eqIdx > 0) {
                const key = part.substring(0, eqIdx);
                const val = part.substring(eqIdx + 1);
                if (key && val) {
                    args[key] = val;
                }
            }
        }
    }
    console.log('[parseToolTag] toolName:', toolName, 'args:', JSON.stringify(args));
    return { toolName, args, error: null };
}

// ===== 辅助函数：渲染富文本（支持图片） =====
function renderMarkdown(text) {
    if (!text) return '';
    // 先转义 HTML 特殊字符
    let safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // 图片 ![alt](url) - 优先处理
    safe = safe.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="chat-image" loading="lazy" />');
    // 裸 URL 图片（以常见图片格式结尾）
    safe = safe.replace(/(https?:\/\/[^\s<>]+\.(jpg|jpeg|png|gif|webp|bmp))/gi, (match) => {
        return `<img src="${match}" alt="图片" class="chat-image" loading="lazy" />`;
    });
    // 粗体 **text**（不能跨行）
    safe = safe.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // 斜体 *text*（不匹配粗体内部）
    safe = safe.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // 行内代码 `text`
    safe = safe.replace(/`(.+?)`/g, '<code>$1</code>');
    return safe;
}

// ===== 工具调用包装（带超时控制） =====
async function executeToolHandler(toolName, args, timeout = 15000) {
    if (!window.electronAPI || !window.electronAPI.executeTool) {
        return { success: false, error: 'IPC 不可用' };
    }
    // 图像生成需要更长的超时时间
    if (toolName === 'generate_image' && timeout === 15000) {
        timeout = 30000;
    }
    const timeoutMsg = `工具调用超时（${Math.round(timeout / 1000)}秒）`;
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(timeoutMsg)), timeout)
    );
    try {
        const result = await Promise.race([
            window.electronAPI.executeTool(toolName, args),
            timeoutPromise
        ]);
        return result;
    } catch (e) {
        return { success: false, error: e.message || '工具执行异常' };
    }
}

// ===== 轻量模式处理器（文本标记，失败即停，结果折叠显示） =====

// 弱匹配：在成本模式下，AI 可能不输出严格 <TOOL:...> 格式，尝试备选模式
function weakMatchToolCalls(text) {
    const toolNames = ['screenshot', 'capture_screen', 'generate_image', 'open_app', 'open_url', 'get_weather', 'get_time', 'volume', 'get_system_info', 'program'];
    const calls = [];
    // 模式0: <TOOL:toolName key="value">（标准格式，但 Agent 模式不走 handleLightMode，需在此兜底）
    const angleRegex = /<TOOL:(\w+)\s+([^>]+)>/gi;
    let m0;
    while ((m0 = angleRegex.exec(text)) !== null) {
        const toolName = m0[1];
        const args = {};
        const argRegex = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
        let a;
        while ((a = argRegex.exec(m0[2])) !== null) {
            args[a[1]] = a[2] !== undefined ? a[2] : a[3];
        }
        calls.push({ fullMatch: m0[0], toolName, args });
    }
    // 模式1: (TOOL:toolName key="value") 或 (TOOL:toolName key='value')
    const parenRegex = /\(TOOL:(\w+)\s+([^)]+)\)/gi;
    let m;
    while ((m = parenRegex.exec(text)) !== null) {
        const toolName = m[1];
        const args = {};
        const argRegex = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
        let a;
        while ((a = argRegex.exec(m[2])) !== null) {
            args[a[1]] = a[2] !== undefined ? a[2] : a[3];
        }
        calls.push({ fullMatch: m[0], toolName, args });
    }
    // 模式2: toolName key="value" 或 key='value'（无TOOL包裹，避免重复匹配已匹配到的）
    for (const name of toolNames) {
        // 跳过已通过 (TOOL:...) 匹配到的工具名
        const alreadyMatched = calls.some(c => c.toolName === name);
        if (alreadyMatched) continue;
        const regex = new RegExp(`\\b${name}\\s+((?:\\w+\\s*=\\s*(?:"[^"]*"|'[^']*')\\s*)+)`, 'gi');
        let m2;
        while ((m2 = regex.exec(text)) !== null) {
            const args = {};
            const argRegex = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
            let a;
            while ((a = argRegex.exec(m2[1])) !== null) {
                args[a[1]] = a[2] !== undefined ? a[2] : a[3];
            }
            calls.push({ fullMatch: m2[0], toolName: name, args });
        }
    }
    // 模式3: 单独的工具名（无参数，用于 screenshot 等无参工具）
    for (const name of ['screenshot', 'capture_screen', 'get_time', 'get_system_info']) {
        const alreadyMatched = calls.some(c => c.toolName === name);
        if (alreadyMatched) continue;
        const regex = new RegExp(`\\b${name}\\b`, 'gi');
        let m3;
        while ((m3 = regex.exec(text)) !== null) {
            const already = calls.some(c => c.toolName === name && c.fullMatch === m3[0]);
            if (!already) {
                calls.push({ fullMatch: m3[0], toolName: name, args: {} });
            }
        }
    }
    return calls;
}

// 去除内部标记（与 addChatMessage 的显示清理一致，但保留换行，供流式/富文本渲染）
function stripChatMarkers(text) {
    let s = String(text == null ? '' : text);
    s = s.replace(/\[MEMORY:\s*[^\]]+\]/g, '');
    s = s.replace(/\[SHORT_MEMORY:\s*[^\]]+\]/g, '');
    s = s.replace(/<MOOD:[^>]+>/g, '');
    s = s.replace(/<CMD:[^>]+>/g, '');
    s = s.replace(/<EFFECT:[^>]+>/g, '');
    s = s.replace(/<STATE:[^>]+>/g, '');
    s = s.replace(/[\u200B-\u200F\uFEFF\u00AD\u2060\u180E\uFE00-\uFE0F\u2000-\u200A\u202F\u205F\u3000]+/g, ' ');
    s = s.replace(/[\uFE0E\uFE0F]/g, '');
    return s.trim();
}

// ===== 统一 AI 请求：传 onDelta 时走 SSE 流式（实时回调完整累积文本），否则一次性 JSON =====
async function requestChatCompletion({ apiUrl, apiKey, body, onDelta }) {
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
    };
    const isStream = typeof onDelta === 'function';
    const r = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(isStream ? Object.assign({}, body, { stream: true }) : body)
    });
    if (!r.ok) {
        const text = await r.text();
        const detail = 'chat API error status=' + r.status + ' body=' + text.substring(0, 500) + ' model=' + (body.model || '?') + ' stream=' + isStream;
        console.error('[float]', detail);
        if (window.electronAPI && window.electronAPI.logToMain) window.electronAPI.logToMain('error', '[float:chat] ' + detail);
        throw new Error('API ' + r.status + ': ' + text.substring(0, 300));
    }
    if (!isStream) {
        const text = await r.text();
        let parsed;
        try { parsed = JSON.parse(text); }
        catch (e) { console.error('[float] chat API non-JSON body:', text.substring(0, 300)); throw new Error('non-JSON response: ' + text.substring(0, 200)); }
        return parsed;
    }
    // ----- SSE 流式解析 -----
    if (!r.body) throw new Error('stream body not supported');
    const reader = r.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    const result = { content: '', reasoning_content: '', tool_calls: null, finish_reason: null };
    const toolCallMap = new Map(); // index -> 累积的 tool_call
    const handleChunk = (jsonStr) => {
        if (jsonStr === '[DONE]') return;
        let chunk;
        try { chunk = JSON.parse(jsonStr); } catch (e) { return; }
        const choice = chunk.choices && chunk.choices[0];
        if (!choice) return;
        const delta = choice.delta || {};
        if (delta.reasoning_content) result.reasoning_content += delta.reasoning_content;
        if (delta.content) {
            result.content += delta.content;
            onDelta(result.content);
        }
        if (delta.tool_calls) {
            if (!result.tool_calls) result.tool_calls = [];
            for (const tc of delta.tool_calls) {
                const idx = tc.index != null ? tc.index : 0;
                if (!toolCallMap.has(idx)) {
                    const entry = {
                        id: tc.id || '',
                        type: tc.type || 'function',
                        function: {
                            name: (tc.function && tc.function.name) || '',
                            arguments: (tc.function && tc.function.arguments) || ''
                        }
                    };
                    toolCallMap.set(idx, entry);
                    result.tool_calls.push(entry);
                } else {
                    const cur = toolCallMap.get(idx);
                    if (tc.id) cur.id = tc.id;
                    if (tc.function) {
                        if (tc.function.name) cur.function.name += tc.function.name;
                        if (tc.function.arguments) cur.function.arguments += tc.function.arguments;
                    }
                }
            }
        }
        if (choice.finish_reason) result.finish_reason = choice.finish_reason;
    };
    const feedBuffer = () => {
        let sepIdx;
        while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
            const rawEvent = buffer.slice(0, sepIdx);
            buffer = buffer.slice(sepIdx + 2);
            const dataStr = rawEvent.split('\n')
                .filter(l => l.startsWith('data:'))
                .map(l => l.slice(5).replace(/^\s/, ''))
                .join('\n');
            if (dataStr.trim()) handleChunk(dataStr.trim());
        }
    };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        feedBuffer();
    }
    buffer += decoder.decode();
    feedBuffer();
    if (buffer.trim()) handleChunk(buffer.trim());
    return {
        choices: [{
            message: {
                content: result.content,
                reasoning_content: result.reasoning_content || null,
                tool_calls: result.tool_calls
            },
            finish_reason: result.finish_reason
        }]
    };
}

async function handleLightMode(originalContent, messages, assistantMsg, streamMsgEl) {
    console.log('[LightMode] process:', originalContent);

    // 检测 [AGENT_MODE]，如果存在则切换到 Agent 模式（保持不变）
    if (originalContent.includes('[AGENT_MODE]')) {
        console.log('[LightMode] detected [AGENT_MODE], switch to Agent mode');
        const cleanContent = originalContent.replace(/\[AGENT_MODE\]\s*/g, '');
        if (cleanContent.trim()) {
            addChatMessage(cleanContent, false);
        }
        const cleanedMsg = {
            ...assistantMsg,
            content: cleanContent
        };
        await handleAgentMode(messages, assistantMsg);
        return;
    }

    // 提取所有工具标记
    const toolRegex = /<TOOL:([^>]+)>/g;
    let match;
    const toolCalls = [];
    while ((match = toolRegex.exec(originalContent)) !== null) {
        const { toolName, args, error } = parseToolTag(match[1]);
        if (error || !toolName) {
            // 标记解析失败，显示错误并终止
            addChatMessage(`❌ 工具标记解析失败：${error || '未知错误'}\n\n📄 AI 原始回复：\n${originalContent}`, false);
            return;
        }
        toolCalls.push({ fullMatch: match[0], toolName, args });
    }

    // 没有工具标记，尝试弱匹配（AI 可能不输出严格格式，包括 Agent 模式下的后续调用）
    if (toolCalls.length === 0) {
        const weakCalls = weakMatchToolCalls(originalContent);
        if (weakCalls.length > 0) {
            console.log('[LightMode] 弱匹配命中:', weakCalls);
            toolCalls.push(...weakCalls);
        }
    }

    // 仍然没有工具标记，直接显示原文（流式路径下气泡已实时渲染，无需重复添加）
    if (toolCalls.length === 0) {
        if (streamMsgEl) return;
        addChatMessage(originalContent, false);
        return;
    }

    // 准备存储执行结果
    const results = [];
    let hasError = false;

    // 顺序执行所有工具
    for (const tc of toolCalls) {
        console.log('[LightMode] exec:', tc.toolName, tc.args);
        // ===== generate_image 特殊处理：先显示占位图 =====
        if (tc.toolName === 'generate_image') {
            const placeholderMsg = document.createElement('div');
            placeholderMsg.className = 'chat-message from-pet';
            placeholderMsg.innerHTML = `<div class="image-placeholder">
                <div class="image-placeholder-spinner"></div>
                <div class="image-placeholder-text">🎨 图片生成中...</div>
            </div>`;
            floatChatLog.appendChild(placeholderMsg);
            floatChatLog.scrollTop = floatChatLog.scrollHeight;

            const result = await executeToolHandler(tc.toolName, tc.args, 30000);

            if (result && result.success && result.data && result.data.url) {
                placeholderMsg.innerHTML = `<img src="${result.data.url}" alt="生成的图片" class="chat-image" loading="lazy" />`;
                results.push({ toolName: tc.toolName, args: tc.args, result, fullMatch: tc.fullMatch });
            } else {
                placeholderMsg.innerHTML = `<div class="image-placeholder image-placeholder-error">
                    ❌ 图片生成失败：${result?.error || '未知错误'}
                </div>`;
                displayToolResult(tc.toolName, tc.args, { success: false, error: result?.error || '未知错误' });
                let errorContent = originalContent.replace(tc.fullMatch, `❌ ${tc.toolName} 执行失败`);
                addChatMessage(errorContent, false);
                hasError = true;
                break;
            }
            continue;
        }
        // ===== 其他工具：正常流程 =====
        try {
            const result = await executeToolHandler(tc.toolName, tc.args);
            if (!result || !result.success) {
                // 失败时也创建可折叠的结果面板
                displayToolResult(tc.toolName, tc.args, { success: false, error: result?.error || '未知错误' });
                // 显示 AI 原始内容（工具标记替换为错误提示）
                let errorContent = originalContent.replace(tc.fullMatch, `❌ ${tc.toolName} 执行失败`);
                addChatMessage(errorContent, false);
                hasError = true;
                break;
            }
            results.push({ toolName: tc.toolName, args: tc.args, result, fullMatch: tc.fullMatch });
        } catch (e) {
            // 异常时也创建可折叠的结果面板
            displayToolResult(tc.toolName, tc.args, { success: false, error: e.message || '工具执行异常' });
            let errorContent = originalContent.replace(tc.fullMatch, `❌ ${tc.toolName} 执行异常`);
            addChatMessage(errorContent, false);
            hasError = true;
            break;
        }
    }

    if (hasError) return;

    // 全部成功：构建 finalContent（将标记替换为简短提示）
    let finalContent = originalContent;
    for (const r of results) {
        // 替换标记为 "✅ 工具名 执行成功"
        const shortMsg = `✅ ${r.toolName} 执行成功`;
        finalContent = finalContent.replace(r.fullMatch, shortMsg);
    }

    // 显示 AI 消息（含简短提示），流式路径直接更新已有气泡
    if (streamMsgEl) {
        streamMsgEl.innerHTML = renderMarkdown(stripChatMarkers(finalContent));
    } else {
        addChatMessage(finalContent, false);
    }

    // 在消息下方追加可折叠的详细结果
    for (const r of results) {
        displayToolResult(r.toolName, r.args, r.result);
    }
}

// ===== 完整 Agent 模式处理器（多轮 Function Calling） =====
async function handleAgentMode(messages, firstAssistantMsg) {
    console.log('[AgentMode] enter full Agent mode');

    // 创建可折叠的思考过程容器
    const thinkingContainer = document.createElement('details');
    thinkingContainer.className = 'agent-thinking';
    thinkingContainer.open = true; // 执行过程中展开
    const summary = document.createElement('summary');
    summary.textContent = '🤖 Agent 思考过程';
    thinkingContainer.appendChild(summary);
    // 先插入到聊天区域，后续消息直接追加到容器内
    floatChatLog.appendChild(thinkingContainer);
    floatChatLog.scrollTop = floatChatLog.scrollHeight;

    let lastMsgEl = null;
    let allThinkingText = []; // 收集所有思考文本，用于聊天记录

    // 辅助函数：添加灰色思考消息到折叠容器
    function addThinkingMessage(text) {
        if (!text || !text.trim()) return null;
        const msg = document.createElement('div');
        msg.className = 'chat-message from-pet agent-mode';
        msg.textContent = text.trim();
        thinkingContainer.appendChild(msg);
        floatChatLog.scrollTop = floatChatLog.scrollHeight;
        allThinkingText.push(text.trim());
        return msg;
    }

    // 1. 处理第一次回复（显示在折叠容器中）
    let firstContent = firstAssistantMsg.content || '';
    if (firstContent.includes('[AGENT_MODE]')) {
        firstContent = firstContent.replace(/\[AGENT_MODE\]\s*/g, '');
        firstAssistantMsg.content = firstContent;
    }
    messages.push(firstAssistantMsg);

    // 显示第一次回复（灰色）
    if (firstContent.trim()) {
        lastMsgEl = addThinkingMessage(firstContent);
    }

    // 从第一次回复中提取弱匹配工具调用并执行
    if (firstContent) {
        const weakCalls = weakMatchToolCalls(firstContent);
        if (weakCalls.length > 0) {
            console.log('[AgentMode] first reply weak match:', weakCalls);
            for (const wc of weakCalls) {
                const result = await executeToolHandler(wc.toolName, wc.args);
                if (!result.success) {
                    addChatMessage(`❌ 工具 ${wc.toolName} 执行失败：${result.error || '未知错误'}`, false);
                } else {
                    displayToolResult(wc.toolName, wc.args, result, lastMsgEl);
                    messages.push({
                        role: 'tool',
                        tool_call_id: `weak_${wc.toolName}_${Date.now()}`,
                        content: JSON.stringify(result)
                    });
                }
            }
        }
    }

    // 处理首次回复中已携带的 tool_calls（主请求已上传 tools 参数时可能直接返回；
    // 需先回填 tool 消息，下一次请求才是合法的 Function Calling 上下文）
    if (firstAssistantMsg.tool_calls && firstAssistantMsg.tool_calls.length > 0) {
        const toolResults = [];
        let hasError = false;
        for (const toolCall of firstAssistantMsg.tool_calls) {
            const toolName = toolCall.function.name;
            let args = {};
            try { args = JSON.parse(toolCall.function.arguments || '{}'); } catch (e) { args = {}; }
            console.log('[AgentMode] 执行首次工具:', toolName, args);
            const result = await executeToolHandler(toolName, args);
            if (!result.success) {
                addChatMessage(`❌ 工具 ${toolName} 执行失败：${result.error || '未知错误'}`, false);
                hasError = true;
                break;
            }
            displayToolResult(toolName, args, result, lastMsgEl);
            toolResults.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(result)
            });
        }
        if (hasError) {
            thinkingContainer.open = false;
            return allThinkingText.join('\n');
        }
        messages.push(...toolResults);
    }

    let round = 0;
    const MAX_ROUNDS = 5;
    let finalResponse = '';

    while (round < MAX_ROUNDS) {
        // 请求 API（携带 agentTools，DeepSeek Function Calling）
        const agCred = chatCredentials();
        const agentApiUrl = agCred.base;
        const agentApiKey = agCred.key;
        const agProvider = config.multimodalProvider || 'deepseek';
        const agHasKey = !!agCred.key;
        const useVision = !!(config.multimodalEnabled && agProvider === 'deepseek' && agHasKey);
        const agentModel = useVision ? 'deepseek-v4-flash-vision-exp' : 'deepseek-v4-flash';

        const agentBody = {
            model: agentModel,
            messages: messages,
            max_tokens: 2048,
            temperature: 0.8
        };
        if (!useVision) { agentBody.tools = agentTools; agentBody.tool_choice = 'auto'; }
        // chat 与 vision 均走 SSE 流式，实时渲染本轮回复（先以思考样式显示在折叠容器中）
        let roundStreamEl = null;
        const roundOnDelta = (fullText) => {
            if (!roundStreamEl) {
                roundStreamEl = document.createElement('div');
                roundStreamEl.className = 'chat-message from-pet agent-mode';
                thinkingContainer.appendChild(roundStreamEl);
                floatChatLog.scrollTop = floatChatLog.scrollHeight;
            }
            roundStreamEl.textContent = fullText.trim();
            floatChatLog.scrollTop = floatChatLog.scrollHeight;
        };

        let data;
        // chat 与 vision 模型均走 SSE 流式，实时渲染本轮回复到思考容器
        data = await requestChatCompletion({ apiUrl: agentApiUrl, apiKey: agentApiKey, body: agentBody, onDelta: roundOnDelta });
        const assistantMsg = data.choices[0].message;
        let content = assistantMsg.content || '';

        // ===== 检测 [AGENT_MODE]：追加到折叠容器 =====
        if (content.includes('[AGENT_MODE]')) {
            const cleanContent = content.replace(/\[AGENT_MODE\]\s*/g, '');
            if (roundStreamEl) {
                // 流式气泡已显示原文，这里就地替换为去标记文本
                roundStreamEl.textContent = cleanContent.trim();
                if (cleanContent.trim()) allThinkingText.push(cleanContent.trim());
                lastMsgEl = roundStreamEl;
            } else if (cleanContent.trim()) {
                lastMsgEl = addThinkingMessage(cleanContent);
            }
            messages.push({
                role: 'assistant',
                content: cleanContent,
                tool_calls: assistantMsg.tool_calls
            });
            round++;
            continue;
        }

        // 没有 [AGENT_MODE]，正常处理
        messages.push({
            role: 'assistant',
            content: content || null,
            tool_calls: assistantMsg.tool_calls
        });

        // 检查是否有工具调用（标准 Function Calling）
        if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
            // 流式气泡即本轮思考显示，登记为最后一条消息（工具结果将折叠在其下）
            if (roundStreamEl) {
                if (content.trim()) allThinkingText.push(content.trim());
                lastMsgEl = roundStreamEl;
            }
            const toolResults = [];
            let hasError = false;

            for (const toolCall of assistantMsg.tool_calls) {
                const toolName = toolCall.function.name;
                let args = {};
                try {
                    args = JSON.parse(toolCall.function.arguments || '{}');
                } catch (e) {
                    args = {};
                }

                console.log('[AgentMode] exec tool:', toolName, args);
                const result = await executeToolHandler(toolName, args);

                if (!result.success) {
                    addChatMessage(`❌ 工具 ${toolName} 执行失败：${result.error || '未知错误'}`, false);
                    hasError = true;
                    break;
                }

                displayToolResult(toolName, args, result, lastMsgEl);

                toolResults.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify(result)
                });
            }

            if (hasError) {
                // 失败时也折叠思考容器
                thinkingContainer.open = false;
                return allThinkingText.join('\n');
            }

            messages.push(...toolResults);
            round++;
            continue;
        }

        // 无 tool_calls，检查是否有弱匹配工具调用
        if (content) {
            const weakCalls = weakMatchToolCalls(content);
            if (weakCalls.length > 0) {
                if (roundStreamEl) {
                    // 流式气泡即本轮思考显示
                    if (content.trim()) allThinkingText.push(content.trim());
                    lastMsgEl = roundStreamEl;
                }
                console.log('[AgentMode] weak match:', weakCalls);
                const toolResults = [];
                let hasError = false;
                for (const wc of weakCalls) {
                    console.log('[AgentMode] weak exec tool:', wc.toolName, wc.args);
                    const result = await executeToolHandler(wc.toolName, wc.args);
                    if (!result.success) {
                        addChatMessage(`❌ 工具 ${wc.toolName} 执行失败：${result.error || '未知错误'}`, false);
                        hasError = true;
                        break;
                    }
                    displayToolResult(wc.toolName, wc.args, result, lastMsgEl);
                    toolResults.push({
                        role: 'tool',
                        tool_call_id: `weak_${wc.toolName}_${Date.now()}`,
                        content: JSON.stringify(result)
                    });
                }
                if (hasError) {
                    thinkingContainer.open = false;
                    return allThinkingText.join('\n');
                }
                messages.push(...toolResults);
                round++;
                continue;
            }
        }

        // 无 tool_calls、无 [AGENT_MODE]、无弱匹配 → 视为最终回复
        // 折叠思考容器
        thinkingContainer.open = false;
        // 以蓝色（正常样式）显示最终回复
        if (content) {
            if (roundStreamEl) {
                // 流式气泡已实时渲染完成：移出思考容器并转为最终回复样式
                roundStreamEl.className = 'chat-message from-pet';
                roundStreamEl.innerHTML = renderMarkdown(stripChatMarkers(content));
                floatChatLog.appendChild(roundStreamEl);
                floatChatLog.scrollTop = floatChatLog.scrollHeight;
            } else {
                addChatMessage(content, false, false);
            }
        }
        finalResponse = content;
        break;
    }

    if (round >= MAX_ROUNDS) {
        thinkingContainer.open = false;
        addChatMessage('⏳ 操作步骤过多，请简化请求或重试。', false);
    }
    console.log('[AgentMode] done');
    // 返回完整内容（思考过程 + 最终回复），用于聊天记录
    const fullContent = allThinkingText.join('\n') + (finalResponse ? '\n' + finalResponse : '');
    return fullContent.trim();
}

// ===== 发送聊天消息（双模式：轻量模式默认，Agent 模式按需触发） =====
async function sendFloatChatMessage(text) {
    const requestSessionId = currentFloatSessionId;

    // ===== 第一步：解析并执行用户输入中的命令标记 =====
    const cmdMatch = text.match(/<CMD:([^>]+)>/);
    const moodMatch = text.match(/<MOOD:([^>]+)>/);
    const effectMatch = text.match(/<EFFECT:([^>]+)>/);

    if (cmdMatch) executeCmd(cmdMatch[1].trim());
    if (moodMatch) {
        const mood = moodMatch[1].trim();
        if (moodList.includes(mood) && typeof switchIllust === 'function') {
            switchIllust(mood);
        }
    }
    if (effectMatch) executeEffect(effectMatch[1].trim());

    let cleanText = text
        .replace(/<CMD:[^>]+>/g, '')
        .replace(/<MOOD:[^>]+>/g, '')
        .replace(/<EFFECT:[^>]+>/g, '')
        .trim();

    if (!cleanText) {
        floatChatInput.value = '';
        return;
    }

    // ===== 第二步：添加用户消息（多模态开启时附带屏幕截图 file_id，形成 文本-图片 结构）=====
    await loadMemory();
    addChatMessage(cleanText, true);
    floatChatInput.value = '';

    // 多模态：截屏 -> 上传 Files API -> 拿到 file_id -> 嵌入 content（本地同步缓存供记忆使用）
    const mmProvider = config.multimodalProvider || 'deepseek';
    const mmHasKey = mmProvider === 'zhipu' ? !!config.zhipuApiKey : !!config.apiKey;
    const loadingIndicator = document.getElementById('loadingIndicator');
    let userContent = cleanText;
    if (config.multimodalEnabled && mmHasKey) {
        try {
            if (loadingIndicator) loadingIndicator.style.display = 'flex';
            const up = await window.electronAPI.uploadScreenshot();
            if (up && up.fileId) {
                userContent = [
                    { type: 'text', text: cleanText },
                    { type: 'file', file_id: up.fileId }
                ];
                pendingConversationImages.push({
                    fileId: up.fileId,
                    imagePath: up.imagePath,
                    imageUrl: up.imageUrl,
                    time: Date.now()
                });
            }
        } catch (e) {
            const detail = 'multimodal screenshot upload failed: ' + (e && e.message) + ' code=' + (e && e.code) + ' | apiUrl=' + config.apiUrl + ' | multimodalEnabled=' + config.multimodalEnabled + ' | provider=' + mmProvider + ' | hasKey=' + mmHasKey;
            console.warn('[float]', detail);
            if (window.electronAPI && window.electronAPI.logToMain) window.electronAPI.logToMain('error', '[float:upload] ' + detail);
        } finally {
            if (loadingIndicator) loadingIndicator.style.display = 'none';
        }
    }
    chatHistory.push({ role: 'user', content: userContent });

    if (!config.apiKey) {
        const reply = '请先在设置中配置 API Key~';
        addChatMessage(reply, false);
        chatHistory.push({ role: 'assistant', content: reply });
        speakText(reply);
        return;
    }

    // ===== 第三步：构建 AI 请求 =====
    try {
        // 整个请求+渲染流程封装为 runReply，供空回复"重试"按钮复用（不会重复添加用户消息）
        const runReply = async () => {
            const statsStr = Object.entries(stats)
            .map(([k, v]) => `${statNames[k]}: ${Math.round(v)}%`)
            .join(', ');

        let memoryStr = '';
        if (config.enableMemory && memoryItems.length > 0) {
            memoryStr = '\n记忆：\n' + memoryItems.map((m, i) => `${i + 1}. ${m.text != null ? m.text : (m.description || '')}`).join('\n');
        }

        const behaviorStr = getBehaviorLogStr();
        const ctxStr = await buildContextStr();

        // ===== 固定系统提示（前缀缓存友好：保持完全静止，动态信息一律走只追加）=====
        const replyLengthRule = (config.aiReplyLength > 0)
            ? `\n【回复长度】每次回复正文不要超过 ${config.aiReplyLength} 字，简洁作答。`
            : '';
        const systemPrompt = `${config.aiPrompt}
${replyLengthRule}
【工具使用】
你可以通过标准的 function calling 机制调用工具（请勿输出 <TOOL:...> 文本标记）。
需要调用工具时直接发起工具调用；如需多步/多轮，依次调用并依据结果继续，最后给出简洁答复。

可用工具：
- open_app(app)：打开本地应用（计算器、记事本、浏览器、微信、QQ、VS Code、文件管理器）
- open_url(url)：在浏览器打开网址
- get_weather(city)：查询城市天气
- get_time()：获取当前时间
- volume(action, level)：音量控制（action=set 传入 level 0-100 / action=get）
- screenshot()：截屏保存到桌面
- get_system_info()：获取系统信息（CPU/内存/磁盘）
- capture_screen()：捕获当前屏幕并返回一段简短描述
- vision(question)：截取当前屏幕并用视觉模型 deepseek-v4-flash-vision-exp 分析，回答 question（识别文字、图表、界面状态）
- generate_image(prompt, size)：根据描述生成一张图片
- program(action, ...)：程序管理（list / describe / run / save / update / delete）

【回复格式】
可带 <MOOD:心情>，可选心情仅限：${moodList.length ? moodList.join('、') : '（无可选心情）'}。
可带 <STATE:状态> 标记桌宠可切换的动作状态，可用状态：${selectableStates().map(stateLabel).join('、')}。
<MOOD:心情> 会切换聊天左侧立绘；<STATE:状态> 会切换桌宠本体动作。请只选用上面列出的名称。

【多轮工具使用】
一次对话可连续调用多个工具，依据前一次工具结果决定是否继续调用，完成任务后给出最终简洁答复。`;

        // ===== 动态上下文（只追加，不进 system，保证 system 首条完全固定）=====
        const dynamicContext =
            `【当前运行状态】
${statsStr}${memoryStr}${behaviorStr}${ctxStr}`;

        // 只追加构造：第一条 system 固定，其余全部追加
        const messages = [
            { role: 'system', content: systemPrompt }
        ];
        chatHistory.forEach(msg => {
            messages.push({ role: msg.role, content: msg.content });
        });
        // 动态状态追加到最后（只追加；必要时可另行压缩消息历史）
        if (dynamicContext.trim()) {
            messages.push({ role: 'user', content: dynamicContext });
        }

        // ===== AI 请求（DeepSeek） =====
        const cred = chatCredentials();
        const apiUrl = cred.base;
        const apiKey = cred.key;
        // 多模态（DeepSeek）开启时，对话嵌入了 file_id 图片块，必须使用 vision 模型才能理解图片
        const useVision = !!(config.multimodalEnabled && mmProvider === 'deepseek' && !!cred.key);
        const model = useVision ? 'deepseek-v4-flash-vision-exp' : 'deepseek-v4-flash';

        // ===== vision 模型：把已保存的图像记忆以真实图片（file_id）随请求发送 =====
        // 若只把 description 文本拼进 memoryStr，模型永远"看不见"记忆里的图片；
        // 这里在对话末尾追加一条多模态 user 消息：文字描述 + 【图N】标记 + 文件块，
        // 让 vision 模型实际看到每一张图像记忆，回答时才能引用其中的内容。
        if (useVision) {
            const imgMemories = memoryItems.filter(m => m && m.type === 'image' && m.fileId);
            if (imgMemories.length > 0) {
                const memBlocks = [
                    { type: 'text', text: '以下是已保存的图像记忆，提问涉及它们时请直接依据图片内容回答，并按【图像记忆N】引用：' }
                ];
                imgMemories.forEach((m, i) => {
                    memBlocks.push({ type: 'text', text: `【图像记忆${i + 1}】${m.description || ''}` });
                    memBlocks.push({ type: 'file', file_id: m.fileId });
                });
                messages.push({ role: 'user', content: memBlocks });
            }
        }

        // 显示加载动画
        if (loadingIndicator) loadingIndicator.style.display = 'flex';

        // 发起主请求（携带 tools 参数，走 OpenAI 兼容 Function Calling）
        // vision 模型用于看图，不携带 tools（避免部分模型不支持函数调用导致报错）
        const requestBody = {
            model: model,
            messages: messages,
            // 推理模型会先用大量 token 生成 reasoning_content（如分析截图），预算太小会
            // 在产出正文前就 finish_reason=length 导致 content 为空，因此给足 2048
            max_tokens: 2048,
            temperature: 0.8
        };
        if (!useVision) {
            requestBody.tools = agentTools;
            requestBody.tool_choice = 'auto';
        }
        // 主对话统一走 SSE 流式输出（chat 与 vision 模型均实时渲染文本），
        // 结束后再处理工具调用/格式化；vision 模型不携带 tools
        let data;
        let streamMsgEl = null; // 流式渲染中的气泡
        const onDelta = (fullText) => {
            if (loadingIndicator) loadingIndicator.style.display = 'none';
            if (!streamMsgEl) {
                streamMsgEl = document.createElement('div');
                streamMsgEl.className = 'chat-message from-pet';
                floatChatLog.appendChild(streamMsgEl);
            }
            streamMsgEl.innerHTML = renderMarkdown(stripChatMarkers(fullText));
            floatChatLog.scrollTop = floatChatLog.scrollHeight;
        };
        try {
            data = await requestChatCompletion({ apiUrl, apiKey, body: requestBody, onDelta });
        } finally {
            if (loadingIndicator) loadingIndicator.style.display = 'none';
        }

        // 心情统一从主回复中解析，不再并行请求智谱
        const moodData = null;

        if (!data || !data.choices || !data.choices[0] || !data.choices[0].message) {
            console.error('[float] chat API no valid choices:', JSON.stringify(data).substring(0, 500));
            throw new Error('API 返回为空或无 choices');
        }
        const assistantMsg = data.choices[0].message;
        const content = assistantMsg.content || '';
        const hasToolCalls = !!(assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0);

        // 为空且无工具调用：不自动重试，给出"重试"按钮复用同一请求；同时打印原始响应便于排查
        if (!content.trim() && !hasToolCalls) {
            // 移除流式过程中创建的空气泡
            if (streamMsgEl && streamMsgEl.parentNode) streamMsgEl.parentNode.removeChild(streamMsgEl);
            streamMsgEl = null;
            const emptyDetail = 'AI 未返回有效内容 finish_reason=' + (data.choices[0].finish_reason || '?') + ' reasoning=' + (assistantMsg.reasoning_content ? 'yes' : 'no') + ' raw=' + JSON.stringify(data).substring(0, 500);
            console.warn('[float]', emptyDetail);
            if (window.electronAPI && window.electronAPI.logToMain) window.electronAPI.logToMain('warn', '[float:chat] ' + emptyDetail);
            retryChatRequestFn = runReply;
            addRetryBubble('🤔 AI 没有返回有效内容，点击下方按钮重试~');
            return;
        }

        // ===== 第四步：判断模式 =====
        let isAgentMode = false;
        let agentFinalResponse = '';
        // 主请求已携带 tools 参数，模型可能直接返回结构化 tool_calls
        if (hasToolCalls || content.includes('[AGENT_MODE]')) {
            isAgentMode = true;
            // 进入 Agent 模式：移除已流式渲染的气泡（其内容会以思考样式重新渲染到折叠容器）
            if (streamMsgEl && streamMsgEl.parentNode) streamMsgEl.parentNode.removeChild(streamMsgEl);
            streamMsgEl = null;
            // 优先处理模型返回的 OpenAI 兼容 tool_calls；否则走 [AGENT_MODE] 传统入口
            agentFinalResponse = await handleAgentMode(messages, assistantMsg);
        } else {
            await handleLightMode(content, messages, assistantMsg, streamMsgEl);
        }

        // ===== 第五步：更新状态 =====
        // Agent 模式：只将最终回复（蓝色）计入聊天记录，灰色思考部分不计入
        // 轻量模式：保持原有逻辑
        const finalContent = isAgentMode
            ? agentFinalResponse
            : content.replace(/<TOOL:[^>]+>/g, '').replace(/\[AGENT_MODE\]/g, '').trim();

        if (finalContent) {
            chatHistory.push({ role: 'assistant', content: finalContent });
            // Auto-read AI reply (using local TTS, with fallback)
            speakText(finalContent);
        }

        // 解析心情（优先使用并行检测结果）
        let detectedMood = null;
        if (moodData) {
            detectedMood = parseMoodFromToolResponse(moodData);
        }
        // 并行检测未命中时，回退到主回复解析
        if (!detectedMood) {
            detectedMood = parseMoodFromReply(content);
        }
        if (detectedMood && floatIllustImg) {
            switchIllust(detectedMood);
            bounceIllust();
        }
        // 解析 <STATE:状态>：AI 可切换桌宠本体动作状态（增加/减少立绘/动作）
        const detectedState = parseStateFromReply(content);
        if (detectedState && typeof setPetState === 'function') {
            setPetState(detectedState);
        }

        // 更新统计
        const sessionStillValid =
            requestSessionId !== null &&
            requestSessionId === currentFloatSessionId;

        if (sessionStillValid && !shouldPauseFloatStats()) {
            stats.happiness = Math.min(100, stats.happiness + 5);
            stats.boredom = Math.max(0, stats.boredom - 15);
            saveStats();
        }
        logBehavior('和主人聊天');
        }; // runReply 结束

        await runReply();
    } catch (e) {
        const detail = 'Float chat error: ' + (e && e.stack ? e.stack : e) + ' | message=' + (e && e.message) + ' | useVision=' + (typeof useVision !== 'undefined' ? useVision : '?') + ' | model=' + (typeof model !== 'undefined' ? model : '?');
        console.error('[float]', detail);
        if (window.electronAPI && window.electronAPI.logToMain) window.electronAPI.logToMain('error', '[float:chat] ' + detail);
        addChatMessage('Error: ' + (e && e.message ? e.message : 'Please check network or API settings~'), false);
    }
}

// ===== 显示工具结果（可折叠容器，折叠在回复下） =====
function displayToolResult(toolName, args, result, parentEl) {
    try {
        const container = document.createElement('div');
        container.className = 'tool-result-container';

        const details = document.createElement('details');
        const summary = document.createElement('summary');
        const status = result && result.success ? '✅' : '❌';
        summary.textContent = `${status} 工具：${toolName}`;
        details.appendChild(summary);

        const content = document.createElement('div');
        // 如果是 generate_image 且有图片 URL，直接渲染图片
        if (toolName === 'generate_image' && result && result.success && result.data && result.data.url) {
            content.innerHTML = `<img src="${result.data.url}" alt="生成的图片" class="chat-image" loading="lazy" />`;
        } else {
            const pre = document.createElement('pre');
            pre.textContent = `参数：${JSON.stringify(args, null, 2)}\n返回值：${JSON.stringify(result, null, 2)}`;
            content.appendChild(pre);
        }
        details.appendChild(content);

        container.appendChild(details);
        const target = parentEl || floatChatLog;
        target.appendChild(container);
        if (!parentEl) {
            floatChatLog.scrollTop = floatChatLog.scrollHeight;
        }
    } catch (e) {
        console.warn('[displayToolResult] display failed:', e);
    }
}

// ===== 图片点击保存 =====
floatChatLog.addEventListener('click', async (e) => {
    const img = e.target.closest('.chat-image');
    if (!img) return;
    e.preventDefault();
    e.stopPropagation();
    if (confirm('是否保存此图片到本地？')) {
        const result = await window.electronAPI.saveImageFromUrl(img.src);
        if (result && result.success) {
            alert('图片已保存到：' + result.path);
        } else if (result && result.canceled) {
            // 用户取消
        } else {
            alert('保存失败：' + (result?.error || '未知错误'));
        }
    }
});

floatSendBtn.addEventListener('click', () => {
    const text = floatChatInput.value.trim();
    if (text) {
        sendFloatChatMessage(text);
    }
});

floatChatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        floatSendBtn.click();
    }
});

// 监听消息更新（仅浮窗模式需要）
if (!isChatMode && window.electronAPI) {
    window.electronAPI.onFloatMessage((message) => {
        // 气泡改为双选项按钮，不再显示单条消息
        // 保留该函数避免 IPC 报错
    });
}

// 保存聊天记录按钮
const saveChatBtn = document.getElementById('saveChatBtn');
if (saveChatBtn) {
    saveChatBtn.addEventListener('click', async () => {
        if (chatHistory.length === 0) {
            addChatMessage('没有聊天记录可保存', false);
            return;
        }
        const now = new Date();
        const time = now.toLocaleString('zh-CN', { hour12: false });
        const lines = chatHistory.map(m => `[${time}] ${m.role === 'user' ? '用户' : '桌宠'}: ${flattenMessageContent(m.content)}`);
        const content = lines.join('\n');
        try {
            const result = await window.electronAPI.saveChatLog(content);
            if (result.success) {
                addChatMessage(`聊天记录已保存到 ${result.path}`, false);
            } else if (!result.canceled) {
                addChatMessage('保存失败', false);
            }
        } catch (e) {
            addChatMessage('保存失败: ' + (e.message || ''), false);
        }
    });
}

// 监听配置更新（主进程广播）；仅在字段值确有变化时才应用与打印，避免广播刷屏
if (window.electronAPI && window.electronAPI.onConfigUpdated) {
    window.electronAPI.onConfigUpdated((data) => {
        if (!data) return;
        const changedKeys = Object.keys(data).filter(k => config[k] !== data[k]);
        if (changedKeys.length === 0) return;
        config = { ...config, ...data };
        if (data.stickerPack !== undefined) {
            config.stickerPack = data.stickerPack;
            window._stickerPack = data.stickerPack;
            // 重新渲染浮窗桌宠和立绘
            floatPetImg.src = (PET_IMGS[petState] || ORIGINAL_PET_SRC)();
            if (floatIllustImg && floatIllustImg.src) {
                switchIllust('开心');
            }
        }
        // 持久化到 localStorage，避免刷新后丢失
        localStorage.setItem('petConfig', JSON.stringify(config));
        // 若当前是设置面板模式，刷新控件显示值（不重新绑定事件）
        if (isSettingsMode) {
            refreshSettingsValues();
        } else if (typeof data.floatPetSize === 'number' && isFinite(data.floatPetSize) && data.floatPetSize !== currentPetSize) {
            // 浮窗（桌宠）窗口：直接把新大小应用到渲染与窗口尺寸，避免"数值不变但 float 变默认大小"
            currentPetSize = data.floatPetSize;
            document.documentElement.style.setProperty('--float-pet-size', currentPetSize + 'px');
            if (typeof updateWindowSize === 'function') updateWindowSize();
        }
        console.log('[float] config updated:', changedKeys.join(','));
    });
}

// ===== Voice manager callbacks (STT) =====
if (window.voiceManager) {
    window.voiceManager.setCallbacks({
        onResult: (finalText, interimText) => {
            if (finalText) {
                addChatMessage(`🎤 You said: ${finalText}`, false);
                const input = document.getElementById('floatChatInput');
                if (input) input.value = finalText;
            }
        },
        onError: (error) => {
            addChatMessage(`❌ Speech recognition error: ${error}`, false);
        }
    });
}

// ===== Edge TTS only =====

// Emoji removal is temporarily disabled to avoid deleting Chinese characters
function removeEmoji(text) {
    return text;
}

// float.js - speakText（剔除 mood 标记后朗读）
async function speakText(text) {
    if (!text) return;

    // 剔除 <MOOD:xxx> 标记，避免朗读心情标签
    let clean = text.replace(/<MOOD:[^>]+>/g, '').trim();
    if (!clean) {
        return;
    }

    if (!config.voiceEnabled) {
        return;
    }

    // 已知的 Edge TTS 有效中文语音列表
    const VALID_VOICES = [
        'zh-CN-XiaoxiaoNeural', 'zh-CN-YunxiNeural', 'zh-CN-YunjianNeural',
        'zh-CN-XiaoyiNeural', 'zh-CN-YunyangNeural', 'zh-CN-XiaochenNeural',
        'zh-CN-XiaohanNeural', 'zh-CN-XiaomengNeural', 'zh-CN-XiaoruiNeural',
        'zh-CN-XiaoshuangNeural', 'zh-CN-XiaoxuanNeural', 'zh-CN-XiaoyanNeural',
        'zh-CN-XiaoyouNeural', 'zh-CN-XiaozhenNeural'
    ];
    const DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural';

    const selectedVoice = config.selectedVoice || 'default';
    let voiceToUse = DEFAULT_VOICE;
    if (selectedVoice !== 'default' && VALID_VOICES.includes(selectedVoice)) {
        voiceToUse = selectedVoice;
    }

    if (window.electronAPI && window.electronAPI.speakText) {
        try {
            const audioB64 = await window.electronAPI.speakText(clean, voiceToUse);
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
                const gainNode = audioCtx.createGain();
                gainNode.gain.value = config.voiceVolume != null ? config.voiceVolume : 1.0;
                source.buffer = audioBuffer;
                source.connect(gainNode);
                gainNode.connect(audioCtx.destination);
                source.start();
                return;
            }
        } catch (e) {
            console.error('[TTS] Edge TTS synthesis failed:', e);
        }
    }
}

// ===== 状态预览（设置面板「▶ 预览」→ 主进程转发至此）=====
// 仅在桌宠/聊天窗口响应；设置面板自身不包含桌宠状态机。
// 注意：preload 的通用 on() 是裸 ipcRenderer.on，回调第一参是 Event 对象，需显式取第二参 payload。
if (!isSettingsMode && window.electronAPI && window.electronAPI.on) {
    window.electronAPI.on('float-preview-state', (event, state) => {
        if (state && typeof window.__previewPetState === 'function') {
            window.__previewPetState(String(state));
        }
    });
}

