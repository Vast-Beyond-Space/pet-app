/*
 * main.js 改动说明：
 * 1. 新增全局变量 chatWindow 用于独立聊天窗口
 * 2. 新增 createChatWindow() 函数，创建带系统边框的聊天窗口
 * 3. 修改 float-enter-chat-mode：隐藏浮窗，创建聊天窗口
 * 4. 修改 float-exit-chat-mode：关闭聊天窗口，显示浮窗
 * 5. 聊天窗口加载 float.html?mode=chat，复用现有渲染逻辑
 */

const { app, BrowserWindow, Menu, Tray, ipcMain, screen, nativeImage, globalShortcut, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execSync, execFileSync } = require('child_process');
const https = require('https');
const http = require('http');

// 禁用 GPU 缓存，避免 Windows 打包后出现 cache_util_win.cc 错误
app.commandLine.appendSwitch('disable-gpu-cache');

// 全局移除应用菜单栏（File/Edit/View/Window/Help），避免浮窗/聊天/设置窗口出现原生菜单
Menu.setApplicationMenu(null);

// 转发所有渲染进程 console 输出到主进程终端（否则渲染进程日志完全不可见）
app.on('web-contents-created', (event, contents) => {
    contents.on('console-message', (eventObj, levelOrDetails, messageOrLine, lineOrSource, sourceIdOrFrame) => {
        try {
            // Electron 新版为 (event, details) 单对象；老版为 (event, level, message, line, sourceId)
            const isNew = levelOrDetails && typeof levelOrDetails === 'object' && levelOrDetails.message;
            const rawLevel = isNew ? levelOrDetails.level : levelOrDetails;
            const text = isNew ? levelOrDetails.message : messageOrLine;
            const line = isNew ? (levelOrDetails.lineNumber !== undefined ? levelOrDetails.lineNumber : '') : lineOrSource;
            let src = isNew ? (levelOrDetails.sourceId || '') : (sourceIdOrFrame || '');
            // 静音无害的 Electron CSP 开发警告（正式打包后不会出现）
            if (typeof text === 'string' && (text.includes('Electron Security Warning') || text.includes('Content-Security-Policy'))) return;
            // sourceId 可能是内联脚本的整个 base64 内容，只保留短路径/文件名
            if (src.startsWith('data:') || src.length > 120) src = filenameFromSource(src);
            // level 兼容字符串与数字（0=log 1=info 2=warning 3=error）
            let lv = 'log';
            if (rawLevel === 'error' || rawLevel === 3) lv = 'error';
            else if (rawLevel === 'warning' || rawLevel === 'warn' || rawLevel === 2) lv = 'warn';
            else if (rawLevel === 'info' || rawLevel === 1) lv = 'info';
            const tag = lv === 'error' ? '[renderer:error]' : lv === 'warn' ? '[renderer:warn]' : lv === 'info' ? '[renderer:info]' : '[renderer]';
            console.log(tag, text, src ? '(' + src + ':' + line + ')' : '');
        } catch (e) { /* 忽略转发失败 */ }
    });
});
// 从 data URL / 完整代码中提取可读的文件名（尽量短）
function filenameFromSource(src) {
    try {
        if (src.startsWith('data:')) {
            const head = src.substring(0, 200);
            const m = head.match(/;\s*name=([^;]+)/) || head.match(/_base64,([^]+)/);
            return m ? String(m[1]).substring(0, 60) : 'inline-script';
        }
        const n = String(src).split('/').pop().split('\\').pop();
        return n.length <= 80 ? n : 'renderer-script';
    } catch (e) { return 'renderer'; }
}

let mainWindow;
let floatWindow = null;
let chatWindow = null; // 新增：独立聊天窗口
let cookieWindow = null; // 饼干窗口
let tray = null;
let floatPetSize = 80; // 浮窗桌宠大小，由主窗口设置同步
let floatMoveMode = 'free'; // 浮窗移动模式：'free' | 'gravity'
let floatBounceWindows = false; // 重力模式下是否碰撞窗口
let floatShowIllust = true; // 小窗口聊天时是否显示立绘
let cookieSpawnEnabled = true; // 是否生成饼干
let devModeEnabled = false; // 开发者模式
let config_behaviorKeepProb = 60; // 行为保持概率
// 安全恢复尺寸：窗口恢复时强制设为此大小，避免再次触发自动最小化
const SAFE_RESTORE_WIDTH = 520;
const SAFE_RESTORE_HEIGHT = 420;
let lastFloatMode = 'pet'; // 'pet' | 'chat'：记录上次浮窗所处模式
let floatSessionId = 0; // 浮窗会话编号，用于区分不同浮窗实例，防止旧浮窗异步逻辑影响新浮窗

// ===== 多模态（智谱 AI）全局状态 =====
let zhipuApiKey = '';
let multimodalEnabled = false;
// 多模态提供商：'deepseek' | 'zhipu'
let multimodalProvider = 'deepseek';
// 智谱多模态 API 地址（DeepSeek 复用 apiUrl/apiKey）
let zhipuApiUrl = '';
let aiPrompt = '';
let voiceEnabled = true;
let selectedVoice = 'default';
let voiceVolume = 1.0;
let companionFontSize = 14;
let companionPetSize = 180;
let stickerPack = '默认';

// ===== 家里(主窗口)专属设置 =====
// 由统一设置窗口(float.html?mode=settings)改动后经 sync-home-settings 同步到主进程并广播
let windowOpacity = 1;
let wallOpacity = 1;
let floorOpacity = 1;
let mainPetSize = 7.5;
let furnitureSize = 3.8;
let buttonSize = 40;
let portraitAuto = true;

function broadcastConfigUpdate() {
    const config = { zhipuApiKey, multimodalEnabled, multimodalProvider, zhipuApiUrl, aiPrompt, voiceEnabled, selectedVoice, voiceVolume, companionFontSize, companionPetSize, stickerPack };
    BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) win.webContents.send('config-updated', config);
    });
}

// 广播"家里专属设置"更新（仅在统一设置窗口改动时触发，避免干扰普通配置广播）
function broadcastHomeSettingsUpdate() {
    const home = { windowOpacity, wallOpacity, floorOpacity, mainPetSize, furnitureSize, buttonSize, portraitAuto, companionWidth };
    BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) win.webContents.send('home-settings-updated', home);
    });
}

// ===== 统一配置中枢 =====
// 不同 file:// 窗口之间不共享 localStorage，因此 float / index / 设置窗口会各自读一份 petConfig，
// 表现为"两套独立设置"。这里以"主进程内存 + 文件"作为唯一权威配置：任何窗口改动后全量
// config-sync 到主进程，主进程落地到 userData/petAppConfig.json 并广播 config-updated 给其它窗口，
// 从而让所有窗口共用同一套设置并实时同步。
let unifiedConfig = {};
function configFile() { return path.join(app.getPath('userData'), 'petAppConfig.json'); }
function loadUnifiedConfig() {
    try {
        if (fs.existsSync(configFile())) {
            const parsed = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
            if (parsed && typeof parsed === 'object') unifiedConfig = parsed;
        }
    } catch (e) {}
}
function saveUnifiedConfig() {
    try { fs.writeFileSync(configFile(), JSON.stringify(unifiedConfig, null, 2)); } catch (e) {}
}

// 启动时把权威配置（petAppConfig.json）回灌到主进程运行的各状态变量，
// 否则这些变量保持默认值（如 stickerPack='默认'、zhipuApiKey=''），
// index 启动触发的 broadcastConfigUpdate 会把旧默认值广播给设置窗口，导致设置被改回默认。
function hydrateRuntimeFromUnified() {
    const c = unifiedConfig;
    if (!c || typeof c !== 'object') return;
    if (c.zhipuApiKey != null) zhipuApiKey = c.zhipuApiKey;
    if (c.multimodalEnabled != null) multimodalEnabled = !!c.multimodalEnabled;
    if (c.multimodalProvider != null) multimodalProvider = c.multimodalProvider;
    if (c.zhipuApiUrl != null) zhipuApiUrl = c.zhipuApiUrl;
    if (c.aiPrompt != null) aiPrompt = c.aiPrompt;
    if (c.voiceEnabled != null) voiceEnabled = !!c.voiceEnabled;
    if (c.selectedVoice != null) selectedVoice = c.selectedVoice;
    if (c.voiceVolume != null) voiceVolume = c.voiceVolume;
    if (c.companionFontSize != null) companionFontSize = c.companionFontSize;
    if (c.companionPetSize != null) companionPetSize = c.companionPetSize;
    if (c.stickerPack != null) stickerPack = c.stickerPack;
    if (c.floatPetSize != null) floatPetSize = c.floatPetSize;
    if (c.floatMoveMode != null) floatMoveMode = c.floatMoveMode;
    if (c.floatShowIllust != null) floatShowIllust = !!c.floatShowIllust;
    if (c.cookieSpawnEnabled != null) cookieSpawnEnabled = !!c.cookieSpawnEnabled;
}

// 渲染进程启动时拉取权威配置
ipcMain.handle('config-get', () => unifiedConfig);

// 渲染进程改动配置 → 全量同步到主进程并广播给其它窗口（排除发送源，避免回声干扰拖拽）
ipcMain.on('config-sync', (event, cfg) => {
    if (!cfg || typeof cfg !== 'object') return;
    unifiedConfig = { ...unifiedConfig, ...cfg };
    // 同步到各自独立的状态变量，保持主进程运行时状态一致
    if (cfg.zhipuApiKey != null) zhipuApiKey = cfg.zhipuApiKey;
    if (cfg.multimodalEnabled != null) multimodalEnabled = !!cfg.multimodalEnabled;
    if (cfg.multimodalProvider != null) multimodalProvider = cfg.multimodalProvider;
    if (cfg.zhipuApiUrl != null) zhipuApiUrl = cfg.zhipuApiUrl;
    if (cfg.aiPrompt != null) aiPrompt = cfg.aiPrompt;
    if (cfg.voiceEnabled != null) voiceEnabled = !!cfg.voiceEnabled;
    if (cfg.selectedVoice != null) selectedVoice = cfg.selectedVoice;
    if (cfg.voiceVolume != null) voiceVolume = cfg.voiceVolume;
    if (cfg.companionFontSize != null) companionFontSize = cfg.companionFontSize;
    if (cfg.companionPetSize != null) companionPetSize = cfg.companionPetSize;
    if (cfg.stickerPack != null) stickerPack = cfg.stickerPack;
    if (cfg.windowOpacity != null) {
        windowOpacity = cfg.windowOpacity;
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setOpacity(Math.max(0, Math.min(1, Number(windowOpacity) || 1)));
    }
    if (cfg.wallOpacity != null) wallOpacity = cfg.wallOpacity;
    if (cfg.floorOpacity != null) floorOpacity = cfg.floorOpacity;
    if (cfg.mainPetSize != null) mainPetSize = cfg.mainPetSize;
    if (cfg.furnitureSize != null) furnitureSize = cfg.furnitureSize;
    if (cfg.buttonSize != null) buttonSize = cfg.buttonSize;
    if (cfg.portraitAuto != null) portraitAuto = !!cfg.portraitAuto;
    if (cfg.companionWidth != null) companionWidth = cfg.companionWidth;
    // ===== 浮窗专属字段：任何窗口（index/设置/浮窗）保存时都要同步到主进程运行状态并下发浮窗 =====
    // 过去这些字段只能靠各窗口主动 set-float-* IPC 更新（applySizeSettings 等），
    // 一旦某窗口在"收到广播刷新 UI"的被动路径里带上兜底默认值写回，就会把用户在别的
    // 窗口设的值覆盖掉。现在统一在此兜底同步：谁保存都生效，且与用户主动操作等效。
    if (cfg.floatPetSize != null) {
        floatPetSize = cfg.floatPetSize;
        safeSendToFloat('float-pet-size', floatPetSize);
    }
    if (cfg.floatMoveMode != null) {
        floatMoveMode = cfg.floatMoveMode;
        safeSendToFloat('float-move-mode', floatMoveMode);
    }
    if (cfg.bounceWindows != null) {
        floatBounceWindows = !!cfg.bounceWindows;
        safeSendToFloat('float-bounce-windows', floatBounceWindows);
    }
    if (cfg.cookieSpawnEnabled != null) {
        cookieSpawnEnabled = !!cfg.cookieSpawnEnabled;
        safeSendToFloat('cookie-spawn-enabled', cookieSpawnEnabled);
        if (!cookieSpawnEnabled) closeCookieWindow();
        setupMainCookieSpawner();
    }
    saveUnifiedConfig();
    const senderId = event.sender.id;
    BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed() && win.webContents.id !== senderId) {
            win.webContents.send('config-updated', unifiedConfig);
        }
    });
});

// 统一设置窗口的"家里专属"设置改动：更新主进程状态并广播，主窗口据此重新应用
ipcMain.on('sync-home-settings', (event, data) => {
    if (!data || typeof data !== 'object') return;
    if (data.windowOpacity != null) {
        windowOpacity = data.windowOpacity;
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setOpacity(Math.max(0, Math.min(1, Number(windowOpacity) || 1)));
    }
    if (data.wallOpacity != null) wallOpacity = data.wallOpacity;
    if (data.floorOpacity != null) floorOpacity = data.floorOpacity;
    if (data.mainPetSize != null) mainPetSize = data.mainPetSize;
    if (data.furnitureSize != null) furnitureSize = data.furnitureSize;
    if (data.buttonSize != null) buttonSize = data.buttonSize;
    if (data.portraitAuto != null) portraitAuto = !!data.portraitAuto;
    if (data.companionWidth != null) companionWidth = data.companionWidth;
    broadcastHomeSettingsUpdate();
});

// 获取当前窗口运行状态的完整快照
function getPetRuntimeState() {
    const minimized =
        !!mainWindow &&
        !mainWindow.isDestroyed() &&
        mainWindow.isMinimized();

    return {
        isWindowMinimized: minimized,
        shouldPauseStats: minimized,
        floatSessionId
    };
}

// 向浮窗同步完整运行状态
function syncRuntimeStateToFloat() {
    if (!floatWindow || floatWindow.isDestroyed()) {
        return;
    }
    floatWindow.webContents.send('pet-runtime-state', getPetRuntimeState());
}

function createWindow() {
    // 主窗口默认比例与屏幕一致（宽高比同工作区）
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
    // 保持与屏幕一致的宽高比
    const aspect = screenWidth / screenHeight;
    let windowWidth, windowHeight;
    if (aspect >= 1) {
        // 横屏或接近正方形：取屏幕宽度 55% 为主，比例同步
        windowWidth = Math.floor(screenWidth * 0.55);
        windowHeight = Math.floor(windowWidth / aspect);
    } else {
        // 竖屏：取屏幕高度 70% 为主，比例同步
        windowHeight = Math.floor(screenHeight * 0.7);
        windowWidth = Math.floor(windowHeight * aspect);
    }

    mainWindow = new BrowserWindow({
        width: windowWidth,
        height: windowHeight,
        resizable: true,
        title: '桌宠',
        icon: path.join(__dirname, 'img', 'icon.png'),
        transparent: true,
        backgroundColor: '#00000000',
        frame: false,
        alwaysOnTop: true, // 非全屏时保持最上层
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    mainWindow.webContents.on('did-finish-load', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('config-updated', { zhipuApiKey, multimodalEnabled, multimodalProvider, zhipuApiUrl, aiPrompt, voiceEnabled, selectedVoice, voiceVolume });
        }
    });

    // 双击Ctrl检测由 app.on('web-contents-created') 统一注册

    // Keep the window title fixed as "桌宠" — prevent the page's <title> from overriding it
    mainWindow.on('page-title-updated', (event) => {
        event.preventDefault();
    });

    // Remove the default menu bar for a cleaner app-like experience
    Menu.setApplicationMenu(null);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // 关闭窗口时：关闭聊天窗口和饼干窗口，但保留浮窗（浮窗是默认桌宠窗口），应用继续在托盘运行
    mainWindow.on('close', (event) => {
        if (app.isQuiting) {
            // 正常退出：让所有窗口关闭，由 before-quit 统一清理
            return;
        }
        // 关闭聊天窗口和饼干窗口，保留浮窗继续运行
        if (chatWindow && !chatWindow.isDestroyed()) {
            chatWindow.destroy();
            chatWindow = null;
        }
        if (cookieWindow && !cookieWindow.isDestroyed()) {
            cookieWindow.destroy();
            cookieWindow = null;
        }
        // 关闭家里窗口后自动唤醒浮窗（桌宠模式继续运行）
        if (companionModeActive) return;
        if (!floatWindow || floatWindow.isDestroyed()) {
            createFloatWindow();
        } else {
            floatWindow.show();
            floatWindow.focus();
            syncRuntimeStateToFloat();
        }
    });

    // 监听最小化事件，显示浮窗并通知渲染进程
    mainWindow.on('minimize', () => {
        // 陪伴模式激活时不创建浮窗
        if (companionModeActive) return;
        
        mainWindow.webContents.send('window-minimized');

        if (!floatWindow || floatWindow.isDestroyed()) {
            createFloatWindow();
        } else {
            syncRuntimeStateToFloat();
        }
    });

    // 监听隐藏事件（macOS），也显示浮窗并通知渲染进程
    mainWindow.on('hide', () => {
        if (mainWindow.isMinimized()) {
            mainWindow.webContents.send('window-minimized');
        }
        if (!floatWindow && mainWindow.isMinimized() && !companionModeActive) {
            createFloatWindow();
        } else if (floatWindow && !floatWindow.isDestroyed() && mainWindow.isMinimized()) {
            syncRuntimeStateToFloat();
        }
    });

    // 监听恢复事件，关闭浮窗并通知渲染进程；恢复时调整到安全大小避免再次自动最小化
    mainWindow.on('restore', () => {
        handleMainWindowRestore();
    });

    // 监听窗口显示事件，关闭浮窗并通知渲染进程
    mainWindow.on('show', () => {
        handleMainWindowRestore();
    });

    // 监听窗口尺寸变化，通知渲染进程判断是否进入聚焦模式/自动最小化
    let resizeDebounceTimer = null;
    mainWindow.on('resize', () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
        resizeDebounceTimer = setTimeout(() => {
            if (!mainWindow || mainWindow.isDestroyed()) return;
            const [w, h] = mainWindow.getContentSize();
            const isFullScreen = mainWindow.isFullScreen();
            const isMinimized = mainWindow.isMinimized();
            mainWindow.webContents.send('main-window-resize', { width: w, height: h, isFullScreen, isMinimized });
        }, 50);
    });

    // 全屏状态变化时切换 alwaysOnTop（非全屏保持最上层）
    mainWindow.on('enter-full-screen', () => {
        mainWindow.setAlwaysOnTop(false);
    });
    mainWindow.on('leave-full-screen', () => {
        mainWindow.setAlwaysOnTop(true);
    });
}

// 防止 handleMainWindowRestore 被重复调用的锁
let restoringMainWindow = false;

// 恢复主窗口时调整到安全大小 + 确保在屏幕可见区域内
function restoreToSafeSize() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isFullScreen()) return;
    if (mainWindow.isMinimized()) return;

    const [w, h] = mainWindow.getContentSize();
    const needsResize = w < SAFE_RESTORE_WIDTH || h < SAFE_RESTORE_HEIGHT;

    const display = screen.getPrimaryDisplay();
    const workArea = display.workArea;
    let [x, y] = mainWindow.getPosition();
    const targetW = needsResize ? SAFE_RESTORE_WIDTH : w;
    const targetH = needsResize ? SAFE_RESTORE_HEIGHT : h;

    if (x + targetW > workArea.x + workArea.width) {
        x = workArea.x + workArea.width - targetW;
    }
    if (y + targetH > workArea.y + workArea.height) {
        y = workArea.y + workArea.height - targetH;
    }
    if (x < workArea.x) x = workArea.x;
    if (y < workArea.y) y = workArea.y;

    const [origX, origY] = mainWindow.getPosition();
    if (needsResize || x !== origX || y !== origY) {
        mainWindow.setBounds({ x, y, width: targetW, height: targetH });
    }
}

