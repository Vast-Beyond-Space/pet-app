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
let tickTimer = null;
let isSpeaking = false;
let previousCostSavingSetting = false;

// ===== 数值体系（陪伴模式专用）=====
let stats = { energy: 72, boredom: 35, affection: 25, novelty: 25 }; // 与 INIT_STATS 同值，避免下方常量 TDZ
let talkDrive = 0;               // 当前说话冲动
let lastTalkTick = -Infinity;    // 上次说话的时刻(Date.now())
let lastActivityTick = Date.now(); // 上次观测到键盘/鼠标活动的时刻
let lastIdleSec = 0;             // 上次查询的系统空闲秒数
let lastScreenHash = '';         // 上次截屏感知哈希
let lastScreenImage = '';        // 最近一次截屏的 JPEG base64（供多模态模型直接看图）
let lastScreenImageTime = 0;     // 最近截图时间戳
let lastThought = '';            // 最近一次思考内容（自言自语）
let lastThoughtTime = 0;         // 思考时间戳
let thinkIntervalCount = 0;      // 思考定时计数
let idleNoOpTicks = 0;           // 连续无操作 tick 计数

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
const DIALOG_HARD_MAX = 30;      // 历史硬上限：懒压缩触发阈值（原来 100，缩短以便缓存命中窗口合理）
const DIALOG_COMPRESS_RATIO = 0.25; // 新增对话占历史 25% 以上才触发 AI 总结（否则纯丢弃）
const CAPTURE_INTERVAL = 10000;
const TICK_INTERVAL = 10000;     // 数值 tick：10 秒
const SPEAK_COOLDOWN = 90000;    // 说话冷却：90 秒

// 四值初始（0-100）
const INIT_STATS = { energy: 72, boredom: 35, affection: 25, novelty: 25 };
// 说话冲动权重（屏幕新鲜度最高，感知键盘/鼠标/屏幕变化）
const TALK_WEIGHTS = { boredom: 0.28, energy: 0.18, novelty: 0.34, affection: 0.20 };
// 说话冲动阈值（安静档默认）与随机抖动
const TALK_THRESHOLD = 54;
const TALK_JITTER = 7;

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
                multimodalProvider: parsed.multimodalProvider || 'deepseek',
                localApiUrl: parsed.localApiUrl || '',
                localApiKey: parsed.localApiKey || '',
                localModel: parsed.localModel || '',
                localCompanionModel: parsed.localCompanionModel || '',
                localMemoryModel: parsed.localMemoryModel || '',
                localVisionModel: parsed.localVisionModel || '',
                // 云端模型自主选择（设置面板「模型选择」）
                deepseekModel: parsed.deepseekModel || '',
                deepseekCompanionModel: parsed.deepseekCompanionModel || '',
                deepseekMemoryModel: parsed.deepseekMemoryModel || '',
                deepseekVisionModel: parsed.deepseekVisionModel || '',
                zhipuModel: parsed.zhipuModel || '',
                zhipuCompanionModel: parsed.zhipuCompanionModel || '',
                zhipuMemoryModel: parsed.zhipuMemoryModel || '',
                zhipuVisionModel: parsed.zhipuVisionModel || '',
                // 自定义 / 中转站
                customName: parsed.customName || '',
                customApiUrl: parsed.customApiUrl || '',
                customApiKey: parsed.customApiKey || '',
                customModel: parsed.customModel || '',
                customCompanionModel: parsed.customCompanionModel || '',
                customMemoryModel: parsed.customMemoryModel || '',
                customVisionModel: parsed.customVisionModel || '',
                apiKey: parsed.apiKey || '',
                apiUrl: parsed.apiUrl || '',
                aiPrompt: parsed.aiPrompt || '你是桌宠小鲸鱼，性格活泼可爱，用简短中文回复。',
                selectedVoice: parsed.selectedVoice || 'default',
                voiceEnabled: parsed.voiceEnabled !== undefined ? parsed.voiceEnabled : true,
                enableMemory: parsed.enableMemory || false,
                companionFontSize: parsed.companionFontSize || 14,
                companionPetSize: parsed.companionPetSize || 180,
                stickerPack: parsed.stickerPack || '默认',
                // ===== 陪伴数值体系设置 =====
                companionThoughtEnabled: parsed.companionThoughtEnabled !== undefined ? parsed.companionThoughtEnabled : true,
                companionThoughtFreq: parsed.companionThoughtFreq || 'low', // off|low|high
                companionThoughtVisible: parsed.companionThoughtVisible !== undefined ? parsed.companionThoughtVisible : false,
                // 桌宠贴图模式：用 浮窗_*.png 桌宠状态贴图代替 mood 立绘，贴图切换/移动由 AI 指令控制
                companionUsePetSprite: parsed.companionUsePetSprite !== undefined ? !!parsed.companionUsePetSprite : false,
                // 窗口自由移动：复用桌宠浮窗的 游荡/重力 机制（风格跟随 floatMoveMode）
                companionFreeMove: parsed.companionFreeMove !== undefined ? !!parsed.companionFreeMove : false,
                floatMoveMode: parsed.floatMoveMode || 'gravity',
                companionTalkThreshold: parsed.companionTalkThreshold !== undefined ? parsed.companionTalkThreshold : TALK_THRESHOLD,
                companionScreenSensitivity: parsed.companionScreenSensitivity || 'medium', // low|medium|high
                // 外观主题（purple 为默认）
                theme: parsed.theme || 'purple'
            };
        }
    } catch (e) {
        console.warn('[Companion] 配置加载失败:', e);
    }
    return {
        zhipuApiKey: '',
        multimodalProvider: 'deepseek',
        localApiUrl: '',
        localApiKey: '',
        localModel: '',
        localCompanionModel: '',
        localMemoryModel: '',
        localVisionModel: '',
        // 云端模型自主选择（设置面板「模型选择」）
        deepseekModel: '',
        deepseekCompanionModel: '',
        deepseekMemoryModel: '',
        deepseekVisionModel: '',
        zhipuModel: '',
        zhipuCompanionModel: '',
        zhipuMemoryModel: '',
        zhipuVisionModel: '',
        // 自定义 / 中转站（OpenAI 兼容）
        customName: '',
        customApiUrl: '',
        customApiKey: '',
        customModel: '',
        customCompanionModel: '',
        customMemoryModel: '',
        customVisionModel: '',
        apiKey: '',
        apiUrl: '',
        aiPrompt: '你是桌宠小鲸鱼，性格活泼可爱，用简短中文回复。',
        selectedVoice: 'default',
        voiceEnabled: true,
        enableMemory: false,
        companionFontSize: 14,
        companionPetSize: 180,
        stickerPack: '默认',
        companionThoughtEnabled: true,
        companionThoughtFreq: 'low',
        companionThoughtVisible: false,
        companionUsePetSprite: false,
        companionFreeMove: false,
        floatMoveMode: 'gravity',
        companionTalkThreshold: TALK_THRESHOLD,
        companionScreenSensitivity: 'medium',
        theme: 'purple'
    };
}
const config = loadConfig();

// ===== 外观主题（程序化配色）=====
// 仅切换 <html data-accent="...">，配色由 CSS 的 --brand 系列令牌驱动。
function applyTheme(name) {
    const names = ['purple', 'blue', 'teal', 'green', 'pink'];
    document.documentElement.setAttribute('data-accent', names.indexOf(name) >= 0 ? name : 'purple');
}
applyTheme(config.theme || 'purple');

// ===== AI 可用性与模型（按当前提供商判断）=====
function isAiConfigured() {
    const p = config.multimodalProvider || 'deepseek';
    if (window.AIFallback) return window.AIFallback.isConfigured(config, p);
    if (p === 'zhipu') return !!config.zhipuApiKey;
    if (p === 'local') return !!(config.localApiUrl || '').trim();
    if (p === 'custom') return !!(config.customApiUrl && config.customApiKey);
    return !!config.apiKey;
}
function companionModel() {
    const p = config.multimodalProvider || 'deepseek';
    if (window.AIFallback) return window.AIFallback.resolveModel(config, p, 'companion');
    const fallback = p === 'zhipu' ? 'glm-4.6v-flash' : p === 'local' ? '' : 'deepseek-flash';
    return fallback;
}

// 应用陪伴模式 UI 设置
speechEl.style.fontSize = config.companionFontSize + 'px';
petImg.style.width = config.companionPetSize + 'px';
petImg.style.height = config.companionPetSize + 'px';
// 应用贴图包
window._stickerPack = config.stickerPack || '默认';

