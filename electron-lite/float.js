// electron-lite float.js — 桌宠浮窗
// 移动行为与贴图切换逻辑照搬原版 electron/float.js；仅保留浮窗+聊天+设置
// 支持智谱 / DeepSeek（开关切换）、多模态、记忆、人设；放弃 tools；记忆与原版共享

const $ = (id) => document.getElementById(id);
const B = window.lite;

// ===== 配置（与原版共用 petConfig key）=====
const DEFAULTS = {
    selectedVoice: 'default', voiceEnabled: true, voiceVolume: 1.0,
    stickerPack: '默认', aiPrompt: '你是桌宠小鲸鱼，性格活泼可爱，用简短中文回复。\n\n【心情标记格式】\n在回复末尾，你必须使用以下格式标记你当前的心情：<MOOD:心情>\n可选心情：鼓励、害羞、好奇、惊讶、难过、撒娇、生气、无语、兴奋\n选择依据：根据你当前的状态和对话内容选择最贴切的心情，而不是随机选择。\n例如：<MOOD:害羞>\n注意：心情标记只出现在回复末尾，不要出现在正文对话中。',
    mode: 'free', size: 1.0,
    cookieSpawnEnabled: true, autoStart: false,
    zhipuApiKey: '', multimodalEnabled: false,
    deepseekEnabled: false, deepseekApiKey: '',
    illustVisible: true, illustWidth: 0,
    stateChains: [
        { states: ['eating', 'eating', 'sleeping'] },        // 吃饭*2 → 睡觉（吃饱犯困）
        { states: ['sleeping', 'eating'] },                   // 睡觉 → 吃饭（醒来饿了）
        { states: ['working', 'working', 'daydreaming'] },    // 工作*2 → 发呆（累了走神）
        { states: ['daydreaming', 'sleeping'] }               // 发呆 → 睡觉（发呆到困）
    ],
    interruptState: 'wandering'                               // 状态链被打断后进入的状态
};
let config = { ...DEFAULTS };
function loadConfig() { try { const s = localStorage.getItem('petConfig'); if (s) config = { ...DEFAULTS, ...JSON.parse(s) }; } catch (e) {} }
function saveConfig() { localStorage.setItem('petConfig', JSON.stringify(config)); }
loadConfig();
window._stickerPack = config.stickerPack;

// 窗口尺寸（贴图尺寸）
const BASE_PET_SIZE = 80;
let currentPetSize = Math.round(BASE_PET_SIZE * config.size);
const CHAT_W = 340, CHAT_H = 460;
// 单个聊天框高度：用于计算贴图底部与窗口底边留出的空隙
const CHAT_BOX_HEIGHT = 30;
// 贴图底部到窗口底边正好放下两个聊天框的空隙
const BOTTOM_CHAT_BOX_GAP = 2 * CHAT_BOX_HEIGHT;
const screenWidth = window.screen.width;
const screenHeight = window.screen.height;
const screenX = 0, screenY = 0;
// 尺寸滑条最大 = 覆盖一半屏幕
const MAX_SIZE_SCALE = Math.max(2, Math.min(screenWidth, screenHeight) / 2 / BASE_PET_SIZE);

// ===== 移动常量（照搬原版）=====
const MOVE_SPEED = 1.2;
const MOVE_INTERVAL_MS = 16;
const BUBBLE_SHOW_DISTANCE = 120;
const HOVER_STOP_DISTANCE = 150;
const INPUT_BAR_DISTANCE = 80;

// ===== 移动状态（照搬原版）=====
let isDragging = false;
let isPanelDrag = false;
let isMoving = false;
let isParabolaRunning = false;
let isMouseHovering = false;
let isPanelOpen = false;
let moveMode = config.mode; // 'free' | 'gravity'
let dragStartX = 0, dragStartY = 0;
let windowStartX = 0, windowStartY = 0;
let dragVelocityX = 0, dragVelocityY = 0;
let lastDragX = 0, lastDragY = 0, lastDragTime = 0;
let wanderTimer = null;
let lastWindowX = screenWidth - 180;
let lastWindowY = screenHeight - 160;

// 单摆
let pendulumAngle = 0, pendulumVel = 0, pendulumTarget = 0, pendulumRAF = null;
let lastMouseClientX = 0, lastMouseTime = 0;

// ===== 贴图切换（照搬原版状态机）=====
const ORIGINAL_PET_SRC = () => imgPath('pet.png');
const DRAG_PET_SRC = () => imgPath('被拖动.png');
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
let petState = 'wandering';
let petStateTimer = null;
let behaviorKeepProbability = 0.6;
const MOVEMENT_BLOCKED_STATES = ['eating', 'daydreaming', 'working', 'sleeping'];
const STATE_DURATIONS = {
    eating: 8000, daydreaming: 6000, working: 7000, angry: 4000,
    craving: 30000, eating_cookie: 3000, sleeping: 10000
};

// ===== 可打断状态链（可在设置中增删、设置被打断后进入的状态）=====
const KNOWN_STATES = ['wandering', 'eating', 'daydreaming', 'working', 'angry', 'sleeping'];
const STATE_LABELS = {
    wandering: '游荡', eating: '吃饭', daydreaming: '发呆', working: '工作',
    angry: '生气', sleeping: '睡觉', craving: '嘴馋', eating_cookie: '吃饼干'
};
function getStateChains() {
    return (Array.isArray(config.stateChains) && config.stateChains.length) ? config.stateChains : [];
}
function interruptStateName() {
    const s = config.interruptState;
    return (s && KNOWN_STATES.includes(s)) ? s : 'wandering';
}
let activeChain = null; // { states:[...], index:0 }
function interruptChain() {
    const wasChain = !!activeChain;
    activeChain = null;
    // 链被打断后进入用户指定的状态（拖拽期间除外，避免覆盖拖拽贴图）
    if (wasChain && !isDragging && interruptStateName() !== petState) setPetState(interruptStateName());
}

const petEl = $('floatPet');
const petImg = $('floatPetImg');
const floatBubble = $('floatBubble');
const zzzEl = $('zzzEffect');

function imgPath(filename) { return 'img/' + (window._stickerPack || '默认') + '/' + filename; }

// ===== 立绘系统（参考原版 electron/float.js）=====
const moodEmojis = {
    '鼓励': '💪', '害羞': '😳', '好奇': '🤔', '惊讶': '😲', '难过': '😢',
    '撒娇': '🥺', '生气': '😠', '无语': '😑', '兴奋': '🤩'
};
const moodList = Object.keys(moodEmojis);
const chatIllustImg = $('chatIllustImg');
const chatIllustPanel = $('chatIllustPanel');
let illustVisible = true;
let currentIllustMood = '';

function parseMoodFromReply(reply) {
    if (!reply) return null;
    const match = reply.match(/<MOOD:([^>]+)>/);
    if (match) {
        const mood = match[1].trim();
        if (moodList.includes(mood)) return mood;
    }
    return null;
}

