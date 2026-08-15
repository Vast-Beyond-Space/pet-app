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
const floatIllustMood = document.getElementById('floatIllustMood');

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
    } else if (action === 'companion') {
        if (window.electronAPI) {
            window.electronAPI.enterCompanionMode();
            window.close();
        }
    }
});

let isDragging = false;
let isMoving = false;
let isParabolaRunning = false;
let isWindowMinimized = true;
let keepRunningOnClose = false;
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

// 桌宠状态贴图
const PET_IMGS = {
    wandering: () => imgPath('pet.png'),
    eating: () => imgPath('浮窗_吃饭.png'),
    daydreaming: () => imgPath('浮窗_发呆.png'),
    working: () => imgPath('浮窗_工作.png'),
    angry: () => imgPath('浮窗_生气.png'),
    craving: () => imgPath('浮窗_嘴馋.png'),
    eating_cookie: () => imgPath('浮窗_吃饼干.png'),
    sleeping: () => imgPath('浮窗_睡觉.png')
};

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

// 聊天历史
let chatHistory = [];

// 记忆相关
let memoryItems = [];

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
const moodList = Object.keys(moodEmojis);

// 配置（从 localStorage 读取）
let config = {
    apiKey: '',
    apiUrl: 'https://api.deepseek.com/v1/chat/completions',
    aiPrompt: '你是一个可爱的桌宠小鲸鱼，性格活泼可爱。请用简短可爱的语气回复，不要超过30字。\n\n【心情标记格式】\n在回复末尾，你必须使用以下格式标记你当前的心情：<MOOD:心情>\n可选心情：鼓励、害羞、好奇、惊讶、难过、撒娇、生气、无语、兴奋\n选择依据：根据你当前的状态和对话内容选择最贴切的心情，而不是随机选择。\n例如：<MOOD:害羞>\n注意：心情标记只出现在回复末尾，不要出现在正文对话中。\n\n【行为指令格式】\n如果用户要求你去某个房间或做某件具体的事，请在回复末尾使用以下格式输出指令：<CMD:指令>\n可用指令：去客厅、去卧室、去厨房、去卫生间、去阳台、吃饭、睡觉、洗澡、上厕所、看电视\n例如：<CMD:去卧室>\n注意：指令标记只出现在回复末尾，不要出现在正文对话中。',
    enableMemory: false,
    floatShowIllust: true,
    zhipuApiKey: '',
    multimodalEnabled: false,
    costSavingEnabled: false,
    selectedVoice: 'default',
    voiceEnabled: true,
    voiceAutoSend: true,
    voiceVolume: 1.0,
    stickerPack: '默认'
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
                costSavingEnabled: parsed.costSavingEnabled || false
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
}
loadConfig();

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
    return floatIsClosing || (isWindowMinimized && !keepRunningOnClose);
}

