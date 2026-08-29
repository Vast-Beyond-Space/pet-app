const pet = document.getElementById('pet');
const petImg = document.getElementById('petImg');
const speech = document.getElementById('speech');
const statusHint = document.getElementById('statusHint');
const roomIndicator = document.getElementById('roomIndicator');
const apiKeyInput = document.getElementById('apiKeyInput');
const apiUrlInput = document.getElementById('apiUrlInput');
const aiDecideToggle = document.getElementById('aiDecideToggle');
const buttonSizeSlider = document.getElementById('buttonSizeSlider');
const portraitToggle = document.getElementById('portraitToggle');
const devModeToggle = document.getElementById('devModeToggle');
const devHint = document.getElementById('devHint');
const chatBtn = document.getElementById('chatBtn');
const chatPanel = document.getElementById('chatPanel');
const chatIllust = document.getElementById('chatIllust');
const illustImg = document.getElementById('illustImg');
const illustMood = document.getElementById('illustMood');
const closeChat = document.getElementById('closeChat');
const inputText = document.getElementById('inputText');
const sendBtn = document.getElementById('sendBtn');
const chatLog = document.getElementById('chatLog');
const activityText = document.getElementById('activityText');
const house = document.getElementById('house');

const aiPromptInput = document.getElementById('aiPromptInput');
const devSection = document.getElementById('devSection');
const memoryToggle = document.getElementById('memoryToggle');
const memoryList = document.getElementById('memoryList');
const memoryHint = document.getElementById('memoryHint');
const addMemoryBtn = document.getElementById('addMemoryBtn');
const memoryModal = document.getElementById('memoryModal');
const memoryModalInput = document.getElementById('memoryModalInput');
const memoryModalCancel = document.getElementById('memoryModalCancel');
const memoryModalConfirm = document.getElementById('memoryModalConfirm');

const saveGameBtn = document.getElementById('saveGameBtn');
const loadGameBtn = document.getElementById('loadGameBtn');
const exportSaveBtn = document.getElementById('exportSaveBtn');
const importSaveBtn = document.getElementById('importSaveBtn');
const saveTimeDisplay = document.getElementById('saveTimeDisplay');

const goBedroomBtn = document.getElementById('goBedroomBtn');
const goBathroomBtn = document.getElementById('goBathroomBtn');
const toiletBtn = document.getElementById('toiletBtn');
const goLivingBtn = document.getElementById('goLivingBtn');
const feedBtn = document.getElementById('feedBtn');
const watchTvBtn = document.getElementById('watchTvBtn');

const hungerFill = document.getElementById('hungerFill');
const hungerValue = document.getElementById('hungerValue');
const happinessFill = document.getElementById('happinessFill');
const happinessValue = document.getElementById('happinessValue');
const energyFill = document.getElementById('energyFill');
const energyValue = document.getElementById('energyValue');
const hygieneFill = document.getElementById('hygieneFill');
const hygieneValue = document.getElementById('hygieneValue');
const boredomFill = document.getElementById('boredomFill');
const boredomValue = document.getElementById('boredomValue');

const affectionFill = document.getElementById('affectionFill');
const affectionValue = document.getElementById('affectionValue');

const statsEditSection = document.getElementById('statsEditSection');
const applyStatsBtn = document.getElementById('applyStatsBtn');

const mainPetSizeSlider = document.getElementById('mainPetSizeSlider');
const mainPetSizeValue = document.getElementById('mainPetSizeValue');
const floatPetSizeSlider = document.getElementById('floatPetSizeSlider');
const floatPetSizeValue = document.getElementById('floatPetSizeValue');
const floatMoveModeSelect = document.getElementById('floatMoveModeSelect');
const bounceWindowsToggle = document.getElementById('bounceWindowsToggle');
const cookieSpawnToggle = document.getElementById('cookieSpawnToggle');
const floatShowIllustToggle = document.getElementById('floatShowIllustToggle');
const furnitureSizeSlider = document.getElementById('furnitureSizeSlider');
const furnitureSizeValue = document.getElementById('furnitureSizeValue');
const windowOpacitySlider = document.getElementById('windowOpacitySlider');
const windowOpacityValue = document.getElementById('windowOpacityValue');
const wallOpacitySlider = document.getElementById('wallOpacitySlider');
const wallOpacityValue = document.getElementById('wallOpacityValue');
const floorOpacitySlider = document.getElementById('floorOpacitySlider');
const floorOpacityValue = document.getElementById('floorOpacityValue');

const editHouseBtn = document.getElementById('editHouseBtn');

let config = {
    apiKey: '',
    apiUrl: 'https://api.deepseek.com/v1/chat/completions',
    aiDecide: false,
    buttonSize: 40,
    portraitAuto: true,
    portraitMode: false,
    devMode: false,
    mainPetSize: 7.5,
    floatPetSize: 80,
    furnitureSize: 3.8,
    floatMoveMode: 'free',
    bounceWindows: false,
    floatShowIllust: true,
    gridCellSize: 0,
    gridViewMode: 'diamond',
    windowOpacity: 1,
    wallOpacity: 1,
    floorOpacity: 1,
    aiPrompt: '你是一个可爱的桌宠小鲸鱼，性格活泼可爱。请用简短可爱的语气回复，不要超过30字。\n\n【心情标记格式】\n在回复末尾，你必须使用以下格式标记你当前的心情：<MOOD:心情>\n可选心情：鼓励、害羞、好奇、惊讶、难过、撒娇、生气、无语、兴奋\n选择依据：根据你当前的状态和对话内容选择最贴切的心情，而不是随机选择。\n例如：<MOOD:害羞>\n注意：心情标记只出现在回复末尾，不要出现在正文对话中。\n\n【行为指令格式】\n如果用户要求你去某个房间或做某件具体的事，请在回复末尾使用以下格式输出指令：<CMD:指令>\n可用指令：去客厅、去卧室、去厨房、去卫生间、去阳台、吃饭、睡觉、洗澡、上厕所、看电视\n例如：<CMD:去卧室>\n注意：指令标记只出现在回复末尾，不要出现在正文对话中。\n\n【好感度标记格式】\n在回复末尾，你还必须使用以下格式标记你当前对用户的好感度数值（0-100，取整数）：<AFFECTION:数值>\n数值参考：你的当前好感度会在对话开始前由系统告知。若未告知，请合理推断（一般随互动增多而上升）。\n例如：<AFFECTION:72>',
    enableMemory: false,
    behaviorLogMax: 50,
    cookieSize: 40,
    cookieSpawnEnabled: true,
    behaviorKeepProb: 60,
    zhipuApiKey: '',
    multimodalEnabled: false,
    multimodalProvider: 'deepseek',
    zhipuApiUrl: '',
    selectedVoice: 'default',
    voiceEnabled: true,
    voiceAutoSend: true,
    voiceVolume: 1.0,
    companionWidth: 400,
    companionHeight: 350,
    companionFontSize: 14,
    companionPetSize: 180,
    stickerPack: '默认'
};

// ===== 贴图路径辅助函数 =====
// 所有贴图引用统一使用此函数：imgPath('pet.png') → 'img/默认/pet.png'
function imgPath(filename) {
    return 'img/' + (config.stickerPack || '默认') + '/' + filename;
}

let memoryItems = [];
let behaviorLog = [];

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

let petX = 0;
let petY = 0;
let petWidth = 55;
let petHeight = 55;

let isDragging = false;
let startX = 0;
let startY = 0;

let isWindowMinimized = false;

function shouldPausePetActivity() {
    return chatPanel.classList.contains('show') || isWindowMinimized;
}

let isMoving = false;
let targetX = 0;
let targetY = 0;
let moveSpeed = 1.2; // 固定移动速度，不随窗口缩放变化
// 移动循环用 requestAnimationFrame 驱动（代替 setInterval），与屏幕刷新同步，更平滑。
// RAF 在主线程阻塞时自然暂停（不积压回调），从根上消除了 setInterval 积压导致跳跃的问题。
let moveRAF = null;
// 固定步进周期：保持与原 setInterval(30ms) 一致的移动速度。
const MOVE_STEP_MS = 30;
let pathIndex = 0;
let currentPath = [];
let lastPetX = 0;
// z-index 更新节流：桌宠移动时每 zIndexUpdateInterval 步才更新一次遮挡关系，
// 而非每步都调用 updatePetZIndex。墙面/家具位置在移动期间不变，频繁更新 z-index
// 既无视觉收益又每帧触发一次样式写，节流后可显著降低主线程压力。
let petMoveStepCount = 0;
const Z_INDEX_UPDATE_INTERVAL = 5;
// 房间缓存：记录桌宠当前所在房间，仅当房间变化时才更新指示器 DOM。
// 每步都调用 updateCurrentRoom 会每 30ms 写一次 textContent/style（即使房间未变），
// 造成不必要的样式重算。缓存后房间未变时直接返回，避免无谓 DOM 写。
let lastRoomId = null;

// 拖动后 30 秒冷却，期间不自动移动
let lastDragTime = 0;
const DRAG_COOLDOWN_MS = 30000;
let dragSavedFlip = false;

// 拖动单摆旋转相关状态
let pendulumAngle = 0;
let pendulumVel = 0;
let pendulumTarget = 0;
let pendulumRAF = null;
let lastMouseClientX = 0;
let lastMouseTime = 0;
const ORIGINAL_PET_SRC = () => imgPath('pet.png');
const DRAG_PET_SRC = () => imgPath('被拖动.png');

let furnitureRects = [];
let roomRects = {};
let wallRects = [];

// 网格布局相关变量（由 grid-system.js 提供数据模型）
let gridCellSize = 30;
let gridOffsetX = 0;
let gridOffsetY = 0;

let statusHintTimeout = null;
let lastStats = { ...stats };
let playCount = 0; // 追踪连续玩耍次数，用于递减效果

// 随机事件系统
const randomEvents = [
    {
        name: 'trip',
        messages: ['哎呀，摔了一跤...', '呜呜，好痛...', '走路不小心摔倒了...'],
        happinessChange: -15,
        emoji: '😣'
    },
    {
        name: 'scared',
        messages: ['呜哇！吓我一跳！', '哎呀！什么东西突然响了...', '呜呜，被吓到了...'],
        happinessChange: -12,
        emoji: '😨'
    },
    {
        name: 'wet',
        messages: ['呜呜，衣服被水打湿了...', '不小心把水弄身上了...', '湿漉漉的不舒服...'],
        happinessChange: -10,
        emoji: '💧',
        rooms: ['bathroom', 'laundry']
    },
    {
        name: 'tv_ads',
        messages: ['电视怎么一直放广告...', '又是广告，好无聊...', '想看的节目还没开始...'],
        happinessChange: -8,
        emoji: '📺',
        rooms: ['living']
    },
    {
        name: 'hungry_accident',
        messages: ['肚子咕咕叫...', '好饿啊...', '想吃零食了...'],
        happinessChange: -5,
        emoji: '😋'
    },
    {
        name: 'found_toy',
        messages: ['发现了好玩的玩具！', '这个玩具好有趣~', '我要玩这个！'],
        happinessChange: 15,
        boredomChange: -15,
        emoji: '🧸',
        rooms: ['living', 'bedroom']
    },
    {
        name: 'sunshine',
        messages: ['阳光好温暖~', '晒太阳好舒服~', '今天天气真好！'],
        happinessChange: 10,
        emoji: '☀️',
        rooms: ['laundry', 'living']
    },
    {
        name: 'daydream',
        messages: ['做了个好梦~', '梦见好吃的了！', '好开心的梦~'],
        happinessChange: 8,
        emoji: '💭',
        rooms: ['bedroom']
    },
    {
        name: 'dance',
        messages: ['跳个舞~', '心情真好！', '啦啦啦~'],
        happinessChange: 12,
        boredomChange: -10,
        emoji: '💃',
        rooms: ['living']
    },
    {
        name: 'sing',
        messages: ['哼个小曲~', '啦啦啦~', '唱歌真开心！'],
        happinessChange: 10,
        boredomChange: -8,
        emoji: '🎵'
    }
];

let lastRandomEventTime = 0;
const randomEventInterval = 60000; // 每分钟检查一次随机事件
const randomEventChance = 0.25; // 25%概率触发

function checkRandomEvent() {
    const now = Date.now();
    if (now - lastRandomEventTime < randomEventInterval) return;

    lastRandomEventTime = now;

    if (Math.random() < randomEventChance) {
        triggerRandomEvent();
    }
}

function triggerRandomEvent() {
    const currentRoom = updateCurrentRoom();
    const availableEvents = randomEvents.filter(e => !e.rooms || (currentRoom && e.rooms.includes(currentRoom)));
    if (availableEvents.length === 0) return;

    const event = availableEvents[Math.floor(Math.random() * availableEvents.length)];
    const message = event.messages[Math.floor(Math.random() * event.messages.length)];

    stats.happiness = Math.max(0, stats.happiness + event.happinessChange);
    if (event.boredomChange) {
        stats.boredom = Math.max(0, stats.boredom + event.boredomChange);
    }
    updateStatsDisplay();

    const happySign = event.happinessChange > 0 ? '+' : '';
    let hintText = `${event.emoji} ${message} (快乐${happySign}${event.happinessChange})`;
    if (event.boredomChange) {
        const boredomSign = event.boredomChange > 0 ? '+' : '';
        hintText += ` (无聊${boredomSign}${event.boredomChange})`;
    }
    showStatusHint(hintText);
    showMessage(message);

    // 记录到行为日志
    logBehavior(`遭遇随机事件: ${event.name}`);
}

const roomNames = {
    living: '客厅',
    bedroom: '卧室',
    kitchen: '厨房',
    bathroom: '卫生间',
    laundry: '阳台'
};

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

const moodList = Object.keys(moodEmojis);

async function loadConfig() {
    const saved = localStorage.getItem('petConfig');
    if (saved) {
        try {
            config = { ...config, ...JSON.parse(saved) };
        } catch (e) {}
    }
    // 先从主进程拉取权威配置（float/index/设置窗口共用同一套），
    // 合并完成后再 applyConfig。applyConfig 会把 floatPetSize / 移动模式 / 是否生成饼干
    // 以及 API Key 等同步到浮窗并刷新 UI；若在此前就 apply，会把这些设置回退成
    // "默认值 + 本地缓存"（往往是旧的/空的），导致一打开 index 就把 float 的设置改回默认。
    if (window.electronAPI && window.electronAPI.getConfig) {
        const unified = await window.electronAPI.getConfig().catch(() => null);
        if (unified && typeof unified === 'object') {
            config = { ...config, ...unified };
            localStorage.setItem('petConfig', JSON.stringify(config));
        }
    }
    applyConfig();
}

function saveConfig() {
    localStorage.setItem('petConfig', JSON.stringify(config));
    applyConfig();
    // 同步到主进程统一配置中枢并广播给其它窗口（float/设置窗口共用同一套设置）
    if (window.electronAPI && window.electronAPI.syncConfig) {
        window.electronAPI.syncConfig(config);
    }
}

function applyConfig() {
    apiKeyInput.value = config.apiKey;
    apiUrlInput.value = config.apiUrl;
    aiDecideToggle.checked = config.aiDecide;
    buttonSizeSlider.value = config.buttonSize;
    portraitToggle.checked = config.portraitAuto;
    devModeToggle.checked = config.devMode;
    aiPromptInput.value = config.aiPrompt;
    memoryToggle.checked = config.enableMemory;

    mainPetSizeSlider.value = config.mainPetSize;
    mainPetSizeValue.textContent = config.mainPetSize;
    floatPetSizeSlider.value = config.floatPetSize;
    floatPetSizeValue.textContent = config.floatPetSize;
    if (floatMoveModeSelect) floatMoveModeSelect.value = config.floatMoveMode || 'free';
    if (bounceWindowsToggle) bounceWindowsToggle.checked = config.bounceWindows || false;
    if (cookieSpawnToggle) cookieSpawnToggle.checked = config.cookieSpawnEnabled !== false;
    if (floatShowIllustToggle) floatShowIllustToggle.checked = config.floatShowIllust || true;
    furnitureSizeSlider.value = config.furnitureSize;
    furnitureSizeValue.textContent = config.furnitureSize;
    // 饼干大小
    if (cookieSizeSlider) {
        cookieSizeSlider.value = config.cookieSize || 40;
        cookieSizeValue.textContent = config.cookieSize || 40;
    }
    // 陪伴模式设置
    const companionWidthSlider = document.getElementById('companionWidthSlider');
    const companionWidthValue = document.getElementById('companionWidthValue');
    const companionHeightSlider = document.getElementById('companionHeightSlider');
    const companionHeightValue = document.getElementById('companionHeightValue');
    const companionFontSizeSlider = document.getElementById('companionFontSizeSlider');
    const companionFontSizeValue = document.getElementById('companionFontSizeValue');
    const companionPetSizeSlider = document.getElementById('companionPetSizeSlider');
    const companionPetSizeValue = document.getElementById('companionPetSizeValue');
    if (companionWidthSlider) {
        companionWidthSlider.value = config.companionWidth || 400;
        if (companionWidthValue) companionWidthValue.textContent = config.companionWidth || 400;
    }
    if (companionHeightSlider) {
        companionHeightSlider.value = config.companionHeight || 350;
        if (companionHeightValue) companionHeightValue.textContent = config.companionHeight || 350;
    }
    if (companionFontSizeSlider) {
        companionFontSizeSlider.value = config.companionFontSize || 14;
        if (companionFontSizeValue) companionFontSizeValue.textContent = config.companionFontSize || 14;
    }
    if (companionPetSizeSlider) {
        companionPetSizeSlider.value = config.companionPetSize || 180;
        if (companionPetSizeValue) companionPetSizeValue.textContent = config.companionPetSize || 180;
    }
    // 行为保持概率
    if (behaviorKeepProbSlider) {
        behaviorKeepProbSlider.value = config.behaviorKeepProb !== undefined ? config.behaviorKeepProb : 60;
        behaviorKeepProbValue.textContent = (config.behaviorKeepProb !== undefined ? config.behaviorKeepProb : 60) + '%';
    }
    // 房屋显示模式固定为菱形网格
    config.gridViewMode = 'diamond';
    // 注意：透明度可能为 0（完全透明），不能用 `|| 1`，否则保存的 0 在重载后显示为 100%。
    // 用 `!= null` 判断：仅在未设置时回退到 1，0 视为有效值。
    const winOp = (config.windowOpacity != null) ? config.windowOpacity : 1;
    const wallOp = (config.wallOpacity != null) ? config.wallOpacity : 1;
    const floorOp = (config.floorOpacity != null) ? config.floorOpacity : 1;
    if (windowOpacitySlider) {
        windowOpacitySlider.value = Math.round(winOp * 100);
        windowOpacityValue.textContent = Math.round(winOp * 100) + '%';
    }
    if (wallOpacitySlider) {
        wallOpacitySlider.value = Math.round(wallOp * 100);
        wallOpacityValue.textContent = Math.round(wallOp * 100) + '%';
    }
    if (floorOpacitySlider) {
        floorOpacitySlider.value = Math.round(floorOp * 100);
        floorOpacityValue.textContent = Math.round(floorOp * 100) + '%';
    }
    document.documentElement.style.setProperty('--wall-opacity', config.wallOpacity != null ? config.wallOpacity : 1);
    document.documentElement.style.setProperty('--floor-opacity', config.floorOpacity != null ? config.floorOpacity : 1);
    document.documentElement.style.setProperty('--window-opacity', config.windowOpacity != null ? config.windowOpacity : 1);

    // 语音设置
    const voiceToggle = document.getElementById('voiceToggle');
    const voiceAutoSendToggle = document.getElementById('voiceAutoSendToggle');
    const voiceSelect = document.getElementById('voiceSelect');
    const voiceVolumeSlider = document.getElementById('voiceVolumeSlider');
    const voiceVolumeValue = document.getElementById('voiceVolumeValue');
    if (voiceToggle) voiceToggle.checked = config.voiceEnabled !== false;
    if (voiceAutoSendToggle) voiceAutoSendToggle.checked = config.voiceAutoSend !== false;
    if (voiceSelect && config.selectedVoice) voiceSelect.value = config.selectedVoice;
    if (voiceVolumeSlider) {
        voiceVolumeSlider.value = Math.round((config.voiceVolume != null ? config.voiceVolume : 1) * 100);
        if (voiceVolumeValue) voiceVolumeValue.textContent = Math.round((config.voiceVolume != null ? config.voiceVolume : 1) * 100) + '%';
    }

    // 透明度应用由主进程统一负责（config-sync / sync-home-settings 中 windowOpacity
    // 变化时 setOpacity）。此处不再写 IPC：applyConfig 是被动刷新路径，只允许纯 UI 更新，
    // 避免"收到广播 -> applyConfig -> 又写主进程"的副作用与回声。

    updateButtonSize(config.buttonSize);
    applySizeSettings();
    // 应用贴图包
    window._stickerPack = config.stickerPack || '默认';
    if (petImg) petImg.src = imgPath('pet.png');
    if (illustImg) illustImg.src = imgPath('pet.png');
    checkPortraitMode();
    toggleDevMode(config.devMode);
    restorePersonaTags();
    // 多模态配置
    const multimodalToggle = document.getElementById('multimodalToggle');
    const multimodalProviderSelect = document.getElementById('multimodalProviderSelect');
    const zhipuApiKeyInput = document.getElementById('zhipuApiKeyInput');
    const zhipuApiUrlInput = document.getElementById('zhipuApiUrlInput');
    if (multimodalToggle) multimodalToggle.checked = config.multimodalEnabled;
    if (multimodalProviderSelect) multimodalProviderSelect.value = config.multimodalProvider || 'deepseek';
    if (zhipuApiKeyInput) zhipuApiKeyInput.value = config.zhipuApiKey || '';
    if (zhipuApiUrlInput) zhipuApiUrlInput.value = config.zhipuApiUrl || '';
}