function switchIllust(mood) {
    if (!chatIllustImg) return;
    if (!mood || !moodList.includes(mood)) mood = moodList[Math.floor(Math.random() * moodList.length)];
    currentIllustMood = mood;
    const moodImgPath = imgPath('mood_' + mood + '.png');
    const tempImg = new Image();
    tempImg.onload = () => { chatIllustImg.src = moodImgPath; chatIllustImg.classList.add('show'); };
    tempImg.onerror = () => { chatIllustImg.src = imgPath('pet.png'); chatIllustImg.classList.add('show'); };
    tempImg.src = moodImgPath;
}
function bounceIllust() {
    if (!chatIllustImg) return;
    chatIllustImg.classList.remove('bounce');
    void chatIllustImg.offsetWidth;
    chatIllustImg.classList.add('bounce');
}
function hideIllust() {
    if (chatIllustImg) chatIllustImg.classList.remove('show');
}
function toggleIllustPanel(show) {
    illustVisible = show;
    if (!chatIllustPanel) return;
    if (show) {
        chatIllustPanel.classList.remove('hidden');
        // 重新加载当前心情立绘
        if (currentIllustMood && moodList.includes(currentIllustMood)) switchIllust(currentIllustMood);
        else switchIllust(randomMoodFallback());
    } else {
        chatIllustPanel.classList.add('hidden');
    }
}
function randomMoodFallback() { return moodList[Math.floor(Math.random() * moodList.length)]; }

// 立绘区/聊天框比例可拖动调节
let illustResizing = false;
let illustStartX = 0, illustStartWidth = 0;
function saveIllustWidth() {
    if (chatIllustPanel) { config.illustWidth = Math.round(chatIllustPanel.getBoundingClientRect().width); saveConfig(); }
}
function loadIllustWidth() {
    if (config.illustWidth && chatIllustPanel) chatIllustPanel.style.width = config.illustWidth + 'px';
}
function initIllustResize() {
    const divider = $('illustDivider');
    if (!divider) return;
    divider.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        illustResizing = true;
        divider.classList.add('active');
        chatIllustPanel.style.transition = 'none';
        illustStartX = e.clientX;
        illustStartWidth = chatIllustPanel.getBoundingClientRect().width;
    });
    document.addEventListener('mousemove', (e) => {
        if (!illustResizing) return;
        const delta = e.clientX - illustStartX;
        const maxW = Math.round($('chatPanel').clientWidth * 0.6);
        const w = Math.max(80, Math.min(maxW, illustStartWidth + delta));
        chatIllustPanel.style.width = w + 'px';
        chatIllustPanel.classList.remove('hidden');
    });
    document.addEventListener('mouseup', () => {
        if (!illustResizing) return;
        illustResizing = false;
        divider.classList.remove('active');
        chatIllustPanel.style.transition = '';
        saveIllustWidth();
    });
}
// 设置栏：是否显示立绘栏（持久化）
function initIllustToggle() {
    const t = $('illustToggle');
    if (!t) return;
    t.checked = config.illustVisible !== false;
    t.onchange = () => {
        config.illustVisible = t.checked;
        saveConfig();
        toggleIllustPanel(config.illustVisible);
    };
    toggleIllustPanel(config.illustVisible !== false);
}

// ===== 记忆（与原版共享 petMemory.json，元素为 {text}）=====
let memories = [];
function memText(m) { return (typeof m === 'string') ? m : (m && m.text) || ''; }
async function refreshMemory() { try { memories = await B.memoryLoad() || []; renderMemory(); } catch (e) {} }
function renderMemory() {
    $('memCount').textContent = memories.length;
    const box = $('memoryList');
    box.innerHTML = '';
    memories.forEach((m, i) => {
        const div = document.createElement('div');
        div.className = 'mem-item';
        div.innerHTML = `<span></span><button class="mem-del">删</button>`;
        div.querySelector('span').textContent = memText(m);
        div.querySelector('.mem-del').onclick = () => deleteMemory(i);
        box.appendChild(div);
    });
}
function deleteMemory(i) { memories.splice(i, 1); B.memorySave(memories); renderMemory(); }

// ===== TTS =====
let audioCtx = null;
async function speak(text, force) {
    if (!force && !config.voiceEnabled) return;
    const clean = String(text || '').replace(/<MOOD:[^>]+>|<CMD:[^>]+>/g, '').trim();
    if (!clean) return;
    const voice = config.selectedVoice === 'default' ? 'zh-CN-XiaoxiaoNeural' : config.selectedVoice;
    try {
        const b64 = await B.speakText(clean, voice);
        if (!b64) return;
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const bytes = new Uint8Array(atob(b64).split('').map(c => c.charCodeAt(0)));
        audioCtx.decodeAudioData(bytes.buffer, (audio) => {
            const src = audioCtx.createBufferSource();
            src.buffer = audio;
            const gain = audioCtx.createGain();
            gain.gain.value = config.voiceVolume || 1;
            src.connect(gain); gain.connect(audioCtx.destination); src.start();
        });
    } catch (e) { console.error('[lite] TTS 失败', e); }
}

// ===== 窗口尺寸（照搬原版 updateWindowSize）=====
function updateWindowSize() {
    const padding = Math.ceil(currentPetSize * 0.6);
    const w = currentPetSize + padding * 2;
    const h = currentPetSize + padding * 2 + 40 + currentPetSize / 2;
    document.querySelector('.float-container').style.width = w + 'px';
    document.querySelector('.float-container').style.height = h + 'px';
    document.documentElement.style.setProperty('--float-pet-size', currentPetSize + 'px');
    // 贴图底部与窗口底边留出“正好放下两个聊天框”的空隙
    document.documentElement.style.setProperty('--float-pet-bottom', BOTTOM_CHAT_BOX_GAP + 'px');
    B.resize(Math.round(w), Math.round(h));
}
function getContainerWidth() { const p = Math.ceil(currentPetSize * 0.6); return currentPetSize + p * 2; }
function getContainerHeight() { const p = Math.ceil(currentPetSize * 0.6); return currentPetSize + p * 2 + 40 + currentPetSize / 2; }
// 地板计算：重力模式下让窗口底部正好停在屏幕底部（窗口底边 = 屏幕底边）
// 贴图底部位于窗口底边上方，距离 = 两个聊天框的高度（BOTTOM_CHAT_BOX_GAP）
function getPetBottomOffset() { return getContainerHeight(); }
function getPetTopOffset() { return getPetImageBottomOffset() - currentPetSize; }
function getPetImageBottomOffset() { return BOTTOM_CHAT_BOX_GAP; }
// 桌宠图片中心相对窗口顶部的偏移（贴图底部距离窗口底边留出两个聊天框的空隙）
function getPetCenterOffset() { return getContainerHeight() - BOTTOM_CHAT_BOX_GAP - currentPetSize / 2; }
function getPetCenterY(posY) { return posY + getPetCenterOffset(); }