// ===== 从主进程拉取权威配置并应用陪伴相关字段 =====
// companion 是独立 file:// 窗口，自己的 localStorage 不共享设置窗口的 petConfig；
// 设置窗口改动经主进程统一保存并广播，这里在启动时主动拉取一次权威值覆盖默认。
function pullAuthoritativeConfig() {
    if (!window.electronAPI || !window.electronAPI.getConfig) return;
    window.electronAPI.getConfig().then((unified) => {
        if (!unified || typeof unified !== 'object') return;
        const keys = [
            'companionFontSize', 'companionPetSize',
            'companionThoughtFreq', 'companionThoughtVisible',
            'companionUsePetSprite', 'companionFreeMove', 'floatMoveMode',
            'companionTalkThreshold', 'companionScreenSensitivity',
            'aiPrompt', 'zhipuApiKey', 'multimodalEnabled', 'multimodalProvider',
            'localApiUrl', 'localApiKey', 'localModel',
            'localCompanionModel', 'localMemoryModel', 'localVisionModel',
            'deepseekModel', 'deepseekCompanionModel', 'deepseekMemoryModel', 'deepseekVisionModel',
            'zhipuModel', 'zhipuCompanionModel', 'zhipuMemoryModel', 'zhipuVisionModel',
            'customName', 'customApiUrl', 'customApiKey',
            'customModel', 'customCompanionModel', 'customMemoryModel', 'customVisionModel',
            'apiKey', 'apiUrl',
            'selectedVoice', 'voiceEnabled', 'stickerPack', 'theme'
        ];
        keys.forEach(k => { if (unified[k] !== undefined) config[k] = unified[k]; });
        // 应用新值到 UI
        applyTheme(config.theme || 'purple');
        speechEl.style.fontSize = config.companionFontSize + 'px';
        petImg.style.width = config.companionPetSize + 'px';
        petImg.style.height = config.companionPetSize + 'px';
        // 应用贴图包与模式开关：进入陪伴模式前已开启的开关在这里生效
        // （此前只赋值不应用，导致「桌宠贴图」不切换、「窗口自由移动」不下落）
        window._stickerPack = config.stickerPack || '默认';
        refreshMoodList();  // 资产列表按当前包刷新，完成后会再次应用 sprite 模式
        applySpriteMode();
        applyFreeMove();
        // [companion-debug] 打印从主进程拉到的陪伴字段
        console.log('[companion-debug][pullAuthoritativeConfig]', unified);
        console.log('[companion-debug][pullAuthoritativeConfig] thFreq=' + config.companionThoughtFreq +
            ' thVis=' + config.companionThoughtVisible +
            ' thr=' + config.companionTalkThreshold +
            ' sens=' + config.companionScreenSensitivity);
    }).catch(() => {});
}
pullAuthoritativeConfig();

// ===== 动态心情（依据当前贴图包 mood_*.png）：新增 mood_ 贴图会自动纳入立绘选择 =====
// 同时收集 浮窗_*.png 桌宠状态贴图（桌宠贴图模式用），资产到位后应用一次模式开关。
function refreshMoodList() {
    if (window.electronAPI && window.electronAPI.getPackAssets) {
        window.electronAPI.getPackAssets().then((a) => {
            if (a && Array.isArray(a.moods) && a.moods.length) {
                MOOD_LIST.length = 0;
                a.moods.forEach(m => { if (!MOOD_LIST.includes(m)) MOOD_LIST.push(m); });
            }
            packStates = (a && Array.isArray(a.states)) ? a.states.slice() : [];
            applySpriteMode();
        }).catch(() => {});
    }
}
refreshMoodList();

// ===== 桌宠贴图模式（AI 控制贴图切换/移动，思考/说话系统不变）=====
// 开启后用当前包的 浮窗_*.png 桌宠状态贴图代替 mood 立绘；
// AI 在回复末尾附加 <STATE>状态名</STATE> 切换贴图、<MOVE>位置</MOVE> 移动（标记会被剥离，不朗读）。
let spriteMode = false;          // 桌宠贴图模式是否生效（开关开 且 包内有浮窗_贴图）
let packStates = [];             // 当前包可用的 浮窗_ 状态名列表
let currentSpriteState = '';     // 当前显示的桌宠状态
const SPRITE_DEFAULT_STATE = '发呆';

// ===== 窗口自由移动（复刻桌宠浮窗 float.js 的移动机制）=====
// 与浮窗同一套行为与物理常数：
//   重力模式——开启/松手后窗口做抛物线下落弹跳（gravity=0.002，落地反弹 0.4），
//             落地后停 2~6s → 沿地面走向 1/5 屏宽内的随机目标 → 循环；
//   游荡模式——随机 2D 目标点（min(屏宽,屏高)/3 内），走到后再停 2~6s 选下一个；
//             拖拽释放后停 3s 继续游荡（重力模式则按拖拽速度抛出）。
//   MOVE_SPEED=1.2px/16ms、GRAVITY=0.002px/ms²、速度上限 ±2.0，全部与 float.js 相同。
let freeMove = false;            // 是否启用（config.companionFreeMove）
let moveMode = 'gravity';        // 移动风格（复用 config.floatMoveMode：gravity|wandering）
let mvX = 0, mvY = 0;            // 引擎持有的窗口位置（左上角）
let wanderTimer = null;          // 游荡调度定时器
let stepping = false;            // 正在走向目标点
let throwing = false;            // 抛物线进行中
let workAreaCache = null;
let lastWaRefresh = 0;
const movePauseReason = { drag: false, recording: false };
const MOVE_SPEED = 1.2;          // px/step，与 float.js 相同
const MOVE_INTERVAL_MS = 16;     // 步进间隔，与 float.js 相同
const GRAVITY = 0.002;           // px/ms²，与 float.js 抛物线相同
const WA_MARGIN = 20;            // 工作区边距，与 float.js 相同
// 拖拽速度采样（与 float.js 相同：mouseup 时按此速度抛出）
let dragVelX = 0, dragVelY = 0, lastDragX = 0, lastDragY = 0, lastDragTime = 0;

function currentMovePaused() { return movePauseReason.drag || movePauseReason.recording; }

async function refreshWorkArea() {
    try {
        const wa = await window.electronAPI.getWorkAreaAtPoint(mvX + window.innerWidth / 2, mvY + window.innerHeight / 2);
        if (wa && wa.width) workAreaCache = wa;
    } catch (e) {}
    if (!workAreaCache) {
        const s = window.screen || {};
        workAreaCache = { x: s.availLeft || 0, y: s.availTop || 0, width: s.availWidth || 1920, height: s.availHeight || 1040 };
    }
    lastWaRefresh = performance.now();
}

function moveWindowTo(x, y) {
    if (window.electronAPI && window.electronAPI.moveCompanionWindow) {
        window.electronAPI.moveCompanionWindow(Math.round(x), Math.round(y));
    }
}

// 与 float.js 一致：向右走时翻转贴图（原始贴图朝左）
function petFlip(stepX) {
    if (stepX > 0) petImg.classList.add('flip');
    else if (stepX < 0) petImg.classList.remove('flip');
}

function scheduleWander(delay) {
    if (wanderTimer) { clearTimeout(wanderTimer); wanderTimer = null; }
    if (!freeMove) return;
    wanderTimer = setTimeout(() => { wanderTimer = null; wander(); },
        delay == null ? (2000 + Math.random() * 4000) : delay);
}

// 走向目标点（wander 与 AI <MOVE> 指令共用）。gravity 模式 ty 传 null = 贴地面走。
async function walkToTarget(targetX, targetY) {
    if (!freeMove || stepping || throwing || currentMovePaused()) return;
    if (!workAreaCache || performance.now() - lastWaRefresh > 2000) await refreshWorkArea();
    const wa = workAreaCache;
    if (!wa) return;
    const winW = window.innerWidth || 400, winH = window.innerHeight || 350;
    const groundY = wa.y + wa.height - winH;
    if (moveMode === 'gravity') {
        if (groundY - mvY > 4) { scheduleWander(1000); return; } // 还在空中：稍后重试，避免调度丢失
        targetY = groundY;
    }
    targetX = Math.max(wa.x + WA_MARGIN, Math.min(wa.x + wa.width - winW - WA_MARGIN, targetX));
    if (targetY != null) targetY = Math.max(wa.y, Math.min(groundY, targetY));

    const dx = targetX - mvX, dy = (targetY == null ? 0 : targetY - mvY);
    const dist = Math.hypot(dx, dy);
    if (dist < 1) { scheduleWander(); return; }

    let stepX = Math.max(-MOVE_SPEED * 2, Math.min(MOVE_SPEED * 2, (dx / dist) * MOVE_SPEED));
    let stepY = Math.max(-MOVE_SPEED * 2, Math.min(MOVE_SPEED * 2, (dy / dist) * MOVE_SPEED));
    if (moveMode === 'gravity') stepY = 0;  // Y 由物理系统管理（与 float.js 相同）
    const totalSteps = Math.ceil((moveMode === 'gravity' ? Math.abs(dx) : dist) / MOVE_SPEED);
    let currentStep = 0;
    stepping = true;
    petFlip(stepX);
    petImg.classList.add('walking'); // 一跳一跳行走动画（复刻 float.js）

    const step = () => {
        if (!freeMove || currentMovePaused() || throwing) { // 抛物线优先，行走让位
            petImg.classList.remove('walking');
            stepping = false;
            return;
        }
        currentStep++;
        if (currentStep >= totalSteps) { mvX = targetX; if (targetY != null) mvY = targetY; }
        else { mvX += stepX; mvY += stepY; }
        if (moveMode === 'gravity') mvY = groundY;
        // 边界：整窗始终在 workArea 内（与 float.js 相同，非重力模式反弹衰减 0.8）
        if (mvX < wa.x) { mvX = wa.x; if (moveMode !== 'gravity') stepX = -Math.abs(stepX) * 0.8; }
        else if (mvX + winW > wa.x + wa.width) { mvX = wa.x + wa.width - winW; if (moveMode !== 'gravity') stepX = Math.abs(stepX) * 0.8; }
        if (moveMode !== 'gravity' && targetY != null) {
            if (mvY < wa.y) { mvY = wa.y; stepY = Math.abs(stepY) * 0.8; }
            else if (mvY > groundY) { mvY = groundY; stepY = -Math.abs(stepY) * 0.8; }
        }
        moveWindowTo(mvX, mvY);
        if (currentStep < totalSteps) setTimeout(step, MOVE_INTERVAL_MS);
        else {
            petImg.classList.remove('walking');
            stepping = false;
            scheduleWander();
        }
    };
    step();
}