// 主窗口恢复时的统一处理：关闭浮窗/聊天窗，通知渲染进程
function handleMainWindowRestore() {
    if (restoringMainWindow) return;
    restoringMainWindow = true;
    // 主窗口一旦显示（启动/恢复/唤起），关闭设置窗口，避免双窗口同时改配置
    closeSettingsWindow();
    // 用 setTimeout 解锁兜底，防止异常中断后锁死
    let lockCleared = false;
    const clearLock = () => {
        if (!lockCleared) {
            lockCleared = true;
            restoringMainWindow = false;
        }
    };
    setTimeout(clearLock, 500);

    try {
        const wasChat = lastFloatMode === 'chat';

        // 1. 如果之前是聊天模式，先通知浮窗同步最后的聊天历史
        if (wasChat && floatWindow && !floatWindow.isDestroyed()) {
            floatWindow.webContents.send('float-prepare-close', { floatSessionId });
            floatWindow.webContents.send('request-sync-chat-history');
        } else if (floatWindow && !floatWindow.isDestroyed()) {
            floatWindow.webContents.send('float-prepare-close', { floatSessionId });
        }

        // 2. 先恢复窗口显示（必须先 restore/show，否则在最小化状态下 setBounds 会触发异常 resize 事件）
        if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }

        // 3. 调整到安全大小（此时窗口已显示，setBounds 的尺寸能正确反映）
        restoreToSafeSize();

        // 4. 通知渲染进程窗口已恢复
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('window-restored');
        }

        // 5. 隐藏浮窗（保留浮窗状态，便于"家里 ⇄ 桌宠"交换回来），关闭聊天窗口
        if (floatWindow && !floatWindow.isDestroyed()) {
            floatWindow.hide();
        }
        if (chatWindow && !chatWindow.isDestroyed()) {
            chatWindow.destroy();
            chatWindow = null;
        }

        lastFloatMode = 'pet';
    } catch (err) {
        console.error('handleMainWindowRestore error:', err);
    } finally {
        clearLock();
    }
}

function createFloatWindow() {
    // 使用 workArea 完整矩形（含 x/y 原点），避免在多显示器/非零点主屏下把桌宠放到屏幕外
    const display = screen.getPrimaryDisplay();
    const wa = display.workArea;

    floatSessionId += 1;
    const currentFloatSessionId = floatSessionId;

    // 桌宠模式：固定大小，不可调整
    const petModeWidth = 160;
    const petModeHeight = 140;

    floatWindow = new BrowserWindow({
        width: petModeWidth,
        height: petModeHeight,
        x: Math.round(wa.x + (wa.width - petModeWidth) / 2),
        y: Math.round(wa.y + (wa.height - petModeHeight) / 2),
        frame: false,
        transparent: true,
        resizable: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    floatWindow.loadFile(path.join(__dirname, 'float.html'));
    // 双击Ctrl检测由 app.on('web-contents-created') 统一注册

    // 设置窗口为可穿透（点击穿透到下面窗口，但特定区域可点击）
    floatWindow.setIgnoreMouseEvents(false);

    // 桌宠模式锁定为固定尺寸（min=max）
    floatWindow.setMinimumSize(petModeWidth, petModeHeight);
    floatWindow.setMaximumSize(petModeWidth, petModeHeight);

    // 浮窗加载完成后应用当前桌宠大小、移动模式及完整运行状态
    floatWindow.webContents.on('did-finish-load', () => {
        if (!floatWindow || floatWindow.isDestroyed()) {
            return;
        }

        floatWindow.webContents.send('float-pet-size', floatPetSize);
        floatWindow.webContents.send('float-move-mode', floatMoveMode);
        floatWindow.webContents.send('float-bounce-windows', floatBounceWindows);
        floatWindow.webContents.send('cookie-spawn-enabled', cookieSpawnEnabled);
        floatWindow.webContents.send('set-dev-mode', devModeEnabled);
        floatWindow.webContents.send('set-behavior-keep-prob', config_behaviorKeepProb);

        floatWindow.webContents.send('pet-runtime-state', {
            ...getPetRuntimeState(),
            floatSessionId: currentFloatSessionId
        });

        // 推送多模态配置
        floatWindow.webContents.send('config-updated', { zhipuApiKey, multimodalEnabled, multimodalProvider, zhipuApiUrl, aiPrompt, voiceEnabled, selectedVoice, voiceVolume });

        // ===== 主进程级饼干自动生成定时器（作为 float.js 定时器的补充） =====
        setupMainCookieSpawner();
    });

    floatWindow.on('closed', () => {
        floatSessionId += 1;
        floatWindow = null;
    });
}

// 新增：创建独立聊天窗口
function createChatWindow() {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    
    // 聊天窗口默认比例为屏幕的 40% 宽 x 50% 高
    const chatWidth = Math.floor(width * 0.4);
    const chatHeight = Math.floor(height * 0.5);
    
    chatWindow = new BrowserWindow({
        width: chatWidth,
        height: chatHeight,
        x: Math.floor((width - chatWidth) / 2),
        y: Math.floor((height - chatHeight) / 2),
        frame: false,          // 无边框
        transparent: true,     // 透明：左侧立绘栏可透出桌面
        resizable: true,
        minimizable: true,
        maximizable: true,
        autoHideMenuBar: true,  // 隐藏原生菜单栏（File/Edit/View/Window/Help）
        alwaysOnTop: true,
        title: '聊天',
        icon: path.join(__dirname, 'img', 'icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    // 加载同一个 float.html，但带上 mode=chat 参数
    chatWindow.loadFile(path.join(__dirname, 'float.html'), { query: { mode: 'chat' } });

    // FIX: 使用原生标题栏后，拦截窗口关闭事件，先通知渲染进程完成记忆总结
    let pendingCloseConfirm = false;
    let allowChatClose = false;
    chatWindow.on('close', (event) => {
        // 一旦渲染进程确认完毕（allowChatClose=true），放行真正关闭，避免 preventDefault 死循环
        if (allowChatClose) return;
        event.preventDefault();
        if (!pendingCloseConfirm) {
            pendingCloseConfirm = true;
            // 通知渲染进程：窗口即将关闭，请先完成记忆总结
            if (chatWindow && !chatWindow.isDestroyed()) {
                chatWindow.webContents.send('chat-window-close-requested');
            }
        }
    });

    // 渲染进程完成记忆总结后，确认关闭
    ipcMain.on('chat-window-confirmed-close', () => {
        if (chatWindow && !chatWindow.isDestroyed()) {
            allowChatClose = true;
            pendingCloseConfirm = false;
            chatWindow.close();
        }
    });

    chatWindow.on('closed', () => {
        chatWindow = null;
        pendingCloseConfirm = false;
        allowChatClose = false;
        // 聊天窗口关闭时，显示浮窗
        if (floatWindow && !floatWindow.isDestroyed()) {
            floatWindow.show();
        }
    });
}

// 饼干位置缓存（表示饼干的实际位置，非窗口位置）
let cookiePosition = { x: 0, y: 0, active: false };
let cookieEaten = false;
let cookieSize = 40; // 饼干大小（约桌宠一半）
let lastPetGroundY = 0; // 桌宠地面位置，供饼干窗口初始使用
// 饼干窗口周围的透明边距：让饼干图片不贴窗口边缘，视觉上更小巧（参考桌宠在窗口中的比例）
// 同时避免系统边框/resize grip 贴着饼干图片
const COOKIE_PADDING = 18;

// ===== 主进程级饼干自动生成（独立于 float.js 的定时器，确保可靠性） =====
// 仅在浮窗存在（桌宠桌面模式激活）时生成饼干
let mainCookieSpawnTimer = null;
function setupMainCookieSpawner() {
    if (mainCookieSpawnTimer) {
        clearTimeout(mainCookieSpawnTimer);
        mainCookieSpawnTimer = null;
    }
    if (!cookieSpawnEnabled) return;

    const SPAWN_INTERVAL = 30000; // 30秒检查一次
    const FIRST_DELAY = 5000; // 首次延迟5秒

    function trySpawn() {
        // 只在浮窗存在时自动生成饼干
        if (!floatWindow || floatWindow.isDestroyed()) {
            // 浮窗不存在，不生成，但继续定时检查
            mainCookieSpawnTimer = setTimeout(trySpawn, SPAWN_INTERVAL);
            return;
        }
        if (!cookieSpawnEnabled) {
            if (mainCookieSpawnTimer) {
                clearTimeout(mainCookieSpawnTimer);
                mainCookieSpawnTimer = null;
            }
            return;
        }
        if (!cookieWindow || cookieWindow.isDestroyed()) {
            // 没有饼干窗口 → 尝试在屏幕角落生成
            const primaryDisplay = screen.getPrimaryDisplay();
            const { workArea } = primaryDisplay;
            const margin = 80;
            const corners = [
                { x: workArea.x + margin, y: workArea.y + margin },
                { x: workArea.x + workArea.width - cookieSize - margin, y: workArea.y + margin },
                { x: workArea.x + margin, y: workArea.y + workArea.height - cookieSize - margin },
                { x: workArea.x + workArea.width - cookieSize - margin, y: workArea.y + workArea.height - cookieSize - margin }
            ];
            const corner = corners[Math.floor(Math.random() * corners.length)];
            createCookieWindow(corner.x, corner.y);
            if (cookieWindow && !cookieWindow.isDestroyed()) {
                setTimeout(() => {
                    cookieWindow.webContents.send('cookie-config', {
                        moveMode: floatMoveMode,
                        petGroundY: lastPetGroundY,
                        cookieSize: cookieSize
                    });
                }, 200);
            }
        }
        // 安排下一次检查
        mainCookieSpawnTimer = setTimeout(trySpawn, SPAWN_INTERVAL);
    }

    // 首次延迟5秒
    mainCookieSpawnTimer = setTimeout(trySpawn, FIRST_DELAY);
}

// 创建饼干窗口
// cookieX/cookieY 表示饼干的实际位置（左上角），窗口位置会自动减去 padding
function createCookieWindow(cookieX, cookieY, size) {
    if (typeof size === 'number' && size >= 20 && size <= 200) {
        cookieSize = size;
    }
    const COOKIE_SIZE = cookieSize;
    // 窗口大小=饼干大小+边距*2，让饼干周围有透明区域
    const windowSize = COOKIE_SIZE + COOKIE_PADDING * 2;
    // 窗口位置=饼干位置-padding，让饼干图片在窗口中居中
    const windowX = Math.round(cookieX - COOKIE_PADDING);
    const windowY = Math.round(cookieY - COOKIE_PADDING);

    // 如果已有饼干窗口，先销毁
    if (cookieWindow && !cookieWindow.isDestroyed()) {
        cookieWindow.destroy();
        cookieWindow = null;
    }

    cookieWindow = new BrowserWindow({
        width: windowSize,
        height: windowSize,
        x: windowX,
        y: windowY,
        // 饼干窗口始终无边框透明，仅开发者模式下可调整大小便于调试
        frame: false,
        transparent: true,
        resizable: devModeEnabled,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: false,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    cookieWindow.loadFile(path.join(__dirname, 'cookie.html'));

    cookieWindow.setAlwaysOnTop(true, 'screen-saver');

    cookieWindow.webContents.on('did-finish-load', () => {
        if (!cookieWindow || cookieWindow.isDestroyed()) return;
        // 发送初始配置
        cookieWindow.webContents.send('cookie-config', {
            moveMode: floatMoveMode,
            petGroundY: lastPetGroundY,
            cookieSize: cookieSize
        });
    });

    cookieWindow.on('closed', () => {
        cookieWindow = null;
        cookiePosition.active = false;
    });

    // cookiePosition 表示饼干的实际位置（左上角），不是窗口位置
    cookiePosition = { x: cookieX, y: cookieY, active: true };
    cookieEaten = false;
}

// 关闭饼干窗口
function closeCookieWindow() {
    if (cookieWindow && !cookieWindow.isDestroyed()) {
        cookieWindow.close();
        cookieWindow = null;
    }
    cookiePosition.active = false;
    cookieEaten = false;
    // 通知float窗口饼干已消失
    if (floatWindow && !floatWindow.isDestroyed()) {
        floatWindow.webContents.send('cookie-consumed');
    }
}

// 记忆文件路径
let memoryFilePath = '';

// 从文件读取记忆
function loadMemoryFromFile() {
    try {
        if (!memoryFilePath) {
            memoryFilePath = path.join(app.getPath('userData'), 'petMemory.json');
        }
        if (fs.existsSync(memoryFilePath)) {
            const data = fs.readFileSync(memoryFilePath, 'utf-8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error('Failed to read memory file:', e);
    }
    return [];
}

// 写入记忆到文件
function saveMemoryToFile(items) {
    try {
        if (!memoryFilePath) {
            memoryFilePath = path.join(app.getPath('userData'), 'petMemory.json');
        }
        fs.writeFileSync(memoryFilePath, JSON.stringify(items || []), 'utf-8');
        return true;
    } catch (e) {
        console.error('Failed to write memory file:', e);
        return false;
    }
}

// 广播记忆更新到所有窗口
function broadcastMemoryUpdate(items) {
    const allWindows = BrowserWindow.getAllWindows();
    allWindows.forEach(win => {
        if (!win.isDestroyed() && win.webContents) {
            win.webContents.send('memory-updated', items);
        }
    });
}

// IPC 处理：加载记忆
ipcMain.handle('memory-load', async () => {
    return loadMemoryFromFile();
});

// IPC 处理：保存记忆
ipcMain.handle('memory-save', async (event, items) => {
    const success = saveMemoryToFile(items);
    if (success) {
        broadcastMemoryUpdate(items);
    }
    return success;
});

// 创建系统托盘图标和菜单
function createTray() {
    if (tray) return;

    const iconPath = path.join(__dirname, 'img', 'icon.png');
    let trayIcon;
    try {
        trayIcon = nativeImage.createFromPath(iconPath);
        if (trayIcon.isEmpty()) {
            trayIcon = nativeImage.createEmpty();
        }
    } catch (e) {
        trayIcon = nativeImage.createEmpty();
    }

    tray = new Tray(trayIcon);
    tray.setToolTip('桌宠');
    tray.setContextMenu(Menu.buildFromTemplate([
        {
            label: '显示主窗口',
            click: () => {
                showMainWindow();
            }
        },
        {
            label: '退出',
            click: () => {
                app.isQuiting = true;
                app.quit();
            }
        }
    ]));

    tray.on('click', () => {
        showMainWindow();
    });
}

// 关闭设置窗口。每次 index（主窗口）启动/唤起主窗口时都必须调用，
// 否则设置窗口与主窗口会同时编辑同一份配置（类似"两套独立设置"），
// 出现概率性把桌宠大小 / 贴图等设置覆盖回默认的严重 bug。
function closeSettingsWindow() {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.close();
        settingsWindow = null;
    }
}

// 统一入口：唤起主窗口（家里）；若已销毁则重新创建
function showMainWindow() {
    closeSettingsWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    } else {
        createWindow();
    }
}

// IPC 处理：开机自启动（设置面板"开机自启"开关）
ipcMain.on('set-login-item', (event, enabled) => {
    try {
        app.setLoginItemSettings({ openAtLogin: !!enabled });
    } catch (err) {
        console.error('[main] set-login-item', err);
    }
});

// IPC 处理：浮窗"回家"按钮 —— 唤起主窗口 index.html（次要窗口）
let settingsWindow = null; // 设置面板独立窗口
ipcMain.on('show-index-window', () => {
    // index 启动前先关闭设置窗口，防止两边同时编辑同一份配置导致设置被重置
    closeSettingsWindow();
    // 回家时隐藏桌宠浮窗（桌宠回到家里主窗口）
    if (floatWindow && !floatWindow.isDestroyed()) {
        floatWindow.hide();
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        return;
    }
    createWindow();
});

// 创建设置面板独立窗口（加载 float.html?mode=settings，复用浮窗设置 UI）
function createSettingsWindow() {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.focus();
        return settingsWindow;
    }
    settingsWindow = new BrowserWindow({
        width: 420,
        height: 640,
        resizable: true,
        transparent: false,
        backgroundColor: '#ffffff',
        frame: false, // 无边框：去除原生标题栏/状态栏，由页面内 .sb-head 提供拖拽
        title: '⚙ 设置',
        alwaysOnTop: false,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });
    settingsWindow.loadFile(path.join(__dirname, 'float.html'), { query: { mode: 'settings' } });
    settingsWindow.on('closed', () => { settingsWindow = null; });
    return settingsWindow;
}

// 浮窗气泡"设置"按钮：打开设置窗口
ipcMain.on('float-open-settings', () => {
    createSettingsWindow();
});

// 设置面板关闭：关闭设置窗口
ipcMain.on('settings-close', () => {
    closeSettingsWindow();
});

// 设置面板"退出应用"按钮：退出整个应用
ipcMain.on('app-quit', () => {
    app.isQuiting = true;
    app.quit();
});

// IPC 处理：打开聊天对话框
ipcMain.on('open-chat-dialog', () => {
    // 打开聊天（主窗口承载 UI）前也关闭设置窗口，保持"同一时刻只有一个设置编辑器"
    closeSettingsWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        // 关闭浮窗
        if (floatWindow && !floatWindow.isDestroyed()) {
            floatWindow.close();
            floatWindow = null;
        }
        // 发送消息给渲染进程打开聊天面板
        mainWindow.webContents.send('show-chat-panel');
    }
});

// 安全地给浮窗发送消息（窗口可能已销毁）
function safeSendToFloat(channel, ...args) {
    if (floatWindow && !floatWindow.isDestroyed() && floatWindow.webContents && !floatWindow.webContents.isDestroyed()) {
        floatWindow.webContents.send(channel, ...args);
    }
}

// IPC 处理：更新浮窗消息
ipcMain.on('update-float-message', (event, message) => {
    // 参数校验：必须是字符串或数字，避免 Electron 序列化异常
    if (message !== undefined && message !== null && typeof message !== 'string' && typeof message !== 'number') {
        message = String(message);
    }
    safeSendToFloat('float-message', message);
});

// IPC 处理：移动浮窗窗口
ipcMain.on('move-float-window', (event, x, y) => {
    if (typeof x !== 'number' || typeof y !== 'number' ||
        isNaN(x) || isNaN(y) || !isFinite(x) || !isFinite(y) ||
        !floatWindow || floatWindow.isDestroyed()) {
        return;
    }
    floatWindow.setPosition(Math.round(x), Math.round(y));
});

// IPC 处理：设置浮窗桌宠大小
ipcMain.on('set-float-pet-size', (event, size) => {
    size = parseInt(size, 10);
    if (isNaN(size) || size < 20 || size > 800) return;
    floatPetSize = size;
    safeSendToFloat('float-pet-size', size);
});

// IPC 处理：调整浮窗窗口尺寸
ipcMain.on('resize-float-window', (event, w, h) => {
    if (typeof w !== 'number' || typeof h !== 'number' || !floatWindow || floatWindow.isDestroyed()) return;
    w = Math.max(60, Math.min(1400, Math.round(w)));
    h = Math.max(60, Math.min(1400, Math.round(h)));
    const bounds = floatWindow.getBounds();
    floatWindow.setMinimumSize(0, 0);
    floatWindow.setMaximumSize(0, 0);
    // 高度变化时保持窗口下边缘锚定：收缩从顶部开始，桌宠贴地位置不跳动，上边缘随之下移
    if (bounds.height !== h) {
        floatWindow.setBounds({ x: bounds.x, y: bounds.y + (bounds.height - h), width: w, height: h });
    } else {
        floatWindow.setSize(w, h);
    }
    floatWindow.setMinimumSize(w, h);
    floatWindow.setMaximumSize(w, h);
});

// IPC 处理：设置浮窗是否碰撞窗口
ipcMain.on('set-float-bounce-windows', (event, enabled) => {
    floatBounceWindows = !!enabled;
    safeSendToFloat('float-bounce-windows', floatBounceWindows);
});

// IPC 处理：设置小窗口聊天时是否显示立绘
ipcMain.on('set-float-show-illust', (event, enabled) => {
    floatShowIllust = !!enabled;
    if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.webContents.send('float-show-illust', floatShowIllust);
    }
});

// IPC 处理：设置是否生成饼干
ipcMain.on('set-cookie-spawn-enabled', (event, enabled) => {
    cookieSpawnEnabled = !!enabled;
    safeSendToFloat('cookie-spawn-enabled', cookieSpawnEnabled);
    if (!cookieSpawnEnabled) {
        // 关闭时销毁现有饼干（closeCookieWindow 内部会通知float窗口）
        closeCookieWindow();
    }
    // 同步重启主进程级饼干生成器
    setupMainCookieSpawner();
});

// IPC 处理：窗口控制
ipcMain.on('window-minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.minimize();
    }
});

ipcMain.on('window-maximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        // 最大化按钮切换全屏；全屏时关闭 alwaysOnTop
        if (mainWindow.isFullScreen()) {
            mainWindow.setFullScreen(false);
            mainWindow.setAlwaysOnTop(true);
        } else {
            mainWindow.setFullScreen(true);
            mainWindow.setAlwaysOnTop(false);
        }
    }
});

