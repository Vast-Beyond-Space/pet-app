// electron-lite main.js — 轻量桌宠（仅浮窗+聊天），与原版共享设置(petConfig)和记忆(petMemory.json)
const { app, BrowserWindow, ipcMain, screen, desktopCapturer } = require('electron');
const path = require('path');
const https = require('https');
const fs = require('fs');

// ===== 与原版共享用户数据目录（localStorage + petMemory.json 互通）=====
// 原版 productName 为 pet-app，userData = %APPDATA%/pet-app
app.setPath('userData', path.join(app.getPath('appData'), 'pet-app'));

// 独立版：资源在本目录（开发在 __dirname，打包后复制到 resources 下）
function getResourcePath(...segments) {
    if (process.resourcesPath && fs.existsSync(path.join(process.resourcesPath, ...segments))) {
        return path.join(process.resourcesPath, ...segments);
    }
    return path.join(__dirname, ...segments);
}
const RES_DIR = getResourcePath();
const PYTHON = process.platform === 'win32'
    ? getResourcePath('python', 'python.exe')
    : getResourcePath('python', 'python');
const TTS_SCRIPT = getResourcePath('tts_service', 'tts_server.py');
const MEMORY_FILE = path.join(app.getPath('userData'), 'petMemory.json');

// ===== 运行时状态 =====
let win = null;
let cookieWin = null;
let cookiePosTimer = null;
let ttsProcess = null;
let ttsReady = false;
let zhipuApiKey = '';
let multimodalEnabled = false;
let cookieSpawnEnabled = true;
let deepseekEnabled = false;
let deepseekApiKey = '';
let moveMode = 'free';
let bottomGap = 60; // 贴图底部与窗口底边的空隙（由浮窗同步，两个聊天框的高度）

// 取可用的 python（优先嵌入式，其次系统）
function resolvePython() {
    if (fs.existsSync(PYTHON)) return PYTHON;
    if (process.platform === 'win32') return 'python';
    return 'python3';
}

// ===== 浮窗 =====
function createFloatWindow() {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    win = new BrowserWindow({
        width: 220,
        height: 220,
        x: Math.max(0, Math.round(width - 260)),
        y: Math.max(0, Math.round(height - 260)),
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: true,
        skipTaskbar: true,
        hasShadow: false,
        autoHideMenuBar: true,
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
    });
    win.loadFile(path.join(__dirname, 'float.html'));
    win.setAlwaysOnTop(true, 'screen-saver');
    setupDoubleCtrl(win.webContents);
    win.on('closed', () => { win = null; });
}

// ===== 窗口控制 =====
ipcMain.on('win-move', (e, x, y) => { if (win && !win.isDestroyed()) win.setPosition(Math.round(x), Math.round(y)); });
ipcMain.on('win-move-by', (e, dx, dy) => { if (win && !win.isDestroyed()) { const [x, y] = win.getPosition(); win.setPosition(x + Math.round(dx), y + Math.round(dy)); } });
ipcMain.on('win-resize', (e, w, h) => { if (win && !win.isDestroyed()) win.setSize(Math.round(w), Math.round(h)); });
ipcMain.on('win-quit', () => app.quit());

// ===== 开机自启动 =====
ipcMain.on('set-login-item', (e, enabled) => {
    try { app.setLoginItemSettings({ openAtLogin: !!enabled }); } catch (err) { console.error('[lite] setLoginItemSettings', err); }
});