// 游荡（与 float.js wander 同参数）：重力=地面 1/5 屏宽，游荡=2D 1/3 屏内
async function wander() {
    if (!freeMove || stepping || throwing || currentMovePaused()) return;
    if (!workAreaCache || performance.now() - lastWaRefresh > 2000) await refreshWorkArea();
    const wa = workAreaCache;
    if (!wa) return;
    const winW = window.innerWidth || 400, winH = window.innerHeight || 350;
    let targetX, targetY;
    if (moveMode === 'gravity') {
        const maxMoveRange = wa.width / 5;
        targetX = mvX + (Math.random() - 0.5) * 2 * maxMoveRange;
        targetY = null; // 贴地面
    } else {
        const maxRange = Math.min(wa.width, wa.height) / 3;
        const taskbarOffset = 48;
        const minY = wa.y + WA_MARGIN, maxY = wa.y + wa.height - winH - WA_MARGIN - taskbarOffset;
        targetX = mvX + (Math.random() - 0.5) * 2 * maxRange;
        targetY = Math.max(minY, Math.min(maxY, mvY + (Math.random() - 0.5) * 2 * maxRange));
    }
    walkToTarget(targetX, targetY);
}


// 抛物线（复刻 float.js throwWithParabola）：拖拽释放/初始下落/跳跃共用
// gravity=0.002、四边反弹 0.4、落地滑动 velX*=0.8 直到 <0.01 停止
function throwWithParabola(vx, vy, randomIfZero) {
    if (!freeMove || throwing || currentMovePaused()) return;
    let velX = Math.max(-2.0, Math.min(2.0, Number(vx) || 0));
    let velY = Math.max(-2.0, Math.min(2.0, Number(vy) || 0));
    if (velX === 0 && velY === 0 && randomIfZero !== false) {
        velX = (Math.random() < 0.5 ? -1 : 1) * 0.5; // 与 float.js 相同：纯下落带随机横速
    }
    throwing = true;
    let lastTime = performance.now();

    const step = () => {
        if (!freeMove || currentMovePaused()) { throwing = false; return; }
        const now = performance.now();
        const dt = Math.min(60, now - lastTime);
        lastTime = now;
        const winW = window.innerWidth || 400, winH = window.innerHeight || 350;

        velY += GRAVITY * dt;
        mvX += velX * dt;
        mvY += velY * dt;
        if (now - lastWaRefresh > 300) refreshWorkArea();
        const wa = workAreaCache || { x: 0, y: 0, width: 1920, height: 1040 };

        if (mvX < wa.x) { mvX = wa.x; velX = Math.abs(velX) * 0.4; }
        else if (mvX + winW > wa.x + wa.width) { mvX = wa.x + wa.width - winW; velX = -Math.abs(velX) * 0.4; }
        const topBound = wa.y, bottomBound = wa.y + wa.height - winH;
        if (mvY < topBound) { mvY = topBound; velY = Math.abs(velY) * 0.4; }
        else if (mvY >= bottomBound) {
            mvY = bottomBound;
            if (Math.abs(velY) > 0.1) { velY = -velY * 0.4; velX *= 0.7; }
            else {
                velY = 0; velX *= 0.8;
                moveWindowTo(mvX, mvY);
                if (Math.abs(velX) < 0.01) {
                    velX = 0;
                    throwing = false;
                    scheduleWander(2000); // 落定后与 float.js 同节奏进入游荡
                    return;
                }
            }
        }
        moveWindowTo(mvX, mvY);
        requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

function startFreeMove() {
    if (freeMove || !window.electronAPI || !window.electronAPI.moveCompanionWindow) return;
    freeMove = true;
    moveMode = (config.floatMoveMode === 'wandering') ? 'wandering' : 'gravity';
    const pos = window.electronAPI.getWindowPos();
    mvX = pos ? pos[0] : mvX; mvY = pos ? pos[1] : mvY;
    workAreaCache = null; lastWaRefresh = 0;
    refreshWorkArea();
    if (moveMode === 'gravity') {
        throwWithParabola(0, 0); // 从当前位置落到地面（下落可见，与拖拽释放同一套物理）
    } else {
        scheduleWander(2000);
    }
    console.log('[Companion] 自由移动开启（模式=' + moveMode + '）');
}

function stopFreeMove() {
    freeMove = false;
    if (wanderTimer) { clearTimeout(wanderTimer); wanderTimer = null; }
    stepping = false;
    throwing = false;
    petImg.classList.remove('walking');
}

function applyFreeMove() {
    if (config.companionFreeMove) startFreeMove();
    else stopFreeMove();
}

function applySpriteMode() {
    const want = !!config.companionUsePetSprite && packStates.length > 0;
    if (want === spriteMode && !want) return;
    spriteMode = want;
    container.classList.toggle('sprite-mode', spriteMode);
    if (spriteMode) {
        const st = packStates.includes(SPRITE_DEFAULT_STATE) ? SPRITE_DEFAULT_STATE : packStates[0];
        setPetSpriteState(st);
        console.log('[Companion] 桌宠贴图模式开启，可用状态:', packStates.join('、'));
    } else {
        petImg.classList.remove('flip');
        setMood(mood); // 关闭：恢复心情立绘
    }
}

function setPetSpriteState(name) {
    if (!packStates.length) return;
    const st = packStates.includes(name) ? name
        : (packStates.includes(SPRITE_DEFAULT_STATE) ? SPRITE_DEFAULT_STATE : packStates[0]);
    currentSpriteState = st;
    petImg.onerror = () => {
        // 贴图缺失：先回退默认状态贴图；仍缺失则尝试「默认」包的同名贴图
        if (st !== SPRITE_DEFAULT_STATE && packStates.includes(SPRITE_DEFAULT_STATE)) {
            petImg.src = imgPath('浮窗_' + SPRITE_DEFAULT_STATE + '.png');
        } else if (window._stickerPack && window._stickerPack !== '默认') {
            petImg.onerror = null;
            petImg.src = 'img/默认/浮窗_' + st + '.png';
        }
    };
    petImg.src = imgPath('浮窗_' + st + '.png');
    console.log('[Companion] 桌宠贴图切换(AI):', st);
}

function moveWindowCommand(posName) {
    if (!freeMove || currentMovePaused()) return;
    const name = String(posName || '').trim();
    if (!name) return;
    if (moveMode === 'gravity') {
        // 重力模式（与浮窗行为一致）：上=抛物线跳跃，左/右=沿地面走向对应方向
        if (name.indexOf('上') >= 0) {
            stepping = false; // 停止行走循环，避免与抛物线同时写位置
            throwWithParabola(0, -0.9, false); // 跳起后自然落地
        } else if (name.indexOf('左') >= 0) {
            walkToTarget(mvX - (workAreaCache ? workAreaCache.width : 1200) / 5, null);
        } else if (name.indexOf('右') >= 0) {
            walkToTarget(mvX + (workAreaCache ? workAreaCache.width : 1200) / 5, null);
        } else if (/随机|随便|中心/.test(name)) {
            scheduleWander(300);
        }
    } else {
        // 游荡模式：按方位走向目标点
        const dist = 260;
        const dirs = { '左上': [-0.7, -0.7], '右上': [0.7, -0.7], '左下': [-0.7, 0.7], '右下': [0.7, 0.7], '左': [-1, 0], '右': [1, 0], '上': [0, -1], '下': [0, 1] };
        let d = null;
        for (const k of Object.keys(dirs)) { if (name.indexOf(k) >= 0) { d = dirs[k]; break; } }
        if (!d && /中心/.test(name) && workAreaCache) {
            d = [workAreaCache.x + workAreaCache.width / 2 - mvX, workAreaCache.y + workAreaCache.height / 2 - mvY];
        }
        if (!d || /随机|随便/.test(name)) { const a = Math.random() * Math.PI * 2; d = [Math.cos(a), Math.sin(a)]; }
        const len = Math.hypot(d[0], d[1]) || 1;
        walkToTarget(mvX + d[0] / len * dist, mvY + d[1] / len * dist);
    }
}

// 从 AI 回复中剥离贴图/移动指令，返回干净文本 + 指令
// 容错：智谱有几率漏写闭合标签（如 "<STATE>睡觉" 或与内容混在一行），
// 此时取标签后第一行、截断到下一个 '<' 为止；完整闭合标签优先。
function extractPetCommands(text) {
    let clean = String(text == null ? '' : text);
    let state = null, move = null;

    const grab = (re, name) => {
        let m = clean.match(re.full);
        if (m) { clean = clean.replace(m[0], ''); }
        else {
            m = clean.match(re.open); // 无闭合：截到换行或下一个 '<'
            if (m) clean = clean.replace(m[0], '');
        }
        if (m) {
            const v = String(m[1] || '').trim().split('\n')[0].replace(/\s+/g, '');
            re.out = v || null;
        }
    };
    const stateRe = { full: /<STATE>\s*([^<]*?)\s*<\/STATE>/i, open: /<STATE>\s*([^\n<]*)/i, out: null };
    const moveRe = { full: /<MOVE>\s*([^<]*?)\s*<\/MOVE>/i, open: /<MOVE>\s*([^\n<]*)/i, out: null };
    grab(stateRe, 'state');
    grab(moveRe, 'move');
    // 兜底：清掉正文中残留的孤立/残缺标签片段，避免被朗读
    clean = clean.replace(/<\/?(STATE|MOVE)>/gi, '');
    return { clean: clean.trim(), state: stateRe.out, move: moveRe.out };
}

function applyPetCommands(cmds) {
    if (!cmds) return;
    if (cmds.state && spriteMode) setPetSpriteState(cmds.state);
    if (cmds.move && freeMove) moveWindowCommand(cmds.move);
}

// 动作指令独立请求：每次说话后都会走一次（主回复带的标签优先，缺哪类补哪类）。
// 不依赖主回复是否输出标签——智谱有几率漏标签，独立请求是贴图/移动的主路径而非兜底。
// 走 mode=companion 候选链（空正文/繁忙自动切 glm-4-flash），不需要动作返回 null。
// need: { state: bool, move: bool }——只请求缺失的类别，避免重复执行。
async function requestPetCommandFallback(contextText, need) {
    need = need || { state: spriteMode, move: freeMove };
    if ((!spriteMode && !freeMove) || !isAiConfigured()) return null;
    if (!window.electronAPI || !window.electronAPI.aiChatRequest) return null;
    // 状态语义说明（按包内实际存在的状态动态生成）
    const STATE_MEAN = { '游荡': '闲逛放松', '吃饭': '饿了/吃东西', '发呆': '无所事事/放空', '工作': '专注干活/加班', '生气': '被骂/不高兴', '睡觉': '困了/休息' };
    const lines = [];
    if (need.state && spriteMode) {
        lines.push('第一行：<STATE>状态</STATE>，状态必须从下面选一个最匹配情境的（括号内是含义）：\n'
            + packStates.map(s => s + '(' + (STATE_MEAN[s] || '状态') + ')').join('、'));
    }
    if (need.move && freeMove) {
        lines.push('第二行：<MOVE>方向</MOVE>，方向可选：' + (moveMode === 'gravity'
            ? '上(跳跃)/左/右/随机'
            : '上/下/左/右/左上/右上/左下/右下/中心/随机') + '；不需要移动就输出 <MOVE>无</MOVE>');
    }
    // few-shot 示例：只用包内存在的状态，锚定小模型的语义映射
    const ex = [];
    if (need.state && spriteMode) {
        const has = (s) => packStates.includes(s);
        if (has('睡觉')) ex.push(['主人说“我困死了，要睡了”', '睡觉']);
        if (has('吃饭')) ex.push(['主人说“好饿，点个外卖”', '吃饭']);
        if (has('发呆')) ex.push(['主人夸你真可爱', '发呆']);
        if (has('工作')) ex.push(['主人在赶工加班', '工作']);
        if (has('生气')) ex.push(['主人说“别烦我”', '生气']);
        if (ex.length) lines.push('示例（根据情境重新选择，不要沿用上一个状态）：\n' + ex.map(([c, s]) => '情境：' + c + ' → <STATE>' + s + '</STATE>' + (need.move ? '\n<MOVE>无</MOVE>' : '')).join('\n\n'));
    }
    const sys = '你是桌宠动作控制器。必须依次输出以下标签，除标签外不要输出任何其他文字：\n' + lines.join('\n');
    const user = '情境：' + contextText + '\n当前时间：' + getTimePeriod();
    try {
        const r = await window.electronAPI.aiChatRequest({
            messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
            mode: 'companion',
            model: companionModel(),
            maxTokens: 60,
            temperature: 0.5
        });
        const text = r && r.choices && r.choices[0] && r.choices[0].message
            ? String(r.choices[0].message.content || '') : '';
        if (!text) return null;
        const cmds = extractPetCommands(text);
        if (cmds.move && /^(无|不需要?|不移动)$/.test(cmds.move)) cmds.move = null; // <MOVE>无</MOVE> = 不移动
        if (cmds.state && /^(无|不需要?|保持)$/.test(cmds.state)) cmds.state = null;
        return (cmds.state || cmds.move) ? cmds : null;
    } catch (e) {
        console.warn('[Companion] 动作指令独立请求失败:', e.message);
        return null;
    }
}

// 统一入口：主回复带的标签优先，缺失的类别用独立请求补齐，返回合并后的指令。
async function resolvePetCommands(petCmds, contextText) {
    const needState = spriteMode && !petCmds.state;
    const needMove = freeMove && !petCmds.move;
    if (needState || needMove) {
        const fb = await requestPetCommandFallback(contextText, { state: needState, move: needMove });
        if (fb) {
            return { state: petCmds.state || fb.state, move: petCmds.move || fb.move };
        }
    }
    return petCmds;
}

// ===== 监听配置更新（与主窗口设置同步） =====
if (window.electronAPI && window.electronAPI.onConfigUpdated) {
    window.electronAPI.onConfigUpdated((data) => {
        if (data) {
            config.zhipuApiKey = data.zhipuApiKey || config.zhipuApiKey;
            config.multimodalEnabled = data.multimodalEnabled !== undefined ? data.multimodalEnabled : config.multimodalEnabled;
            config.multimodalProvider = data.multimodalProvider !== undefined ? data.multimodalProvider : config.multimodalProvider;
            if (data.zhipuApiUrl !== undefined) config.zhipuApiUrl = data.zhipuApiUrl;
            if (data.localApiUrl !== undefined) config.localApiUrl = data.localApiUrl;
            if (data.localApiKey !== undefined) config.localApiKey = data.localApiKey;
            if (data.localModel !== undefined) config.localModel = data.localModel;
            if (data.localCompanionModel !== undefined) config.localCompanionModel = data.localCompanionModel;
            if (data.localMemoryModel !== undefined) config.localMemoryModel = data.localMemoryModel;
            if (data.localVisionModel !== undefined) config.localVisionModel = data.localVisionModel;
            if (data.apiKey !== undefined) config.apiKey = data.apiKey;
            if (data.apiUrl !== undefined) config.apiUrl = data.apiUrl;
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
                refreshMoodList();
                // 重新渲染立绘以应用新的贴图包
                setMood(mood);
            }
            if (data.companionThoughtEnabled !== undefined) config.companionThoughtEnabled = !!data.companionThoughtEnabled;
            if (data.companionThoughtFreq !== undefined) config.companionThoughtFreq = data.companionThoughtFreq;
            if (data.companionThoughtVisible !== undefined) config.companionThoughtVisible = !!data.companionThoughtVisible;
            if (data.companionUsePetSprite !== undefined) {
                config.companionUsePetSprite = !!data.companionUsePetSprite;
                applySpriteMode(); // 开关即时生效（切桌宠贴图 / 切回心情立绘）
            }
            if (data.floatMoveMode !== undefined) config.floatMoveMode = data.floatMoveMode;
            if (data.companionFreeMove !== undefined) {
                config.companionFreeMove = !!data.companionFreeMove;
                applyFreeMove(); // 开关即时生效（开/关窗口自由移动）
            }
            if (data.companionTalkThreshold !== undefined) config.companionTalkThreshold = Number(data.companionTalkThreshold) || TALK_THRESHOLD;
            if (data.companionScreenSensitivity !== undefined) config.companionScreenSensitivity = data.companionScreenSensitivity;
            if (data.theme !== undefined) applyTheme(data.theme);
            console.log('[Companion] 配置已同步:', data);
        }
    });
}

// ===== 数值体系核心 =====

// 当前数值快照（供提示词注入，让模型感知桌宠状态）
function getStatsSnapshot() {
    return `【桌宠状态】精力 ${Math.round(stats.energy)}，无聊度 ${Math.round(stats.boredom)}，好感 ${Math.round(stats.affection)}，屏幕新鲜度 ${Math.round(stats.novelty)}。`;
}

// 感知哈希：由主进程基于屏幕像素亮度生成 144 位哈希（见 main.js capture-screen-raw）。
// 用于判断"屏幕是否发生变化"，变化小时跳过截屏/视觉调用（省成本 + 保持缓存前缀稳定）。
async function computeScreenHash() {
    if (!window.electronAPI || !window.electronAPI.captureScreenRaw) return '';
    try {
        const hash = await window.electronAPI.captureScreenRaw();
        return typeof hash === 'string' ? hash : '';
    } catch (e) {
        return '';
    }
}

// 屏幕灵敏度 → 哈希变化阈值（感知差异）
function screenChangeThreshold() {
    const s = config.companionScreenSensitivity || 'medium';
    if (s === 'low') return 0.5;   // 低：只在大变化时视为新鲜
    if (s === 'high') return 0.15; // 高：小变化也算新鲜
    return 0.3;                    // 中（默认）
}

// 查询系统空闲秒数，判断键盘/鼠标活动（差分法：idle 变短说明有输入）
async function pollActivity() {
    if (!window.electronAPI || !window.electronAPI.companionActivity) return false;
    try {
        const { idleSec } = await window.electronAPI.companionActivity();
        const prev = lastIdleSec;
        lastIdleSec = idleSec;
        // 有活动：本轮 idle < 上轮 idle（发生过输入）或 idle 很小（正在持续操作）
        const hasActivity = idleSec < prev || idleSec < 5;
        if (hasActivity) {
            lastActivityTick = Date.now();
            idleNoOpTicks = 0;
        } else {
            idleNoOpTicks++;
        }
        return hasActivity;
    } catch (e) {
        return false;
    }
}

// 每 tick 更新四值（潮汐：每个值都有涨落）
async function updateStats() {
    const hasActivity = await pollActivity();
    const now = Date.now();

    // 键盘/鼠标活动→屏幕新鲜度事件脉冲（余温衰减）
    if (hasActivity) {
        stats.novelty = Math.min(90, stats.novelty + 6);
    }
    // 注意：idleNoOpTicks 已在 pollActivity() 内维护，这里不重复累加

    // 屏幕变化：感知哈希比对，变化超阈值 → 新鲜度抬升
    const hash = await computeScreenHash();
    let screenChanged = false;
    if (hash && lastScreenHash) {
        if (hash !== lastScreenHash) screenChanged = true;
    }
    lastScreenHash = hash || lastScreenHash || '';
    if (screenChanged) {
        stats.novelty = Math.min(90, stats.novelty + 18);
    }

    // 新鲜度退潮：始终向基线回归；长时间无操作（>10min）更深回落
    stats.novelty += (50 - stats.novelty) * 0.06;
    if (idleNoOpTicks > 60) stats.novelty += (38 - stats.novelty) * 0.06;
    stats.novelty = Math.max(5, Math.min(90, stats.novelty));

    // 精力：清醒消耗；低值（<25）触发"打盹"恢复（独立小循环，防归零）
    stats.energy -= 0.06;
    if (stats.energy < 25) stats.energy += 0.35;
    stats.energy = Math.max(0, Math.min(80, stats.energy));

    // 无聊：随时间积累（退潮：说话/互动释放）；封顶 100，防止长期运行后 talkDrive 恒过阈值
    stats.boredom = Math.min(100, stats.boredom + 0.10);

    // 好感：常态微涨 + 互动额外加成（封顶 100）
    stats.affection += 0.002 + (hasActivity ? 0.02 : 0);
    stats.affection = Math.min(100, stats.affection);

    // 说话冲动 = 加权合成 + 抖动
    talkDrive = TALK_WEIGHTS.boredom * stats.boredom
        + TALK_WEIGHTS.energy * Math.max(0, 100 - stats.energy)
        + TALK_WEIGHTS.novelty * stats.novelty
        + TALK_WEIGHTS.affection * stats.affection
        + (Math.random() * 2 - 1) * TALK_JITTER;
    // 低频英文日志（约每 10 tick 一次），便于观测数值演化
    if (idleNoOpTicks % 10 === 0) {
        console.log('[Companion] stats e=' + stats.energy.toFixed(1) + ' b=' + stats.boredom.toFixed(1) + ' a=' + stats.affection.toFixed(1) + ' n=' + stats.novelty.toFixed(1) + ' talkDrive=' + talkDrive.toFixed(1));
    }
}

// 判断当前是否应该开口
function shouldSpeak() {
    const threshold = config.companionTalkThreshold || TALK_THRESHOLD;
    const cooled = timeSince(lastTalkTick) >= SPEAK_COOLDOWN;
    const over = talkDrive >= threshold;
    // 必要时记录是否过线（便于确认冲动驱动路径生效）
    if (over && cooled) console.log('[Companion] shouldSpeak=YES talkDrive=' + talkDrive.toFixed(1) + ' >= threshold=' + threshold);
    return cooled && over;
}
function timeSince(t) {
    const now = Date.now();
    try { return now - t; } catch (e) { return Infinity; }
}

// 说话触发主入口（tick 驱动）
async function tickSpeakCheck() {
    if (isSpeaking || !active || isRecording) return;
    if (!isAiConfigured()) {
        // 无 AI 凭据时不调 API，仅保持数值运行
        scheduleTickCheck();
        return;
    }
    const decided = await magicWordShouldSpeak();
    if (decided) {
        await speak();
    }
    scheduleTickCheck();
}

// 通过 AI 判断是否值得说话（返回 true=说）。为省钱：本地冲动→阈值先筛，
// 过线才调一次 AI，AI 用 <SPEAK>/<SKIP> 最终裁决。
async function magicWordShouldSpeak() {
    if (!shouldSpeak()) return false;
    const screenContext = getScreenContext();
    const now = new Date();
    const timeStr = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
    let prompt = `【当前情境】\n- 当前时间：${timeStr}（${getTimePeriod()}）`;
    if (screenContext) prompt += `\n- 用户屏幕内容：${screenContext}`;
    if (conversationSummary) prompt += `\n- 最近对话摘要：${conversationSummary}`;
    if (recentDialogs.length > 0) {
        const last = recentDialogs[recentDialogs.length - 1];
        prompt += `\n- 最后一条对话：${last.role === 'user' ? '用户' : '桌宠'}说：${last.content}`;
    }
    if (recentSpeeches.length > 0) prompt += `\n- 你最近说过的话（请勿重复）：${recentSpeeches.join(' | ')}`;
    if (lastThoughtTime > 0 && timeSince(lastThoughtTime) < 10 * 60 * 1000) {
        prompt += `\n- 你刚才在心里想的：${lastThought}`;
    }
    prompt += `\n\n【任务】你正用语音陪主人，现在在想是否开口说句话。`;
    prompt += `\n判断依据：当前有没有值得说的（屏幕有新东西、想到值得关心的事、气氛适合闲聊）。`;
    prompt += `\n合适就输出 <SPEAK>具体内容</SPEAK>，不合适输出 <SKIP>。一句话，口语化。`;
    prompt += `\n你说的内容会被直接朗读，禁止动作描写/旁白/括注。`;

    try {
        const reply = await callZhipu(prompt, 2, lastScreenImage || undefined);
        if (!reply) return false;
        if (/<SKIP>/i.test(reply) && !/<SPEAK>/i.test(reply)) return false;
        return true;
    } catch (e) {
        return false;
    }
}

// 思考循环（自言自语）：本地模板 + 可选 AI 增强
async function thinkTick() {
    if (!active || isRecording) return;
    const freq = config.companionThoughtFreq || 'low';
    // 兼容旧配置：无 companionThoughtEnabled 字段时，只要频率非 off 即视为启用
    const enabled = config.companionThoughtEnabled !== undefined
        ? !!config.companionThoughtEnabled
        : freq !== 'off';
    if (!enabled) return;
    // 频率档位（tick=10s）：high ≈ 每 20s，low ≈ 每 5min
    let every = freq === 'high' ? 2 : freq === 'low' ? 30 : 0; // 每 N tick 想一次
    if (every <= 0) return;
    thinkIntervalCount++;
    if (thinkIntervalCount % every !== 0) return;
    await runOneThought();
}

// 执行一次"思考"：由 AI 生成内心想法（可看图），产出 lastThought（供说话/回复注入）并按需显示气泡。
// 说话与思考唯一区别：思考不触发 TTS。API 失败/无 key 时退回本地模板兜底。
// 独立函数：可供测试按钮"立即思考"直接调用，绕过 tick 频率门控。
async function runOneThought() {
    let thought = '';
    // AI 生成（主要来源）：按当前提供商选模型直接看图 + 状态，生成一句内心想法
    if (isAiConfigured()) {
        try {
            const screenContext = getScreenContext();
            const prompt = `请只输出一句简短的内心想法（不超过 20 字，口语化，像自言自语），不要输出思考过程、不要解释、不要任何标记。`;
            let sys = '你是一只名叫小鲸鱼的桌宠，会自己默默想事情。';
            if (screenContext) sys += `\n屏幕内容：${screenContext}`;
            // 思考直接看图：附带最近截图（若有），thinking 模型据此生成真实内心想法
            const userContent = lastScreenImage
                ? [
                    { type: 'text', text: prompt },
                    { type: 'image_url', image_url: { url: lastScreenImage } }
                ]
                : prompt;
            const r = await window.electronAPI.aiChatRequest({
                messages: [{ role: 'system', content: sys }, { role: 'user', content: userContent }],
                mode: 'companion',
                model: companionModel(), // 按当前提供商选模型（智谱 GLM / 本地 LLM / DeepSeek）
                maxTokens: 512, // 视觉思考更长，预留思考开销防止 thinking 模型正文为空（实测 mt=300 仍可能被吃满）
                temperature: 0.6
            });
            const msg = r && r.choices && r.choices[0] && r.choices[0].message ? r.choices[0].message : null;
            // 优先正文；正文为空时（思考型模型常见）退回本地模板
            if (msg && msg.content && String(msg.content).trim()) {
                const t = String(msg.content).trim();
                if (t && t.length <= 40) thought = t;
            } else {
                console.warn('[Companion] thought AI 返回空正文（可能 thinking 占满 token）：', JSON.stringify(r).substring(0, 200));
            }
        } catch (e) {
            console.warn('[Companion] thought AI 调用失败，回退模板:', e.message);
        }
    }
    // 兜底：本地模板（零成本，仅当 AI 未产出时）
    if (!thought) {
        thought = localThoughtTemplate();
        console.log('[Companion] thought fallback template:', thought);
    }
    if (thought) {
        lastThought = thought;
        lastThoughtTime = Date.now();
        if (config.companionThoughtVisible) showSpeech('💭 ' + thought, 3000);
        console.log('[Companion] thought: ' + thought);
    }
}

// 本地思考模板（零成本，纯数值驱动造句）
function localThoughtTemplate() {
    const frags = [];
    if (stats.energy < 25) frags.push('有点困了…');
    if (stats.boredom > 60) frags.push('好无聊啊');
    if (stats.novelty > 70) frags.push('诶？屏幕上好像有新东西');
    if (stats.affection > 70) frags.push('和主人在一起真好');
    if (timeSince(lastActivityTick) > 20 * 60 * 1000) frags.push('主人好像好久没动了…');
    if (frags.length > 0) return frags[Math.floor(Math.random() * frags.length)];
    return '嗯…今天做什么好呢？';
}

// 开动数值 tick
function startTicks() {
    if (tickTimer) clearInterval(tickTimer);
    const run = async () => {
        try {
            await updateStats();
            await thinkTick();
            await tickSpeakCheck();
        } catch (e) {
            console.warn('[Companion] tick 异常:', e);
        }
    };
    run();
    tickTimer = setInterval(run, TICK_INTERVAL);
    console.log('[Companion] tick engine started (TICK_INTERVAL=' + TICK_INTERVAL + 'ms, threshold=' + (config.companionTalkThreshold || TALK_THRESHOLD) + ')');
}
function stopTicks() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
}
function scheduleTickCheck() { /* tick 由 startTicks 的 setInterval 驱动，无需额外调度 */ }