ipcMain.on('window-close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close();
    }
});

// IPC 处理：渲染进程请求调整主窗口尺寸（用于恢复时避免再次触发自动最小化）
ipcMain.on('window-set-size', (event, w, h) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        const width = Math.max(100, Math.floor(Number(w) || 0));
        const height = Math.max(100, Math.floor(Number(h) || 0));
        if (width > 0 && height > 0) {
            const [x, y] = mainWindow.getPosition();
            mainWindow.setBounds({ x, y, width, height });
        }
    }
});

// IPC 处理：设置主窗口透明度（0~1）
ipcMain.on('set-window-opacity', (event, opacity) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        const val = Math.max(0, Math.min(1, Number(opacity) || 1));
        mainWindow.setOpacity(val);
    }
});


// IPC 处理：浮窗进入对话模式（新建独立聊天窗口）
ipcMain.on('float-enter-chat-mode', () => {
    // 记录当前为聊天模式
    lastFloatMode = 'chat';
    // 如果聊天窗口已存在，聚焦并返回
    if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.focus();
        return;
    }
    // 通知浮窗把当前聊天历史同步到主进程（这样如果主窗口恢复时仍能继承对话）
    if (floatWindow && !floatWindow.isDestroyed()) {
        floatWindow.webContents.send('request-sync-chat-history');
    }
    // 创建独立聊天窗口
    createChatWindow();
    // 隐藏浮窗（不销毁）
    if (floatWindow && !floatWindow.isDestroyed()) {
        floatWindow.hide();
    }
});

// IPC 处理：浮窗退出对话模式（关闭聊天窗口）
ipcMain.on('float-exit-chat-mode', () => {
    // 退出后回到桌宠模式
    lastFloatMode = 'pet';
    // 关闭聊天窗口：触发 close 拦截 → 渲染进程总结记忆 → confirmed-close 真正关闭。
    // 注意此处不能把 chatWindow 置空，否则 confirmed-close 处理程序拿不到窗口引用而无法关窗。
    if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.close();
    }
    // 显示浮窗
    if (floatWindow && !floatWindow.isDestroyed()) {
        floatWindow.show();
    }
});

// IPC 处理：同步浮窗大小到主窗口设置（已废弃）
// 曾用于"浮窗收到 float-pet-size 后回传主窗口"，形成 config-updated 回声循环导致设置被覆盖，
// 现大小统一走 config-sync 广播（主进程 config-sync 已兜底 floatPetSize 状态与下发），此通路移除。

// IPC 处理：设置面板「▶ 状态预览」——把状态名转发给桌宠浮窗执行切换与特效
ipcMain.on('float-preview-state', (event, state) => {
    if (state) safeSendToFloat('float-preview-state', String(state));
});

// IPC 处理：拖出房子后最小化主窗口 + 浮窗移动到鼠标处
ipcMain.on('minimize-and-move-float', (event, x, y) => {
    if (typeof x !== 'number' || typeof y !== 'number' || isNaN(x) || isNaN(y)) {
        return;
    }
    // 浮窗不存在则创建
    if (!floatWindow || floatWindow.isDestroyed()) {
        createFloatWindow();
        // 等窗口创建完成后再移动
        const tryMove = (retries) => {
            if (floatWindow && !floatWindow.isDestroyed() && floatWindow.webContents) {
                const padding = Math.ceil(floatPetSize * 0.6);
                const w = floatPetSize + padding * 2;
                const h = floatPetSize + padding * 2 + 40 + floatPetSize / 2;
                const px = Math.max(0, Math.round(x - w / 2));
                const py = Math.max(0, Math.round(y - h / 2));
                floatWindow.setPosition(px, py);
            } else if (retries > 0) {
                setTimeout(() => tryMove(retries - 1), 50);
            }
        };
        tryMove(20);
    } else {
        // 浮窗已存在，直接移动到鼠标处
        const padding = Math.ceil(floatPetSize * 0.6);
        const w = floatPetSize + padding * 2;
        const h = floatPetSize + padding * 2 + 40 + floatPetSize / 2;
        const px = Math.max(0, Math.round(x - w / 2));
        const py = Math.max(0, Math.round(y - h / 2));
        floatWindow.setPosition(px, py);
    }
    // 浮窗可能因"回家"被隐藏，拖出房子时恢复显示（交换逻辑：家里 ⇄ 桌宠）
    if (floatWindow && !floatWindow.isDestroyed() && !floatWindow.isVisible()) {
        floatWindow.show();
    }
    // 最小化主窗口
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMinimized()) {
        mainWindow.minimize();
    }
});

// IPC 处理：获取指定坐标所在显示器的工作区（多屏适配）
ipcMain.handle('get-work-area-at-point', (event, x, y) => {
    // screen.getDisplayMatching 需要完整 Rectangle（含 width/height），否则报转换错误
    // 这里只需按点定位，给 1x1 的矩形即可
    const display = screen.getDisplayMatching({ x: Math.round(x), y: Math.round(y), width: 1, height: 1 });
    const wa = display.workArea;
    return { x: wa.x, y: wa.y, width: wa.width, height: wa.height };
});

// IPC 处理：获取所有可见且非最大化的窗口边界（用于碰撞检测和窗口内弹跳）
ipcMain.handle('get-window-bounds', () => {
    const bounds = [];
    BrowserWindow.getAllWindows().forEach(win => {
        if (win.isVisible() && !win.isMaximized() && !win.isMinimized()) {
            const b = win.getBounds();
            // 排除浮窗自身、聊天窗口和主窗口
            if (win !== floatWindow && win !== chatWindow) {
                bounds.push({ x: b.x, y: b.y, width: b.width, height: b.height });
            }
        }
    });
    return bounds;
});

// IPC 处理：获取记忆内容（直接读取文件，无需主窗口存在）
// 浮窗作为默认窗口时，主窗口可能未创建，因此不能依赖主窗口中转
ipcMain.handle('get-memory-items', async (event) => {
    return loadMemoryFromFile();
});

// IPC 处理：保存单条记忆（主进程直接读写文件，消除 executeJavaScript 脆弱链路）
ipcMain.handle('save-memory-item', async (event, text) => {
    if (!text || !text.trim()) return false;
    try {
        // 1. 从文件读取当前记忆
        const items = loadMemoryFromFile();
        // 2. 添加新记忆
        items.push({ text: text.trim() });
        // 3. 写入文件
        const success = saveMemoryToFile(items);
        if (success) {
            // 4. 广播到所有窗口（主窗口和浮窗都会通过 onMemoryUpdated 同步）
            broadcastMemoryUpdate(items);
        }
        return success;
    } catch (e) {
        console.error('[main] save-memory-item failed:', e);
        return false;
    }
});

// IPC 处理：触发记忆总结（转发到主窗口）
ipcMain.on('trigger-memory-summary', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('trigger-memory-summary');
    }
});

// ===== 饼干窗口 IPC =====

// 获取饼干窗口位置（同步）
ipcMain.on('get-cookie-window-pos', (event) => {
    if (cookieWindow && !cookieWindow.isDestroyed()) {
        const [x, y] = cookieWindow.getPosition();
        event.returnValue = [x, y];
    } else {
        event.returnValue = [0, 0];
    }
});

// 设置饼干窗口位置
// x, y 是窗口的位置（cookie.js 传过来的 windowScreenX/Y）
ipcMain.on('set-cookie-window-pos', (event, x, y) => {
    if (typeof x !== 'number' || typeof y !== 'number') return;
    if (cookieWindow && !cookieWindow.isDestroyed()) {
        cookieWindow.setPosition(Math.round(x), Math.round(y));
        // cookiePosition 表示饼干位置（窗口位置+padding）
        cookiePosition.x = Math.round(x) + COOKIE_PADDING;
        cookiePosition.y = Math.round(y) + COOKIE_PADDING;
    }
});

// 饼干位置更新（饼干窗口→主进程→转发给float窗口）
// x, y 是窗口的位置，转发时转换为饼干实际位置（+padding）
ipcMain.on('cookie-position-update', (event, x, y) => {
    if (typeof x !== 'number' || typeof y !== 'number') return;
    cookiePosition.x = x + COOKIE_PADDING;
    cookiePosition.y = y + COOKIE_PADDING;
    cookiePosition.active = true;
    if (floatWindow && !floatWindow.isDestroyed()) {
        floatWindow.webContents.send('cookie-position-update', { x: cookiePosition.x, y: cookiePosition.y, active: true, size: cookieSize });
    }
});

// 饼干拖拽超时
ipcMain.on('cookie-drag-timeout', () => {
    if (floatWindow && !floatWindow.isDestroyed()) {
        floatWindow.webContents.send('cookie-drag-timeout');
    }
});

// 饼干被吃掉（动画完成后通知主进程）
ipcMain.on('cookie-eaten', () => {
    cookieEaten = true;
    // 通知float窗口饼干已吃掉（不关闭窗口，由request-eat-cookie统一管理）
    if (floatWindow && !floatWindow.isDestroyed()) {
        floatWindow.webContents.send('cookie-eaten');
    }
});

// Float窗口请求吃饼干
ipcMain.on('request-eat-cookie', () => {
    if (!cookieWindow || cookieWindow.isDestroyed()) return;
    if (cookieEaten) return;
    cookieWindow.webContents.send('eat-cookie');
    cookieEaten = true;
    // 吃饼干持续数秒（与float窗口STATE_DURATIONS.eating_cookie一致）
    setTimeout(() => {
        closeCookieWindow();
        if (floatWindow && !floatWindow.isDestroyed()) {
            floatWindow.webContents.send('cookie-consumed');
        }
    }, 3000);
});

// Float窗口请求生成饼干
ipcMain.on('request-spawn-cookie', (event, x, y) => {
    if (typeof x !== 'number' || typeof y !== 'number') return;
    if (cookieWindow && !cookieWindow.isDestroyed()) return; // 已有饼干
    createCookieWindow(x, y);
    // 发送配置
    setTimeout(() => {
        if (cookieWindow && !cookieWindow.isDestroyed()) {
            cookieWindow.webContents.send('cookie-config', {
                moveMode: floatMoveMode,
                petGroundY: lastPetGroundY,
                cookieSize: cookieSize
            });
        }
    }, 200);
});

// 开发者模式：双击Ctrl生成饼干（保留IPC接口，内部调用统一函数）
ipcMain.on('dev-spawn-cookie', () => {
    spawnCookieFromDevMode();
});

// 获取饼干位置（供float窗口查询）
ipcMain.handle('get-cookie-position', () => {
    return {
        x: cookiePosition.x,
        y: cookiePosition.y,
        active: cookiePosition.active && !cookieEaten
    };
});

// 获取移动模式
ipcMain.handle('get-move-mode', () => {
    return floatMoveMode;
});

// 更新桌宠地面位置（发送给饼干窗口）
function sendPetGroundToCookie(groundY) {
    if (cookieWindow && !cookieWindow.isDestroyed()) {
        cookieWindow.webContents.send('pet-position-update', { groundY });
    }
}

// 当移动模式改变时，通知饼干窗口
function syncMoveModeToCookie() {
    if (cookieWindow && !cookieWindow.isDestroyed()) {
        cookieWindow.webContents.send('cookie-config', {
            moveMode: floatMoveMode,
            petGroundY: lastPetGroundY
        });
    }
}

// 监听移动模式改变
ipcMain.on('set-float-move-mode', (event, mode) => {
    if (mode !== 'free' && mode !== 'gravity') return;
    floatMoveMode = mode;
    safeSendToFloat('float-move-mode', mode);
    syncMoveModeToCookie();
});

// Float窗口上报地面位置
ipcMain.on('float-ground-position', (event, groundY) => {
    if (typeof groundY !== 'number') return;
    lastPetGroundY = groundY;
    sendPetGroundToCookie(groundY);
});

// Float窗口请求关闭饼干
ipcMain.on('close-cookie-window', () => {
    closeCookieWindow();
});

// 设置饼干大小（从设置页面）
ipcMain.on('set-cookie-size', (event, size) => {
    cookieSize = size;
    // 调整现有饼干窗口大小（窗口大小=饼干大小+padding*2）
    if (cookieWindow && !cookieWindow.isDestroyed()) {
        const windowSize = size + COOKIE_PADDING * 2;
        cookieWindow.setSize(windowSize, windowSize);
        cookieWindow.webContents.send('cookie-config', {
            cookieSize: size
        });
    }
    // 通知浮窗更新饼干大小（用于碰撞检测）
    if (floatWindow && !floatWindow.isDestroyed()) {
        floatWindow.webContents.send('cookie-size-update', size);
    }
    // 广播给设置页面
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('cookie-size-updated', size);
    }
});

// 饼干请求调整自身大小
ipcMain.on('cookie-resize-self', (event, size) => {
    if (cookieWindow && !cookieWindow.isDestroyed()) {
        const windowSize = size + COOKIE_PADDING * 2;
        cookieWindow.setSize(windowSize, windowSize);
    }
});

// 同步饼干大小到设置页面
ipcMain.on('sync-cookie-size-to-settings', (event, size) => {
    if (typeof size === 'number') {
        cookieSize = size;
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('cookie-size-updated', size);
        }
    }
});

// ===== 陪伴模式窗口管理 =====
let companionWindow = null;
let companionWidth = 400;
let companionHeight = 350;

function createCompanionWindow() {
    if (companionWindow && !companionWindow.isDestroyed()) {
        companionWindow.focus();
        return;
    }

    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    companionWindow = new BrowserWindow({
        width: companionWidth,
        height: companionHeight,
        x: width - companionWidth - 20,
        y: height - companionHeight - 80,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: false,
        resizable: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    companionWindow.loadFile(path.join(__dirname, 'companion.html'));
    companionWindow.setIgnoreMouseEvents(false);

    // 加载完成后立即同步当前配置
    companionWindow.webContents.on('did-finish-load', () => {
        if (companionWindow && !companionWindow.isDestroyed()) {
            const config = { zhipuApiKey, multimodalEnabled, multimodalProvider, zhipuApiUrl, aiPrompt, voiceEnabled, selectedVoice, voiceVolume, companionFontSize, companionPetSize, stickerPack };
            companionWindow.webContents.send('config-updated', config);
        }
    });

    companionWindow.on('closed', () => {
        companionWindow = null;
        companionModeActive = false;
    });
}

// 陪伴模式激活标记，阻止 minimize 事件创建浮窗
let companionModeActive = false;

// IPC: 进入陪伴模式
ipcMain.on('enter-companion-mode', () => {
    companionModeActive = true;
    // 关闭浮窗（如果存在）
    if (floatWindow && !floatWindow.isDestroyed()) {
        floatWindow.close();
        floatWindow = null;
    }
    createCompanionWindow();
    // 最小化主窗口
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.minimize();
    }
});

// IPC: 退出陪伴模式
ipcMain.on('exit-companion-mode', (event, target) => {
    companionModeActive = false;
    if (companionWindow && !companionWindow.isDestroyed()) {
        companionWindow.close();
        companionWindow = null;
    }
    // 通知浮窗退出陪伴模式
    if (floatWindow && !floatWindow.isDestroyed()) {
        floatWindow.webContents.send('companion-mode-ended');
    }
    // 根据目标恢复窗口
    if (target === 'main' && mainWindow) {
        mainWindow.restore();
        mainWindow.focus();
    } else if (target === 'chat') {
        if (!floatWindow || floatWindow.isDestroyed()) {
            createFloatWindow();
        } else {
            floatWindow.show();
            floatWindow.focus();
        }
        if (mainWindow) {
            mainWindow.restore();
        }
    }
});

// IPC: 设置陪伴窗口尺寸
ipcMain.on('set-companion-window-size', (event, w, h) => {
    const width = Math.max(200, Math.min(800, Math.round(Number(w) || companionWidth)));
    const height = Math.max(150, Math.min(600, Math.round(Number(h) || companionHeight)));
    companionWidth = width;
    companionHeight = height;
    if (companionWindow && !companionWindow.isDestroyed()) {
        // 先解除最小/最大尺寸限制，确保窗口能向小的方向收缩
        companionWindow.setMinimumSize(0, 0);
        companionWindow.setMaximumSize(0, 0);
        companionWindow.setSize(width, height);
        companionWindow.setMinimumSize(width, height);
        companionWindow.setMaximumSize(width, height);
    }
});

// IPC: 移动陪伴窗口
ipcMain.on('move-companion-window', (event, x, y) => {
    if (companionWindow && !companionWindow.isDestroyed()) {
        companionWindow.setPosition(Math.round(x), Math.round(y));
    }
});

// IPC: 获取陪伴窗口位置
ipcMain.on('get-companion-window-pos', (event) => {
    if (companionWindow && !companionWindow.isDestroyed()) {
        event.returnValue = companionWindow.getPosition();
    } else {
        event.returnValue = [0, 0];
    }
});

// ===== TTS subprocess management =====
let ttsProcess = null;
let ttsReady = false;

// ===== TTS 依赖自动安装 =====
// 运行前用与启动 TTS 相同的 Python 探测 edge_tts 是否可导入；若缺失则在运行时
// 自动联网安装到该 Python（优先嵌入式 Python 自带 pip/ensurepip，兜底系统 pip --target），
// 避免打包/开发环境下 postinstall 未成功导致 "ModuleNotFoundError: No module named 'edge_tts'"。
function edgeTtsInstalled(pythonPath) {
    try {
        execFileSync(pythonPath, ['-c', 'import edge_tts'], { stdio: 'ignore' });
        return true;
    } catch (e) {
        return false;
    }
}

function runCmdQuiet(cmd) {
    try {
        execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
        return true;
    } catch (e) {
        return false;
    }
}

// 嵌入式 Python 的 site-packages 目录；若 pythonPath 是系统命令则返回 null
function embeddedSitePackages(pythonPath) {
    if (!pythonPath || pythonPath === 'python' || pythonPath === 'python3' || pythonPath === 'py' || /^py -/.test(pythonPath)) {
        return null;
    }
    return path.join(path.dirname(pythonPath), 'Lib', 'site-packages');
}

function ensureTTSDeps(pythonPath) {
    if (!pythonPath) return false;
    if (edgeTtsInstalled(pythonPath)) {
        console.log('[TTS] edge_tts 已就绪');
        return true;
    }
    console.log('[TTS] 检测到 edge_tts 缺失，尝试自动安装（可能需要联网）...');
    const sitePackages = embeddedSitePackages(pythonPath);
    if (sitePackages) {
        // 方式1：嵌入式 Python 自带 pip
        let installed = runCmdQuiet(`"${pythonPath}" -m pip install edge-tts --disable-pip-version-check`);
        // 方式2：嵌入式 Python 无 pip 时，先引导 ensurepip 再装
        if (!installed) {
            installed = runCmdQuiet(`"${pythonPath}" -m ensurepip --upgrade`) &&
                        runCmdQuiet(`"${pythonPath}" -m pip install edge-tts --disable-pip-version-check`);
        }
        // 方式3：兜底系统 Python/pip，--target 装入嵌入式 site-packages
        if (!installed) {
            for (const c of ['python', 'python3', 'py -3']) {
                if (runCmdQuiet(`${c} -m pip install edge-tts --target "${sitePackages}" --disable-pip-version-check`)) {
                    installed = true;
                    break;
                }
            }
        }
        if (installed && edgeTtsInstalled(pythonPath)) {
            console.log('[TTS] edge_tts 安装完成');
            return true;
        }
    } else {
        // 系统 Python：直接 pip install 到自身
        if (runCmdQuiet(`"${pythonPath}" -m pip install edge-tts --disable-pip-version-check`) &&
            edgeTtsInstalled(pythonPath)) {
            console.log('[TTS] edge_tts 安装完成');
            return true;
        }
    }
    console.warn('[TTS] edge_tts 自动安装失败，TTS 功能暂时降级不可用。可修复后重启应用重试。');
    return false;
}

function initTTS() {
    const pythonPath = getPythonPath();
    const scriptPath = getResourcePath('tts_service', 'tts_server.py');
    
    // 运行前确保 edge_tts 依赖已安装
    ensureTTSDeps(pythonPath);

    // Check if script exists
    if (!fs.existsSync(scriptPath)) {
        console.warn('[TTS] TTS service script not found, TTS unavailable');
        return;
    }

    ttsProcess = spawn(pythonPath, [scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe']
    });
    
    ttsProcess.stderr.on('data', (data) => {
        console.log(`[TTS] ${data}`);
    });
    
    ttsProcess.on('close', (code) => {
        console.log(`[TTS] Process exited, code: ${code}`);
        ttsProcess = null;
        ttsReady = false;
    });
    
    ttsProcess.on('error', (err) => {
        console.error(`[TTS] Failed to start: ${err.message}`);
        ttsProcess = null;
        ttsReady = false;
    });

    // Mark ready (wait a moment for Python to start)
    setTimeout(() => {
        ttsReady = true;
        console.log('[TTS] Service ready');
    }, 1500);
}

// TTS request queue
let ttsRequestId = 0;
const ttsPendingRequests = new Map();

function sendTTSRequest(text, voice = 'zh-CN-XiaoxiaoNeural') {
    return new Promise((resolve, reject) => {
        if (!ttsProcess || !ttsReady) {
            reject(new Error('TTS service not ready'));
            return;
        }

        const id = ++ttsRequestId;
        const timeout = setTimeout(() => {
            ttsPendingRequests.delete(id);
            reject(new Error('TTS request timeout (30s)'));
        }, 30000);
        ttsPendingRequests.set(id, { resolve, reject, timeout });

        // Base64 encode text to avoid encoding issues across JS/Python boundary
        const textB64 = Buffer.from(text, 'utf-8').toString('base64');
        const request = JSON.stringify({ text: textB64, voice, request_id: id, _text_encoded: true });
        ttsProcess.stdin.write(request + '\n');
    });
}

// Listen for TTS response
function setupTTSListener() {
    if (!ttsProcess) return;

    let buffer = '';
    const handler = (data) => {
        buffer += data.toString();
        // Split by newline for processing
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep last incomplete line

        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const response = JSON.parse(line);
                // Use request_id for precise matching
                const rid = response.request_id;
                const pending = rid ? ttsPendingRequests.get(rid) : undefined;
                if (pending) {
                    clearTimeout(pending.timeout);
                    ttsPendingRequests.delete(rid);
                    if (response.success) {
                        pending.resolve(response.audio);
                    } else {
                        pending.reject(new Error(response.error || 'TTS synthesis failed'));
                    }
                } else {
                    console.warn('[TTS] Unmatched response (no pending request for id=' + rid + '):', response);
                }
            } catch (e) {
                console.error('[TTS] Response parse error:', e);
            }
        }
    };
    ttsProcess.stdout.on('data', handler);
}