// 应用大小设置：主窗口桌宠、家具 emoji 使用 CSS 变量；小窗口桌宠通过 IPC 通知浮窗
function applySizeSettings() {
    document.documentElement.style.setProperty('--pet-size', config.mainPetSize + 'vmin');
    document.documentElement.style.setProperty('--furniture-size', config.furnitureSize + 'vmin');
    // 延迟更新尺寸，等 CSS 变量生效
    setTimeout(() => {
        updatePetSize();
        updateGridLayout();
        // 桌宠变大后约束位置在房屋内
        const houseRect = house.getBoundingClientRect();
        petX = Math.max(0, Math.min(houseRect.width - petWidth, petX));
        // 菱形模式下 petY 是脚部位置
        if (config.gridViewMode === 'diamond') {
            petY = Math.max(0, Math.min(houseRect.height, petY));
        } else {
            petY = Math.max(0, Math.min(houseRect.height - petHeight, petY));
        }
        if (checkCollision(petX, petY)) {
            fixPetPosition();
        }
        updatePetPosition();
    }, 50);
    // 浮窗相关字段（大小/移动模式/碰撞/生成饼干）不再由被动刷新路径写回：
    // 这些值随用户"保存设置"（applyStatsBtn -> saveConfig -> config-sync 全量）进入主进程，
    // 由主进程 config-sync 统一同步运行状态并下发浮窗；applyConfig 只负责刷新本窗口 UI。
    // 此前 applySizeSettings 在此处无条件 set-float-* IPC，会在"收到 config-updated 广播 ->
    // applyConfig -> 再写回"的链路上形成回声循环，并用兜底默认值覆盖其它窗口的设置。
}

function restorePersonaTags() {
    document.querySelectorAll('.tag-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    const basePrompt = config.aiPrompt.split('\n\n【记忆生成格式】')[0];
    const identityMatch = basePrompt.match(/你是一个可爱的桌宠(小\S+)/);
    if (identityMatch) {
        const identityBtn = document.querySelector(`.tag-btn[data-type="identity"][data-value="${identityMatch[1]}"]`);
        if (identityBtn) identityBtn.classList.add('active');
    }
    const personalityMatch = basePrompt.match(/性格(\S+)/);
    if (personalityMatch) {
        const personalityBtn = document.querySelector(`.tag-btn[data-type="personality"][data-value="${personalityMatch[1]}"]`);
        if (personalityBtn) personalityBtn.classList.add('active');
    }
    const toneMatch = basePrompt.match(/语气(\S+)/);
    if (toneMatch) {
        const toneBtn = document.querySelector(`.tag-btn[data-type="tone"][data-value="${toneMatch[1]}"]`);
        if (toneBtn) toneBtn.classList.add('active');
    }
}

function generatePersonaPrompt(identity, personality, tone) {
    return `你是一个可爱的桌宠${identity}，性格${personality}。请用${tone}的语气回复，不要超过30字。`;
}

function updateButtonSize(size) {
    const actionBtns = document.querySelectorAll('.action-btn');
    actionBtns.forEach(btn => {
        btn.style.width = size + 'px';
        btn.style.height = size + 'px';
        btn.style.fontSize = (size * 0.5) + 'px';
    });
    
    const bottomControls = document.querySelector('.bottom-controls');
    bottomControls.style.gap = (size * 0.2) + 'px';
    bottomControls.style.padding = (size * 0.2) + 'px ' + (size * 0.3) + 'px';
    
    const iconBtn = document.querySelector('.icon-btn');
    const iconBtnSize = size * 0.9;
    iconBtn.style.width = iconBtnSize + 'px';
    iconBtn.style.height = iconBtnSize + 'px';
    iconBtn.style.fontSize = (iconBtnSize * 0.5) + 'px';
    
    const roomIndicatorEl = document.querySelector('.room-indicator');
    roomIndicatorEl.style.padding = (size * 0.15) + 'px ' + (size * 0.35) + 'px';
    roomIndicatorEl.style.fontSize = (size * 0.3) + 'px';
}

function checkPortraitMode() {
    // 竖屏适配功能已移除：不再根据窗口宽高比切换竖屏布局，始终使用横屏布局
    document.body.classList.remove('portrait-mode');
    config.portraitMode = false;
    return;
}

function toggleDevMode(enabled) {
    config.devMode = enabled;
    const logMaxSection = document.getElementById('behaviorLogMaxSection');
    const programSection = document.getElementById('programSection');
    if (enabled) {
        document.body.classList.add('dev-mode');
        devHint.style.display = 'block';
        devSection.style.display = 'block';
        statsEditSection.style.display = 'block';
        if (programSection) programSection.style.display = 'block';
        if (logMaxSection) logMaxSection.style.display = 'flex';
        updateStatsEditValues();
        if (!aiHasKey()) {
            memoryHint.style.display = 'block';
        } else {
            memoryHint.style.display = 'none';
        }
        renderBehaviorLog();
        renderProgramList();
    } else {
        document.body.classList.remove('dev-mode');
        devHint.style.display = 'none';
        devSection.style.display = 'none';
        statsEditSection.style.display = 'none';
        if (programSection) programSection.style.display = 'none';
        if (logMaxSection) logMaxSection.style.display = 'none';
    }
}

function updateStatsEditValues() {
    document.querySelectorAll('.stat-slider').forEach(slider => {
        const stat = slider.dataset.stat;
        slider.value = Math.round(stats[stat]);
        const valueEl = document.getElementById(`edit${stat.charAt(0).toUpperCase() + stat.slice(1)}Value`);
        if (valueEl) {
            valueEl.textContent = Math.round(stats[stat]) + '%';
        }
    });
}

function syncStatSlider(stat) {
    const slider = document.querySelector(`.stat-slider[data-stat="${stat}"]`);
    const valueEl = document.getElementById(`edit${stat.charAt(0).toUpperCase() + stat.slice(1)}Value`);
    if (slider && valueEl) {
        valueEl.textContent = slider.value + '%';
    }
}

function adjustStat(stat, op) {
    const slider = document.querySelector(`.stat-slider[data-stat="${stat}"]`);
    if (slider) {
        let value = parseInt(slider.value);
        if (op === 'inc') {
            value = Math.min(100, value + 10);
        } else {
            value = Math.max(0, value - 10);
        }
        slider.value = value;
        syncStatSlider(stat);
    }
}

function applyStatsChanges() {
    document.querySelectorAll('.stat-slider').forEach(slider => {
        const stat = slider.dataset.stat;
        stats[stat] = parseInt(slider.value);
    });
    updateStatsDisplay();
    saveStats();
    showMessage('状态已修改！');
}

function updatePetSize() {
    const petRect = pet.getBoundingClientRect();
    petWidth = petRect.width || 55;
    petHeight = petRect.height || 55;
}

// 移动速度固定，不随窗口缩放变化；仅根据房屋高度调整弹跳高度
function updateMoveSpeed() {
    const houseRect = house.getBoundingClientRect();
    const houseW = houseRect.width || 800;
    // 以 800px 宽度为基准，等比缩放，限制范围
    const scale = Math.max(0.4, Math.min(1.6, houseW / 800));
    moveSpeed = 1.2; // 固定速度
    // 弹跳高度随房屋高度等比缩放，小窗口更小
    const hopHeight = Math.round(-6 * scale);
    pet.style.setProperty('--hop-height', hopHeight + 'px');
}
async function init() {
    await loadConfig();
    loadGrid();
    await loadMemory();
    loadStats();
    updateSaveTimeDisplay();
    renderMemoryList();
    updatePetSize();
    updateMoveSpeed();
    updateGridLayout();

    // 同步初始开发者模式和行为保持概率到浮窗
    if (window.electronAPI) {
        window.electronAPI.send('set-dev-mode', config.devMode);
        window.electronAPI.send('set-behavior-keep-prob', config.behaviorKeepProb !== undefined ? config.behaviorKeepProb : 60);
    }

    // 同步多模态配置到主进程（确保浮窗创建时能获取到已保存的值）
    if (window.electronAPI) {
        if (window.electronAPI.setZhipuKey) window.electronAPI.setZhipuKey(config.zhipuApiKey);
        if (window.electronAPI.setMultimodalEnabled) window.electronAPI.setMultimodalEnabled(config.multimodalEnabled);
    }

    // 将桌宠放到客厅的一个地板格子上（等轴测坐标）
    const livingCell = getRandomRoomCell('living');
    if (livingCell) {
        const pos = gridToScreen(livingCell.col, livingCell.row, gridCellSize, gridOffsetX, gridOffsetY, config.gridViewMode);
        // 菱形模式下，脚部对齐菱形底部（pos.y + cellSize/4）
        // 正方形模式下，脚部对齐格子中心
        if (config.gridViewMode === 'diamond') {
            petX = pos.x - petWidth / 2;
            petY = pos.y + gridCellSize / 4;
        } else {
            petX = pos.x - petWidth / 2;
            petY = pos.y - petHeight / 2;
        }
    } else {
        const houseRect = house.getBoundingClientRect();
        petX = houseRect.width / 2 - petWidth / 2;
        petY = houseRect.height / 2 - petHeight / 2;
    }
    updatePetPosition();
    updateCurrentRoom();
    updateStatsDisplay();
    updateActivityText('在客厅玩耍~');
    showPet(); // 初始阶段立即显示桌宠，避免"点击后才出现"

    // 初始化网格编辑器（在 grid-editor.js 中定义）
    if (typeof initGridEditor === 'function') {
        initGridEditor();
    }
}

async function loadMemory() {
    if (!window.electronAPI || !window.electronAPI.memoryLoad) {
        memoryItems = [];
        renderMemoryList();
        return;
    }
    try {
        const items = await window.electronAPI.memoryLoad();
        if (Array.isArray(items)) {
            memoryItems = items;
            renderMemoryList();
        }
    } catch (e) {
        memoryItems = [];
        renderMemoryList();
    }
}

async function saveMemory() {
    if (!window.electronAPI || !window.electronAPI.memorySave) return;
    try {
        await window.electronAPI.memorySave(memoryItems);
    } catch (e) {
        // 静默失败
    }
}

// 保存 stats 状态
function saveStats() {
    localStorage.setItem('petStats', JSON.stringify(stats));
}

// 加载 stats 状态
function loadStats() {
    const saved = localStorage.getItem('petStats');
    if (saved) {
        try {
            const savedStats = JSON.parse(saved);
            stats = { ...stats, ...savedStats };
        } catch (e) {}
    }
}

// 保存完整游戏存档（包含记忆和状态）
function saveGame() {
    const saveData = {
        stats: { ...stats },
        memory: [...memoryItems],
        timestamp: Date.now()
    };
    localStorage.setItem('petGameSave', JSON.stringify(saveData));
    updateSaveTimeDisplay();
    showMessage('存档成功！');
    logBehavior('保存了游戏存档');
}

// 加载完整游戏存档
function loadGame() {
    const saved = localStorage.getItem('petGameSave');
    if (!saved) {
        showMessage('没有存档！');
        return;
    }
    try {
        const saveData = JSON.parse(saved);
        stats = { ...stats, ...saveData.stats };
        memoryItems = saveData.memory || [];
        updateSaveTimeDisplay();
        updateStatsDisplay();
        renderMemoryList();
        showMessage('存档加载成功！');
        logBehavior('加载了游戏存档');
    } catch (e) {
        showMessage('存档加载失败！');
    }
}

// 导出存档（下载 JSON 文件）
function exportSave() {
    const saved = localStorage.getItem('petGameSave');
    if (!saved) {
        showMessage('没有存档可导出！');
        return;
    }
    const blob = new Blob([saved], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const now = new Date();
    const filename = `pet-save-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}.json`;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showMessage('存档已导出！');
    logBehavior('导出了游戏存档');
}

// 导入存档（上传 JSON 文件）
function importSave() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const saveData = JSON.parse(event.target.result);
                if (saveData.stats || saveData.memory) {
                    localStorage.setItem('petGameSave', JSON.stringify(saveData));
                    loadGame();
                    showMessage('存档导入成功！');
                    logBehavior('导入了游戏存档');
                } else {
                    showMessage('无效的存档文件！');
                }
            } catch (err) {
                showMessage('存档文件解析失败！');
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

// 更新存档时间显示
function updateSaveTimeDisplay() {
    const saved = localStorage.getItem('petGameSave');
    if (saved) {
        try {
            const saveData = JSON.parse(saved);
            if (saveData.timestamp) {
                const date = new Date(saveData.timestamp);
                const h = String(date.getHours()).padStart(2, '0');
                const m = String(date.getMinutes()).padStart(2, '0');
                const s = String(date.getSeconds()).padStart(2, '0');
                saveTimeDisplay.textContent = `${date.getFullYear()}/${date.getMonth()+1}/${date.getDate()} ${h}:${m}:${s}`;
                return;
            }
        } catch (e) {}
    }
    saveTimeDisplay.textContent = '-';
}

function renderMemoryList() {
    memoryList.innerHTML = '';
    
    if (memoryItems.length === 0) {
        memoryList.innerHTML = '<div style="text-align:center;color:#999;font-size:10px;padding:10px;">暂无记忆，点击下方按钮添加</div>';
        return;
    }
    
    memoryItems.forEach((item, index) => {
        const el = document.createElement('div');
        el.className = 'memory-item';
        el.innerHTML = `
            <span class="memory-text">${item.text}</span>
            <button class="delete-btn" data-index="${index}">✕</button>
        `;
        memoryList.appendChild(el);
    });
    
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const index = parseInt(e.target.dataset.index);
            memoryItems.splice(index, 1);
            await saveMemory();
            renderMemoryList();
        });
    });
}

async function addMemoryItem(text) {
    if (text && text.trim()) {
        const trimmed = text.trim();
        // 去重检查：避免重复添加相同记忆
        const exists = memoryItems.some(m => m.text === trimmed);
        if (exists) return;
        memoryItems.push({ text: trimmed });
        await saveMemory();
        renderMemoryList();
    }
}

function showMemoryModal() {
    memoryModalInput.value = '';
    memoryModal.style.display = 'flex';
    setTimeout(() => memoryModalInput.focus(), 50);
}

function hideMemoryModal() {
    memoryModal.style.display = 'none';
}

function cleanReply(reply) {
    if (!reply) return '';
    let cleaned = reply.replace(/\[MEMORY:\s*[^\]]+\]/g, '');
    cleaned = cleaned.replace(/\[SHORT_MEMORY:\s*[^\]]+\]/g, '');
    cleaned = cleaned.replace(/<MOOD:[^>]+>/g, '');
    cleaned = cleaned.replace(/<CMD:[^>]+>/g, '');
    cleaned = cleaned.replace(/[\r\n\u2028\u2029]+/g, '');
    cleaned = cleaned.replace(/[\u200b\u200c\u200d\u200e\u200f]+/g, '');
    return cleaned;
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

// 根据心情增减好感度
function changeAffection(mood) {
    const moodAffectionMap = {
        '撒娇': 4,
        '兴奋': 3,
        '鼓励': 2,
        '害羞': 2,
        '好奇': 1,
        '惊讶': 0,
        '无语': -1,
        '难过': -2,
        '生气': -4
    };
    const delta = moodAffectionMap[mood] !== undefined ? moodAffectionMap[mood] : 0;
    if (delta === 0) return;
    stats.affection = Math.max(0, Math.min(100, stats.affection + delta));
    const sign = delta > 0 ? '+' : '';
    showAffectionChange(sign + delta);
    updateStatsDisplay();
}

// 好感度变化提示
let affectionHintTimeout = null;
function showAffectionChange(text) {
    const affectionDisplay = document.getElementById('affectionDisplay');
    if (!affectionDisplay) return;
    let hint = document.getElementById('affectionChangeHint');
    if (!hint) {
        hint = document.createElement('span');
        hint.id = 'affectionChangeHint';
        hint.style.cssText = 'font-size:11px;font-weight:700;color:#ff4757;margin-left:2px;transition:opacity 0.3s;opacity:0;';
        affectionDisplay.appendChild(hint);
    }
    hint.textContent = text;
    hint.style.opacity = '1';
    if (affectionHintTimeout) clearTimeout(affectionHintTimeout);
    affectionHintTimeout = setTimeout(() => {
        hint.style.opacity = '0';
    }, 1500);
}

function logBehavior(action) {
    // 不记录"前往xx"类的移动信息
    if (/^前往/.test(action)) return;
    const now = new Date();
    const timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0') + ':' + now.getSeconds().toString().padStart(2, '0');
    behaviorLog.push({ time: timeStr, action: action });
    const maxLen = config.behaviorLogMax || 50;
    if (behaviorLog.length > maxLen) {
        behaviorLog.splice(0, behaviorLog.length - maxLen);
    }
    renderBehaviorLog();
}

function getBehaviorLogStr() {
    if (behaviorLog.length === 0) return '';
    return '\n最近行为记录：\n' + behaviorLog.map(b => `- ${b.time} ${b.action}`).join('\n');
}

function renderBehaviorLog() {
    const behaviorList = document.getElementById('behaviorList');
    if (!behaviorList) return;
    if (behaviorLog.length === 0) {
        behaviorList.innerHTML = '<div style="text-align:center;color:#999;font-size:10px;padding:10px;">暂无行为记录</div>';
        return;
    }
    behaviorList.innerHTML = behaviorLog.slice().reverse().map(b =>
        `<div class="behavior-item"><span class="behavior-time">${b.time}</span><span class="behavior-action">${b.action}</span></div>`
    ).join('');
}

function parseCommandFromReply(reply) {
    if (!reply) return null;
    const match = reply.match(/<CMD:([^>]+)>/);
    if (match) {
        const cmd = match[1].trim();
        // 行为指令直接返回动作名；房间移动指令返回 room:{roomId}
        const actionMap = {
            '吃饭': 'eat',
            '睡觉': 'sleep',
            '洗澡': 'bathe',
            '上厕所': 'toilet',
            '看电视': 'watch_tv'
        };
        if (actionMap[cmd]) return actionMap[cmd];
        const roomMap = {
            '去客厅': 'room:living',
            '去卧室': 'room:bedroom',
            '去厨房': 'room:kitchen',
            '去卫生间': 'room:bathroom',
            '去阳台': 'room:laundry'
        };
        return roomMap[cmd] || null;
    }
    return null;
}

// 执行 AI 返回的指令（来自 parseCommandFromReply）
// cmd 可能是动作名（'eat'/'sleep'/'bathe'/'toilet'/'watch_tv'）或房间指令（'room:living'）
function executeCommand(cmd) {
    if (!cmd) return;
    interruptActivity();
    // 直接触发行为链
    if (cmd === 'eat') { startEat(); return; }
    if (cmd === 'sleep') { startSleep(); return; }
    if (cmd === 'bathe') { startBathe(); return; }
    if (cmd === 'toilet') { startToilet(); return; }
    if (cmd === 'watch_tv') { startWatchTv(); return; }
    // 房间移动指令
    if (cmd.startsWith('room:')) {
        const roomId = cmd.slice(5);
        if (roomId && ROOM_TYPES[roomId]) {
            moveTo(roomId, () => onArriveRoom(roomId));
            return;
        }
    }
}