// ===== 单摆（照搬原版）=====
function startPendulum() {
    pendulumAngle = 0; pendulumVel = 0; pendulumTarget = 0; lastMouseClientX = 0; lastMouseTime = 0;
    petImg.classList.add('dragging');
    petImg.style.transition = '';
    if (pendulumRAF) cancelAnimationFrame(pendulumRAF);
    pendulumRAF = requestAnimationFrame(updatePendulum);
}
function updatePendulum() {
    const stiffness = 0.15, damping = 0.90;
    pendulumVel += (pendulumTarget - pendulumAngle) * stiffness;
    pendulumVel *= damping;
    pendulumAngle += pendulumVel;
    pendulumTarget *= 0.98;
    petImg.style.transform = `rotate(${pendulumAngle}deg)`;
    pendulumRAF = requestAnimationFrame(updatePendulum);
}
function feedPendulum(clientX) {
    const now = performance.now();
    if (lastMouseTime > 0) {
        const dt = Math.max(now - lastMouseTime, 1);
        const vx = (clientX - lastMouseClientX) / dt;
        pendulumTarget = Math.max(-40, Math.min(40, vx * 60));
    }
    lastMouseClientX = clientX;
    lastMouseTime = now;
}
function stopPendulum() {
    if (pendulumRAF) { cancelAnimationFrame(pendulumRAF); pendulumRAF = null; }
    petImg.classList.remove('dragging');
    petImg.style.transition = 'transform 0.3s ease';
    petImg.style.transform = '';
    setTimeout(() => { petImg.style.transition = ''; }, 320);
}

// ===== 移动：整窗移动（照搬原版）=====
function moveFloatWindowTo(newX, newY) {
    lastWindowX = newX;
    lastWindowY = newY;
    if (B && Number.isFinite(newX) && Number.isFinite(newY)) B.move(Math.round(newX), Math.round(newY));
}

// ===== 随机游荡（照搬原版）=====
function wander() {
    if (isMoving || isDragging || isMouseHovering || isPanelOpen) return;
    if (MOVEMENT_BLOCKED_STATES.includes(petState)) return;
    if (petState !== 'wandering') return;
    isMoving = true;

    const margin = 20;
    const cachedBottomOffset = (moveMode === 'gravity') ? getPetBottomOffset() : 48;
    const winW = getContainerWidth();
    const winH = getContainerHeight();
    const groundY = (moveMode === 'gravity')
        ? (screenY + screenHeight - cachedBottomOffset)
        : (screenY + screenHeight - winH - cachedBottomOffset);
    let targetX, targetY;

    if (moveMode === 'gravity') {
        const maxMoveRange = screenWidth / 5;
        const minX = screenX + margin;
        const maxX = screenX + screenWidth - Math.min(currentPetSize, screenWidth) - margin;
        const randomOffset = (Math.random() - 0.5) * 2 * maxMoveRange;
        targetX = Math.max(minX, Math.min(maxX, lastWindowX + randomOffset));
        targetY = lastWindowY;
    } else {
        const maxRange = Math.min(screenWidth, screenHeight) / 3;
        const taskbarOffset = 48;
        const minX = screenX + margin;
        const maxX = screenX + screenWidth - Math.min(currentPetSize, screenWidth) - margin;
        const minY = screenY + margin;
        const maxY = screenY + screenHeight - Math.min(currentPetSize, screenHeight) - margin - taskbarOffset;
        targetX = Math.max(minX, Math.min(maxX, lastWindowX + (Math.random() - 0.5) * 2 * maxRange));
        targetY = Math.max(minY, Math.min(maxY, lastWindowY + (Math.random() - 0.5) * 2 * maxRange));
    }

    const dx = targetX - lastWindowX;
    const dy = targetY - lastWindowY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) {
        isMoving = false;
        petImg.classList.remove('walking');
        wanderTimer = setTimeout(() => { if (!isDragging) wander(); }, 2000 + Math.random() * 4000);
        return;
    }

    const stepX = (dx / dist) * MOVE_SPEED;
    const stepY = (dy / dist) * MOVE_SPEED;
    const maxStep = MOVE_SPEED * 2;
    let clampedStepX = Math.max(-maxStep, Math.min(maxStep, stepX));
    let clampedStepY = Math.max(-maxStep, Math.min(maxStep, stepY));
    if (moveMode === 'gravity') clampedStepY = 0;
    const totalSteps = Math.ceil((moveMode === 'gravity' ? Math.abs(dx) : dist) / MOVE_SPEED);
    let currentStep = 0;

    petImg.classList.add('walking');
    if (stepX > 0) petImg.classList.add('flip');
    else if (stepX < 0) petImg.classList.remove('flip');

    const moveStep = () => {
        if (!isMoving || isDragging || isMouseHovering || isPanelOpen) {
            petImg.classList.remove('walking');
            isMoving = false;
            return;
        }
        currentStep++;
        if (currentStep >= totalSteps) { lastWindowX = targetX; lastWindowY = targetY; }
        else { lastWindowX += clampedStepX; lastWindowY += clampedStepY; }
        if (!Number.isFinite(lastWindowX)) lastWindowX = 0;
        if (!Number.isFinite(lastWindowY)) lastWindowY = 0;

        if (moveMode === 'gravity') lastWindowY = groundY;
        if (lastWindowX < screenX) { lastWindowX = screenX; clampedStepX = -Math.abs(clampedStepX) * 0.8; }
        else if (lastWindowX + winW > screenX + screenWidth) { lastWindowX = screenX + screenWidth - winW; clampedStepX = Math.abs(clampedStepX) * 0.8; }
        if (lastWindowY < screenY) { lastWindowY = screenY; clampedStepY = Math.abs(clampedStepY) * 0.8; }
        else if (lastWindowY > groundY) { lastWindowY = groundY; clampedStepY = -Math.abs(clampedStepY) * 0.8; }

        moveFloatWindowTo(lastWindowX, lastWindowY);

        if (currentStep < totalSteps) setTimeout(moveStep, MOVE_INTERVAL_MS);
        else {
            petImg.classList.remove('walking');
            isMoving = false;
            setTimeout(() => { if (!isDragging) wander(); }, 2000 + Math.random() * 4000);
        }
    };
    moveStep();
}

// ===== 游荡控制（照搬原版）=====
function startWander() { if (wanderTimer) clearTimeout(wanderTimer); wanderTimer = setTimeout(() => wander(), 3000); }
function pauseWander() {
    isMoving = false;
    if (wanderTimer) { clearTimeout(wanderTimer); wanderTimer = null; }
}
function resumeWander() {
    if (wanderTimer) { clearTimeout(wanderTimer); wanderTimer = null; }
    isMoving = false;
    if (!isDragging && !isMouseHovering && !isPanelOpen) wanderTimer = setTimeout(() => wander(), 2000);
}

// ===== 状态切换（照搬原版）=====
function setPetState(newState) {
    if (petStateTimer) { clearTimeout(petStateTimer); petStateTimer = null; }
    const oldState = petState;
    petState = newState;

    if (oldState !== newState && newState !== 'wandering') playStateTransitionAnimation();
    if (PET_IMGS[newState]) petImg.src = PET_IMGS[newState]();

    zzzEl.classList.remove('show');
    petImg.classList.remove('eating-stretch');

    // 仅吃饭状态播放上下压缩效果；拖动时由 drag 逻辑移除该 class
    if (newState === 'eating') { pauseWander(); petImg.classList.add('eating-stretch'); }
    else if (newState === 'eating_cookie') { pauseWander(); petImg.classList.add('eating-stretch'); }
    else if (newState === 'craving') {
        pauseWander();
        if (!isDragging && !isMouseHovering && !isParabolaRunning) wanderToCookie();
    }
    else if (newState === 'sleeping') { pauseWander(); zzzEl.classList.add('show'); }
    else if (MOVEMENT_BLOCKED_STATES.includes(newState) || newState === 'angry') pauseWander();
    else if (newState === 'wandering') { if (!isDragging && !isMouseHovering && !isPanelOpen) resumeWander(); }

    const duration = STATE_DURATIONS[newState];
    if (duration) {
        petStateTimer = setTimeout(() => {
            if (petState !== newState) return;
            // 状态链推进（链中状态优先）
            if (activeChain && activeChain.states[activeChain.index] === newState) {
                const nextIdx = activeChain.index + 1;
                if (nextIdx < activeChain.states.length) {
                    activeChain.index = nextIdx;
                    if (newState === 'sleeping') zzzEl.classList.remove('show');
                    setPetState(activeChain.states[nextIdx]);
                    return;
                }
                activeChain = null;
            }
            if (newState === 'craving') setPetState('wandering');
            else if (newState === 'eating_cookie') { petImg.classList.remove('eating-stretch'); setPetState('wandering'); }
            else if (newState === 'sleeping') { zzzEl.classList.remove('show'); randomStateTransition(); }
            else randomStateTransition();
        }, duration);
    }
}
function playStateTransitionAnimation() {
    petImg.classList.remove('state-transition');
    void petImg.offsetWidth;
    petImg.classList.add('state-transition');
    setTimeout(() => petImg.classList.remove('state-transition'), 500);
}