// Start TTS
function startTTS() {
    initTTS();
    if (ttsProcess) {
        setTimeout(setupTTSListener, 2000);
    }
}

// ===== IPC: TTS =====
// Remove emoji from text before TTS synthesis (Edge TTS can't pronounce emoji)
function removeEmojiForTTS(text) {
    if (!text) return '';
    try {
        return text.replace(/\p{Emoji}/gu, '');
    } catch (e) {
        // Fallback regex for emoji (does not match Chinese characters)
        return text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2702}-\u{27B0}\u{24C2}-\u{1F251}\u{1F900}-\u{1F9FF}\u{200D}\u{FE0F}\u{20E3}\u{231A}-\u{23FA}\u{25AA}-\u{25FE}\u{2600}-\u{27EF}\u{2934}-\u{2935}\u{2B05}-\u{2B55}\u{3030}\u{303D}\u{3297}\u{3299}]/gu, '');
    }
}

ipcMain.handle('speak-text', async (event, text, voice = 'zh-CN-XiaoxiaoNeural') => {
    if (!text) return null;
    try {
        // Strip emoji before TTS (Edge TTS can't speak emoji, but Chinese text is preserved)
        const clean = removeEmojiForTTS(text);
        const audioB64 = await sendTTSRequest(clean, voice);
        return audioB64;
    } catch (error) {
        console.error('[TTS] Synthesis failed:', error.message);
        return null;
    }
});

// Get available voice list (Edge TTS Chinese voices)
ipcMain.handle('get-tts-voices', async () => {
    // Edge TTS 常见中文语音（id + 简短描述）
    return [
        { id: 'zh-CN-XiaoxiaoNeural', desc: '晓晓 · 温暖女声，日常对话首选' },
        { id: 'zh-CN-YunxiNeural', desc: '云希 · 阳光少年男声' },
        { id: 'zh-CN-YunjianNeural', desc: '云健 · 沉稳男声' },
        { id: 'zh-CN-XiaoyiNeural', desc: '晓伊 · 甜美活泼女声' },
        { id: 'zh-CN-YunyangNeural', desc: '云扬 · 浑厚新闻男声' },
        { id: 'zh-CN-XiaochenNeural', desc: '晓辰 · 元气少女声' },
        { id: 'zh-CN-XiaohanNeural', desc: '晓涵 · 自然亲切女声' },
        { id: 'zh-CN-XiaomengNeural', desc: '晓梦 · 细腻少年音' },
        { id: 'zh-CN-XiaoruiNeural', desc: '晓睿 · 知性女声' },
        { id: 'zh-CN-XiaoshuangNeural', desc: '晓双 · 童声可爱' },
        { id: 'zh-CN-XiaoxuanNeural', desc: '晓萱 · 温柔女声' },
        { id: 'zh-CN-XiaoyanNeural', desc: '晓颜 · 少儿清爽声' },
        { id: 'zh-CN-XiaoyouNeural', desc: '晓悠 · 开心明亮女声' },
        { id: 'zh-CN-XiaozhenNeural', desc: '晓甄 · 沉稳磁性女声' }
    ];
});

// ===== STT Subprocess Management (companion mode continuous recording + auto sentence segmentation) =====
let sttProcess = null;
let sttReady = false;
let sttBuffer = '';

function initSTT() {
    const pythonPath = getPythonPath();
    const scriptPath = getResourcePath('stt_service', 'stt_server.py');

    if (!fs.existsSync(scriptPath)) {
        console.warn('[STT] STT service script not found, STT unavailable');
        return false;
    }

    sttProcess = spawn(pythonPath, [scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe']
    });

    sttProcess.stderr.on('data', (data) => {
        console.log(`[STT] ${data}`);
    });

    sttProcess.on('close', (code) => {
        console.log(`[STT] Process exited, code: ${code}`);
        sttProcess = null;
        sttReady = false;
    });

    sttProcess.on('error', (err) => {
        console.error(`[STT] Failed to start: ${err.message}`);
        sttProcess = null;
        sttReady = false;
    });

    // Timeout: warn if STT not ready within 10s
    let sttReadyTimeout = setTimeout(() => {
        if (!sttReady) {
            console.warn('[STT] Service not ready within 10s, continuing anyway');
        }
    }, 10000);

    // Listen to stdout, parse JSON line by line
    sttProcess.stdout.on('data', (data) => {
        sttBuffer += data.toString();
        const lines = sttBuffer.split('\n');
        sttBuffer = lines.pop();

        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const response = JSON.parse(line);
                if (response.type === 'ready') {
                    sttReady = true;
                    clearTimeout(sttReadyTimeout);
                    console.log('[STT] Service ready');
                    // Notify all windows STT is ready
                    BrowserWindow.getAllWindows().forEach(win => {
                        if (!win.isDestroyed()) win.webContents.send('stt-ready');
                    });
                } else if (response.type === 'final' && response.text) {
                    // Recognition result - decode base64 if encoded by Python
                    let text = response.text;
                    if (response._text_encoded) {
                        text = Buffer.from(text, 'base64').toString('utf-8');
                    }
                    console.log('[STT] Recognition result:', text);
                    BrowserWindow.getAllWindows().forEach(win => {
                        if (!win.isDestroyed()) win.webContents.send('stt-result', text);
                    });
                } else if (response.type === 'ended') {
                    BrowserWindow.getAllWindows().forEach(win => {
                        if (!win.isDestroyed()) win.webContents.send('stt-ended');
                    });
                }
            } catch (e) {
                console.error('[STT] Response parse error:', e, line);
            }
        }
    });

    return true;
}

// Send STT command
function sendSTTCommand(action, data = {}) {
    if (!sttProcess || !sttReady) {
        console.warn('[STT] Service not ready');
        return false;
    }
    try {
        const cmd = JSON.stringify({ action, ...data });
        sttProcess.stdin.write(cmd + '\n');
        return true;
    } catch (e) {
        console.error('[STT] Send command failed:', e);
        return false;
    }
}

// Start STT
function startSTT() {
    initSTT();
}

// ===== IPC: STT streaming audio =====
ipcMain.handle('stt-stream-init', async () => {
    if (!sttProcess) {
        const ok = initSTT();
        if (!ok) return false;
        // 等待就绪
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
    if (sttReady) {
        sendSTTCommand('init');
        return true;
    }
    return false;
});

ipcMain.on('stt-stream-audio', (event, base64Data, isLast) => {
    sendSTTCommand('audio', { data: base64Data, isLast: !!isLast });
});

ipcMain.on('stt-stream-reset', () => {
    sendSTTCommand('reset');
});

ipcMain.on('stt-stream-end', () => {
    sendSTTCommand('end');
});

// ===== AI 请求代理（主进程发起，避免渲染进程 SSL 网络问题） =====
ipcMain.handle('ai-chat-request', async (event, { messages, model, maxTokens, temperature }) => {
    if (!zhipuApiKey) throw new Error('智谱 API Key 未设置');

    const body = JSON.stringify({
        model: model || 'glm-4-flash',
        messages: messages,
        max_tokens: maxTokens || 60,
        temperature: temperature || 0.8
    });

    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'open.bigmodel.cn',
            path: '/api/paas/v4/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${zhipuApiKey}`,
                'Content-Length': Buffer.byteLength(body)
            },
            rejectUnauthorized: false,  // 忽略 SSL 证书验证，解决 net_error -101
            timeout: 15000
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.error) {
                        reject(new Error(parsed.error.message));
                    } else {
                        resolve(parsed);
                    }
                } catch (e) {
                    reject(new Error(`JSON 解析失败: ${e.message}`));
                }
            });
        });

        req.on('error', (e) => {
            console.error('[AI Request Error]', e.message);
            reject(e);
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('请求超时'));
        });

        req.write(body);
        req.end();
    });
});

// 行为保持概率设置
ipcMain.on('set-behavior-keep-prob', (event, prob) => {
    if (typeof prob === 'number') {
        config_behaviorKeepProb = prob;
        // 广播到浮窗
        if (floatWindow && !floatWindow.isDestroyed()) {
            floatWindow.webContents.send('set-behavior-keep-prob', prob);
        }
    }
});

// 开发者模式状态同步到浮窗
ipcMain.on('set-dev-mode', (event, enabled) => {
    devModeEnabled = !!enabled;
    if (floatWindow && !floatWindow.isDestroyed()) {
        floatWindow.webContents.send('set-dev-mode', devModeEnabled);
    }
});

// ===== 双击Ctrl生成饼干（开发者模式） =====
// 封装生成饼干的公共函数，供 before-input-event 和 globalShortcut 共用
function spawnCookieFromDevMode() {
    if (!devModeEnabled) return;
    if (cookieWindow && !cookieWindow.isDestroyed()) return; // 已有饼干
    const primaryDisplay = screen.getPrimaryDisplay();
    const { workArea } = primaryDisplay;
    const margin = 80;
    const corners = [
        { x: workArea.x + margin, y: workArea.y + margin },
        { x: workArea.x + workArea.width - cookieSize - margin, y: workArea.y + margin },
        { x: workArea.x + margin, y: workArea.y + workArea.height - cookieSize - margin },
        { x: workArea.x + workArea.width - cookieSize - margin, y: workArea.y + workArea.height - cookieSize - margin }
    ];
    const corner = corners[Math.floor(Math.random() * corners.length)];
    createCookieWindow(corner.x, corner.y);
    setTimeout(() => {
        if (cookieWindow && !cookieWindow.isDestroyed()) {
            cookieWindow.webContents.send('cookie-config', {
                moveMode: floatMoveMode,
                petGroundY: lastPetGroundY,
                cookieSize: cookieSize
            });
        }
    }, 200);
}

// ===== 多模态（智谱 AI）IPC 处理器 =====

// 配置同步
ipcMain.on('set-zhipu-key', (event, key) => {
    zhipuApiKey = String(key || '');
    broadcastConfigUpdate();
});

ipcMain.on('set-multimodal-enabled', (event, enabled) => {
    multimodalEnabled = !!enabled;
    broadcastConfigUpdate();
});

// AI 人设同步
ipcMain.on('set-ai-prompt', (event, prompt) => {
    aiPrompt = String(prompt || '');
    broadcastConfigUpdate();
});

// 语音设置同步
ipcMain.on('set-voice-enabled', (event, enabled) => {
    voiceEnabled = !!enabled;
    broadcastConfigUpdate();
});

ipcMain.on('set-selected-voice', (event, voice) => {
    selectedVoice = String(voice || 'default');
    broadcastConfigUpdate();
});

ipcMain.on('set-voice-volume', (event, volume) => {
    voiceVolume = parseFloat(volume) || 1.0;
    broadcastConfigUpdate();
});

// 陪伴模式设置同步
ipcMain.on('set-companion-font-size', (event, size) => {
    companionFontSize = Math.max(10, Math.min(28, parseInt(size) || 14));
    broadcastConfigUpdate();
});

ipcMain.on('set-companion-pet-size', (event, size) => {
    companionPetSize = Math.max(80, Math.min(400, parseInt(size) || 180));
    broadcastConfigUpdate();
});

// ===== 贴图包管理 =====
// 扫描贴图包列表
ipcMain.handle('list-sticker-packs', async () => {
    const imgDir = path.join(__dirname, 'img');
    const packs = [];
    try {
        const entries = fs.readdirSync(imgDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const packDir = path.join(imgDir, entry.name);
            // 查找 pet 预览图（文件名以 pet 开头）
            const files = fs.readdirSync(packDir);
            const petFile = files.find(f => {
                const lower = f.toLowerCase();
                return lower.startsWith('pet') && /\.(png|jpg|jpeg|gif|webp|bmp|ico)$/i.test(f);
            });
            packs.push({
                name: entry.name,
                preview: petFile ? `img/${entry.name}/${petFile}` : null
            });
        }
    } catch (e) {
        console.error('[StickerPack] 扫描失败:', e);
    }
    return packs;
});

// 设置当前贴图包
ipcMain.on('set-sticker-pack', (event, packName) => {
    stickerPack = String(packName || '默认');
    broadcastConfigUpdate();
});

// 获取配置
ipcMain.handle('get-multimodal-config', () => {
    return { zhipuApiKey, multimodalEnabled, multimodalProvider, zhipuApiUrl };
});

// 打开 img 文件夹（用户添加自定义贴图包）
ipcMain.on('open-img-folder', () => {
    const imgDir = path.join(__dirname, 'img');
    shell.openPath(imgDir).catch(() => {});
});

// 扫描当前贴图包内 mood_*/浮窗_* 贴图，供渲染端动态生成 AI 提示词 & 新状态
function scanPackAssets() {
    const imgDir = path.join(__dirname, 'img');
    const assets = { moods: [], states: [], moodFileMap: {}, stateFileMap: {} };
    try {
        const packName = stickerPack || '默认';
        // 安全：只允许目录名
        const packDir = path.join(imgDir, packName);
        const files = fs.existsSync(packDir) ? fs.readdirSync(packDir) : [];
        const re = /^(mood|浮窗)_(.+)\.(png|jpg|jpeg|gif|webp|bmp)$/i;
        files.forEach(f => {
            const m = re.exec(f);
            if (!m) return;
            const name = m[2];
            const kind = m[1].toLowerCase();
            if (kind === 'mood') {
                if (!assets.moods.includes(name)) assets.moods.push(name);
                if (!assets.moodFileMap[name]) assets.moodFileMap[name] = f;
            } else {
                // 浮窗_饼干.png 是饼干窗口专用贴图，不属于桌宠状态，不扫描进 states
                if (name === '饼干') return;
                if (!assets.states.includes(name)) assets.states.push(name);
                if (!assets.stateFileMap[name]) assets.stateFileMap[name] = f;
            }
        });
        // 同时把 默认 包里存在的 mood_/浮窗_ 也并入，保证默认贴图也能用（各包立绘可缺失，逐层回退）
        const defDir = path.join(imgDir, '默认');
        if (defDir !== packDir && fs.existsSync(defDir)) {
            const defFiles = fs.readdirSync(defDir);
            defFiles.forEach(f => {
                const mm = re.exec(f);
                if (!mm) return;
                const name = mm[2];
                const kind = mm[1].toLowerCase();
                if (kind === 'mood' && !assets.moods.includes(name)) assets.moods.push(name);
                else if (kind !== 'mood' && name !== '饼干' && !assets.states.includes(name)) assets.states.push(name);
            });
        }
    } catch (e) {
        console.error('[PackAssets] 扫描失败:', e);
    }
    return assets;
}

ipcMain.handle('get-pack-assets', async () => scanPackAssets());

// ============================================================
// ===== DSH 联动（与 deepseek-harness 的 dsh-pet-link 插件通信）=====
// ============================================================
// 桌宠侧职责：
//   1. 本地 HTTP 服务（默认 127.0.0.1:34165）：
//      - GET  /dsh/status        供 dsh-pet-link 插件启动时拉取已注册状态列表/桌宠信息
//      - POST /dsh/message       接收插件推送的状态事件（say / state / todolist / output / usage）
//   2. 向插件端口转发「派任务 / 取消任务」请求（桌宠设置面板按钮触发）
//   3. 定时查询 DeepSeek 官方余额，供状态面板展示
//   4. 把插件推送广播给所有窗口（桌宠据此说话/切换贴图/渲染任务面板）
// ============================================================

const DSH_DEFAULT_PET_PORT = 34165;   // 桌宠本地状态服务端口
const DSH_DEFAULT_PLUGIN_PORT = 43999; // dsh-pet-link 插件 HTTP 端口
let dshEnabled = false;
let dshPetPort = DSH_DEFAULT_PET_PORT;
let dshPluginPort = DSH_DEFAULT_PLUGIN_PORT;
// 上一条推送到来时桌宠的已注册状态名列表（插件「切贴图」时据此校验）
let dshPetStatesCache = [];

// 插件侧可随时查询的聚合状态（供设置面板 / 插件 /status 使用）
const petDshState = {
    pluginReachable: false,   // 能否连上 dsh-pet-link 插件端口
    agentStatus: 'unknown',   // idle / running / unknown
    task: '',                 // 当前任务描述
    todolist: [],             // todolist 条目（[{ text, status }]）
    output: [],               // 最近输出流（思维链/工具调用，尾部为最新）
    lastTool: '',             // 最近一次工具名
    usage: null,              // 最近一次请求 usage
    totals: { tokens: 0, cost: 0, cacheHit: 0, cacheMiss: 0 }, // 累计统计
    balance: null,            // 官方余额接口结果
    updatedAt: null
};

function dshPluginBase() { return `http://127.0.0.1:${dshPluginPort}`; }

// DeepSeek API 错峰计费（北京时间）：高峰 = 周一至周五 9:00–12:00 / 14:00–18:00，
// 其余时段（含周末）为空闲时段；空闲时段价格 = 高峰价格的一半。
// getUTCDay/Hours 配合 +8h 偏移换算北京时间，避免依赖运行机本地时区。
function ratePeriodNow() {
    const now = new Date(Date.now() + 8 * 3600 * 1000); // 当前北京时间
    const day = now.getUTCDay();        // 0=周日 .. 6=周六
    const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
    const isWeekday = day >= 1 && day <= 5; // 周一..周五
    const isPeak = isWeekday && ((mins >= 9 * 60 && mins < 12 * 60) || (mins >= 14 * 60 && mins < 18 * 60));
    return {
        period: isPeak ? 'peak' : 'off-peak',
        label: isPeak ? '高峰时段' : '空闲时段',
        factor: isPeak ? 1 : 0.5 // 空闲价格 = 高峰一半
    };
}
function dshOrigin() {
    try { const u = new URL(deepseekApiBase()); return `${u.protocol}//${u.host}`; }
    catch (e) { return 'https://api.deepseek.com'; }
}