function switchIllust(mood) {
    if (!mood || !moodList.includes(mood)) {
        mood = moodList[Math.floor(Math.random() * moodList.length)];
    }

    const emoji = moodEmojis[mood] || '';
    illustMood.textContent = emoji + ' ' + mood;

    // 恢复被 onerror 内联处理器隐藏的立绘（否则后续切换永远不可见）
    illustImg.style.display = '';

    // 直接切换图片，无淡出淡入
    const moodImgPath = imgPath('mood_' + mood + '.png');
    const tempImg = new Image();
    tempImg.onload = function() {
        illustImg.style.display = '';
        illustImg.src = moodImgPath;
        illustImg.classList.add('show');
        illustMood.classList.add('show');
    };
    tempImg.onerror = function() {
        illustImg.style.display = '';
        illustImg.src = imgPath('pet.png');
        illustImg.classList.add('show');
        illustMood.classList.add('show');
    };
    tempImg.src = moodImgPath;
}

function bounceIllust() {
    illustImg.classList.remove('bounce');
    void illustImg.offsetWidth;
    illustImg.classList.add('bounce');
}

function hideIllust() {
    illustImg.classList.remove('show');
    illustMood.classList.remove('show');
}

// 统一 AI 提供商凭据：API 设置与多模态设置已合并，所有 AI 调用都根据
// 当前选中的提供商（DeepSeek / 智谱）返回对应的请求地址、API Key 与模型名。
function aiCredentials() {
    const provider = config.multimodalProvider || 'deepseek';
    if (provider === 'zhipu') {
        return {
            apiUrl: config.zhipuApiUrl || 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
            apiKey: config.zhipuApiKey || '',
            model: 'glm-4-flash'
        };
    }
    return {
        apiUrl: config.apiUrl || 'https://api.deepseek.com/v1/chat/completions',
        apiKey: config.apiKey || '',
        model: 'deepseek-v4-flash'
    };
}
// 当前选中的 AI 提供商是否已配置可用 Key
function aiHasKey() {
    return !!aiCredentials().apiKey;
}

