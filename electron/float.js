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

// 陪伴模式标记：由主进程广播的 companion-mode-started/ended 切换 body 类，
// 用于隐藏下方 DSH 工作状态条（陪伴时浮窗只负责陪伴）
let isCompanionMode = false;
if (!isSettingsMode && !isChatMode && window.electronAPI) {
    if (window.electronAPI.onCompanionModeStarted) {
        window.electronAPI.onCompanionModeStarted(() => {
            isCompanionMode = true;
            document.body.classList.add('companion-mode');
        });
    }
    if (window.electronAPI.onCompanionModeEnded) {
        window.electronAPI.onCompanionModeEnded(() => {
            isCompanionMode = false;
            document.body.classList.remove('companion-mode');
        });
    }
}

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

// ===== 气泡选项 / 常驻动作条 点击事件 =====
// 通过事件委托处理：.bubble-option 既用于鼠标靠近时弹出的 2×2 气泡，
// 也用于窗口底部常驻的四个按钮（.pet-action-bar > .pab-item）。
// 常驻按钮一直可见，所以不要再用气泡的 .show 状态做门禁。
document.addEventListener('click', (e) => {
    const option = e.target.closest('.bubble-option');
    if (!option) return;
    const isActionBar = !!option.closest('.pet-action-bar');
    // 气泡内的选项仍需气泡处于可见状态（鼠标靠近）
    if (!isActionBar && !floatBubble.classList.contains('show')) return;

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

// DSH 覆盖状态机：任务运行中时暂停随机状态机，由 DSH 环节推送决定贴图（设置里可关）
let dshOverrideActive = false;
function setDshOverrideActive(on) {
    dshOverrideActive = on;
    if (on) {
        if (petStateTimer) { clearTimeout(petStateTimer); petStateTimer = null; }
        if (typeof pauseWander === 'function') pauseWander();
    } else {
        // 恢复随机状态机（稍迟半步，避免与 DSH 空闲推送争抢）
        setTimeout(() => {
            if (!dshOverrideActive && typeof randomStateTransition === 'function') randomStateTransition();
        }, 1200);
    }
}

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

// —— 桌宠模式常驻动作条（四个按钮）占用的高度 ——
// 必须与 css/float-ui-additions.css 中 .pet-action-bar 的 height 一致。
// 声明在模块顶层（不能用 const 放在初始化函数里）：getPetBottomGap() 会在
// 初始化流程的更早阶段被调用，块级 const 会造成 TDZ——
// 表现为 "Cannot access 'PET_ACTION_H' before initialization"，
// 整个浮窗初始化随之中断（窗口尺寸不再更新）。
// 竖直堆叠常量（自窗口底边往上），必须与 css/float-ui-additions.css 中的 calc 一致：
//   0                      状态条（DSH 连接 / 硬件 / 峰谷）
//   PET_STAT_H             ↕ PET_STAT_ACTION_GAP → 底部动作条（四个按钮）
//   … + PET_ACTION_H       ↕ PET_ACTION_PET_GAP  → 桌宠贴图
//   贴图上方                DSH 任务面板
const PET_STAT_H = 40;              // 状态条高度（两行小字 + padding）
const PET_STAT_ACTION_GAP = 6;
// 动作条高度 = 按钮尺寸 + 上下留白（由设置里的「按钮大小」驱动，见 petActionH()）
const PET_ACTION_BUTTON_PAD = 6;    // 按钮上下各留一点，避免贴边
const PET_BUTTON_SIZE_DEFAULT = 30; // 按钮最小边长（默认值，与设置里的滑块下限一致）
const PET_ACTION_PET_GAP = 10;
// 贴图上方额外预留的空间：DSH 任务面板就浮在这一带。
// 不留则窗口恰好等于「状态条 + 按钮条 + 贴图」，面板的可用高度会被算成 0，
// 表现为「弹出来的 DSH 监控栏看不见」。
// 240 是实测值：面板（任务 + todolist + 输出）自然高度约 240px，
// 留得太少时浏览器会夹紧 bottom，把面板挤到窗口顶部并压扁。
const PET_HEADROOM = 240;
// 面板隐藏时贴图上方保留的余量（只够"不贴顶"即可）
const PET_HEADROOM_HIDDEN = 14;

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
    // ===== 本地 LLM（OpenAI 兼容：Ollama / LM Studio / vLLM 等）=====
    localApiUrl: '',
    localApiKey: '',
    localModel: '',
    localCompanionModel: '',
    localMemoryModel: '',
    localVisionModel: '',
    // ===== 云端模型自主选择（空 = 用提供商默认模型）=====
    // deepseekModel / zhipuModel 为聊天模型；*Companion/*Memory/*Vision 留空则回退聊天模型
    deepseekModel: '',
    deepseekCompanionModel: '',
    deepseekMemoryModel: '',
    deepseekVisionModel: '',
    zhipuModel: '',
    zhipuCompanionModel: '',
    zhipuMemoryModel: '',
    zhipuVisionModel: '',
    // ===== 自定义 / 中转站（OpenAI 兼容，地址与 Key 全部自填）=====
    customName: '',
    customApiUrl: '',
    customApiKey: '',
    customModel: '',
    customCompanionModel: '',
    customMemoryModel: '',
    customVisionModel: '',
    // ===== 回退与重试（模型繁忙时的重试次数 + 备选模型 + 跨提供商兜底）=====
    aiMaxRetries: 2,          // 同一候选的重试次数（0 = 不重试直接换备选）
    aiRetryDelayMs: 800,      // 首次重试等待（毫秒）
    aiRetryBackoff: true,     // 指数退避：每次重试等待翻倍
    crossProviderFallback: true, // 当前提供商全部失败后，是否回退到其它已配置的提供商
    deepThinking: false,      // 深度思考：先输出 <think>…</think> 再给答复（类似 DeepSeek 客户端）
    agentEnabled: true,       // Agent 开关：关闭后不提供任何 tools，模型只能纯文本回复
    deepseekFallbackModels: [], // 各提供商的备选模型（按顺序尝试）
    // 智谱内置备选序列（与原"GLM 回退链"一致，可在设置面板里增删）
    zhipuFallbackModels: ['glm-4v-flash', 'glm-4v-plus'],
    localFallbackModels: [],
    customFallbackModels: [],
    selectedVoice: 'default',
    voiceEnabled: true,
    voiceAutoSend: true,
    voiceVolume: 1.0,
    stickerPack: '默认',
    // 外观主题（purple 为默认；其它值由 CSS 的 :root[data-accent=...] 提供配色）
    theme: 'purple',
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
    companionFontSize: 14,
    companionPetSize: 180,
    companionThoughtFreq: 'low',
    companionThoughtVisible: false,
    companionTalkThreshold: 54,
    companionScreenSensitivity: 'medium',
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
                // 权威配置到位后同步外观主题
                if (typeof applyTheme === 'function') applyTheme(config.theme || 'purple');
                // 若当前是设置面板模式，刷新控件显示值为权威配置
                if (isSettingsMode) refreshSettingsValues();
            }
        }).catch(() => {});
    }
}
loadConfig();

// ===== 外观主题（程序化配色）=====
// 仅切换 <html data-accent="...">，配色由 CSS 的 --brand 系列令牌驱动，
// 不涉及任何交互/事件逻辑。未知值统一回落到默认紫。
const THEME_NAMES = ['purple', 'blue', 'teal', 'green', 'pink'];
function applyTheme(name) {
    const t = THEME_NAMES.indexOf(name) >= 0 ? name : 'purple';
    document.documentElement.setAttribute('data-accent', t);
    // 同步设置面板色块选中态（不在此处绑定事件）
    document.querySelectorAll('.theme-swatch').forEach((el) => {
        el.classList.toggle('active', el.dataset.themeName === t);
    });
}
applyTheme(config.theme || 'purple');

// 保存配置（设置面板复用；与原版共用 petConfig key）
function saveConfig() {
    localStorage.setItem('petConfig', JSON.stringify(config));
    // 全量同步到主进程：由主进程统一管理并广播给 index / 其它 float 窗口，
    // 解决 file:// 各窗口 localStorage 不互通导致的"两套独立设置"
    if (window.electronAPI && window.electronAPI.syncConfig) {
        window.electronAPI.syncConfig(config);
    }
    // [companion-debug] 保存时打印陪伴相关字段，确认改动确实写进了 config 与同步
    console.log('[companion-debug][saveConfig] companionFontSize=' + config.companionFontSize +
        ' companionPetSize=' + config.companionPetSize +
        ' thoughtFreq=' + config.companionThoughtFreq +
        ' thoughtVisible=' + config.companionThoughtVisible +
        ' talkThreshold=' + config.companionTalkThreshold +
        ' screenSens=' + config.companionScreenSensitivity);
}

// ============================================================
// 设置面板信息架构：左导航 + 右内容 + 全局搜索
// ------------------------------------------------------------
// 导航由现有 .sb-group 自动生成（标题里的 emoji 作为图标、其余作为名称），
// 所以以后新增/调整设置分组不需要额外维护一份目录。
// 搜索按「分组内设置项文本」过滤，命中项自动展开、切页并高亮。
// ============================================================
// ============================================================
// 设置面板信息架构（样张结构：一级页 → 分组 → 设置项）
// ------------------------------------------------------------
// 一级页固定 6 个：常用 5 页 + 「高级」1 页（收纳行为链 / 状态机 / DSH）。
// 每个页由若干 data-gk 分组组成；新增分组只要把它的 data-gk 加进对应页，
// 没登记的会自动落到「高级」页，不会被漏掉。
// 导航是动态生成的，所以以后增删设置分组不需要维护第二份目录。
// ============================================================
const SETTINGS_ADVANCED_GROUPS = ['chain', 'state', 'dsh'];

const SETTINGS_PAGES = [
    { id: 'appearance', ico: '🎨', name: '外观主题', groups: ['theme', 'material', 'style'] },
    { id: 'pet', ico: '🐾', name: '桌宠与浮窗', groups: ['window', 'pet', 'sticker'] },
    { id: 'chat', ico: '💬', name: '交互与语音', groups: ['persona', 'voice'] },
    { id: 'ai', ico: '🤖', name: 'AI 与工具', groups: ['ai'] },
    { id: 'data', ico: '💾', name: '记忆与数据', groups: ['member', 'display', 'companion', 'launch', 'home', 'exit'] },
    { id: 'advanced', ico: '⚙️', name: '高级', groups: SETTINGS_ADVANCED_GROUPS }
];

// 导航图标兜底：部分 emoji 是 Unicode 13+ 新增（🪟 🧩 🖼️ 🎙️ …），
// 较旧的 Windows 10（如 19044）自带 Segoe UI Emoji 没有这些字形，会渲染成方框。
// 这里替换成字形覆盖更广的近义 emoji；只影响分组标题，不改设置项文案。
const SETTINGS_NAV_ICON_FALLBACK = {
    '🪟': '🪄', '🧩': '🎛️', '🖼️': '🖼', '🎙️': '🎤', '🗣️': '🎭', '📖': '📘'
};

let settingsActivePage = SETTINGS_PAGES[0].id;   // 当前一级页
let settingsSearchQuery = '';                    // 当前搜索词（小写）

function settingsBody() { return document.getElementById('settingsBody'); }
function settingsGroups() {
    const body = settingsBody();
    return body ? Array.from(body.querySelectorAll(':scope > .sb-group')) : [];
}
function groupGk(group) { return group.dataset.gk || ''; }
function groupPageId(gk) {
    for (const p of SETTINGS_PAGES) if (p.groups.indexOf(gk) >= 0 || p.id === gk) return p.id;
    return 'advanced';
}
/** 桌面端面板够宽，成对出现的短分组并排放，减少竖直滚动 */
function settingsGroupColumn(group) {
    if (group.dataset.col) return group.dataset.col;
    const items = group.querySelectorAll('.sb-item').length;
    if (items > 4) return 'full';
    if (groupGk(group) === 'ai' || groupGk(group) === 'material') return 'full';
    return 'half';
}
function settingsGroupTitleText(group) {
    const t = group.querySelector(':scope > .sb-group-title');
    return t ? t.textContent.replace(/\s+/g, ' ').trim() : '';
}
function updateSettingsNavActive() {
    const nav = document.getElementById('settingsNav');
    if (!nav) return;
    nav.querySelectorAll('.sb-nav-item').forEach((item) => {
        item.classList.toggle('active', item.dataset.page === settingsActivePage);
    });
}
/** 切页：只显示该页包含的分组；搜索激活时改为跨页过滤（见 applySettingsSearch） */
function activateSettingsPage(pageId) {
    const page = SETTINGS_PAGES.find((p) => p.id === pageId) || SETTINGS_PAGES[0];
    settingsActivePage = page.id;
    updateSettingsNavActive();
    if (settingsSearchQuery) return;
    const body = settingsBody();
    settingsGroups().forEach((g) => { g.style.display = page.groups.indexOf(groupGk(g)) >= 0 ? '' : 'none'; });
    if (body) body.scrollTo({ top: 0, behavior: 'instant' });
}
function buildSettingsNav() {
    const nav = document.getElementById('settingsNav');
    if (!nav || nav.dataset.built === '1') return;
    nav.innerHTML = SETTINGS_PAGES.map((p) => (
        '<button type="button" class="sb-nav-item" data-page="' + p.id + '">' +
        '<span class="sb-nav-ico">' + p.ico + '</span>' +
        '<span class="sb-nav-text">' + p.name + '</span>' +
        '</button>'
    )).join('');
    nav.dataset.built = '1';
    nav.querySelectorAll('.sb-nav-item').forEach((item) => {
        item.addEventListener('click', () => {
            if (settingsSearchQuery) clearSettingsSearch();
            activateSettingsPage(item.dataset.page);
        });
    });
    // 每组的布局属性一次写好；并把没归页的分组标记出来便于排查
    settingsGroups().forEach((g) => {
        g.dataset.col = settingsGroupColumn(g);
        g.dataset.page = groupPageId(groupGk(g));
    });
    activateSettingsPage(settingsActivePage);
}
/** 分组标题的 emoji 作为图标（做兼容替换），其余作为名称 */
function settingsGroupIcon(group) {
    const title = settingsGroupTitleText(group);
    const m = title.match(/^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*|\S{1,2})\s*(.*)$/u);
    const ico = (m && m[1]) || '•';
    return { ico: SETTINGS_NAV_ICON_FALLBACK[ico] || ico, name: ((m && m[2]) || title).trim() };
}

/** 在元素文本里标出命中片段（只处理直接文本节点，避免破坏结构） */
function markSettingsHits(el, query) {
    if (!el || !query) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const hits = [];
    let node;
    while ((node = walker.nextNode())) {
        if (node.nodeValue && node.nodeValue.toLowerCase().indexOf(query) >= 0) hits.push(node);
    }
    hits.forEach((textNode) => {
        const text = textNode.nodeValue;
        const lower = text.toLowerCase();
        const frag = document.createDocumentFragment();
        let i = 0, idx;
        while ((idx = lower.indexOf(query, i)) >= 0) {
            if (idx > i) frag.appendChild(document.createTextNode(text.slice(i, idx)));
            const mk = document.createElement('mark');
            mk.textContent = text.slice(idx, idx + query.length);
            frag.appendChild(mk);
            i = idx + query.length;
        }
        if (i < text.length) frag.appendChild(document.createTextNode(text.slice(i)));
        textNode.parentNode.replaceChild(frag, textNode);
    });
}
function clearEventsMarks() {
    const body = settingsBody();
    if (!body) return;
    body.querySelectorAll('mark').forEach((m) => m.replaceWith(document.createTextNode(m.textContent)));
}
function clearSettingsSearch() {
    const input = document.getElementById('settingsSearchInput');
    const clearBtn = document.getElementById('settingsSearchClear');
    settingsSearchQuery = '';
    if (input) input.value = '';
    if (clearBtn) clearBtn.style.display = 'none';
    clearEventsMarks();
    const empty = document.getElementById('settingsEmpty');
    if (empty) empty.style.display = 'none';
    settingsGroups().forEach((g) => {
        g.querySelectorAll('.sb-item').forEach((it) => { it.style.display = ''; });
        if (g.dataset.searchCollapsed === '1') { g.classList.add('collapsed'); delete g.dataset.searchCollapsed; }
    });
    activateSettingsPage(settingsActivePage);
}
/** 搜索：跨全部页过滤分组与设置项，命中项高亮并自动滚到第一处 */
function applySettingsSearch(rawQuery) {
    const body = settingsBody();
    const input = document.getElementById('settingsSearchInput');
    if (!body || !input) return;
    const clearBtn = document.getElementById('settingsSearchClear');
    const q = String(rawQuery || '').trim().toLowerCase();
    settingsSearchQuery = q;

    clearEventsMarks();
    settingsGroups().forEach((g) => {
        g.querySelectorAll('.sb-item').forEach((it) => { it.style.display = ''; });
        if (g.dataset.searchCollapsed === '1') { g.classList.remove('collapsed'); delete g.dataset.searchCollapsed; }
    });
    if (clearBtn) clearBtn.style.display = q ? '' : 'none';

    if (!q) {
        const empty = document.getElementById('settingsEmpty');
        if (empty) empty.style.display = 'none';
        activateSettingsPage(settingsActivePage);
        return;
    }

    let anyHit = false;
    let firstHit = null;
    settingsGroups().forEach((group) => {
        const items = Array.from(group.querySelectorAll('.sb-item'));
        let groupHit = false;
        items.forEach((item) => {
            const label = item.querySelector('label');
            const text = ((label || item).textContent || '').toLowerCase();
            const full = (item.textContent || '').toLowerCase();
            const hit = text.indexOf(q) >= 0 || full.indexOf(q) >= 0;
            item.style.display = hit ? '' : 'none';
            if (hit) {
                groupHit = true;
                markSettingsHits(label || item, q);
                if (!firstHit) firstHit = group;
            }
        });
        if (!groupHit && settingsGroupTitleText(group).toLowerCase().indexOf(q) >= 0) {
            groupHit = true;
            markSettingsHits(group.querySelector(':scope > .sb-group-title'), q);
            if (!firstHit) firstHit = group;
        }
        group.style.display = groupHit ? '' : 'none';
        if (groupHit) {
            anyHit = true;
            if (group.classList.contains('collapsed')) {
                group.dataset.searchCollapsed = '1';
                group.classList.remove('collapsed');
            }
        }
    });

    const empty = document.getElementById('settingsEmpty');
    if (empty) empty.style.display = anyHit ? 'none' : '';
    if (firstHit) body.scrollTo({ top: Math.max(0, firstHit.offsetTop - 8), behavior: 'instant' });
}
function initSettingsSearch() {
    const input = document.getElementById('settingsSearchInput');
    if (!input || input.dataset.bound === '1') return;
    input.dataset.bound = '1';
    let timer = null;
    input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => applySettingsSearch(input.value), 120);
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { clearSettingsSearch(); input.blur(); }
    });
    const clearBtn = document.getElementById('settingsSearchClear');
    if (clearBtn) clearBtn.addEventListener('click', () => { clearSettingsSearch(); input.focus(); });
}
function initSettingsLayout() {
    if (!document.getElementById('settingsPanel')) return;
    buildSettingsNav();
    initSettingsSearch();
}