// ===== 切换心情（切换立绘） =====
// 仅使用 mood_ 立绘贴图，如果加载失败则尝试其他心情
function setMood(newMood) {
    // 桌宠贴图模式：立绘切换只记录心情值，不改贴图（贴图由 AI 的 <STATE> 指令驱动）
    if (spriteMode) {
        if (newMood) mood = newMood;
        return;
    }
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
    // 有效语音：设置里可能是 'default' 或具体 id；非法 id 由主进程/服务端回退默认
    let voiceToUse = (selectedVoice === 'default') ? 'zh-CN-XiaoxiaoNeural' : selectedVoice;

    if (window.electronAPI && window.electronAPI.speakText) {
        // 主进程已剥离 emoji，这里再做一道防抖清洗，避免边缘字符导致合成失败
        const clean = String(text).replace(/[\u200B-\u200F\uFEFF\u00AD\u2060\u180E]/g, '').trim();
        if (!clean) return;
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const audioB64 = await window.electronAPI.speakText(clean, voiceToUse);
                if (!audioB64) {
                    // 第一次失败换默认语音再试一次（服务端也可能已回退），下一轮直接中断
                    if (attempt === 0) { voiceToUse !== 'zh-CN-XiaoxiaoNeural' && (voiceToUse = 'zh-CN-XiaoxiaoNeural'); continue; }
                    return;
                }
                const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                // 自动播放策略：确保上下文处于可播放状态（部分环境需 resume）
                if (audioCtx.state === 'suspended') {
                    try { await audioCtx.resume(); } catch (e) {}
                }
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
            } catch (e) {
                console.error('[TTS] Edge TTS synthesis failed:', e);
                return; // 解码/上下文错误不重试（避免循环）
            }
        }
    }
}