async function askAiToSummarize(text) {
    if (!aiHasKey()) return text;
    const c = aiCredentials();

    try {
        const response = await fetch(c.apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${c.apiKey}`
            },
            body: JSON.stringify({
                model: c.model,
                messages: [
                    {
                        role: 'system',
                        content: '你是一个记忆助手。请将用户说的话总结成一个简短的要点（不超过20字），只返回总结内容。'
                    },
                    {
                        role: 'user',
                        content: text
                    }
                ],
                max_tokens: 30,
                temperature: 0.5
            })
        });
        
        const data = await response.json();
        return data.choices[0].message.content.trim();
    } catch (error) {
        return text.substring(0, 30);
    }
}

function moveToPosition(newTargetX, newTargetY) {
    stopMoving();
    // 点击移动打断当前行为
    interruptActivity();

    const houseRect = house.getBoundingClientRect();
    newTargetX = Math.max(0, Math.min(houseRect.width - petWidth, newTargetX));
    // 菱形模式下 newTargetY 是脚部位置
    if (config.gridViewMode === 'diamond') {
        newTargetY = Math.max(0, Math.min(houseRect.height, newTargetY));
    } else {
        newTargetY = Math.max(0, Math.min(houseRect.height - petHeight, newTargetY));
    }

    window.targetX = newTargetX;
    window.targetY = newTargetY;
    targetX = newTargetX;
    targetY = newTargetY;
    
    stats.happiness = Math.min(100, stats.happiness + 5);
    stats.boredom = Math.max(0, stats.boredom - 8);
    updateStatsDisplay();
    
    updateActivityText('主人让我过去~');
    startMoving();
}

// 以下三个函数保留为空操作以兼容旧调用，房间/墙壁/家具数据现已由网格系统提供
function updateFurnitureRects() {
}

function updateRoomRects() {
}

function updateWallRects() {
}

// 计算网格布局并渲染到 house 元素中
// 布局缓存：比较当前计算出的 cellSize/offsetX/offsetY 与上次缓存值，
// 若无变化则跳过 renderGrid（避免每次 resize 都重建 300+ DOM 元素）。
let lastGridLayout = null; // { cellSize, offsetX, offsetY, viewMode, cols, rows }
function updateGridLayout() {
    if (!petGrid) return;
    const houseRect = house.getBoundingClientRect();
    const layout = calculateGridLayout(houseRect, petGrid.cols, petGrid.rows, config.gridCellSize, config.gridViewMode);
    const viewMode = config.gridViewMode;

    // 布局未变化时跳过昂贵的 renderGrid 重建
    if (lastGridLayout &&
        lastGridLayout.cellSize === layout.cellSize &&
        lastGridLayout.offsetX === layout.offsetX &&
        lastGridLayout.offsetY === layout.offsetY &&
        lastGridLayout.viewMode === viewMode &&
        lastGridLayout.cols === petGrid.cols &&
        lastGridLayout.rows === petGrid.rows) {
        // 仍需同步全局变量（虽然值相同，保持一致性）
        gridCellSize = layout.cellSize;
        gridOffsetX = layout.offsetX;
        gridOffsetY = layout.offsetY;
        return;
    }

    gridCellSize = layout.cellSize;
    gridOffsetX = layout.offsetX;
    gridOffsetY = layout.offsetY;
    renderGrid(house, gridOffsetX, gridOffsetY, gridCellSize, viewMode);
    lastGridLayout = {
        cellSize: layout.cellSize,
        offsetX: layout.offsetX,
        offsetY: layout.offsetY,
        viewMode: viewMode,
        cols: petGrid.cols,
        rows: petGrid.rows
    };
}

function checkCollision(x, y) {
    const petCenterX = x + petWidth / 2;
    // 菱形模式下，petY 是桌宠脚部 y 坐标（对齐菱形底部），即判定点
    // 正方形模式下，petY 是桌宠顶部 y 坐标，需要 + petHeight/2 取中心
    const checkY = (config.gridViewMode === 'diamond') ? y : (y + petHeight / 2);
    const gridPos = screenToGrid(petCenterX, checkY, gridCellSize, gridOffsetX, gridOffsetY, config.gridViewMode);
    return !isCellWalkable(gridPos.col, gridPos.row);
}

function rectsOverlap(a, b) {
    return a.x < b.x + b.width &&
           a.x + a.width > b.x &&
           a.y < b.y + b.height &&
           a.y + a.height > b.y;
}

function findPath(startX, startY, endX, endY) {
    const cols = petGrid.cols;
    const rows = petGrid.rows;

    // 菱形模式下，petY 已是桌宠脚部 y 坐标（对齐菱形底部）
    // 起点/终点转屏幕坐标时直接用 petY 即可（菱形底部 = 判定点）
    const startGrid = screenToGrid(startX + petWidth / 2, startY, gridCellSize, gridOffsetX, gridOffsetY, config.gridViewMode);
    const startCol = startGrid.col;
    const startRow = startGrid.row;
    const endGrid = screenToGrid(endX + petWidth / 2, endY, gridCellSize, gridOffsetX, gridOffsetY, config.gridViewMode);
    let endCol = endGrid.col;
    let endRow = endGrid.row;

    // 如果终点不可行走，找附近最近的可达点
    if (!isCellWalkable(endCol, endRow)) {
        let found = false;
        for (let r = 1; r <= 6 && !found; r++) {
            for (let dc = -r; dc <= r && !found; dc++) {
                for (let dr = -r; dr <= r && !found; dr++) {
                    if (Math.abs(dc) !== r && Math.abs(dr) !== r) continue;
                    if (isCellWalkable(endCol + dc, endRow + dr)) {
                        endCol = endCol + dc;
                        endRow = endRow + dr;
                        const endPos = gridToScreen(endCol, endRow, gridCellSize, gridOffsetX, gridOffsetY, config.gridViewMode);
                        endX = endPos.x - petWidth / 2;
                        if (config.gridViewMode === 'diamond') {
                            endY = endPos.y + gridCellSize / 4;
                        } else {
                            endY = endPos.y - petHeight / 2;
                        }
                        found = true;
                    }
                }
            }
        }
        if (!found) return [];
    }

    if (startCol === endCol && startRow === endRow) {
        return [{ x: endX, y: endY }];
    }

    const openSet = [];
    const closedSet = new Set();
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Map();

    const startKey = `${startCol},${startRow}`;
    gScore.set(startKey, 0);
    fScore.set(startKey, heuristic(startCol, startRow, endCol, endRow));
    openSet.push({ col: startCol, row: startRow, f: fScore.get(startKey) });

    function heuristic(c1, r1, c2, r2) {
        return Math.abs(c1 - c2) + Math.abs(r1 - r2);
    }

    function getKey(c, r) {
        return `${c},${r}`;
    }

    // 可通行性由全局 isCellWalkable 提供（基于网格数据）
    function isWalkable(col, row) {
        if (col < 0 || col >= cols || row < 0 || row >= rows) return false;
        return isCellWalkable(col, row);
    }

    while (openSet.length > 0) {
        let lowestIdx = 0;
        for (let i = 1; i < openSet.length; i++) {
            if (openSet[i].f < openSet[lowestIdx].f) {
                lowestIdx = i;
            }
        }

        const current = openSet.splice(lowestIdx, 1)[0];
        const currentKey = getKey(current.col, current.row);

        if (current.col === endCol && current.row === endRow) {
            const path = [];
            let c = current.col;
            let r = current.row;

            while (cameFrom.has(getKey(c, r))) {
                const prev = cameFrom.get(getKey(c, r));
                // 跳过终点网格中心，只用实际目标位置
                if (!(c === endCol && r === endRow)) {
                    const nodePos = gridToScreen(c, r, gridCellSize, gridOffsetX, gridOffsetY, config.gridViewMode);
                    // 菱形模式下，路径点 y 对齐菱形底部
                    const nodeY = (config.gridViewMode === 'diamond')
                        ? nodePos.y + gridCellSize / 4
                        : nodePos.y - petHeight / 2;
                    path.unshift({
                        x: nodePos.x - petWidth / 2,
                        y: nodeY
                    });
                }
                c = prev.col;
                r = prev.row;
            }

            path.push({ x: endX, y: endY });

            // 移除起始方向错误的路径点：如果第一个点在目标的反方向，跳过它
            while (path.length > 1) {
                const first = path[0];
                const dx1 = first.x - startX;
                const dy1 = first.y - startY;
                const dx2 = endX - startX;
                const dy2 = endY - startY;
                // 点积为负表示第一个点在目标的反方向
                if (dx1 * dx2 + dy1 * dy2 < 0) {
                    path.shift();
                } else {
                    break;
                }
            }

            return path;
        }

        closedSet.add(currentKey);

        const neighbors = [
            { col: current.col + 1, row: current.row },
            { col: current.col - 1, row: current.row },
            { col: current.col, row: current.row + 1 },
            { col: current.col, row: current.row - 1 }
        ];

        for (const neighbor of neighbors) {
            const neighborKey = getKey(neighbor.col, neighbor.row);

            if (closedSet.has(neighborKey)) continue;
            if (!isWalkable(neighbor.col, neighbor.row)) continue;

            const tentativeG = (gScore.get(currentKey) || Infinity) + 1;

            if (!gScore.has(neighborKey) || tentativeG < gScore.get(neighborKey)) {
                cameFrom.set(neighborKey, { col: current.col, row: current.row });
                gScore.set(neighborKey, tentativeG);
                const f = tentativeG + heuristic(neighbor.col, neighbor.row, endCol, endRow);
                fScore.set(neighborKey, f);

                const existing = openSet.find(n => n.col === neighbor.col && n.row === neighbor.row);
                if (!existing) {
                    openSet.push({ col: neighbor.col, row: neighbor.row, f: f });
                } else {
                    existing.f = f;
                }
            }
        }
    }

    return [];
}

function updateCurrentRoom() {
    const petCenterX = petX + petWidth / 2;
    // 菱形模式下，petY 是桌宠脚部 y 坐标（判定点）
    // 正方形模式下，petY 是顶部 y 坐标，需要 + petHeight/2
    const checkY = (config.gridViewMode === 'diamond') ? petY : (petY + petHeight / 2);
    const roomId = getRoomAtPixel(petCenterX, checkY, gridOffsetX, gridOffsetY, gridCellSize, config.gridViewMode);
    // 房间缓存：仅当房间变化时才更新指示器 DOM（textContent + style）。
    // 移动循环每 30ms 调用一次，房间不变时写 DOM 是纯开销，缓存后避免无谓样式重算。
    if (roomId && ROOM_TYPES[roomId]) {
        if (roomId !== lastRoomId) {
            lastRoomId = roomId;
            roomIndicator.textContent = ROOM_TYPES[roomId].name;
            // 同步背景色到房间指示栏
            if (petGrid && petGrid.customColors && petGrid.customColors.floor) {
                const color = petGrid.customColors.floor[roomId] || ROOM_TYPES[roomId].defaultColor || ROOM_TYPES[roomId].color;
                roomIndicator.style.background = color;
            } else {
                roomIndicator.style.background = ROOM_TYPES[roomId].defaultColor || ROOM_TYPES[roomId].color;
            }
        }
    }
    return roomId;
}

function moveTo(roomId, callback, options) {
    // options 可包含 { furnitureAction: 'eat'|'sleep'|... } 或 { targetCell: {col,row} }
    let targetCol, targetRow;

    if (options && options.furnitureAction) {
        // 根据家具行为找目标（如 eat→stove旁, sleep→bed旁, watch_tv→tv旁）
        // 寻路时忽略家具九宫格阻挡
        if (typeof setFurniturePathMode === 'function') {
            setFurniturePathMode(true);
        }
        const target = getFurnitureActionTarget(options.furnitureAction);
        if (target) {
            targetCol = target.col;
            targetRow = target.row;
        }
    } else if (options && options.targetCell) {
        targetCol = options.targetCell.col;
        targetRow = options.targetCell.row;
    }

    if (targetCol === undefined) {
        // 随机选一个该房间的地板格子
        const cell = getRandomRoomCell(roomId);
        if (!cell) return;
        targetCol = cell.col;
        targetRow = cell.row;
    }

    // 网格坐标转像素坐标（等轴测）
    const targetPos = gridToScreen(targetCol, targetRow, gridCellSize, gridOffsetX, gridOffsetY, config.gridViewMode);
    targetX = targetPos.x - petWidth / 2;
    // 菱形模式下，petY 表示桌宠脚部 y 坐标（对齐菱形底部）
    if (config.gridViewMode === 'diamond') {
        targetY = targetPos.y + gridCellSize / 4;
    } else {
        targetY = targetPos.y - petHeight / 2;
    }

    updateActivityText(`正在前往${ROOM_TYPES[roomId].name}...`);
    startMoving(callback, options);
}

function startMoving(callback, options) {
    stopMoving();
    // stopMoving 会重置 furniturePathMode=false。若调用方需要穿过家具九宫格
    // （如前往沙发/床/餐桌旁的格子），需在 findPath 前重新开启，否则目标格被九宫格规则
    // 判定为不可通行，寻路失败。
    if (options && options.furniturePathMode && typeof setFurniturePathMode === 'function') {
        setFurniturePathMode(true);
    }

    currentPath = findPath(petX, petY, targetX, targetY);
    pathIndex = 0;
    
    if (currentPath.length === 0) {
        // 寻路失败，关闭家具寻路模式
        if (typeof setFurniturePathMode === 'function') {
            setFurniturePathMode(false);
        }
        if (callback) callback();
        return;
    }
    
    isMoving = true;
    pet.classList.add('walking');
    // 清除拖拽释放时设置的 transform 过渡（mouseup 中设了 'transform 0.05s linear'）。
    // 原来移动用 left/top 不受 transform transition 影响；现在改用 transform 移动，
    // 若不清除，每步 transform 都会被 50ms 过渡插值，导致移动卡顿/滞后。
    pet.style.transition = 'none';
    // 重置步进计数器，使首次 z-index 更新在第 Z_INDEX_UPDATE_INTERVAL 步触发，
    // 而非沿用上次移动的残留计数导致首次更新过早或过晚。
    petMoveStepCount = 0;

    // requestAnimationFrame 驱动 + 固定步进累加器：
    // - 与屏幕刷新（~60fps）同步，比 setInterval(30ms) 更平滑；
    // - 主线程阻塞时 RAF 自动暂停，不会像 setInterval 那样积压回调，从根上消除"恢复后跳跃"；
    // - 用固定步进 MOVE_STEP_MS(30ms) 保持与原 setInterval 完全一致的移动速度，
    //   高刷新率屏幕下也不会变快。
    let lastTickTime = performance.now();
    let accumulator = 0;

    const step = () => {
        if (pathIndex >= currentPath.length) {
            stopMoving();
            if (callback) callback();
            return;
        }

        const target = currentPath[pathIndex];
        const dx = target.x - petX;
        const dy = target.y - petY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 3) {
            pathIndex++;
            return;
        }

        const stepX = (dx / dist) * moveSpeed;
        const stepY = (dy / dist) * moveSpeed;

        petX += stepX;
        petY += stepY;

        // 向右移动时翻转图片，向左移动时恢复
        if (petX > lastPetX) {
            petImg.classList.add('flip');
        } else if (petX < lastPetX) {
            petImg.classList.remove('flip');
        }
        lastPetX = petX;

        const houseRect = house.getBoundingClientRect();
        petX = Math.max(0, Math.min(houseRect.width - petWidth, petX));
        // 菱形模式下 petY 是脚部位置，下界为 houseRect.height
        // 正方形模式下 petY 是中心位置，下界为 houseRect.height - petHeight
        if (config.gridViewMode === 'diamond') {
            petY = Math.max(0, Math.min(houseRect.height, petY));
        } else {
            petY = Math.max(0, Math.min(houseRect.height - petHeight, petY));
        }

        updatePetPosition();
        updateCurrentRoom();
    };

    const tick = (now) => {
        if (!isMoving) return; // 已停止，不再调度

        const delta = now - lastTickTime;
        lastTickTime = now;
        accumulator += delta;
        // 防止"死亡螺旋"：若单帧间隔过大（如标签页失焦后恢复），清空累加器，
        // 避免一次性补偿过多步进造成视觉跳跃。
        if (accumulator > MOVE_STEP_MS * 3) {
            accumulator = 0;
        }

        // 固定步进：累加足够时间才执行一次移动逻辑，保证移动速度恒定。
        while (accumulator >= MOVE_STEP_MS) {
            accumulator -= MOVE_STEP_MS;
            step();
            if (!isMoving) break; // step 内可能调用 stopMoving，退出循环
        }

        if (isMoving) {
            moveRAF = requestAnimationFrame(tick);
        }
    };

    moveRAF = requestAnimationFrame(tick);
}

function stopMoving() {
    isMoving = false;
    pet.classList.remove('walking');
    if (moveRAF) {
        cancelAnimationFrame(moveRAF);
        moveRAF = null;
    }
    // 关闭家具寻路模式
    if (typeof setFurniturePathMode === 'function') {
        setFurniturePathMode(false);
    }
    // 移动结束时强制更新一次 z-index：节流期间可能最后一次步进未触发 z-index 更新，
    // 此处补齐，确保桌宠静止时遮挡关系与最终位置一致。
    petMoveStepCount = 0;
    const houseEl = document.getElementById('house');
    if (houseEl && typeof updatePetZIndex === 'function') {
        updatePetZIndex(houseEl, gridOffsetX, gridOffsetY, gridCellSize, config.gridViewMode, petY, petHeight);
    } else if (houseEl && typeof updateGridZIndex === 'function') {
        updateGridZIndex(houseEl, gridOffsetX, gridOffsetY, gridCellSize, config.gridViewMode, petY);
    }
}

function tryMoveStep(dx, dy) {
    const newX = petX + dx;
    const newY = petY + dy;
    
    let moved = false;
    
    if (!checkCollision(newX, petY)) {
        petX = newX;
        moved = true;
    }
    if (!checkCollision(petX, newY)) {
        petY = newY;
        moved = true;
    }
    
    if (!moved) {
        targetX = petX + (Math.random() - 0.5) * 100;
        targetY = petY + (Math.random() - 0.5) * 100;
    }
    
    const houseRect = house.getBoundingClientRect();
    petX = Math.max(0, Math.min(houseRect.width - petWidth, petX));
    if (config.gridViewMode === 'diamond') {
        petY = Math.max(0, Math.min(houseRect.height, petY));
    } else {
        petY = Math.max(0, Math.min(houseRect.height - petHeight, petY));
    }

    updatePetPosition();
    updateCurrentRoom();
}

function updatePetPosition() {
    // 用 transform: translate3d 代替 left/top：transform 只触发合成（compositor），
    // 不触发 Layout（重排），每帧开销远低于写 left/top。translate3d 强制 GPU 合成层。
    // 菱形模式下，petY 是脚部 y 坐标（对齐菱形底部），贴图 top 需上移整个 petHeight
    // 正方形模式下，petY 是中心 y，贴图 top 需上移 petHeight/2
    let topY;
    if (config.gridViewMode === 'diamond') {
        topY = petY - petHeight;
    } else {
        topY = petY - petHeight / 2;
    }
    pet.style.transform = 'translate3d(' + petX + 'px, ' + topY + 'px, 0)';

    // z-index 节流：只在每 Z_INDEX_UPDATE_INTERVAL 步更新一次遮挡关系。
    // 桌宠移动时墙面/家具位置不变，z-index 仅在桌宠穿过某墙面/家具底部时才需变化，
    // 每 5 步（~150ms）更新一次足以保证视觉正确的遮挡，且大幅减少样式写次数。
    petMoveStepCount++;
    if (petMoveStepCount >= Z_INDEX_UPDATE_INTERVAL) {
        petMoveStepCount = 0;
        const houseEl = document.getElementById('house');
        if (houseEl && typeof updatePetZIndex === 'function') {
            updatePetZIndex(houseEl, gridOffsetX, gridOffsetY, gridCellSize, config.gridViewMode, petY, petHeight);
        } else if (houseEl && typeof updateGridZIndex === 'function') {
            updateGridZIndex(houseEl, gridOffsetX, gridOffsetY, gridCellSize, config.gridViewMode, petY);
        }
    }
}

// ============================================================
// 行为状态机：看电视 / 睡觉 / 洗澡 / 吃饭（含行为链）
// "进行一段时间"阶段：隐藏桌宠 + 家具贴图换变体 + 效果覆盖层（zzz / 冒汗）
// 打断源：点击移动、拖拽、调整窗口 → interruptActivity()
// 打断后：桌宠恢复显示、家具贴图还原，等待几秒后回到 wander 逻辑
// ============================================================

let currentActivity = null;      // 当前进行中的行为，null 表示空闲
let activitySeq = 0;             // 行为实例编号，防止旧行为的异步回调影响新行为
let eatHungerFreezeUntil = 0;    // 吃饭后饥饿值冻结截止时间戳（吃饭后数分钟不降低）

// 根据窗口焦点决定持续时间：有焦点 30s，无焦点 2min
function getFocusBasedDuration() {
    return document.hasFocus() ? 30000 : 120000;
}

// 随机长持续时间（毫秒）：几十秒 ~ 3 分钟，用于看电视 / 睡觉
function getRandomLongDuration() {
    return (30 + Math.random() * 150) * 1000;
}

// 查找家具 DOM 元素（通过 renderGrid 中设置的 data-furniture-type）
function getFurnitureEl(type) {
    return house.querySelector('.grid-furniture-item[data-furniture-type="' + type + '"]');
}

// 家具贴图换变体（如 stove → 灶台_做饭）。variantSuffix 为变体后缀
// 同时按 TEXTURE_SCALE 中 "类型_变体" 的倍数缩放贴图
function swapFurnitureImage(type, variantSuffix) {
    const def = FURNITURE_TYPES[type];
    if (!def || !def.image) return;
    const el = getFurnitureEl(type);
    if (!el) return;
    const img = el.querySelector('.grid-cell-img');
    if (img) {
        img.src = imgPath(encodeURIComponent(def.image + '_' + variantSuffix) + '.png');
        if (typeof setCellImgScale === 'function' && typeof getFurnitureFinalScale === 'function') {
            setCellImgScale(img, getFurnitureFinalScale(type, variantSuffix));
        }
    }
}

// 还原家具贴图为默认（含基础贴图缩放倍数）
function restoreFurnitureImage(type) {
    const def = FURNITURE_TYPES[type];
    if (!def || !def.image) return;
    const el = getFurnitureEl(type);
    if (!el) return;
    const img = el.querySelector('.grid-cell-img');
    if (img) {
        img.src = imgPath(encodeURIComponent(def.image) + '.png');
        if (typeof setCellImgScale === 'function' && typeof getFurnitureFinalScale === 'function') {
            setCellImgScale(img, getFurnitureFinalScale(type, null));
        }
    }
}

// 在家具上方显示效果覆盖层（zzz / 冒汗）
function showActivityEffect(type, effectClass, text) {
    const el = getFurnitureEl(type);
    if (!el) return;
    let eff = el.querySelector('.activity-effect');
    if (!eff) {
        eff = document.createElement('div');
        el.appendChild(eff);
    }
    eff.className = 'activity-effect ' + effectClass;
    eff.textContent = text;
}

function hideActivityEffect(type) {
    const el = getFurnitureEl(type);
    if (!el) return;
    const eff = el.querySelector('.activity-effect');
    if (eff) eff.remove();
}

function hidePet() { pet.style.visibility = 'hidden'; }
function showPet() { pet.style.visibility = 'visible'; }

// 移动到指定家具相邻的可通行格子（途中允许穿过家具九宫格）
function moveToFurnitureAdjacent(type, callback) {
    setFurniturePathMode(true);
    const adjacent = findFurnitureAdjacentCells(type);
    const furCells = findFurnitureCells(type);
    const roomId = (furCells.length > 0 && furCells[0].cell.room) ? furCells[0].cell.room : 'living';
    if (adjacent.length === 0) {
        setFurniturePathMode(false);
        if (callback) callback();
        return;
    }
    const cell = adjacent[Math.floor(Math.random() * adjacent.length)];
    moveTo(roomId, () => {
        setFurniturePathMode(false);
        if (callback) callback();
    }, { targetCell: { col: cell.col, row: cell.row }, furniturePathMode: true });
}

// 打断当前行为：恢复桌宠显示、还原家具贴图、清除定时器、停止移动
function interruptActivity() {
    if (!currentActivity) return;
    const act = currentActivity;
    currentActivity = null;
    // 清除所有定时器
    if (act.timers && act.timers.length) {
        act.timers.forEach(function (t) { clearTimeout(t); clearInterval(t); });
        act.timers = [];
    }
    // 停止移动（行为可能在 moving 阶段被打断）
    stopMoving();
    // 还原桌宠
    showPet();
    pet.classList.remove('jumping');
    // 还原家具贴图与效果
    if (act.type === 'eat') {
        ['fridge', 'stove', 'table'].forEach(function (t) {
            restoreFurnitureImage(t);
            hideActivityEffect(t);
        });
    } else if (act.furnitureType) {
        restoreFurnitureImage(act.furnitureType);
        hideActivityEffect(act.furnitureType);
    }
    // 睡觉被打断：按已睡时长比例恢复精力（完整睡满→补满100，中断则按比例补到100）
    if (act.type === 'sleep' && act.phase === 'doing' && act.startTime && act.plannedDuration) {
        const elapsed = Date.now() - act.startTime;
        const frac = Math.max(0, Math.min(1, elapsed / act.plannedDuration));
        if (frac > 0) {
            const target = act.energyStart + frac * (100 - act.energyStart);
            stats.energy = Math.min(100, Math.max(stats.energy, target));
            updateStatsDisplay();
            showMessage(frac > 0.5 ? '睡了一小觉~' : '没睡够...');
        }
    }
    updateActivityText('被打断啦~');
    // 打断后等待几秒继续随机行为（回到 wander 逻辑）
    setTimeout(function () {
        if (!isDragging && !isMoving && !shouldPausePetActivity() && !currentActivity) {
            decideDestination();
        }
    }, 5000);
}

// 开始"进行一段时间"阶段：隐藏桌宠 + 换家具贴图 + 显示效果，到时间后还原并回调
function beginDoingPhase(act, config) {
    const myId = act.id;
    act.phase = 'doing';
    act.furnitureType = config.furnitureType || null;
    // 记录起始时间/计划时长/起始精力，供打断时按比例恢复精力（睡觉）使用
    act.startTime = Date.now();
    act.plannedDuration = config.duration;
    act.energyStart = stats.energy;
    // 桌宠先隐藏，随后立即切换家具贴图（同步执行，视觉上无延迟）
    hidePet();
    if (config.furnitureType && config.imageVariant) {
        swapFurnitureImage(config.furnitureType, config.imageVariant);
    }
    if (config.furnitureType && config.effect) {
        showActivityEffect(config.furnitureType, config.effectClass, config.effectText);
    }
    updateActivityText(config.activityText);
    const timer = setTimeout(function () {
        if (!currentActivity || currentActivity.id !== myId) return;
        // 还原桌宠与家具
        showPet();
        if (config.furnitureType) {
            restoreFurnitureImage(config.furnitureType);
            hideActivityEffect(config.furnitureType);
        }
        if (config.onComplete) config.onComplete();
    }, config.duration);
    act.timers.push(timer);
}

// 行为正常结束（非打断）：清空状态、显示消息、等待几秒后回到 wander
function finishActivity(msg) {
    currentActivity = null;
    showPet();
    if (msg) {
        showMessage(msg);
        updateActivityText(msg);
    }
    setTimeout(function () {
        if (!isDragging && !isMoving && !shouldPausePetActivity() && !currentActivity) {
            decideDestination();
        }
    }, 3000 + Math.random() * 4000);
}

// ---- 看电视 ----
function startWatchTv() {
    const id = ++activitySeq;
    currentActivity = { id: id, type: 'watch_tv', phase: 'moving', timers: [] };
    updateActivityText('好无聊，去客厅看电视...');
    // 检查客厅是否有沙发
    const livingSofa = findFurnitureCells('sofa').filter(function (c) { return c.cell.room === 'living'; });
    if (livingSofa.length > 0) {
        // 有沙发：移动到沙发旁，坐沙发看电视
        moveToFurnitureAdjacent('sofa', function () {
            if (!currentActivity || currentActivity.id !== id) return;
            beginDoingPhase(currentActivity, {
                furnitureType: 'sofa',
                imageVariant: '坐',
                activityText: '坐在沙发上看电视~',
                duration: getRandomLongDuration(),
                onComplete: function () {
                    stats.boredom = Math.max(0, stats.boredom - 25);
                    stats.happiness = Math.min(100, stats.happiness + 5);
                    updateStatsDisplay();
                    finishActivity('看电视好有趣~');
                }
            });
        });
    } else {
        // 无沙发：移动到电视旁，暂停十几秒（桌宠可见，不换图）
        moveTo('living', function () {
            if (!currentActivity || currentActivity.id !== id) return;
            currentActivity.phase = 'doing';
            updateActivityText('站在电视前看电视~');
            const timer = setTimeout(function () {
                if (!currentActivity || currentActivity.id !== id) return;
                stats.boredom = Math.max(0, stats.boredom - 15);
                stats.happiness = Math.min(100, stats.happiness + 3);
                updateStatsDisplay();
                finishActivity('看电视好有趣~');
            }, 10000 + Math.random() * 8000);
            currentActivity.timers.push(timer);
        }, { furnitureAction: 'watch_tv' });
    }
}

// ---- 睡觉 ----
function startSleep() {
    const id = ++activitySeq;
    currentActivity = { id: id, type: 'sleep', phase: 'moving', timers: [] };
    updateActivityText('好困，去睡觉...');
    moveToFurnitureAdjacent('bed', function () {
        if (!currentActivity || currentActivity.id !== id) return;
        beginDoingPhase(currentActivity, {
            furnitureType: 'bed',
            imageVariant: '睡觉', // 床_睡觉.png
            effect: true,
            effectClass: 'zzz',
            effectText: '💤',
            activityText: '呼呼大睡~',
            duration: getRandomLongDuration(),
            onComplete: function () {
                stats.energy = 100; // 睡完觉精力补满
                updateStatsDisplay();
                finishActivity('睡得好香~');
            }
        });
    });
}

// ---- 洗澡 ----
function startBathe() {
    const id = ++activitySeq;
    currentActivity = { id: id, type: 'bathe', phase: 'moving', timers: [] };
    updateActivityText('身上脏脏的，去洗澡...');
    moveToFurnitureAdjacent('shower', function () {
        if (!currentActivity || currentActivity.id !== id) return;
        beginDoingPhase(currentActivity, {
            furnitureType: 'shower',
            imageVariant: '洗澡',
            activityText: '正在洗澡~',
            duration: getFocusBasedDuration(),
            onComplete: function () {
                stats.hygiene = Math.min(100, stats.hygiene + 40);
                updateStatsDisplay();
                finishActivity('洗香香~');
            }
        });
    });
}

// ---- 上厕所 ----
// 与洗澡同构：移动到马桶旁 → 隐藏桌宠 + 切换马桶贴图为"上厕所"变体 → 持续一段时间后还原
function startToilet() {
    const id = ++activitySeq;
    currentActivity = { id: id, type: 'toilet', phase: 'moving', timers: [] };
    updateActivityText('想去卫生间...');
    moveToFurnitureAdjacent('toilet', function () {
        if (!currentActivity || currentActivity.id !== id) return;
        beginDoingPhase(currentActivity, {
            furnitureType: 'toilet',
            imageVariant: '上厕所',
            activityText: '正在上厕所~',
            duration: getFocusBasedDuration(),
            onComplete: function () {
                stats.bladder = 0; // 上完厕所便意清空
                updateStatsDisplay();
                finishActivity('舒服多了~');
            }
        });
    });
}

// ---- 吃饭（行为链：冰箱拿蔬菜 → 灶台做饭 → 餐桌吃饭）----
function startEat() {
    const id = ++activitySeq;
    currentActivity = { id: id, type: 'eat', phase: 'moving', timers: [] };
    updateActivityText('好饿，去找点吃的...');
    runEatStep(id, 'fridge');
}

function runEatStep(id, step) {
    if (!currentActivity || currentActivity.id !== id) return;
    if (step === 'fridge') {
        const fridgeCells = findFurnitureCells('fridge');
        if (fridgeCells.length === 0) {
            // 无冰箱，跳过拿蔬菜，直接做饭
            runEatStep(id, 'cook');
            return;
        }
        updateActivityText('去冰箱拿蔬菜...');
        moveToFurnitureAdjacent('fridge', function () {
            if (!currentActivity || currentActivity.id !== id) return;
            // 拿蔬菜：先停几秒，再跳两下抓蔬菜（左上角状态栏已同步显示"从冰箱拿蔬菜~"）
            currentActivity.phase = 'doing';
            updateActivityText('从冰箱拿蔬菜~');
            // 停几秒后再跳两下
            const t0 = setTimeout(function () {
                if (!currentActivity || currentActivity.id !== id) return;
                pet.classList.add('jumping');
                const t1 = setTimeout(function () {
                    if (!currentActivity || currentActivity.id !== id) return;
                    pet.classList.remove('jumping');
                }, 800);
                const t2 = setTimeout(function () {
                    if (!currentActivity || currentActivity.id !== id) return;
                    runEatStep(id, 'cook');
                }, 1200);
                currentActivity.timers.push(t1, t2);
            }, 1500);
            currentActivity.timers.push(t0);
        });
    } else if (step === 'cook') {
        updateActivityText('在灶台做饭...');
        moveToFurnitureAdjacent('stove', function () {
            if (!currentActivity || currentActivity.id !== id) return;
            beginDoingPhase(currentActivity, {
                furnitureType: 'stove',
                imageVariant: '做饭',
                effect: true,
                effectClass: 'sweat',
                effectText: '💦',
                activityText: '正在做饭~好热',
                duration: 30000,
                onComplete: function () { runEatStep(id, 'eat'); }
            });
        });
    } else if (step === 'eat') {
        updateActivityText('去餐桌吃饭...');
        moveToFurnitureAdjacent('table', function () {
            if (!currentActivity || currentActivity.id !== id) return;
            beginDoingPhase(currentActivity, {
                furnitureType: 'table',
                imageVariant: '吃饭',
                activityText: '正在吃饭~',
                duration: getFocusBasedDuration(),
                onComplete: function () {
                    stats.hunger = 100; // 吃完饭饱食补满
                    eatHungerFreezeUntil = Date.now() + 3 * 60 * 1000; // 吃饭后 3 分钟饥饿值不降低
                    updateStatsDisplay();
                    finishActivity('好好吃~');
                }
            });
        });
    }
}

function decideDestination() {
    // 有行为进行中时不触发新行为
    if (currentActivity) return;
    // 拖动后 30 秒冷却期内不自动移动
    if (Date.now() - lastDragTime < DRAG_COOLDOWN_MS) {
        return;
    }
    if (config.aiDecide && aiHasKey()) {
        aiDecideDestination();
        return;
    }

    // 优先级从高到低：饱食 → 精力 → 便意 → 清洁 → 无聊（玩耍）
    // 其它需求过低时不去玩耍，优先解决对应问题

    // 紧急：饱食过低 → 厨房吃饭（行为链）
    if (stats.hunger < 30) {
        startEat();
        return;
    }
    // 紧急：精力过低 → 卧室睡觉
    if (stats.energy < 25) {
        startSleep();
        return;
    }
    // 紧急：便意过高 → 卫生间上厕所
    if (stats.bladder > 60) {
        startToilet();
        return;
    }
    // 紧急：清洁过低 → 卫生间洗澡
    if (stats.hygiene < 35) {
        startBathe();
        return;
    }

    // 中等：饱食/精力/便意/清洁偏低，但未到紧急线，先去补充（仍优先于玩耍）
    if (stats.hunger < 50) {
        startEat();
        return;
    }
    if (stats.energy < 45) {
        startSleep();
        return;
    }
    if (stats.bladder > 45) {
        startToilet();
        return;
    }
    if (stats.hygiene < 55) {
        startBathe();
        return;
    }

    // 最低优先级：其它需求都满足时，才处理无聊（玩耍/看电视）
    if (stats.boredom > 45 && !isMoving && !isDragging && !shouldPausePetActivity()) {
        if (Math.random() < 0.5) {
            // 自动去客厅看电视
            startWatchTv();
        } else {
            // 头顶冒出持续性对话气泡
            if (!persistentSpeechActive) {
                showPersistentSpeech('好无聊...陪我聊聊？');
                updateActivityText('好无聊...');
            }
        }
        return;
    }

    // 全部正常时随机闲逛
    const roomIds = Object.keys(roomNames);
    const targetRoom = roomIds[Math.floor(Math.random() * roomIds.length)];
    updateActivityText(`正在前往${ROOM_TYPES[targetRoom].name}闲逛...`);
    moveTo(targetRoom, () => {
        updateActivityText(`在${ROOM_TYPES[targetRoom].name}闲逛~`);
        setTimeout(() => {
            if (!isDragging && !isMoving && !shouldPausePetActivity()) {
                decideDestination();
            }
        }, 3000 + Math.random() * 4000);
    });
}

async function aiDecideDestination() {
    const c = aiCredentials();
    try {
        const currentRoom = updateCurrentRoom();
        const statsStr = Object.entries(stats)
            .map(([k, v]) => `${statNames[k]}: ${Math.round(v)}%`)
            .join(', ');
        
        const prompt = `桌宠当前状态：${statsStr}
当前位置：${ROOM_TYPES[currentRoom]?.name || '房间'}

可选房间：
- 客厅：可以玩耍看电视，解闷
- 卧室：可以睡觉休息，恢复精力
- 厨房：可以吃东西，降低饥饿
- 卫生间：可以上厕所、洗澡，解决便意和清洁
- 阳台：可以透气

请根据最需要解决的需求，选择一个最适合去的房间。只返回房间名称（客厅/卧室/厨房/卫生间/阳台）`;

        const response = await fetch(c.apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${c.apiKey}`
            },
            body: JSON.stringify({
                model: c.model,
                messages: [
                    {
                        role: 'system',
                        content: '你是一个聪明的桌宠AI，会根据自己的状态决定去哪里。只返回一个房间名称。'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_tokens: 20,
                temperature: 0.7
            })
        });

        const data = await response.json();
        const aiRoom = data.choices[0].message.content.trim();
        
        let targetRoomId = 'living';
        for (const [id, name] of Object.entries(roomNames)) {
            if (aiRoom.includes(name)) {
                targetRoomId = id;
                break;
            }
        }
        
        moveTo(targetRoomId, () => {
            onArriveRoom(targetRoomId);
        });
        
    } catch (error) {
        console.error('AI decide error:', error);
        const rooms = Object.keys(roomNames);
        const randomRoom = rooms[Math.floor(Math.random() * rooms.length)];
        moveTo(randomRoom, () => onArriveRoom(randomRoom));
    }
}