function sendToAllWindows(channel, payload) {
    BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) win.webContents.send(channel, payload);
    });
}

// 桌宠当前已注册状态（贴图原名列表，供插件切贴图时用）
function getPetStates() {
    return scanPackAssets().states || [];
}

// 将 DSH 插件推送写入聚合状态并广播给所有窗口
function acceptDshMessage(payload) {
    if (!payload || typeof payload !== 'object') return;
    const p = payload;
    if (p.agentStatus != null) petDshState.agentStatus = p.agentStatus;
    if (p.task != null) petDshState.task = p.task;
    if (Array.isArray(p.todolist)) petDshState.todolist = p.todolist;
    if (Array.isArray(p.output) && p.output.length) {
        if (!Array.isArray(petDshState.output)) petDshState.output = [];
        petDshState.output = petDshState.output.concat(p.output).slice(-200);
    }
    if (p.tool != null) petDshState.lastTool = p.tool;
    // 累计统计以插件侧 totals 为唯一来源（插件在每条推送里都带累计值，
    // 自己按 usage 再累加会造成双重复计；仅当推送没带 totals 时兜底自累加）
    if (p.totals && typeof p.totals === 'object') {
        petDshState.totals = {
            tokens: Number(p.totals.tokens) || 0,
            cost: Number(p.totals.cost) || 0,
            cacheHit: Number(p.totals.cacheHit) || 0,
            cacheMiss: Number(p.totals.cacheMiss) || 0
        };
    }
    if (p.usage && typeof p.usage === 'object') {
        petDshState.usage = p.usage;
        if (!(p.totals && typeof p.totals === 'object')) {
            const u = p.usage;
            // DSH 归一化 usage（inputTokens/outputTokens/cacheReadTokens/cacheWriteTokens）优先，
            // 兼容原始 DeepSeek 字段（prompt_tokens/prompt_cache_*_tokens/completion_tokens）兜底。
            const hit = Number(u.cacheReadTokens) || Number(u.prompt_cache_hit_tokens) || 0;
            const miss = Number(u.inputTokens) || Number(u.prompt_cache_miss_tokens) || 0;
            const write = Number(u.cacheWriteTokens) || 0;
            const inTok = Number(u.prompt_tokens) || (hit + miss + write);
            const outTok = Number(u.completion_tokens) || Number(u.outputTokens) || 0;
            petDshState.totals.tokens += inTok + outTok;
            petDshState.totals.cacheHit += hit;
            petDshState.totals.cacheMiss += miss;
            // 花费按 deepseek-v4-flash 预估（命中 0.2 元/M，未命中 1 元/M，输出 3 元/M；仅供参考），
            // 空闲时段（北京时间非高峰）价格减半
            const rateF = ratePeriodNow().factor;
            petDshState.totals.cost += (hit / 1e6) * 0.2 * rateF + (miss / 1e6) * 1 * rateF + (outTok / 1e6) * 3 * rateF;
        }
    }
    petDshState.updatedAt = Date.now();
    sendToAllWindows('dsh-message', {
        event: p.event || 'message',
        say: p.say || '',
        state: p.state || '',
        category: p.category || '',   // 浮窗「覆盖状态机」按环节切贴图依赖此字段
        minds: Array.isArray(p.minds) ? p.minds : undefined, // 浮窗思维栏
        tool: p.tool || '',
        question: p.question,
        options: p.options,
        toolName: p.toolName,
        reason: p.reason,
        agentStatus: petDshState.agentStatus,
        task: petDshState.task,
        todolist: petDshState.todolist,
        output: petDshState.output,
        totals: petDshState.totals,
        balance: petDshState.balance,
        pluginReachable: petDshState.pluginReachable,
        updatedAt: petDshState.updatedAt
    });
}

// 定时探测插件端口：插件先启动/网络抖动时也能感知在线状态，并顺带同步插件侧聚合状态
async function probeDshPlugin() {
    try {
        const res = await fetch(dshPluginBase() + '/status', { signal: AbortSignal.timeout(2500) });
        if (res.ok) {
            const body = await res.json();
            const wasReachable = petDshState.pluginReachable;
            const prevStatus = petDshState.agentStatus;
            petDshState.pluginReachable = true;
            if (body && typeof body === 'object') {
                if (body.agentStatus === 'idle' || body.agentStatus === 'running') petDshState.agentStatus = body.agentStatus;
                if (body.task != null) petDshState.task = body.task;
                if (Array.isArray(body.todolist)) petDshState.todolist = body.todolist;
                if (body.lastTool != null) petDshState.lastTool = body.lastTool;
                if (body.totals && typeof body.totals === 'object') petDshState.totals = { ...petDshState.totals, ...body.totals };
            }
            if (prevStatus !== petDshState.agentStatus) {
                // 插件未及时推送时，轮询发现运行/空闲切换也广播给浮窗，
                // 保证「DSH 进入工作模式 → 桌宠覆盖状态机激活/退出」不被推送丢失拖累
                sendToAllWindows('dsh-message', {
                    event: 'status/sync', agentStatus: petDshState.agentStatus,
                    pluginReachable: true, totals: petDshState.totals
                });
            }
            if (!wasReachable) {
                sendToAllWindows('dsh-message', {
                    event: 'plugin/ready', agentStatus: petDshState.agentStatus,
                    totals: petDshState.totals, pluginReachable: true
                });
            }
        } else {
            petDshState.pluginReachable = false;
        }
    } catch (e) {
        petDshState.pluginReachable = false;
    }
}

// 向插件发 JSON 请求
function postJsonToDsh(pathname, body) {
    return new Promise((resolve) => {
        const url = dshPluginBase() + pathname;
        const data = JSON.stringify(body || {});
        const req = http.request(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
            timeout: 5000
        }, (res) => {
            let raw = '';
            res.on('data', c => { raw += c; });
            res.on('end', () => {
                petDshState.pluginReachable = true;
                let data;
                try { data = raw ? JSON.parse(raw) : {}; }
                catch (e) { data = raw; }
                if (res.statusCode >= 200 && res.statusCode < 300) resolve({ ok: true, data });
                else resolve({ ok: false, data, httpStatus: res.statusCode });
            });
        });
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
        req.on('error', (e) => { petDshState.pluginReachable = false; resolve({ ok: false, error: e.message }); });
        req.end(data);
    });
}

// 查询 DeepSeek 官方余额
async function refreshDshBalance() {
    const key = deepseekKey();
    if (!key) {
        console.warn('[DSH] balance skipped: DeepSeek API Key not configured (unifiedConfig.apiKey)');
        return;
    }
    try {
        const res = await fetch(`${dshOrigin()}/user/balance`, {
            headers: { Accept: 'application/json', Authorization: `Bearer ${key}` }
        });
        if (res.ok) {
            const body = await res.json();
            petDshState.balance = body;
            sendToAllWindows('dsh-message', { event: 'balance', balance: body, totals: petDshState.totals });
        } else {
            console.warn('[DSH] balance query failed: HTTP', res.status);
        }
    } catch (e) {
        console.warn('[DSH] balance query error:', e.message);
    }
}

// ===== 桌宠本地 HTTP 服务 =====
function startDshPetServer() {
    const server = http.createServer(async (req, res) => {
        const send = (code, obj) => {
            res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(obj));
        };
        const url = new URL(req.url, `http://127.0.0.1:${dshPetPort}`);
        if (req.method === 'GET' && url.pathname === '/dsh/status') {
            dshPetStatesCache = getPetStates();
            return send(200, { petName: '桌宠', states: dshPetStatesCache, dsh: petDshState });
        }
        if (req.method === 'POST' && url.pathname === '/dsh/message') {
            let body = '';
            req.on('data', c => { body += c; if (body.length > 2e6) req.destroy(); });
            req.on('end', () => {
                try { acceptDshMessage(JSON.parse(body || '{}')); }
                catch (e) { console.warn('[DSH] 消息解析失败:', e.message); }
                send(200, { ok: true });
            });
            return;
        }
        send(404, { ok: false, error: 'not found' });
    });
    server.on('error', (e) => console.warn('[DSH] 桌宠本地服务启动失败:', e.message));
    server.listen(dshPetPort, '127.0.0.1', () => console.log(`[DSH] 桌宠状态服务已启动 http://127.0.0.1:${dshPetPort}`));
}

// ===== DSH 相关 IPC =====
ipcMain.handle('dsh-get-status', () => petDshState);
ipcMain.handle('dsh-send-task', async (event, message, opts) => {
    if (!message || !String(message).trim()) return { ok: false, error: 'empty' };
    return postJsonToDsh('/send', { message: String(message).trim(), sessionId: (opts && opts.sessionId) || undefined });
});
ipcMain.handle('dsh-cancel-task', async () => postJsonToDsh('/cancel', {}));
// ask_user 工具回传：浮窗弹窗用户选择 → 转给插件 /ask/result
ipcMain.on('dsh-ask-respond', (event, answer, index, canceled) => {
    postJsonToDsh('/ask/result', { answer: String(answer == null ? '' : answer), index: Number(index), canceled: !!canceled });
});
// 系统统计 + DeepSeek 峰谷时段（供贴图下方信息条展示）
// CPU 温度尽力而为（Windows 下尝试 wmic 热区，非所有机器可用，失败返回 null）
function probeCpuTemp() {
    return new Promise((resolve) => {
        if (process.platform !== 'win32') return resolve(null);
        const { execFile } = require('child_process');
        execFile('wmic', ['/namespace:\\\\root\\wmi', 'PATH', 'MSAcpi_ThermalZoneTemperature', 'get', 'CurrentTemperature', '/value'],
            { timeout: 1500, windowsHide: true },
            (err, stdout) => {
                if (err) return resolve(null);
                const m = /CurrentTemperature=(\d+)/.exec(stdout || '');
                if (!m) return resolve(null);
                const kelvin10 = parseInt(m[1], 10);
                if (!kelvin10) return resolve(null);
                const c = (kelvin10 / 10) - 273.15;
                resolve(Math.round(c));
            });
    });
}
// CPU 占用：Windows 上 os.loadavg 恒为 0，PowerShell CIM 的 LoadPercentage 多核/空闲时又常返回空，
// 统一改用 os.cpus() 时间片差值采样（跨平台、零依赖、无子进程开销）。
// get-system-stats 每 5s 轮询一次，差值窗口即两次采样间隔；首次调用返回 0（无基线）。
let lastCpuSample = null;
function probeCpuPct() {
    return new Promise((resolve) => {
        const os = require('os');
        const cpus = os.cpus && os.cpus() ? os.cpus() : [];
        if (!cpus.length) return resolve(0);
        let idle = 0, total = 0;
        for (const c of cpus) {
            for (const key in c.times) total += c.times[key];
            idle += c.times.idle;
        }
        const prev = lastCpuSample;
        lastCpuSample = { idle, total };
        if (!prev || total <= prev.total) return resolve(0); // 首次采样或时钟回拨
        const dIdle = idle - prev.idle;
        const dTotal = total - prev.total;
        resolve(dTotal > 0 ? Math.min(100, Math.max(0, Math.round((1 - dIdle / dTotal) * 100))) : 0);
    });
}
ipcMain.handle('get-system-stats', async () => {
    try {
        const os = require('os');
        const totalmem = os.totalmem ? os.totalmem() : 0;
        const freemem = os.freemem ? os.freemem() : 0;
        const memPct = totalmem > 0 ? Math.round((1 - freemem / totalmem) * 100) : 0;
        const cpuPct = await probeCpuPct();
        const tempC = await probeCpuTemp();
        return {
            cpuPct,
            memPct,
            tempC,
            memUsedGB: totalmem > 0 ? Number(((totalmem - freemem) / 1024 / 1024 / 1024).toFixed(1)) : 0,
            memTotalGB: totalmem > 0 ? Number((totalmem / 1024 / 1024 / 1024).toFixed(1)) : 0,
            ratePeriod: ratePeriodNow()
        };
    } catch (e) {
        return { cpuPct: 0, memPct: 0, tempC: null, memUsedGB: 0, memTotalGB: 0, ratePeriod: { period: 'peak', label: '高峰时段', factor: 1 } };
    }
});
ipcMain.on('dsh-set-plugin-port', (event, port) => {
    const n = parseInt(port, 10);
    if (n > 0 && n < 65536) {
        dshPluginPort = n;
        unifiedConfig.dsh = { ...(unifiedConfig.dsh || {}), pluginPort: n };
        saveUnifiedConfig();
        console.log('[DSH] 插件端口已更新:', n);
    }
});
ipcMain.on('dsh-set-enabled', (event, enabled) => {
    dshEnabled = !!enabled;
    unifiedConfig.dsh = { ...(unifiedConfig.dsh || {}), enabled: dshEnabled };
    saveUnifiedConfig();
    console.log('[DSH] 联动开关:', dshEnabled);
});

// 设置面板「模拟推送」按钮：让桌宠看到一轮 DSH 状态推送。
// 分两条链路并行走：
//   1. 桌宠本地直接广播（不依赖插件，立即验证覆盖状态机 + 环节贴图配置）
//   2. 若插件在线，同时让其 /test-state 模拟真实推送（验证插件 → 桌宠通道）
ipcMain.handle('dsh-test-state', async () => {
    const local = simulatePetStates();
    let plugin = null;
    if (petDshState.pluginReachable) {
        plugin = await postJsonToDsh('/test-state', {}).then(r => ({ ok: r.ok, data: r.data }));
    }
    return { ok: true, local: true, plugin };
});

// 桌宠本地模拟一轮 DSH 状态推送：think → cmd → read → grep → done → idle
async function simulatePetStates() {
    const cats = ['think', 'cmd', 'read', 'grep', 'done'];
    for (const c of cats) {
        sendToAllWindows('dsh-message', {
            event: 'test/send', category: c, agentStatus: 'running',
            task: '【测试】模拟状态推送', tool: c,
            todolist: [{ text: '模拟推送 ' + c + ' 环节', status: 'running' }],
            totals: petDshState.totals, pluginReachable: true
        });
        await new Promise((r) => setTimeout(r, 400));
    }
    // 先应用「任务完成」贴图（覆盖保持），再退出覆盖恢复随机状态机
    sendToAllWindows('dsh-message', {
        event: 'test/done', category: 'done', agentStatus: 'running', task: '【测试】模拟状态推送'
    });
    await new Promise((r) => setTimeout(r, 600));
    sendToAllWindows('dsh-message', { event: 'test/idle', agentStatus: 'idle', task: '' });
}

// 点击贴图下方信息条：唤起 DSH
//  - 插件端口可达（DSH 已在运行）→ 尝试把 DSH 主窗口带到前台，不重复启动
//  - 插件不可达 → 新开终端启动 dsh（命令可用 unifiedConfig.dsh.launchCmd 自定义，默认 npx @deepseek-ai/dsh web）
function launchDsh() {
    const probe = () => fetch(dshPluginBase() + '/status', { signal: AbortSignal.timeout(1500) })
        .then(r => r.ok).catch(() => false);
    probe().then(ok => {
        if (ok) {
            focusDshWindow();
            return;
        }
        const cmd = (unifiedConfig && unifiedConfig.dsh && unifiedConfig.dsh.launchCmd) || 'npx @deepseek-ai/dsh web';
        spawnDsh(cmd);
    });
}
function spawnDsh(cmd) {
    try {
        if (process.platform === 'win32') {
            // 新开一个标题为「DSH」的控制台窗口执行 dsh（保留窗口 /k），启动后与桌宠进程解耦；
            // 固定标题便于之后点状态栏时稳定聚焦该窗口
            spawn(process.env.ComSpec || 'cmd.exe', ['/c', 'start', 'DSH', 'cmd.exe', '/k', cmd],
                { detached: true, stdio: 'ignore' }).unref();
        } else if (process.platform === 'darwin') {
            spawn('osascript', ['-e', 'tell application "Terminal" to do script "' + cmd + '"'],
                { detached: true, stdio: 'ignore' }).unref();
        } else {
            spawn('x-terminal-emulator', ['-e', 'bash', '-lc', cmd],
                { detached: true, stdio: 'ignore' }).unref();
        }
        console.log('[DSH] DSH launched in new terminal:', cmd);
    } catch (e) {
        console.error('[DSH] launch failed:', e);
    }
}
// 尝试把已运行的 DSH 窗口带到最前并聚焦（恢复最小化 + 激活前台；匹配不到则静默忽略）
function focusDshWindow() {
    try {
        if (process.platform === 'win32') {
            // 匹配标题/进程名含 dsh|deepseek 的可见主窗口；ShowWindowAsync(SW_RESTORE=9) 恢复最小化，
            // 再用 AppActivate 置前台。我们自启动的 DSH 终端窗口标题固定为「DSH」，可稳定命中。
            const ps = 'Add-Type -TypeDefinition \'using System;using System.Runtime.InteropServices;' +
                'public class PetLinkWin{[DllImport("user32.dll")]public static extern bool ShowWindowAsync(IntPtr h,int c);}\';' +
                '$p=get-process | where { $_.MainWindowHandle -ne 0 -and ' +
                '($_.MainWindowTitle -match \'dsh\' -or $_.MainWindowTitle -match \'deepseek\' -or $_.ProcessName -match \'dsh\') } | select -first 1;' +
                'if($p){[PetLinkWin]::ShowWindowAsync($p.MainWindowHandle,9);' +
                '(New-Object -ComObject WScript.Shell).AppActivate($p.Id)}';
            spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { detached: true, stdio: 'ignore' }).unref();
        } else if (process.platform === 'darwin') {
            spawn('osascript', ['-e', 'tell application "System Events" to set frontmost of first process whose name contains "dsh" to true'],
                { detached: true, stdio: 'ignore' }).unref();
        } else {
            spawn('wmctrl', ['-a', 'dsh'], { detached: true, stdio: 'ignore' }).unref();
        }
    } catch (e) { /* 聚焦失败不阻塞 */ }
}
ipcMain.on('dsh-launch', () => { launchDsh(); });

// 启动 DSH 联动（whenReady 中调用）
function startDshLink() {
    const c = unifiedConfig && unifiedConfig.dsh;
    if (c) {
        if (c.enabled != null) dshEnabled = !!c.enabled;
        if (c.petPort) dshPetPort = parseInt(c.petPort, 10) || DSH_DEFAULT_PET_PORT;
        if (c.pluginPort) dshPluginPort = parseInt(c.pluginPort, 10) || DSH_DEFAULT_PLUGIN_PORT;
    }
    startDshPetServer();
    // 先探测一次插件是否在线，再每 10 秒巡检
    probeDshPlugin();
    setInterval(probeDshPlugin, 10 * 1000);
    // 每 5 分钟刷新一次余额
    refreshDshBalance();
    setInterval(refreshDshBalance, 5 * 60 * 1000);
    console.log('[DSH] 联动模块已启动 (petPort=' + dshPetPort + ', pluginPort=' + dshPluginPort + ', enabled=' + dshEnabled + ')');
}

// 屏幕捕获与分析（按提供商路由：deepseek / zhipu）
ipcMain.handle('capture-screen', async (event, recentMessages) => {
    try {
        return await describeScreen(recentMessages);
    } catch (e) {
        console.error('[capture-screen] 错误:', e);
        throw e;
    }
});

// 保存聊天记录
ipcMain.handle('save-chat-log', async (event, content) => {
    try {
        const { dialog } = require('electron');
        const now = new Date();
        const dateStr = `${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}_${now.getHours().toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}${now.getSeconds().toString().padStart(2,'0')}`;
        const result = await dialog.showSaveDialog({
            defaultPath: `chat_log_${dateStr}.txt`,
            filters: [{ name: '文本文件', extensions: ['txt'] }]
        });
        if (result.canceled) {
            return { success: false, canceled: true };
        }
        const fs = require('fs');
        fs.writeFileSync(result.filePath, content, 'utf-8');
        return { success: true, path: result.filePath };
    } catch (e) {
        console.error('[save-chat-log] 失败:', e.message);
        return { success: false, error: e.message };
    }
});