// ===== 记忆（与原版共享 petMemory.json）=====
function loadMemory() {
    try { return fs.existsSync(MEMORY_FILE) ? JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8')) : []; }
    catch (err) { console.error('[lite] 读取记忆失败', err); return []; }
}
function saveMemory(items) {
    try { fs.writeFileSync(MEMORY_FILE, JSON.stringify(items || []), 'utf-8'); return true; }
    catch (err) { console.error('[lite] 保存记忆失败', err); return false; }
}
function broadcastMemory(items) {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('memory-updated', items);
}
ipcMain.handle('memory-load', () => loadMemory());
ipcMain.handle('memory-save', (e, items) => { const ok = saveMemory(items); broadcastMemory(items); return ok; });

// ===== 配置同步（仅广播，持久化由渲染进程写 localStorage）=====
function broadcastConfig() {
    const data = { zhipuApiKey, multimodalEnabled, cookieSpawnEnabled, deepseekEnabled, deepseekApiKey };
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('config-updated', data);
}
ipcMain.on('set-zhipu-key', (e, k) => { zhipuApiKey = String(k || ''); broadcastConfig(); });
ipcMain.on('set-multimodal', (e, v) => { multimodalEnabled = !!v; broadcastConfig(); });
ipcMain.on('set-cookie-enabled', (e, v) => { cookieSpawnEnabled = !!v; if (!v) closeCookie(); broadcastConfig(); });
ipcMain.on('set-deepseek-enabled', (e, v) => { deepseekEnabled = !!v; broadcastConfig(); });
ipcMain.on('set-deepseek-key', (e, k) => { deepseekApiKey = String(k || ''); broadcastConfig(); });
ipcMain.on('set-move-mode', (e, m) => { moveMode = m === 'gravity' ? 'gravity' : 'free'; });
ipcMain.on('set-bottom-gap', (e, g) => { bottomGap = Number(g) > 0 ? Number(g) : 60; });

// ===== TTS（懒启动，复用原版 edge-tts 服务）=====
function ensureTTS() {
    if (ttsProcess) return true;
    if (!fs.existsSync(TTS_SCRIPT)) { console.warn('[lite] TTS 脚本不存在'); return false; }
    ttsProcess = require('child_process').spawn(resolvePython(), [TTS_SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
    ttsProcess.stderr.on('data', d => console.log('[lite-tts]', String(d).trim()));
    ttsProcess.on('close', () => { ttsProcess = null; ttsReady = false; });
    ttsProcess.on('error', () => { ttsProcess = null; ttsReady = false; });
    // 等待 Python 服务启动完成
    setTimeout(() => { ttsReady = true; }, 1500);
    return true;
}
ipcMain.handle('speak-text', (e, text, voice) => new Promise((resolve, reject) => {
    if (!ensureTTS()) return reject(new Error('TTS 不可用'));
    if (!ttsReady) return reject(new Error('TTS 服务加载中，请稍候'));
    const clean = String(text || '').replace(/<MOOD:[^>]+>|<CMD:[^>]+>|\[MEMORY:[^\]]+\]|\[SHORT_MEMORY:[^\]]+\]/g, '').trim();
    const request_id = Date.now().toString();
    const payload = JSON.stringify({ text: Buffer.from(clean).toString('base64'), voice: voice || 'zh-CN-XiaoxiaoNeural', request_id, _text_encoded: true });
    const timer = setTimeout(() => resolve(null), 30000);
    const onData = (data) => {
        try {
            const msg = JSON.parse(data.toString().trim());
            if (msg && msg.request_id === request_id) {
                clearTimeout(timer); ttsProcess.stdout.off('data', onData);
                resolve(msg.success && msg.audio ? msg.audio : null);
            }
        } catch (e) { /* 忽略非 JSON */ }
    };
    ttsProcess.stdout.on('data', onData);
    ttsProcess.stdin.write(payload + '\n');
}));
ipcMain.handle('get-tts-voices', () => [
    { id: 'zh-CN-XiaoxiaoNeural', desc: '晓晓 · 温暖女声，日常对话首选' },
    { id: 'zh-CN-YunxiNeural', desc: '云希 · 阳光少年男声' },
    { id: 'zh-CN-YunjianNeural', desc: '云健 · 沉稳男声' },
    { id: 'zh-CN-XiaoyiNeural', desc: '晓伊 · 甜美活泼女声' },
    { id: 'zh-CN-YunyangNeural', desc: '云扬 · 浑厚男声' },
    { id: 'zh-CN-XiaohanNeural', desc: '晓涵 · 自然亲切女声' },
    { id: 'zh-CN-XiaomengNeural', desc: '晓梦 · 细腻少年音' },
    { id: 'zh-CN-XiaoruiNeural', desc: '晓睿 · 知性女声' },
    { id: 'zh-CN-XiaoshuangNeural', desc: '晓双 · 童声可爱' },
    { id: 'zh-CN-XiaoxuanNeural', desc: '晓萱 · 温柔女声' },
    { id: 'zh-CN-XiaoyanNeural', desc: '晓颜 · 少儿清爽声' },
    { id: 'zh-CN-XiaoyouNeural', desc: '晓悠 · 开心明亮女声' },
    { id: 'zh-CN-XiaozhenNeural', desc: '晓甄 · 沉稳磁性女声' }
]);

// ===== 贴图包列表（返回名称+预览图，供设置界面展示 pet 图片）=====
ipcMain.handle('list-sticker-packs', () => {
    const imgDir = getResourcePath('img');
    const packs = [];
    try {
        const entries = fs.readdirSync(imgDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const packDir = path.join(imgDir, entry.name);
            let preview = null;
            try {
                const files = fs.readdirSync(packDir);
                const petFile = files.find(f => {
                    const lower = f.toLowerCase();
                    return lower.startsWith('pet') && /\.(png|jpg|jpeg|gif|webp|bmp|ico)$/i.test(f);
                });
                preview = petFile ? `img/${entry.name}/${petFile}` : null;
            } catch (e) {}
            packs.push({ name: entry.name, preview });
        }
    } catch (e) {}
    return packs.length ? packs : [{ name: '默认', preview: 'img/默认/pet.png' }];
});

// ===== AI 对话（智谱）=====
ipcMain.handle('ai-chat', (e, { messages, maxTokens = 200, temperature = 0.8 }) => new Promise((resolve, reject) => {
    if (!zhipuApiKey) return reject(new Error('请先在设置中填写智谱 API Key'));
    const model = 'glm-4-flash';
    const body = JSON.stringify({ model, messages, max_tokens: maxTokens, temperature });
    const req = https.request({
        hostname: 'open.bigmodel.cn', path: '/api/paas/v4/chat/completions', method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${zhipuApiKey}`, 'Content-Length': Buffer.byteLength(body) },
        rejectUnauthorized: false, timeout: 30000
    }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => { try { const j = JSON.parse(data); j.error ? reject(new Error(j.error.message)) : resolve(j); } catch (err) { reject(new Error('解析失败')); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    req.write(body); req.end();
}));

// ===== DeepSeek 对话（OpenAI 兼容接口）=====
ipcMain.handle('deepseek-chat', (e, { messages, maxTokens = 300, temperature = 0.8 }) => new Promise((resolve, reject) => {
    if (!deepseekApiKey) return reject(new Error('请先在设置中填写 DeepSeek API Key'));
    const body = JSON.stringify({ model: 'deepseek-chat', messages, max_tokens: maxTokens, temperature });
    const req = https.request({
        hostname: 'api.deepseek.com', path: '/chat/completions', method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deepseekApiKey}`, 'Content-Length': Buffer.byteLength(body) },
        rejectUnauthorized: false, timeout: 30000
    }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => { try { const j = JSON.parse(data); j.error ? reject(new Error(j.error.message)) : resolve(j); } catch (err) { reject(new Error('解析失败')); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    req.write(body); req.end();
}));

// ===== 多模态：截屏并让 GLM-4V 总结 =====
ipcMain.handle('capture-screen', async (e, recentMessages) => {
    if (!zhipuApiKey) throw new Error('请先填写智谱 API Key');
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 800, height: 600 } });
    const source = sources[0];
    if (!source) throw new Error('未找到屏幕源');
    const base64 = source.thumbnail.toJPEG(70).toString('base64');
    const res = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${zhipuApiKey}` },
        body: JSON.stringify({
            model: 'glm-4v-flash',
            messages: [
                { role: 'system', content: '你是屏幕分析助手，用一句话总结用户当前在做什么，以及与对话相关的环境线索。' },
                { role: 'user', content: [{ type: 'text', text: `最近对话：${recentMessages || '无'}` }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } }] }
            ],
            max_tokens: 100, temperature: 0.5
        })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return (data.choices && data.choices[0]) ? data.choices[0].message.content.trim() : '';
});

// ===== 饼干 =====
let cookieState = { x: 0, y: 0, active: false, consumed: false };
let cookieSize = 40;
function sendCookiePosition() {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('cookie-position', { x: cookieState.x, y: cookieState.y, active: cookieState.active, size: cookieSize });
}
function createCookie() {
    if (cookieWin) return;
    const pet = screen.getPrimaryDisplay().workArea;
    const size = 60;
    let cx, cy;
    if (moveMode === 'gravity') {
        // 重力模式：饼干从顶部随机位置下落，落点与桌宠同一“地面”（下方留出两个聊天框的空隙）
        cx = pet.x + Math.round((pet.width - size) * Math.random());
        cy = pet.y;
    } else {
        cx = pet.x + Math.round((pet.width - size) * Math.random());
        cy = pet.y + Math.round((pet.height - size) * Math.random());
    }
    cookieWin = new BrowserWindow({
        width: size, height: size,
        x: cx, y: cy,
        frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, hasShadow: false,
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
    });
    cookieWin.loadFile(path.join(__dirname, 'cookie.html'));
    // 拖动/右键删除兜底：光标移出窗口时渲染进程可能收不到 mouseup，这里在主进程兜底
    cookieWin.webContents.on('before-input-event', (event, input) => {
        if (input.type === 'mouseUp' && input.button === 0) stopCookieDrag();
        else if (input.type === 'mouseDown' && input.button === 2) closeCookie();
    });
    cookieWin.on('closed', () => {
        cookieWin = null;
        stopCookieDrag();
        if (cookieFallTimer) { clearInterval(cookieFallTimer); cookieFallTimer = null; }
        if (cookiePosTimer) { clearInterval(cookiePosTimer); cookiePosTimer = null; }
        cookieState.active = false; cookieState.consumed = false; sendCookiePosition();
    });
    cookieState = { x: cx, y: cy, active: true, consumed: false };
    sendCookiePosition();
    // 重力模式：饼干从顶部下落
    if (moveMode === 'gravity') startCookieFall(cx, cy);
    // 周期广播饼干位置，确保浮窗随时能发现并追逐
    if (cookiePosTimer) clearInterval(cookiePosTimer);
    cookiePosTimer = setInterval(() => { if (cookieWin && !cookieWin.isDestroyed()) sendCookiePosition(); }, 500);
    setTimeout(() => { if (cookieSpawnEnabled && !cookieWin) scheduleCookie(); }, 30000 + Math.random() * 60000);
}
function scheduleCookie() {
    if (!cookieSpawnEnabled || cookieWin) return;
    createCookie();
}

// ===== 重力模式饼干下落：落点与桌宠同一“地面”（底部留出两个聊天框的空隙）=====
let cookieFallTimer = null;
function startCookieFall(startX, startY) {
    if (cookieFallTimer) clearInterval(cookieFallTimer);
    const area = screen.getPrimaryDisplay().workArea;
    const size = (cookieWin && !cookieWin.isDestroyed()) ? cookieWin.getSize()[0] : 60;
    // 参考 float.html 的地板：贴图底部与窗口/屏幕底边留出 bottomGap 的空隙
    const groundY = area.y + area.height - bottomGap - size;
    let y = startY, vy = 0;
    const gravity = 0.6;
    cookieFallTimer = setInterval(() => {
        if (!cookieWin || cookieWin.isDestroyed()) { cookieFallTimer = null; return; }
        vy += gravity;
        y += vy;
        if (y >= groundY) { y = groundY; clearInterval(cookieFallTimer); cookieFallTimer = null; }
        cookieWin.setPosition(startX, Math.round(y));
        if (cookieState.active) { cookieState.x = startX; cookieState.y = y; sendCookiePosition(); }
    }, 16);
}
function closeCookie() {
    if (cookieWin) cookieWin.close();
    if (cookiePosTimer) { clearInterval(cookiePosTimer); cookiePosTimer = null; }
    cookieState.active = false; cookieState.consumed = false;
    if (win && !win.isDestroyed()) win.webContents.send('cookie-consumed');
}
ipcMain.on('eat-cookie', () => { closeCookie(); });
ipcMain.on('request-cookie', () => createCookie());

// ===== 饼干拖动（主进程轮询光标，移动窗口并同步坐标）=====
let cookieDrag = null; // { offX, offY } 光标与窗口左上角的偏移
let cookieDragTimer = null;
function stopCookieDrag() {
    cookieDrag = null;
    if (cookieDragTimer) { clearInterval(cookieDragTimer); cookieDragTimer = null; }
}
function startCookieDrag(sx, sy) {
    if (!cookieWin || cookieWin.isDestroyed()) return;
    const [wx, wy] = cookieWin.getPosition();
    cookieDrag = { offX: sx - wx, offY: sy - wy };
    if (cookieDragTimer) clearInterval(cookieDragTimer);
    cookieDragTimer = setInterval(() => {
        if (!cookieDrag || !cookieWin || cookieWin.isDestroyed()) { stopCookieDrag(); return; }
        const p = screen.getCursorScreenPoint();
        const nx = p.x - cookieDrag.offX;
        const ny = p.y - cookieDrag.offY;
        cookieWin.setPosition(Math.round(nx), Math.round(ny));
        // 拖动时同步饼干坐标，桌宠仍能发现并追逐被移动的饼干
        if (cookieState.active) { cookieState.x = nx; cookieState.y = ny; sendCookiePosition(); }
    }, 16);
}
ipcMain.on('cookie-drag-start', (e, sx, sy) => startCookieDrag(sx, sy));
ipcMain.on('cookie-drag-end', () => stopCookieDrag());
ipcMain.on('cookie-delete', () => closeCookie());

// ===== 双击 Ctrl 生成饼干（窗口有焦点时有效）=====
let ctrlCount = 0;
let ctrlTimer = null;
function setupDoubleCtrl(webContents) {
    webContents.on('before-input-event', (event, input) => {
        if (input.key === 'Control' && input.type === 'keyDown' && !input.repeat) {
            ctrlCount++;
            if (ctrlTimer) clearTimeout(ctrlTimer);
            ctrlTimer = setTimeout(() => { ctrlCount = 0; }, 400);
            if (ctrlCount >= 2) {
                ctrlCount = 0;
                if (cookieSpawnEnabled && !(cookieWin && !cookieWin.isDestroyed())) createCookie();
            }
        }
    });
}

// ===== 生命周期 =====
app.whenReady().then(() => {
    createFloatWindow();
    // 全局快捷键：Ctrl+Shift+C 生成饼干（需 app ready 后注册）
    try {
        const { globalShortcut } = require('electron');
        globalShortcut.register('CmdOrCtrl+Shift+C', () => {
            if (cookieSpawnEnabled && !(cookieWin && !cookieWin.isDestroyed())) createCookie();
        });
    } catch (e) {}
    if (cookieSpawnEnabled) scheduleCookie();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createFloatWindow(); });
});
app.on('before-quit', () => {
    if (ttsProcess) { try { ttsProcess.kill(); } catch (e) {} }
});
app.on('window-all-closed', () => app.quit());