function onArriveRoom(roomId) {
    let activity = '';

    switch (roomId) {
        case 'kitchen':
            if (stats.hunger < 70) {
                stats.hunger = Math.min(100, stats.hunger + 30);
                showMessage('好好吃~');
                activity = '在厨房吃饭~';
            } else {
                activity = '在厨房逛逛~';
            }
            playCount = 0; // 做了非玩耍活动，重置玩耍递减计数
            break;
        case 'bedroom':
            if (stats.energy < 60) {
                stats.energy = Math.min(100, stats.energy + 40);
                showMessage('睡一觉好舒服~');
                activity = '在卧室睡觉~';
            } else {
                activity = '在卧室休息~';
            }
            playCount = 0;
            break;
        case 'bathroom':
            if (stats.bladder > 50) {
                stats.bladder = Math.max(0, stats.bladder - 50);
                stats.hygiene = Math.min(100, stats.hygiene + 10);
                showMessage('舒服多了~');
                activity = '在卫生间上厕所~';
            } else if (stats.hygiene < 50) {
                stats.hygiene = Math.min(100, stats.hygiene + 40);
                showMessage('洗香香~');
                activity = '在卫生间洗澡~';
            } else {
                activity = '在卫生间洗脸~';
            }
            playCount = 0;
            break;
        case 'living':
            // 无聊值只有在看电视和玩耍时才降低，但效果递减
            playCount++;
            const boredomReduction = Math.max(5, 25 - playCount * 5); // 每次-5，最少-5
            stats.boredom = Math.max(0, stats.boredom - boredomReduction);
            stats.happiness = Math.min(100, stats.happiness + 5);
            if (stats.boredom > 50) {
                showMessage('看电视好有趣~');
                activity = '在客厅看电视~';
            } else {
                showMessage('玩耍好开心~');
                activity = '在客厅玩耍~';
            }
            break;
        case 'laundry':
            stats.happiness = Math.min(100, stats.happiness + 5);
            showMessage('阳台风好舒服~');
            activity = '在阳台透气~';
            playCount = 0;
            break;
        default:
            activity = '在房间里~';
    }

    updateActivityText(activity);
    updateStatsDisplay();

    setTimeout(() => {
        if (!isDragging && !isMoving && !shouldPausePetActivity()) {
            decideDestination();
        }
    }, 5000 + Math.random() * 5000);
}

function updateActivityText(text) {
    activityText.textContent = text;
    if (text && text.includes('正在') && !text.includes('主人让我')) {
        logBehavior(text.replace(/正在/g, '').replace(/~/g, ''));
    }
}

function showMessage(msg) {
    // 持续性对话气泡优先，不覆盖
    if (persistentSpeechActive) return;
    speech.textContent = msg;
    speech.classList.add('show');
    clearTimeout(speech._timeout);
    speech._timeout = setTimeout(() => {
        if (!speech.classList.contains('persistent')) {
            speech.classList.remove('show');
        }
    }, 2500);
}

// 无聊时显示持续性对话气泡，点击后由桌宠开始话题
let persistentSpeechActive = false;
function showPersistentSpeech(msg) {
    speech.textContent = msg;
    speech.classList.remove('show');
    speech.classList.add('persistent');
    persistentSpeechActive = true;
}

function hidePersistentSpeech() {
    speech.classList.remove('persistent');
    speech.classList.remove('show');
    persistentSpeechActive = false;
}

// 点击对话气泡，由桌宠开始话题
speech.addEventListener('click', (e) => {
    e.stopPropagation();
    if (persistentSpeechActive) {
        petStartConversation();
    }
});

function showStatusHint(msg) {
    statusHint.textContent = msg;
    statusHint.classList.add('show');
    
    if (statusHintTimeout) {
        clearTimeout(statusHintTimeout);
    }
    
    statusHintTimeout = setTimeout(() => {
        statusHint.classList.remove('show');
    }, 3000);
}

function createHeart() {
    const heart = document.createElement('div');
    heart.className = 'heart';
    heart.style.left = (Math.random() * 30 + 10) + 'px';
    heart.style.top = (Math.random() * 20) + 'px';
    pet.appendChild(heart);
    setTimeout(() => {
        heart.remove();
    }, 1000);
}

function updateStatsDisplay() {
    const changedStats = [];
    
    if (Math.abs(stats.hunger - lastStats.hunger) > 5) {
        changedStats.push(`❤️ ${stats.hunger > lastStats.hunger ? '+' : ''}${Math.round(stats.hunger - lastStats.hunger)}`);
    }
    if (Math.abs(stats.happiness - lastStats.happiness) > 3) {
        changedStats.push(`😊 ${stats.happiness > lastStats.happiness ? '+' : ''}${Math.round(stats.happiness - lastStats.happiness)}`);
    }
    if (Math.abs(stats.energy - lastStats.energy) > 5) {
        changedStats.push(`⚡ ${stats.energy > lastStats.energy ? '+' : ''}${Math.round(stats.energy - lastStats.energy)}`);
    }
    if (Math.abs(stats.hygiene - lastStats.hygiene) > 5) {
        changedStats.push(`✨ ${stats.hygiene > lastStats.hygiene ? '+' : ''}${Math.round(stats.hygiene - lastStats.hygiene)}`);
    }
    if (Math.abs(stats.boredom - lastStats.boredom) > 5) {
        changedStats.push(`😴 ${stats.boredom > lastStats.boredom ? '+' : ''}${Math.round(stats.boredom - lastStats.boredom)}`);
    }
    
    if (changedStats.length > 0) {
        showStatusHint(changedStats.join(' '));
    }
    
    hungerFill.style.width = stats.hunger + '%';
    hungerValue.textContent = Math.round(stats.hunger) + '%';
    
    happinessFill.style.width = stats.happiness + '%';
    happinessValue.textContent = Math.round(stats.happiness) + '%';
    
    energyFill.style.width = stats.energy + '%';
    energyValue.textContent = Math.round(stats.energy) + '%';
    
    hygieneFill.style.width = stats.hygiene + '%';
    hygieneValue.textContent = Math.round(stats.hygiene) + '%';
    
    boredomFill.style.width = stats.boredom + '%';
    boredomValue.textContent = Math.round(stats.boredom) + '%';

    affectionFill.style.width = stats.affection + '%';
    affectionValue.textContent = Math.round(stats.affection);

    lastStats = { ...stats };
}

// 获取当前时间字符串
function getCurrentTimeStr() {
    const now = new Date();
    const h = now.getHours().toString().padStart(2, '0');
    const m = now.getMinutes().toString().padStart(2, '0');
    const period = h < 6 ? '凌晨' : h < 12 ? '上午' : h < 14 ? '中午' : h < 18 ? '下午' : '晚上';
    return `${period}${h}:${m}`;
}

// 获取天气信息（使用 wttr.in 免费API，失败则返回空）
let cachedWeather = null;
let weatherFetchTime = 0;
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
    } catch (e) {
        // 静默失败
    }
    return '';
}

// 构建包含时间、天气的上下文
async function buildContextStr() {
    const timeStr = getCurrentTimeStr();
    let ctx = `\n当前时间：${timeStr}`;
    const weather = await getWeatherStr();
    if (weather) {
        ctx += `\n当前天气：${weather}`;
    }
    return ctx;
}

// 对话开始时，AI根据自身状态决定心情（用于立绘）
async function decideMoodByState() {
    if (!aiHasKey()) {
        switchIllust(null);
        return;
    }
    const c = aiCredentials();
    try {
        const currentRoom = updateCurrentRoom();
        const statsStr = Object.entries(stats)
            .map(([k, v]) => `${statNames[k]}: ${Math.round(v)}%`)
            .join(', ');
        const ctxStr = await buildContextStr();
        const prompt = `你现在在${ROOM_TYPES[currentRoom]?.name || '房间'}里。当前状态：${statsStr}${ctxStr}\n请根据你当前的状态，选择一个最贴切的心情。只返回心情名称，可选：鼓励、害羞、好奇、惊讶、难过、撒娇、生气、无语、兴奋`;

        const response = await fetch(c.apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${c.apiKey}`
            },
            body: JSON.stringify({
                model: c.model,
                messages: [
                    { role: 'system', content: '你是一个桌宠，根据自身状态选择心情。只返回心情名称。' },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 10,
                temperature: 0.7
            })
        });
        const data = await response.json();
        const mood = data.choices[0].message.content.trim();
        switchIllust(moodList.includes(mood) ? mood : null);
    } catch (e) {
        switchIllust(null);
    }
}

// 桌宠主动开始话题（点击无聊气泡时调用）
async function petStartConversation() {
    chatPanel.classList.add('show');
    stopMoving();
    hidePersistentSpeech();
    decideMoodByState();

    if (aiHasKey()) {
        const c = aiCredentials();
        try {
            addChatMessage('（桌宠想和你说话...）', false);
            const currentRoom = updateCurrentRoom();
            const statsStr = Object.entries(stats)
                .map(([k, v]) => `${statNames[k]}: ${Math.round(v)}%`)
                .join(', ');
            let memoryStr = '';
            if (config.enableMemory && memoryItems.length > 0) {
                memoryStr = '\n记忆：\n' + memoryItems.map((m, i) => `${i + 1}. ${m.text}`).join('\n');
            }
            const behaviorStr = getBehaviorLogStr();
            const ctxStr = await buildContextStr();
            const systemPrompt = `${config.aiPrompt}
现在你在${ROOM_TYPES[currentRoom]?.name || '房间'}里。
当前状态：${statsStr}${memoryStr}${behaviorStr}${ctxStr}

你现在有点无聊，想主动找主人聊天。请主动开启一个话题，话题应与你当前的状态、时间或记忆有关。`;

            const response = await fetch(c.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${c.apiKey}`
                },
                body: JSON.stringify({
                    model: c.model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: '请主动开启话题和我聊天' }
                    ],
                    max_tokens: 120,
                    temperature: 0.9
                })
            });
            const data = await response.json();
            const rawReply = data.choices[0].message.content;
            const reply = cleanReply(rawReply);
            const mood = parseMoodFromReply(rawReply);
            // 替换占位消息
            const placeholder = chatLog.lastChild;
            if (placeholder) placeholder.remove();
            addChatMessage(reply, false);
            showMessage(reply);
            switchIllust(mood);
            bounceIllust();
            stats.boredom = Math.max(0, stats.boredom - 20);
            stats.happiness = Math.min(100, stats.happiness + 5);
            changeAffection(mood);
            updateStatsDisplay();
            logBehavior('和主人聊天');
        } catch (error) {
            const placeholder = chatLog.lastChild;
            if (placeholder) placeholder.remove();
            addChatMessage('主人陪我聊聊天吧~', false);
        }
    } else {
        const openers = ['主人陪我玩嘛~', '今天过得怎么样呀？', '想和你说说话~', '好无聊啊聊聊天吧~'];
        const reply = openers[Math.floor(Math.random() * openers.length)];
        const placeholder = chatLog.lastChild;
        if (placeholder) placeholder.remove();
        addChatMessage(reply, false);
        showMessage(reply);
        switchIllust(null);
        bounceIllust();
        stats.boredom = Math.max(0, stats.boredom - 20);
        stats.affection = Math.min(100, stats.affection + 1);
        showAffectionChange('+1');
        updateStatsDisplay();
    }
}

async function sendChatMessage(text) {
    addChatMessage(text, true);
    lastUserMessage = text;

    if (aiHasKey()) {
        try {
            const currentRoom = updateCurrentRoom();
            const statsStr = Object.entries(stats)
                .map(([k, v]) => `${statNames[k]}: ${Math.round(v)}%`)
                .join(', ');

            let memoryStr = '';
            if (config.enableMemory && memoryItems.length > 0) {
                memoryStr = '\n记忆：\n' + memoryItems.map((m, i) => `${i + 1}. ${m.text}`).join('\n');
            }

            const behaviorStr = getBehaviorLogStr();
            const ctxStr = await buildContextStr();

            // ===== 屏幕感知（多模态，按提供商判断是否有可用 Key） =====
            let screenContext = '';
            const mmProvider = config.multimodalProvider || 'deepseek';
            const mmHasKey = mmProvider === 'zhipu' ? !!config.zhipuApiKey : !!config.apiKey;
            if (config.multimodalEnabled && mmHasKey) {
                try {
                    const recent = chatHistory.slice(-15).map(m => 
                        `${m.role === 'user' ? '用户' : '桌宠'}: ${m.content}`
                    ).join('\n');
                    const capturePromise = window.electronAPI.captureScreen(recent);
                    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 30000));
                    screenContext = await Promise.race([capturePromise, timeoutPromise]);
                } catch (e) {
                    console.warn('Screen capture failed:', e);
                }
            }

            let systemPrompt = `${config.aiPrompt}
现在你在${ROOM_TYPES[currentRoom]?.name || '房间'}里。
当前状态：${statsStr}${memoryStr}${behaviorStr}${ctxStr}`;
            if (screenContext) {
                systemPrompt += `\n\n当前用户屏幕内容：${screenContext}`;
            }

            // 构建包含聊天历史的消息数组
            const messages = [
                {
                    role: 'system',
                    content: systemPrompt
                }
            ];

            // 添加聊天历史（无上限，保留全部对话）
            chatHistory.forEach(msg => {
                messages.push({
                    role: msg.role,
                    content: msg.content
                });
            });

            // 添加当前用户消息
            messages.push({
                role: 'user',
                content: text
            });

            // AI 请求路由统一走当前选中的提供商（DeepSeek / 智谱）
            const _ai = aiCredentials();
            let apiUrl = _ai.apiUrl, apiKey = _ai.apiKey, model = _ai.model;

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: model,
                    messages: messages,
                    max_tokens: 120,
                    temperature: 0.8
                })
            });

            const data = await response.json();
            const rawReply = data.choices[0].message.content;
            const reply = cleanReply(rawReply);
            const mood = parseMoodFromReply(rawReply);
            const cmdRoom = parseCommandFromReply(rawReply);

            // 保存到聊天历史
            chatHistory.push({ role: 'user', content: text });
            chatHistory.push({ role: 'assistant', content: reply });

            addChatMessage(reply, false);
            showMessage(reply);
            // 启用语音朗读时朗读回复
            if (config.voiceEnabled) {
                speakText(reply);
            }
            switchIllust(mood);
            bounceIllust();
            if (cmdRoom) {
                executeCommand(cmdRoom);
            }
            stats.happiness = Math.min(100, stats.happiness + 5);
            stats.boredom = Math.max(0, stats.boredom - 15);
            playCount = 0; // 与用户互动后重置玩耍递减计数
            changeAffection(mood);
            updateStatsDisplay();
            logBehavior('和主人聊天');

        } catch (error) {
            addChatMessage('网络有点问题呢...', false);
        }
    } else {
        const replies = [
            '你好呀！~',
            '在干嘛呢~',
            '陪我玩吧！',
            '好开心！',
            '嗯嗯~',
            '真的吗？',
            '哈哈哈~',
            '我也这么觉得！',
            '好呀好呀~',
            '嘻嘻嘻~'
        ];
        const reply = replies[Math.floor(Math.random() * replies.length)];
        addChatMessage(reply, false);
        showMessage(reply);
        if (config.voiceEnabled) {
            speakText(reply);
        }
        switchIllust(null);
        bounceIllust();
        stats.happiness = Math.min(100, stats.happiness + 3);
        stats.boredom = Math.max(0, stats.boredom - 15);
        playCount = 0; // 与用户互动后重置玩耍递减计数
        stats.affection = Math.min(100, stats.affection + 1);
        showAffectionChange('+1');
        updateStatsDisplay();
    }
}

let lastUserMessage = '';
let chatHistory = []; // 聊天历史记录，用于保持上下文

let isSummarizing = false; // 防重入锁