function randomStateTransition() {
    if (isDragging || isPanelOpen) {
        // 面板打开或拖拽期间触发切换：不能直接放弃，否则该阻塞状态将无定时器可推进而永久卡死。
        // 稍后重试，恢复后即可继续状态机。
        if (petStateTimer) clearTimeout(petStateTimer);
        const current = petState;
        petStateTimer = setTimeout(() => { if (petState === current) randomStateTransition(); }, 2000);
        return;
    }
    if (petState === 'craving' || petState === 'eating_cookie') return;

    if (Math.random() < behaviorKeepProbability) {
        if (petState === 'wandering' && !isMouseHovering) resumeWander();
        else {
            const duration = STATE_DURATIONS[petState];
            if (duration) {
                if (petStateTimer) clearTimeout(petStateTimer);
                const currentState = petState;
                petStateTimer = setTimeout(() => { if (petState === currentState) randomStateTransition(); }, duration);
            }
        }
        return;
    }

    // 小概率开启一条可打断的状态链
    if (Math.random() < 0.3) {
        const chains = getStateChains();
        const chain = chains.length ? chains[Math.floor(Math.random() * chains.length)] : null;
        const states = chain && Array.isArray(chain.states) && chain.states.length ? chain.states : null;
        if (states) {
            activeChain = null; // 直接覆盖旧链，不做打断状态切换
            activeChain = { states: states.slice(), index: 0 };
            setPetState(activeChain.states[0]);
            return;
        }
    }

    interruptChain();
    const allStates = ['eating', 'daydreaming', 'working', 'angry', 'sleeping', 'wandering'];
    const otherStates = allStates.filter(s => s !== petState);
    const candidates = [];
    otherStates.forEach(s => {
        const weight = (s === 'wandering') ? Math.max(0.05, behaviorKeepProbability) : 1;
        const count = Math.max(1, Math.round(weight * 20));
        for (let i = 0; i < count; i++) candidates.push(s);
    });
    setPetState(candidates[Math.floor(Math.random() * candidates.length)]);
}

// ===== 特效（照搬原版）=====
function triggerEffect(effect) {
    petImg.classList.remove('effect-bounce', 'effect-shake');
    void petImg.offsetWidth;
    if (effect === 'bounce') { petImg.classList.add('effect-bounce'); setTimeout(() => petImg.classList.remove('effect-bounce'), 600); }
    else if (effect === 'shake') { petImg.classList.add('effect-shake'); setTimeout(() => petImg.classList.remove('effect-shake'), 500); }
    else if (effect === 'hearts') spawnParticles('heart');
    else if (effect === 'stars') spawnParticles('star');
}
function spawnParticles(type) {
    const count = 5 + Math.floor(Math.random() * 4);
    const container = document.querySelector('.float-container');
    for (let i = 0; i < count; i++) {
        setTimeout(() => {
            const particle = document.createElement('div');
            particle.className = `particle ${type}`;
            particle.textContent = type === 'heart' ? '❤️' : '⭐';
            const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
            particle.style.left = (80 + Math.cos(angle) * 20) + 'px';
            particle.style.top = (80 + Math.sin(angle) * 20) + 'px';
            const flyAngle = angle + (Math.random() - 0.5) * 1;
            const flyDist = 30 + Math.random() * 40;
            particle.style.setProperty('--fly-x', Math.cos(flyAngle) * flyDist + 'px');
            particle.style.setProperty('--fly-y', Math.sin(flyAngle) * flyDist + 'px');
            container.appendChild(particle);
            setTimeout(() => particle.remove(), 1200);
        }, i * 80);
    }
}

// ===== 聊天（放弃 tools，仅纯对话；支持智谱/DeepSeek 切换）=====
let history = []; // 仅内存
let chatBusy = false;
let chatLogId = 0;
let chatLogs = []; // 压缩日志（仅摘要，不含压缩原文）
function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function buildSystemPrompt() {
    let p = config.aiPrompt;
    // 确保提示词包含心情标记指令（用于立绘），不包含 tools/CMD
    if (!p.includes('<MOOD:') || !p.includes('心情标记')) {
        p += '\n\n【心情标记格式】\n在回复末尾，你必须使用以下格式标记你当前的心情：<MOOD:心情>\n可选心情：鼓励、害羞、好奇、惊讶、难过、撒娇、生气、无语、兴奋\n选择依据：根据你当前的状态和对话内容选择最贴切的心情，而不是随机选择。\n例如：<MOOD:害羞>\n注意：心情标记只出现在回复末尾，不要出现在正文对话中。';
    }
    if (memories.length) p += '\n\n【长期记忆】\n' + memories.map((m, i) => `${i + 1}. ${memText(m)}`).join('\n');
    // 压缩日志（仅摘要，不含压缩原文，确保不重复使用原文）
    if (chatLogs.length) {
        p += '\n\n【此前已压缩的对话摘要】\n' + chatLogs.slice(-3).map(l => `#${l.id}: ${l.summary}`).join('\n');
    }
    return p;
}
function appendMsg(role, text) {
    const log = $('chatLog');
    const empty = log.querySelector('.chat-empty'); if (empty) empty.remove();
    const div = document.createElement('div');
    div.className = 'msg ' + role;
    div.textContent = text;
    log.appendChild(div); log.scrollTop = log.scrollHeight;
}
// 智谱并行请求心情（弱匹配）：回复未带<MOOD:>时，单独请求智谱判断心情
async function fetchMoodFromZhipu(reply) {
    if (!config.zhipuApiKey) return null;
    const messages = [
        { role: 'system', content: '你是心情识别助手。根据桌宠的回复内容，从以下心情中选择最贴切的一个：鼓励、害羞、好奇、惊讶、难过、撒娇、生气、无语、兴奋。只返回一个心情词，不要其他内容。' },
        { role: 'user', content: String(reply || '').slice(0, 200) }
    ];
    try {
        const res = await B.aiChat({ messages, maxTokens: 10, temperature: 0.2 });
        const content = (res.choices && res.choices[0]) ? res.choices[0].message.content : '';
        // 弱匹配：只要返回内容包含任一心情词即命中
        for (const m of moodList) if (content.includes(m)) return m;
        return null;
    } catch (e) { return null; }
}