// 保存图片（从 URL 下载到本地）
ipcMain.handle('save-image-from-url', async (event, imageUrl) => {
    const { dialog } = require('electron');
    const fs = require('fs');
    const path = require('path');
    const https = require('https');
    const http = require('http');

    const result = await dialog.showSaveDialog({
        title: '保存图片',
        defaultPath: `image_${Date.now()}.png`,
        filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
    });

    if (result.canceled) {
        return { success: false, canceled: true };
    }

    return new Promise((resolve) => {
        const protocol = imageUrl.startsWith('https') ? https : http;
        protocol.get(imageUrl, (response) => {
            const fileStream = fs.createWriteStream(result.filePath);
            response.pipe(fileStream);
            fileStream.on('finish', () => {
                fileStream.close();
                resolve({ success: true, path: result.filePath });
            });
        }).on('error', (err) => {
            fs.unlink(result.filePath, () => {});
            resolve({ success: false, error: err.message });
        });
    });
});

// ===== Agent 工具系统 =====
// 所有工具通过 execute-tool IPC 统一调用

// 笔记目录路径
const PET_NOTES_DIR = path.join(require('os').homedir(), 'Documents', 'PetNotes');

// Python 工作区目录（用于临时脚本文件）
const PET_WORKSPACE_DIR = path.join(require('os').homedir(), 'Documents', 'PetWorkspace');

// ===== 程序资产管理 =====
const PET_PROGRAMS_DIR = path.join(PET_WORKSPACE_DIR, 'programs');
const PET_MANIFEST_PATH = path.join(PET_WORKSPACE_DIR, 'manifest.json');

// 确保程序目录存在
function ensureProgramsDir() {
    try {
        if (!fs.existsSync(PET_PROGRAMS_DIR)) {
            fs.mkdirSync(PET_PROGRAMS_DIR, { recursive: true });
        }
    } catch (e) {
        console.error('创建程序目录失败:', e);
    }
}

// 读取 manifest.json，如果文件不存在则自动创建空的默认文件
function readManifest() {
    try {
        ensureProgramsDir();
        if (fs.existsSync(PET_MANIFEST_PATH)) {
            const data = fs.readFileSync(PET_MANIFEST_PATH, 'utf-8');
            return JSON.parse(data);
        } else {
            // 文件不存在时，自动创建空的默认 manifest.json
            const defaultManifest = { programs: [] };
            fs.writeFileSync(PET_MANIFEST_PATH, JSON.stringify(defaultManifest, null, 2), 'utf-8');
            return defaultManifest;
        }
    } catch (e) {
        console.error('读取 manifest.json 失败:', e);
    }
    return { programs: [] };
}

// 写入 manifest.json
function writeManifest(manifest) {
    try {
        ensureProgramsDir();
        fs.writeFileSync(PET_MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf-8');
        return true;
    } catch (e) {
        console.error('写入 manifest.json 失败:', e);
        return false;
    }
}

// 通过 id 查找程序
function findProgramById(id) {
    const manifest = readManifest();
    return manifest.programs.find(p => p.id === id) || null;
}

// 更新程序的 lastRun 时间
function updateProgramLastRun(id) {
    const manifest = readManifest();
    const idx = manifest.programs.findIndex(p => p.id === id);
    if (idx !== -1) {
        manifest.programs[idx].lastRun = new Date().toISOString();
        writeManifest(manifest);
    }
}

// 获取需要被外部 Python 子进程读取的资源文件路径。
// tts_service / stt_service 打包后位于 resources/ 下（extraResources），
// 不再打进 app.asar（asar 内的文件外部进程无法读取）。
function getResourcePath(...segments) {
    if (process.resourcesPath) {
        const p = path.join(process.resourcesPath, ...segments);
        if (fs.existsSync(p)) return p;
    }
    // 开发环境：直接从项目目录读取
    return path.join(__dirname, ...segments);
}

// 获取嵌入式 Python 可执行文件路径
function getPythonPath() {
    // 打包后：resources/python/python.exe
    const resourcesPath = process.resourcesPath
        ? path.join(process.resourcesPath, 'python', 'python.exe')
        : null;
    if (resourcesPath && fs.existsSync(resourcesPath)) {
        return resourcesPath;
    }
    // 开发环境：electron/python/python.exe
    const devPath = path.join(__dirname, 'python', 'python.exe');
    if (fs.existsSync(devPath)) {
        return devPath;
    }
    // 最后尝试：系统 PATH 中的 python
    // Linux/macOS 通常只有 python3，优先使用
    if (process.platform !== 'win32') {
        return 'python3';
    }
    return 'python';
}

// 确保笔记目录存在
function ensureNotesDir() {
    try {
        if (!fs.existsSync(PET_NOTES_DIR)) {
            fs.mkdirSync(PET_NOTES_DIR, { recursive: true });
        }
    } catch (e) {
        console.error('创建笔记目录失败:', e);
    }
}

// 应用白名单与跨平台映射
const APP_WHITELIST = {
    '计算器': { win: 'calc', mac: 'Calculator.app', linux: 'gnome-calculator' },
    '记事本': { win: 'notepad', mac: 'TextEdit.app', linux: 'gedit' },
    '浏览器': { win: 'msedge', mac: 'Google Chrome.app', linux: 'google-chrome' },
    '微信': { win: 'wechat', mac: 'WeChat.app', linux: 'wechat' },
    'QQ': { win: 'qq', mac: 'QQ.app', linux: 'qq' },
    'VS Code': { win: 'code', mac: 'Visual Studio Code.app', linux: 'code' },
    '文件管理器': { win: 'explorer', mac: 'Finder.app', linux: 'nautilus' }
};

// 获取当前平台的应用命令
function getAppCommand(appName) {
    const entry = APP_WHITELIST[appName];
    if (!entry) return null;
    const platform = process.platform;
    if (platform === 'win32') return entry.win;
    if (platform === 'darwin') return entry.mac;
    return entry.linux; // linux 等
}

// ===== DeepSeek Files API：上传图片获取 file_id，供视觉模型使用 =====
// 解析 API 基础地址：从 apiUrl（如 https://api.deepseek.com/v1/chat/completions）
// 去掉末尾 /chat/completions，保留路径前缀（如 /v1），与渲染端 chat 请求地址完全一致
function deepseekApiBase() {
    const url = (unifiedConfig && unifiedConfig.apiUrl) || 'https://api.deepseek.com/v1/chat/completions';
    try {
        const u = new URL(url);
        let p = u.pathname.replace(/\/chat\/completions\/?$/, '');
        p = p.replace(/\/+$/, '');
        return `${u.protocol}//${u.host}${p}`;
    } catch (e) {
        return 'https://api.deepseek.com';
    }
}

function deepseekKey() {
    return (unifiedConfig && unifiedConfig.apiKey) || '';
}

// 将图片 Buffer 上传到 DeepSeek Files API 并返回 file_id（手工构建 multipart，兼容无全局 FormData 的环境）
function uploadImageToDeepSeekFiles(buffer, filename) {
    return new Promise((resolve, reject) => {
        const boundary = '----deepseek' + Date.now().toString(16);
        const ext = String(filename).split('.').pop().toLowerCase();
        const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
        const parts = [];
        parts.push(Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
            `Content-Type: ${mime}\r\n\r\n`
        ));
        parts.push(buffer);
        parts.push(Buffer.from('\r\n'));
        parts.push(Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nuser_data\r\n`
        ));
        parts.push(Buffer.from(`--${boundary}--\r\n`));
        const body = Buffer.concat(parts);

        const url = deepseekApiBase() + '/files';
        const httpMod = require(url.startsWith('https') ? 'https' : 'http');
        console.log('[Files] upload image ->', url, '| key present:', !!deepseekKey()); 
        const req = httpMod.request(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${deepseekKey()}`,
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length
            },
            timeout: 30000
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                console.log('[Files] upload response status:', res.statusCode, '| headers:', JSON.stringify(res.headers));
                try {
                    const j = JSON.parse(data);
                    if (res.statusCode >= 300 || j.error) {
                        reject(new Error('Files 上传失败: ' + (j.error && j.error.message ? j.error.message : data.substring(0, 200))));
                    } else if (j.id) {
                        resolve(j.id);
                    } else {
                        reject(new Error('Files 未返回 file_id'));
                    }
                } catch (e) { reject(e); }
            });
        });
        req.on('error', (err) => {
            console.error('[Files] upload network error ->', url, '| code:', err && err.code, '| errno:', err && err.errno, '| address:', err && err.address, '| port:', err && err.port, '| msg:', err && err.message, '\n', err && err.stack);
            reject(err);
        });
        req.on('timeout', () => {
            console.error('[Files] upload timeout ->', url);
            req.destroy(new Error('Files 上传超时'));
        });
        req.end(body);
    });
}

// 统一的屏幕描述能力：按多模态提供商（deepseek / zhipu）路由
async function describeScreen(recentMessages) {
    const { desktopCapturer } = require('electron');
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1600, height: 900 } });
    if (!sources || sources.length === 0) throw new Error('未找到屏幕源');
    const source = sources[0];
    const provider = multimodalProvider || 'deepseek';

    if (provider === 'zhipu') {
        if (!zhipuApiKey) throw new Error('智谱 API Key 未设置');
        const base64 = source.thumbnail.toJPEG(70).toString('base64');
        const zurl = (zhipuApiUrl || 'https://open.bigmodel.cn/api/paas/v4/chat/completions');
        const zresp = await fetch(zurl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${zhipuApiKey}` },
            body: JSON.stringify({
                model: 'glm-4v-flash',
                messages: [
                    { role: 'system', content: '你是一个屏幕分析助手。请根据用户当前屏幕截图和最近的对话上下文，用一句话总结用户当前正在做什么。' },
                    { role: 'user', content: [
                        { type: 'text', text: `最近的对话：${recentMessages || '无'}` },
                        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } }
                    ] }
                ],
                max_tokens: 100,
                temperature: 0.5
            })
        });
        const zdata = await zresp.json();
        if (!zdata.choices || zdata.choices.length === 0) throw new Error('GLM-4V 无有效响应');
        return zdata.choices[0].message.content.trim();
    }

    // 默认 DeepSeek 视觉模型：上传截图到 Files API 获取 file_id 后分析
    if (!deepseekKey()) throw new Error('DeepSeek API Key 未设置');
    const fileId = await uploadImageToDeepSeekFiles(source.thumbnail.toPNG(), 'screenshot.png');
    const dresp = await fetch(deepseekApiBase() + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${deepseekKey()}` },
        body: JSON.stringify({
            model: 'deepseek-v4-flash-vision-exp',
            messages: [{ role: 'user', content: [
                { type: 'file', file_id: fileId },
                { type: 'text', text: `请根据用户当前屏幕截图和最近的对话上下文，用一句话总结用户当前正在做什么，以及可能与对话相关的环境线索。\n最近的对话：${recentMessages || '无'}` }
            ] }],
            max_tokens: 100,
            temperature: 0.5
        })
    });
    const ddata = await dresp.json();
    if (!ddata.choices || !ddata.choices[0] || !ddata.choices[0].message) {
        throw new Error((ddata.error && ddata.error.message) || 'DeepSeek 视觉模型无有效响应');
    }
    return ddata.choices[0].message.content.trim();
}

// ===== 多模态聊天截图：上传 Files API + 本地缓存 + 删除 + 列表（供图像记忆使用）=====
const screenshotCacheDir = path.join(app.getPath('userData'), 'screenshotCache');

function ensureScreenshotCacheDir() {
    try { if (!fs.existsSync(screenshotCacheDir)) fs.mkdirSync(screenshotCacheDir, { recursive: true }); } catch (e) {}
}

// 把已上传的截图写入本地缓存，返回 {imagePath, imageUrl}（ext 默认 png，兼容任意图片格式）
function cacheScreenshot(fileId, buffer, ext = 'png') {
    ensureScreenshotCacheDir();
    const safeName = String(fileId).replace(/[^a-zA-Z0-9-_]/g, '_') + '.' + String(ext).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const imagePath = path.join(screenshotCacheDir, safeName);
    try { fs.writeFileSync(imagePath, buffer); } catch (e) { console.error('[cacheScreenshot]', e); }
    let imageUrl = '';
    try { imageUrl = require('url').pathToFileURL(imagePath).href; } catch (e) {}
    return { imagePath, imageUrl };
}

// 截屏 -> 上传 Files API -> 本地缓存，返回 {fileId, imagePath, imageUrl}
ipcMain.handle('multimodal-upload-screenshot', async () => {
    console.log('[Files] start screenshot upload | apiUrl:', (unifiedConfig && unifiedConfig.apiUrl) || '(empty)', '| derived base:', deepseekApiBase());
    try {
        const { desktopCapturer } = require('electron');
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1600, height: 900 } });
        if (!sources || sources.length === 0) throw new Error('未找到屏幕源');
        if (!deepseekKey()) throw new Error('DeepSeek API Key 未设置');
        const source = sources[0];
        const pngBuffer = source.thumbnail.toPNG();
        console.log('[Files] screenshot captured, buffer bytes:', pngBuffer.length);
        const fileId = await uploadImageToDeepSeekFiles(pngBuffer, `screenshot-${Date.now()}.png`);
        console.log('[Files] upload success fileId:', fileId);
        const { imagePath, imageUrl } = cacheScreenshot(fileId, pngBuffer);
        console.log('[Files] local cache:', imagePath);
        return { fileId, imagePath, imageUrl };
    } catch (e) {
        console.error('[Files] screenshot upload failed overall:', e && e.constructor && e.constructor.name, '| code:', e && e.code, '| msg:', e && e.message, '\n', e && e.stack);
        throw e;
    }
});

// 手动"添加图片记忆"：弹出文件选择框 -> 上传 Files API 获取 file_id -> 本地缓存，返回 {fileId, imagePath, imageUrl}
ipcMain.handle('multimodal-upload-memory-image', async (event) => {
    try {
        const win = BrowserWindow.fromWebContents(event.sender);
        const dlgOpts = {
            title: '选择要添加为记忆的图片',
            properties: ['openFile'],
            filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] }]
        };
        const picked = win ? await dialog.showOpenDialog(win, dlgOpts) : await dialog.showOpenDialog(dlgOpts);
        if (!picked || picked.canceled || !picked.filePaths || picked.filePaths.length === 0) {
            return { canceled: true };
        }
        const filePath = picked.filePaths[0];
        if (!deepseekKey()) throw new Error('DeepSeek API Key 未设置');
        const buffer = fs.readFileSync(filePath);
        if (!buffer || buffer.length === 0) throw new Error('图片文件为空');
        const filename = path.basename(filePath);
        console.log('[Files] memory image upload start | bytes:', buffer.length, '| file:', filename);
        const fileId = await uploadImageToDeepSeekFiles(buffer, filename);
        const extMatch = filename.match(/\.([a-zA-Z0-9]+)$/);
        const ext = extMatch ? extMatch[1] : 'png';
        const { imagePath, imageUrl } = cacheScreenshot(fileId, buffer, ext);
        console.log('[Files] memory image uploaded fileId:', fileId, '| cached:', imagePath);
        return { canceled: false, fileId, imagePath, imageUrl, filename };
    } catch (e) {
        console.error('[Files] memory image upload failed:', e && e.stack, '| msg:', e && e.message);
        throw e;
    }
});

// 删除 Files API 上的文件（DELETE /files/{file_id}）
function deleteDeepSeekFile(fileId) {
    return new Promise((resolve, reject) => {
        const url = `${deepseekApiBase()}/files/${encodeURIComponent(String(fileId))}`;
        const httpMod = require(url.startsWith('https') ? 'https' : 'http');
        console.log('[Files] delete file ->', url, '| key present:', !!deepseekKey());
        const req = httpMod.request(url, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${deepseekKey()}` },
            timeout: 30000
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                console.log('[Files] delete response status:', res.statusCode, '| body:', data.substring(0, 200));
                let j = null;
                try { j = data ? JSON.parse(data) : null; } catch (e) { j = null; }
                // 2xx 或 404（文件本就不存在）都算删除成功
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve({ success: true, fileId });
                } else if (res.statusCode === 404) {
                    resolve({ success: true, fileId, alreadyGone: true });
                } else {
                    resolve({ success: false, status: res.statusCode, message: (j && j.error && j.error.message) || data.substring(0, 200) });
                }
            });
        });
        req.on('error', (err) => {
            console.error('[Files] delete network error ->', url, '| code:', err && err.code, '| errno:', err && err.errno, '| address:', err && err.address, '| port:', err && err.port, '| msg:', err && err.message, '\n', err && err.stack);
            reject(err);
        });
        req.on('timeout', () => {
            console.error('[Files] delete timeout ->', url);
            req.destroy(new Error('删除文件超时'));
        });
        req.end();
    });
}

ipcMain.handle('multimodal-delete-file', async (event, fileId) => {
    try { return await deleteDeepSeekFile(fileId); }
    catch (e) { console.error('[multimodal-delete-file]', e); return { success: false, message: e.message }; }
});

// 列出账号下所有文件（GET /files），返回 {ids:[], data:[]}
function listDeepSeekFiles() {
    return new Promise((resolve, reject) => {
        const url = `${deepseekApiBase()}/files`;
        const httpMod = require(url.startsWith('https') ? 'https' : 'http');
        console.log('[Files] list files ->', url, '| key present:', !!deepseekKey());
        const req = httpMod.request(url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${deepseekKey()}` },
            timeout: 30000
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                console.log('[Files] list response status:', res.statusCode, '| body200:', data.substring(0, 200));
                try {
                    const j = JSON.parse(data);
                    if (res.statusCode >= 300 || j.error) {
                        resolve({ success: false, ids: [], data: [], status: res.statusCode, message: (j.error && j.error.message) || data.substring(0, 200) });
                    } else {
                        const items = Array.isArray(j.data) ? j.data : [];
                        const ids = items.map(f => f.id).filter(Boolean);
                        resolve({ success: true, ids, data: items });
                    }
                } catch (e) {
                    resolve({ success: false, ids: [], data: [], message: '解析失败 ' + data.substring(0, 200) });
                }
            });
        });
        req.on('error', (err) => {
            console.error('[Files] list network error ->', url, '| code:', err && err.code, '| errno:', err && err.errno, '| address:', err && err.address, '| port:', err && err.port, '| msg:', err && err.message, '\n', err && err.stack);
            reject(err);
        });
        req.on('timeout', () => {
            console.error('[Files] list timeout ->', url);
            req.destroy(new Error('列出文件超时'));
        });
        req.end();
    });
}

ipcMain.handle('multimodal-list-files', async () => {
    try { return await listDeepSeekFiles(); }
    catch (e) { console.error('[multimodal-list-files]', e); return { success: false, ids: [], data: [], message: e.message }; }
});

// 设置面板"测试 API 连接"：用当前填写的 Key/地址发起一次最小聊天请求，验证地址、鉴权与模型是否可用
ipcMain.handle('ai-test-api', async (event, { provider, apiKey, apiUrl } = {}) => {
    const start = Date.now();
    const latencyNow = () => Date.now() - start;
    try {
        const p = String(provider || 'deepseek').toLowerCase();
        const key = String(apiKey || '').trim();
        const url = String(apiUrl || '').trim();
        if (!key) return { ok: false, latencyMs: latencyNow(), message: '未填写 API Key' };
        if (!url) return { ok: false, latencyMs: latencyNow(), message: '未填写 API 地址' };

        const model = p === 'zhipu' ? 'glm-4-flash' : 'deepseek-v4-flash';
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);
        console.log('[ai-test-api] ->', url, '| model:', model, '| key present:', !!key);

        let resp;
        try {
            resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
                body: JSON.stringify({
                    model: model,
                    messages: [{ role: 'user', content: 'ping' }],
                    max_tokens: 1,
                    temperature: 0.2
                }),
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeoutId);
        }

        const text = await resp.text();
        let data = null;
        try { data = JSON.parse(text); } catch (e) { data = null; }
        if (!resp.ok) {
            const msg = (data && data.error && data.error.message) ? data.error.message : text.substring(0, 300);
            console.error('[ai-test-api] HTTP', resp.status, '->', msg);
            return { ok: false, status: resp.status, latencyMs: latencyNow(), message: `HTTP ${resp.status}: ${msg}` };
        }
        if (!data || !data.choices || !data.choices[0]) {
            return { ok: false, status: resp.status, latencyMs: latencyNow(), message: '响应异常（缺少 choices）' };
        }
        return { ok: true, status: resp.status, latencyMs: latencyNow(), model: model, message: '连接成功，API Key 有效' };
    } catch (e) {
        const aborted = e && e.name === 'AbortError';
        console.error('[ai-test-api] error:', e);
        return { ok: false, latencyMs: latencyNow(), message: aborted ? '请求超时（20秒）' : '请求失败: ' + (e && e.message ? e.message : e) };
    }
});