// ============================================================
// 外观与材质（窗口背景 / 毛玻璃 / 风格语言 / 主色深浅）
// ------------------------------------------------------------
// 「背景」指的是窗口内部的最底层（.win-bg），不是电脑桌面：
// 控件的值全部写成 <html> 上的 CSS 变量，由 css/float-ui-additions.css
// 消费。这里不碰任何布局与业务逻辑，只负责令牌分发与持久化。
// ============================================================
const APPEARANCE_PRESETS = {
    aurora: { light: 'linear-gradient(160deg, #eef1f8, #dfe4f2)', dark: 'linear-gradient(160deg, #1d1f2b, #14151d)' },
    dusk: { light: 'radial-gradient(600px 420px at 85% 8%, #ffd9c2, transparent 62%), linear-gradient(150deg, #f6eef7, #e6e2f2)', dark: 'radial-gradient(600px 420px at 85% 8%, #4a2b3c, transparent 62%), linear-gradient(150deg, #241a2b, #171320)' },
    mint: { light: 'radial-gradient(600px 420px at 12% 12%, #d5f5e6, transparent 62%), linear-gradient(150deg, #eefaf3, #dcecf6)', dark: 'radial-gradient(600px 420px at 12% 12%, #123c34, transparent 62%), linear-gradient(150deg, #12241f, #101c24)' },
    slate: { light: 'linear-gradient(160deg, #f4f5f8, #e2e5ee)', dark: 'linear-gradient(160deg, #23252f, #14151b)' },
    brand: { light: 'radial-gradient(700px 460px at 10% 0%, var(--brand-soft-strong), transparent 65%), linear-gradient(160deg, #ffffff, var(--brand-soft))', dark: 'radial-gradient(700px 460px at 10% 0%, var(--brand-soft-strong), transparent 65%), linear-gradient(160deg, #1c1d25, #14151b)' }
};
const APPEARANCE_DEFAULTS = {
    winBgPreset: 'brand',
    winBgImage: '',
    winAlpha: 92,
    panelBlur: 18,
    bgBlur: 0,
    bgSat: 100,
    scrim: 0,
    glassOn: true,
    uiStyle: 'fluent',
    darkMode: false
};
function isDarkModeNow() {
    const dm = config.darkMode;
    if (dm === 'system') {
        return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    return !!dm;
}
function applyAppearance() {
    const root = document.documentElement;
    const dark = isDarkModeNow();
    const presetKey = APPEARANCE_PRESETS[config.winBgPreset] ? config.winBgPreset : 'brand';
    const preset = APPEARANCE_PRESETS[presetKey];
    const bgImage = String(config.winBgImage || '').trim();
    // 排查用：外观令牌每次应用都留一条日志（设置改不动时能立刻看出是哪一层没生效）
    console.log('[appearance] apply',
        'style=' + (config.uiStyle || 'fluent'),
        'dark=' + (dark ? 1 : 0),
        'glass=' + (config.glassOn === false ? 0 : 1),
        'preset=' + presetKey,
        'img=' + (bgImage ? 'yes' : 'no'),
        'alpha=' + (config.winAlpha != null ? config.winAlpha : 92),
        'blur=' + (config.panelBlur != null ? config.panelBlur : 18));

    root.setAttribute('data-style', config.uiStyle || 'fluent');
    root.setAttribute('data-ui', config.uiLayout === 'compact' ? 'compact' : 'wide');
    root.setAttribute('data-dark', dark ? '1' : '0');
    root.setAttribute('data-glass', config.glassOn === false ? '0' : '1');
    root.setAttribute('data-bg', bgImage ? 'image' : 'preset');
    root.dataset.bgPreset = presetKey;

    root.style.setProperty('--win-bg', dark ? preset.dark : preset.light);
    root.style.setProperty('--win-bg-image', bgImage ? `url("${bgImage.replace(/"/g, '%22')}")` : 'none');
    root.style.setProperty('--win-alpha', ((config.winAlpha != null ? config.winAlpha : 92) / 100).toFixed(2));
    root.style.setProperty('--card-alpha', Math.min(1, ((config.winAlpha != null ? config.winAlpha : 92) / 100) + .02).toFixed(2));
    root.style.setProperty('--chrome-alpha', Math.max(.3, ((config.winAlpha != null ? config.winAlpha : 92) / 100) - .16).toFixed(2));
    root.style.setProperty('--panel-blur', (config.panelBlur != null ? config.panelBlur : 18) + 'px');
    root.style.setProperty('--bg-blur', (config.bgBlur || 0) + 'px');
    root.style.setProperty('--bg-sat', (config.bgSat != null ? config.bgSat : 100) + '%');
    root.style.setProperty('--scrim', ((config.scrim || 0) / 100).toFixed(2));
}
// 设置面板控件 → config → 令牌（控件缺失时静默跳过，浮窗/聊天窗口没有这些控件）
function refreshAppearanceUI() {
    const g = (id) => document.getElementById(id);
    document.querySelectorAll('#bgPresetRow .bg-preset').forEach((b) => {
        b.classList.toggle('active', b.dataset.preset === (config.winBgPreset || 'brand'));
    });
    const bgName = g('winBgImageName');
    if (bgName) bgName.textContent = config.winBgImage ? String(config.winBgImage).split(/[\\/]/).pop() : '未选择（使用预设渐变）';
    const bind = (id, valId, key, suffix) => {
        const el = g(id);
        if (!el) return;
        const raw = config[key] != null ? config[key] : APPEARANCE_DEFAULTS[key];
        el.value = raw;
        const lbl = g(valId);
        if (lbl) lbl.textContent = raw + (suffix || '');
    };
    bind('winAlphaSlider', 'winAlphaValue', 'winAlpha', '%');
    bind('panelBlurSlider', 'panelBlurValue', 'panelBlur', 'px');
    bind('bgBlurSlider', 'bgBlurValue', 'bgBlur', 'px');
    bind('bgSatSlider', 'bgSatValue', 'bgSat', '%');
    bind('scrimSlider', 'scrimValue', 'scrim', '%');
    const glass = g('glassToggle'); if (glass) glass.checked = config.glassOn !== false;
    const dark = g('darkModeToggle'); if (dark) dark.checked = !!config.darkMode;
    const style = g('uiStyleSelect'); if (style) style.value = config.uiStyle || 'fluent';
    const layout = g('uiLayoutSelect');
    if (layout) layout.value = config.uiLayout === 'compact' ? 'compact' : 'wide';
    const hint = g('winBgToggleHint');
    if (hint) {
        hint.textContent = '聊天 / 设置 / 陪伴窗口共用这一层背景；窗外的电脑桌面不参与毛玻璃。';
    }
}
function initAppearanceControls() {
    const g = (id) => document.getElementById(id);
    if (!g('winAlphaSlider')) return; // 当前窗口没有外观控件
    const setSlider = (id, valId, key, suffix) => {
        const el = g(id);
        if (!el) return;
        el.addEventListener('input', () => {
            const v = Number(el.value);
            config[key] = v;
            const lbl = g(valId);
            if (lbl) lbl.textContent = v + suffix;
            applyAppearance();
            saveConfig();
        });
    };
    setSlider('winAlphaSlider', 'winAlphaValue', 'winAlpha', '%');
    setSlider('panelBlurSlider', 'panelBlurValue', 'panelBlur', 'px');
    setSlider('bgBlurSlider', 'bgBlurValue', 'bgBlur', 'px');
    setSlider('bgSatSlider', 'bgSatValue', 'bgSat', '%');
    setSlider('scrimSlider', 'scrimValue', 'scrim', '%');

    const glass = g('glassToggle');
    if (glass) glass.addEventListener('change', () => { config.glassOn = !!glass.checked; applyAppearance(); saveConfig(); });
    const dark = g('darkModeToggle');
    if (dark) dark.addEventListener('change', () => { config.darkMode = !!dark.checked; applyAppearance(); saveConfig(); });
    const style = g('uiStyleSelect');
    if (style) style.addEventListener('change', () => { config.uiStyle = style.value; applyAppearance(); saveConfig(); });
    const layout = g('uiLayoutSelect');
    if (layout) layout.addEventListener('change', () => {
        config.uiLayout = layout.value;
        applyAppearance();
        saveConfig();
    });

    document.querySelectorAll('#bgPresetRow .bg-preset').forEach((b) => {
        b.addEventListener('click', () => {
            config.winBgPreset = b.dataset.preset;
            config.winBgImage = ''; // 选预设即清掉自定义图片，避免两套背景互相打架
            document.querySelectorAll('#bgPresetRow .bg-preset').forEach((x) => x.classList.toggle('active', x === b));
            applyAppearance();
            saveConfig();
            refreshAppearanceUI();
        });
    });
    const clearBtn = g('clearBgImageBtn');
    if (clearBtn) clearBtn.addEventListener('click', () => {
        config.winBgImage = '';
        applyAppearance();
        saveConfig();
        refreshAppearanceUI();
    });
    const pickBtn = g('pickBgImageBtn');
    if (pickBtn) pickBtn.addEventListener('click', async () => {
        if (!window.electronAPI || !window.electronAPI.pickBgImage) return;
        try {
            const res = await window.electronAPI.pickBgImage();
            if (!res || res.canceled) return;
            if (res.error) { alert(res.error); return; }
            config.winBgImage = res.fileUrl || '';
            applyAppearance();
            saveConfig();
            refreshAppearanceUI();
        } catch (e) {
            console.warn('[bg] pick image failed:', e && e.message);
        }
    });
}
// 跟随系统深浅时，系统主题变化要重算令牌
if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => { if (config.darkMode === 'system') applyAppearance(); };
    if (mq.addEventListener) mq.addEventListener('change', onScheme);
    else if (mq.addListener) mq.addListener(onScheme);
}
applyAppearance();

