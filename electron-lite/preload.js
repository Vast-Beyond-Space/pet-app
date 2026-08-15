const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lite', {
    // 窗口
    move: (x, y) => ipcRenderer.send('win-move', x, y),
    moveBy: (dx, dy) => ipcRenderer.send('win-move-by', dx, dy),
    resize: (w, h) => ipcRenderer.send('win-resize', w, h),
    quit: () => ipcRenderer.send('win-quit'),
    // 自启动
    setLoginItem: (enabled) => ipcRenderer.send('set-login-item', enabled),
    // 记忆（与原版共享）
    memoryLoad: () => ipcRenderer.invoke('memory-load'),
    memorySave: (items) => ipcRenderer.invoke('memory-save', items),
    onMemoryUpdated: (cb) => ipcRenderer.on('memory-updated', (e, items) => cb(items)),
    // 配置同步
    setZhipuKey: (k) => ipcRenderer.send('set-zhipu-key', k),
    setMultimodal: (v) => ipcRenderer.send('set-multimodal', v),
    setCookieEnabled: (v) => ipcRenderer.send('set-cookie-enabled', v),
    setDeepseekEnabled: (v) => ipcRenderer.send('set-deepseek-enabled', v),
    setDeepseekKey: (k) => ipcRenderer.send('set-deepseek-key', k),
    setMoveMode: (m) => ipcRenderer.send('set-move-mode', m),
    setBottomGap: (g) => ipcRenderer.send('set-bottom-gap', g),
    onConfigUpdated: (cb) => ipcRenderer.on('config-updated', (e, d) => cb(d)),
    // TTS
    speakText: (text, voice) => ipcRenderer.invoke('speak-text', text, voice),
    getTtsVoices: () => ipcRenderer.invoke('get-tts-voices'),
    listStickerPacks: () => ipcRenderer.invoke('list-sticker-packs'),
    // AI
    aiChat: (params) => ipcRenderer.invoke('ai-chat', params),
    deepseekChat: (params) => ipcRenderer.invoke('deepseek-chat', params),
    captureScreen: (recent) => ipcRenderer.invoke('capture-screen', recent),
    // 饼干
    eatCookie: () => ipcRenderer.send('eat-cookie'),
    requestCookie: () => ipcRenderer.send('request-cookie'),
    cookieDragStart: (sx, sy) => ipcRenderer.send('cookie-drag-start', sx, sy),
    cookieDragEnd: () => ipcRenderer.send('cookie-drag-end'),
    deleteCookie: () => ipcRenderer.send('cookie-delete'),
    onCookiePositionUpdate: (cb) => ipcRenderer.on('cookie-position', (e, pos) => cb(pos)),
    onCookieConsumed: (cb) => ipcRenderer.on('cookie-consumed', (e) => cb())
});