// ===== 截屏并更新最近截图（供多模态模型直接看图）=====
// 感知哈希判断屏幕是否变化：变化才更新 base64 截图，避免重复上传相同的图。
async function captureAndAnalyze() {
    if (!window.electronAPI || !window.electronAPI.captureScreenImage) return;
    try {
        // 感知哈希：屏幕基本没变则跳过（不更新截图，避免重复传同一张图）
        const hash = await computeScreenHash();
        if (hash && lastScreenHash && hash === lastScreenHash) {
            return;
        }
        if (hash) lastScreenHash = hash;

        const b64 = await window.electronAPI.captureScreenImage();
        if (b64) {
            lastScreenImage = b64;
            lastScreenImageTime = Date.now();
            console.log('[Companion] screen image updated');
        }
    } catch (e) {
        console.warn('[Companion] 截屏更新失败:', e);
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
        prompt += `\n- ${getStatsSnapshot()}`;
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
        prompt += `\n- 你会看到当前屏幕截图，可直接依据画面内容说话。`;
        prompt += `\n- 如果真的没什么可说的，就保持安静。宁可沉默，不要没话找话。`;

        prompt += `\n\n如果你判断当前不适合说话，用 <SKIP> 回复。适合说话时用 <SPEAK>内容</SPEAK> 格式回复。`;

        console.log('[Companion] ===== AI 完整提示词 (主动说话) =====');
        console.log(prompt);
        console.log('[Companion] ===========================================');

        const reply = await callZhipu(prompt, 2, lastScreenImage || undefined);
        if (!reply) {
            isSpeaking = false;
            return; // tick 驱动下一次
        }

        console.log('[Companion] AI 主动说话回复:', reply);

        // 剥离贴图/移动指令（<STATE>/<MOVE>，桌宠贴图模式下 AI 可附加），剩余部分进入说话解析
        // 注意：clean 可能为空（AI 只回了指令）——此时三个分支都会自然跳过，仅执行指令
        const petCmds = extractPetCommands(reply);
        const replyBody = petCmds.clean;

        // 弱匹配解析 <SPEAK> 或 <SKIP>
        const speakMatch = replyBody.match(/<SPEAK>(.+?)<\/SPEAK>/i);
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
                    await updateMoodFromResponse(content);
                    // 桌宠贴图/自由移动：主回复带的标签优先，缺失的类别独立请求补齐
                    applyPetCommands(await resolvePetCommands(petCmds, '你主动说了：' + content));
                    // 说话释放无聊（表达欲满足），冲动回落
                    stats.boredom = Math.max(0, stats.boredom - 26);
                    lastTalkTick = Date.now();
                }
            }
        } else if (/<SKIP>/i.test(replyBody)) {
            console.log('[Companion] 主动说话: AI 决定跳过');
        } else {
            // 弱匹配失败：如果回复看起来像一句话（短且不含标记），当作说话内容
            const clean = replyBody.replace(/<[^>]+>/g, '').trim();
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
                    await updateMoodFromResponse(clean);
                    // 桌宠贴图/自由移动：主回复带的标签优先，缺失的类别独立请求补齐
                    applyPetCommands(await resolvePetCommands(petCmds, '你主动说了：' + clean));
                    // 与 <SPEAK> 分支一致：说话释放无聊并重置冷却，防止 10s 后连说
                    stats.boredom = Math.max(0, stats.boredom - 26);
                    lastTalkTick = Date.now();
                }
            } else {
                console.log('[Companion] 主动说话: 弱匹配无效，跳过');
            }
        }
    } catch (e) {
        console.warn('[Companion] 主动说话失败:', e);
    }

    isSpeaking = false;
    // 说话不再自循环调度：由数值 tick（tickSpeakCheck）驱动下一次
}