async function sendChat(text) {
    text = String(text || '').trim(); if (!text || chatBusy) return;
    chatBusy = true;
    history.push({ role: 'user', content: text });
    appendMsg('user', text);
    $('loadingIndicator').style.display = 'flex';
    const messages = [{ role: 'system', content: buildSystemPrompt() }].concat(history);
    try {
        if (config.multimodalEnabled && config.zhipuApiKey) {
            const ctx = history.slice(-6).map(m => m.content).join(' | ');
            try {
                const scene = await B.captureScreen(ctx);
                if (scene) messages.push({ role: 'user', content: `（用户当前屏幕：${scene}）` });
            } catch (e) {}
        }
        const res = config.deepseekEnabled && B.deepseekChat
            ? await B.deepseekChat({ messages })
            : await B.aiChat({ messages });
        let reply = res.choices && res.choices[0] ? res.choices[0].message.content : '';
        history.push({ role: 'assistant', content: reply });
        const clean = reply.replace(/\[MEMORY:[^\]]+\]|\[SHORT_MEMORY:[^\]]+\]|<MOOD:[^>]+>|<CMD:[^>]+>/g, '').trim();
        appendMsg('assistant', clean);
        speak(clean);
        // 解析心情并切换立绘
        const detectedMood = parseMoodFromReply(reply);
        if (detectedMood) { switchIllust(detectedMood); bounceIllust(); }
        else if (!config.deepseekEnabled) {
            // 智谱作为对话API时，回复常不含<MOOD:>标记，并行专门请求获取心情（弱匹配）
            fetchMoodFromZhipu(clean).then(mood => { if (mood) { switchIllust(mood); bounceIllust(); } });
        }
        const memMatch = reply.match(/\[MEMORY:([^\]]+)\]/);
        if (memMatch && memories.length < 50) { memories.push({ text: memMatch[1] }); B.memorySave(memories); renderMemory(); }
    } catch (e) {
        appendMsg('assistant', '⚠️ ' + e.message);
    } finally {
        $('loadingIndicator').style.display = 'none';
        chatBusy = false;
    }
}
function clearChat() {
    // 清空前总结记忆（异步，不阻塞清空）
    const text = history.map(m => (m.role === 'user' ? '用户：' : '桌宠：') + m.content).join('\n');
    if (text.trim()) summarizeMemoryFromText(text);
    history = [];
    $('chatLog').innerHTML = '<div class="chat-empty">对话已清空</div>';
}

// 压缩时另外请求 api 生成压缩摘要（不直接作为消息发送）
async function requestContextSummary(text) {
    const messages = [
        { role: 'system', content: '你是一个对话压缩助手。请将以下对话压缩成一段简洁摘要，保留关键信息（用户偏好、重要事实、约定、进行中的事项），不超过100字，只返回摘要内容，不要加任何前缀。' },
        { role: 'user', content: text }
    ];
    const res = (config.deepseekEnabled && B.deepseekChat)
        ? await B.deepseekChat({ messages, maxTokens: 200, temperature: 0.5 })
        : await B.aiChat({ messages, maxTokens: 200, temperature: 0.5 });
    return (res.choices && res.choices[0]) ? res.choices[0].message.content.trim() : '';
}

// 从对话文本中提取长期记忆（参考原版 summarizeMemoryOnChatClose）
async function summarizeMemoryFromText(text) {
    if (!text) return;
    const existing = memories.length
        ? '\n\n已保存的记忆（请勿重复）：\n' + memories.map((m, i) => `${i + 1}. ${memText(m)}`).join('\n')
        : '';
    const messages = [
        { role: 'system', content: `你是一个记忆助手。请根据以下对话提取真正值得长期记忆的信息。\n规则：\n1. 只记录用户的偏好、重要事实、约定、重大事件等有长期价值的信息。\n2. 不要总结日常琐事。\n3. 如果没有值得长期记忆的信息，直接返回"无"。\n4. 每个记忆要点不超过20字，每行一个。\n5. 严格检查已保存的记忆，不要重复。${existing}` },
        { role: 'user', content: text }
    ];
    try {
        const res = (config.deepseekEnabled && B.deepseekChat)
            ? await B.deepseekChat({ messages, maxTokens: 100, temperature: 0.5 })
            : await B.aiChat({ messages, maxTokens: 100, temperature: 0.5 });
        const summary = (res.choices && res.choices[0]) ? res.choices[0].message.content.trim() : '';
        if (summary && summary !== '无') {
            const newMems = summary.split('\n')
                .map(l => l.replace(/^\d+\.\s*/, '').trim())
                .filter(l => l.length > 1 && l !== '无');
            let changed = false;
            for (const m of newMems) {
                if (memories.length >= 50) break;
                if (!memories.some(x => memText(x) === m)) { memories.push({ text: m }); changed = true; }
            }
            if (changed) { B.memorySave(memories); renderMemory(); }
        }
    } catch (e) {}
}

function compressChat() {
    if (history.length <= 4) return appendMsg('tool', '对话较短，无需压缩');
    const keepCount = 4;
    const toCompress = history.slice(0, -keepCount);
    const kept = history.slice(-keepCount);
    const rawText = toCompress.map(m => (m.role === 'user' ? '用户：' : '桌宠：') + m.content).join('\n');

    // 1. 折叠上文（UI）
    const log = $('chatLog');
    log.innerHTML = '';
    const details = document.createElement('details');
    details.className = 'collapsed-msg';
    details.innerHTML = `<summary>📎 已折叠 ${toCompress.length} 条对话</summary><div class="collapsed-body">${escapeHtml(rawText)}</div>`;
    log.appendChild(details);
    kept.forEach(m => appendMsg(m.role, m.content));

    // 2. 更新历史：仅保留最近消息，压缩原文不再进入后续上下文
    history = kept.slice();

    // 3. 压缩时另外请求 api 生成压缩日志（不直接作为消息发送）+ 总结记忆
    (async () => {
        try {
            const summary = await requestContextSummary(rawText);
            if (summary) {
                chatLogs.push({ id: ++chatLogId, time: Date.now(), count: toCompress.length, summary });
                appendMsg('tool', `📋 已生成压缩日志 #${chatLogId}`);
            }
        } catch (e) {}
        summarizeMemoryFromText(rawText);
    })();
}

// ===== 面板切换（进入时停止移动；标题栏可拖动窗口）=====
const petContainer = $('petContainer');
function enterChat() {
    isPanelOpen = true; pauseWander(); interruptChain();
    if (petContainer) petContainer.style.display = 'none';
    $('chatPanel').style.display = 'flex';
    $('inputBar').style.display = 'none';
    // 恢复之前保存的立绘显隐状态与宽度
    if (chatIllustPanel) chatIllustPanel.classList.toggle('hidden', !illustVisible);
    loadIllustWidth();
    // 无心情时先展示默认立绘
    if (chatIllustImg && !chatIllustImg.classList.contains('show')) {
        chatIllustImg.src = imgPath('pet.png');
        chatIllustImg.classList.add('show');
    }
    B.resize(CHAT_W, CHAT_H);
    $('chatTextInput').focus();
}
function exitChat() {
    $('chatPanel').style.display = 'none';
    if (petContainer) petContainer.style.display = '';
    isPanelOpen = false;
    B.resize(Math.round(getContainerWidth()), Math.round(getContainerHeight()));
    if (!isMouseHovering) resumeWander();
}
function openSettings() {
    isPanelOpen = true; pauseWander(); interruptChain();
    if (petContainer) petContainer.style.display = 'none';
    $('settingsPanel').style.display = 'flex';
    B.resize(CHAT_W, CHAT_H);
    fillSettings();
}
function closeSettings() {
    $('settingsPanel').style.display = 'none';
    if (petContainer) petContainer.style.display = '';
    isPanelOpen = false;
    B.resize(Math.round(getContainerWidth()), Math.round(getContainerHeight()));
    if (!isMouseHovering) resumeWander();
}