// 保存状态
function saveStats() {
    if (shouldPauseFloatStats()) {
        console.log('[float] blocked stats save', {
            isWindowMinimized,
            keepRunningOnClose,
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
let lastWindowX = screenWidth + screenX - 180;
let lastWindowY = screenHeight + screenY - 160;

let floatShowIllust = true;

// 初始化加载记忆（异步，在模式分流之前加载，确保两种模式都可用）
(async () => {
    await loadMemory();
})();

// 监听记忆更新（其他窗口修改记忆时同步更新）
if (window.electronAPI && window.electronAPI.onMemoryUpdated) {
    window.electronAPI.onMemoryUpdated((items) => {
        if (Array.isArray(items)) {
            memoryItems = items;
        }
    });
}

// ===== 模式分流 =====
if (isChatMode) {
    // ===== 聊天模式：只显示聊天界面 =====
    petContainer.style.display = 'none';
    floatBubble.style.display = 'none';
    chatContainer.style.display = 'flex';
    chatContainer.style.width = '100%';
    chatContainer.style.height = '100%';
    floatChatInput.focus();

    // FIX: 使用原生标题栏，隐藏模拟标题栏（保留立绘显示按钮）
    const chatHeader = document.querySelector('.chat-header');
    if (chatHeader) {
        // 将立绘显示按钮移到聊天主区域顶部，然后隐藏标题栏
        const illustShowBtn = document.getElementById('floatIllustShowBtn');
        const chatLog = document.getElementById('floatChatLog');
        if (illustShowBtn && chatLog && illustShowBtn.parentElement === chatHeader) {
            // 把立绘显示按钮移到 chat-main 的最前面
            const chatMain = document.querySelector('.chat-main');
            if (chatMain) {
                chatMain.insertBefore(illustShowBtn, chatMain.firstChild);
            }
        }
        chatHeader.style.display = 'none';
    }
    
    // 根据配置初始化立绘显示状态
    if (floatChatIllust) {
        if (floatShowIllust) {
            floatChatIllust.classList.remove('hidden');
        } else {
            floatChatIllust.classList.add('hidden');
        }
    }
    
    // 立绘栏显示/隐藏控制
    if (floatIllustHideBtn) {
        floatIllustHideBtn.addEventListener('click', () => {
            if (floatChatIllust) {
                floatChatIllust.classList.add('hidden');
            }
        });
    }
    if (floatIllustShowBtn) {
        floatIllustShowBtn.addEventListener('click', () => {
            if (floatChatIllust) {
                floatChatIllust.classList.remove('hidden');
            }
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
            hideIllust();
            // 总结完成后，通知主进程真正关闭窗口
            if (window.electronAPI && window.electronAPI.send) {
                window.electronAPI.send('chat-window-confirmed-close');
            }
        });
    }

    // beforeunload 作为后备：如果 IPC 没拦截到，至少尝试同步触发
    window.addEventListener('beforeunload', () => {
        summarizeMemoryOnChatClose();
        hideIllust();
    });

    // 关闭按钮（保留以防模拟标题栏仍在）
    if (chatCloseBtn) {
        chatCloseBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            console.log('[float] 关闭按钮点击');
            await summarizeMemoryOnChatClose();
            if (window.electronAPI && window.electronAPI.floatExitChatMode) {
                window.electronAPI.floatExitChatMode();
            }
        });
    }
} else {
    // ===== 浮窗模式：保持原有逻辑 =====
    
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
            // 根据当前状态恢复贴图
            floatPetImg.src = (PET_IMGS[petState] || ORIGINAL_PET_SRC)();

            if (moveMode === 'gravity') {
                throwWithParabola(dragVelocityX, dragVelocityY);
            } else {
                setTimeout(() => {
                    if (petState === 'craving' && cookieState.active && !cookieState.consumed) {
                        wanderToCookie();
                    } else if (!MOVEMENT_BLOCKED_STATES.includes(petState)) {
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
    function getContainerHeight() {
        const padding = Math.ceil(currentPetSize * 0.6);
        return currentPetSize + padding * 2 + 40 + currentPetSize / 2;
    }
    function getContainerWidth() {
        const padding = Math.ceil(currentPetSize * 0.6);
        return currentPetSize + padding * 2;
    }

    // 桌宠贴图底部相对于窗口顶部的偏移量
    function getPetImageBottomOffset() {
        return getContainerHeight() * 0.08 + currentPetSize;
    }

    function getPetBottomOffset() {
        return getPetImageBottomOffset() + currentPetSize * 0.75;
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
        // 生气状态：点击一次后切换到其它状态
        if (petState === 'angry') {
            randomStateTransition();
            return;
        }
        const effect = effects[Math.floor(Math.random() * effects.length)];
        triggerEffect(effect);
    });

    function triggerEffect(effect) {
        floatPetImg.classList.remove('effect-bounce', 'effect-shake');
        void floatPetImg.offsetWidth;

        switch (effect) {
            case 'bounce':
                floatPetImg.classList.add('effect-bounce');
                setTimeout(() => floatPetImg.classList.remove('effect-bounce'), 600);
                break;
            case 'shake':
                floatPetImg.classList.add('effect-shake');
                setTimeout(() => floatPetImg.classList.remove('effect-shake'), 500);
                break;
            case 'hearts':
                spawnParticles('heart');
                break;
            case 'stars':
                spawnParticles('star');
                break;
        }
    }

    // 生成粒子特效
    function spawnParticles(type) {
        const count = 5 + Math.floor(Math.random() * 4);
        const container = document.querySelector('.float-container');

        for (let i = 0; i < count; i++) {
            setTimeout(() => {
                const particle = document.createElement('div');
                particle.className = `particle ${type}`;
                particle.textContent = type === 'heart' ? '❤️' : '⭐';

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

    // 窗口尺寸自适应
    function updateWindowSize() {
        const padding = Math.ceil(currentPetSize * 0.6);
        const w = currentPetSize + padding * 2;
        const h = currentPetSize + padding * 2 + 40 + currentPetSize / 2;

        document.querySelector('.float-container').style.width = w + 'px';
        document.querySelector('.float-container').style.height = h + 'px';

        const petBottom = Math.ceil(h * 0.08) + currentPetSize;
        document.documentElement.style.setProperty('--float-pet-bottom', petBottom + 'px');

        if (window.electronAPI && window.electronAPI.resizeFloatWindow) {
            window.electronAPI.resizeFloatWindow(w, h);
        }
    }

    // 拖动窗口
    floatPet.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();

        // 生气状态下不触发拖拽，交给 click 处理状态切换
        if (petState === 'angry') {
            return;
        }

        isDragging = true;
        dragStartX = e.screenX;
        dragStartY = e.screenY;
        lastDragX = e.screenX;
        lastDragY = e.screenY;
        lastDragTime = performance.now();
        dragVelocityX = 0;
        dragVelocityY = 0;

        if (window.electronAPI) {
            windowStartX = lastWindowX;
            windowStartY = lastWindowY;
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

    // 抛物线运动（重力模式）
    async function throwWithParabola(vx, vy) {
        const gravity = 0.002;
        let posX = lastWindowX;
        let posY = lastWindowY;
        let velX = Math.max(-2.0, Math.min(2.0, vx));
        let velY = Math.max(-2.0, Math.min(2.0, vy));
        if (!Number.isFinite(posX)) posX = 0;
        if (!Number.isFinite(posY)) posY = 0;
        if (!Number.isFinite(velX)) velX = 0;
        if (!Number.isFinite(velY)) velY = 0;
        // 落地后纯自由移动：v=0 时给一个小的水平扰动让循环持续
        if (velX === 0 && velY === 0) {
            velX = (Math.random() < 0.5 ? -1 : 1) * 0.5;
        }
        // 标记移动中：拖拽释放时 isMoving 为 false，此处置 true 后 step 的 !isMoving 守卫
        // 才不会立即中止抛物线；同时也阻止 wander 在抛物线运行期间启动造成循环共存。
        isMoving = true;
        isParabolaRunning = true;
        let lastTime = performance.now();

        let workArea = await getWorkAreaAt(posX + getPetCenterXOffset(), posY + getPetBottomOffset());
        let winBounds = await fetchWindowBounds();
        let containerWin = findContainerWindow(posX, posY, winBounds);
        let boundsRefreshTimer = 0;

        const step = () => {
            // 防止残留循环：throwWithParabola 落地后会 resumeWander 启动新的 wander，
            // 若此 RAF 循环未被正确终止（如落地分支已 return 但 RAF 已排队下一帧），
            // 此处 isMoving 已被 wander/pauseWander 置 false，检测到后停止，避免循环泄漏。
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
                    if (petState === 'craving' && cookieState.active && !cookieState.consumed) {
                        wanderToCookie();
                    } else if (!MOVEMENT_BLOCKED_STATES.includes(petState)) {
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

            const petBottomOff = getPetBottomOffset();
            const petTopOff = getPetTopOffset();
            const petCenterXOff = getPetCenterXOffset();
            const winW = getContainerWidth();
            const winH = getContainerHeight();

            // 左右边界反弹
            if (posX < workArea.x) {
                posX = workArea.x;
                velX = Math.abs(velX) * 0.4;
            } else if (posX + winW > workArea.x + workArea.width) {
                posX = workArea.x + workArea.width - winW;
                velX = -Math.abs(velX) * 0.4;
            }

            // 顶部边界反弹
            if (posY < workArea.y) {
                posY = workArea.y;
                velY = Math.abs(velY) * 0.4;
            }

            // 底部碰撞检测
            const groundY = workArea.y + workArea.height - petBottomOff;
            if (posY >= groundY) {
                posY = groundY;
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
                            if (petState === 'craving' && cookieState.active && !cookieState.consumed) {
                                wanderToCookie();
                            } else if (!MOVEMENT_BLOCKED_STATES.includes(petState)) {
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

            // 检查与饼干碰撞
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
    function wanderToCookie() {
        if (!cookieState.active || cookieState.consumed) return;
        if (isDragging || isMouseHovering) return;

        isMoving = true;
        floatPetImg.classList.add('walking');

        // 计算目标位置（饼干位置）
        let targetX = cookieState.x - getPetCenterXOffset() + cookieSize / 2;
        let targetY;

        if (moveMode === 'gravity') {
            // 重力模式：只能左右移动，y保持地面
            targetY = lastWindowY;
        } else {
            // 全屏模式：自由移动
            targetY = cookieState.y - getPetBottomOffset() + cookieSize / 2;
        }

        const dx = targetX - lastWindowX;
        const dy = targetY - lastWindowY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 5) {
            // 到达饼干
            isMoving = false;
            floatPetImg.classList.remove('walking');
            eatCookie();
            return;
        }

        // 朝饼干方向移动
        const stepX = (dx / dist) * MOVE_SPEED;
        const stepY = (dy / dist) * MOVE_SPEED;
        const maxStep = MOVE_SPEED * 2;
        let clampedStepX = Math.max(-maxStep, Math.min(maxStep, stepX));
        let clampedStepY = Math.max(-maxStep, Math.min(maxStep, stepY));

        // 重力模式：只走水平方向
        if (moveMode === 'gravity') {
            clampedStepY = 0;
        }

        // 朝向翻转
        if (clampedStepX > 0) {
            floatPetImg.classList.add('flip');
        } else if (clampedStepX < 0) {
            floatPetImg.classList.remove('flip');
        }

        const totalSteps = Math.ceil((moveMode === 'gravity' ? Math.abs(dx) : dist) / MOVE_SPEED);
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
                // 重力模式：不改变Y坐标，让物理系统处理
                if (moveMode !== 'gravity') {
                    lastWindowY = targetY;
                }
            } else {
                lastWindowX += clampedStepX;
                // 重力模式：不改变Y坐标
                if (moveMode !== 'gravity') {
                    lastWindowY += clampedStepY;
                }
            }

            // 边界限制（仅X方向）
            lastWindowX = Math.max(screenX, Math.min(screenX + screenWidth - getContainerWidth(), lastWindowX));
            // 重力模式下Y坐标由物理系统管理，不做边界限制
            if (moveMode !== 'gravity') {
                lastWindowY = Math.max(screenY, Math.min(screenY + screenHeight - getContainerHeight(), lastWindowY));
            }

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
                if (cookieState.active && !cookieState.consumed && petState === 'craving') {
                    setTimeout(() => wanderToCookie(), 100);
                }
            }
        };

        moveStep();
    }

    // 随机游荡
    function wander() {
        if (isMoving || isDragging || isMouseHovering) return;

        // 被阻止移动的状态（吃饭/发呆/工作）
        if (MOVEMENT_BLOCKED_STATES.includes(petState)) return;

        // 嘴馋状态：追饼干
        if (petState === 'craving' && cookieState.active && !cookieState.consumed) {
            wanderToCookie();
            return;
        }

        if (petState !== 'wandering') return;

        isMoving = true;

        const margin = 20;
        // 缓存底部偏移量，避免移动过程中 currentPetSize 变化导致跳跃
        const cachedBottomOffset = (moveMode === 'gravity') ? getPetBottomOffset() : 48;
        // 缓存窗口尺寸，避免每次迭代重新计算
        const winW = getContainerWidth();
        const winH = getContainerHeight();
        // 地面 y 坐标（窗口顶部 y 值，使桌宠底部贴地）
        const groundY = (moveMode === 'gravity')
            ? (screenY + screenHeight - cachedBottomOffset)
            : (screenY + screenHeight - winH - cachedBottomOffset);
        let targetX, targetY;

        if (moveMode === 'gravity') {
            // 重力模式：仅左右平移，y 轴保持当前高度，x 轴目标不远于当前 1/5 屏宽范围内
            const maxMoveRange = screenWidth / 5;
            const minX = screenX + margin;
            const maxX = screenX + screenWidth - currentPetSize - margin;
            const currentX = lastWindowX;
            const randomOffset = (Math.random() - 0.5) * 2 * maxMoveRange;
            targetX = Math.max(minX, Math.min(maxX, currentX + randomOffset));
            targetY = lastWindowY;
        } else {
            // 自由模式：目标点距离当前位置不超过屏幕宽度的 1/3，底部留出任务栏高度
            const maxRange = Math.min(screenWidth, screenHeight) / 3;
            const taskbarOffset = 48;
            const minX = screenX + margin;
            const maxX = screenX + screenWidth - currentPetSize - margin;
            const minY = screenY + margin;
            const maxY = screenY + screenHeight - currentPetSize - margin - taskbarOffset;
            const randomOffsetX = (Math.random() - 0.5) * 2 * maxRange;
            const randomOffsetY = (Math.random() - 0.5) * 2 * maxRange;
            targetX = Math.max(minX, Math.min(maxX, lastWindowX + randomOffsetX));
            targetY = Math.max(minY, Math.min(maxY, lastWindowY + randomOffsetY));
        }

        const dx = targetX - lastWindowX;
        const dy = targetY - lastWindowY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) {
            // FIX: 问题三 - 修改8：确保提前返回时重置标志
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
        // 重力模式：只走水平方向（垂直由抛物线物理处理）
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
            // 防止新旧循环共存：wander 结束后可能被 throwWithParabola→resumeWander 重新启动，
            // 若旧 moveStep 残留 setTimeout 仍在调度，此处 isMoving 已被新循环或 pauseWander 置 false，
            // 检测到后立即退出，避免多个循环并发互相覆盖位置并频繁调用 IPC。
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

            let bounced = false;

            // 重力模式下始终贴地行走，使用与 throwWithParabola 一致的地面高度
            if (moveMode === 'gravity') {
                lastWindowY = groundY;
            }
            
            if (lastWindowX < screenX) {
                lastWindowX = screenX;
                clampedStepX = -Math.abs(clampedStepX) * 0.8;
                bounced = true;
            } else if (lastWindowX + winW > screenX + screenWidth) {
                lastWindowX = screenX + screenWidth - winW;
                clampedStepX = Math.abs(clampedStepX) * 0.8;
                bounced = true;
            }
            
            if (lastWindowY < screenY) {
                lastWindowY = screenY;
                clampedStepY = Math.abs(clampedStepY) * 0.8;
                bounced = true;
            } else if (lastWindowY > groundY) {
                lastWindowY = groundY;
                clampedStepY = -Math.abs(clampedStepY) * 0.8;
                bounced = true;
            }
            
            // 碰撞后更新翻转状态
            if (bounced) {
                if (clampedStepX > 0) {
                    floatPetImg.classList.add('flip');
                } else if (clampedStepX < 0) {
                    floatPetImg.classList.remove('flip');
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

    function setPetState(newState) {
        if (petStateTimer) {
            clearTimeout(petStateTimer);
            petStateTimer = null;
        }

        const oldState = petState;
        petState = newState;

        // 状态切换动画：小幅度上下拉伸
        if (oldState !== newState && newState !== 'wandering') {
            playStateTransitionAnimation();
        }

        // 更新贴图
        if (PET_IMGS[newState]) {
            floatPetImg.src = PET_IMGS[newState]();
        }

        // 移除之前的特殊状态样式
        floatPetImg.classList.remove('eating-stretch', 'sleeping-zzz');
        const zzzEl = document.getElementById('zzzEffect');
        if (zzzEl) zzzEl.classList.remove('show');

        // 处理特殊状态
        if (newState === 'craving') {
            pauseWander();
            if (!isDragging && !isMouseHovering && !isParabolaRunning) {
                wanderToCookie();
            }
        } else if (newState === 'eating_cookie') {
            pauseWander();
            // 吃饼干时小幅度拉伸
            floatPetImg.classList.add('eating-stretch');
        } else if (newState === 'eating') {
            pauseWander();
            // 吃饭状态保持缓慢上下拉伸
            floatPetImg.classList.add('eating-stretch');
        } else if (newState === 'sleeping') {
            pauseWander();
            // 睡觉状态冒出zzz
            const zzzEl = document.getElementById('zzzEffect');
            if (zzzEl) zzzEl.classList.add('show');
        } else if (MOVEMENT_BLOCKED_STATES.includes(newState)) {
            pauseWander();
        } else if (newState === 'angry') {
            pauseWander();
        } else if (newState === 'wandering') {
            if (!isDragging && !isMouseHovering && !cookieState.active) {
                resumeWander();
            }
        }

        // 定时状态切换：状态结束后进行随机切换（而非强制回到游荡）
        const duration = STATE_DURATIONS[newState];
        if (duration) {
            petStateTimer = setTimeout(() => {
                if (petState === newState) {
                    if (newState === 'craving') {
                        // 嘴馋超时：回到游荡
                        setPetState('wandering');
                    } else if (newState === 'eating_cookie') {
                        // 吃饼干结束后恢复比例
                        floatPetImg.classList.remove('eating-stretch');
                        resetPetScale();
                        setPetState('wandering');
                    } else if (newState === 'sleeping') {
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
        if (cookieState.active) return;
        if (isDragging) return;
        if (petState === 'craving' || petState === 'eating_cookie') return;

        // behaviorKeepProbability概率维持当前行为（包括游荡）
        if (Math.random() < behaviorKeepProbability) {
            // 保持当前状态，重新启动状态定时器
            if (petState === 'wandering' && !isMouseHovering) {
                resumeWander();
            } else {
                // 重新启动当前状态的定时器，以便下次再检查
                const duration = STATE_DURATIONS[petState];
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

        // 切换到其他状态
        const allStates = ['eating', 'daydreaming', 'working', 'angry', 'sleeping', 'wandering'];
        // 过滤掉当前状态
        const otherStates = allStates.filter(s => s !== petState);

        // 根据行为保持概率调整 wandering 的选择权重：
        // - 行为保持概率高 → wandering 权重高（更倾向于游走，符合"保持游走行为"）
        // - 行为保持概率低 → wandering 权重低（减少游走，倾向其他状态）
        // 这样行为保持概率=0 时，桌宠几乎不会切到 wandering，避免"持续游走"
        const candidates = [];
        otherStates.forEach(s => {
            // 非 wandering 状态权重固定为 1；wandering 权重随 behaviorKeepProbability 线性变化
            // behaviorKeepProbability=0 → wandering 权重 0.05（极低）
            // behaviorKeepProbability=0.6 → wandering 权重 0.6
            // behaviorKeepProbability=1 → wandering 权重 1.0
            const weight = (s === 'wandering') ? Math.max(0.05, behaviorKeepProbability) : 1;
            const count = Math.max(1, Math.round(weight * 20));
            for (let i = 0; i < count; i++) {
                candidates.push(s);
            }
        });

        const newState = candidates[Math.floor(Math.random() * candidates.length)];
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
                if (dist < COOKIE_CHASE_DISTANCE &&
                    petState !== 'craving' &&
                    petState !== 'eating_cookie' &&
                    petState !== 'sleeping' &&
                    petState !== 'working' &&
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
            if (petState === 'eating_cookie') {
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
        if (petState !== 'wandering') return;
        randomStateTransition();
    }, 5000);

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
            if (window.electronAPI.syncFloatSizeToSettings) {
                window.electronAPI.syncFloatSizeToSettings(size);
            }
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
        window.electronAPI.onWindowMinimized && window.electronAPI.onWindowMinimized((keepRunning) => {
            isWindowMinimized = true;
            keepRunningOnClose = !!keepRunning;
        });

        // 监听完整运行状态同步（主进程权威状态）
        if (window.electronAPI && window.electronAPI.onPetRuntimeState) {
            window.electronAPI.onPetRuntimeState((state) => {
                if (!state || typeof state !== 'object') return;

                isWindowMinimized = !!state.isWindowMinimized;
                keepRunningOnClose = !!state.keepRunningOnClose;

                if (Number.isInteger(state.floatSessionId)) {
                    currentFloatSessionId = state.floatSessionId;
                }

                floatIsClosing = false;

                console.log('[float] runtime state updated', {
                    isWindowMinimized,
                    keepRunningOnClose,
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
                keepRunningOnClose = false;

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

async function summarizeMemoryOnChatClose() {
    // FIX: 问题一 - 修改3：简化提前返回条件
    if (!config.enableMemory || chatHistory.length === 0) return;

    if (!config.apiKey) return;

    try {
        const conversationText = chatHistory
            .map(msg => msg.role === 'user' ? `用户：${msg.content}` : `桌宠：${msg.content}`)
            .join('\n');

        // 已保存的记忆（长期），提示AI不要重复
        const existingMemoriesText = memoryItems.length > 0
            ? '\n\n已保存的记忆（请勿重复）：\n' + memoryItems.map((m, i) => `${i + 1}. ${m.text}`).join('\n')
            : '';

        const response = await fetch(config.apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
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
    }
}

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
                model: 'deepseek-chat',
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
    if (!floatIllustImg || !floatIllustMood) return;

    if (!mood || !moodList.includes(mood)) {
        mood = moodList[Math.floor(Math.random() * moodList.length)];
    }

    const emoji = moodEmojis[mood] || '';
    floatIllustMood.textContent = emoji + ' ' + mood;

    const moodImgPath = imgPath('mood_' + mood + '.png');
    const tempImg = new Image();
    tempImg.onload = function() {
        floatIllustImg.src = moodImgPath;
        floatIllustImg.classList.add('show');
        floatIllustMood.classList.add('show');
    };
    tempImg.onerror = function() {
        floatIllustImg.src = imgPath('pet.png');
        floatIllustImg.classList.add('show');
        floatIllustMood.classList.add('show');
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
    if (floatIllustMood) floatIllustMood.classList.remove('show');
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
        'bounce': 'bounce',
        'shake': 'shake',
        'hearts': 'hearts',
        'stars': 'stars'
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

// ===== 心情检测工具定义（节省成本模式专用） =====
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

async function handleLightMode(originalContent, messages, assistantMsg) {
    console.log('[LightMode] 处理:', originalContent);

    // 检测 [AGENT_MODE]，如果存在则切换到 Agent 模式（保持不变）
    if (originalContent.includes('[AGENT_MODE]')) {
        console.log('[LightMode] 检测到 [AGENT_MODE]，切换为 Agent 模式');
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

    // 仍然没有工具标记，直接显示原文
    if (toolCalls.length === 0) {
        addChatMessage(originalContent, false);
        return;
    }

    // 准备存储执行结果
    const results = [];
    let hasError = false;

    // 顺序执行所有工具
    for (const tc of toolCalls) {
        console.log('[LightMode] 执行:', tc.toolName, tc.args);
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

    // 显示 AI 消息（含简短提示）
    addChatMessage(finalContent, false);

    // 在消息下方追加可折叠的详细结果
    for (const r of results) {
        displayToolResult(r.toolName, r.args, r.result);
    }
}

// ===== 完整 Agent 模式处理器（多轮 Function Calling） =====
async function handleAgentMode(messages, firstAssistantMsg) {
    console.log('[AgentMode] 进入完整 Agent 模式');

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
            console.log('[AgentMode] 首次回复弱匹配命中:', weakCalls);
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

    let round = 0;
    const MAX_ROUNDS = 5;
    let finalResponse = '';

    while (round < MAX_ROUNDS) {
        // 请求 API（携带 agentTools），支持节省成本模式
        let agentApiUrl, agentApiKey, agentModel;
        if (config.costSavingEnabled && config.zhipuApiKey) {
            agentApiUrl = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
            agentApiKey = config.zhipuApiKey;
            agentModel = 'glm-4-flash';
        } else {
            agentApiUrl = config.apiUrl;
            agentApiKey = config.apiKey;
            agentModel = 'deepseek-chat';
        }

        const response = await fetch(agentApiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${agentApiKey}`
            },
            body: JSON.stringify({
                model: agentModel,
                messages: messages,
                tools: agentTools,
                tool_choice: 'auto',
                max_tokens: 500,
                temperature: 0.8
            })
        });

        const data = await response.json();
        const assistantMsg = data.choices[0].message;
        let content = assistantMsg.content || '';

        // ===== 检测 [AGENT_MODE]：追加到折叠容器 =====
        if (content.includes('[AGENT_MODE]')) {
            const cleanContent = content.replace(/\[AGENT_MODE\]\s*/g, '');
            if (cleanContent.trim()) {
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

                console.log('[AgentMode] 执行工具:', toolName, args);
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
                console.log('[AgentMode] 弱匹配命中:', weakCalls);
                const toolResults = [];
                let hasError = false;
                for (const wc of weakCalls) {
                    console.log('[AgentMode] 弱匹配执行工具:', wc.toolName, wc.args);
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
            addChatMessage(content, false, false);
        }
        finalResponse = content;
        break;
    }

    if (round >= MAX_ROUNDS) {
        thinkingContainer.open = false;
        addChatMessage('⏳ 操作步骤过多，请简化请求或重试。', false);
    }
    console.log('[AgentMode] 结束');
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

    // ===== 第二步：添加用户消息 =====
    await loadMemory();
    addChatMessage(cleanText, true);
    floatChatInput.value = '';
    chatHistory.push({ role: 'user', content: cleanText });

    if (!config.apiKey) {
        const reply = '请先在设置中配置 API Key~';
        addChatMessage(reply, false);
        chatHistory.push({ role: 'assistant', content: reply });
        speakText(reply);
        return;
    }

    // ===== 第三步：构建 AI 请求 =====
    try {
        const statsStr = Object.entries(stats)
            .map(([k, v]) => `${statNames[k]}: ${Math.round(v)}%`)
            .join(', ');

        let memoryStr = '';
        if (config.enableMemory && memoryItems.length > 0) {
            memoryStr = '\n记忆：\n' + memoryItems.map((m, i) => `${i + 1}. ${m.text}`).join('\n');
        }

        const behaviorStr = getBehaviorLogStr();
        const ctxStr = await buildContextStr();

        // ===== 屏幕感知（多模态） =====
        let screenContext = '';
        const loadingIndicator = document.getElementById('loadingIndicator');
        if (config.multimodalEnabled && config.zhipuApiKey) {
            try {
                // 显示加载动画
                if (loadingIndicator) loadingIndicator.style.display = 'flex';
                // 附上更多聊天记录作为屏幕解析上下文
                const recent = chatHistory.slice(-15).map(m => 
                    `${m.role === 'user' ? '用户' : '桌宠'}: ${m.content}`
                ).join('\n');
                const capturePromise = window.electronAPI.captureScreen(recent);
                const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 30000));
                screenContext = await Promise.race([capturePromise, timeoutPromise]);
            } catch (e) {
                console.warn('Screen capture failed:', e);
            } finally {
                if (loadingIndicator) loadingIndicator.style.display = 'none';
            }
        }

        let systemPrompt = `${config.aiPrompt}

【工具规则】
调用工具必须严格按此格式：
<TOOL:工具名 key1="值1" key2="值2">

注意事项：
- 所有参数值必须用双引号 " " 包裹。
- 工具名和参数之间用空格分隔。
- 如果文本内容含有双引号，请改用单引号。

可用工具：
open_app app="计算器|记事本|浏览器|微信|QQ|VS Code|文件管理器"
open_url url="https://..."
get_weather city="城市名"
get_time
volume action="set" level="0-100" 或 action="get"
screenshot
get_system_info
capture_screen
generate_image prompt="图像描述" size="1024x1024"
program action="list"
program action="describe" id="程序ID"
program action="run" id="程序ID" params='{"key":"value"}'
program action="save" name="名称" description="描述" code="代码" type="python|javascript|bash|html"
program action="update" id="程序ID" code="新代码"
program action="delete" id="程序ID"

【回复格式】
可带 <MOOD:心情>，可选：鼓励、害羞、好奇、惊讶、难过、撒娇、生气、无语、兴奋。

【复杂任务模式 - Agent】
当任务需要多步推理或依赖工具结果时，你必须使用 Agent 模式。

使用方式：
- 在回复的开头输出 [AGENT_MODE]。
- 紧接着调用工具（使用 Function Calling），不要只输出文字。
- 如果需要多个步骤，先调用第一个工具，等待结果后再调用下一个。

示例：
用户："列出所有程序，然后运行文件分类器"
你的回复应为：
[AGENT_MODE] 好的，我先列出程序，再运行。
（同时调用 program action="list"）

注意：输出 [AGENT_MODE] 后，必须立即调用工具。如果暂时无法调用工具，请说明原因并等待用户确认。

【重要规则】
运行已注册的程序（program action="run"）之前，必须先输出 [AGENT_MODE] 进入 Agent 模式，因为运行程序可能产生复杂输出，需要多轮交互来处理结果。

当前状态：${statsStr}${memoryStr}${behaviorStr}${ctxStr}`;
        if (screenContext) {
            systemPrompt += `\n\n当前用户屏幕内容：${screenContext}`;
        }

        const messages = [
            { role: 'system', content: systemPrompt }
        ];
        chatHistory.forEach(msg => {
            messages.push({ role: msg.role, content: msg.content });
        });

        // ===== AI 请求路由（节省成本模式） =====
        let apiUrl, apiKey, model;
        if (config.costSavingEnabled && config.zhipuApiKey) {
            apiUrl = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
            apiKey = config.zhipuApiKey;
            model = 'glm-4-flash';
        } else {
            apiUrl = config.apiUrl;
            apiKey = config.apiKey;
            model = 'deepseek-chat';
        }

        // 显示加载动画
        if (loadingIndicator) loadingIndicator.style.display = 'flex';

        // 并行发起主请求 + 心情检测请求（节省成本模式）
        const mainFetchPromise = fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model,
                messages: messages,
                max_tokens: 300,
                temperature: 0.8
            })
        }).then(r => r.json());

        // 节省成本模式下，并行请求心情检测（智谱 AI 不输出 mood 标记）
        let moodData = null;
        const moodFetchPromise = (config.costSavingEnabled && config.zhipuApiKey)
            ? (async () => {
                try {
                    const moodMessages = [
                        { role: 'system', content: '你是一个心情分析助手。根据对话内容分析当前心情，调用 set_mood 函数设置最合适的心情，不要输出其他文字。' },
                        ...chatHistory.slice(-4).map(msg => ({ role: msg.role, content: msg.content }))
                    ];
                    const resp = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${config.zhipuApiKey}`
                        },
                        body: JSON.stringify({
                            model: 'glm-4-flash',
                            messages: moodMessages,
                            tools: [moodTool],
                            tool_choice: 'required',
                            max_tokens: 50,
                            temperature: 0.3
                        })
                    });
                    return await resp.json();
                } catch (e) {
                    console.warn('[Mood] 心情检测请求失败:', e);
                    return null;
                }
            })()
            : Promise.resolve(null);

        let data;
        try {
            const results = await Promise.all([mainFetchPromise, moodFetchPromise]);
            data = results[0];
            moodData = results[1];
        } finally {
            // 隐藏加载动画
            if (loadingIndicator) loadingIndicator.style.display = 'none';
        }

        const assistantMsg = data.choices[0].message;
        const content = assistantMsg.content || '';

        // ===== 第四步：判断模式 =====
        let isAgentMode = false;
        let agentFinalResponse = '';
        if (content.includes('[AGENT_MODE]')) {
            isAgentMode = true;
            // 不显示第一条回复，直接进入 Agent 模式循环
            agentFinalResponse = await handleAgentMode(messages, assistantMsg);
        } else {
            await handleLightMode(content, messages, assistantMsg);
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

        // 解析心情（优先使用并行检测结果，节省成本模式下智谱 AI 不输出 <MOOD:> 标记）
        let detectedMood = null;
        if (moodData) {
            detectedMood = parseMoodFromToolResponse(moodData);
        }
        // 并行检测未命中或非节省成本模式，回退到主回复解析
        if (!detectedMood) {
            detectedMood = parseMoodFromReply(content);
        }
        if (detectedMood && floatIllustImg) {
            switchIllust(detectedMood);
            bounceIllust();
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

    } catch (e) {
        console.error('Float chat error:', e);
        addChatMessage('出错了，请检查网络或 API 设置~', false);
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
        console.warn('[displayToolResult] 显示失败:', e);
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
        const lines = chatHistory.map(m => `[${time}] ${m.role === 'user' ? '用户' : '桌宠'}: ${m.content}`);
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

// 监听配置更新（主进程广播）
if (window.electronAPI && window.electronAPI.onConfigUpdated) {
    window.electronAPI.onConfigUpdated((data) => {
        if (data) {
            config.zhipuApiKey = data.zhipuApiKey || '';
            config.multimodalEnabled = data.multimodalEnabled || false;
            config.costSavingEnabled = data.costSavingEnabled || false;
            if (data.aiPrompt) {
                config.aiPrompt = data.aiPrompt;
                console.log('[float] AI 人设已更新');
            }
            if (data.selectedVoice !== undefined) {
                config.selectedVoice = data.selectedVoice;
            }
            if (data.voiceEnabled !== undefined) {
                config.voiceEnabled = data.voiceEnabled;
            }
            if (data.voiceVolume !== undefined) {
                config.voiceVolume = data.voiceVolume;
            }
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
            console.log('[float] 配置已更新:', data);
        }
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