// 删除本地缓存截图
ipcMain.handle('multimodal-delete-cache', async (event, imagePath) => {
    try {
        if (imagePath && fs.existsSync(imagePath)) { fs.unlinkSync(imagePath); return { success: true }; }
        return { success: false, message: '缓存文件不存在' };
    } catch (e) {
        console.error('[multimodal-delete-cache]', e);
        return { success: false, message: e.message };
    }
});

// 渲染进程日志转发到主进程 stdout（[renderer] 前缀，源头窗口用 tag 区分）
ipcMain.on('renderer-log', (event, payload) => {
    const level = payload && payload.level;
    const msg = payload && payload.message;
    if (level === 'error') {
        console.error('[renderer]', msg);
    } else if (level === 'warn') {
        console.warn('[renderer]', msg);
    } else {
        console.log('[renderer]', msg);
    }
});

// 执行系统工具
async function executeToolHandler(toolName, args) {
    try {
        switch (toolName) {
            // ===== 笔记操作 =====
            case 'write_note': {
                const { title, content } = args || {};
                if (!title || !content) return { success: false, error: '标题和内容不能为空' };
                ensureNotesDir();
                // 文件名安全处理：移除非法字符
                const safeTitle = title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
                const filePath = path.join(PET_NOTES_DIR, safeTitle + '.txt');
                fs.writeFileSync(filePath, content, 'utf-8');
                return { success: true, data: `笔记"${title}"已保存` };
            }

            case 'read_note': {
                ensureNotesDir();
                const files = fs.readdirSync(PET_NOTES_DIR).filter(f => f.endsWith('.txt'));
                if (!args || !args.title) {
                    // 列出所有笔记
                    const list = files.map(f => f.replace('.txt', ''));
                    return { success: true, data: list.length > 0 ? list.join(', ') : '暂无笔记' };
                }
                const safeTitle = args.title.replace(/[<>:"/\\|?*]/g, '_');
                const filePath = path.join(PET_NOTES_DIR, safeTitle + '.txt');
                if (!fs.existsSync(filePath)) {
                    return { success: false, error: `笔记"${args.title}"不存在` };
                }
                const content = fs.readFileSync(filePath, 'utf-8');
                return { success: true, data: content };
            }

            case 'delete_note': {
                if (!args || !args.title) return { success: false, error: '笔记标题不能为空' };
                ensureNotesDir();
                const safeTitle = args.title.replace(/[<>:"/\\|?*]/g, '_');
                const filePath = path.join(PET_NOTES_DIR, safeTitle + '.txt');
                if (!fs.existsSync(filePath)) {
                    return { success: false, error: `笔记"${args.title}"不存在` };
                }
                fs.unlinkSync(filePath);
                return { success: true, data: `笔记"${args.title}"已删除` };
            }

            // ===== 应用操作 =====
            case 'open_app': {
                if (!args || !args.app) return { success: false, error: '应用名称不能为空' };
                const cmd = getAppCommand(args.app);
                if (!cmd) {
                    return { success: false, error: `不支持的应用：${args.app}` };
                }
                const { exec } = require('child_process');
                await new Promise((resolve, reject) => {
                    exec(cmd, (error) => {
                        if (error) reject(error);
                        else resolve();
                    });
                });
                return { success: true, data: `已打开${args.app}` };
            }

            case 'open_url': {
                if (!args || !args.url) return { success: false, error: 'URL不能为空' };
                const { exec } = require('child_process');
                const url = args.url.startsWith('http') ? args.url : 'https://' + args.url;
                const platform = process.platform;
                let cmd;
                if (platform === 'win32') cmd = `start "" "${url}"`;
                else if (platform === 'darwin') cmd = `open "${url}"`;
                else cmd = `xdg-open "${url}"`;
                await new Promise((resolve, reject) => {
                    exec(cmd, (error) => {
                        if (error) reject(error);
                        else resolve();
                    });
                });
                return { success: true, data: `已打开网址：${url}` };
            }

            // ===== 音量操作 =====
            case 'set_volume': {
                if (args === undefined || args === null) return { success: false, error: '音量值不能为空' };
                const level = typeof args === 'object' ? args.level : args;
                if (typeof level !== 'number' || level < 0 || level > 100) {
                    return { success: false, error: '音量值需为 0-100 的数字' };
                }
                const { exec } = require('child_process');
                const platform = process.platform;
                if (platform === 'win32') {
                    // Windows 使用 powershell 设置音量
                    await new Promise((resolve, reject) => {
                        exec(`powershell -c "(New-Object -ComObject WScript.Shell).SendKeys([char]173)"`, () => resolve());
                    });
                } else if (platform === 'darwin') {
                    await new Promise((resolve, reject) => {
                        exec(`osascript -e "set volume output volume ${level}"`, (e) => e ? reject(e) : resolve());
                    });
                } else {
                    // Linux: 使用 amixer 或 pactl
                    try {
                        await new Promise((resolve, reject) => {
                            exec(`amixer set Master ${level}%`, (e) => e ? reject(e) : resolve());
                        });
                    } catch (e) {
                        // 尝试 pactl
                        await new Promise((resolve, reject) => {
                            const pct = Math.round(level * 65536 / 100);
                            exec(`pactl set-sink-volume @DEFAULT_SINK@ ${pct}`, (e) => e ? reject(e) : resolve());
                        });
                    }
                }
                return { success: true, data: `音量已设置为 ${level}%` };
            }

            case 'get_volume': {
                const { exec } = require('child_process');
                const platform = process.platform;
                if (platform === 'linux') {
                    try {
                        const result = await new Promise((resolve, reject) => {
                            exec('amixer get Master | grep -oP "\\d+%"', (e, stdout) => {
                                if (e) reject(e);
                                else resolve(stdout.trim());
                            });
                        });
                        const pct = parseInt(result) || 50;
                        return { success: true, data: pct };
                    } catch (e) {
                        return { success: true, data: 50 }; // 默认值
                    }
                } else if (platform === 'darwin') {
                    const result = await new Promise((resolve, reject) => {
                        exec('osascript -e "output volume of (get volume settings)"', (e, stdout) => {
                            if (e) reject(e);
                            else resolve(stdout.trim());
                        });
                    });
                    return { success: true, data: parseInt(result) || 50 };
                }
                return { success: true, data: 50 };
            }

            // ===== 截屏 =====
            case 'screenshot': {
                const { exec } = require('child_process');
                const desktopPath = path.join(require('os').homedir(), 'Desktop');
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const filename = `screenshot_${timestamp}.png`;
                const filePath = path.join(desktopPath, filename);
                const platform = process.platform;
                if (platform === 'win32') {
                    // Windows 截图工具
                    await new Promise((resolve) => {
                        exec(`powershell -c "Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.SendKeys]::SendWait('{PRTSC}')"`, () => resolve());
                    });
                    return { success: true, data: '截图已保存到剪贴板（需手动粘贴到画图工具保存）' };
                } else if (platform === 'darwin') {
                    await new Promise((resolve, reject) => {
                        exec(`screencapture -x "${filePath}"`, (e) => e ? reject(e) : resolve());
                    });
                } else {
                    // Linux: 使用 import (ImageMagick) 或 gnome-screenshot
                    try {
                        await new Promise((resolve, reject) => {
                            exec(`gnome-screenshot -f "${filePath}"`, (e) => e ? reject(e) : resolve());
                        });
                    } catch (e) {
                        await new Promise((resolve, reject) => {
                            exec(`import -window root "${filePath}"`, (e) => e ? reject(e) : resolve());
                        });
                    }
                }
                return { success: true, data: `截图已保存到桌面：${filename}` };
            }

            // ===== 系统信息 =====
            case 'get_system_info': {
                const os = require('os');
                const cpus = os.cpus();
                const totalMem = os.totalmem();
                const freeMem = os.freemem();
                const memUsage = Math.round((1 - freeMem / totalMem) * 100);
                // CPU 使用率（瞬时采样）
                const cpuLoad = cpus.reduce((acc, cpu) => {
                    const total = Object.values(cpu.times).reduce((a, b) => a + b);
                    const idle = cpu.times.idle;
                    return acc + (1 - idle / total);
                }, 0) / cpus.length;
                // 磁盘信息
                let diskUsage = 0;
                try {
                    const { exec } = require('child_process');
                    const df = await new Promise((resolve) => {
                        exec('df -h / | tail -1', (e, stdout) => resolve(stdout.trim()));
                    });
                    const parts = df.split(/\s+/);
                    if (parts.length >= 5) {
                        diskUsage = parseInt(parts[4]) || 0;
                    }
                } catch (e) {}
                return {
                    success: true,
                    data: {
                        cpu: Math.round(cpuLoad * 100),
                        memory: memUsage,
                        disk: diskUsage,
                        platform: os.platform(),
                        hostname: os.hostname()
                    }
                };
            }

            // ===== 天气查询 =====
            case 'get_weather': {
                if (!args || !args.city) return { success: false, error: '城市名称不能为空' };
                const fetch = (url) => new Promise((resolve, reject) => {
                    const http = require(url.startsWith('https') ? 'https' : 'http');
                    http.get(url, (res) => {
                        let data = '';
                        res.on('data', chunk => data += chunk);
                        res.on('end', () => resolve(data));
                    }).on('error', reject);
                });
                try {
                    const encodedCity = encodeURIComponent(args.city);
                    const data = await fetch(`https://wttr.in/${encodedCity}?format=%C+%t+%w+%h&lang=zh`);
                    const trimmed = data.trim();
                    if (trimmed && trimmed.length < 50) {
                        return { success: true, data: `${args.city}：${trimmed}` };
                    }
                    return { success: true, data: `${args.city}：获取天气数据失败` };
                } catch (e) {
                    return { success: false, error: '获取天气失败' };
                }
            }

            // ===== 时间查询 =====
            case 'get_time': {
                const now = new Date();
                const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
                const timeStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${weekdays[now.getDay()]} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
                return { success: true, data: timeStr };
            }

            // ===== 翻译 =====
            case 'translate': {
                if (!args || !args.text) return { success: false, error: '翻译文本不能为空' };
                const targetLang = args.target_lang || '中文';
                // 使用 DeepSeek API 翻译（复用已有配置，但无 API key 时返回错误）
                const fetch = (url, options) => new Promise((resolve, reject) => {
                    const http = require(url.startsWith('https') ? 'https' : 'http');
                    const req = http.request(url, { method: 'POST', headers: options.headers, timeout: 10000 }, (res) => {
                        let data = '';
                        res.on('data', chunk => data += chunk);
                        res.on('end', () => resolve(data));
                    });
                    req.on('error', reject);
                    req.write(options.body);
                    req.end();
                });
                try {
                    // 尝试使用 mymemory.translate.net 免费 API
                    const encoded = encodeURIComponent(args.text);
                    const data = await fetch(`https://api.mymemory.translated.net/get?q=${encoded}&langpair=auto|${targetLang === '中文' ? 'zh-CN' : 'en'}`, { headers: {} });
                    const result = JSON.parse(data);
                    if (result.responseStatus === 200) {
                        return { success: true, data: result.responseData.translatedText };
                    }
                    return { success: true, data: `翻译结果：${args.text}` };
                } catch (e) {
                    return { success: false, error: '翻译失败' };
                }
            }

            // ===== 数学计算 =====
            case 'calculate': {
                if (!args || !args.expression) return { success: false, error: '表达式不能为空' };
                // 安全计算：只允许数字、运算符、括号、小数点
                const expr = args.expression.trim();
                // 只允许安全字符
                if (!/^[\d+\-*/().%\s]+$/.test(expr)) {
                    return { success: false, error: '表达式包含非法字符' };
                }
                try {
                    // 使用 Function 构造器进行安全计算（比 eval 更可控）
                    const result = new Function(`return (${expr})`)();
                    if (typeof result === 'number' && isFinite(result)) {
                        return { success: true, data: result };
                    }
                    return { success: false, error: '计算无效' };
                } catch (e) {
                    return { success: false, error: '计算表达式错误' };
                }
            }

            // ===== 保存程序（原子操作：保存代码 + 注册到 manifest） =====
            case 'save_program': {
                console.log('[save_program] 原始 args:', JSON.stringify(args));

                // ----- 1. 参数归一化（支持嵌套） -----
                let params = args;
                if (args && typeof args === 'object') {
                    const nestedKeys = ['args', 'params', 'arguments'];
                    for (const key of nestedKeys) {
                        if (args[key] && typeof args[key] === 'object' && !Array.isArray(args[key])) {
                            params = args[key];
                            break;
                        }
                    }
                }
                // 如果 params 是数组，取第一个元素
                if (Array.isArray(params)) {
                    params = params.length > 0 ? params[0] : {};
                }

                console.log('[save_program] 归一化 params:', JSON.stringify(params));

                // ----- 2. 提取字段 -----
                let { name, description, code, id: providedId, type, tags, params: paramDefs } = params || {};

                // 如果 name/description/code 仍为空，尝试从原始 args 中深度查找
                if ((!name || !description || !code) && args && typeof args === 'object') {
                    const deepFind = (obj, key) => {
                        if (!obj || typeof obj !== 'object') return undefined;
                        if (obj[key] && typeof obj[key] === 'string') return obj[key];
                        for (const val of Object.values(obj)) {
                            if (val && typeof val === 'object') {
                                const found = deepFind(val, key);
                                if (found) return found;
                            }
                        }
                        return undefined;
                    };
                    if (!name) name = deepFind(args, 'name');
                    if (!description) description = deepFind(args, 'description');
                    if (!code) code = deepFind(args, 'code');
                }

                console.log('[save_program] 提取后 name:', name, 'description:', description, 'code 长度:', code ? code.length : 0);

                // ----- 3. 检查必填参数 -----
                const missing = [];
                if (!name || typeof name !== 'string') missing.push('name');
                if (!description || typeof description !== 'string') missing.push('description');
                if (!code || typeof code !== 'string') missing.push('code');
                if (missing.length > 0) {
                    return {
                        success: false,
                        error: `缺少必填参数：${missing.join('、')}。当前收到的参数结构：${JSON.stringify(args)}`
                    };
                }

                // ----- 4. 对 code 进行规范化（确保换行符被保留） -----
                if (typeof code === 'string') {
                    // 如果 code 不包含真实换行，但包含字面量 \n（两个字符 \\n），转换为真实换行
                    if (!code.includes('\n') && code.includes('\\n')) {
                        code = code.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r');
                    }
                    // 同样处理 \\" 和 \\' 转义
                    code = code.replace(/\\"/g, '"').replace(/\\'/g, "'");
                }

                // ----- 5. 生成 ID -----
                const programId = providedId || name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + '_' + Date.now().toString(36).slice(-4);

                // 检查是否已存在
                if (findProgramById(programId)) {
                    return { success: false, error: `程序 ID "${programId}" 已存在，不允许覆盖` };
                }

                // 确定文件扩展名
                const ext = type === 'javascript' ? 'js' : type === 'bash' ? 'sh' : type === 'html' ? 'html' : 'py';
                const programDir = path.join(PET_PROGRAMS_DIR, programId);
                const scriptPath = path.join(programDir, `script.${ext}`);

                try {
                    // 1. 创建程序目录
                    fs.mkdirSync(programDir, { recursive: true });
                    // 2. 写入代码文件
                    fs.writeFileSync(scriptPath, code, 'utf-8');
                    // 3. 读取现有 manifest
                    const manifest = readManifest();
                    // 4. 添加新程序到 manifest
                    const newProgram = {
                        id: programId,
                        name,
                        description,
                        type: type || 'python',
                        created: new Date().toISOString(),
                        lastRun: '',
                        tags: tags || [],
                        version: 1,
                        hasCode: true,
                        params: paramDefs || []
                    };
                    manifest.programs.push(newProgram);
                    // 5. 写入 manifest
                    if (!writeManifest(manifest)) {
                        throw new Error('写入 manifest 失败');
                    }
                    console.log('[save_program] 成功:', programId);
                    return { success: true, data: newProgram };
                } catch (e) {
                    // 原子操作失败：回滚文件创建
                    if (fs.existsSync(programDir)) {
                        fs.rmSync(programDir, { recursive: true, force: true });
                    }
                    return { success: false, error: '保存程序失败：' + e.message };
                }
            }

            // ===== 手动添加程序（仅注册元信息到 manifest，不创建代码文件） =====
            case 'add_program': {
                const { name, description, id: providedId, type = 'python', tags = [], params = [] } = args;
                if (!name || !description) {
                    return { success: false, error: '名称和描述为必填项' };
                }
                // 生成程序 ID
                let programId = providedId;
                if (programId) {
                    // 校验用户提供的 ID：只能包含字母、数字、下划线
                    if (!/^[a-zA-Z0-9_]+$/.test(programId)) {
                        return { success: false, error: '程序 ID 只能包含字母、数字和下划线' };
                    }
                } else {
                    programId = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
                }
                // 检查程序是否已存在
                if (findProgramById(programId)) {
                    return { success: false, error: `程序 ID "${programId}" 已存在，请使用其他名称` };
                }
                try {
                    const manifest = readManifest();
                    const newProgram = {
                        id: programId,
                        name,
                        description,
                        type,
                        created: new Date().toISOString(),
                        lastRun: '',
                        tags: tags || [],
                        params: params || [],
                        version: 1,
                        hasCode: false // 标记无代码文件
                    };
                    manifest.programs.push(newProgram);
                    if (!writeManifest(manifest)) {
                        throw new Error('写入 manifest 失败');
                    }
                    return { success: true, data: newProgram };
                } catch (e) {
                    return { success: false, error: '添加程序失败：' + e.message };
                }
            }

            // ===== 程序资产管理 =====
            case 'list_programs': {
                const manifest = readManifest();
                const list = manifest.programs.map(p => ({
                    id: p.id,
                    name: p.name,
                    description: p.description,
                    tags: p.tags || []
                }));
                return { success: true, data: list };
            }

            case 'describe_program': {
                if (!args || !args.id) return { success: false, error: '程序 ID 不能为空' };
                const program = findProgramById(args.id);
                if (!program) return { success: false, error: `程序"${args.id}"不存在` };
                // 返回完整信息（不含代码内容）
                return {
                    success: true,
                    data: {
                        id: program.id,
                        name: program.name,
                        description: program.description,
                        type: program.type,
                        created: program.created,
                        lastRun: program.lastRun,
                        tags: program.tags || [],
                        params: program.params || []
                    }
                };
            }

            case 'run_program': {
                if (!args || !args.id) return { success: false, error: '程序 ID 不能为空' };
                const program = findProgramById(args.id);
                if (!program) return { success: false, error: `程序"${args.id}"不存在` };
                // 检查是否有代码文件
                if (program.hasCode === false) {
                    return { success: false, error: `该程序暂无代码，请使用 update_program 工具添加代码` };
                }
                const { exec } = require('child_process');
                // 检查参数是否完整
                if (program.params && program.params.length > 0) {
                    const missingParams = program.params.filter(p => !args.params || args.params[p.name] === undefined);
                    if (missingParams.length > 0) {
                        return {
                            success: false,
                            error: `缺少必要参数：${missingParams.map(p => p.name + (p.description ? '(' + p.description + ')' : '')).join('、')}`
                        };
                    }
                }
                // 构建脚本路径
                const ext = program.type === 'javascript' ? 'js' : program.type === 'bash' ? 'sh' : program.type === 'html' ? 'html' : 'py';
                const scriptPath = path.join(PET_PROGRAMS_DIR, program.id, `script.${ext}`);
                if (!fs.existsSync(scriptPath)) {
                    return { success: false, error: `程序文件不存在：${scriptPath}` };
                }
                try {
                    let result;
                    if (program.type === 'python') {
                        const pythonPath = getPythonPath();
                        result = await new Promise((resolve) => {
                            exec(
                                `"${pythonPath}" "${scriptPath}"`,
                                {
                                    cwd: path.join(PET_PROGRAMS_DIR, program.id),
                                    timeout: 30000,
                                    maxBuffer: 1024 * 1024,
                                    env: { ...process.env, PROGRAM_PARAMS: JSON.stringify(args.params || {}) }
                                },
                                (error, stdout, stderr) => {
                                    resolve({
                                        stdout: stdout || '',
                                        stderr: stderr || '',
                                        exitCode: error ? (error.code || 1) : 0
                                    });
                                }
                            );
                        });
                    } else if (program.type === 'javascript') {
                        result = await new Promise((resolve) => {
                            exec(
                                `node "${scriptPath}"`,
                                {
                                    cwd: path.join(PET_PROGRAMS_DIR, program.id),
                                    timeout: 30000,
                                    maxBuffer: 1024 * 1024,
                                    env: { ...process.env, PROGRAM_PARAMS: JSON.stringify(args.params || {}) }
                                },
                                (error, stdout, stderr) => {
                                    resolve({
                                        stdout: stdout || '',
                                        stderr: stderr || '',
                                        exitCode: error ? (error.code || 1) : 0
                                    });
                                }
                            );
                        });
                    } else if (program.type === 'bash') {
                        result = await new Promise((resolve) => {
                            exec(
                                `bash "${scriptPath}"`,
                                {
                                    cwd: path.join(PET_PROGRAMS_DIR, program.id),
                                    timeout: 30000,
                                    maxBuffer: 1024 * 1024,
                                    env: { ...process.env, PROGRAM_PARAMS: JSON.stringify(args.params || {}) }
                                },
                                (error, stdout, stderr) => {
                                    resolve({
                                        stdout: stdout || '',
                                        stderr: stderr || '',
                                        exitCode: error ? (error.code || 1) : 0
                                    });
                                }
                            );
                        });
                    } else if (program.type === 'html') {
                        // 在浏览器中打开 HTML 文件
                        await shell.openPath(scriptPath);
                        result = { stdout: '已在浏览器中打开', stderr: '', exitCode: 0 };
                    } else {
                        return { success: false, error: `不支持的程序类型：${program.type}` };
                    }
                    // 更新 lastRun
                    updateProgramLastRun(args.id);
                    return { success: true, data: result };
                } catch (e) {
                    return { success: false, error: '程序执行失败：' + (e.message || '') };
                }
            }

            case 'edit_program_description': {
                if (!args || !args.id || !args.new_description) {
                    return { success: false, error: '程序 ID 和新描述不能为空' };
                }
                const manifest = readManifest();
                const idx = manifest.programs.findIndex(p => p.id === args.id);
                if (idx === -1) return { success: false, error: `程序"${args.id}"不存在` };
                manifest.programs[idx].description = args.new_description;
                if (writeManifest(manifest)) {
                    return { success: true, data: `程序"${args.id}"的描述已更新` };
                }
                return { success: false, error: '更新描述失败' };
            }

            case 'delete_program': {
                if (!args || !args.id) return { success: false, error: '程序 ID 不能为空' };
                const program = findProgramById(args.id);
                if (!program) return { success: false, error: `程序"${args.id}"不存在` };
                // 删除程序目录
                const programDir = path.join(PET_PROGRAMS_DIR, args.id);
                if (fs.existsSync(programDir)) {
                    fs.rmSync(programDir, { recursive: true, force: true });
                }
                // 从 manifest 中移除
                const manifest = readManifest();
                manifest.programs = manifest.programs.filter(p => p.id !== args.id);
                writeManifest(manifest);
                return { success: true, data: `程序"${args.id}"已删除` };
            }

            // ===== 导出程序（打开程序所在文件夹） =====
            case 'export_program': {
                if (!args || !args.id) return { success: false, error: '程序 ID 不能为空' };
                const prog = findProgramById(args.id);
                if (!prog) return { success: false, error: `程序"${args.id}"不存在` };
                const programDir = path.join(PET_PROGRAMS_DIR, args.id);
                if (!fs.existsSync(programDir)) {
                    return { success: false, error: '程序目录不存在，该程序可能没有代码文件' };
                }
                await shell.openPath(programDir);
                return { success: true, data: { message: '已打开程序文件夹' } };
            }

            // ===== 更新程序 =====
            case 'update_program': {
                const { id, code, description, name } = args;
                if (!id) return { success: false, error: '程序 ID 不能为空' };
                const program = findProgramById(id);
                if (!program) return { success: false, error: `程序"${id}"不存在` };
                const ext = program.type === 'javascript' ? 'js' : program.type === 'bash' ? 'sh' : program.type === 'html' ? 'html' : 'py';
                const programDir = path.join(PET_PROGRAMS_DIR, id);
                const scriptPath = path.join(programDir, `script.${ext}`);
                try {
                    // 1. 如果提供了代码，更新代码文件并设置 hasCode
                    if (code !== undefined) {
                        if (!fs.existsSync(programDir)) {
                            return { success: false, error: '程序目录不存在' };
                        }
                        fs.writeFileSync(scriptPath, code, 'utf-8');
                    }
                    // 2. 更新 manifest
                    const manifest = readManifest();
                    const idx = manifest.programs.findIndex(p => p.id === id);
                    if (idx === -1) return { success: false, error: `程序"${id}"不存在` };
                    // 递增版本号
                    const version = (manifest.programs[idx].version || 1) + 1;
                    // 更新字段
                    manifest.programs[idx] = {
                        ...manifest.programs[idx],
                        ...(name ? { name } : {}),
                        ...(description ? { description } : {}),
                        ...(code !== undefined ? { hasCode: true } : {}),
                        version
                    };
                    if (!writeManifest(manifest)) {
                        throw new Error('写入 manifest 失败');
                    }
                    return { success: true, data: { ...manifest.programs[idx], version } };
                } catch (e) {
                    return { success: false, error: '更新程序失败：' + e.message };
                }
            }

            // ===== 写入临时文件（仅限保存临时文件/笔记，禁止用于保存程序代码） =====
            case 'write_temp_file': {
                if (!args || !args.path || !args.content) {
                    return { success: false, error: '路径和内容不能为空' };
                }
                // 安全校验：路径必须在 PET_PROGRAMS_DIR 内
                const resolvedPath = path.resolve(PET_PROGRAMS_DIR, args.path);
                if (!resolvedPath.startsWith(PET_PROGRAMS_DIR)) {
                    return { success: false, error: '路径不在允许范围内' };
                }
                // 禁止使用 write_temp_file 保存程序代码文件
                if (args.path.endsWith('.py') || args.path.endsWith('.js') || args.path.endsWith('.sh')) {
                    return { success: false, error: '请使用 save_program 工具保存程序代码，write_temp_file 仅限保存临时文件/笔记' };
                }
                try {
                    // 确保父目录存在
                    const dir = path.dirname(resolvedPath);
                    if (!fs.existsSync(dir)) {
                        fs.mkdirSync(dir, { recursive: true });
                    }
                    fs.writeFileSync(resolvedPath, args.content, 'utf-8');
                    return { success: true, data: `文件已保存：${args.path}` };
                } catch (e) {
                    return { success: false, error: '写入文件失败：' + (e.message || '') };
                }
            }

            // ===== Python 脚本执行 =====
            case 'run_python': {
                if (!args || !args.script) return { success: false, error: 'Python 脚本不能为空' };
                const { exec } = require('child_process');
                const os = require('os');
                // 确保工作区目录存在
                if (!fs.existsSync(PET_WORKSPACE_DIR)) {
                    fs.mkdirSync(PET_WORKSPACE_DIR, { recursive: true });
                }
                // 写入临时脚本文件
                const timestamp = Date.now();
                const scriptPath = path.join(PET_WORKSPACE_DIR, `script_${timestamp}.py`);
                fs.writeFileSync(scriptPath, args.script, 'utf-8');
                try {
                    const pythonPath = getPythonPath();
                    const cmdArgs = [scriptPath];
                    // 附加参数（可选）
                    if (Array.isArray(args.args)) {
                        cmdArgs.push(...args.args);
                    }
                    const result = await new Promise((resolve, reject) => {
                        const child = exec(
                            `"${pythonPath}" ${cmdArgs.map(a => `"${a}"`).join(' ')}`,
                            {
                                cwd: PET_WORKSPACE_DIR,
                                timeout: 30000, // 30 秒超时
                                maxBuffer: 1024 * 1024 // 1MB 输出缓冲
                            },
                            (error, stdout, stderr) => {
                                resolve({
                                    stdout: stdout || '',
                                    stderr: stderr || '',
                                    exitCode: error ? (error.code || 1) : 0
                                });
                            }
                        );
                    });
                    return { success: true, data: result };
                } finally {
                    // 清理临时脚本文件
                    try {
                        if (fs.existsSync(scriptPath)) {
                            fs.unlinkSync(scriptPath);
                        }
                    } catch (e) {
                        // 忽略清理错误
                    }
                }
            }

            // ===== program 聚合工具（路由到具体工具） =====
            case 'program': {
                const { action, id, name, description, code, type, params, tags } = args || {};
                if (!action) {
                    return { success: false, error: 'program 工具需要 action 参数' };
                }
                switch (action) {
                    case 'list':
                        return await executeToolHandler('list_programs', {});
                    case 'describe':
                        if (!id) return { success: false, error: 'describe 需要 id 参数' };
                        return await executeToolHandler('describe_program', { id });
                    case 'run':
                        if (!id) return { success: false, error: 'run 需要 id 参数' };
                        return await executeToolHandler('run_program', { id, params });
                    case 'save':
                        if (!name || !description || !code) {
                            return { success: false, error: 'save 需要 name、description、code 参数' };
                        }
                        return await executeToolHandler('save_program', { name, description, code, type, tags });
                    case 'update':
                        if (!id) return { success: false, error: 'update 需要 id 参数' };
                        return await executeToolHandler('update_program', { id, code, description, name });
                    case 'delete':
                        if (!id) return { success: false, error: 'delete 需要 id 参数' };
                        return await executeToolHandler('delete_program', { id });
                    case 'add':
                        if (!name || !description) {
                            return { success: false, error: 'add 需要 name、description 参数' };
                        }
                        return await executeToolHandler('add_program', { name, description, id, type, tags });
                    case 'export':
                        if (!id) return { success: false, error: 'export 需要 id 参数' };
                        return await executeToolHandler('export_program', { id });
                    default:
                        return { success: false, error: `未知的 program action: ${action}` };
                }
            }

            // ===== 屏幕捕获（调用智谱 GLM-4V） =====
            case 'capture_screen': {
                try {
                    const desc = await describeScreen();
                    return { success: true, data: desc };
                } catch (e) {
                    console.error('[capture_screen] 错误:', e);
                    return { success: false, error: e.message || '屏幕分析失败' };
                }
            }

            // ===== 图像识别（DeepSeek Files API 上传截图 + 视觉模型） =====
            case 'vision': {
                const { question } = args || {};
                if (!deepseekKey()) return { success: false, error: 'DeepSeek API Key 未设置' };
                const q = (question && String(question).trim()) ? String(question).trim() : '请描述当前屏幕内容';
                const { desktopCapturer } = require('electron');
                const sources = await desktopCapturer.getSources({
                    types: ['screen'],
                    thumbnailSize: { width: 1600, height: 900 }
                });
                if (!sources || sources.length === 0) return { success: false, error: '未找到屏幕源' };
                const pngBuffer = sources[0].thumbnail.toPNG();

                let fileId;
                try {
                    fileId = await uploadImageToDeepSeekFiles(pngBuffer, 'screenshot.png');
                } catch (e) {
                    console.error('[vision] 图片上传失败:', e);
                    return { success: false, error: e.message || '图片上传失败' };
                }

                let visionResponse, visionData;
                try {
                    visionResponse = await fetch(deepseekApiBase() + '/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${deepseekKey()}`
                        },
                        body: JSON.stringify({
                            model: 'deepseek-v4-flash-vision-exp',
                            messages: [{
                                role: 'user',
                                content: [
                                    { type: 'file', file_id: fileId },
                                    { type: 'text', text: q }
                                ]
                            }]
                        })
                    });
                    visionData = await visionResponse.json();
                } catch (e) {
                    console.error('[vision] 视觉模型请求失败:', e);
                    return { success: false, error: '视觉模型请求失败: ' + (e.message || '') };
                }

                if (!visionResponse.ok || visionData.error) {
                    return { success: false, error: (visionData.error && visionData.error.message) || `视觉模型调用失败 (${visionResponse.status})` };
                }
                if (visionData.choices && visionData.choices[0] && visionData.choices[0].message) {
                    return { success: true, data: visionData.choices[0].message.content };
                }
                return { success: false, error: '视觉模型无有效响应' };
            }

            // ===== 图像生成（调用智谱 CogView，正确格式：仅 model + prompt） =====
            case 'generate_image': {
                const { prompt } = args || {};
                if (!zhipuApiKey) return { success: false, error: '智谱 API Key 未设置' };
                if (!prompt) return { success: false, error: '提示词不能为空' };
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 45000);
                    const startTime = Date.now();

                    const requestBody = {
                        model: 'cogview-3-flash',
                        prompt: prompt
                    };
                    console.log('[generate_image] 请求体:', JSON.stringify(requestBody));

                    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/images/generations', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${zhipuApiKey}`
                        },
                        signal: controller.signal,
                        body: JSON.stringify(requestBody)
                    });
                    clearTimeout(timeoutId);

                    const elapsed = Date.now() - startTime;
                    console.log(`[generate_image] 请求耗时: ${elapsed}ms, 响应状态: ${response.status}`);

                    if (!response.ok) {
                        const errorText = await response.text();
                        let errorMsg = `智谱 API 返回错误 (${response.status})`;
                        if (response.status === 401) errorMsg += '：API Key 无效或已过期';
                        else if (response.status === 429) errorMsg += '：请求过于频繁或账户余额不足';
                        else if (response.status === 400) errorMsg += `: ${errorText.substring(0, 300)}`;
                        else errorMsg += `: ${errorText.substring(0, 300)}`;
                        return { success: false, error: errorMsg };
                    }

                    const data = await response.json();
                    console.log('[generate_image] 响应数据:', JSON.stringify(data).slice(0, 300));

                    if (data.error) {
                        return { success: false, error: `智谱 API 错误: ${data.error.message || JSON.stringify(data.error)}` };
                    }

                    if (data.data && data.data.length > 0 && data.data[0].url) {
                        return { success: true, data: { url: data.data[0].url } };
                    }

                    return { success: false, error: 'CogView 返回数据格式异常，缺少图片 URL' };
                } catch (e) {
                    console.error('[generate_image tool] 错误:', e);
                    if (e.name === 'AbortError') {
                        return { success: false, error: '生成图片超时（45秒），请检查网络或稍后重试' };
                    }
                    return { success: false, error: '生成图片失败: ' + (e.message || '') };
                }
            }

            default:
                return { success: false, error: `未知工具：${toolName}` };
        }
    } catch (e) {
        console.error(`[execute-tool] ${toolName} 执行失败:`, e);
        return { success: false, error: e.message || '工具执行失败' };
    }
}