// 标题栏拖动窗口（进入聊天/设置页面后）
function initTitleBarDrag() {
    ['chatHeader', 'settingsHeader'].forEach(id => {
        const el = $(id);
        el.addEventListener('mousedown', (e) => {
            if (e.target.closest('button')) return;
            e.preventDefault();
            isPanelDrag = true;
            dragStartX = e.screenX; dragStartY = e.screenY;
            lastDragX = e.screenX; lastDragY = e.screenY;
            windowStartX = lastWindowX; windowStartY = lastWindowY;
        });
    });
}

// ===== 设置界面 =====
function fillSettings() {
    $('voiceToggle').checked = config.voiceEnabled;
    $('volumeSlider').value = Math.round(config.voiceVolume * 100);
    $('volumeLabel').textContent = Math.round(config.voiceVolume * 100) + '%';
    $('modeSelect').value = config.mode;
    $('sizeSlider').max = MAX_SIZE_SCALE;
    $('sizeSlider').value = config.size;
    $('sizeLabel').textContent = Math.round(config.size * 100) + '%';
    $('aiPromptInput').value = config.aiPrompt;
    $('cookieToggle').checked = config.cookieSpawnEnabled;
    $('autoStartToggle').checked = config.autoStart;
    $('apiKeyInput').value = config.zhipuApiKey;
    $('multimodalToggle').checked = config.multimodalEnabled;
    $('deepseekToggle').checked = config.deepseekEnabled;
    $('deepseekKeyInput').value = config.deepseekApiKey;
    $('illustToggle').checked = config.illustVisible !== false;
    $('interruptStateSelect').value = config.interruptState || 'wandering';
    renderChains();
}
function bindSettings() {
    $('voiceSelect').addEventListener('change', () => { config.selectedVoice = $('voiceSelect').value; saveConfig(); });
    $('voiceToggle').onchange = () => { config.voiceEnabled = $('voiceToggle').checked; saveConfig(); };
    $('volumeSlider').oninput = () => { config.voiceVolume = $('volumeSlider').value / 100; $('volumeLabel').textContent = $('volumeSlider').value + '%'; saveConfig(); };
    $('modeSelect').onchange = () => { config.mode = $('modeSelect').value; moveMode = config.mode; saveConfig(); B.setMoveMode(moveMode); };
    $('sizeSlider').oninput = () => {
        config.size = Number($('sizeSlider').value);
        currentPetSize = Math.round(BASE_PET_SIZE * config.size);
        $('sizeLabel').textContent = Math.round(config.size * 100) + '%';
        updateWindowSize(); saveConfig();
    };
    $('aiPromptInput').onchange = () => { config.aiPrompt = $('aiPromptInput').value; saveConfig(); };
    $('cookieToggle').onchange = () => { config.cookieSpawnEnabled = $('cookieToggle').checked; saveConfig(); B.setCookieEnabled(config.cookieSpawnEnabled); };
    $('autoStartToggle').onchange = () => { config.autoStart = $('autoStartToggle').checked; saveConfig(); B.setLoginItem(config.autoStart); };
    $('apiKeyInput').onchange = () => { config.zhipuApiKey = $('apiKeyInput').value; saveConfig(); B.setZhipuKey(config.zhipuApiKey); };
    $('multimodalToggle').onchange = () => { config.multimodalEnabled = $('multimodalToggle').checked; saveConfig(); B.setMultimodal(config.multimodalEnabled); };
    $('deepseekToggle').onchange = () => { config.deepseekEnabled = $('deepseekToggle').checked; saveConfig(); B.setDeepseekEnabled(config.deepseekEnabled); };
    $('deepseekKeyInput').onchange = () => { config.deepseekApiKey = $('deepseekKeyInput').value; saveConfig(); B.setDeepseekKey(config.deepseekApiKey); };
    // 立绘栏显隐（设置栏）
    $('illustToggle').onchange = () => { config.illustVisible = $('illustToggle').checked; saveConfig(); toggleIllustPanel(config.illustVisible); };
    // 测试当前 TTS 音色（忽略语音开关，直接播放）
    $('testTtsBtn').onclick = () => speak('这是当前音色的测试语音，你好呀！', true);
    // 状态链：被打断后进入的状态 + 增删状态链
    $('interruptStateSelect').onchange = () => { config.interruptState = $('interruptStateSelect').value; saveConfig(); };
    $('addChainBtn').onclick = addChain;
}