// ===== 调用 AI API（通过主进程代理，解决 SSL 网络问题；按当前提供商路由）=====
// imageBase64（可选）：传 data:image/jpeg;base64,... 时直接看图（本地 LLM 需视觉模型支持）。
async function callZhipu(prompt, retries = 2, imageBase64) {
    if (!isAiConfigured()) {
        console.warn('[Companion] 当前提供商 AI 凭据未配置');
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
- 你会收到当前屏幕的截图，可以"看到"画面。提到屏幕内容时自然描述即可。

说话约束：
- 有想说的就开口，没想法就简单"嗯""好喔""哈哈"，甚至直接沉默，别硬聊。
- 关心或调侃都要基于上下文自然发生，不是完成任务。
- 语气轻快口语化，常用"嘛""呀""啦""喔""诶"，但别每句都堆。
- 颜文字要挑念出来不违和的，复杂的就别用了，用语气词代替。`;

    // ===== 形象/动作控制：注入贴图与移动指令说明 =====
    let rules = companionRules;
    const cmdHints = [];
    if (spriteMode && packStates.length) {
        cmdHints.push('切换你的贴图：在回复末尾附加 <STATE>状态名</STATE>。可用状态：' + packStates.join('、'));
    }
    if (freeMove) {
        cmdHints.push(moveMode === 'gravity'
            ? '移动窗口：附加 <MOVE>方向</MOVE>（你在地面上：上=跳跃，左/右=朝该方向走，左上/右上=跳起并横移，随机=随便走走）'
            : '移动窗口：附加 <MOVE>方向</MOVE>（可选：上/下/左/右/左上/右上/左下/右下/中心/随机）');
    }
    if (cmdHints.length) {
        rules += '\n\n形象与动作控制（可选，按情境自然使用，不要每句都用）：\n- ' +
            cmdHints.join('\n- ') + '\n- 标记都会被剥离，不会被朗读。';
    }
    // ===== 缓存友好的系统提示 =====
    // system 完全静态（人设+规则，一字不动），保证智谱前缀缓存命中；
    // 所有动态信息（时间/屏幕/摘要/历史/思考）由调用方拼进 user prompt。
    const systemPrompt = `${corePersona}\n\n${rules}`;

    console.log('[Companion] ===== callZhipu systemPrompt =====');
    console.log(systemPrompt);
    console.log('[Companion] ===================================');

    // 构建 user 消息：文字 + 可选图片块（多模态直接看图）
    const userContent = imageBase64
        ? [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageBase64 } }
        ]
        : prompt;
    const model = companionModel(); // 按当前提供商选模型（智谱 GLM / 本地 LLM / DeepSeek）

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const result = await window.electronAPI.aiChatRequest({
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userContent }
                ],
                // 陪伴对话：显式声明 mode=companion，主进程据此构造
                // 「陪伴模型 → 本提供商备选 → 其它已配置提供商」候选链，
                // 繁忙自动重试、失败自动回退（本函数外层的 retries 是最后一道保险）
                mode: 'companion',
                model: model,
                // maxTokens 需容纳 thinking 模型的思考开销（视觉思考更长，实测可达 300+ token），
                // 过小时思考占满预算导致正文为空（空正文已由主进程判定失败并自动换备选模型）
                maxTokens: 512,
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

// ===== 根据最后一句话切换立绘（由 API 完成判断）=====
// 调用智谱判断这句话对应的心情，再映射到当前贴图包实际存在的 mood；
// API 不可用 / 失败时退回本地数值映射，保证立绘仍能切换。
async function updateMoodFromResponse(text) {
    const txt = (text || '').trim();
    // 1) 优先：AI 判断心情（一次性轻量请求，maxTokens 极小）
    if (isAiConfigured() && window.electronAPI && window.electronAPI.aiChatRequest) {
        try {
            const moodNames = MOOD_LIST.join('、');
            const r = await window.electronAPI.aiChatRequest({
                messages: [
                    { role: 'system', content: `你是桌宠的心情判断器。根据用户/桌宠最近一句话的语气和内容，从可选心情中选出最贴合的一个。只输出心情名称，不要任何其他文字或标点。\n可选心情：${moodNames}` },
                    { role: 'user', content: txt ? `这句话："${txt}"` : '当前没有说话内容，凭状态给出一个默认心情。' }
                ],
                mode: 'companion',
                model: companionModel(), // 按当前提供商选模型
                maxTokens: 8,
                temperature: 0.3
            });
            const ans = r && r.choices && r.choices[0] && r.choices[0].message
                ? String(r.choices[0].message.content || '').trim()
                : '';
            if (ans) {
                // 输出可能带括号/多余文字：逐个 mood 匹配
                const hit = MOOD_LIST.find(m => ans.includes(m));
                if (hit) {
                    console.log('[Companion] 立绘切换(AI):', hit);
                    return setMoodSafe(hit);
                }
            }
        } catch (e) {
            console.warn('[Companion] 立绘 AI 判断失败，回退本地映射:', e.message);
        }
    }

    // 2) 回退：本地数值映射（保持立绘可切换）
    let want = '';
    if (/困|累|睡|哈欠/.test(txt)) want = '难过';
    if (/哈|嘻|开心|好玩|可爱/.test(txt)) want = '兴奋';
    if (/？|什么|为啥|怎么回事/.test(txt)) want = '好奇';
    if (/嗯|哦|好呀/.test(txt)) want = '鼓励';
    if (!want) {
        if (stats.energy < 25) want = '难过';      // 困倦
        else if (stats.boredom > 70) want = '无语'; // 无聊
        else if (stats.novelty > 75) want = '好奇'; // 新奇
        else if (stats.affection > 70) want = '撒娇'; // 亲昵
        else if (stats.energy < 45) want = '害羞';
    }
    if (want) return setMoodSafe(matchMoodAvailable(want));
    return setMoodSafe(matchMoodAvailable('鼓励'));
}

// 将期望情感映射到当前贴图包实际存在的 mood：存在即用，否则取 MOOD_LIST 中最近的一个。
function matchMoodAvailable(want) {
    if (MOOD_LIST.includes(want)) return want;
    // 语义近义映射 → 贴图包常见 mood 名（mood_*.png）
    const nearest = {
        '开心': '兴奋', '快乐': '兴奋', '好奇': '好奇', '惊讶': '兴奋',
        '难过': '难过', '伤心': '难过', '生气': '生气', '愤怒': '生气',
        '无语': '无语', '撒娇': '撒娇', '害羞': '害羞', '鼓励': '鼓励'
    };
    if (nearest[want] && MOOD_LIST.includes(nearest[want])) return nearest[want];
    // 最终回退：取 MOOD_LIST 第一个存在项
    if (MOOD_LIST.length > 0) return MOOD_LIST[0];
    return '鼓励';
}
function setMoodSafe(m) {
    if (MOOD_LIST.includes(m)) {
        console.log('[Companion] 立绘切换:', m);
        setMood(m);
        return m;
    }
    return null;
}

// ===== 添加对话记录（懒压缩：超过硬上限且新增占比高才 AI 总结，否则只丢旧）=====
let dialogsSinceCompress = 0;
function addDialog(dialog) {
    recentDialogs.push(dialog);
    dialogCount++;
    dialogsSinceCompress++;

    if (recentDialogs.length >= DIALOG_HARD_MAX) {
        // 到硬上限：新增占比足够才 AI 总结（保留缓存命中的历史）；否则只丢最早 10 条
        const ratio = dialogsSinceCompress / recentDialogs.length;
        if (ratio >= DIALOG_COMPRESS_RATIO) {
            compressDialogs();
        } else {
            recentDialogs = recentDialogs.slice(-10);
            dialogsSinceCompress = 0;
        }
    }
}

// ===== 压缩对话（AI 总结老记录一次，保留近期） =====
async function compressDialogs() {
    if (recentDialogs.length === 0) return;

    // 压缩最近 HARD_MAX 条（缓存命中窗口），保留末尾 8 条 + 摘要
    const keepTail = 8;
    const toCompress = recentDialogs.slice(0, recentDialogs.length - keepTail);
    const tail = recentDialogs.slice(-keepTail);
    const text = toCompress.map(d =>
        `${d.role === 'user' ? '用户' : '桌宠'}: ${d.content}`
    ).join('\n');

    // 有 AI 凭据才 AI 总结；否则本地拼接摘要，绝不重复调 API
    if (isAiConfigured() && window.electronAPI && window.electronAPI.aiChatRequest && toCompress.length > 0) {
        try {
            const result = await window.electronAPI.aiChatRequest({
                messages: [
                    { role: 'system', content: '请用一句话总结以下对话的核心内容（不超过50字）。' },
                    { role: 'user', content: text }
                ],
                mode: 'companion',
                model: companionModel(), // 按当前提供商选模型
                maxTokens: 60,
                temperature: 0.5
            });
            let summary = '对话摘要生成失败';
            if (result.choices && result.choices.length > 0) {
                summary = result.choices[0].message.content.trim();
            }
            conversationSummary = summary;
            recentDialogs = tail.concat([{
                role: 'system',
                content: `[对话摘要] ${summary}`,
                time: Date.now()
            }]);
            console.log('[Companion] 对话已压缩:', summary);
            dialogsSinceCompress = 0;
            return;
        } catch (e) {
            console.warn('[Companion] 压缩对话失败:', e.message);
        }
    }

    // 本地兜底：取最近 3 条拼接
    const summary = tail.slice(-3).map(d => d.content).join('；');
    conversationSummary = summary;
    recentDialogs = tail.concat([{
        role: 'system',
        content: `[对话摘要] ${summary}`,
        time: Date.now()
    }]);
    dialogsSinceCompress = 0;
}

// ===== 主动说话调度（tick 驱动，替代原随机间隔 scheduleSpeak）=====
// 说话时机全由数值 tick（startTicks → tickSpeakCheck）决定：
// 本地冲动 ≥ 阈值 + 冷却 OK + 非录音 才调用 AI 裁决 <SPEAK>/<SKIP>。
function scheduleSpeak() {
    // 保留壳函数：若录音暂停依赖，任何调用都被 tick 主导，不做自循环
}

// Pause proactive speaking (called during recording)：仅阻止 AI 说话，数值 tick 继续
function pauseSpeak() {
    clearTimeout(speakTimer);
    speakTimer = null;
    console.log('[Companion] Proactive speaking paused (recording)');
}

// Resume proactive speaking (called after recording ends)
function resumeSpeak() {
    console.log('[Companion] Proactive speaking resumed');
    // tick 引擎仍在运行，无需手动唤醒
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
    movePauseReason.recording = true; // 录音期间暂停自由移动

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
    movePauseReason.recording = false; // 恢复自由移动
    // 录音期间引擎可能已退出循环：重力模式重新落回地面，游荡模式重新调度
    if (freeMove && !stepping && !throwing) {
        if (moveMode === 'gravity') throwWithParabola(0, 0);
        else scheduleWander(1500);
    }

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
    startTicks(); // 数值 tick 引擎（驱动说话/思考/冲动）
    if (config.companionFreeMove) startFreeMove(); // 窗口自由移动（复用桌宠重力/游荡）
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
    console.log('[Companion] companion started (active=' + active + ', thoughtFreq=' + config.companionThoughtFreq + ', screenSens=' + config.companionScreenSensitivity + ')');
}

function stopCompanion() {
    active = false;
    console.log('[Companion] companion stopping...');
    // Safety net: ensure recording resources are released
    if (isRecording) {
        stopContinuousRecording();
    }
    clearTimeout(speakTimer);
    clearInterval(screenCaptureTimer);
    stopTicks();
    stopFreeMove(); // 停止窗口自由移动
    screenHistory = [];
    recentDialogs = [];
    conversationSummary = '';
    dialogCount = 0;
    console.log('[Companion] companion stopped, data cleared');
}

// ===== Drag window (by dragging the pet image) =====
let isDragging = false;
let dragStartX = 0, dragStartY = 0;
let windowStartX = 0, windowStartY = 0;

container.addEventListener('mousedown', (e) => {
    if (e.target.closest('.ctrl-btn')) return;
    isDragging = true;
    movePauseReason.drag = true; // 拖拽期间暂停自由移动引擎
    dragStartX = e.screenX;
    dragStartY = e.screenY;
    // 拖拽速度采样复位（与 float.js 相同，mouseup 时按此速度抛出）
    dragVelX = 0; dragVelY = 0;
    lastDragX = e.screenX; lastDragY = e.screenY;
    lastDragTime = performance.now();
    if (window.electronAPI) {
        const pos = window.electronAPI.getWindowPos();
        windowStartX = pos ? pos[0] : 0;
        windowStartY = pos ? pos[1] : 0;
    }
});

document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.screenX - dragStartX;
    const dy = e.screenY - dragStartY;
    if (window.electronAPI) {
        window.electronAPI.moveCompanionWindow(windowStartX + dx, windowStartY + dy);
    }
    // 记录拖拽速度（与 float.js 相同：位移/时间差）
    const now = performance.now();
    const dt = now - lastDragTime;
    if (dt > 0) {
        dragVelX = (e.screenX - lastDragX) / dt;
        dragVelY = (e.screenY - lastDragY) / dt;
    }
    lastDragX = e.screenX; lastDragY = e.screenY; lastDragTime = now;
});

document.addEventListener('mouseup', () => {
    if (isDragging) {
        movePauseReason.drag = false;
        if (freeMove) {
            // 同步引擎位置到松手处（与 float.js 一致：从窗口真实位置出发）
            if (window.electronAPI && window.electronAPI.getWindowPos) {
                const p = window.electronAPI.getWindowPos();
                if (p) { mvX = p[0]; mvY = p[1]; }
            }
            if (moveMode === 'gravity') {
                throwWithParabola(dragVelX, dragVelY); // 复刻 float.js：按拖拽速度抛物线抛出
            } else {
                scheduleWander(3000); // 游荡模式：停 3s 后继续游荡（与 float.js 相同）
            }
        }
    }
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

document.getElementById('backToPetBtn').addEventListener('click', () => {
    if (window.electronAPI) {
        stopContinuousRecording();
        stopCompanion();
        window.electronAPI.exitCompanionMode('pet');
    }
});

// 💭 测试思考：按下立即请求 API 生成一句思考，验证思考链路与气泡显示
document.getElementById('testThinkBtn').addEventListener('click', () => {
    console.log('[Companion] test-think pressed');
    runOneThought();
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

    // 互动反馈：释放无聊（表达欲满足）、提升好感、屏幕新鲜度略增
    stats.boredom = Math.max(0, stats.boredom - 20);
    stats.affection = Math.min(100, stats.affection + 1.5);
    stats.novelty = Math.min(90, stats.novelty + 5);
    lastActivityTick = Date.now();
    idleNoOpTicks = 0;

    const screenContext = getScreenContext();
    const now = new Date();
    const timeStr = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;

    let prompt = `【对话】\n用户说：${text}`;
    prompt += `\n\n【当前情境】\n- 当前时间：${timeStr}`;
    prompt += `\n- ${getStatsSnapshot()}`;
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
    // 最近思考（自言自语）：思考内容进入对话上下文，影响回复
    if (lastThoughtTime > 0 && timeSince(lastThoughtTime) < 10 * 60 * 1000) {
        prompt += `\n- 你刚才在心里想的：${lastThought}`;
    }
    prompt += `\n\n【要求】`;
    prompt += `\n你的话会被直接朗读，禁止任何动作描写、旁白或括注。`;
    prompt += `\n- 主人的消息可能是语音转文字，会有识别错误或口语化表达，自然理解就好。`;
    prompt += `\n- 你会看到当前屏幕截图，可直接依据画面内容回应。`;
    prompt += `\n- 有想说的就开口，没想法就简单"嗯""好喔""哈哈"，别硬聊。`;
    prompt += `\n- 关心或调侃都要基于上下文自然发生，不是完成任务。`;
    prompt += `\n- 语气轻快口语化，但别每句都堆语气词。`;
    prompt += `\n- 颜文字要挑念出来不违和的，复杂的就别用了。`;

    console.log('[Companion] ===== AI 完整提示词 (用户回复) =====');
    console.log(prompt);
    console.log('[Companion] ===========================================');

    const reply = await callZhipu(prompt, 2, lastScreenImage || undefined);
    if (reply) {
        // 剥离贴图/移动指令（桌宠贴图模式下 AI 可附加），剩余部分朗读/显示
        const petCmds = extractPetCommands(reply);
        const body = petCmds.clean;
        if (body) {
            showSpeech(body);
            if (config.voiceEnabled) speakText(body);
            addDialog({ role: 'assistant', content: body, time: Date.now() });
            // 记录到近期说过的话
            recentSpeeches.push(body);
            if (recentSpeeches.length > 10) recentSpeeches.shift();
            await updateMoodFromResponse(body);
        }
        if (petCmds.state || petCmds.move || body) {
            // 有正文或有标签都走统一入口：主回复标签优先，缺失类别独立请求补齐
            // （纯正文无标签也会触发独立请求；两条都缺才提示网络问题）
            const cmds = await resolvePetCommands(petCmds, '主人对你说：' + text + '，你回复了：' + body);
            if (cmds.state || cmds.move) applyPetCommands(cmds);
            else if (!body) showSpeech('网络好像有点慢，请稍后再试', 3000);
        } else {
            showSpeech('网络好像有点慢，请稍后再试', 3000);
        }
    } else {
        showSpeech('网络好像有点慢，请稍后再试', 3000);
    }
}

// ===== Start =====
startCompanion();