// 多模态提供商默认 API 地址与标签
function mmProviderDefaults() {
    return {
        deepseek: { url: 'https://api.deepseek.com/v1/chat/completions', keyLabel: 'DeepSeek API Key', keyPlaceholder: '输入你的 DeepSeek API Key...' },
        zhipu: { url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', keyLabel: '智谱 API Key', keyPlaceholder: '输入你的智谱 API Key...' },
        local: { url: 'http://localhost:11434/v1/chat/completions', keyLabel: '本地 API Key（可选）', keyPlaceholder: '本地服务一般不需要 Key，留空即可' },
        // 自定义 / 中转站：无内置默认地址，全部由用户填写
        custom: { url: '', keyLabel: 'API Key', keyPlaceholder: '中转站 / 厂商提供的 Key' }
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
// 地址 / Key 字段按提供商区分：deepseek→apiUrl/apiKey，其余用 <prefix>ApiUrl/<prefix>ApiKey
function chatCredentials() {
    const p = config.multimodalProvider || 'deepseek';
    const cred = requireAIF().credentials(config, p);
    return { base: cred.apiUrl, key: cred.apiKey };
}

// ===== 模型自主选择（按提供商 × 用途）=====
const $el = (id) => document.getElementById(id);
// 提供商元信息 / 候选链 / 重试与回退规则统一由 ai-fallback.js 提供（主进程共用同一套实现）
const AIF = (typeof AIFallback !== 'undefined') ? AIFallback : null;
function requireAIF() {
    if (!AIF) throw new Error('ai-fallback.js 未加载，无法进行模型调用');
    return AIF;
}
// 每个提供商都有自己的模型字段，互不覆盖：
//   deepseek: deepseekModel / deepseekCompanionModel / deepseekMemoryModel / deepseekVisionModel
//   zhipu:    zhipuModel    / zhipuCompanionModel    / zhipuMemoryModel    / zhipuVisionModel
//   custom:   customModel   / customCompanionModel   / customMemoryModel   / customVisionModel
//   local:    localModel    / localCompanionModel    / localMemoryModel    / localVisionModel
// 规则：用途模型留空 → 回退该提供商的「聊天模型」；聊天模型也留空 → 用提供商默认模型。
const MODEL_PROVIDER_META = {
    deepseek: { prefix: 'deepseek', defaultModel: 'deepseek-flash', label: 'DeepSeek' },
    zhipu: { prefix: 'zhipu', defaultModel: 'glm-4.6v-flash', label: '智谱 AI' },
    local: { prefix: 'local', defaultModel: '', label: '本地 LLM' },
    custom: { prefix: 'custom', defaultModel: '', label: '自定义 / 中转站' }
};
// 无法从服务商拉取模型列表时（或首次打开）用于下拉提示的候选模型
const MODEL_PRESETS = {
    deepseek: ['deepseek-flash', 'deepseek-chat', 'deepseek-reasoner'],
    zhipu: ['glm-4.6v-flash', 'glm-4.6v', 'glm-4.5-flash', 'glm-4-flash', 'glm-4v-flash', 'glm-4-plus'],
    local: [],
    // 中转站 / 其它厂商常见模型名（仅作下拉提示，实际以 🔄 拉取或手填为准）
    custom: ['gpt-4o-mini', 'gpt-4o', 'claude-3-5-sonnet', 'gemini-1.5-pro', 'qwen-plus', 'deepseek-chat']
};
const MODEL_MODES = ['chat', 'companion', 'memory', 'vision'];
// 从服务商 /models 拉到的列表缓存（仅内存，用于本次设置面板会话的下拉提示）
const modelListCache = {};
let modelFetching = false;

// config 中存放某提供商某用途模型名的字段名（实现见 ai-fallback.js，主进程共用）
function modelFieldKey(provider, mode) {
    return requireAIF().fieldKey(provider, mode);
}

// 提供商默认模型（用户完全未配置时使用）
function providerDefaultModel(provider) {
    return requireAIF().meta(provider).defaultModel;
}

// 当前提供商使用的模型名（按模式区分：chat / companion / memory / vision）
// 规则：用途模型 → 该提供商聊天模型 → 提供商默认模型（本地/中转站可为空，由服务端决定）
function providerModelName(mode = 'chat', providerOverride) {
    const p = providerOverride || config.multimodalProvider || 'deepseek';
    return requireAIF().resolveModel(config, p, mode);
}

// 当前提供商在界面上的展示名（自定义提供商优先显示用户填的名称）
function providerDisplayName(provider) {
    const p = provider || config.multimodalProvider || 'deepseek';
    if (p === 'custom') return (config.customName || '').trim() || '自定义 / 中转站';
    return requireAIF().meta(p).label;
}

// 某提供商可选模型候选：预设 + 已拉取的列表（去重）
function modelOptionsFor(provider) {
    const out = [];
    const push = (n) => { const v = String(n || '').trim(); if (v && out.indexOf(v) === -1) out.push(v); };
    (MODEL_PRESETS[provider] || []).forEach(push);
    const cached = modelListCache[provider];
    if (Array.isArray(cached)) cached.forEach(push);
    // 已配置的模型名也放进候选，避免下拉把用户自定义值顶掉
    MODEL_MODES.forEach(m => push(config[modelFieldKey(provider, m)]));
    return out;
}

// 供测试连接 / 保存前使用：优先取表单里尚未失焦的值
function currentModelFromForm(mode = 'chat', provider) {
    const p = provider || config.multimodalProvider || 'deepseek';
    const el = $el({ chat: 'modelChatInput', companion: 'modelCompanionInput', memory: 'modelMemoryInput', vision: 'modelVisionInput' }[mode] || 'modelChatInput');
    const typed = el ? String(el.value || '').trim() : '';
    if (typed) return typed;
    return providerModelName(mode, p);
}

// 当前提供商用于「拉取模型列表」的地址与 Key（表单值优先，便于未保存时直接拉取）
function modelFetchCredentials(provider) {
    const p = provider || config.multimodalProvider || 'deepseek';
    if (p === 'local') {
        const urlEl = $el('localApiUrlInput');
        const keyEl = $el('localApiKeyInput');
        return {
            provider: p,
            apiUrl: (urlEl && urlEl.value.trim()) || config.localApiUrl || mmProviderDefaults().local.url,
            apiKey: ((keyEl && keyEl.value.trim()) || config.localApiKey || '')
        };
    }
    const urlEl = $el('apiUrlInput');
    const keyEl = $el('apiKeyInput');
    if (p === 'zhipu') {
        return {
            provider: p,
            apiUrl: (urlEl && urlEl.value.trim()) || config.zhipuApiUrl || mmProviderDefaults().zhipu.url,
            apiKey: ((keyEl && keyEl.value.trim()) || config.zhipuApiKey || '')
        };
    }
    return {
        provider: p,
        apiUrl: (urlEl && urlEl.value.trim()) || config.apiUrl || mmProviderDefaults().deepseek.url,
        apiKey: ((keyEl && keyEl.value.trim()) || config.apiKey || '')
    };
}

// 渲染模型选择区：回填各用途输入框、刷新候选下拉与"当前生效"提示
function refreshModelUI() {
    const $id = (id) => document.getElementById(id);
    const p = config.multimodalProvider || 'deepseek';
    const meta = MODEL_PROVIDER_META[p] || MODEL_PROVIDER_META.deepseek;
    const inputs = {
        chat: $id('modelChatInput'),
        companion: $id('modelCompanionInput'),
        memory: $id('modelMemoryInput'),
        vision: $id('modelVisionInput')
    };
    const effectiveChat = providerModelName('chat', p);
    MODEL_MODES.forEach(mode => {
        const el = inputs[mode];
        if (!el) return;
        el.value = String(config[modelFieldKey(p, mode)] || '').trim();
        if (mode === 'chat') {
            el.placeholder = meta.defaultModel
                ? `留空使用默认：${meta.defaultModel}`
                : '如 qwen2.5-3b（留空由本地服务决定）';
        } else {
            el.placeholder = `空 = 用聊天模型（${effectiveChat || '服务端默认'}）`;
        }
    });
    const dl = $id('modelOptionsList');
    if (dl) {
        const opts = modelOptionsFor(p);
        dl.innerHTML = opts.map(n => `<option value="${String(n).replace(/"/g, '&quot;')}"></option>`).join('');
    }
    const hint = $id('modelHint');
    if (hint) {
        const parts = MODEL_MODES.map(m => {
            const label = { chat: '聊天', companion: '陪伴', memory: '记忆', vision: '视觉' }[m];
            return `${label}：${providerModelName(m, p) || '服务端默认'}`;
        });
        hint.textContent = `${providerDisplayName(p)} 当前生效 —— ${parts.join(' · ')}。可直接输入模型名，或点 🔄 拉取列表后下拉选择。`;
    }
}

// 从服务商拉取可用模型列表（走主进程，避免渲染进程 CORS 限制）
// showStatus=false 用于后台静默拉取（自动刷新下拉候选，不打扰用户）
async function fetchProviderModels(showStatus = true) {
    const $id = (id) => document.getElementById(id);
    const hint = $id('modelHint');
    const btn = $id('modelFetchBtn');
    const p = config.multimodalProvider || 'deepseek';
    if (modelFetching) return;
    const cred = modelFetchCredentials(p);
    if (!cred.apiUrl) {
        if (showStatus && hint) hint.textContent = '请先填写 API 地址后再拉取模型列表。';
        return;
    }
    // 云端提供商没有 Key 时不必请求，直接用内置候选
    if (p !== 'local' && !cred.apiKey) {
        if (showStatus && hint) hint.textContent = '请先填写 API Key 后再拉取模型列表（也可直接手动输入模型名）。';
        return;
    }
    modelFetching = true;
    if (btn) btn.disabled = true;
    const prevHint = hint ? hint.textContent : '';
    const restoreHint = () => { if (!showStatus && hint) hint.textContent = prevHint; };
    if (showStatus && hint) hint.textContent = '正在从服务商拉取模型列表…';
    try {
        if (!window.electronAPI || !window.electronAPI.listModels) throw new Error('主进程不支持模型列表接口');
        const res = await window.electronAPI.listModels({ provider: p, apiKey: cred.apiKey, apiUrl: cred.apiUrl });
        const models = (res && Array.isArray(res.models)) ? res.models : [];
        if (models.length) {
            modelListCache[p] = models;
            refreshModelUI();
            if (showStatus && hint) {
                hint.textContent = `已获取 ${models.length} 个模型（点击输入框可下拉选择）：` + models.slice(0, 8).join('、') + (models.length > 8 ? ' …' : '');
            } else {
                restoreHint();
            }
        } else if (showStatus && hint) {
            hint.textContent = (res && res.message) ? `未获取到模型列表：${res.message}（可直接手动输入模型名）` : '未获取到模型列表，可直接手动输入模型名。';
        } else {
            restoreHint();
        }
    } catch (e) {
        if (showStatus && hint) hint.textContent = '拉取模型列表失败：' + ((e && e.message) ? e.message : e) + '（可直接手动输入模型名）';
        else restoreHint();
    } finally {
        modelFetching = false;
        if (btn) btn.disabled = false;
    }
}

// 兼容旧调用：填充本地模型下拉（现已并入统一模型选择区）
async function fetchLocalModelsIntoDatalist() {
    await fetchProviderModels(false);
}

// ===== 回退与重试区 =====
// 各提供商的备选模型字段：deepseekFallbackModels / zhipuFallbackModels / local* / custom*
function fallbackFieldKey(provider) {
    return requireAIF().meta(provider).prefix + 'FallbackModels';
}

// 当前提供商的备选模型列表（保证是数组）
function currentFallbackList(provider) {
    const p = provider || config.multimodalProvider || 'deepseek';
    const key = fallbackFieldKey(p);
    if (!Array.isArray(config[key])) config[key] = [];
    return config[key];
}

// 渲染备选模型列表 + 重试参数 + 实际尝试顺序预览
function refreshFallbackUI() {
    const p = config.multimodalProvider || 'deepseek';
    const AI = requireAIF();
    const policy = AI.retryPolicy(config);
    if (aiMaxRetriesSlider) aiMaxRetriesSlider.value = String(policy.maxRetries);
    if (aiMaxRetriesValue) aiMaxRetriesValue.textContent = policy.maxRetries === 0 ? '不重试' : String(policy.maxRetries);
    if (aiRetryDelaySlider) aiRetryDelaySlider.value = String(policy.delayMs);
    if (aiRetryDelayValue) aiRetryDelayValue.textContent = policy.delayMs + 'ms';
    if (aiRetryBackoffToggle) aiRetryBackoffToggle.checked = !!policy.backoff;
    if (crossProviderFallbackToggle) crossProviderFallbackToggle.checked = config.crossProviderFallback !== false;
    if (deepThinkingToggle) deepThinkingToggle.checked = !!config.deepThinking;
    if (agentEnabledToggle) agentEnabledToggle.checked = config.agentEnabled !== false;

    const list = currentFallbackList(p);
    if (fallbackModelList) {
        if (!list.length) {
            fallbackModelList.innerHTML = '<div class="memory-empty" style="font-size:12px;color:#aaa;padding:4px 2px;">还没有备选模型（可留空，仅用重试）</div>';
        } else {
            fallbackModelList.innerHTML = list.map((m, i) =>
                `<div class="chain-item" data-i="${i}"><span style="flex:1;word-break:break-all;">${i + 1}. ${escapeHtml(m)}</span>` +
                `<button class="chain-del" data-act="up" data-i="${i}" title="上移" ${i === 0 ? 'disabled style="opacity:.4"' : ''}>↑</button>` +
                `<button class="chain-del" data-act="del" data-i="${i}" title="删除">删</button></div>`
            ).join('');
        }
    }
    if (fallbackHint) {
        const chain = AI.buildChain(config, 'chat');
        const chainLabel = (c) => (c.provider === p ? providerDisplayName(p) : AI.meta(c.provider).label);
        const names = chain.map((c, i) => `${i + 1}.${chainLabel(c)}/${c.model || '(默认)'}`);
        const retryText = policy.maxRetries > 0
            ? `繁忙时先重试 ${policy.maxRetries} 次（间隔 ${policy.delayMs}ms${policy.backoff ? '，指数退避' : ''}）`
            : '当前不重试，失败后直接换下一个候选';
        fallbackHint.textContent = `${retryText}。实际尝试顺序：${names.length ? names.join(' → ') : '（未配置可用的提供商）'}`;
    }
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
    // 本地 LLM / 自定义（中转站）各自使用独立 Key/地址输入框；云端提供商显示共享输入框
    const sharedKeyItem = $('sharedKeyItem');
    const sharedUrlItem = $('sharedUrlItem');
    const localKeyItem = $('localKeyItem');
    const localUrlItem = $('localUrlItem');
    const localApiKeyInput = $('localApiKeyInput');
    const localApiUrlInput = $('localApiUrlInput');
    const customNameItem = $('customNameItem');
    const customUrlItem = $('customUrlItem');
    const customKeyItem = $('customKeyItem');
    const customNameInput = $('customNameInput');
    const customApiUrlInput = $('customApiUrlInput');
    const customApiKeyInput = $('customApiKeyInput');
    const isLocal = provider === 'local';
    const isCustom = provider === 'custom';
    if (sharedKeyItem) sharedKeyItem.style.display = (isLocal || isCustom) ? 'none' : '';
    if (sharedUrlItem) sharedUrlItem.style.display = (isLocal || isCustom) ? 'none' : '';
    if (localKeyItem) localKeyItem.style.display = isLocal ? '' : 'none';
    if (localUrlItem) localUrlItem.style.display = isLocal ? '' : 'none';
    if (customNameItem) customNameItem.style.display = isCustom ? '' : 'none';
    if (customUrlItem) customUrlItem.style.display = isCustom ? '' : 'none';
    if (customKeyItem) customKeyItem.style.display = isCustom ? '' : 'none';
    if (isLocal) {
        if (localApiUrlInput) localApiUrlInput.value = config.localApiUrl || def.url;
        if (localApiKeyInput) localApiKeyInput.value = config.localApiKey || '';
    } else if (isCustom) {
        if (customNameInput) customNameInput.value = config.customName || '';
        if (customApiUrlInput) customApiUrlInput.value = config.customApiUrl || '';
        if (customApiKeyInput) customApiKeyInput.value = config.customApiKey || '';
    } else {
        const keyValue = provider === 'zhipu' ? (config.zhipuApiKey || '') : (config.apiKey || '');
        const urlValue = provider === 'zhipu'
            ? (config.zhipuApiUrl || def.url)
            : (config.apiUrl || def.url);
        if (keyLbl) keyLbl.textContent = def.keyLabel;
        if (keyInput) { keyInput.value = keyValue; keyInput.placeholder = def.keyPlaceholder; }
        if (urlInput) urlInput.value = urlValue;
    }
    // 模型选择区（所有提供商通用：聊天 / 陪伴 / 记忆 / 视觉）
    refreshModelUI();
    // 回退与重试区（备选模型按提供商分开存储）
    refreshFallbackUI();
}

// 仅刷新设置面板控件的显示值（不重新绑定事件/不重拉音色与贴图包），
// 用于配置被其它窗口改动后（config-updated）或启动拉取权威配置后同步展示
function refreshSettingsValues() {
    const $ = (id) => document.getElementById(id);
    const setVal = (id, val, labelId) => { const el = $(id); if (el) el.value = val; if (labelId) { const l = $(labelId); if (l) l.textContent = val; } };
    const setCheck = (id, val) => { const el = $(id); if (el) el.checked = !!val; };

    // 外观主题（标记当前色块选中态）
    applyTheme(config.theme || 'purple');
    // 外观与材质（背景 / 毛玻璃 / 风格 / 深色）：控件回填并重算令牌
    refreshAppearanceUI();
    applyAppearance();
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
    // 陪伴模式数值体系回填（与 initSettingsPanel 内的回填保持一致，避免被覆盖"变回"）
    setVal('companionFontSizeSlider', config.companionFontSize || 14, 'companionFontSizeValue');
    setVal('companionPetSizeSlider', config.companionPetSize || 180, 'companionPetSizeValue');
    const cThFreq = $('companionThoughtFreqSelect'); if (cThFreq) cThFreq.value = config.companionThoughtFreq || 'low';
    setCheck('companionThoughtVisibleToggle', config.companionThoughtVisible);
    setVal('companionTalkThresholdSlider', config.companionTalkThreshold != null ? config.companionTalkThreshold : 54, 'companionTalkThresholdValue');
    const cSens = $('companionScreenSensitivitySelect'); if (cSens) cSens.value = config.companionScreenSensitivity || 'medium';
    // [companion-debug] 回填时打印，确认返回到 UI 的值来源
    console.log('[companion-debug][refreshSettingsValues] from config.f', config.companionFontSize,
        ' petSize', config.companionPetSize, ' thFreq', config.companionThoughtFreq,
        ' thVis', config.companionThoughtVisible, ' thr', config.companionTalkThreshold,
        ' sens', config.companionScreenSensitivity);

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
        try { fillOverrideSelects(); } catch (e) { console.warn('[float] fillOverrideSelects:', e); }
    }
    packAssetKey = key;
}
// DSH 联动 → 环节贴图状态：六个环节（思考/命令/读取/查找/完成/失败）各配一个状态下拉。
// 选项直接复用【状态】设置的同源列表 selectableStates()（现场注册的贴图原名，含陌生贴图），
// 渲染时机跟随 renderStateConfig：状态注册/新增贴图后两者一起刷新，永远一致。
function fillOverrideSelects() {
    const OVR_EL_KEYS = { think: 'dshStateThink', cmd: 'dshStateCmd', read: 'dshStateRead', grep: 'dshStateGrep', done: 'dshStateDone', error: 'dshStateError' };
    const ovr = (config && config.dsh && config.dsh.override) || {};
    const stateMap = ovr.states || {};
    const opts = selectableStates();
    // 调试日志：一次即可，确认下拉确实被填充（经主进程转发打印）
    const sel = document.getElementById('dshStateThink');
    if (sel && window.electronAPI && window.electronAPI.logToMain && !window.__dshOvrLogDone) {
        window.__dshOvrLogDone = true;
        window.electronAPI.logToMain('info', '[float:settings] dsh override selects: states=' + opts.length + ' options=[' + opts.join(',') + ']');
    }
    Object.keys(OVR_EL_KEYS).forEach(k => {
        const el = document.getElementById(OVR_EL_KEYS[k]);
        if (!el) return;
        el.innerHTML = '<option value="">不覆盖</option>' + opts.map(s =>
            '<option value="' + escapeHtml(s) + '"' + (stateMap[k] === s ? ' selected' : '') + '>' + escapeHtml(s) + '</option>'
        ).join('');
        if (!stateMap[k]) el.value = '';
        el.onchange = () => {
            const o = (config && config.dsh && config.dsh.override) || {};
            config.dsh = { ...(config.dsh || {}), override: { enabled: true, states: {}, ...o, states: { ...(o.states || {}), [k]: el.value } } };
            if (window.electronAPI && window.electronAPI.syncConfig) window.electronAPI.syncConfig(config);
        };
    });
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
    console.log('[companion-debug][initSettingsPanel] START');
    const $ = (id) => document.getElementById(id);
    const on = (node, evt, fn) => { if (node) node.addEventListener(evt, fn); };

    // ===== 外观主题色块：点击即切换 + 持久化（仅改反馈层，不影响其它逻辑）=====
    const themeSwatches = $('themeSwatches');
    on(themeSwatches, 'click', (evt) => {
        const btn = evt.target && evt.target.closest ? evt.target.closest('.theme-swatch') : null;
        if (!btn) return;
        const name = btn.dataset.themeName;
        if (!name) return;
        config.theme = name;
        applyTheme(name);
        saveConfig();
    });

    // ===== 外观与材质（窗口背景 / 毛玻璃 / 风格语言）=====
    // 控件值 → 令牌 → 持久化；与业务逻辑完全无关
    refreshAppearanceUI();
    initAppearanceControls();
    // ===== 信息架构：左导航 + 右内容 + 顶部搜索 =====
    initSettingsLayout();

    // ===== 陪伴模式控件统一事件委托（不依赖后续绑定是否执行）=====
    // 用 document 级 input/change 委托，按 id 分发：即使下方 initSettingsPanel 的同步绑定
    // 因为任何异常中断，这里也已生效，保证拖动滑块 / 切换下拉立即更新 config 并保存。
    const onCompanionInput = (evt) => {
        const t = evt.target;
        if (!t || !t.id) return;
        const change = vi => {
            if (vi === undefined) return;
            try {
                saveConfig();
            } catch (e) { console.warn('[companion-debug] save err', e); }
        };
        switch (t.id) {
            case 'companionWidthSlider':
                config.companionWidth = Number(t.value);
                { const l = document.getElementById('companionWidthValue'); if (l) l.textContent = t.value; }
                change(config.companionWidth);
                break;
            case 'companionFontSizeSlider':
                config.companionFontSize = Number(t.value);
                { const l = document.getElementById('companionFontSizeValue'); if (l) l.textContent = t.value; }
                change(config.companionFontSize);
                if (window.electronAPI && window.electronAPI.send) window.electronAPI.send('set-companion-font-size', Number(t.value));
                break;
            case 'companionPetSizeSlider':
                config.companionPetSize = Number(t.value);
                { const l = document.getElementById('companionPetSizeValue'); if (l) l.textContent = t.value; }
                change(config.companionPetSize);
                if (window.electronAPI && window.electronAPI.send) window.electronAPI.send('set-companion-pet-size', Number(t.value));
                break;
            case 'companionThoughtFreqSelect':
                config.companionThoughtFreq = t.value;
                // 频率非 off 时视为"思考已启用"（companion 端 thinkTick 依赖此开关）
                config.companionThoughtEnabled = t.value !== 'off';
                change(config.companionThoughtFreq);
                break;
            case 'companionThoughtVisibleToggle':
                config.companionThoughtVisible = t.checked;
                change(config.companionThoughtVisible);
                break;
            case 'companionTalkThresholdSlider':
                config.companionTalkThreshold = Number(t.value);
                { const l = document.getElementById('companionTalkThresholdValue'); if (l) l.textContent = t.value; }
                change(config.companionTalkThreshold);
                break;
            case 'companionScreenSensitivitySelect':
                config.companionScreenSensitivity = t.value;
                change(config.companionScreenSensitivity);
                break;
            default:
                return;
        }
        console.log('[companion-debug][delegated] id=' + t.id + ' value=' + (t.value !== undefined ? t.value : t.checked));
    };
    document.addEventListener('input', onCompanionInput);
    document.addEventListener('change', onCompanionInput);
    console.log('[companion-debug] companion delegated listener registered');

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
    const sharedKeyItem = $('sharedKeyItem');
    const sharedUrlItem = $('sharedUrlItem');
    const localKeyItem = $('localKeyItem');
    const localUrlItem = $('localUrlItem');
    const localApiKeyInput = $('localApiKeyInput');
    const localApiUrlInput = $('localApiUrlInput');
    // 模型选择区（所有提供商通用）
    const modelChatInput = $('modelChatInput');
    const modelCompanionInput = $('modelCompanionInput');
    const modelMemoryInput = $('modelMemoryInput');
    const modelVisionInput = $('modelVisionInput');
    const modelFetchBtn = $('modelFetchBtn');
    // 自定义 / 中转站
    const customNameInput = $('customNameInput');
    const customApiUrlInput = $('customApiUrlInput');
    const customApiKeyInput = $('customApiKeyInput');
    // 回退与重试
    const aiMaxRetriesSlider = $('aiMaxRetriesSlider');
    const aiMaxRetriesValue = $('aiMaxRetriesValue');
    const aiRetryDelaySlider = $('aiRetryDelaySlider');
    const aiRetryDelayValue = $('aiRetryDelayValue');
    const aiRetryBackoffToggle = $('aiRetryBackoffToggle');
    const crossProviderFallbackToggle = $('crossProviderFallbackToggle');
    const deepThinkingToggle = $('deepThinkingToggle');
    const agentEnabledToggle = $('agentEnabledToggle');
    const fallbackModelInput = $('fallbackModelInput');
    const fallbackAddBtn = $('fallbackAddBtn');
    const fallbackModelList = $('fallbackModelList');
    const fallbackHint = $('fallbackHint');
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
    // 陪伴模式数值体系控件
    const companionFontSizeSlider = $('companionFontSizeSlider');
    const companionFontSizeValue = $('companionFontSizeValue');
    const companionPetSizeSlider = $('companionPetSizeSlider');
    const companionPetSizeValue = $('companionPetSizeValue');
    const companionThoughtFreqSelect = $('companionThoughtFreqSelect');
    const companionThoughtVisibleToggle = $('companionThoughtVisibleToggle');
    const companionTalkThresholdSlider = $('companionTalkThresholdSlider');
    const companionTalkThresholdValue = $('companionTalkThresholdValue');
    const companionScreenSensitivitySelect = $('companionScreenSensitivitySelect');

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
    // 打开设置面板时静默拉取一次当前提供商的模型列表，填充下拉候选（失败则只保留内置候选）
    setTimeout(() => { fetchProviderModels(false); }, 0);
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
    // 陪伴模式数值体系设置回填
    const cfSize = $('companionFontSizeSlider'), cfSizeVal = $('companionFontSizeValue');
    if (cfSize) { cfSize.value = config.companionFontSize || 14; if (cfSizeVal) cfSizeVal.textContent = config.companionFontSize || 14; }
    const cpSize = $('companionPetSizeSlider'), cpSizeVal = $('companionPetSizeValue');
    if (cpSize) { cpSize.value = config.companionPetSize || 180; if (cpSizeVal) cpSizeVal.textContent = config.companionPetSize || 180; }
    const cThFreq = $('companionThoughtFreqSelect');
    if (cThFreq) cThFreq.value = config.companionThoughtFreq || 'low';
    const cThVis = $('companionThoughtVisibleToggle');
    if (cThVis) cThVis.checked = !!config.companionThoughtVisible;
    const cThreshold = $('companionTalkThresholdSlider'), cThresholdVal = $('companionTalkThresholdValue');
    if (cThreshold) { cThreshold.value = config.companionTalkThreshold != null ? config.companionTalkThreshold : 54; if (cThresholdVal) cThresholdVal.textContent = cThreshold.value; }
    const cSens = $('companionScreenSensitivitySelect');
    if (cSens) cSens.value = config.companionScreenSensitivity || 'medium';

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
            } else if (config.multimodalProvider === 'local') {
                if (!config.localApiUrl) config.localApiUrl = def.url;
            } else {
                if (!config.apiUrl) config.apiUrl = def.url;
            }
        }
        refreshMultimodalUI();
        saveConfig();
        // 切换提供商后自动拉取该提供商的可用模型列表（失败不影响手动输入）
        fetchProviderModels(false);
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
        } else if (config.multimodalProvider === 'local') {
            config.localApiKey = v;
        } else {
            config.apiKey = v;
        }
        saveConfig();
    });
    on(apiUrlInput, 'change', () => {
        const v = apiUrlInput.value.trim();
        if (config.multimodalProvider === 'zhipu') {
            config.zhipuApiUrl = v || mmProviderDefaults().zhipu.url;
        } else if (config.multimodalProvider === 'local') {
            config.localApiUrl = v || mmProviderDefaults().local.url;
        } else {
            config.apiUrl = v || mmProviderDefaults().deepseek.url;
        }
        saveConfig();
    });
    // 本地 LLM 独立 Key/地址（与 DeepSeek/智谱完全分离，各自存各自的字段）
    if (localApiKeyInput) {
        on(localApiKeyInput, 'change', () => {
            config.localApiKey = localApiKeyInput.value.trim();
            saveConfig();
        });
    }
    if (localApiUrlInput) {
        on(localApiUrlInput, 'change', () => {
            config.localApiUrl = localApiUrlInput.value.trim() || mmProviderDefaults().local.url;
            saveConfig();
            // 地址变化后刷新模型下拉（本地服务 /models 列表）
            fetchLocalModelsIntoDatalist();
        });
    }
    // ===== 模型选择：所有提供商都可自主选择模型（空 = 回退聊天模型 / 提供商默认）=====
    [
        ['modelChatInput', 'chat'],
        ['modelCompanionInput', 'companion'],
        ['modelMemoryInput', 'memory'],
        ['modelVisionInput', 'vision']
    ].forEach(([elId, mode]) => {
        const el = $el(elId);
        if (!el) return;
        on(el, 'change', () => {
            const p = config.multimodalProvider || 'deepseek';
            config[modelFieldKey(p, mode)] = String(el.value || '').trim();
            saveConfig();
            refreshModelUI();
        });
    });
    if (modelFetchBtn) {
        on(modelFetchBtn, 'click', () => { fetchProviderModels(true); });
    }
    // ===== 自定义 / 中转站：地址与 Key 独立存储，互不影响其它提供商 =====
    if (customNameInput) {
        on(customNameInput, 'change', () => {
            config.customName = customNameInput.value.trim();
            saveConfig(); refreshModelUI(); refreshFallbackUI();
        });
    }
    if (customApiUrlInput) {
        on(customApiUrlInput, 'change', () => {
            config.customApiUrl = customApiUrlInput.value.trim();
            saveConfig();
            // 地址变化后尝试拉取该中转站可用的模型列表
            fetchProviderModels(false);
        });
    }
    if (customApiKeyInput) {
        on(customApiKeyInput, 'change', () => {
            config.customApiKey = customApiKeyInput.value.trim();
            saveConfig();
            fetchProviderModels(false);
        });
    }
    // ===== 回退与重试 =====
    if (aiMaxRetriesSlider) {
        on(aiMaxRetriesSlider, 'input', () => {
            config.aiMaxRetries = Number(aiMaxRetriesSlider.value);
            saveConfig(); refreshFallbackUI();
        });
    }
    if (aiRetryDelaySlider) {
        on(aiRetryDelaySlider, 'input', () => {
            config.aiRetryDelayMs = Number(aiRetryDelaySlider.value);
            saveConfig(); refreshFallbackUI();
        });
    }
    if (aiRetryBackoffToggle) {
        on(aiRetryBackoffToggle, 'change', () => {
            config.aiRetryBackoff = aiRetryBackoffToggle.checked;
            saveConfig(); refreshFallbackUI();
        });
    }
    if (crossProviderFallbackToggle) {
        on(crossProviderFallbackToggle, 'change', () => {
            config.crossProviderFallback = crossProviderFallbackToggle.checked;
            saveConfig(); refreshFallbackUI();
        });
    }
    // 深度思考开关（先 <think> 再输出）
    if (deepThinkingToggle) {
        on(deepThinkingToggle, 'change', () => {
            config.deepThinking = deepThinkingToggle.checked;
            saveConfig();
        });
    }
    // Agent 开关（关闭后不提供 tools，模型只能纯文本回复）
    if (agentEnabledToggle) {
        on(agentEnabledToggle, 'change', () => {
            config.agentEnabled = agentEnabledToggle.checked;
            saveConfig();
        });
    }
    // 备选模型：添加 / 删除 / 上移（列表按顺序即为尝试顺序）
    const addFallbackModel = () => {
        const v = (fallbackModelInput ? fallbackModelInput.value : '').trim();
        if (!v) return;
        const list = currentFallbackList();
        if (list.indexOf(v) === -1) list.push(v);
        if (fallbackModelInput) fallbackModelInput.value = '';
        saveConfig(); refreshFallbackUI();
    };
    if (fallbackAddBtn) on(fallbackAddBtn, 'click', addFallbackModel);
    if (fallbackModelInput) {
        on(fallbackModelInput, 'keydown', (e) => {
            if (e && e.key === 'Enter') { e.preventDefault(); addFallbackModel(); }
        });
    }
    if (fallbackModelList) {
        on(fallbackModelList, 'click', (e) => {
            const btn = e.target && e.target.closest ? e.target.closest('button[data-act]') : null;
            if (!btn) return;
            const i = Number(btn.getAttribute('data-i'));
            const list = currentFallbackList();
            if (!(i >= 0 && i < list.length)) return;
            const act = btn.getAttribute('data-act');
            if (act === 'del') list.splice(i, 1);
            else if (act === 'up' && i > 0) { const tmp = list[i - 1]; list[i - 1] = list[i]; list[i] = tmp; }
            saveConfig(); refreshFallbackUI();
        });
    }
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
        // 本地 LLM / 自定义（中转站）各自使用独立输入框（不与 DeepSeek/智谱共享 Key/地址）
        const url = provider === 'local'
            ? ((localApiUrlInput && localApiUrlInput.value.trim()) || '')
            : provider === 'custom'
                ? ((customApiUrlInput && customApiUrlInput.value.trim()) || '')
                : ((apiUrlInput && apiUrlInput.value.trim()) || '');
        const key = provider === 'local'
            ? ((localApiKeyInput && localApiKeyInput.value.trim()) || '')
            : provider === 'custom'
                ? ((customApiKeyInput && customApiKeyInput.value.trim()) || '')
                : ((apiKeyInput && apiKeyInput.value.trim()) || '');
        // 本地 LLM：Key 可选；模型名随测试请求传出（Ollama 必填）
        // 云端提供商：使用「模型选择」里填写的模型（留空则用提供商默认）
        const testModel = currentModelFromForm('chat', provider);
        apiTestResult.style.display = 'block';
        apiTestResult.style.color = '#888';
        apiTestResult.textContent = '测试中，请稍候...';
        testApiBtn.disabled = true;
        try {
            const res = await window.electronAPI.testApi({ provider: provider, apiKey: key, apiUrl: url, model: testModel });
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
            box.style.cssText = 'background:var(--surface);border-radius:10px;padding:16px;width:280px;box-shadow:0 6px 24px rgba(0,0,0,0.25);font-family:sans-serif;';
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
    // 陪伴窗口宽度：补上输入监听（此前只有回填无绑定，导致改了不保存）
    on(companionWidthSlider, 'input', () => {
        config.companionWidth = Number(companionWidthSlider.value);
        if (companionWidthValue) companionWidthValue.textContent = companionWidthSlider.value;
        saveConfig(); syncHomeSettings();
    });
    // 陪伴模式数值体系设置绑定
    console.log('[companion-debug][initSettingsPanel] reached companion bindings');
    // [companion-debug] 打印这些控件是否在 DOM 中找到（null 则 on() 静默跳过绑定）
    console.log('[companion-debug][bind companion controls]',
        'fontSize=', !!companionFontSizeSlider, 'petSize=', !!companionPetSizeSlider,
        'freqSel=', !!companionThoughtFreqSelect, 'visTgl=', !!companionThoughtVisibleToggle,
        'threshold=', !!companionTalkThresholdSlider, 'sensSel=', !!companionScreenSensitivitySelect);
    on(companionFontSizeSlider, 'input', () => {
        config.companionFontSize = Number(companionFontSizeSlider.value);
        if (companionFontSizeValue) companionFontSizeValue.textContent = companionFontSizeSlider.value;
        saveConfig();
    });
    on(companionPetSizeSlider, 'input', () => {
        config.companionPetSize = Number(companionPetSizeSlider.value);
        if (companionPetSizeValue) companionPetSizeValue.textContent = companionPetSizeSlider.value;
        saveConfig();
    });
    on(companionThoughtFreqSelect, 'change', () => {
        config.companionThoughtFreq = companionThoughtFreqSelect.value;
        saveConfig();
    });
    on(companionThoughtVisibleToggle, 'change', () => {
        config.companionThoughtVisible = companionThoughtVisibleToggle.checked;
        saveConfig();
    });
    on(companionTalkThresholdSlider, 'input', () => {
        config.companionTalkThreshold = Number(companionTalkThresholdSlider.value);
        if (companionTalkThresholdValue) companionTalkThresholdValue.textContent = companionTalkThresholdSlider.value;
        saveConfig();
    });
    on(companionScreenSensitivitySelect, 'change', () => {
        config.companionScreenSensitivity = companionScreenSensitivitySelect.value;
        saveConfig();
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
    // DSH 环节贴图下拉与【状态】设置同源同帧渲染，保证两者列表永远一致
    fillOverrideSelects();
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

// ===== 记忆总结遮罩（总结期间隐藏关闭按钮 + 友好的"整理中"提示）=====
function showMemorySummaryOverlay() {
    if (!isChatMode || !document.body) return;
    const btn = document.getElementById('chatCloseBtn');
    if (btn) { btn.dataset.hiddenBySummary = '1'; btn.style.display = 'none'; }
    if (document.getElementById('memorySummaryOverlay')) return;
    const style = document.createElement('style');
    style.id = 'memorySummaryStyle';
    style.textContent =
        '#memorySummaryOverlay{position:absolute;inset:0;z-index:60;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
        'gap:14px;background:linear-gradient(160deg,color-mix(in srgb,var(--surface) 96%,transparent),color-mix(in srgb,var(--brand-soft) 96%,transparent));backdrop-filter:blur(6px);' +
        'font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--brand-text);animation:msFadeIn .22s ease;}' +
        '@keyframes msFadeIn{from{opacity:0}to{opacity:1}}' +
        '#memorySummaryOverlay .ms-ring{width:54px;height:54px;border-radius:50%;' +
        'border:3px solid color-mix(in srgb, var(--brand) 18%, transparent);border-top-color:var(--brand);animation:msSpin .9s linear infinite;}' +
        '@keyframes msSpin{to{transform:rotate(360deg)}}' +
        '#memorySummaryOverlay .ms-title{font-size:15px;font-weight:600;letter-spacing:.5px;color:var(--brand-text);}' +
        '#memorySummaryOverlay .ms-sub{font-size:12px;color:var(--text-muted);}' +
        '#memorySummaryOverlay .ms-dots::after{content:"";animation:msDots 1.4s steps(4,end) infinite;}' +
        '@keyframes msDots{0%{content:""}25%{content:"."}50%{content:".."}75%{content:"..."}}';
    document.head.appendChild(style);
    const box = document.createElement('div');
    box.id = 'memorySummaryOverlay';
    box.innerHTML =
        '<div class="ms-ring"></div>' +
        '<div class="ms-title">正在整理这段对话的记忆<span class="ms-dots"></span></div>' +
        '<div class="ms-sub">把值得长期记住的内容收好，稍等一下就好</div>';
    const host = document.getElementById('chatContainer') || document.body;
    host.appendChild(box);
}

function hideMemorySummaryOverlay() {
    const box = document.getElementById('memorySummaryOverlay');
    if (box && box.parentNode) box.parentNode.removeChild(box);
    const btn = document.getElementById('chatCloseBtn');
    if (btn && btn.dataset.hiddenBySummary) { btn.style.display = ''; delete btn.dataset.hiddenBySummary; }
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
// 鼠标靠近（四按钮气泡显示）时，DSH 任务面板自动隐藏，避免遮挡四按钮
let taskPanelHovering = false;
// 由 initDshLink 注册：鼠标靠近/离开时切换任务面板显隐
let applyTaskPanelHover = null;
// 由 initDshLink 注册：任务面板配置变化时触发重渲染（设置窗口改动 → 浮窗实时生效）
let refreshDshPanel = null;
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
    // 聊天模式隐藏下方信息条（DSH 连接 / 硬件监控 / 峰谷时段）
    const chatPetStatBar = document.getElementById('petStatBar');
    if (chatPetStatBar) chatPetStatBar.style.display = 'none';
    // CSS 硬兜底：聊天模式下信息条永不显示（防止任何路径重新显示）
    document.body.classList.add('chat-mode');

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

        // 桌宠模式不再在鼠标靠近时弹出 2×2 按钮气泡：
        // 那四个动作（聊天 / 设置 / 回家 / 陪伴）现在是窗口底部的常驻动作条，
        // 弹出的气泡既重复又会被右侧的 DSH 任务面板压住。
        // 同时，DSH 任务面板也不再为「上方的按钮」让位（只保留 hoverGap 的常规位置）。
        if (floatBubble) floatBubble.classList.remove('show');
        taskPanelHovering = false;
        if (applyTaskPanelHover) applyTaskPanelHover(false);

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
            taskPanelHovering = false;
            if (applyTaskPanelHover) applyTaskPanelHover(false);
            if (!isParabolaRunning) {
                resumeWander();
            }
        }
    });

    // 获取容器尺寸
    // 桌宠脚部与窗口下边的间距（必须与 .float-pet 的 CSS calc 一致）
    // 竖向堆叠：状态条 → 间距 → 动作条 → 间距
    // 获取容器尺寸
    // 桌宠脚部与窗口下边的间距（必须与 .float-pet 的 CSS calc 一致）
    // 竖向堆叠：状态条 → 间距 → 动作条 → 间距（+ 用户设置的「贴图与按钮间距」）
    function getPetBottomGap() {
        return PET_STAT_H + PET_STAT_ACTION_GAP + petActionH() + PET_ACTION_PET_GAP
            + floatPetBottomOffset;
    }
    /// 底部动作条高度：由设置里的「按钮大小」派生（按钮边长 + 上下各一点留白）
    function petActionH() {
        const s = Number(config && config.buttonSize);
        const size = Number.isFinite(s) && s > 0 ? s : PET_BUTTON_SIZE_DEFAULT;
        return Math.round(size) + PET_ACTION_BUTTON_PAD;
    }
    /// 贴图上方给 DSH 任务面板的高度：面板隐藏时收起来，
    /// 这样窗口上边缘会自己下移（窗口贴底，顶边就是可见边界）。
    function dshPanelHeadroom() {
        const panel = document.getElementById('dshTaskPanel');
        return (panel && !panel.classList.contains('dsh-hide')) ? PET_HEADROOM : PET_HEADROOM_HIDDEN;
    }
    // —— 窗口尺寸唯一来源：updateWindowSize()/physics/碰撞都用这里，保证与实际窗口一致 —
    function getContainerWidth() {
        const bubbleWidth = 200; // 与 float.css 中 .float-bubble 的 width 保持一致
        const actionBarWidth = 172; // 四个按钮 + 间距 + 内边距，必须与 .pet-action-bar 一致
        const sidePad = Math.ceil(currentPetSize * 0.5);
        return Math.max(currentPetSize + sidePad * 2, bubbleWidth, actionBarWidth);
    }
    function getContainerHeight() {
        // 贴图上方额外留出 PET_HEADROOM：DSH 任务面板浮在贴图头部之上，
        // 窗口不留这条带的话面板可用高度会被算成 0（弹出来也看不见）。
        return getPetBottomGap() + currentPetSize + dshPanelHeadroom() + floatWindowHeightPad;
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
        // --float-bubble-offset 已废弃：鼠标靠近弹出的四按钮气泡已由底部常驻动作条取代
        // 常驻动作条高度（CSS 里以 --pet-action-h 抬升贴图与状态条）
        document.documentElement.style.setProperty('--pet-action-h', petActionH() + 'px');
        document.documentElement.style.setProperty('--pet-action-btn-size', (petActionH() - PET_ACTION_BUTTON_PAD) + 'px');
        // 贴图与按钮条的间距 = 默认值 + 用户设置的「贴图位置偏移」
        document.documentElement.style.setProperty('--pet-action-gap', Math.max(0, PET_ACTION_PET_GAP + floatPetBottomOffset) + 'px');
        // 窗口尺寸变了，DSH 任务面板的像素定位要跟着重算（依赖 --float-pet-bottom）
        if (document.getElementById('dshTaskPanel') && typeof applyDshPanelStyle === 'function') {
            try { applyDshPanelStyle(); } catch (e) { /* 面板尚未初始化 */ }
        }

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
        // DSH 任务运行覆盖期间暂停随机状态机（由 setDshOverrideActive 恢复）
        if (dshOverrideActive) return;
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
            taskPanelHovering = false;
            if (applyTaskPanelHover) applyTaskPanelHover(false);
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
            taskPanelHovering = false;
            if (applyTaskPanelHover) applyTaskPanelHover(false);
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
        // 转发给主窗口只做同步展示；失败不能影响记忆写入（真正的持久化由 memorySave 负责）
        try {
            if (window.electronAPI && window.electronAPI.saveMemoryItem) {
                await window.electronAPI.saveMemoryItem(text.trim());
            }
        } catch (e) {
            console.warn('[float] saveMemoryItem 转发失败（不影响本地记忆）:', e && e.message);
        }
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

// 将消息 content（可能是字符串 or 文本/图片块数组）展平为纯文本。
// 注意：**任何非文本块都只回占位符，绝不 JSON.stringify**——
// 图片块里是十几万字符的 data URL，一旦被序列化就会污染记忆、日志与保存的聊天记录
// （曾出现"我喜欢群青色 {"type":"image_url","image_url":{"url":"data:image/jp"这种记忆）。
function flattenMessageContent(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.map(b => {
            if (!b) return '';
            if (typeof b === 'string') return b;
            if (b.type === 'text') return b.text || '';
            if (b.type === 'file') return '[截图]';
            if (b.type === 'image_url' || b.image_url || (typeof b.type === 'string' && /image/i.test(b.type))) return '[截图]';
            // 其它未知块：只取它可能带的文本字段，取不到就给空，绝不序列化
            return typeof b.text === 'string' ? b.text : '';
        }).filter(Boolean).join('\n');
    }
    return String(content == null ? '' : content);
}

// 记忆文本清洗：去掉 data URL、图片块 JSON 残片、超长乱码尾巴。
// 用于修复历史遗留的脏记忆，也用于兜底提取时的最终把关。
function sanitizeMemoryText(raw) {
    let s = String(raw == null ? '' : raw);
    // 截图占位符与内部标记不属于记忆内容
    s = s.replace(/\[\s*截图[^\]]*\]/g, ' ');
    s = s.replace(/\[(?:MEMORY|SHORT_MEMORY|AGENT_MODE)[^\]]*\]/gi, ' ');
    // 去掉 data URL（可能很长）
    s = s.replace(/data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=\s]+/g, '');
    // 去掉图片块 / 任意 JSON 片段（含未闭合的尾巴）
    s = s.replace(/\{\s*"type"\s*:\s*"[^"]*"[\s\S]*$/, '');
    s = s.replace(/\{\s*"[\s\S]{0,400}$/, '');
    // 去掉残留的键值碎片
    s = s.replace(/"?image_url"?\s*:\s*\{?/gi, '').replace(/"url"\s*:\s*/gi, '');
    s = s.replace(/[{}\[\]"]+/g, '');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
}

// 从用户原话里确定性提取"显式记忆请求"，作为模型判"无"时的兜底。
// 覆盖：记住/记一下/记下/帮我记/别忘了/不要忘记/保存下来 + 我叫/我是/我喜欢/我住在 等自述。
const EXPLICIT_MEMORY_RE = /(记住|记一下|记下来|记下|帮我记|帮我存|别忘了|别忘记|不要忘|保存下来|remember|note\s+that)/i;
const SELF_FACT_RE = /(我叫|我的名字是|我是|我住在|我来自|我的生日|我养了|我喜欢|我讨厌|我的工作是|我用的是)/;
function extractExplicitMemoryRequests() {
    const out = [];
    const push = (s) => {
        // 只做脏数据清洗（去 data URL / JSON 残片 / [截图] 占位符），人称交给模型在提示词约束下自己分清楚
        let t = sanitizeMemoryText(s);
        t = t.replace(/^[，。！？、：:;,.\-—\s]+/, '').replace(/[。！？\s]+$/, '');
        if (t.length < 2) return;
        if (t.length > 40) t = t.slice(0, 40);   // 记忆条目本就要求"不超过20~40字"
        if (!out.some(x => x === t)) out.push(t);
    };
    chatHistory.forEach(msg => {
        if (!msg || msg.role !== 'user') return;
        const text = flattenMessageContent(msg.content);
        if (!text) return;
        if (!EXPLICIT_MEMORY_RE.test(text)) return;
        // 去掉指令词本身，留下"要记的内容"
        let rest = text.replace(new RegExp(EXPLICIT_MEMORY_RE.source, 'gi'), '')
            .replace(/^(一下|这个|这件事|这条|：|:|，|,|\s)+/, '')
            .replace(/^(数字|号码|内容|信息)\s*[:：]?\s*/i, '')
            .trim();
        if (rest.length >= 2) push(rest);
        else push(text); // 指令词去掉后没剩东西（如"记住！（甩尾巴）"）则整句兜底
    });
    // 自述类事实（没写"记住"也算长期信息）
    chatHistory.forEach(msg => {
        if (!msg || msg.role !== 'user') return;
        const text = flattenMessageContent(msg.content);
        const clean = sanitizeMemoryText(text);
        if (!clean || !SELF_FACT_RE.test(clean)) return;
        if (clean.length <= 40) push(clean);
    });
    return out;
}

// 应用兜底（由模型改写，代码不做人称转换）：
// 检测到"用户明确要求记住"的内容而总结又判了"无"时，**再让模型写一遍**——
// 把用户的原始话术改写成第三人称记忆条目。人称转换始终由模型完成，代码只负责搬运。
// 注意：绝不把用户原话直接写进记忆（那样会存成"我喜欢群青色"这种第一人称）。
async function rewriteExplicitMemoriesViaModel(rawItems, requestOnce) {
    const items = (rawItems || []).filter(Boolean);
    if (!items.length) return 0;
    const prompt =
        '用户在这段对话里明确要求记住以下内容。请把它们改写成长期记忆条目：\n' +
        items.map(t => '- ' + t).join('\n') +
        '\n\n要求：每条不超过20字，每行一条；**主语一律用「用户」（第三人称）**，不要出现「我」「我的」「你」「我们」；' +
        '只输出条目本身，不要任何标题、编号或标签。';
    let text = '';
    try {
        text = await requestOnce(prompt);
    } catch (e) {
        console.warn('[float] 显式记忆改写请求失败，本次不写入（避免存入第一人称原话）:', e && e.message);
        return 0;
    }
    if (!text) return 0;
    let added = 0;
    for (const rawLine of String(text).split('\n')) {
        const line = String(rawLine || '').replace(/^\s*\d+[.、)]\s*/, '').trim();
        if (!line || line === '无' || /^(none|无内容)$/i.test(line)) continue;
        const clean = sanitizeMemoryText(line);
        if (clean.length < 2) continue;
        if (memoryItems.some(m => {
            const t = String((m && (m.text || m.description)) || '').trim();
            return t && (t === clean || t.includes(clean) || clean.includes(t));
        })) continue;
        await addMemoryItem(clean);
        added++;
    }
    if (added > 0) console.warn('[float] 显式记忆已由模型改写并写入 ' + added + ' 条');
    return added;
}

// 释放本次对话中未被保留（keepSet 之外）的截图：
// 远程删除（DeepSeek 才有）+ 丢弃内存副本；瞬态截图从不落盘，所以无需清理磁盘
async function cleanupNonMemoryImages(keepSet) {
    const dropIds = [];
    for (const img of pendingConversationImages) {
        if (keepSet && keepSet.has(img.fileId)) continue;
        dropIds.push(img.fileId);
    }
    if (!dropIds.length) return;
    try {
        if (window.electronAPI && window.electronAPI.releaseImages) {
            await window.electronAPI.releaseImages(dropIds);
        } else if (window.electronAPI && window.electronAPI.deleteDeepSeekFile) {
            // 兼容旧主进程：至少删掉远程文件
            for (const id of dropIds) { try { await window.electronAPI.deleteDeepSeekFile(id); } catch (e) {} }
        }
    } catch (e) {
        console.warn('[float] 释放未入记忆的截图失败:', e && e.message);
    }
    // 旧版本可能给这些截图留过本地缓存文件，顺手清理（新版本不再产生）
    for (const img of pendingConversationImages) {
        if (keepSet && keepSet.has(img.fileId)) continue;
        if (img.imagePath && window.electronAPI && window.electronAPI.deleteScreenshotCache) {
            try { await window.electronAPI.deleteScreenshotCache(img.imagePath); } catch (e) {}
        }
    }
}

async function summarizeMemoryOnChatClose() {
    // 防止被 close 拦截路径与 beforeunload 后备路径同时触发而重复生成记忆
    if (memorySummarizeInFlight) return;

    // 总结期间：隐藏关闭按钮 + 显示"记忆整理中"提示，避免用户在总结中途关窗丢记忆
    showMemorySummaryOverlay();

    const prov = config.multimodalProvider || 'deepseek';
    // 凭据判定按"当前提供商"（此前写死 config.apiKey，导致 GLM/中转站/本地一律跳过总结 → 无法生成记忆）
    const provCred = chatCredentials();
    const memoryProviderOk = !!provCred.base && (prov === 'local' || !!provCred.key);
    if (!config.enableMemory || chatHistory.length === 0 || !memoryProviderOk) {
        const skip = 'memory summary skipped enableMemory=' + config.enableMemory + ' history=' + chatHistory.length + ' provider=' + prov + ' hasUrl=' + !!provCred.base + ' hasKey=' + !!provCred.key;
        console.warn('[float]', skip);
        if (window.electronAPI && window.electronAPI.logToMain) window.electronAPI.logToMain('warn', '[float:summary] ' + skip);
        if (pendingConversationImages.length > 0) {
            await cleanupNonMemoryImages(new Set());
            pendingConversationImages = [];
        }
        hideMemorySummaryOverlay();
        return;
    }

    memorySummarizeInFlight = true;
    // 统一请求变量放在 try 之外：catch 里也要能安全引用（此前 const 在 try 内，
    // catch 引用 gUrl 会再抛 ReferenceError，导致错误处理本身崩掉）
    const cred = chatCredentials();
    const gUrl = cred.base;
    const gKey = cred.key;
    // 渲染进程 console 默认不可见，总结日志统一走主进程打印（renderer-log -> 主进程终端）
    const logMain = (level, msg) => {
        try { if (window.electronAPI && window.electronAPI.logToMain) window.electronAPI.logToMain(level, msg); } catch (e) {}
    };
    // 显式记忆是否已由模型改写处理过（避免 try / finally 重复请求）
    let explicitMemoriesHandled = false;
    try {

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
        // ===== 改用「真实角色消息」重建对话 =====
        // 以前把所有轮次压成一条 user 消息、只用"用户：/桌宠："文本前缀区分——
        // 模型很容易忽略前缀、把用户第一人称原话当自己的话（"我喜欢群青色"就是这么来的）。
        // 现在按 OpenAI 规范拆成 role: 'user' / 'assistant' 逐条发送，人称由协议本身区分。
        const memMessages = [];
        const imageSequence = []; // 顺序与【第N张截图】编号一一对应（DeepSeek=file_id，其它=内部 id）
        const isLocalProv = prov === 'local';
        let imgIdx = 0;

        // 角色消息：system 规则（含人称约束）随后单独放
        const redactText = (t) => hasForceMemory ? String(t || '').replace(FORCE_MEMORY_RE_G, '') : String(t || '');
        const matchPendingByUrl = (url) => pendingConversationImages.find(im => im && im.dataUrl && im.dataUrl === url);

        for (const msg of chatHistory) {
            const isUser = msg.role === 'user';
            const turnRole = isUser ? 'user' : 'assistant';
            const c = msg.content;
            if (typeof c === 'string') {
                memMessages.push({ role: turnRole, content: redactText(c) });
                continue;
            }
            if (!Array.isArray(c)) continue;

            const content = [];
            const turnText = c.filter(b => b && b.type === 'text' && b.text).map(b => b.text).join('\n');
            if (turnText.trim()) content.push({ type: 'text', text: redactText(turnText) });

            if (!isLocalProv) {
                // ① DeepSeek Files API 的 file 块
                for (const fb of c.filter(b => b && b.type === 'file' && b.file_id)) {
                    imgIdx++;
                    content.push({ type: 'text', text: `【第${imgIdx}张截图】` });
                    content.push({ type: 'file', file_id: fb.file_id });
                    imageSequence.push(fb.file_id);
                }
                // ② GLM / 中转站的 image_url 块（data URL）：原样带上，并回填其内部 id 供 KEEP 引用
                for (const ib of c.filter(b => b && b.type === 'image_url' && b.image_url && b.image_url.url)) {
                    imgIdx++;
                    content.push({ type: 'text', text: `【第${imgIdx}张截图】` });
                    content.push({ type: 'image_url', image_url: ib.image_url });
                    const pend = matchPendingByUrl(ib.image_url.url);
                    imageSequence.push(pend ? pend.fileId : ('inline-' + imgIdx));
                }
            }
            memMessages.push({ role: turnRole, content: content.length ? content : (turnText || '[截图]') });
        }

        // ③ 未被任何消息引用的截图（异常/边缘情况）单独补一条 user 消息，避免"拍了却看不到"
        if (!isLocalProv) {
            const attached = new Set(imageSequence);
            const orphans = pendingConversationImages.filter(im => im && !attached.has(im.fileId));
            if (orphans.length) {
                const content = [{ type: 'text', text: '以下是本次对话中出现过的屏幕截图（按时间先后编号）：' }];
                for (const im of orphans) {
                    const useFile = im.remote !== false && im.fileId;
                    const useUrl = !useFile && im.dataUrl;
                    if (!useFile && !useUrl) continue;
                    imgIdx++;
                    content.push({ type: 'text', text: `【第${imgIdx}张截图】` });
                    if (useFile) content.push({ type: 'file', file_id: im.fileId });
                    else content.push({ type: 'image_url', image_url: { url: im.dataUrl } });
                    imageSequence.push(im.fileId);
                }
                if (content.length > 1) memMessages.push({ role: 'user', content });
            }
        }

        // ④ 末尾追加"任务指令"（单独一条 user 消息，不混进对话内容）
        const forceText = hasForceMemory && imageSequence.length > 0 && !isLocalProv
            ? '【强制指令】用户要求强制执行图像记忆：必须将最后一张截图【第' + imageSequence.length + '张截图】输出为 KEEP:' + imageSequence.length + '|test（描述固定为 test），不得遗漏、不得更改编号与描述。\n'
            : '';
        const taskText = (isLocalProv
            ? '请从上面的对话中提取值得长期记忆的信息。每行一条，不超过20字；没有可记忆内容时只输出"无"。'
            : '请从上面的对话与截图中提取值得长期记忆的信息（文本条目 + KEEP 截图条目）。\n' +
              '- 文本条目：每行一条，不超过20字，没有则输出"无"。\n' +
              '- KEEP 截图条目：值得长期保留的截图输出 KEEP:<编号>|<简短描述>，编号用"【第N张截图】"里的数字（如 KEEP:1|用户的项目预算图），描述体现该图在对话中的角色，限20字内；无需保留则输出"无"。\n' +
              (forceText ? forceText : '')) +
            '直接输出条目本身，不要输出任何标题或标签（例如不要写"文本记忆："）。';
        memMessages.push({ role: 'user', content: taskText });

        logMain('info', '[float:summary] start model=' + providerModelName('memory') + ' images=' + pendingConversationImages.length + ' msgs=' + memMessages.length + ' forceMemory=' + hasForceMemory + ' lastIdx=' + imageSequence.length + ' provider=' + prov + ' url=' + gUrl);

        // 记忆总结同样走候选链：繁忙重试，仍失败则换备选模型。
        // 关键：思考型模型（glm-4.6v-flash / glm-5.x）不关思考会把正文挤空 → summary 变成"无"，
        // 所以这里按模型能力显式关掉思考，保证拿到正文。
        const memModel = providerModelName('memory');
        const memThinking = thinkingParamsFor(prov, memModel, false);
        logMain('info', '[float:summary] thinking params=' + JSON.stringify(memThinking) + ' model=' + memModel);
        const sumRes = await requireAIF().runChain({
            chain: requireAIF().buildChain(config, 'memory'),
            policy: requireAIF().retryPolicy(config),
            attempt: (candidate) => attemptChatCompletion(candidate, Object.assign({
                model: providerModelName('memory'),
                messages: [
                    {
                        role: 'system',
                        content: isLocalProv
                            ? `你是记忆助手。你会收到一段真实的对话记录（user = 用户说的话，assistant = 桌宠说的话），请从中提取值得长期记忆的信息。\n\n重要规则：\n0. **用户明确要求记住的内容必须记录**（"记住这个数字""帮我记一下""别忘了""我叫…"），一律不得判为"无"。\n1. 只记录用户的偏好、重要事实、约定、重大事件等真正有长期价值的信息。\n2. 不要总结"桌宠做了什么"、"今天聊了什么"等日常琐事，除非涉及非常重大的事件。\n3. 没有值得长期记忆的内容就输出"无"。\n4. 每条不超过20字，每行一条。\n5. **分清楚人称**：user 说的话才是"用户"的事实，assistant 说的话是桌宠自己的话，不要把桌宠说的话记成用户的事。记忆主语一律写「用户」（第三人称），涉及桌宠自身写「桌宠」，不要用「我」「我的」「你」「我们」。例如 user 说"我喜欢群青色"，要记成"用户喜欢群青色"。\n6. 严格检查已保存的记忆，不要重复保存相同或高度相似的内容。\n7. 直接输出条目本身，每行一条，不要输出任何标题或标签（例如不要写"文本记忆："）。${existingMemoriesText}`
                            : `你是记忆助手。你会收到一段真实的对话记录：role=user 是用户说的话，role=assistant 是桌宠说的话；部分消息里还带有屏幕截图（标有【第N张截图】）。请把文字与截图当作同一段对话来理解。\n\n重要规则：\n0. **用户明确要求记住的内容必须记录**（例如"记住这个数字""帮我记一下""别忘了""我叫…""我喜欢…"），一律不得判为"无"。\n1. 只记录用户的偏好、重要事实、约定、重大事件等真正有长期价值的信息。\n2. 不要总结"桌宠做了什么"、"今天聊了什么"等日常琐事，除非涉及非常重大的事件。\n3. 没有值得长期记忆的内容就输出"无"。\n4. 文本记忆每行一条，每条不超过20字。\n5. **分清楚人称**：user 说的话才是"用户"的事实，assistant 说的话是桌宠自己的话，不要把桌宠说的话记成用户的事。记忆主语一律写「用户」（第三人称），涉及桌宠自身写「桌宠」，不要用「我」「我的」「你」「我们」。例如 user 说"我喜欢群青色"，要记成"用户喜欢群青色"；user 说"你叫什么"，要记成"用户问过桌宠的名字"。\n6. 截图值得保留时输出 KEEP:<截图编号>|<简短描述>，编号是"【第N张截图】"里的阿拉伯数字（N从1开始），描述需体现该图在对话中的角色，限20字内。\n7. 严格检查已保存的记忆，不要重复保存相同或高度相似的内容。\n8. 直接输出条目本身，每行一条，不要输出任何标题或标签（例如不要写"文本记忆："）。${existingMemoriesText}`
                    },
                    ...memMessages
                ],
                max_tokens: 1024,
                temperature: 0.3
            }, memThinking))
        });
        if (!sumRes.ok) {
            const errDetail = 'summary request failed: ' + sumRes.error + ' url=' + gUrl;
            console.warn('[float]', errDetail);
            logMain('warn', '[float:summary] ' + errDetail);
            throw new Error('summary request failed: ' + sumRes.error);
        }
        const data = sumRes.data || { choices: [{ message: { content: sumRes.content } }] };
        const sumMsg = (data.choices && data.choices[0] && data.choices[0].message) || {};
        // 正文为空但模型把内容写进了 reasoning_content（思考型模型）时，退而用推理文本解析，
        // 避免"明明有内容却记成无"。
        let summary = '';
        if (sumMsg.content && String(sumMsg.content).trim()) summary = String(sumMsg.content).trim();
        else if (sumMsg.reasoning_content && String(sumMsg.reasoning_content).trim()) {
            summary = String(sumMsg.reasoning_content).trim();
            logMain('warn', '[float:summary] 正文为空，改用 reasoning_content 解析（建议改用非思考模型做记忆总结）');
        } else {
            summary = '无';
        }
        if (sumRes.usedFallback) logMain('warn', '[float:summary] 使用备选模型完成：' + (sumRes.candidate ? sumRes.candidate.provider + '/' + sumRes.candidate.model : ''));
        console.warn('[float] summary vision response:', JSON.stringify(summary).substring(0, 500));
        logMain('info', '[float:summary] vision response textLen=' + summary.length + ' preview=' + JSON.stringify(summary).substring(0, 300));

        // ===== 解析：文本记忆（非 KEEP 行）+ 图像记忆（KEEP 行）=====
        // 模型常自作主张输出「文本记忆：无」「文本记忆：」这类标题行，必须过滤掉，
        // 否则会写入一条毫无意义的记忆。
        const MEMORY_LABEL_RE = /^(文本记忆|记忆|文本条目|条目|摘要|总结)\s*[:：]?\s*(无|none|无内容)?\s*$/i;
        let textMemories = 0;
        for (const rawLine of summary.split('\n')) {
            const line = rawLine.trim();
            if (!line || /^KEEP:/i.test(line)) continue;
            const clean = line
                .replace(/^\d+[.、)]\s*/, '')
                .replace(/^(文本记忆|记忆|文本条目|条目)\s*[:：]\s*/, '')
                .trim();
            // 过滤空行、纯"无"、以及只剩标签的无效行
            if (!clean || clean === '无' || /^(none|无内容|没有)$/i.test(clean)) continue;
            if (MEMORY_LABEL_RE.test(line)) continue;
            if (clean.length > 1) {
                await addMemoryItem(clean);
                textMemories++;
            }
        }
        const keepSet = new Set();
        const addedImageMemories = [];
        // 按引用解析图片：优先支持数字编号（KEEP:1|…，对应【第N张截图】），
        // 也兼容直接填 file_id 的旧格式；顺带清理模型可能误输出的完整 URL/多余空白。
        const resolveImageRef = (ref) => {
            const raw = String(ref == null ? '' : ref).trim();
            // KEEP:无 / KEEP:none 这类"没有要保留的截图"是正常输出，直接忽略，不打警告
            if (!raw || /^(无|none|null|-|没有|无截图)$/i.test(raw)) return null;
            let r = raw.replace(/^.*\/files\//, '');
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
                // 判定为"进入记忆"：此时才把截图从内存落盘（瞬态截图此前不落盘）
                let persisted = { imagePath: info.imagePath || '', imageUrl: info.imageUrl || '' };
                try {
                    if (window.electronAPI && window.electronAPI.keepMemoryImage) {
                        const kept = await window.electronAPI.keepMemoryImage(info.fileId);
                        if (kept && kept.success) persisted = { imagePath: kept.imagePath, imageUrl: kept.imageUrl };
                        else logMain('warn', '[float:summary] 图像记忆落盘失败 ref=' + m[1] + ' msg=' + (kept && kept.message));
                    }
                } catch (e) {
                    logMain('warn', '[float:summary] 图像记忆落盘异常 ref=' + m[1] + ' err=' + (e && e.message));
                }
                addedImageMemories.push({
                    type: 'image',
                    fileId: info.fileId,
                    imagePath: persisted.imagePath,
                    imageUrl: persisted.imageUrl,
                    description: desc || '（截图记忆）',
                    time: info.time || Date.now()
                });
            } else if (!/^(无|none|null|-|没有|无截图)$/i.test(String(m[1] || '').trim())) {
                logMain('warn', '[float:summary] KEEP references unknown ref=' + m[1]);
            }
        }
        if (addedImageMemories.length > 0) {
            memoryItems.push(...addedImageMemories);
        }
        // ===== 兜底：模型判"无"但用户明确要求记住 → 让模型再写一遍（不做代码人称转换）=====
        if (textMemories === 0) {
            const rawItems = extractExplicitMemoryRequests();
            if (rawItems.length) {
                const added = await rewriteExplicitMemoriesViaModel(rawItems, (prompt) => requestChatCompletion({
                    mode: 'memory',
                    body: Object.assign({
                        model: providerModelName('memory'),
                        messages: [
                            { role: 'system', content: '你是记忆助手。把用户明确要求记住的内容改写成长期记忆条目，主语一律用「用户」（第三人称），不要出现「我」「我的」「你」「我们」，每条不超过20字，每行一条，不要任何标题或标签。' },
                            { role: 'user', content: prompt }
                        ],
                        max_tokens: 200,
                        temperature: 0.3
                    }, memThinking)
                }).then(d => (d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || ''));
                textMemories += added;
                explicitMemoriesHandled = true;
            }
        }

        // 新增的图像记忆用 append-only 写入（多窗口共用一份文件，整份覆盖会互相冲掉）
        if (addedImageMemories.length > 0) {
            if (window.electronAPI && window.electronAPI.memoryAppend) {
                await window.electronAPI.memoryAppend(addedImageMemories);
            } else if (window.electronAPI && window.electronAPI.memorySave) {
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
        // 总结整段失败时再兜一次：同样让模型改写，绝不把用户第一人称原话直接写进记忆
        if (!explicitMemoriesHandled) {
            try {
                const rawItems = extractExplicitMemoryRequests();
                if (rawItems.length) {
                    await rewriteExplicitMemoriesViaModel(rawItems, (prompt) => requestChatCompletion({
                        mode: 'memory',
                        body: Object.assign({
                            model: providerModelName('memory'),
                            messages: [
                                { role: 'system', content: '你是记忆助手。把用户明确要求记住的内容改写成长期记忆条目，主语一律用「用户」（第三人称），不要出现「我」「我的」「你」「我们」，每条不超过20字，每行一条，不要任何标题或标签。' },
                                { role: 'user', content: prompt }
                            ],
                            max_tokens: 200,
                            temperature: 0.3
                        }, memThinking)
                    }).then(d => (d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || ''));
                }
            } catch (e) {
                console.warn('[float] 显式记忆改写兜底失败:', e && e.message);
            }
        }
        // 总结失败时 pendingConversationImages 不会被清空，这里确保
        // "未进入记忆的截图"一律被释放（远程删除 + 丢弃内存副本），不留残留
        if (pendingConversationImages.length > 0) {
            try { await cleanupNonMemoryImages(new Set()); } catch (e) {}
            pendingConversationImages = [];
        }
        hideMemorySummaryOverlay();
        memorySummarizeInFlight = false;
    }
}

// 记忆总结进行中标记（桌面/聊天模式共用，防止重复生成记忆）
let memorySummarizeInFlight = false;
// 本次聊天会话是否已通过 IPC 关闭路径完成过记忆总结（beforeunload 后备据此去重）
let chatMemorySummarizedOnClose = false;

// 对话开始时，AI根据自身状态决定心情（用于立绘）
async function decideMoodByState() {
    const prov = config.multimodalProvider || 'deepseek';
    const cred = chatCredentials();
    // 本地 LLM 只需地址；云端需要 Key
    if (!cred.base || (prov !== 'local' && !cred.key)) {
        switchIllust(null);
        return;
    }
    const model = providerModelName();
    try {
        const statsStr = Object.entries(stats)
            .map(([k, v]) => `${statNames[k]}: ${Math.round(v)}%`)
            .join(', ');

        const response = await fetch(cred.base, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(cred.key ? { 'Authorization': `Bearer ${cred.key}` } : {})
            },
            body: JSON.stringify({
                ...(model ? { model: model } : {}),
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
    btn.style.cssText = 'margin-top:8px;padding:4px 14px;border:1px solid var(--brand);border-radius:999px;background:var(--brand-soft-strong);color:var(--brand);cursor:pointer;font-size:12px;';
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

// 去除内部标记（与 addChatMessage 的显示清理一致，但保留换行，供流式/富文本渲染）
function stripChatMarkers(text) {
    let s = String(text == null ? '' : text);
    s = s.replace(/\[MEMORY:\s*[^\]]+\]/g, '');
    s = s.replace(/\[SHORT_MEMORY:\s*[^\]]+\]/g, '');
    s = s.replace(/<MOOD:[^>]+>/g, '');
    s = s.replace(/<CMD:[^>]+>/g, '');
    s = s.replace(/<EFFECT:[^>]+>/g, '');
    s = s.replace(/<STATE:[^>]+>/g, '');
    s = s.replace(/<TOOL:[^>]*>/g, '');        // 旧文本工具协议（已废弃，仅清理历史遗留）
    s = s.replace(/\[AGENT_MODE\]/g, '');       // 旧 agent 标记（已废弃）
    s = s.replace(/<\/?think(?:ing)?>/gi, '');  // 思考标签（内容由 extractThink 负责分离）
    s = s.replace(/[\u200B-\u200F\uFEFF\u00AD\u2060\u180E\uFE00-\uFE0F\u2000-\u200A\u202F\u205F\u3000]+/g, ' ');
    s = s.replace(/[\uFE0E\uFE0F]/g, '');
    return s.trim();
}

// ===== 单次调用（对某个候选模型发一次请求）=====
// 传 onDelta 时走 SSE 流式（实时回调完整累积文本），否则一次性 JSON。
// 返回值带 retryable / fatal / partial，供 ai-fallback.js 决定「重试还是换备选」。
async function attemptChatCompletion(candidate, body, onDelta) {
    const apiUrl = candidate.apiUrl;
    const apiKey = candidate.apiKey;
    const headers = {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
    };
    const isStream = typeof onDelta === 'function';
    // 候选模型覆盖请求体里的 model（本地/中转站未选模型时保持原样）
    const payload = Object.assign({}, body);
    if (candidate.model) payload.model = candidate.model;
    // 发送前规范化：补齐 role、按 provider 规则决定是否回传 reasoning_content
    const hasTools = Array.isArray(body && body.tools) && body.tools.length > 0;
    payload.messages = sanitizeChatMessages(body && body.messages, requireAIF().shouldEchoReasoning(candidate.provider, hasTools));
    let emitted = false; // 是否已经向界面吐出过内容（决定还能不能重试）
    const r = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(isStream ? Object.assign({}, payload, { stream: true }) : payload)
    });
    if (!r.ok) {
        const text = await r.text();
        const detail = 'chat API error status=' + r.status + ' body=' + text.substring(0, 500) + ' model=' + (payload.model || '?') + ' stream=' + isStream;
        console.error('[float]', detail);
        if (window.electronAPI && window.electronAPI.logToMain) window.electronAPI.logToMain('error', '[float:chat] ' + detail);
        let message = text.substring(0, 300);
        try { const j = JSON.parse(text); message = (j && j.error && (j.error.message || j.error.code)) || j.message || message; } catch (e) {}
        return { ok: false, status: r.status, message: 'API ' + r.status + ': ' + message, partial: false };
    }
    if (!isStream) {
        const text = await r.text();
        let parsed;
        try { parsed = JSON.parse(text); }
        catch (e) { console.error('[float] chat API non-JSON body:', text.substring(0, 300)); return { ok: false, status: r.status, message: 'non-JSON response: ' + text.substring(0, 200) }; }
        return { ok: true, data: parsed, content: '', status: r.status, message: '' };
    }
    // ----- SSE 流式解析 -----
    if (!r.body) return { ok: false, status: r.status, message: 'stream body not supported' };
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
            emitted = true;
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
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
            feedBuffer();
        }
        buffer += decoder.decode();
        feedBuffer();
        if (buffer.trim()) handleChunk(buffer.trim());
    } catch (e) {
        // 流中途断开：已吐出内容则不允许换模型重来（partial），否则按可重试错误处理
        console.warn('[float] SSE 流中断:', e && e.message);
        return { ok: false, status: 0, message: '流式响应中断：' + ((e && e.message) || e), partial: emitted, content: result.content };
    }
    if (!result.content && !result.tool_calls) {
        return { ok: false, status: r.status, message: '流式响应为空', partial: false };
    }
    return {
        ok: true,
        content: result.content,
        status: r.status,
        message: '',
        data: {
            choices: [{
                message: {
                    content: result.content,
                    reasoning_content: result.reasoning_content || null,
                    tool_calls: result.tool_calls
                },
                finish_reason: result.finish_reason
            }]
        }
    };
}

// ===== 思考能力判定 =====
//  · GLM-5.3 / 5.3-Flash 强制思考，官方明确不支持关闭（thinking.type 仅支持 enabled）
//  · GLM-5.2 及以下、GLM-4.x 以及 DeepSeek 都支持 {"thinking":{"type":"disabled"}}
// 返回 { paramSupported, canDisable }：决定"关闭深度思考时是否下发 disabled 参数"
function thinkingCapability(provider, model) {
    const name = String(model || '').toLowerCase();
    const p = provider || 'deepseek';
    if (p === 'zhipu' || /^glm/.test(name)) {
        const m = name.match(/glm-(\d+)(?:\.(\d+))?/);
        if (!m) return { paramSupported: true, canDisable: true };
        const v = parseInt(m[1], 10) * 100 + (m[2] === undefined ? 0 : parseInt(m[2], 10));
        return { paramSupported: true, canDisable: v < 503 };  // 5.3 及以上强制思考
    }
    if (p === 'deepseek' || /deepseek/.test(name)) return { paramSupported: true, canDisable: true };
    // 本地 / 中转站：不确定是否接受该参数，不下发
    return { paramSupported: false, canDisable: false };
}

// 依据开关与模型能力生成要并入请求体的思考参数（无则空对象）
function thinkingParamsFor(provider, model, wantThinking) {
    const cap = thinkingCapability(provider, model);
    if (!cap.paramSupported) return {};
    if (!wantThinking) {
        // 关闭深度思考：能关就明确关掉（否则思考模型会把 reasoning 占满、正文为空）
        return cap.canDisable ? { thinking: { type: 'disabled' } } : {};
    }
    return { thinking: { type: 'enabled' } };
}

// ===== 深度思考（<think>…</think>）解析 =====
// 返回 { thinking, answer }：thinking 是推理过程（折叠展示、不朗读、不进历史），answer 是最终答复。
function extractThink(text) {
    const raw = String(text == null ? '' : text);
    if (!raw) return { thinking: '', answer: '' };
    const blocks = [];
    let answer = raw.replace(/<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi, (m, inner) => {
        const t = String(inner || '').trim();
        if (t) blocks.push(t);
        return '';
    });
    // 模型漏写结束标签时：把最后一个未闭合的 <think> 之后的内容整体当作思考
    const openIdx = answer.search(/<think(?:ing)?>/i);
    if (openIdx !== -1) {
        const tail = answer.slice(openIdx).replace(/<\/?think(?:ing)?>/gi, '').trim();
        if (tail) blocks.push(tail);
        answer = answer.slice(0, openIdx);
    }
    answer = answer.replace(/<\/?think(?:ing)?>/gi, '').replace(/\n{3,}/g, '\n\n').trim();
    return { thinking: blocks.join('\n\n').trim(), answer };
}

// 把推理过程渲染成一个可折叠块（样式复用 .agent-thinking）
function addReasoningBlock(text, beforeEl) {
    const details = document.createElement('details');
    details.className = 'agent-thinking reasoning-block';
    const summary = document.createElement('summary');
    summary.textContent = '🧠 深度思考';
    const body = document.createElement('div');
    body.className = 'chat-message from-pet agent-mode';
    body.textContent = String(text);
    details.appendChild(summary);
    details.appendChild(body);
    if (beforeEl && beforeEl.parentNode) beforeEl.parentNode.insertBefore(details, beforeEl);
    else if (floatChatLog) floatChatLog.appendChild(details);
    if (floatChatLog) floatChatLog.scrollTop = floatChatLog.scrollHeight;
    return details;
}

// 流式渲染用：只保留答复部分（正在思考中的内容不实时显示）
function stripThinkForDisplay(text) {
    return extractThink(text).answer;
}

// ===== 发送前规范化消息数组 =====// 智谱 GLM 对 role / tool_call_id 校验严格：任一消息缺 role 就整轮 400
// 「1214 角色信息不能为空」。这里兜底补齐（并按内容猜角色），同时告警便于定位来源。
const VALID_CHAT_ROLES = new Set(['system', 'user', 'assistant', 'tool']);
// keepReasoning：请求带 tools 且该提供商要求回传 reasoning_content 时为 true
// （DeepSeek / 智谱官方规定：带 tools 的多轮必须完整回传 reasoning_content，否则 400）
function sanitizeChatMessages(list, keepReasoning) {
    if (!Array.isArray(list)) return [];
    const out = [];
    list.forEach((m, i) => {
        if (!m || typeof m !== 'object') {
            console.warn('[float] 丢弃非法消息 #' + i + ':', JSON.stringify(m));
            return;
        }
        let role = String(m.role == null ? '' : m.role).trim();
        if (!VALID_CHAT_ROLES.has(role)) {
            const hasToolCalls = Array.isArray(m.tool_calls) && m.tool_calls.length > 0;
            const guess = hasToolCalls ? 'assistant' : (m.tool_call_id ? 'tool' : 'user');
            console.warn('[float] 消息 #' + i + ' 缺少合法 role（原值 ' + JSON.stringify(m.role) + '），已按 "' + guess + '" 兜底');
            role = guess;
        }
        const msg = { role };
        msg.content = (m.content === undefined || m.content === null) ? '' : m.content;
        if (role === 'assistant') {
            if (Array.isArray(m.tool_calls) && m.tool_calls.length) msg.tool_calls = m.tool_calls;
            if (keepReasoning && m.reasoning_content) msg.reasoning_content = m.reasoning_content;
        }
        if (role === 'tool') {
            if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
            if (typeof msg.content !== 'string') msg.content = JSON.stringify(msg.content);
        }
        out.push(msg);
    });
    return out;
}

// ===== 统一 AI 请求（带重试与备选回退）=====
// mode: 'chat' | 'companion' | 'memory' | 'vision'，决定主模型与备选顺序
// 候选链 = 当前提供商主模型 → 当前提供商备选模型 → 其它已配置提供商（可在设置里关掉）
async function requestChatCompletion({ mode = 'chat', body, onDelta, onStatus }) {
    const AI = requireAIF();
    const chain = AI.buildChain(config, mode);
    const policy = AI.retryPolicy(config);
    const res = await AI.runChain({
        chain,
        policy,
        // 规范化放在每次尝试里：reasoning 是否回传取决于"该候选所属提供商 + 是否带 tools"
        attempt: (candidate) => attemptChatCompletion(candidate, body, onDelta),
        onAttempt: (info) => {
            if (typeof onStatus === 'function') onStatus(info);
            if (info.phase === 'retry') console.warn(`[float] ${info.candidate.model} 繁忙，重试 ${info.attempt}/${info.maxTries}`);
            else if (info.usedFallback) console.warn(`[float] 切换到备选模型：${info.candidate.provider}/${info.candidate.model || '(默认)'}`);
        },
        log: (level, msg) => { if (level === 'warn') console.warn(msg); else console.log(msg); }
    });
    if (!res.ok) throw new Error(res.error || 'AI 调用失败');
    return res.data || { choices: [{ message: { content: res.content } }] };
}

// ===== 单轮对话主循环（取代旧的 handleLightMode / handleAgentMode 双轨实现）=====
// 设计原则（对应本次重构）：
//   1. 一轮对话 = 一条 assistant 消息；content（用户可见答复）与 tool_calls（动作）共存，
//      互不替代 —— content 永远正常显示，不再被折叠成"思考过程"。
//   2. reasoning（reasoning_content / <think>）只进可折叠的「深度思考」块：
//      不当作答复显示、不进 chatHistory、不交给 TTS。
//   3. 只认标准 tool_calls。旧的文本弱匹配（把"我将调用 get_time"这种叙述当指令执行）
//      已彻底删除，避免寒暄被误判成 agent 任务。
//   4. 循环安全：轮次上限 + 每轮工具数上限 + 同参数重复调用复用上次结果 + 工具报错回传模型
//      （而不是把思考当答复返回）。
const AGENT_MAX_ROUNDS = 3;       // 工具循环上限（首次请求算第 0 轮）
const AGENT_MAX_TOOLS_PER_ROUND = 4;
const AGENT_TOOL_TIMEOUT_MS = 20000;

function toolSignature(name, args) {
    try { return name + '|' + JSON.stringify(args || {}); } catch (e) { return name + '|'; }
}

// 用 Promise.race 给单个工具加超时，避免某个工具卡死整轮对话
function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((resolve) => setTimeout(() => resolve({ success: false, error: label + ' 执行超时' }), ms))
    ]);
}

async function runChatTurn({ messages, firstAssistantMsg, streamMsgEl, mode, useVision, makeBody }) {
    const visibleParts = [];   // 用户可见正文（进历史 + TTS）
    const thinkingParts = [];  // 推理过程（只折叠展示）
    const toolCache = new Map(); // 同参数工具调用复用结果，避免模型反复 get_time 这类死循环
    let assistantMsg = firstAssistantMsg;
    let round = 0;
    let roundStreamEl = streamMsgEl || null;

    // 深度思考块：只在"深度思考开启"时展示（关闭后即便模型仍返回推理也不显示）
    const showReasoning = (text) => {
        if (!config.deepThinking) return;
        if (!text || !text.trim()) return;
        thinkingParts.push(text.trim());
        addReasoningBlock(text.trim(), roundStreamEl || null);
    };

    // 渲染/定型本轮的用户可见答复：
    // 若本轮已有流式气泡就直接定型（避免"流式气泡 + addChatMessage"出现重复气泡），
    // 否则新建一条消息。
    const showVisible = (text) => {
        const clean = String(text || '').trim();
        if (!clean) return;
        if (roundStreamEl) {
            roundStreamEl.className = 'chat-message from-pet';
            roundStreamEl.innerHTML = renderMarkdown(stripChatMarkers(stripThinkForDisplay(clean)));
            floatChatLog.scrollTop = floatChatLog.scrollHeight;
        } else {
            addChatMessage(clean, false, false);
        }
    };

    while (round <= AGENT_MAX_ROUNDS) {
        const isFirstRound = round === 0;
        const split = extractThink(assistantMsg.content == null ? '' : assistantMsg.content);
        const roundText = split.answer;
        const reasoning = [assistantMsg.reasoning_content, split.thinking].filter(Boolean).join('\n\n');

        if (reasoning) showReasoning(reasoning);
        if (roundText.trim()) visibleParts.push(roundText.trim());

        // 回填 assistant 消息：content 与 reasoning_content 都带上，
        // 是否真的把 reasoning 回传由 sanitizeChatMessages 按 provider 能力决定
        const echo = {
            role: 'assistant',
            content: roundText,
            tool_calls: Array.isArray(assistantMsg.tool_calls) ? assistantMsg.tool_calls : undefined
        };
        if (reasoning) echo.reasoning_content = reasoning;
        messages.push(echo);

        const toolCalls = Array.isArray(assistantMsg.tool_calls) ? assistantMsg.tool_calls.slice(0, AGENT_MAX_TOOLS_PER_ROUND) : [];
        if (!toolCalls.length) {
            showVisible(roundText, isFirstRound);
            break;
        }
        if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > AGENT_MAX_TOOLS_PER_ROUND) {
            console.warn('[turn] 本轮工具调用过多，已截断到 ' + AGENT_MAX_TOOLS_PER_ROUND + ' 个');
        }

        // 先把模型这一轮说的话按"正常答复"渲染出来（工具结果随后折叠在下面）
        showVisible(roundText, isFirstRound);
        roundStreamEl = null;

        for (const toolCall of toolCalls) {
            const toolName = toolCall.function && toolCall.function.name;
            if (!toolName) continue;
            let args = {};
            try { args = JSON.parse((toolCall.function && toolCall.function.arguments) || '{}'); } catch (e) { args = {}; }
            const sig = toolSignature(toolName, args);

            let result;
            if (toolCache.has(sig)) {
                result = toolCache.get(sig);
                console.log('[turn] 复用上次工具结果:', toolName);
                displayToolResult(toolName, args, result);
            } else {
                console.log('[turn] 执行工具:', toolName, args);
                result = await withTimeout(executeToolHandler(toolName, args), AGENT_TOOL_TIMEOUT_MS, toolName);
                toolCache.set(sig, result);
                displayToolResult(toolName, args, result);
            }

            // 工具失败也回传给模型（让它自己解释或换方案），不再中断整轮对话
            messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(result && result.success === false
                    ? { success: false, error: result.error || '工具执行失败' }
                    : result)
            });
        }

        round++;
        if (round > AGENT_MAX_ROUNDS) {
            console.warn('[turn] 达到工具轮次上限 ' + AGENT_MAX_ROUNDS + '，停止继续调用工具');
            break;
        }

        // 进入下一轮：重新请求（带上工具结果）
        let data;
        try {
            data = await requestChatCompletion({
                mode,
                body: makeBody(messages),
                onDelta: (fullText) => {
                    if (!roundStreamEl) {
                        roundStreamEl = document.createElement('div');
                        roundStreamEl.className = 'chat-message from-pet';
                        floatChatLog.appendChild(roundStreamEl);
                    }
                    roundStreamEl.innerHTML = renderMarkdown(stripChatMarkers(stripThinkForDisplay(fullText)));
                    floatChatLog.scrollTop = floatChatLog.scrollHeight;
                }
            });
        } catch (e) {
            console.warn('[turn] 后续轮次请求失败:', e && e.message);
            break;
        }
        if (!data || !data.choices || !data.choices[0] || !data.choices[0].message) {
            console.warn('[turn] 后续轮次返回为空');
            break;
        }
        assistantMsg = data.choices[0].message;
    }

    if (!visibleParts.length) {
        // 模型只调工具没说话：给一句兜底，避免"完全没有回复"
        visibleParts.push('（已经帮你处理好了）');
    }
    return { visibleText: visibleParts.join('\n'), thinkingText: thinkingParts.join('\n\n'), rounds: round };
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

    // 多模态：截屏 -> 压缩 -> （DeepSeek 才上传拿 file_id）-> 仅驻内存（不落盘）
    const mmProvider = config.multimodalProvider || 'deepseek';
    const mmHasKey = mmProvider === 'zhipu' ? !!config.zhipuApiKey
        : mmProvider === 'custom' ? !!config.customApiKey
        : mmProvider === 'local' ? !!config.localApiUrl
        : !!config.apiKey;
    const loadingIndicator = document.getElementById('loadingIndicator');
    let userContent = cleanText;
    if (config.multimodalEnabled && mmHasKey) {
        try {
            if (loadingIndicator) loadingIndicator.style.display = 'flex';
            const up = await window.electronAPI.uploadScreenshot();
            if (up && up.fileId) {
                if (up.remote !== false) {
                    // DeepSeek：Files API 的 file_id 块
                    userContent = [
                        { type: 'text', text: cleanText },
                        { type: 'file', file_id: up.fileId }
                    ];
                } else if (up.dataUrl && (mmProvider === 'zhipu' || mmProvider === 'custom')) {
                    // GLM / 中转站：OpenAI 兼容的 image_url + data URL（不落云端、不落盘）
                    userContent = [
                        { type: 'text', text: cleanText },
                        { type: 'image_url', image_url: { url: up.dataUrl } }
                    ];
                } else if (up.dataUrl && mmProvider === 'local' && config.localVisionModel) {
                    // 本地 LLM：只有用户显式填了视觉模型时才带图（否则纯文本模型会报错）
                    userContent = [
                        { type: 'text', text: cleanText },
                        { type: 'image_url', image_url: { url: up.dataUrl } }
                    ];
                }
                pendingConversationImages.push({
                    fileId: up.fileId,
                    dataUrl: up.dataUrl || '',
                    remote: up.remote !== false,
                    // 瞬态截图不落盘，imagePath/imageUrl 在"进入记忆"时才由主进程生成
                    imagePath: '',
                    imageUrl: '',
                    time: Date.now()
                });
            }
        } catch (e) {
            const detail = 'multimodal screenshot capture failed: ' + (e && e.message) + ' code=' + (e && e.code) + ' | apiUrl=' + config.apiUrl + ' | multimodalEnabled=' + config.multimodalEnabled + ' | provider=' + mmProvider + ' | hasKey=' + mmHasKey;
            console.warn('[float]', detail);
            if (window.electronAPI && window.electronAPI.logToMain) window.electronAPI.logToMain('error', '[float:upload] ' + detail);
        } finally {
            if (loadingIndicator) loadingIndicator.style.display = 'none';
        }
    }
    chatHistory.push({ role: 'user', content: userContent });

    // 凭据校验按"当前提供商"判断（此前写死 config.apiKey，导致 GLM/中转站/本地一律被拦）
    {
        const gateCred = chatCredentials();
        const gateProvider = config.multimodalProvider || 'deepseek';
        const missing = !gateCred.base || (gateProvider !== 'local' && !gateCred.key);
        if (missing) {
            const reply = '请先在设置中配置 API Key~';
            addChatMessage(reply, false);
            chatHistory.push({ role: 'assistant', content: reply });
            speakText(reply);
            return;
        }
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
        // 屏幕感知由多模态开关统一负责（启用时对话已自动附带截图），
        // 不再向模型暴露截图分析类工具，避免模型重复主动截屏。
        const mmActive = !!(config.multimodalEnabled && mmProvider === 'deepseek' && !!chatCredentials().key);
        const toolList = [
            '- open_app(app)：打开本地应用（计算器、记事本、浏览器、微信、QQ、VS Code、文件管理器）',
            '- open_url(url)：在浏览器打开网址',
            '- get_weather(city)：查询城市天气',
            '- volume(action, level)：音量控制（action=set 传入 level 0-100 / action=get）',
            '- get_system_info()：获取系统信息（CPU/内存/磁盘）',
            '- generate_image(prompt, size)：根据描述生成一张图片',
            '- program(action, ...)：程序管理（list / describe / run / save / update / delete）'
        ].join('\n');
        // 深度思考：模型先输出 <think>…</think> 再给答复（类似 DeepSeek 客户端）
        const thinkRule = config.deepThinking
            ? `\n【深度思考】先在心里推理，把推理过程放进 <think>…</think>（可以多段、可换行），然后另起一段输出最终答复。\n最终答复里不要再出现 <think> 标签，也不要复述推理内容。`
            : '';
        // Agent 开关：关闭后不提供任何工具，模型只能纯文本回复
        const agentOn = config.agentEnabled !== false;
        const toolSection = agentOn
            ? `【工具使用】
你可以通过标准的 function calling 机制调用工具。**只有确实需要外部信息或执行动作时才调用**：
打招呼、闲聊、情感回应、吐槽、聊设定/剧情、问你已经知道的事 —— 直接用文字回答，不要调用任何工具。
当前时间、天气、桌宠状态等已经写在对话上下文里，不需要为了"看一眼"而调用工具。
需要调用工具时直接发起工具调用；如需多步/多轮，依次调用并依据结果继续，最后给出简洁答复。
不要在正文里写"我将调用 xxx 函数""我需要调用某工具"这类过程叙述，只输出对主人说的话。

可用工具：
${toolList}

【多轮工具使用】
一次对话最多可连续调用几轮工具，依据前一次工具结果决定是否继续；完成任务后给出最终简洁答复。
工具没必要时就别调用，宁可少调用也不要为了"显得在做事"而调用。`
            : `【能力范围】
你没有任何工具/函数调用能力，也不要去描述或假装调用工具。只能用纯文本回答，
可以结合对话上下文、看到的屏幕截图和记忆来回应。`;

        const systemPrompt = `${config.aiPrompt}
${replyLengthRule}${thinkRule}
${toolSection}

【回复格式】
可带 <MOOD:心情>，可选心情仅限：${moodList.length ? moodList.join('、') : '（无可选心情）'}。
可带 <STATE:状态> 标记桌宠可切换的动作状态，可用状态：${selectableStates().map(stateLabel).join('、')}。
<MOOD:心情> 会切换聊天左侧立绘；<STATE:状态> 会切换桌宠本体动作。请只选用上面列出的名称。`;

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

        // ===== AI 请求（按当前提供商路由） =====
        // 注意：mmProvider 已在 sendMessage 外层作用域声明（L5206），此处直接复用，
        // 不再重复 const 声明，否则会遮蔽外层变量并在此闭包更早引用处触发 TDZ。
        const cred = chatCredentials();
        // 多模态（DeepSeek）开启时，对话嵌入了 file_id 图片块，必须使用 vision 模型才能理解图片
        const useVision = !!(config.multimodalEnabled && mmProvider === 'deepseek' && !!cred.key);
        const model = providerModelName();

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

        // 发起主请求（Agent 开启时携带 tools，走 OpenAI 兼容 Function Calling）
        // vision 模型用于看图，不携带 tools（避免部分模型不支持函数调用导致报错）
        const requestBody = Object.assign({
            model: model,
            messages: messages,
            // 推理模型会先用大量 token 生成 reasoning_content（如分析截图），预算太小会
            // 在产出正文前就 finish_reason=length 导致 content 为空，因此给足 2048
            max_tokens: 2048,
            temperature: 0.8
        }, thinkingParamsFor(mmProvider, model, !!config.deepThinking));
        // 只有「Agent 开关打开 + 非视觉 + 非本地」才提供工具
        if (agentOn && !useVision && mmProvider !== 'local') {
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
            // 流式阶段隐藏 <think> 内容（推理过程不糊在气泡里，结束后进折叠块）
            streamMsgEl.innerHTML = renderMarkdown(stripChatMarkers(stripThinkForDisplay(fullText)));
            floatChatLog.scrollTop = floatChatLog.scrollHeight;
        };
        try {
            // 模型繁忙时按设置重试，仍失败则自动换备选模型（见「回退与重试」）
            data = await requestChatCompletion({ mode: useVision ? 'vision' : 'chat', body: requestBody, onDelta });
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
        // 深度思考：把 <think>…</think> 拆出来（单独折叠展示），正文只留答复本身
        const thinkSplit = extractThink(assistantMsg.content || '');
        const content = thinkSplit.answer;
        if (thinkSplit.thinking) {
            assistantMsg.reasoning_content = [assistantMsg.reasoning_content, thinkSplit.thinking].filter(Boolean).join('\n\n');
        }
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

        // ===== 第四步：跑完整一轮对话（含工具循环）=====
        // 新设计：不再区分"轻量/Agent 两套流程"，统一由 runChatTurn 处理：
        //  · content（用户可见答复）与 tool_calls（动作）共存，互不替代 —— content 永远正常显示
        //  · reasoning（reasoning_content / <think>）只进折叠块，不显示成答复、不进历史、不朗读
        //  · 只认标准 tool_calls；删除文本弱匹配（叙述不再被当成指令）
        const turn = await runChatTurn({
            messages,
            firstAssistantMsg: assistantMsg,
            streamMsgEl,
            mode: useVision ? 'vision' : 'chat',
            useVision,
            makeBody: (nextMessages) => Object.assign({
                model: model,
                messages: nextMessages,
                max_tokens: 2048,
                temperature: 0.8,
                ...((agentOn && !useVision && mmProvider !== 'local') ? { tools: agentTools, tool_choice: 'auto' } : {})
            }, thinkingParamsFor(mmProvider, model, !!config.deepThinking))
        });

        // ===== 第五步：更新状态（只用用户可见正文）=====
        const finalContent = turn.visibleText.trim();

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
        // 外观主题变化 → 立即切换（其它窗口同步）
        if (data.theme !== undefined) applyTheme(data.theme);
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
        // 任务面板配置变化 → 浮窗实时重渲染（高度/字号/内容/位置）
        if (data.dshPanel !== undefined && refreshDshPanel) refreshDshPanel();
        // 若当前是设置面板模式，刷新控件显示值（不重新绑定事件）
        if (isSettingsMode) {
            refreshSettingsValues();
        } else {
            // 浮窗：凡是影响窗口尺寸/布局的设置被其它窗口改动，都要立刻重排。
            // （过去只处理 floatPetSize，导致「按钮大小 / 贴图与按钮间距 / 贴图上方留白」
            //   在设置窗口里拖动时浮窗不响应。）
            const sizeKeys = ['floatPetSize', 'buttonSize', 'floatPetBottomOffset', 'floatWindowHeightPad'];
            const sizeChanged = sizeKeys.some((k) => data[k] !== undefined && changedKeys.indexOf(k) >= 0);
            if (typeof data.floatPetSize === 'number' && isFinite(data.floatPetSize)) {
                currentPetSize = data.floatPetSize;
                document.documentElement.style.setProperty('--float-pet-size', currentPetSize + 'px');
            }
            if (sizeChanged && typeof updateWindowSize === 'function') updateWindowSize();
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
// 当前正在播放的 TTS 句柄（{ ctx, source }），新回复朗读前自动停止上一个
let __ttsCurrent = null;

// 停止当前正在播放的 TTS（若正在播）
function stopCurrentTts() {
    if (!__ttsCurrent) return;
    const { ctx, source } = __ttsCurrent;
    __ttsCurrent = null;
    try { source.stop(); } catch (e) {}
    try { ctx.close(); } catch (e) {}
}

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
            // 新回复即将朗读，先停止上一个仍在播放的 TTS
            stopCurrentTts();
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
                // 记录当前播放句柄，供下一次朗读时自动停止
                __ttsCurrent = { ctx: audioCtx, source };
                source.onended = () => {
                    if (__ttsCurrent && __ttsCurrent.source === source) {
                        __ttsCurrent = null;
                    }
                };
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

// ============================================================
// ===== DSH 联动（deepseek-harness dsh-pet-link 插件）=====
// 桌宠侧行为：
//   1. 插件在每个细分任务完成后推送 { say, state, ... } → 桌宠说话 + 切换贴图
//   2. 任务运行时在窗口角落显示「DSH 任务面板」：todolist + 点击展开实时输出（思维链/工具）
//   3. 设置面板提供：开关 / 插件端口 / 派发任务 / 取消 / 状态监控
// ============================================================
(function initDshLink() {
    if (!window.electronAPI) return;

    // 贴图下方信息条（fixed 于窗口底部，显示时通过 --pet-stat-h 把贴图/按钮顶上去；
    // 可点击：点击唤起/启动 DSH）
    // 位置：底部动作条（四个按钮）之上，避免遮挡按钮；间距常量与 CSS 保持一致。
    const dshBaseStyle = document.createElement('style');
    dshBaseStyle.textContent =
        '#petStatBar{position:fixed;left:50%;transform:translateX(-50%);bottom:0;height:' + PET_STAT_H + 'px;box-sizing:border-box;width:max-content;max-width:calc(100vw - 16px);' +
        'background:rgba(20,24,38,.78);color:#dfe4f2;border:1px solid rgba(120,132,255,.25);border-radius:8px;' +
        'padding:3px 10px;font-size:10px;line-height:1.6;text-align:center;white-space:normal;word-break:break-all;' +
        'pointer-events:auto;cursor:pointer;z-index:998;backdrop-filter:blur(2px);box-sizing:border-box;' +
        'transition:border-color .15s ease;}' +
        '#petStatBar:hover{border-color:rgba(120,132,255,.65);}' +
        // 聊天模式硬兜底：聊天窗口里信息条永不显示（JS 隐藏 + 类名双保险）
        'body.chat-mode #petStatBar{display:none !important;}' +
        // 陪伴模式：浮窗只负责陪伴，不显示 DSH 工作状态
        'body.companion-mode #petStatBar{display:none !important;}';
    document.head.appendChild(dshBaseStyle);
    // 点击信息条：唤起 / 启动 DSH（主进程决定聚焦已有窗口或新开终端）
    const petStatBarEl = document.getElementById('petStatBar');
    if (petStatBarEl) {
        petStatBarEl.title = '点击唤起 / 启动 DSH';
        petStatBarEl.addEventListener('click', () => {
            if (window.electronAPI && window.electronAPI.dshLaunch) window.electronAPI.dshLaunch();
        });
    }

    // 当前聚合状态（主进程缓存被推送后的最新值）
    let dshLive = {
        pluginReachable: false, agentStatus: 'unknown', task: '', todolist: [], output: [], minds: [],
        lastTool: '', totals: { tokens: 0, cost: 0, cacheHit: 0, cacheMiss: 0 }, balance: null, updatedAt: null
    };

    function fmtNum(n) {
        if (n == null) return '0';
        if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
        return String(n);
    }

    function balanceText() {
        const b = dshLive.balance;
        if (b && Array.isArray(b.balance_infos) && b.balance_infos.length) {
            const infos = b.balance_infos.map(i => `${i.currency} ${i.total_balance}`).join(' / ');
            return `${b.is_available ? '可用' : '余额不足'}：${infos}`;
        }
        return '余额未知（需配置 API Key）';
    }

    function hitRateText() {
        const t = dshLive.totals;
        const total = t.cacheHit + t.cacheMiss;
        return total > 0 ? ((t.cacheHit / total) * 100).toFixed(1) + '%' : '—';
    }

    // 状态栏用的紧凑余额文本（如 "¥12.34"）
    function balanceCompactText() {
        const b = dshLive.balance;
        if (b && Array.isArray(b.balance_infos) && b.balance_infos.length) {
            const i = b.balance_infos[0];
            const cur = i.currency === 'CNY' ? '¥' : (i.currency ? i.currency + ' ' : '');
            return cur + i.total_balance;
        }
        return '—';
    }

    // ---------- 非设置窗口：角落任务面板（可配置：高度 / 字号 / 显示内容 / 距贴图距离）----------
    let panelEl = null, panelOpen = false;
    // 任务面板配置（设置 → DSH 联动 → 任务面板设置）
    function dshPanelCfg() {
        const c = (config && config.dshPanel) || {};
        return {
            height: (Number(c.height) > 0) ? Number(c.height) : null, // null = 自动（限高不超出窗口）
            fontSize: (Number(c.fontSize) >= 10) ? Number(c.fontSize) : 12,
            offset: (Number(c.offset) >= 0) ? Number(c.offset) : 16,   // 距贴图上方距离(px)
            hoverGap: (Number(c.hoverGap) >= 0) ? Number(c.hoverGap) : 14, // 悬停时面板底边距下方监控栏的距离(px)
            buttonGap: (Number(c.buttonGap) >= 0) ? Number(c.buttonGap) : 10, // 悬停时面板上边距四按钮气泡的距离(px)
            showMinds: c.showMinds !== undefined ? c.showMinds !== false : (config ? config.dshShowMinds !== false : true),
            showTask: c.showTask !== false,
            showTodo: c.showTodo !== false,
            showOutput: c.showOutput !== false,
            showStats: c.showStats !== false,
        };
    }
    // 设置面板里的实时预览：渲染示意框，展示面板常规位置与鼠标靠近时的下移位置，
    // 以及与四按钮气泡、下方监控栏的相对关系
    function renderDshPanelPreview() {
        const el = document.getElementById('dshPanelPreview');
        if (!el) return;
        const cfg = dshPanelCfg();
        const W = el.clientWidth || 200, H = el.clientHeight || 150;
        const scale = H / 200; // 预览高度对应实际窗口高（约 200px）的比例
        const panelW = Math.round(W * 0.7);
        const panelLeft = W - panelW - 8;            // 面板右对齐
        const petH = Math.round(H * 0.3);
        const petW = Math.round(petH * 0.7);
        const petLeft = Math.round((W - petW) / 2);
        const barH = 10;                              // 下方监控栏示意
        const petTop = H - barH - 4 - petH;           // 桌宠顶部（监控栏上方）
        const bubbleH = Math.round(20 * scale);       // 四按钮气泡示意
        const bubbleBottom = petTop + 4;              // 气泡底边（桌宠头上方）
        // 常规位置：面板底边 = 桌宠上方 offset
        const normalBottom = petTop + Math.round(cfg.offset * scale);
        const normalH = Math.round(34 * scale);
        const normalTop = normalBottom + normalH;
        // 悬停位置：面板底边 = 监控栏上方 hoverGap，高度压到气泡底边之下留 buttonGap
        const hoverBottom = barH + Math.round(cfg.hoverGap * scale);
        const hoverMaxH = Math.max(0, Math.round(bubbleBottom - hoverBottom - Math.max(6, cfg.buttonGap * scale)));
        const hoverH = Math.round(26 * scale);
        const hoverTop = hoverBottom + hoverH;
        el.innerHTML =
            // 下方监控栏
            '<div style="position:absolute;left:4px;right:4px;bottom:2px;height:' + barH + 'px;border-radius:3px;' +
            'background:rgba(20,24,38,.5);color:#dfe4f2;font-size:9px;line-height:' + barH + 'px;text-align:center;">监控栏</div>' +
            // 桌宠
            '<div style="position:absolute;left:' + petLeft + 'px;bottom:' + (barH + 4) + 'px;width:' + petW + 'px;height:' + petH + 'px;' +
            'border-radius:12px 12px 6px 6px;background:#ffd9a0;border:1px solid #e0b57a;box-sizing:border-box;"></div>' +
            // 四按钮气泡
            '<div style="position:absolute;left:' + Math.round((W - 70) / 2) + 'px;bottom:' + bubbleBottom + 'px;width:70px;height:' + bubbleH + 'px;' +
            'border-radius:6px;background:rgba(120,132,255,.35);border:1px dashed #6a74c9;color:#3a3f6b;font-size:9px;' +
            'line-height:' + bubbleH + 'px;text-align:center;box-sizing:border-box;">四按钮</div>' +
            // 常规位置面板（半透明描边）
            '<div style="position:absolute;left:' + panelLeft + 'px;top:' + normalTop + 'px;width:' + panelW + 'px;height:' + normalH + 'px;' +
            'border-radius:8px;background:rgba(30,34,48,.15);border:1.5px dashed #8b95c9;color:#5a6390;box-sizing:border-box;padding:3px 6px;' +
            'font-size:9px;display:flex;flex-direction:column;justify-content:center;">常规（距贴图 ' + cfg.offset + 'px）</div>' +
            // 悬停位置面板（实心，夹在四按钮与监控栏之间）
            '<div style="position:absolute;left:' + panelLeft + 'px;bottom:' + hoverBottom + 'px;width:' + panelW + 'px;height:' + hoverH + 'px;' +
            'border-radius:8px;background:rgba(30,34,48,.92);color:#fff;box-sizing:border-box;padding:3px 6px;' +
            'display:flex;flex-direction:column;justify-content:center;gap:1px;font-size:9px;">' +
            '<div style="font-weight:600;">悬停位置</div>' +
            '<div style="opacity:.8;">距监控栏 ' + cfg.hoverGap + 'px · 上限 ' + hoverMaxH + 'px</div>' +
            '</div>';
    }
    // 应用面板尺寸 / 字号 / 位置。
    // 注意：不能用 CSS calc() —— 本版 Electron 解析 calc(100vh - var(...) - var(...))
    // 会失败并把 max-height 算成 0，面板被压成一条线（表现为「弹出来也看不见」）。
    // 所以这里全部在 JS 里算成像素值。
    function applyDshPanelStyle() {
        if (!panelEl) return;
        const cfg = dshPanelCfg();
        const scale = scaleFactor();
        const petBottom = cssNum('--float-pet-bottom', 72);   // 贴图脚底距窗口底边
        const petSize = cssNum('--float-pet-size', 80);
        const gap = Math.round(cfg.offset * scale);           // 面板与贴图头顶的间距
        // 竖直堆叠：状态条 → 动作条 → 贴图 →（gap）→ 面板
        const panelBottom = Math.round(petBottom + petSize + gap);
        const cap = Math.max(120, Math.round(window.innerHeight - panelBottom - 6));
        panelEl.style.bottom = panelBottom + 'px';
        panelEl.style.maxHeight = (cfg.height ? Math.min(cfg.height, cap) : cap) + 'px';
        panelEl.style.setProperty('--dsh-panel-font', cfg.fontSize + 'px');
        panelEl.style.setProperty('--dsh-panel-offset', cfg.offset + 'px');
    }
    // 跟随窗口宽度的缩放系数（面板示意图与真实尺寸共用同一套比例）
    function scaleFactor() {
        const w = window.innerWidth || 420;
        return Math.max(0.6, Math.min(1.6, w / 420));
    }
    // 读一个数值型 CSS 变量
    function cssNum(name, fallback) {
        const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
        return Number.isFinite(v) ? v : fallback;
    }
    // 面板显隐：收起态隐藏；展开态按 applyDshPanelStyle 定位。
    // 鼠标靠近不再改变位置（按钮已改到底部常驻动作条，上方没有需要让位的东西）。
    function applyPanelVisibility() {
        if (!panelEl) return;
        const wasVisible = !panelEl.classList.contains('dsh-hide');
        panelEl.classList.toggle('dsh-hide', !panelOpen);
        panelEl.style.bottom = '';
        panelEl.style.maxHeight = '';
        applyDshPanelStyle();
        // 面板显隐变化 → 窗口高度跟着变：
        // 窗口下边缘贴底（主进程按高度差反向调整 y），所以高度收缩 = 上边缘下移。
        if (wasVisible !== panelOpen && typeof updateWindowSize === 'function') updateWindowSize();
    }
    function ensurePanel() {
        if (panelEl || document.getElementById('dshTaskPanel')) return;
        const style = document.createElement('style');
        style.textContent =
            '#dshTaskPanel{position:fixed;right:14px;bottom:calc(var(--float-pet-bottom,72px) + var(--float-pet-size,80px) + 16px);z-index:99999;width:300px;max-width:calc(100vw - 28px);' +
            'background:rgba(30,34,48,.94);color:#e8eaf2;border:1px solid rgba(120,132,255,.35);border-radius:12px;' +
            'box-shadow:0 8px 30px rgba(0,0,0,.35);font-size:var(--dsh-panel-font,12px);line-height:1.7;overflow-y:auto;' +
            'scrollbar-width:none;' +
            'backdrop-filter:blur(4px);}' +
            '#dshTaskPanel::-webkit-scrollbar{display:none;}' +
            '#dshTaskPanel.dsh-hide{display:none;}' +
            '#dshTaskPanel .dsh-head{display:flex;align-items:center;gap:8px;padding:9px 11px;cursor:pointer;' +
            'background:linear-gradient(90deg,rgba(120,132,255,.16),transparent);}' +
            '#dshTaskPanel .dsh-dot{width:9px;height:9px;border-radius:50%;flex:none;}' +
            '#dshTaskPanel .dsh-title{flex:1;font-weight:600;}' +
            '#dshTaskPanel .dsh-toggle{opacity:.7;}' +
            '#dshTaskPanel .dsh-body{padding:8px 11px 10px;}' +
            '#dshTaskPanel .dsh-task{color:#c7d0ff;word-break:break-all;margin-bottom:6px;}' +
            '#dshTaskPanel .dsh-todo{list-style:none;margin:4px 0 6px;padding:0;}' +
            '#dshTaskPanel .dsh-todo li{padding:2px 0 2px 18px;position:relative;word-break:break-all;color:#dfe4f0;}' +
            '#dshTaskPanel .dsh-todo li:before{content:"○";position:absolute;left:0;color:#8b95c9;}' +
            '#dshTaskPanel .dsh-todo li.dsh-done:before{content:"●";color:#6ee7a0;}' +
            '#dshTaskPanel .dsh-todo li.dsh-done{color:#9aa3bd;text-decoration:line-through;}' +
            '#dshTaskPanel .dsh-out-btn{width:100%;margin:2px 0 4px;padding:5px;cursor:pointer;background:rgba(120,132,255,.14);' +
            'border:1px solid rgba(120,132,255,.3);color:#cdd6ff;border-radius:8px;}' +
            '#dshTaskPanel .dsh-out{display:none;background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.08);' +
            'border-radius:8px;padding:6px 8px;margin-top:4px;max-height:220px;overflow:auto;white-space:pre-wrap;' +
            'word-break:break-all;color:#b9c2d8;font-size:0.92em;line-height:1.6;}' +
            '#dshTaskPanel .dsh-out.show{display:block;}' +
            '#dshTaskPanel .dsh-stats{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:6px;color:#98a1bc;font-size:0.92em;}' +
            '#dshTaskPanel .dsh-empty{color:#8b93ad;padding:4px 0;}';
        document.head.appendChild(style);

        panelEl = document.createElement('div');
        panelEl.id = 'dshTaskPanel';
        panelEl.className = 'dsh-hide';
        panelEl.innerHTML =
            '<div class="dsh-head" id="dshHead">' +
            '<span class="dsh-dot" id="dshDot"></span>' +
            '<span class="dsh-title">DSH 空闲</span>' +
            '<span class="dsh-toggle">▾</span></div>' +
            '<div class="dsh-body" id="dshBody"></div>';
        document.body.appendChild(panelEl);
        applyDshPanelStyle();
        panelEl.querySelector('#dshHead').addEventListener('click', () => {
            panelOpen = !panelOpen;
            applyPanelVisibility();
        });
        // 注册鼠标靠近钩子：靠近（四按钮气泡显示）→ 隐藏面板，避免遮挡
        applyTaskPanelHover = (on) => {
            taskPanelHovering = !!on;
            applyPanelVisibility();
        };
        // 注册配置变化钩子：设置里改动面板配置 → 浮窗实时重渲染
        refreshDshPanel = () => { renderPanel(); };
        // 面板默认收起；仅在任务运行时自动展开
        renderPanel();
    }

    function renderPanel() {
        if (!panelEl) return;
        applyDshPanelStyle();
        const cfg = dshPanelCfg();
        const busy = dshLive.agentStatus === 'running';
        const dot = panelEl.querySelector('#dshDot');
        const title = panelEl.querySelector('.dsh-title');
        dot.style.background = busy ? '#ffd76e' : (dshLive.pluginReachable ? '#6ee7a0' : '#8b93ad');
        title.textContent = busy ? 'DSH 任务中' : (dshLive.pluginReachable ? 'DSH 空闲' : 'DSH 未连接');

        const body = panelEl.querySelector('#dshBody');
        if (!busy && !dshLive.task) {
            body.innerHTML = '<div class="dsh-empty">暂无任务…</div>';
            applyPanelVisibility();
            return;
        }
        let html = '';
        if (cfg.showMinds && Array.isArray(dshLive.minds) && dshLive.minds.length) {
            const latest = dshLive.minds.slice(-2);
            html += '<div style="font-size:0.92em;line-height:1.5;color:#9fb0e8;background:rgba(120,132,255,.10);' +
                'border:1px solid rgba(120,132,255,.2);border-radius:8px;padding:4px 8px;margin-bottom:6px;word-break:break-all;">';
            latest.forEach(m => {
                const tag = m.kind === 'think' ? '💭 思考' : (m.kind === 'tool' ? '🛠 工具' : '📋 内容');
                html += '<div><span style="opacity:.75;">' + tag + '：</span>' + escapeHtml(m.text) + '</div>';
            });
            html += '</div>';
        }
        if (cfg.showTask && dshLive.task) html += '<div class="dsh-task">📌 ' + escapeHtml(dshLive.task) + '</div>';
        if (cfg.showTodo && Array.isArray(dshLive.todolist) && dshLive.todolist.length) {
            html += '<ul class="dsh-todo">';
            dshLive.todolist.forEach(t => {
                const text = typeof t === 'string' ? t : (t.text || '');
                const done = typeof t === 'object' && (t.status === 'done' || t.status === 'completed' || t.status === 'closed');
                html += '<li class="' + (done ? 'dsh-done' : '') + '">' + escapeHtml(text) + '</li>';
            });
            html += '</ul>';
        }
        if (cfg.showOutput) {
            html += '<button class="dsh-out-btn" id="dshOutBtn">' +
                (panelOutOpen ? '▾ 收起输出' : '▸ 点击查看当前输出（思维链 / 工具）') + '</button>' +
                '<div class="dsh-out' + (panelOutOpen ? ' show' : '') + '" id="dshOut">' + escapeHtml(outputText()) + '</div>';
        }
        if (cfg.showStats) {
            html += '<div class="dsh-stats">' +
                '<span>缓存命中 ' + hitRateText() + '</span>' +
                '<span>花费 ¥' + (dshLive.totals.cost || 0).toFixed(2) + '</span>' +
                '<span>Token ' + fmtNum(dshLive.totals.tokens || 0) + '</span>' +
                '<span>' + escapeHtml(balanceText()) + '</span>' +
                '</div>';
        }
        body.innerHTML = html;
        const outBtn = body.querySelector('#dshOutBtn');
        if (outBtn) outBtn.addEventListener('click', () => {
            panelOutOpen = !panelOutOpen;
            renderPanel();
        });
        if (busy && !panelOpen) {
            panelOpen = true;
        }
        applyPanelVisibility();
    }

    let panelOutOpen = false;
    function outputText() {
        const outs = Array.isArray(dshLive.output) ? dshLive.output : [];
        const steps = outs.slice(-60).map(o => {
            if (typeof o === 'string') return o;
            if (o && Array.isArray(o.items)) return '· 工具 ' + (o.name || '') + '\n' + o.items.join('\n');
            if (o && typeof o === 'object') return '· ' + (o.name || o.type || '') + (o.text ? ': ' + o.text : '');
            return '';
        }).join('\n');
        return steps || '（暂无输出）';
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }

    // ---------- 设置窗口：监控区渲染 ----------
    function renderSettingsMonitor() {
        const el = document.getElementById('dshMonitor');
        if (!el) return;
        const busy = dshLive.agentStatus === 'running';
        let html = '';
        html += '状态：' + (busy ? '🟡 任务运行中' : (dshLive.pluginReachable ? '🟢 已连接（空闲）' : '⚪ 未连接插件（请确认 DSH 已安装并加载 dsh-pet-link）')) + '\n';
        if (dshLive.task) html += '任务：' + dshLive.task + '\n';
        if (dshLive.lastTool) html += '最近工具：' + dshLive.lastTool + '\n';
        if (Array.isArray(dshLive.todolist) && dshLive.todolist.length) {
            html += 'Todolist：\n' + dshLive.todolist.map(t => {
                const text = typeof t === 'string' ? t : (t.text || '');
                const done = typeof t === 'object' && (t.status === 'done' || t.status === 'completed' || t.status === 'closed');
                return (done ? '  ✓ ' : '  ○ ') + text;
            }).join('\n') + '\n';
        }
        if (Array.isArray(dshLive.output) && dshLive.output.length) {
            html += '最近输出：' + outputText().split('\n').slice(-6).join('\n') + '\n';
        }
        html += '缓存命中率：' + hitRateText() +
            ' | 累计花费 ¥' + (dshLive.totals.cost || 0).toFixed(2) +
            ' | Token ' + fmtNum(dshLive.totals.tokens || 0) + '\n' +
            balanceText();
        el.textContent = html;
    }

    // ---------- 处理插件推送 ----------
    function handleDshMessage(payload) {
        if (!payload || typeof payload !== 'object') return;
        if (payload.pluginReachable != null) dshLive.pluginReachable = !!payload.pluginReachable;
        if (payload.agentStatus != null) dshLive.agentStatus = payload.agentStatus;
        if (payload.task != null) dshLive.task = payload.task;
        if (Array.isArray(payload.todolist)) dshLive.todolist = payload.todolist;
        if (payload.tool != null) dshLive.lastTool = payload.tool;
        if (Array.isArray(payload.output) && payload.output.length) {
            if (!Array.isArray(dshLive.output)) dshLive.output = [];
            dshLive.output = dshLive.output.concat(payload.output).slice(-120);
        }
        if (payload.totals) dshLive.totals = { ...dshLive.totals, ...payload.totals };
        if (payload.balance) dshLive.balance = payload.balance;
        if (Array.isArray(payload.minds)) dshLive.minds = payload.minds;

        // DSH 覆盖状态机：任务运行中暂停随机状态机，按环节推送切换贴图（保留各状态特效）
        const ovr = dshOverrideCfg();
        if (ovr.enabled) {
            // 先按环节切贴图，再处理启停：turn/end 推送同时带 category(done/error) 与 agentStatus:'idle'，
            // 若先退出覆盖，done/error 环节贴图会被跳过（表现为「设置好了但不切换」）
            if (dshOverrideActive && payload.category) {
                const st = ovr.states[payload.category];
                if (st && typeof setPetState === 'function' && KNOWN_STATES.includes(st)) {
                    setPetState(st);
                }
            }
            if (payload.agentStatus === 'running' && !dshOverrideActive) setDshOverrideActive(true);
            if (payload.agentStatus === 'idle' && dshOverrideActive) setDshOverrideActive(false);
        }

        // 原生审批 / 提问：DSH approval seam 或（旧）模型提问 → 桌宠弹窗
        if ((payload.event === 'approval' || payload.event === 'ask') && payload.question) {
            const isApproval = payload.event === 'approval';
            const question = isApproval
                ? ('🔐 ' + (payload.reason || payload.question)) + (payload.toolName ? '\n（工具：' + payload.toolName + '）' : '')
                : ('❓ ' + payload.question);
            showAskDialog(String(question), isApproval ? ['允许', '拒绝', '取消'] : ['是', '否', '取消']);
        }

        // 说话 + 切贴图（仅桌宠/聊天窗口；语音开关由 speakText 内部判断）
        // 设置窗口不朗读：DSH 推送会广播到所有窗口，桌宠浮窗已经合成过一遍，
        // 这里再合成会出现两路语音重叠（设置面板只需要更新监控面板显示）。
        // 任务完成时 TTS 只播报简短的完成语（随机挑选），不再念插件推送的长文案
        if (isSettingsMode) {
            // 设置窗口：只更新 UI，不合成任何 DSH 语音
        } else if ((payload.event === 'task/done' || payload.event === 'test/done') && typeof speakText === 'function') {
            const DONE_PHRASES = ['任务完成！', '任务搞定啦！', '完成啦～', '搞定！', '任务完成～'];
            speakText(DONE_PHRASES[Math.floor(Math.random() * DONE_PHRASES.length)]);
        } else if (payload.say && typeof speakText === 'function') {
            speakText(String(payload.say));
        }
        // 覆盖状态机开启且本轮已按环节切过贴图时，插件自带的 state 不再二次覆盖
        // （用户设置的环节贴图优先；turn/end 推送同时带 category 与 state 的场景即此例）
        const overrideDecided = ovr.enabled && dshOverrideActive && !!payload.category;
        if (!overrideDecided && payload.state && typeof setPetState === 'function' && KNOWN_STATES.includes(payload.state)) {
            setPetState(payload.state);
        }

        renderStatBar();
        if (isSettingsMode) renderSettingsMonitor();
        else renderPanel();
    }

    // DSH 覆盖状态机配置（设置 → DSH 联动）
    function dshOverrideCfg() {
        const c = (config && config.dsh && config.dsh.override) || {};
        return { enabled: c.enabled !== false, states: c.states || {} };
    }
    // 是否在任务面板上方显示 DSH 最新思维/工具/查找内容
    function dshShowMinds() {
        return !config || config.dshShowMinds !== false;
    }
    // 把信息条实际高度写到 --pet-stat-h，并让窗口/贴图重新排布。
    // 状态条显示时会把贴图与动作条整体顶上去 —— 贴图在屏幕上的绝对位置不变。
    function applyStatLift() {
        const bar = document.getElementById('petStatBar');
        const root = document.documentElement;
        const apply = () => {
            const h = (bar && bar.style.display !== 'none') ? (bar.offsetHeight || 0) : 0;
            const prev = parseFloat(root.style.getPropertyValue('--pet-stat-h')) || 0;
            root.style.setProperty('--pet-stat-h', h + 'px');
            if (h !== prev && typeof updateWindowSize === 'function') updateWindowSize();
        };
        if (!bar || bar.style.display === 'none') {
            root.style.setProperty('--pet-stat-h', '0px');
            if (typeof updateWindowSize === 'function') updateWindowSize();
            return;
        }
        requestAnimationFrame(apply);
    }
    function renderStatBar() {
        // 聊天 / 陪伴模式：隐藏下方信息条（陪同时浮窗只作陪伴，不显示 DSH 工作状态）
        if (isSettingsMode || isChatMode || isCompanionMode) {
            const bar = document.getElementById('petStatBar');
            if (bar && bar.style.display !== 'none') {
                bar.style.display = 'none';
                applyStatLift();
            }
            return;
        }
        const bar = document.getElementById('petStatBar');
        if (!bar) return;
        const cfg = statDisplayCfg();
        const parts = [];
        if (cfg.dsh) {
            const hitRate = hitRateText();
            const conn = dshLive.pluginReachable ? '🟢' : '⚪';
            parts.push(conn + ' DSH ' + (dshLive.agentStatus === 'running' ? '运行中' : (dshLive.pluginReachable ? '空闲' : '未连')));
            // 显示余额而不是累计消费
            parts.push('余额 ' + balanceCompactText() + ' · 缓存 ' + hitRate);
        }
        if (cfg.rate && statRate) parts.push(statRate.label);
        if (cfg.hardware && statHw) {
            let hw = 'CPU ' + statHw.cpuPct + '% · 内存 ' + statHw.memPct + '%';
            if (statHw.tempC != null) hw += ' · ' + statHw.tempC + '°C';
            parts.push(hw);
        }
        if (parts.length === 0) {
            if (bar.style.display !== 'none') {
                bar.style.display = 'none';
                applyStatLift();
                bar.textContent = '';
            }
            return;
        }
        bar.textContent = parts.join('  ·  ');
        if (bar.style.display === 'none') {
            bar.style.display = 'block';
            applyStatLift();
        } else {
            applyStatLift();
        }
    }
    let statHw = null, statRate = null;
    function startStatBar() {
        if (isSettingsMode) return;
        renderStatBar();
        statTimer = setInterval(async () => {
            try {
                if (window.electronAPI && window.electronAPI.getSystemStats) {
                    const s = await window.electronAPI.getSystemStats();
                    if (s) { statHw = s; statRate = s.ratePeriod || null; }
                }
            } catch (e) { /* 忽略 */ }
            renderStatBar();
        }, 5000);
    }
    // ---------- 贴图下方信息条配置 ----------
    let statTimer = null;
    function statDisplayCfg() {
        const c = (config && config.dshInfo) || {};
        return { dsh: c.dsh !== false, hardware: c.hardware !== false, rate: c.rate !== false };
    }

    // ---------- ask_user 弹窗（模型提问/请求批准）----------
    let askModal = null;
    function showAskDialog(question, options) {
        if (!askModal || !document.body.contains(askModal)) {
            const style = document.createElement('style');
            style.textContent =
                '#dshAskModal{position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;' +
                'background:rgba(10,12,20,.45);backdrop-filter:blur(2px);}' +
                '#dshAskBox{width:min(340px,86vw);background:var(--surface);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.3);' +
                'padding:18px;font:13px/1.7 system-ui,sans-serif;color:#222;max-height:70vh;overflow:auto;}' +
                '#dshAskQ{font-weight:600;margin:0 0 14px;word-break:break-all;white-space:pre-wrap;}' +
                '#dshAskBtns{display:flex;flex-wrap:wrap;gap:8px;}' +
                '#dshAskBtns button{flex:1;min-width:84px;padding:8px 10px;border-radius:8px;border:1px solid #d3d9e3;' +
                'background:#f6f8fb;cursor:pointer;font-size:13px;}' +
                '#dshAskBtns button:hover{background:#e9eef7;}' +
                '#dshAskBtns button.ask-cancel{background:#ffecec;border-color:#f3c1c1;color:#c0392b;}';
            document.head.appendChild(style);
            askModal = document.createElement('div');
            askModal.id = 'dshAskModal';
            askModal.innerHTML = '<div id="dshAskBox"><p id="dshAskQ"></p><div id="dshAskBtns"></div></div>';
            document.body.appendChild(askModal);
        } else {
            const q = askModal.querySelector('#dshAskQ');
            const b = askModal.querySelector('#dshAskBtns');
            q.textContent = ''; b.innerHTML = '';
        }
        const q = askModal.querySelector('#dshAskQ');
        const b = askModal.querySelector('#dshAskBtns');
        q.textContent = '❓ ' + question;
        options.forEach((opt, i) => {
            const btn = document.createElement('button');
            btn.textContent = opt;
            if (opt === '取消' || i === options.length - 1) btn.className = 'ask-cancel';
            btn.addEventListener('click', () => {
                askModal.style.display = 'none';
                if (opt === '取消' && window.electronAPI && window.electronAPI.dshAskRespond) {
                    window.electronAPI.dshAskRespond('', -1, true);
                } else if (window.electronAPI && window.electronAPI.dshAskRespond) {
                    window.electronAPI.dshAskRespond(String(opt), i, false);
                }
            });
            b.appendChild(btn);
        });
        askModal.style.display = 'flex';
    }

    // ---------- 设置面板控件 ----------
    function bindSettings() {
        const enToggle = document.getElementById('dshEnabledToggle');
        const portInput = document.getElementById('dshPluginPortInput');
        const taskInput = document.getElementById('dshTaskInput');
        const sendBtn = document.getElementById('dshSendTaskBtn');
        const cancelBtn = document.getElementById('dshCancelTaskBtn');
        if (enToggle) {
            enToggle.addEventListener('change', () => window.electronAPI.dshSetEnabled(enToggle.checked));
        }
        if (portInput) {
            portInput.addEventListener('change', () => {
                const n = parseInt(portInput.value.trim(), 10);
                if (n > 0 && n < 65536) {
                    window.electronAPI.dshSetPluginPort(n);
                } else {
                    portInput.value = '43999';
                }
            });
        }
        if (sendBtn && taskInput) {
            sendBtn.addEventListener('click', async () => {
                const text = taskInput.value.trim();
                if (!text) return;
                sendBtn.disabled = true;
                const res = await window.electronAPI.dshSendTask(text);
                sendBtn.disabled = false;
                if (res && res.ok) { taskInput.value = ''; }
                else alert('派发失败：' + ((res && (res.error || (res.data && res.data.error))) || '无法连接 dsh-pet-link 插件'));
            });
        }
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => window.electronAPI.dshCancelTask());
        }
        const testBtn = document.getElementById('dshTestStateBtn');
        if (testBtn) {
            testBtn.addEventListener('click', async () => {
                testBtn.disabled = true;
                const orig = testBtn.textContent;
                testBtn.textContent = '模拟中…';
                try {
                    // 桌宠本地模拟（必然执行） + 插件 /test-state 真实链路（插件在线时并行）
                    const res = await window.electronAPI.dshTestState({});
                    const pluginInfo = res && res.plugin
                        ? ('plugin=' + (res.plugin.ok ? 'ok' : ('failed(' + (res.plugin.httpStatus || res.plugin.error || 'unknown') + ')')))
                        : 'plugin=not-connected';
                    console.log('[float] test push done: local=' + (res && res.local ? 'yes' : 'no') + ' | ' + pluginInfo);
                } catch (e) {
                    console.warn('[float] test push error:', e);
                }
                testBtn.textContent = orig;
                testBtn.disabled = false;
                if (typeof renderSettingsMonitor === 'function') renderSettingsMonitor();
            });
        }
        // 信息条显示项（三项独立开关）
        const dshChk = document.getElementById('dshStatDsh');
        const hwChk = document.getElementById('dshStatHardware');
        const rateChk = document.getElementById('dshStatRate');
        const saveInfoCfg = () => {
            if (!config) return;
            config.dshInfo = {
                dsh: !!(dshChk && dshChk.checked),
                hardware: !!(hwChk && hwChk.checked),
                rate: !!(rateChk && rateChk.checked)
            };
            if (window.electronAPI && window.electronAPI.syncConfig) window.electronAPI.syncConfig(config);
        };
        if (dshChk) dshChk.addEventListener('change', saveInfoCfg);
        if (hwChk) hwChk.addEventListener('change', saveInfoCfg);
        if (rateChk) rateChk.addEventListener('change', saveInfoCfg);
        // ---- DSH 覆盖状态机 / 环节贴图 / 思维栏 ----
        const saveOverride = (patch) => {
            if (!config) return;
            config.dsh = { ...(config.dsh || {}), override: { enabled: true, states: {}, ...(config.dsh && config.dsh.override), ...patch } };
            if (window.electronAPI && window.electronAPI.syncConfig) window.electronAPI.syncConfig(config);
        };
        const ovrToggle = document.getElementById('dshOverrideToggle');
        if (ovrToggle) {
            const ovr = dshOverrideCfg();
            ovrToggle.checked = ovr.enabled;
            ovrToggle.addEventListener('change', () => saveOverride({ enabled: ovrToggle.checked }));
        }
        fillOverrideSelects(); // 环节下拉由模块级函数填充（状态注册完成后再刷新）

        // ---- 任务面板设置（高度 / 字号 / 距贴图距离 / 显示内容 + 实时预览）----
        const saveDshPanel = (patch) => {
            if (!config) return;
            config.dshPanel = { ...(config.dshPanel || {}), ...patch };
            if (window.electronAPI && window.electronAPI.syncConfig) window.electronAPI.syncConfig(config);
            renderDshPanelPreview();
            if (refreshDshPanel) refreshDshPanel();
        };
        const bindPanelSlider = (id, valId, suffix, onInput) => {
            const s = document.getElementById(id), v = document.getElementById(valId);
            if (!s) return;
            const setVal = (val) => {
                s.value = String(val);
                if (v) v.textContent = val + suffix;
            };
            s.addEventListener('input', () => onInput(Number(s.value)));
            return { setVal };
        };
        const pCfg = dshPanelCfg();
        const hBind = bindPanelSlider('dshPanelHeightSlider', 'dshPanelHeightValue', pCfg.height ? 'px' : '（自动）', (n) => saveDshPanel({ height: n }));
        const fBind = bindPanelSlider('dshPanelFontSlider', 'dshPanelFontValue', 'px', (n) => saveDshPanel({ fontSize: n }));
        const oBind = bindPanelSlider('dshPanelOffsetSlider', 'dshPanelOffsetValue', 'px', (n) => saveDshPanel({ offset: n }));
        const hovBind = bindPanelSlider('dshPanelHoverSlider', 'dshPanelHoverValue', 'px', (n) => saveDshPanel({ hoverGap: n }));
        if (hBind) hBind.setVal(pCfg.height || 0);
        if (fBind) fBind.setVal(pCfg.fontSize);
        if (oBind) oBind.setVal(pCfg.offset);
        if (hovBind) hovBind.setVal(pCfg.hoverGap);
        const contentToggles = {
            dshPanelShowMinds: 'showMinds',
            dshPanelShowTask: 'showTask',
            dshPanelShowTodo: 'showTodo',
            dshPanelShowOutput: 'showOutput',
            dshPanelShowStats: 'showStats',
        };
        for (const id in contentToggles) {
            const el = document.getElementById(id);
            if (!el) continue;
            const key = contentToggles[id];
            el.checked = dshPanelCfg()[key];
            el.addEventListener('change', () => saveDshPanel({ [key]: el.checked }));
        }
        renderDshPanelPreview();
    }

    function applySettingsFromConfig() {
        const enToggle = document.getElementById('dshEnabledToggle');
        const portInput = document.getElementById('dshPluginPortInput');
        const info = (config && config.dshInfo) || {};
        const dshChk = document.getElementById('dshStatDsh');
        const hwChk = document.getElementById('dshStatHardware');
        const rateChk = document.getElementById('dshStatRate');
        if (enToggle && config) enToggle.checked = !!(config.dsh && config.dsh.enabled);
        if (portInput && config && config.dsh && config.dsh.pluginPort) {
            portInput.value = config.dsh.pluginPort;
        }
        if (dshChk) dshChk.checked = info.dsh !== false;
        if (hwChk) hwChk.checked = info.hardware !== false;
        if (rateChk) rateChk.checked = info.rate !== false;
        // 任务面板设置（从配置恢复滑块/勾选 + 预览）
        const pp = dshPanelCfg();
        const setSlider = (id, valId, val, suffix) => {
            const s = document.getElementById(id), v = document.getElementById(valId);
            if (s) s.value = String(val);
            if (v) v.textContent = val + suffix;
        };
        setSlider('dshPanelHeightSlider', 'dshPanelHeightValue', pp.height || 0, pp.height ? 'px' : '（自动）');
        setSlider('dshPanelFontSlider', 'dshPanelFontValue', pp.fontSize, 'px');
        setSlider('dshPanelOffsetSlider', 'dshPanelOffsetValue', pp.offset, 'px');
        setSlider('dshPanelHoverSlider', 'dshPanelHoverValue', pp.hoverGap, 'px');
        const ct = { dshPanelShowMinds:'showMinds', dshPanelShowTask:'showTask', dshPanelShowTodo:'showTodo', dshPanelShowOutput:'showOutput', dshPanelShowStats:'showStats' };
        for (const id in ct) { const el = document.getElementById(id); if (el) el.checked = pp[ct[id]]; }
        renderDshPanelPreview();
    }

    // 初始拉取一次主进程缓存状态（如程序先于桌宠启动、已累积若干消息）
    if (window.electronAPI.dshGetStatus) {
        window.electronAPI.dshGetStatus().then(s => {
            if (s) {
                dshLive = { ...dshLive, ...s };
                if (isSettingsMode) renderSettingsMonitor(); else renderPanel();
            }
        }).catch(() => {});
    }
    if (window.electronAPI.onDshMessage) {
        window.electronAPI.onDshMessage(handleDshMessage);
    }
    if (isSettingsMode) {
        bindSettings();
        applySettingsFromConfig();
        renderSettingsMonitor();
    } else {
        ensurePanel();
        startStatBar();
    }
})();