async function summarizeMemoryOnChatClose() {
    // 防重入锁：如果正在总结中，直接返回
    if (isSummarizing) return;
    if (!aiHasKey() || !config.enableMemory || chatHistory.length === 0) return;

    isSummarizing = true;
    const c = aiCredentials();
    try {
        // 1. 复制 chatHistory 并立即清空，防止后续操作触发重复总结
        const historySnapshot = chatHistory.slice();
        chatHistory = [];

        // 2. 构建完整对话记录
        const conversationText = historySnapshot
            .map(msg => msg.role === 'user' ? `用户：${msg.content}` : `桌宠：${msg.content}`)
            .join('\n');

        // 3. 已保存的记忆（长期），提示AI不要重复
        const existingMemoriesText = memoryItems.length > 0
            ? '\n\n已保存的记忆（请勿重复）：\n' + memoryItems.map((m, i) => `${i + 1}. ${m.text}`).join('\n')
            : '';

        const response = await fetch(c.apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${c.apiKey}`
            },
            body: JSON.stringify({
                model: c.model,
                messages: [
                    {
                        role: 'system',
                        content: `你是一个记忆助手。请根据以下完整对话内容，提取真正值得长期记忆的信息。

重要规则：
1. 只记录用户的偏好、重要事实、约定、重大事件等真正有长期价值的信息。
2. 不要总结"桌宠做了什么"、"今天聊了什么"等日常琐事，除非涉及非常重大的事件。
3. 如果没有值得长期记忆的信息，直接返回"无"。
4. 每个记忆要点不超过20字，每行一个。
5. 严格检查已保存的记忆，不要重复保存相同或高度相似的内容。

${existingMemoriesText}`
                    },
                    {
                        role: 'user',
                        content: `以下是完整对话记录：\n${conversationText}`
                    }
                ],
                max_tokens: 100,
                temperature: 0.5
            })
        });

        const data = await response.json();
        const summary = data.choices[0].message.content.trim();

        // 4. 解析多行记忆
        if (summary && summary !== '无') {
            const memories = summary
                .split('\n')
                .map(line => line.replace(/^\d+\.\s*/, '').trim())
                .filter(line => line.length > 1 && line !== '无');
            for (const m of memories) {
                await addMemoryItem(m);
            }
        }
    } catch (error) {
        // 静默失败
    } finally {
        isSummarizing = false;
    }
}

function addChatMessage(text, isUser) {
    const msg = document.createElement('div');
    msg.className = `chat-message ${isUser ? 'user' : 'from-pet'}`;

    let safeText = String(text == null ? '' : text);
    // 移除记忆标记、心情标记和指令标记
    safeText = safeText.replace(/\[MEMORY:\s*[^\]]+\]/g, '');
    safeText = safeText.replace(/\[SHORT_MEMORY:\s*[^\]]+\]/g, '');
    safeText = safeText.replace(/<MOOD:[^>]+>/g, '');
    safeText = safeText.replace(/<CMD:[^>]+>/g, '');
    safeText = safeText.replace(/<EFFECT:[^>]+>/g, '');
    safeText = safeText.replace(/<STATE:[^>]+>/g, '');
    // 移除零宽字符和不可见字符
    safeText = safeText.replace(/[\u200B-\u200F\uFEFF\u00AD\u2060\u180E\uFE00-\uFE0F\u2000-\u200A\u202F\u205F\u3000]+/g, ' ');
    // 移除 emoji variation selectors
    safeText = safeText.replace(/[\uFE0E\uFE0F]/g, '');
    // 将所有空白（含换行）替换为单个空格，让 CSS white-space: normal 处理换行
    safeText = safeText.replace(/\s+/g, ' ');
    safeText = safeText.trim();

    if (isUser) {
        msg.textContent = safeText;
    } else {
        // AI 消息支持图片渲染 ![alt](url)
        msg.innerHTML = renderMarkdown(safeText);
    }

    chatLog.appendChild(msg);
    chatLog.scrollTop = chatLog.scrollHeight;
}

function updateStats() {
    if (shouldPausePetActivity()) {
        return;
    }

    // 饥饿值衰减规则：
    // - 看电视（doing 阶段）：减慢（×0.33）
    // - 睡觉（doing 阶段）：不降低（×0）
    // - 吃饭后数分钟内：不降低（eatHungerFreezeUntil 冻结）
    // - 其余行为/空闲：正常衰减（×1）
    let hungerMult = 1;
    if (currentActivity && currentActivity.phase === 'doing') {
        if (currentActivity.type === 'sleep') hungerMult = 0;
        else if (currentActivity.type === 'watch_tv') hungerMult = 0.33;
    }
    if (Date.now() < eatHungerFreezeUntil) hungerMult = 0;

    stats.hunger = Math.max(0, stats.hunger - 0.9 * hungerMult);
    stats.energy = Math.max(0, stats.energy - 0.9);
    stats.bladder = Math.min(100, stats.bladder + 0.4);
    stats.hygiene = Math.max(0, stats.hygiene - 0.2);
    stats.boredom = Math.min(100, stats.boredom + 0.8);

    if (stats.happiness < 30 || stats.hunger < 20) {
        stats.happiness = Math.max(0, stats.happiness - 0.4);
    }

    // 行为进行中时不让低需求提示覆盖当前行为文案
    if (!currentActivity) {
        if (stats.hunger < 15) {
            updateActivityText('肚子好饿...');
        } else if (stats.energy < 20) {
            updateActivityText('好困呀...');
        } else if (stats.boredom > 47) {
            updateActivityText('好无聊...');
        } else if (stats.hygiene < 20) {
            updateActivityText('身上脏脏的...');
        }
    }

    updateStatsDisplay();
}

let saveStatsDebounce = null;
function debouncedSaveStats() {
    if (saveStatsDebounce) clearTimeout(saveStatsDebounce);
    saveStatsDebounce = setTimeout(() => {
        saveStats();
    }, 30000);
}

// ===== 拖动单摆旋转效果 =====
// 启动单摆动画循环
function startPendulum() {
    pendulumAngle = 0;
    pendulumVel = 0;
    pendulumTarget = 0;
    lastMouseClientX = 0;
    lastMouseTime = 0;
    petImg.classList.add('dragging');
    petImg.style.transition = '';
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

    const flip = petImg.classList.contains('flip') ? -1 : 1;
    const displayAngle = flip === -1 ? -pendulumAngle : pendulumAngle;
    if (flip === -1) {
        petImg.style.transform = `scaleX(-1) rotate(${displayAngle}deg)`;
    } else {
        petImg.style.transform = `rotate(${displayAngle}deg)`;
    }
    pendulumRAF = requestAnimationFrame(updatePendulum);
}

// 根据鼠标水平移动速度更新单摆目标角度
function feedPendulum(clientX) {
    const now = performance.now();
    if (lastMouseTime > 0) {
        const dt = Math.max(now - lastMouseTime, 1);
        const vx = (clientX - lastMouseClientX) / dt; // px/ms
        const target = Math.max(-40, Math.min(40, vx * 60));
        pendulumTarget = target;
    }
    lastMouseClientX = clientX;
    lastMouseTime = now;
}

// 停止单摆并平滑还原角度
function stopPendulum() {
    if (pendulumRAF) {
        cancelAnimationFrame(pendulumRAF);
        pendulumRAF = null;
    }
    petImg.classList.remove('dragging');
    // 平滑还原到 0
    petImg.style.transition = 'transform 0.3s ease';
    const flip = petImg.classList.contains('flip') ? -1 : 1;
    petImg.style.transform = flip === -1 ? 'scaleX(-1)' : '';
    setTimeout(() => {
        petImg.style.transition = '';
        petImg.style.transform = '';
    }, 320);
}

// 进入拖动状态：切换为被拖动图片
function enterDragState() {
    dragSavedFlip = petImg.classList.contains('flip');
    petImg.classList.remove('flip');
    const prevOnError = petImg.onerror;
    petImg.onerror = null;
    petImg.src = DRAG_PET_SRC();
    petImg.onerror = function() {
        petImg.src = ORIGINAL_PET_SRC();
        petImg.onerror = prevOnError;
    };
    startPendulum();
}

// 退出拖动状态：还原图片并记录拖动时间（触发 30 秒冷却）
function exitDragState() {
    stopPendulum();
    petImg.src = ORIGINAL_PET_SRC();
    if (dragSavedFlip) {
        petImg.classList.add('flip');
    }
    lastDragTime = Date.now();
    lastPetX = petX; // 同步方向基准，避免移动时翻转方向误判
}

pet.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isDragging = true;
    stopMoving();
    // 拖拽打断当前行为
    interruptActivity();
    const rect = pet.getBoundingClientRect();
    const houseRect = house.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;
    pet.style.transition = 'none';
    enterDragState();
    feedPendulum(e.clientX);
});

document.addEventListener('selectstart', (e) => {
    e.preventDefault();
});

document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
});

document.addEventListener('dragstart', (e) => {
    e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    const houseRect = house.getBoundingClientRect();
    const newX = e.clientX - houseRect.left - startX;
    const newY = e.clientY - houseRect.top - startY;

    // 取消拖拽碰撞限制：允许拖到家具上方（寻路逻辑仍受 isCellWalkable 约束，不会从家具地块穿过）
    petX = newX;
    petY = newY;

    updatePetPosition();
    updateCurrentRoom();
    feedPendulum(e.clientX);
});

document.addEventListener('mouseup', (e) => {
    if (isDragging) {
        isDragging = false;
        pet.style.transition = 'transform 0.05s linear';
        exitDragState();
        updateActivityText('被主人抱起来啦~');

        // 检测桌宠是否被拖到房子外：四个角都在房子外才算真正离开
        const houseRect = house.getBoundingClientRect();
        const petRect = pet.getBoundingClientRect();
        const petLeft = petRect.left;
        const petRight = petRect.right;
        const petTop = petRect.top;
        const petBottom = petRect.bottom;
        const isOutsideHouse = petRight < houseRect.left || petLeft > houseRect.right ||
                                petBottom < houseRect.top || petTop > houseRect.bottom;
        if (isOutsideHouse && window.electronAPI && window.electronAPI.minimizeAndMoveFloat) {
            // 使用 screen 坐标，因为主进程 setPosition 需要屏幕坐标
            window.electronAPI.minimizeAndMoveFloat(e.screenX, e.screenY);
        }
    }
});

pet.addEventListener('touchstart', (e) => {
    e.preventDefault();
    isDragging = true;
    stopMoving();
    // 拖拽打断当前行为
    interruptActivity();
    const touch = e.touches[0];
    const rect = pet.getBoundingClientRect();
    startX = touch.clientX - rect.left;
    startY = touch.clientY - rect.top;
    pet.style.transition = 'none';
    enterDragState();
    feedPendulum(touch.clientX);
}, { passive: false });

document.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    e.preventDefault();
    const touch = e.touches[0];
    const houseRect = house.getBoundingClientRect();

    const newX = touch.clientX - houseRect.left - startX;
    const newY = touch.clientY - houseRect.top - startY;

    // 取消拖拽碰撞限制：允许拖到家具上方（寻路逻辑仍受 isCellWalkable 约束，不会从家具地块穿过）
    petX = newX;
    petY = newY;

    updatePetPosition();
    updateCurrentRoom();
    feedPendulum(touch.clientX);
}, { passive: false });

document.addEventListener('touchend', () => {
    if (isDragging) {
        isDragging = false;
        pet.style.transition = 'transform 0.05s linear';
        exitDragState();
        updateActivityText('被主人抱起来啦~');
    }
});

pet.addEventListener('click', (e) => {
    if (!isDragging) {
        createHeart();
        stats.happiness = Math.min(100, stats.happiness + 8);
        stats.boredom = Math.max(0, stats.boredom - 10);
        updateStatsDisplay();
        showMessage('嘻嘻~');
    }
});

// 右下角按钮触发对应事件链：🍖吃饭 🛏️睡觉 🚿洗澡 🚽上厕所 📺看电视；🛋️保留为去客厅闲逛
goBedroomBtn.addEventListener('click', () => { interruptActivity(); startSleep(); });
goBathroomBtn.addEventListener('click', () => { interruptActivity(); startBathe(); });
if (toiletBtn) {
    toiletBtn.addEventListener('click', () => { interruptActivity(); startToilet(); });
}
goLivingBtn.addEventListener('click', () => { interruptActivity(); moveTo('living', () => onArriveRoom('living')); });
feedBtn.addEventListener('click', () => { interruptActivity(); startEat(); });
if (watchTvBtn) {
    watchTvBtn.addEventListener('click', () => { interruptActivity(); startWatchTv(); });
}

// 编辑房子按钮：打开网格编辑器（openGridEditor 由 grid-editor.js 提供）
if (editHouseBtn) {
    editHouseBtn.addEventListener('click', () => {
        // 打开网格编辑器会 renderGrid 重建家具 DOM，必须先打断当前行为并还原贴图
        interruptActivity();
        if (typeof openGridEditor === 'function') {
            openGridEditor();
        }
    });
}

// 统一关闭聊天面板，避免重复触发记忆总结
function closeChatPanel() {
    if (!chatPanel.classList.contains('show')) return;
    chatPanel.classList.remove('show');
    hideIllust();
    summarizeMemoryOnChatClose();
    // chatHistory 在 summarizeMemoryOnChatClose 内部已清空
    setTimeout(() => {
        chatLog.innerHTML = '';
    }, 500);
}

if (chatBtn) {
    chatBtn.addEventListener('click', () => {
        if (chatPanel.classList.contains('show')) {
            closeChatPanel();
        } else {
            chatPanel.classList.add('show');
            stopMoving();
            decideMoodByState();
        }
    });
}

// 陪伴模式按钮
const companionBtn = document.getElementById('companionBtn');
if (companionBtn) {
    companionBtn.addEventListener('click', () => {
        if (window.electronAPI) {
            window.electronAPI.enterCompanionMode();
            window.electronAPI.minimizeWindow();
        }
    });
}

// 打开浮窗聊天按钮（最小化主窗口，自动触发浮窗创建）
const openFloatBtn = document.getElementById('openFloatBtn');
if (openFloatBtn) {
    openFloatBtn.addEventListener('click', () => {
        chatPanel.classList.add('show');
        stopMoving();
        decideMoodByState();
    });
}

closeChat.addEventListener('click', () => {
    closeChatPanel();
});

// ===== 图片点击保存 =====
chatLog.addEventListener('click', async (e) => {
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

sendBtn.addEventListener('click', () => {
    const text = inputText.value.trim();
    if (text) {
        sendChatMessage(text);
        inputText.value = '';
    }
});

inputText.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendBtn.click();
    }
});

// 保存聊天记录按钮
const saveChatBtn = document.getElementById('saveChatBtn');
if (saveChatBtn) {
    saveChatBtn.addEventListener('click', async () => {
        if (chatHistory.length === 0) {
            showMessage('没有聊天记录可保存');
            return;
        }
        const now = new Date();
        const time = now.toLocaleString('zh-CN', { hour12: false });
        const lines = chatHistory.map(m => `[${time}] ${m.role === 'user' ? '用户' : '桌宠'}: ${m.content}`);
        const content = lines.join('\n');
        try {
            const result = await window.electronAPI.saveChatLog(content);
            if (result.success) {
                showMessage(`聊天记录已保存到 ${result.path}`);
            } else if (!result.canceled) {
                showMessage('保存失败');
            }
        } catch (e) {
            showMessage('保存失败: ' + (e.message || ''));
        }
    });
}

// 监听配置更新（主进程广播，float/设置窗口改动时触发）→ 全量合并并重新应用 UI
if (window.electronAPI && window.electronAPI.onConfigUpdated) {
    window.electronAPI.onConfigUpdated((data) => {
        if (data) {
            config = { ...config, ...data };
            if (data.stickerPack !== undefined) window._stickerPack = data.stickerPack;
            // 持久化到 localStorage，避免刷新后丢失
            localStorage.setItem('petConfig', JSON.stringify(config));
            applyConfig();
            console.log('[index] 配置已更新:', data);
        }
    });
}

// 监听家里(主窗口)专属设置更新（统一设置窗口改动时由主进程广播）→ 实时重新应用
if (window.electronAPI && window.electronAPI.onHomeSettingsUpdated) {
    window.electronAPI.onHomeSettingsUpdated((data) => {
        if (!data) return;
        if (data.windowOpacity !== undefined) config.windowOpacity = data.windowOpacity;
        if (data.wallOpacity !== undefined) config.wallOpacity = data.wallOpacity;
        if (data.floorOpacity !== undefined) config.floorOpacity = data.floorOpacity;
        if (data.mainPetSize !== undefined) config.mainPetSize = data.mainPetSize;
        if (data.furnitureSize !== undefined) config.furnitureSize = data.furnitureSize;
        if (data.buttonSize !== undefined) config.buttonSize = data.buttonSize;
        if (data.portraitAuto !== undefined) config.portraitAuto = data.portraitAuto;
        if (data.companionWidth !== undefined) config.companionWidth = data.companionWidth;
        localStorage.setItem('petConfig', JSON.stringify(config));
        applyConfig();
    });
}

buttonSizeSlider.addEventListener('input', (e) => {
    config.buttonSize = parseInt(e.target.value);
    updateButtonSize(config.buttonSize);
});

mainPetSizeSlider.addEventListener('input', (e) => {
    config.mainPetSize = parseFloat(e.target.value);
    mainPetSizeValue.textContent = config.mainPetSize;
    applySizeSettings();
});

floatPetSizeSlider.addEventListener('input', (e) => {
    config.floatPetSize = parseInt(e.target.value);
    floatPetSizeValue.textContent = config.floatPetSize;
    applySizeSettings();
});

floatMoveModeSelect.addEventListener('change', (e) => {
    config.floatMoveMode = e.target.value;
    if (window.electronAPI && window.electronAPI.setFloatMoveMode) {
        window.electronAPI.setFloatMoveMode(config.floatMoveMode);
    }
});

bounceWindowsToggle.addEventListener('change', (e) => {
    config.bounceWindows = e.target.checked;
    if (window.electronAPI && window.electronAPI.setFloatBounceWindows) {
        window.electronAPI.setFloatBounceWindows(config.bounceWindows);
    }
});

cookieSpawnToggle.addEventListener('change', (e) => {
    config.cookieSpawnEnabled = e.target.checked;
    if (window.electronAPI && window.electronAPI.setCookieSpawnEnabled) {
        window.electronAPI.setCookieSpawnEnabled(config.cookieSpawnEnabled);
    }
});

// 饼干大小调整
const cookieSizeSlider = document.getElementById('cookieSizeSlider');
const cookieSizeValue = document.getElementById('cookieSizeValue');
if (cookieSizeSlider) {
    cookieSizeSlider.addEventListener('input', (e) => {
        config.cookieSize = parseInt(e.target.value);
        cookieSizeValue.textContent = config.cookieSize;
        if (window.electronAPI && window.electronAPI.setCookieSize) {
            window.electronAPI.setCookieSize(config.cookieSize);
        }
    });
}

// 行为保持概率调整（开发者模式）
const behaviorKeepProbSlider = document.getElementById('behaviorKeepProbSlider');
const behaviorKeepProbValue = document.getElementById('behaviorKeepProbValue');
if (behaviorKeepProbSlider) {
    behaviorKeepProbSlider.addEventListener('input', (e) => {
        config.behaviorKeepProb = parseInt(e.target.value);
        behaviorKeepProbValue.textContent = config.behaviorKeepProb + '%';
        if (window.electronAPI) {
            window.electronAPI.send('set-behavior-keep-prob', config.behaviorKeepProb);
        }
    });
}

// 同步饼干大小更新
if (window.electronAPI && window.electronAPI.onCookieSizeUpdated) {
    window.electronAPI.onCookieSizeUpdated((size) => {
        if (typeof size === 'number' && cookieSizeSlider) {
            config.cookieSize = size;
            cookieSizeSlider.value = size;
            cookieSizeValue.textContent = size;
        }
    });
}

// ===== 双击Ctrl生成饼干（由主进程 before-input-event 处理，此处仅保留兼容） =====

floatShowIllustToggle.addEventListener('change', (e) => {
    config.floatShowIllust = e.target.checked;
    if (window.electronAPI && window.electronAPI.setFloatShowIllust) {
        window.electronAPI.setFloatShowIllust(config.floatShowIllust);
    }
});

furnitureSizeSlider.addEventListener('input', (e) => {
    config.furnitureSize = parseFloat(e.target.value);
    furnitureSizeValue.textContent = config.furnitureSize;
    applySizeSettings();
});

devModeToggle.addEventListener('change', (e) => {
    toggleDevMode(e.target.checked);
    // 同步开发者模式状态到浮窗
    if (window.electronAPI) {
        window.electronAPI.send('set-dev-mode', e.target.checked);
    }
});

// 窗口透明度实时预览（只影响背景、状态栏、按钮，不影响桌宠/地板/墙面/家具）
if (windowOpacitySlider) {
    windowOpacitySlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value) / 100;
        windowOpacityValue.textContent = e.target.value + '%';
        document.documentElement.style.setProperty('--window-opacity', val);
        // 实时同步到主进程（实际设置 Electron 窗口透明度）
        if (window.electronAPI && window.electronAPI.setWindowOpacity) {
            window.electronAPI.setWindowOpacity(val);
        }
    });
}

// 墙面透明度实时预览
if (wallOpacitySlider) {
    wallOpacitySlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value) / 100;
        wallOpacityValue.textContent = e.target.value + '%';
        document.documentElement.style.setProperty('--wall-opacity', val);
    });
}

// 地板透明度实时预览
if (floorOpacitySlider) {
    floorOpacitySlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value) / 100;
        floorOpacityValue.textContent = e.target.value + '%';
        document.documentElement.style.setProperty('--floor-opacity', val);
    });
}

// ===== 多模态事件监听 =====
(function initMultimodalUI() {
    const multimodalToggle = document.getElementById('multimodalToggle');
    const multimodalProviderSelect = document.getElementById('multimodalProviderSelect');
    const zhipuApiUrlInput = document.getElementById('zhipuApiUrlInput');

    if (multimodalProviderSelect) {
        multimodalProviderSelect.addEventListener('change', () => {
            config.multimodalProvider = multimodalProviderSelect.value;
            if (config.multimodalProvider === 'zhipu' && !config.zhipuApiUrl) {
                config.zhipuApiUrl = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
            } else if (config.multimodalProvider === 'deepseek' && !config.apiUrl) {
                config.apiUrl = 'https://api.deepseek.com/v1/chat/completions';
            }
            saveConfig();
        });
    }
    if (zhipuApiUrlInput) {
        zhipuApiUrlInput.addEventListener('change', () => {
            config.zhipuApiUrl = zhipuApiUrlInput.value.trim() || 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
            saveConfig();
        });
    }
})();

applyStatsBtn.addEventListener('click', () => {
    // 保存状态数据
    applyStatsChanges();
    // 保存所有配置设置
    config.apiKey = apiKeyInput.value.trim();
    config.apiUrl = apiUrlInput.value.trim();
    config.aiDecide = aiDecideToggle.checked;
    config.buttonSize = parseInt(buttonSizeSlider.value);
    config.portraitAuto = portraitToggle.checked;
    config.devMode = devModeToggle.checked;
    config.mainPetSize = parseFloat(mainPetSizeSlider.value);
    config.floatPetSize = parseInt(floatPetSizeSlider.value);
    config.floatMoveMode = floatMoveModeSelect ? floatMoveModeSelect.value : 'free';
    config.bounceWindows = bounceWindowsToggle ? bounceWindowsToggle.checked : false;
    config.cookieSpawnEnabled = cookieSpawnToggle ? cookieSpawnToggle.checked : true;
    config.cookieSize = cookieSizeSlider ? parseInt(cookieSizeSlider.value) : 80;
    config.behaviorKeepProb = behaviorKeepProbSlider ? parseInt(behaviorKeepProbSlider.value) : 60;
    config.furnitureSize = parseFloat(furnitureSizeSlider.value);
    config.aiPrompt = aiPromptInput.value.trim();
    config.enableMemory = memoryToggle.checked;
    config.gridViewMode = 'diamond';
    config.windowOpacity = windowOpacitySlider ? parseInt(windowOpacitySlider.value) / 100 : 1;
    config.wallOpacity = wallOpacitySlider ? parseInt(wallOpacitySlider.value) / 100 : 1;
    config.floorOpacity = floorOpacitySlider ? parseInt(floorOpacitySlider.value) / 100 : 1;
    // 多模态配置
    const multimodalToggle = document.getElementById('multimodalToggle');
    const multimodalProviderSelect = document.getElementById('multimodalProviderSelect');
    const zhipuApiKeyInput = document.getElementById('zhipuApiKeyInput');
    const zhipuApiUrlInput = document.getElementById('zhipuApiUrlInput');
    config.multimodalEnabled = multimodalToggle ? multimodalToggle.checked : false;
    config.multimodalProvider = multimodalProviderSelect ? multimodalProviderSelect.value : 'deepseek';
    config.zhipuApiKey = zhipuApiKeyInput ? zhipuApiKeyInput.value.trim() : '';
    config.zhipuApiUrl = zhipuApiUrlInput ? zhipuApiUrlInput.value.trim() : '';
    // 陪伴模式设置
    const companionWidthSlider = document.getElementById('companionWidthSlider');
    const companionHeightSlider = document.getElementById('companionHeightSlider');
    const companionFontSizeSlider = document.getElementById('companionFontSizeSlider');
    const companionPetSizeSlider = document.getElementById('companionPetSizeSlider');
    config.companionWidth = companionWidthSlider ? parseInt(companionWidthSlider.value) : 400;
    config.companionHeight = companionHeightSlider ? parseInt(companionHeightSlider.value) : 350;
    config.companionFontSize = companionFontSizeSlider ? parseInt(companionFontSizeSlider.value) : 14;
    config.companionPetSize = companionPetSizeSlider ? parseInt(companionPetSizeSlider.value) : 180;
    // 语音设置
    const voiceToggle = document.getElementById('voiceToggle');
    const voiceAutoSendToggle = document.getElementById('voiceAutoSendToggle');
    const voiceSelect = document.getElementById('voiceSelect');
    config.voiceEnabled = voiceToggle ? voiceToggle.checked : true;
    config.voiceAutoSend = voiceAutoSendToggle ? voiceAutoSendToggle.checked : true;
    config.selectedVoice = voiceSelect ? voiceSelect.value : 'default';
    const voiceVolumeSlider = document.getElementById('voiceVolumeSlider');
    config.voiceVolume = voiceVolumeSlider ? parseInt(voiceVolumeSlider.value) / 100 : 1.0;
    saveConfig();
    // 同步到主进程
    if (window.electronAPI) {
        if (window.electronAPI.setZhipuKey) window.electronAPI.setZhipuKey(config.zhipuApiKey);
        if (window.electronAPI.setMultimodalEnabled) window.electronAPI.setMultimodalEnabled(config.multimodalEnabled);
        window.electronAPI.send('set-dev-mode', config.devMode);
        window.electronAPI.send('set-behavior-keep-prob', config.behaviorKeepProb);
        window.electronAPI.send('set-ai-prompt', config.aiPrompt);
    }
    showMessage('所有设置已保存！');
});

// 行为记录容量设置（开发者模式下可修改）
const behaviorLogMaxInput = document.getElementById('behaviorLogMaxInput');
const applyBehaviorLogMaxBtn = document.getElementById('applyBehaviorLogMaxBtn');
if (behaviorLogMaxInput) {
    behaviorLogMaxInput.value = config.behaviorLogMax || 50;
}
if (applyBehaviorLogMaxBtn) {
    applyBehaviorLogMaxBtn.addEventListener('click', () => {
        const val = parseInt(behaviorLogMaxInput.value, 10);
        if (val >= 10 && val <= 500) {
            config.behaviorLogMax = val;
            saveConfig();
            // 裁剪超出容量的旧记录
            while (behaviorLog.length > config.behaviorLogMax) {
                behaviorLog.shift();
            }
            renderBehaviorLog();
        }
    });
}

document.querySelectorAll('.stat-slider').forEach(slider => {
    slider.addEventListener('input', (e) => {
        syncStatSlider(e.target.dataset.stat);
    });
});

document.querySelectorAll('.stat-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        adjustStat(e.target.dataset.stat, e.target.dataset.op);
    });
});

addMemoryBtn.addEventListener('click', showMemoryModal);

memoryModalCancel.addEventListener('click', hideMemoryModal);

memoryModalConfirm.addEventListener('click', async () => {
    const text = memoryModalInput.value.trim();
    if (text) {
        await addMemoryItem(text);
    }
    hideMemoryModal();
});

memoryModalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        memoryModalConfirm.click();
    }
    if (e.key === 'Escape') {
        hideMemoryModal();
    }
});

saveGameBtn.addEventListener('click', saveGame);
loadGameBtn.addEventListener('click', loadGame);
exportSaveBtn.addEventListener('click', exportSave);
importSaveBtn.addEventListener('click', importSave);

memoryModal.addEventListener('click', (e) => {
    if (e.target === memoryModal) {
        hideMemoryModal();
    }
});

document.querySelectorAll('.furniture').forEach(furn => {
    furn.addEventListener('click', (e) => {
        e.stopPropagation();
        const emoji = furn.textContent.trim();
        
        const messages = {
            '🛋️': '沙发好舒服~',
            '📺': '这个节目好好看！',
            '☕': '来杯咖啡吧~',
            '🛏️': '有点困了呢...',
            '💡': '灯光明亮~',
            '🍳': '闻起来好香！',
            '🚰': '咕噜咕噜~',
            '🧊': '冰冰凉凉的~',
            '🚿': '想洗澡了~',
            '🚽': '...',
            '🪥': '刷刷牙~',
            '🫧': '洗衣服咯~',
            '🪴': '好可爱的植物~',
            '🚪': '这是衣柜吗？'
        };
        
        if (messages[emoji]) {
            showMessage(messages[emoji]);
            stats.happiness = Math.min(100, stats.happiness + 2);
            updateStatsDisplay();
        }
    });
});

house.addEventListener('click', (e) => {
    // 点击交互元素时不触发移动
    if (e.target.closest('.furniture, .pet, .action-btn, .icon-btn, .chat-panel, .settings-panel, button, input, .stats-panel, .bottom-controls, .top-bar, .speech')) {
        return;
    }
    const houseRect = house.getBoundingClientRect();
    const clickX = e.clientX - houseRect.left;
    const clickY = e.clientY - houseRect.top;

    // 菱形模式下点击位置即脚部 y 坐标
    if (config.gridViewMode === 'diamond') {
        moveToPosition(clickX - petWidth / 2, clickY);
    } else {
        moveToPosition(clickX - petWidth / 2, clickY - petHeight / 2);
    }
});

house.addEventListener('touchstart', (e) => {
    // 点击交互元素时不触发移动
    if (e.target.closest('.furniture, .pet, .action-btn, .icon-btn, .chat-panel, .settings-panel, button, input, .stats-panel, .bottom-controls, .top-bar, .speech')) {
        return;
    }
    const touch = e.touches[0];
    const houseRect = house.getBoundingClientRect();
    const clickX = touch.clientX - houseRect.left;
    const clickY = touch.clientY - houseRect.top;

    // 菱形模式下点击位置即脚部 y 坐标
    if (config.gridViewMode === 'diamond') {
        moveToPosition(clickX - petWidth / 2, clickY);
    } else {
        moveToPosition(clickX - petWidth / 2, clickY - petHeight / 2);
    }
}, { passive: true });

let lastWindowRatio = window.innerWidth / window.innerHeight;

// 窗口 resize 防抖：恢复/拖动过程中 Electron 会高频触发 resize 事件，
// 每次都执行 updateGridLayout() 等重布局会阻塞主线程导致卡顿，故统一防抖到停顿后执行一次
let windowResizeTimer = null;
window.addEventListener('resize', () => {
    if (windowResizeTimer) clearTimeout(windowResizeTimer);
    windowResizeTimer = setTimeout(() => {
        if (windowResizeTimer) {
            clearTimeout(windowResizeTimer);
            windowResizeTimer = null;
        }
        handleWindowResize();
    }, 150);
});

// handleWindowResize 重入锁：恢复流程中 resize 事件和 onWindowRestored 可能几乎同时触发，
// 导致 renderGrid 被重复执行，延长空白时间。
let isHandlingWindowResize = false;
function handleWindowResize() {
    // 调整窗口打断当前行为（renderGrid 会重建家具 DOM，还原变体贴图，故必须打断）
    interruptActivity();
    // 恢复保护期：restore 动画过程中可能读到异常尺寸，期间跳过所有重量级操作，
    // 避免触发 renderGrid（重建 300+ DOM）阻塞主线程导致桌宠 setInterval 积压跳跃。
    // 保护期由 onWindowRestored 设置，持续 600ms。
    if (restoreGracePeriod) return;
    if (isHandlingWindowResize) return;
    isHandlingWindowResize = true;
    try {
        checkPortraitMode();
        updatePetSize();
        updateMoveSpeed();
        updateGridLayout();

        const houseRect = house.getBoundingClientRect();
        const currentRatio = window.innerWidth / window.innerHeight;
        // 窗口大小比例变化时，桌宠移动到客厅的一个格子
        if (Math.abs(currentRatio - lastWindowRatio) > 0.05) {
            const livingCell = getRandomRoomCell('living');
            if (livingCell) {
                const pos = gridToScreen(livingCell.col, livingCell.row, gridCellSize, gridOffsetX, gridOffsetY, config.gridViewMode);
                petX = pos.x - petWidth / 2;
                if (config.gridViewMode === 'diamond') {
                    petY = pos.y + gridCellSize / 4;
                } else {
                    petY = pos.y - petHeight / 2;
                }
            } else {
                petX = houseRect.width / 2 - petWidth / 2;
                petY = houseRect.height / 2 - petHeight / 2;
            }
        }
        lastWindowRatio = currentRatio;

        petX = Math.max(0, Math.min(houseRect.width - petWidth, petX));
        petY = Math.max(0, Math.min(houseRect.height - petHeight, petY));

        if (checkCollision(petX, petY)) {
            fixPetPosition();
        }

        updatePetPosition();
        updateCurrentRoom();
    } finally {
        isHandlingWindowResize = false;
    }
}

// 监听主进程的窗口尺寸变化：窗口过小时自动最小化并唤起浮窗
// restoreGracePeriod：窗口刚恢复时给一个保护期，期间忽略过小尺寸读数（restore 动画过程中可能读到异常小值）
let restoreGracePeriod = false;

if (window.electronAPI && window.electronAPI.onMainWindowResize) {
    window.electronAPI.onMainWindowResize((info) => {
        if (!info || info.isMinimized || info.isFullScreen) return;
        // 恢复保护期内不触发自动最小化，避免 restore 动画的异常尺寸读数引起循环
        if (restoreGracePeriod) return;
        // 自动最小化阈值（接近浮窗大小）
        if (info.width <= 240 || info.height <= 200) {
            if (window.electronAPI && window.electronAPI.minimizeWindow) {
                window.electronAPI.minimizeWindow();
            }
        }
    });
}

function fixPetPosition() {
    const houseRect = house.getBoundingClientRect();
    const step = 5;
    
    const directions = [
        { dx: 0, dy: -step },
        { dx: 0, dy: step },
        { dx: -step, dy: 0 },
        { dx: step, dy: 0 },
        { dx: -step, dy: -step },
        { dx: step, dy: -step },
        { dx: -step, dy: step },
        { dx: step, dy: step }
    ];
    
    for (let radius = 1; radius <= 50; radius++) {
        for (const dir of directions) {
            const newX = petX + dir.dx * radius;
            const newY = petY + dir.dy * radius;

            // 菱形模式下 petY 是脚部位置
            const maxY = (config.gridViewMode === 'diamond') ? houseRect.height : (houseRect.height - petHeight);
            if (newX >= 0 && newX <= houseRect.width - petWidth &&
                newY >= 0 && newY <= maxY &&
                !checkCollision(newX, newY)) {
                petX = newX;
                petY = newY;
                updatePetPosition();
                return;
            }
        }
    }

    petX = houseRect.width / 2 - petWidth / 2;
    if (config.gridViewMode === 'diamond') {
        petY = houseRect.height / 2;
    } else {
        petY = houseRect.height / 2 - petHeight / 2;
    }
    updatePetPosition();
}

let statsInterval = setInterval(() => {
    if (shouldPausePetActivity()) {
        return;
    }

    updateStats();
    debouncedSaveStats();
    checkRandomEvent();

    // 行为进行中时不弹"好无聊"提示，避免覆盖行为文案
    if (!currentActivity) {
        const otherNeedsUrgent = stats.hunger < 50 || stats.energy < 45 ||
            stats.bladder > 45 || stats.hygiene < 55;
        if (stats.boredom > 47 && !otherNeedsUrgent && !persistentSpeechActive) {
            showPersistentSpeech('💬');
            updateActivityText('好无聊...');
        }
    }
}, 5000);

let decideInterval = setInterval(() => {
    // 有行为进行中时不触发新决策
    if (!currentActivity && !shouldPausePetActivity() && !isDragging && !isMoving) {
        decideDestination();
    }
}, 15000);

// ===== 程序管理 =====
let programEditTarget = null; // 当前编辑描述的目标程序 ID
let programDeleteTarget = null; // 当前删除确认的目标程序 ID

// 渲染程序列表
async function renderProgramList() {
    const programList = document.getElementById('programList');
    if (!programList) return;
    if (!window.electronAPI || !window.electronAPI.executeTool) {
        programList.innerHTML = '<div class="program-empty">无法连接主进程</div>';
        return;
    }
    try {
        const result = await window.electronAPI.executeTool('list_programs', {});
        if (!result || !result.success) {
            programList.innerHTML = '<div class="program-empty">获取程序列表失败</div>';
            return;
        }
        const programs = result.data || [];
        if (programs.length === 0) {
            programList.innerHTML = '<div class="program-empty">暂无程序，让 AI 生成一个吧~</div>';
            return;
        }
        programList.innerHTML = programs.map(p => `
            <div class="program-item" data-id="${p.id}">
                <div class="program-item-header">
                    <span class="program-item-name">${p.name}</span>
                    <span class="program-item-type">${p.id}</span>
                </div>
                <div class="program-item-desc">${p.description || '无描述'}</div>
                <div class="program-item-tags">
                    ${(p.tags || []).map(t => `<span class="program-item-tag">${t}</span>`).join('')}
                </div>
                <div class="program-item-actions">
                    <button class="program-item-btn edit" data-id="${p.id}">编辑描述</button>
                    <button class="program-item-btn run" data-id="${p.id}">运行</button>
                    <button class="program-item-btn export" data-id="${p.id}">导出</button>
                    <button class="program-item-btn delete" data-id="${p.id}">删除</button>
                </div>
            </div>
        `).join('');

        // 绑定事件
        programList.querySelectorAll('.program-item-btn.edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                showProgramDescEditModal(btn.dataset.id);
            });
        });
        programList.querySelectorAll('.program-item-btn.run').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                runProgramById(btn.dataset.id);
            });
        });
        programList.querySelectorAll('.program-item-btn.export').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                exportProgram(btn.dataset.id);
            });
        });
        programList.querySelectorAll('.program-item-btn.delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                showProgramDeleteModal(btn.dataset.id);
            });
        });
    } catch (e) {
        programList.innerHTML = '<div class="program-empty">加载失败：' + (e.message || '') + '</div>';
    }
}

// 显示编辑描述弹窗
function showProgramDescEditModal(id) {
    programEditTarget = id;
    const existing = document.getElementById('programDescEditModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'program-desc-edit-modal';
    modal.id = 'programDescEditModal';
    modal.innerHTML = `
        <div class="program-desc-edit-content">
            <div class="program-desc-edit-title">编辑程序描述</div>
            <textarea class="program-desc-edit-input" id="programDescEditInput" rows="3" placeholder="输入新的描述..."></textarea>
            <div class="program-desc-edit-buttons">
                <button class="program-desc-edit-btn cancel" id="programDescEditCancel">取消</button>
                <button class="program-desc-edit-btn confirm" id="programDescEditConfirm">确定</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('programDescEditCancel').addEventListener('click', () => modal.remove());
    document.getElementById('programDescEditConfirm').addEventListener('click', async () => {
        const input = document.getElementById('programDescEditInput');
        const newDesc = input.value.trim();
        if (!newDesc) return;
        try {
            const result = await window.electronAPI.executeTool('edit_program_description', {
                id: programEditTarget,
                new_description: newDesc
            });
            if (result && result.success) {
                showMessage('描述已更新');
            } else {
                showMessage('更新失败：' + (result?.error || ''));
            }
        } catch (e) {
            showMessage('更新失败：' + (e.message || ''));
        }
        modal.remove();
        renderProgramList();
    });
    // 点击遮罩关闭
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
    setTimeout(() => document.getElementById('programDescEditInput').focus(), 50);
}

// 显示删除确认弹窗
function showProgramDeleteModal(id) {
    programDeleteTarget = id;
    const existing = document.getElementById('programDeleteModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'program-delete-modal';
    modal.id = 'programDeleteModal';
    modal.innerHTML = `
        <div class="program-delete-content">
            <div class="program-delete-title">确认删除</div>
            <div class="program-delete-text">确定要删除程序"${id}"及其所有文件吗？此操作不可撤销。</div>
            <div class="program-delete-buttons">
                <button class="program-delete-btn cancel" id="programDeleteCancel">取消</button>
                <button class="program-delete-btn confirm" id="programDeleteConfirm">确认删除</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('programDeleteCancel').addEventListener('click', () => modal.remove());
    document.getElementById('programDeleteConfirm').addEventListener('click', async () => {
        try {
            const result = await window.electronAPI.executeTool('delete_program', { id: programDeleteTarget });
            if (result && result.success) {
                showMessage('程序已删除');
            } else {
                showMessage('删除失败：' + (result?.error || ''));
            }
        } catch (e) {
            showMessage('删除失败：' + (e.message || ''));
        }
        modal.remove();
        renderProgramList();
    });
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}

// 运行程序
async function runProgramById(id) {
    try {
        const result = await window.electronAPI.executeTool('run_program', { id, params: {} });
        if (result && result.success) {
            const data = result.data;
            // HTML 程序：浏览器已打开，简单提示
            if (data.stdout === '已在浏览器中打开') {
                showProgramToast(`程序"${id}"已通过浏览器打开`, 'success');
                return;
            }
            let msg = `程序"${id}"执行完成`;
            if (data.stdout) msg += `\n输出：${data.stdout.substring(0, 200)}`;
            if (data.stderr) msg += `\n错误：${data.stderr.substring(0, 200)}`;
            if (data.exitCode !== 0) msg += `\n退出码：${data.exitCode}`;
            showProgramToast(msg, 'success');
        } else {
            showProgramToast('执行失败：' + (result?.error || ''), 'error');
        }
    } catch (e) {
        showProgramToast('执行失败：' + (e.message || ''), 'error');
    }
}

// 导出程序（打开程序文件夹）
async function exportProgram(id) {
    if (!window.electronAPI || !window.electronAPI.executeTool) {
        showProgramToast('无法连接主进程', 'error');
        return;
    }
    try {
        const result = await window.electronAPI.executeTool('export_program', { id });
        if (result && result.success) {
            showProgramToast(`程序"${id}"的文件夹已打开`, 'success');
        } else {
            showProgramToast(result?.error || '导出失败', 'error');
        }
    } catch (e) {
        showProgramToast('导出失败：' + (e.message || ''), 'error');
    }
}

// 刷新按钮事件
(function() {
    const refreshBtn = document.getElementById('refreshProgramsBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => renderProgramList());
    }
})();

// 手动添加程序按钮事件
(function() {
    const addBtn = document.getElementById('addProgramBtn');
    if (addBtn) {
        addBtn.addEventListener('click', showAddProgramModal);
    }
})();

// ===== 手动添加程序弹窗 =====
function showAddProgramModal() {
    const existing = document.querySelector('.program-add-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'program-add-modal';
    modal.innerHTML = `
        <div class="program-add-content">
            <div class="program-add-title">手动添加程序</div>
            <div class="program-add-field">
                <label>程序名称 *</label>
                <input type="text" id="addProgName" placeholder="如：文件分类器" />
            </div>
            <div class="program-add-field">
                <label>程序 ID（可选，留空自动生成）</label>
                <input type="text" id="addProgId" placeholder="如：file_organizer" />
                <div class="program-add-hint">仅允许字母、数字、下划线</div>
            </div>
            <div class="program-add-field">
                <label>功能描述 *</label>
                <input type="text" id="addProgDesc" placeholder="用一句话描述程序功能" />
            </div>
            <div class="program-add-field">
                <label>标签（可选，逗号分隔）</label>
                <input type="text" id="addProgTags" placeholder="如：工具, 文件管理" />
            </div>
            <div class="program-add-field">
                <label>类型</label>
                <select id="addProgType">
                    <option value="python">Python</option>
                    <option value="javascript">JavaScript</option>
                    <option value="bash">Bash</option>
                    <option value="html">HTML</option>
                </select>
            </div>
            <div class="program-add-field">
                <label>代码内容（可选）</label>
                <textarea id="addProgCode" rows="8" placeholder="粘贴代码内容，留空则仅注册元信息"></textarea>
            </div>
            <div class="program-add-buttons">
                <button class="program-add-btn cancel" id="addProgCancel">取消</button>
                <button class="program-add-btn confirm" id="addProgConfirm">确定</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // 点击取消关闭
    modal.querySelector('#addProgCancel').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });

    // 点击确定提交
    modal.querySelector('#addProgConfirm').addEventListener('click', async () => {
        const name = modal.querySelector('#addProgName').value.trim();
        const id = modal.querySelector('#addProgId').value.trim();
        const description = modal.querySelector('#addProgDesc').value.trim();
        const tagsStr = modal.querySelector('#addProgTags').value.trim();
        const type = modal.querySelector('#addProgType').value;
        const code = modal.querySelector('#addProgCode').value.trim();

        // 基本校验
        if (!name) {
            showProgramToast('请输入程序名称', 'error');
            return;
        }
        if (!description) {
            showProgramToast('请输入功能描述', 'error');
            return;
        }
        // ID 校验
        if (id && !/^[a-zA-Z0-9_]+$/.test(id)) {
            showProgramToast('程序 ID 只能包含字母、数字和下划线', 'error');
            return;
        }

        const data = { name, description, type };
        if (id) data.id = id;
        if (tagsStr) data.tags = tagsStr.split(',').map(t => t.trim()).filter(Boolean);

        try {
            // 有代码内容时使用 save_program（保存代码+注册），否则使用 add_program（仅注册）
            const toolName = code ? 'save_program' : 'add_program';
            if (code) data.code = code;
            const result = await window.electronAPI.executeTool(toolName, data);
            if (result && result.success) {
                modal.remove();
                showProgramToast(`程序"${name}"添加成功`, 'success');
                renderProgramList();
            } else {
                showProgramToast(result?.error || '添加失败', 'error');
            }
        } catch (e) {
            showProgramToast('添加失败：' + (e.message || ''), 'error');
        }
    });
}

// ===== 程序操作消息提示 =====
function showProgramToast(msg, type) {
    const existing = document.querySelector('.program-message');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `program-message ${type}`;
    toast.textContent = msg;
    document.body.appendChild(toast);

    // 触发动画
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

window.addEventListener('load', async () => {
    await init();
    setTimeout(() => {
        updatePetSize();
        updateMoveSpeed();
        updateGridLayout();
        const livingCell = getRandomRoomCell('living');
        if (livingCell) {
            const pos = gridToScreen(livingCell.col, livingCell.row, gridCellSize, gridOffsetX, gridOffsetY, config.gridViewMode);
            petX = pos.x - petWidth / 2;
            petY = pos.y - petHeight / 2;
            updatePetPosition();
            updateCurrentRoom();
        }
    }, 300);

    // 首次打开时家具/桌宠偶尔不显示（只显示房间），直到鼠标点击才刷新。
    // 这里在所有图片加载完成后强制重建一次网格并触发重绘，规避透明窗口首帧合成层不刷新的问题。
    const forceRepaint = () => {
        if (typeof lastGridLayout !== 'undefined') lastGridLayout = null;
        updateGridLayout();
        updatePetPosition();
        updateCurrentRoom();
        // 强制回流 + 轻微抖动以触发合成层重绘
        const houseEl = document.getElementById('house');
        if (houseEl) {
            void houseEl.offsetHeight;
            houseEl.style.transform = 'translateZ(0)';
        }
        const petEl = document.getElementById('pet');
        if (petEl && petX !== undefined) {
            petEl.style.transform = 'translate3d(' + petX + 'px, ' + (petY - petHeight) + 'px, 0)';
            requestAnimationFrame(() => {
                updatePetPosition();
            });
        }
    };
    // 等首屏图片（家具/桌宠）解码完成后强制重绘
    const imgs = Array.from(document.images);
    if (imgs.length) {
        let pending = imgs.length;
        let done = false;
        const onImg = () => {
            pending--;
            if (pending <= 0 && !done) { done = true; forceRepaint(); }
        };
        imgs.forEach(img => {
            if (img.complete) onImg();
            else { img.addEventListener('load', onImg); img.addEventListener('error', onImg); }
        });
        // 兜底：最多等待 1.5s 后强制重绘一次
        setTimeout(() => { if (!done) { done = true; forceRepaint(); } }, 1500);
    } else {
        forceRepaint();
    }
});

document.querySelectorAll('.tag-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        const value = btn.dataset.value;
        document.querySelectorAll(`.tag-btn[data-type="${type}"]`).forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        const identity = document.querySelector('.tag-btn[data-type="identity"].active')?.dataset.value || '小鲸鱼';
        const personality = document.querySelector('.tag-btn[data-type="personality"].active')?.dataset.value || '活泼';
        const tone = document.querySelector('.tag-btn[data-type="tone"].active')?.dataset.value || '可爱';
        
        const basePrompt = generatePersonaPrompt(identity, personality, tone);
        const suffix = `\n\n【记忆生成格式】\n当用户与你对话时，如果你认为某条信息需要被记住，请在回复中输出记忆。记忆分为两类：\n\n1. 长期记忆：用户的核心偏好、重要事实、关系等持久信息。\n格式：[MEMORY: 简洁的要点（不超过20字）]\n例如：[MEMORY: 用户喜欢喝咖啡]\n\n2. 短期记忆：时效性信息（如"今天要开会"、"现在在下雨"）或极不重要的琐碎细节，过期后即失去价值。\n格式：[SHORT_MEMORY: 简洁的要点（不超过20字）]\n例如：[SHORT_MEMORY: 今天外面在下雨]\n\n程序会自动识别并分别保存。长期记忆永久保留，短期记忆存入行为记录（会随时间被新记录覆盖）。\n\n【心情标记格式】\n在回复末尾，你必须使用以下格式标记你当前的心情：<MOOD:心情>\n可选心情：鼓励、害羞、好奇、惊讶、难过、撒娇、生气、无语、兴奋\n选择依据：根据你当前的状态和对话内容选择最贴切的心情，而不是随机选择。\n例如：<MOOD:害羞>\n注意：心情标记只出现在回复末尾，不要出现在正文对话中。\n\n【行为指令格式】\n如果用户要求你去某个房间或做某件具体的事，请在回复末尾使用以下格式输出指令：<CMD:指令>\n可用指令：去客厅、去卧室、去厨房、去卫生间、去阳台、吃饭、睡觉、洗澡、上厕所、看电视\n例如：<CMD:去卧室>\n注意：指令标记只出现在回复末尾，不要出现在正文对话中。`;
        
        aiPromptInput.value = basePrompt + suffix;
    });
});