// ===== 状态链设置：列出 / 添加 / 删除 =====
function renderChains() {
    const box = $('chainList');
    if (!box) return;
    box.innerHTML = '';
    const chains = getStateChains();
    chains.forEach((chain, i) => {
        const states = Array.isArray(chain.states) ? chain.states : [];
        const div = document.createElement('div');
        div.className = 'chain-item';
        const text = states.length ? states.map(s => STATE_LABELS[s] || s).join(' → ') : '（空）';
        div.innerHTML = `<span>${text}</span><button class="chain-del" data-i="${i}" title="删除该状态链">删</button>`;
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
function addChain() {
    const input = $('chainStatesInput');
    const raw = (input.value || '').trim();
    if (!raw) return;
    const states = raw.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
    if (!states.length) { input.value = ''; return; }
    const valid = states.every(s => KNOWN_STATES.includes(s));
    if (!valid) { input.value = ''; return; }
    config.stateChains = getStateChains().concat([{ states }]);
    saveConfig(); renderChains(); input.value = '';
}
B.onConfigUpdated((d) => {
    if (d.zhipuApiKey !== undefined) config.zhipuApiKey = d.zhipuApiKey;
    if (d.multimodalEnabled !== undefined) config.multimodalEnabled = d.multimodalEnabled;
    if (d.cookieSpawnEnabled !== undefined) config.cookieSpawnEnabled = d.cookieSpawnEnabled;
    if (d.deepseekEnabled !== undefined) config.deepseekEnabled = d.deepseekEnabled;
    if (d.deepseekApiKey !== undefined) config.deepseekApiKey = d.deepseekApiKey;
});

// ===== 贴图包选择（参考原版 index：展示 pet 预览图）=====
async function loadStickerPacks() {
    let packs = [];
    try { packs = await B.listStickerPacks(); } catch (e) {}
    if (!packs.length) packs = [{ name: '默认', preview: 'img/默认/pet.png' }];
    renderPackList(packs);
}
function renderPackList(packs) {
    const list = $('stickerPackList');
    list.innerHTML = '';
    const current = config.stickerPack || '默认';
    packs.forEach(pack => {
        const item = document.createElement('div');
        item.className = 'sticker-pack-item' + (pack.name === current ? ' active' : '');
        item.innerHTML = `<img src="${pack.preview || ''}" alt="${pack.name}" onerror="this.style.display='none'"><div class="pack-name">${pack.name}</div>`;
        item.addEventListener('click', () => {
            config.stickerPack = pack.name;
            window._stickerPack = pack.name;
            saveConfig();
            document.querySelectorAll('.sticker-pack-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            petImg.src = (PET_IMGS[petState] || ORIGINAL_PET_SRC)();
        });
        list.appendChild(item);
    });
}

// ===== 事件绑定（移动行为照搬原版）=====
document.addEventListener('mousemove', (e) => {
    // 标题栏拖动
    if (isPanelDrag) {
        const dx = e.screenX - dragStartX;
        const dy = e.screenY - dragStartY;
        moveFloatWindowTo(windowStartX + dx, windowStartY + dy);
        return;
    }
    // 桌宠拖拽
    if (isDragging) {
        const dx = e.screenX - dragStartX;
        const dy = e.screenY - dragStartY;
        const now = performance.now();
        const dt = Math.max(now - lastDragTime, 1);
        dragVelocityX = (e.screenX - lastDragX) / dt;
        dragVelocityY = (e.screenY - lastDragY) / dt;
        lastDragX = e.screenX; lastDragY = e.screenY; lastDragTime = now;
        moveFloatWindowTo(windowStartX + dx, windowStartY + dy);
        pauseWander();
        feedPendulum(e.clientX);
        return;
    }

    // 气泡 + 悬停
    const winX = window.screenX, winY = window.screenY;
    const winW = getContainerWidth(), winH = getContainerHeight();
    let dx = 0, dy = 0;
    if (e.screenX < winX) dx = winX - e.screenX;
    else if (e.screenX > winX + winW) dx = e.screenX - (winX + winW);
    if (e.screenY < winY) dy = winY - e.screenY;
    else if (e.screenY > winY + winH) dy = e.screenY - (winY + winH);
    const dist = Math.sqrt(dx * dx + dy * dy);
    floatBubble.classList.toggle('show', dist < BUBBLE_SHOW_DISTANCE);
    // 底部输入栏：鼠标靠近时显示
    $('inputBar').style.display = (!isPanelOpen && dist < INPUT_BAR_DISTANCE) ? 'flex' : 'none';

    const wasHovering = isMouseHovering;
    isMouseHovering = dist < HOVER_STOP_DISTANCE;
    if (wasHovering && !isMouseHovering && !isDragging && !isParabolaRunning && !isPanelOpen) resumeWander();
});

document.addEventListener('mouseup', (e) => {
    if (isPanelDrag) { isPanelDrag = false; return; }
    if (isDragging) {
        isDragging = false;
        stopPendulum();
        petImg.src = (PET_IMGS[petState] || ORIGINAL_PET_SRC)();
        // 释放后若仍在吃饭状态，恢复压缩动画
        if (petState === 'eating') petImg.classList.add('eating-stretch');
        if (moveMode === 'gravity') throwWithParabola(dragVelocityX, dragVelocityY);
        else setTimeout(() => { if (!MOVEMENT_BLOCKED_STATES.includes(petState)) resumeWander(); }, 3000);
    }
});

document.addEventListener('mouseleave', () => {
    if (isMouseHovering) {
        isMouseHovering = false;
        floatBubble.classList.remove('show');
        $('inputBar').style.display = 'none';
        if (!isParabolaRunning) resumeWander();
    }
});

petEl.addEventListener('mousedown', (e) => {
    if (e.target.closest('input,textarea,select,.bubble-option')) return;
    e.preventDefault();
    e.stopPropagation();
    if (petState === 'angry') return;
    isDragging = true;
    interruptChain(); // 拖拽打断状态链
    dragStartX = e.screenX; dragStartY = e.screenY;
    lastDragX = e.screenX; lastDragY = e.screenY; lastDragTime = performance.now();
    dragVelocityX = 0; dragVelocityY = 0;
    windowStartX = lastWindowX; windowStartY = lastWindowY;
    // 拖动时停止吃饭压缩动画，让单摆效果可执行
    petImg.classList.remove('eating-stretch');
    petImg.src = DRAG_PET_SRC();
    startPendulum();
    feedPendulum(e.clientX);
});

petEl.addEventListener('dragstart', (e) => { e.preventDefault(); e.stopPropagation(); });
document.addEventListener('selectstart', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => { if (e.target === petEl || petEl.contains(e.target)) return; e.preventDefault(); });

petEl.addEventListener('click', (e) => {
    if (isDragging) return;
    if (petState === 'angry') { randomStateTransition(); return; }
    triggerEffect(['bounce', 'shake', 'hearts', 'stars'][Math.floor(Math.random() * 4)]);
});

floatBubble.querySelectorAll('.bubble-option').forEach(opt => {
    opt.addEventListener('click', (e) => {
        e.stopPropagation();
        floatBubble.classList.remove('show');
        const action = opt.dataset.action;
        if (action === 'chat') enterChat();
        else if (action === 'settings') openSettings();
    });
});

// 抛物线（重力模式，照搬原版）
function throwWithParabola(vx, vy) {
    const gravity = 0.002;
    let posX = lastWindowX, posY = lastWindowY;
    let velX = Math.max(-2.0, Math.min(2.0, vx));
    let velY = Math.max(-2.0, Math.min(2.0, vy));
    if (!Number.isFinite(posX)) posX = screenWidth / 2;
    if (!Number.isFinite(posY)) posY = screenHeight / 2;
    if (!Number.isFinite(velX)) velX = 0;
    if (!Number.isFinite(velY)) velY = 0;
    if (velX === 0 && velY === 0) velX = (Math.random() < 0.5 ? -1 : 1) * 0.5;
    isMoving = true;
    isParabolaRunning = true;
    let lastTime = performance.now();
    const step = () => {
        if (isDragging || !isMoving || isPanelOpen) { isParabolaRunning = false; return; }
        const now = performance.now();
        const dt = now - lastTime;
        lastTime = now;
        velY += gravity * dt;
        posX += velX * dt;
        posY += velY * dt;
        const winW = getContainerWidth();
        const groundY = screenY + screenHeight - getPetBottomOffset();
        if (posX < screenX) { posX = screenX; velX = Math.abs(velX) * 0.4; }
        else if (posX + winW > screenX + screenWidth) { posX = screenX + screenWidth - winW; velX = -Math.abs(velX) * 0.4; }
        if (posY < screenY) { posY = screenY; velY = Math.abs(velY) * 0.4; }
        if (posY >= groundY) {
            posY = groundY;
            if (Math.abs(velY) > 0.1) { velY = -velY * 0.4; velX *= 0.7; }
            else {
                velY = 0; velX *= 0.8;
                if (Math.abs(velX) < 0.01) {
                    velX = 0;
                    moveFloatWindowTo(posX, posY);
                    isParabolaRunning = false;
                    setTimeout(() => { if (!MOVEMENT_BLOCKED_STATES.includes(petState)) resumeWander(); }, 1500);
                    return;
                }
            }
        }
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

// ===== 饼干系统（发现→追逐→吃饼干，参考原版）=====
let cookieState = { x: 0, y: 0, active: false, consumed: false };
let cookieSize = 40;

function getEntityCenterXOffset() { return getContainerWidth() / 2; }
function getCookieCenterX() { return cookieState.x + cookieSize / 2; }
function getCookieCenterY() { return cookieState.y + cookieSize / 2; }
function checkCookieCollisionAt(posX, posY) {
    if (!cookieState.active || cookieState.consumed) return false;
    const petCenterX = posX + getEntityCenterXOffset();
    const petCenterY = getPetCenterY(posY);
    return Math.hypot(petCenterX - getCookieCenterX(), petCenterY - getCookieCenterY()) < (currentPetSize / 2 + cookieSize / 2);
}
function eatCookie() {
    if (!cookieState.active || cookieState.consumed) return;
    cookieState.consumed = true;
    setPetState('eating_cookie');
    if (B && B.eatCookie) B.eatCookie();
    setTimeout(() => { cookieState.active = false; cookieState.consumed = false; }, STATE_DURATIONS.eating_cookie);
}
function wanderToCookie() {
    if (!cookieState.active || cookieState.consumed) return;
    if (isDragging || isMouseHovering) return;
    isMoving = true;
    petImg.classList.add('walking');
    let targetX = cookieState.x - getEntityCenterXOffset() + cookieSize / 2;
    let targetY = moveMode === 'gravity' ? lastWindowY : cookieState.y + cookieSize / 2 - getPetCenterOffset();
    const dx = targetX - lastWindowX;
    const dy = targetY - lastWindowY;
    const dist = Math.hypot(dx, dy);
    if (dist < 5) {
        isMoving = false; petImg.classList.remove('walking');
        eatCookie(); return;
    }
    const stepX = (dx / dist) * MOVE_SPEED;
    const stepY = (dy / dist) * MOVE_SPEED;
    const maxStep = MOVE_SPEED * 2;
    let clampedStepX = Math.max(-maxStep, Math.min(maxStep, stepX));
    let clampedStepY = Math.max(-maxStep, Math.min(maxStep, stepY));
    if (moveMode === 'gravity') clampedStepY = 0;
    if (clampedStepX > 0) petImg.classList.add('flip');
    else if (clampedStepX < 0) petImg.classList.remove('flip');
    const totalSteps = Math.ceil((moveMode === 'gravity' ? Math.abs(dx) : dist) / MOVE_SPEED);
    let currentStep = 0;
    const moveStep = () => {
        if (!isMoving || isDragging || isMouseHovering) { petImg.classList.remove('walking'); isMoving = false; return; }
        if (!cookieState.active || cookieState.consumed) { petImg.classList.remove('walking'); isMoving = false; return; }
        currentStep++;
        if (currentStep >= totalSteps) { lastWindowX = targetX; if (moveMode !== 'gravity') lastWindowY = targetY; }
        else { lastWindowX += clampedStepX; if (moveMode !== 'gravity') lastWindowY += clampedStepY; }
        lastWindowX = Math.max(screenX, Math.min(screenX + screenWidth - getContainerWidth(), lastWindowX));
        if (moveMode !== 'gravity') lastWindowY = Math.max(screenY, Math.min(screenY + screenHeight - getContainerHeight(), lastWindowY));
        moveFloatWindowTo(lastWindowX, lastWindowY);
        if (checkCookieCollisionAt(lastWindowX, lastWindowY)) { petImg.classList.remove('walking'); isMoving = false; eatCookie(); return; }
        if (currentStep < totalSteps) setTimeout(moveStep, MOVE_INTERVAL_MS);
        else {
            petImg.classList.remove('walking'); isMoving = false;
            if (cookieState.active && !cookieState.consumed && petState === 'craving') setTimeout(() => wanderToCookie(), 100);
        }
    };
    moveStep();
}
function initCookieListeners() {
    if (!B) return;
    if (B.onCookiePositionUpdate) B.onCookiePositionUpdate((pos) => {
        if (!pos || !pos.active) return;
        cookieState.active = true;
        cookieState.x = pos.x;
        cookieState.y = pos.y;
        cookieState.consumed = false;
        if (typeof pos.size === 'number') cookieSize = pos.size;
        interruptChain(); // 发现饼干，打断当前状态链
        // 只要饼干存在就进入追逐，不受距离限制（否则远处生成的饼干永远追不上，吃不到也不切换贴图）
        if (petState !== 'craving' && petState !== 'eating_cookie' &&
            petState !== 'sleeping' && petState !== 'working' &&
            !isDragging && !isMouseHovering) setPetState('craving');
    });
    if (B.onCookieConsumed) B.onCookieConsumed(() => {
        cookieState.active = false; cookieState.consumed = false;
        if (petState !== 'eating_cookie') setPetState('wandering');
    });
}

// ===== 初始化 =====
async function init() {
    updateWindowSize();
    petImg.src = ORIGINAL_PET_SRC();

    // 音色下拉（附带描述）
    try {
        const voices = await B.getTtsVoices();
        const sel = $('voiceSelect');
        sel.innerHTML = '<option value="default">🔄 自动选择（推荐）</option>';
        voices.forEach(v => { const o = document.createElement('option'); o.value = v.id; o.textContent = v.id + ' · ' + v.desc; sel.appendChild(o); });
        sel.value = config.selectedVoice;
    } catch (e) {}

    await loadStickerPacks();
    bindSettings();
    await refreshMemory();

    // 同步共享配置到主进程
    B.setZhipuKey(config.zhipuApiKey);
    B.setMultimodal(config.multimodalEnabled);
    B.setCookieEnabled(config.cookieSpawnEnabled);
    B.setLoginItem(config.autoStart);
    B.setDeepseekEnabled(config.deepseekEnabled);
    B.setDeepseekKey(config.deepseekApiKey);
    B.setMoveMode(config.mode);
    B.setBottomGap(BOTTOM_CHAT_BOX_GAP);

    initTitleBarDrag();
    initIllustResize();
    initIllustToggle();
    initCookieListeners();

    // 面板/按钮事件
    $('closeSettingsBtn').onclick = closeSettings;
    $('closeChatBtn').onclick = exitChat;
    $('clearBtn').onclick = clearChat;
    $('compressBtn').onclick = compressChat;
    $('quitBtn').onclick = () => B.quit();
    $('sendBtn').onclick = () => { const v = $('chatInput').value; if (v.trim()) { enterChat(); sendChat(v); $('chatInput').value = ''; } };
    $('chatSendBtn').onclick = () => { const v = $('chatTextInput').value; if (v.trim()) { sendChat(v); $('chatTextInput').value = ''; } };
    $('chatTextInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('chatSendBtn').click(); });
    $('chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('sendBtn').click(); });
    $('addMemBtn').onclick = () => { const v = $('memoryInput').value.trim(); if (v) { memories.push({ text: v }); B.memorySave(memories); renderMemory(); $('memoryInput').value = ''; } };
    B.onMemoryUpdated((items) => { memories = items || []; renderMemory(); });

    // 桌宠状态定时随机切换（游荡由该定时器驱动，照搬原版 5s）
    setInterval(() => {
        if (isPanelOpen || isDragging || isMouseHovering) return;
        if (petState !== 'wandering') return;
        randomStateTransition();
    }, 5000);

    startWander();
}
if (typeof B !== 'undefined' && B) init();