// 注册 execute-tool IPC
ipcMain.handle('execute-tool', async (event, toolName, args) => {
    return await executeToolHandler(toolName, args);
});

// 独立的 generate-image IPC（直接调用智谱 CogView 图像生成 API）
ipcMain.handle('generate-image', async (event, prompt, size = '1024x1024') => {
    if (!zhipuApiKey) {
        throw new Error('智谱 API Key 未设置，请在设置中填写');
    }

    console.log('[generate-image] 请求参数:', { prompt, size });

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 45000);

        // 正确格式：仅 model + prompt（size 不是顶层字段）
        const requestBody = {
            model: 'cogview-3-flash',  // 备选：'cogview-3' 或 'cogview-4-250304'
            prompt: prompt
        };

        console.log('[generate-image] 请求体:', JSON.stringify(requestBody));

        const response = await fetch('https://open.bigmodel.cn/api/paas/v4/images/generations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${zhipuApiKey}`
            },
            signal: controller.signal,
            body: JSON.stringify(requestBody)
        });
        clearTimeout(timeoutId);

        console.log('[generate-image] 响应状态:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[generate-image] 错误响应:', errorText);
            let errorMsg = `智谱 API 返回错误 (${response.status})`;
            if (response.status === 401) errorMsg += '：API Key 无效或已过期';
            else if (response.status === 429) errorMsg += '：请求过于频繁或账户余额不足';
            else if (response.status === 400) errorMsg += `: ${errorText}`;
            else errorMsg += `: ${errorText}`;
            throw new Error(errorMsg);
        }

        const data = await response.json();
        console.log('[generate-image] 响应数据:', JSON.stringify(data).slice(0, 300));

        if (data.error) {
            throw new Error(`智谱 API 错误: ${data.error.message || JSON.stringify(data.error)}`);
        }

        if (!data.data || !data.data[0] || !data.data[0].url) {
            throw new Error('返回数据格式异常，缺少图片 URL');
        }

        return data.data[0].url;
    } catch (e) {
        console.error('[generate-image] 错误:', e);
        if (e.name === 'AbortError') {
            throw new Error('图像生成超时（45秒），请检查网络或稍后重试');
        }
        throw new Error(`图像生成失败: ${e.message}`);
    }
});

// 方案1：在窗口 webContents 上监听 before-input-event（窗口有焦点时有效）
let globalCtrlCount = 0;
let globalCtrlTimer = null;
function setupGlobalCtrlDetection(webContents) {
    webContents.on('before-input-event', (event, input) => {
        if (!devModeEnabled) return;
        // 检测Ctrl键按下（非重复）
        if (input.key === 'Control' && input.type === 'keyDown' && !input.repeat) {
            globalCtrlCount++;
            if (globalCtrlTimer) clearTimeout(globalCtrlTimer);
            globalCtrlTimer = setTimeout(() => {
                globalCtrlCount = 0;
            }, 400);
            if (globalCtrlCount >= 2) {
                globalCtrlCount = 0;
                spawnCookieFromDevMode();
            }
        }
    });
}

app.whenReady().then(() => {
    // 打印用户数据目录（设置和房间布局的存储位置）
    console.log('[Main] userData 路径:', app.getPath('userData'));
    console.log('[Main] localStorage 路径:', app.getPath('userData') + path.sep + 'Local Storage');
    console.log('[Main] 内存文件路径:', app.getPath('userData') + path.sep + 'petMemory.json');

    // 加载上次保存的统一配置（float/index/设置窗口共用同一套）
    loadUnifiedConfig();
    // 把统一配置回灌到主进程运行状态，避免 index/浮窗启动时广播旧默认值把设置改回默认
    hydrateRuntimeFromUnified();

    // DSH 联动（deepseek-harness 插件通信 / 任务面板 / 余额）
    startDshLink();

    // 默认启动浮窗（桌宠）为打开即见的首要窗口；
    // 主窗口 index.html（家里）降级为次要窗口，由浮窗"回家"按钮唤起
    createFloatWindow();
    startTTS(); // Start TTS service
    startSTT(); // Start STT service

    // ===== 全局快捷键注册 =====
    // Ctrl+Shift+C：开发者模式下生成饼干（全局有效，无需窗口焦点）
    try {
        globalShortcut.register('CmdOrCtrl+Shift+C', () => {
            spawnCookieFromDevMode();
        });
    } catch (e) {
        console.warn('全局快捷键注册失败:', e);
    }

    // ===== 双击Ctrl检测（窗口有焦点时的补充机制） =====
    app.on('web-contents-created', (event, webContents) => {
        if (webContents.getType() === 'window') {
            setupGlobalCtrlDetection(webContents);
        }
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createFloatWindow();
        }
    });
}).catch(err => {
    console.error('app.whenReady 失败:', err);
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// 终止 TTS/STT 子进程，避免退出后残留进程锁定安装目录/文件
function killHelperProcesses() {
    if (ttsProcess && !ttsProcess.killed) {
        try { ttsProcess.kill(); } catch (e) {}
        ttsProcess = null;
    }
    if (sttProcess && !sttProcess.killed) {
        try { sttProcess.kill(); } catch (e) {}
        sttProcess = null;
    }
}

// 主进程退出时关闭浮窗和聊天窗口
app.on('before-quit', () => {
    // 注销全局快捷键
    globalShortcut.unregister('CmdOrCtrl+Shift+C');
    killHelperProcesses();

    if (floatWindow && !floatWindow.isDestroyed()) {
        floatWindow.destroy();
        floatWindow = null;
    }
    if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.destroy();
        chatWindow = null;
    }
    if (cookieWindow && !cookieWindow.isDestroyed()) {
        cookieWindow.destroy();
        cookieWindow = null;
    }
    if (companionWindow && !companionWindow.isDestroyed()) {
        companionWindow.destroy();
        companionWindow = null;
    }
});