// 调试：在控制台暴露 cleanReply 用于测试
window.testCleanReply = function(text) {
    console.log('input:', JSON.stringify(text));
    const result = cleanReply(text);
    console.log('output:', JSON.stringify(result));
    return result;
};

// 自定义标题栏窗口控制
const minimizeBtn = document.getElementById('minimizeBtn');
const maximizeBtn = document.getElementById('maximizeBtn');
const closeBtn = document.getElementById('closeBtn');

if (minimizeBtn && window.electronAPI && window.electronAPI.minimizeWindow) {
    minimizeBtn.addEventListener('click', () => {
        window.electronAPI.minimizeWindow();
    });
}

if (maximizeBtn && window.electronAPI && window.electronAPI.maximizeWindow) {
    maximizeBtn.addEventListener('click', () => {
        window.electronAPI.maximizeWindow();
    });
}

if (closeBtn && window.electronAPI && window.electronAPI.closeWindow) {
    closeBtn.addEventListener('click', () => {
        window.electronAPI.closeWindow();
    });
}

// 设置面板已移除，点击空白处关闭逻辑不再需要

// Electron IPC 监听：显示聊天面板
if (window.electronAPI) {
    window.electronAPI.onShowChatPanel(() => {
        chatPanel.classList.add('show');
        stopMoving();
        decideMoodByState();
    });

    // 监听小窗口触发记忆总结
    window.electronAPI.on('trigger-memory-summary', () => {
        summarizeMemoryOnChatClose();
    });
    // （sync-float-size 通路已移除：浮窗大小随 config-updated 广播 -> applyConfig 自动刷新滑杆）

    // 监听窗口最小化事件
    window.electronAPI.onWindowMinimized && window.electronAPI.onWindowMinimized(() => {
        isWindowMinimized = true;
        stopMoving();
    });

    // 监听窗口恢复事件（合并 restoreGracePeriod 设置与布局刷新）
    window.electronAPI.onWindowRestored && window.electronAPI.onWindowRestored(() => {
        isWindowMinimized = false;
        // 恢复保护期：防止 restore 动画的异常尺寸读数引起自动最小化循环，
        // 同时让 handleWindowResize 在此期间跳过重量级操作（renderGrid 重建）
        restoreGracePeriod = true;
        setTimeout(() => { restoreGracePeriod = false; }, 600);
        // 窗口恢复后手动刷新布局（主进程可能调整了窗口尺寸）。
        // 必须延迟到保护期结束后（650ms > 600ms）执行，否则 handleWindowResize 会被
        // restoreGracePeriod 检查跳过，导致恢复后布局不刷新。
        // 此时若尺寸未变，布局缓存命中，刷新极廉价；若尺寸变了则按需重建。
        setTimeout(() => {
            handleWindowResize();
        }, 650);
    });
    
    // 监听记忆更新（其他窗口修改记忆时同步更新
    if (window.electronAPI.onMemoryUpdated) {
        window.electronAPI.onMemoryUpdated((items) => {
            if (Array.isArray(items)) {
                memoryItems = items;
                renderMemoryList();
            }
        });
    }
    
    // 监听小窗口请求记忆内容：先从文件读取最新数据，再返回
    window.electronAPI.on('get-memory-items-request', async () => {
        try {
            await loadMemory();
            window.electronAPI.send('get-memory-items-response', memoryItems);
        } catch (e) {
            console.error('[main] get-memory-items-request failed:', e);
            window.electronAPI.send('get-memory-items-response', memoryItems || []);
        }
    });

    // 监听小窗口发送单条记忆：由主窗口统一添加并保存
    window.electronAPI.on('save-memory-item-request', async (event, text) => {
        try {
            await addMemoryItem(text);
            window.electronAPI.send('save-memory-item-response', true);
        } catch (e) {
            console.error('[main] save-memory-item-request failed:', e);
            window.electronAPI.send('save-memory-item-response', false);
        }
    });
    
    // 监听小窗口触发记忆总结
    window.electronAPI.on('trigger-memory-summary', () => {
        summarizeMemoryOnChatClose();
    });
}

// ===== 语音设置事件处理 =====
(function initVoiceSettings() {
    const voiceToggle = document.getElementById('voiceToggle');
    const voiceAutoSendToggle = document.getElementById('voiceAutoSendToggle');
    const voiceSelect = document.getElementById('voiceSelect');
    const voiceVolumeSlider = document.getElementById('voiceVolumeSlider');
    const voiceVolumeValue = document.getElementById('voiceVolumeValue');
    const settingsTtsBtn = document.getElementById('settingsTtsBtn');
    const settingsSttBtn = document.getElementById('settingsSttBtn');

    // 启用语音朗读开关
    if (voiceToggle) {
        voiceToggle.addEventListener('change', () => {
            config.voiceEnabled = voiceToggle.checked;
            saveConfig();
            if (window.electronAPI && window.electronAPI.send) {
                window.electronAPI.send('set-voice-enabled', voiceToggle.checked);
            }
            console.log('[Voice] Voice:', config.voiceEnabled ? 'enabled' : 'disabled');
        });
    }

    // 自动发送语音开关
    if (voiceAutoSendToggle) {
        voiceAutoSendToggle.addEventListener('change', () => {
            config.voiceAutoSend = voiceAutoSendToggle.checked;
            saveConfig();
            console.log('[Voice] Auto-send voice:', config.voiceAutoSend ? 'enabled' : 'disabled');
        });
    }

    // 语音音量
    if (voiceVolumeSlider) {
        voiceVolumeSlider.addEventListener('input', () => {
            const vol = parseInt(voiceVolumeSlider.value) / 100;
            config.voiceVolume = vol;
            if (voiceVolumeValue) voiceVolumeValue.textContent = voiceVolumeSlider.value + '%';
            saveConfig();
            if (window.electronAPI && window.electronAPI.send) {
                window.electronAPI.send('set-voice-volume', vol);
            }
        });
    }

    // 语音音色选择
    function loadVoiceList() {
        if (!voiceSelect) return;
        if (!window.electronAPI || !window.electronAPI.getTtsVoices) {
            console.warn('[Voice] getTtsVoices not available');
            return;
        }
        const savedVoice = config.selectedVoice || 'default';
        window.electronAPI.getTtsVoices().then(voices => {
            voiceSelect.innerHTML = '<option value="default">🔄 自动选择（推荐）</option>';
            voices.forEach(v => {
                const opt = document.createElement('option');
                opt.value = typeof v === 'object' ? v.id : v;
                opt.textContent = typeof v === 'object' ? (v.id + ' · ' + v.desc) : v;
                if (opt.value === savedVoice) opt.selected = true;
                voiceSelect.appendChild(opt);
            });
        }).catch(err => {
            console.warn('[Voice] Failed to load TTS voices:', err);
        });
    }

    if (voiceSelect) {
        setTimeout(loadVoiceList, 1000);
        voiceSelect.addEventListener('change', () => {
            config.selectedVoice = voiceSelect.value;
            saveConfig();
            if (window.electronAPI && window.electronAPI.send) {
                window.electronAPI.send('set-selected-voice', voiceSelect.value);
            }
            console.log('[Voice] Voice switched to:', config.selectedVoice);
        });
    }

    // 启动时把已保存的音色/语音开关同步到主进程，
    // 否则主进程的 selectedVoice 保持默认值，会把正确音色覆盖（flat/companion 用错音色）
    // 注意：此处 config 尚未从 localStorage 加载，需直接读取已保存值
    let savedVoice = config.selectedVoice || 'default';
    let savedVoiceEnabled = config.voiceEnabled !== false;
    try {
        const saved = localStorage.getItem('petConfig');
        if (saved) {
            const p = JSON.parse(saved);
            if (p.selectedVoice) savedVoice = p.selectedVoice;
            if (p.voiceEnabled !== undefined) savedVoiceEnabled = !!p.voiceEnabled;
        }
    } catch (e) {}
    if (document.getElementById('voiceSelect')) {
        const currentSel = document.getElementById('voiceSelect').value;
        if (currentSel) savedVoice = currentSel;
    }
    if (window.electronAPI && window.electronAPI.send) {
        window.electronAPI.send('set-selected-voice', savedVoice);
        window.electronAPI.send('set-voice-enabled', savedVoiceEnabled);
    }

    // 测试 TTS（使用 Edge TTS 服务，遵循当前选中音色）
    if (settingsTtsBtn) {
        settingsTtsBtn.addEventListener('click', () => {
            const testText = '你好，我是你的桌宠，你觉得这个声音怎么样？';
            speakText(testText);
        });
    }

    // 测试 STT（语音识别）
    if (settingsSttBtn) {
        settingsSttBtn.addEventListener('click', async () => {
            if (window.electronAPI && window.electronAPI.startStt) {
                try {
                    const result = await window.electronAPI.startStt();
                    if (result && result.text) {
                        console.log('[STT] Recognized:', result.text);
                        if (inputText) {
                            inputText.value = result.text;
                            inputText.focus();
                        }
                    }
                } catch (err) {
                    console.error('[STT] Error:', err);
                }
            } else {
                console.warn('[STT] startStt not available');
            }
        });
    }
})();

// ===== 陪伴模式设置事件处理 =====
(function initCompanionSettings() {
    const companionWidthSlider = document.getElementById('companionWidthSlider');
    const companionWidthValue = document.getElementById('companionWidthValue');
    const companionHeightSlider = document.getElementById('companionHeightSlider');
    const companionHeightValue = document.getElementById('companionHeightValue');
    const companionFontSizeSlider = document.getElementById('companionFontSizeSlider');
    const companionFontSizeValue = document.getElementById('companionFontSizeValue');
    const companionPetSizeSlider = document.getElementById('companionPetSizeSlider');
    const companionPetSizeValue = document.getElementById('companionPetSizeValue');

    // 应用陪伴窗口尺寸到主进程
    function applyCompanionWindowSize() {
        if (window.electronAPI && window.electronAPI.send) {
            window.electronAPI.send('set-companion-window-size', config.companionWidth, config.companionHeight);
        }
    }

    if (companionWidthSlider) {
        companionWidthSlider.addEventListener('input', () => {
            const val = parseInt(companionWidthSlider.value);
            config.companionWidth = val;
            if (companionWidthValue) companionWidthValue.textContent = val;
            saveConfig();
            applyCompanionWindowSize();
        });
    }

    if (companionHeightSlider) {
        companionHeightSlider.addEventListener('input', () => {
            const val = parseInt(companionHeightSlider.value);
            config.companionHeight = val;
            if (companionHeightValue) companionHeightValue.textContent = val;
            saveConfig();
            applyCompanionWindowSize();
        });
    }

    if (companionFontSizeSlider) {
        companionFontSizeSlider.addEventListener('input', () => {
            const val = parseInt(companionFontSizeSlider.value);
            config.companionFontSize = val;
            if (companionFontSizeValue) companionFontSizeValue.textContent = val;
            saveConfig();
            if (window.electronAPI && window.electronAPI.send) {
                window.electronAPI.send('set-companion-font-size', val);
            }
        });
    }

    if (companionPetSizeSlider) {
        companionPetSizeSlider.addEventListener('input', () => {
            const val = parseInt(companionPetSizeSlider.value);
            config.companionPetSize = val;
            if (companionPetSizeValue) companionPetSizeValue.textContent = val;
            saveConfig();
            if (window.electronAPI && window.electronAPI.send) {
                window.electronAPI.send('set-companion-pet-size', val);
            }
        });
    }
})();

// ===== 快捷打开聊天框 =====
const quickChatBtn = document.getElementById('quickChatBtn');
if (quickChatBtn) {
    quickChatBtn.addEventListener('click', () => {
        chatPanel.classList.add('show');
        stopMoving();
        decideMoodByState();
    });
}

// ===== TTS 语音朗读（主窗口） =====
async function speakText(text) {
    if (!text) return;

    if (!config.voiceEnabled) {
        return;
    }

    // 剔除 <MOOD:xxx> 等标记
    let clean = text.replace(/<MOOD:[^>]+>/g, '').replace(/<CMD:[^>]+>/g, '').trim();
    if (!clean) {
        console.warn('[TTS] Text empty after tag removal, skip');
        return;
    }

    const selectedVoice = config.selectedVoice || 'default';
    const DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural';
    const voiceToUse = (selectedVoice === 'default') ? DEFAULT_VOICE : selectedVoice;

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
                source.buffer = audioBuffer;
                source.connect(audioCtx.destination);
                source.start();
                return;
            }
        } catch (e) {
            console.error('[TTS] Edge TTS synthesis failed:', e);
        }
    }
    console.warn('[TTS] Edge TTS unavailable, speech skipped');
}

// ===== 贴图包选择 =====
(function initStickerPackSelector() {
    const stickerPackList = document.getElementById('stickerPackList');
    if (!stickerPackList) return;

    async function loadStickerPacks() {
        if (!window.electronAPI || !window.electronAPI.listStickerPacks) {
            // 无主进程 API 时，手动渲染默认贴图包
            renderPackList([{ name: '默认', preview: 'img/默认/pet.png' }]);
            return;
        }
        try {
            const packs = await window.electronAPI.listStickerPacks();
            renderPackList(packs);
        } catch (e) {
            console.warn('[StickerPack] 加载列表失败:', e);
            renderPackList([{ name: '默认', preview: 'img/默认/pet.png' }]);
        }
    }

    function renderPackList(packs) {
        stickerPackList.innerHTML = '';
        const current = config.stickerPack || '默认';
        packs.forEach(pack => {
            const item = document.createElement('div');
            item.className = 'sticker-pack-item' + (pack.name === current ? ' active' : '');
            item.innerHTML = `
                <img src="${pack.preview || ''}" alt="${pack.name}" onerror="this.style.display='none'">
                <div class="pack-name">${pack.name}</div>
            `;
            item.addEventListener('click', () => {
                config.stickerPack = pack.name;
                window._stickerPack = pack.name;
                saveConfig();
                // 同步到主进程
                if (window.electronAPI && window.electronAPI.setStickerPack) {
                    window.electronAPI.setStickerPack(pack.name);
                }
                // 刷新 UI 选中状态
                document.querySelectorAll('.sticker-pack-item').forEach(el => el.classList.remove('active'));
                item.classList.add('active');
                // 刷新贴图引用
                refreshAllImages();
                console.log('[StickerPack] 已切换到:', pack.name);
            });
            stickerPackList.appendChild(item);
        });
    }

    // 刷新所有贴图引用
    function refreshAllImages() {
        // 主窗口桌宠
        petImg.src = imgPath('pet.png');
        // 立绘：恢复显示并重置为当前贴图包的 pet 立绘
        illustImg.style.display = '';
        illustImg.src = imgPath('pet.png');
        illustImg.classList.add('show');
        illustMood.classList.add('show');
        // 刷新家具图像（重新渲染网格）
        if (typeof renderGrid === 'function') renderGrid();
    }

    loadStickerPacks();
})();