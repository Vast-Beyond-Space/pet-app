const { contextBridge, ipcRenderer } = require('electron');

// 主窗口的 preload
contextBridge.exposeInMainWorld('electronAPI', {
    // 开机自启动（设置面板"开机自启"开关）
    setLoginItem: (enabled) => ipcRenderer.send('set-login-item', enabled),

    // 浮窗"回家"按钮：唤起主窗口 index.html（次要窗口）
    showIndexWindow: () => ipcRenderer.send('show-index-window'),

    // 打开设置面板（独立窗口，加载 float.html?mode=settings）
    openSettings: () => ipcRenderer.send('float-open-settings'),

    // 关闭设置面板
    closeSettings: () => ipcRenderer.send('settings-close'),

    // 退出整个应用（设置面板"退出应用"按钮）
    quitApp: () => ipcRenderer.send('app-quit'),

    // 打开聊天对话框
    openChatDialog: () => ipcRenderer.send('open-chat-dialog'),

    // 更新浮窗消息
    updateFloatMessage: (message) => ipcRenderer.send('update-float-message', message),

    // 移动浮窗窗口
    moveFloatWindow: (x, y) => ipcRenderer.send('move-float-window', x, y),

    // 设置浮窗桌宠大小
    setFloatPetSize: (size) => ipcRenderer.send('set-float-pet-size', size),

    // 窗口控制
    minimizeWindow: () => ipcRenderer.send('window-minimize'),
    maximizeWindow: () => ipcRenderer.send('window-maximize'),
    closeWindow: () => ipcRenderer.send('window-close'),

    // 调整主窗口尺寸（恢复时使用，避免再次触发自动最小化）
    setWindowSize: (w, h) => ipcRenderer.send('window-set-size', w, h),

    // 监听主窗口尺寸变化（用于触发聚焦模式/自动最小化）
    onMainWindowResize: (callback) => ipcRenderer.on('main-window-resize', (event, info) => callback(info)),

    // 获取指定坐标所在显示器的工作区（多屏适配）
    getWorkAreaAtPoint: (x, y) => ipcRenderer.invoke('get-work-area-at-point', x, y),

    // 获取可见非全屏窗口边界（用于碰撞检测）
    getWindowBounds: () => ipcRenderer.invoke('get-window-bounds'),

    // 调整浮窗窗口尺寸
    resizeFloatWindow: (w, h) => ipcRenderer.send('resize-float-window', w, h),

    // 设置浮窗移动模式
    setFloatMoveMode: (mode) => ipcRenderer.send('set-float-move-mode', mode),

    // 设置浮窗是否碰撞窗口
    setFloatBounceWindows: (enabled) => ipcRenderer.send('set-float-bounce-windows', enabled),

    // 设置小窗口聊天时是否显示立绘
    setFloatShowIllust: (enabled) => ipcRenderer.send('set-float-show-illust', enabled),

    // 获取记忆内容（转发到主窗口）
    getMemoryItems: () => ipcRenderer.invoke('get-memory-items'),

    // 触发记忆总结
    triggerMemorySummary: () => ipcRenderer.send('trigger-memory-summary'),

    // 保存单条记忆（转发到主窗口统一处理）
    saveMemoryItem: (text) => ipcRenderer.invoke('save-memory-item', text),

    // 从文件加载记忆（直接读取 petMemory.json）
    memoryLoad: () => ipcRenderer.invoke('memory-load'),

    // 保存记忆到文件（直接写入 petMemory.json）
    memorySave: (items) => ipcRenderer.invoke('memory-save', items),

    // 监听记忆更新
    onMemoryUpdated: (callback) => ipcRenderer.on('memory-updated', (event, items) => callback(items)),

    // 浮窗切换到对话模式
    floatEnterChatMode: () => ipcRenderer.send('float-enter-chat-mode'),

    // 浮窗切换到桌宠模式
    floatExitChatMode: () => ipcRenderer.send('float-exit-chat-mode'),

    // 浮窗把聊天历史发送给主窗口（用于恢复主窗口聊天界面时继承对话）
    syncChatHistory: (history) => ipcRenderer.send('sync-chat-history', history),

    // 同步浮窗大小到主窗口设置（已废弃：该回传 IPC 会与 config-updated 广播形成回声循环，
    // 浮窗大小现统一由主进程 config-sync 兜底同步并下发，此通道不再提供）

    // 设置面板「▶ 状态预览」：让桌宠立即进入该状态并播放其特效
    previewFloatState: (state) => ipcRenderer.send('float-preview-state', state),

    // 拖出房子后最小化主窗口 + 浮窗跟随鼠标
    minimizeAndMoveFloat: (x, y) => ipcRenderer.send('minimize-and-move-float', x, y),

    // 监听显示聊天面板
    onShowChatPanel: (callback) => ipcRenderer.on('show-chat-panel', callback),

    // 监听浮窗消息更新
    onFloatMessage: (callback) => ipcRenderer.on('float-message', (event, message) => callback(message)),

    // 监听浮窗桌宠大小更新
    onFloatPetSize: (callback) => ipcRenderer.on('float-pet-size', (event, size) => callback(size)),

    // 监听浮窗移动模式更新
    onFloatMoveMode: (callback) => ipcRenderer.on('float-move-mode', (event, mode) => callback(mode)),

    // 监听浮窗碰撞窗口开关更新
    onFloatBounceWindows: (callback) => ipcRenderer.on('float-bounce-windows', (event, enabled) => callback(enabled)),

    // 监听小窗口聊天时是否显示立绘
    onFloatShowIllust: (callback) => ipcRenderer.on('float-show-illust', (event, enabled) => callback(enabled)),

    // 监听浮窗进入对话模式
    onFloatEnterChatMode: (callback) => ipcRenderer.on('float-enter-chat-mode', callback),

    // 监听浮窗退出对话模式
    onFloatExitChatMode: (callback) => ipcRenderer.on('float-exit-chat-mode', callback),

    // 监听主进程请求同步聊天历史
    onRequestSyncChatHistory: (callback) => ipcRenderer.on('request-sync-chat-history', callback),

    // 监听窗口最小化事件
    onWindowMinimized: (callback) => ipcRenderer.on('window-minimized', () => callback()),

    // 监听窗口恢复事件
    onWindowRestored: (callback) => ipcRenderer.on('window-restored', callback),

    // 监听完整运行状态同步（主进程权威状态）
    onPetRuntimeState: (callback) => ipcRenderer.on('pet-runtime-state', (event, state) => callback(state)),

    // 监听浮窗准备关闭通知
    onFloatPrepareClose: (callback) => ipcRenderer.on('float-prepare-close', (event, payload) => callback(payload)),

    // 监听同步浮窗大小（已废弃：同步-float-size 频道随 sync-float-size-to-settings 一并移除，
    // 大小经 config-updated 广播由 applyConfig 刷新滑杆）

    // 移除监听器
    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),

    // 通用发送 IPC 消息
    send: (channel, ...args) => ipcRenderer.send(channel, ...args),

    // 通用监听 IPC 消息
    on: (channel, callback) => ipcRenderer.on(channel, callback),

    // ===== 饼干窗口相关 =====
    // 获取饼干窗口位置
    getCookieWindowPos: () => ipcRenderer.sendSync('get-cookie-window-pos'),

    // 设置饼干窗口位置
    setCookieWindowPos: (x, y) => ipcRenderer.send('set-cookie-window-pos', x, y),

    // 发送饼干位置到主进程（用于转发给float窗口）
    sendCookiePosition: (x, y) => ipcRenderer.send('cookie-position-update', x, y),

    // 通知主进程饼干拖拽超时
    notifyCookieDragTimeout: () => ipcRenderer.send('cookie-drag-timeout'),

    // 通知主进程饼干被吃掉
    notifyCookieEaten: () => ipcRenderer.send('cookie-eaten'),

    // 监听饼干配置（移动模式、地面位置）
    onCookieConfig: (callback) => ipcRenderer.on('cookie-config', (event, config) => callback(config)),

    // 监听桌宠位置（饼干窗口获取地面位置）
    onPetPosition: (callback) => ipcRenderer.on('pet-position-update', (event, pos) => callback(pos)),

    // 监听吃饼干指令
    onEatCookie: (callback) => ipcRenderer.on('eat-cookie', () => callback()),

    // 监听饼干窗口关闭指令
    onCookieClose: (callback) => ipcRenderer.on('close-cookie-window', () => callback()),

    // ===== Float窗口获取饼干信息 =====
    // 获取饼干窗口位置（float窗口调用）
    getCookiePosition: () => ipcRenderer.invoke('get-cookie-position'),

    // 监听饼干位置更新（float窗口监听）
    onCookiePositionUpdate: (callback) => ipcRenderer.on('cookie-position-update', (event, pos) => callback(pos)),

    // 通知主进程吃掉饼干（float窗口调用）
    requestEatCookie: () => ipcRenderer.send('request-eat-cookie'),

    // 通知主进程需要生成饼干（带初始位置）
    requestSpawnCookie: (x, y) => ipcRenderer.send('request-spawn-cookie', x, y),

    // 获取移动模式
    getMoveMode: () => ipcRenderer.invoke('get-move-mode'),

    // Float窗口上报地面位置
    sendFloatGroundPosition: (groundY) => ipcRenderer.send('float-ground-position', groundY),

    // Float窗口请求关闭饼干
    requestCloseCookie: () => ipcRenderer.send('close-cookie-window'),

    // 设置是否生成饼干
    setCookieSpawnEnabled: (enabled) => ipcRenderer.send('set-cookie-spawn-enabled', enabled),

    // 监听饼干生成开关更新
    onCookieSpawnEnabled: (callback) => ipcRenderer.on('cookie-spawn-enabled', (event, enabled) => callback(enabled)),

    // 设置饼干大小（主窗口 -> 主进程）
    setCookieSize: (size) => ipcRenderer.send('set-cookie-size', size),

    // 监听饼干大小更新（主进程 -> 主窗口）
    onCookieSizeUpdated: (callback) => ipcRenderer.on('cookie-size-updated', (event, size) => callback(size)),

    // 同步饼干大小（主窗口 -> 主进程）
    syncCookieSizeToSettings: (size) => ipcRenderer.send('sync-cookie-size-to-settings', size),

    // 饼干窗口调整自身大小
    setCookieSizeWindow: (size) => ipcRenderer.send('cookie-resize-self', size),

    // 设置主窗口透明度（0~1）
    setWindowOpacity: (opacity) => ipcRenderer.send('set-window-opacity', opacity),

    // ===== Agent 工具系统 =====
    // 执行系统/信息工具（invoke 返回 Promise）
    executeTool: (toolName, args) => ipcRenderer.invoke('execute-tool', toolName, args),

    // ===== 多模态（智谱 AI）=====
    captureScreen: (recentMessages) => ipcRenderer.invoke('capture-screen', recentMessages),
    // 截屏上传 Files API 并缓存，供对话嵌入 file_id 与图像记忆
    uploadScreenshot: () => ipcRenderer.invoke('multimodal-upload-screenshot'),
    // 手动添加图片记忆：选择本地图片 -> 上传 Files API -> 本地缓存
    uploadMemoryImage: () => ipcRenderer.invoke('multimodal-upload-memory-image'),
    deleteDeepSeekFile: (fileId) => ipcRenderer.invoke('multimodal-delete-file', fileId),
    listDeepSeekFiles: () => ipcRenderer.invoke('multimodal-list-files'),
    deleteScreenshotCache: (imagePath) => ipcRenderer.invoke('multimodal-delete-cache', imagePath),
    generateImage: (prompt, size) => ipcRenderer.invoke('generate-image', prompt, size),
    saveChatLog: (content) => ipcRenderer.invoke('save-chat-log', content),
    saveImageFromUrl: (url) => ipcRenderer.invoke('save-image-from-url', url),
    setZhipuKey: (key) => ipcRenderer.send('set-zhipu-key', key),
    setMultimodalEnabled: (enabled) => ipcRenderer.send('set-multimodal-enabled', enabled),
    setCostSaving: (enabled) => ipcRenderer.send('set-cost-saving', enabled),
    // 获取统一配置（float/index/设置窗口共用的权威配置）
    getConfig: () => ipcRenderer.invoke('config-get'),
    // 转发渲染进程日志到主进程 stdout（tag 用于区分来源窗口）
    logToMain: (level, message) => ipcRenderer.send('renderer-log', { level, message }),

    // 同步完整配置到主进程（改动后全量推送，主进程广播给其它窗口）
    syncConfig: (config) => ipcRenderer.send('config-sync', config),

    // 监听配置更新
    onConfigUpdated: (callback) => ipcRenderer.on('config-updated', (event, data) => callback(data)),

    // 监听家里(主窗口)专属设置更新（统一设置窗口改动时触发）
    onHomeSettingsUpdated: (callback) => ipcRenderer.on('home-settings-updated', (event, data) => callback(data)),

    // ===== 陪伴模式 =====
    enterCompanionMode: () => ipcRenderer.send('enter-companion-mode'),
    exitCompanionMode: (target) => ipcRenderer.send('exit-companion-mode', target),
    moveCompanionWindow: (x, y) => ipcRenderer.send('move-companion-window', x, y),
    getWindowPos: () => ipcRenderer.sendSync('get-companion-window-pos'),
    onCompanionUserMessage: (callback) => ipcRenderer.on('companion-user-message', (event, text) => callback(text)),
    onCompanionModeStarted: (callback) => ipcRenderer.on('companion-mode-started', callback),
    onCompanionModeEnded: (callback) => ipcRenderer.on('companion-mode-ended', callback),

    // ===== TTS =====
    speakText: (text, voice) => ipcRenderer.invoke('speak-text', text, voice),
    getTtsVoices: () => ipcRenderer.invoke('get-tts-voices'),

    // ===== STT streaming (companion mode) =====
    sttStreamInit: () => ipcRenderer.invoke('stt-stream-init'),
    sttStreamAudio: (base64Data, isLast) => ipcRenderer.send('stt-stream-audio', base64Data, isLast),
    sttStreamReset: () => ipcRenderer.send('stt-stream-reset'),
    sttStreamEnd: () => ipcRenderer.send('stt-stream-end'),
    onSTTReady: (callback) => ipcRenderer.on('stt-ready', () => callback()),
    onSTTResult: (callback) => ipcRenderer.on('stt-result', (event, text) => callback(text)),
    onSTTEnded: (callback) => ipcRenderer.on('stt-ended', () => callback()),

    // ===== AI request proxy (main process, resolves SSL issues) =====
    aiChatRequest: (params) => ipcRenderer.invoke('ai-chat-request', params),

    // 测试 API 连接（设置面板"测试 API"按钮）：验证地址、Key 与模型可用性
    testApi: (params) => ipcRenderer.invoke('ai-test-api', params),

    // ===== 贴图包管理 =====
    listStickerPacks: () => ipcRenderer.invoke('list-sticker-packs'),
    setStickerPack: (packName) => ipcRenderer.send('set-sticker-pack', packName),
    // 打开 img 文件夹（添加贴图包）
    openStickerFolder: () => ipcRenderer.send('open-img-folder'),
    // 扫描当前贴图包内 mood_*/浮窗_* 贴图（模块化提示词 & 新状态）
    getPackAssets: () => ipcRenderer.invoke('get-pack-assets'),

    // ===== DSH 联动（deepseek-harness dsh-pet-link 插件）=====
    // 获取聚合状态（agent 状态 / todolist / 输出 / usage / 余额）
    dshGetStatus: () => ipcRenderer.invoke('dsh-get-status'),
    // 向 DSH 派发任务（由 dsh-pet-link 插件接收并交给 agent 执行）
    dshSendTask: (message, opts) => ipcRenderer.invoke('dsh-send-task', message, opts),
    // 取消 DSH 当前任务
    dshCancelTask: () => ipcRenderer.invoke('dsh-cancel-task'),
    // ask_user 工具：把浮窗弹窗的用户选择回传给插件
    dshAskRespond: (answer, index, canceled) => ipcRenderer.send('dsh-ask-respond', answer, index, canceled),
    // 系统统计 + DeepSeek 峰谷时段（贴图下方信息条）
    getSystemStats: () => ipcRenderer.invoke('get-system-stats'),
    // 设置插件端口（设置面板）
    dshSetPluginPort: (port) => ipcRenderer.send('dsh-set-plugin-port', port),
    dshSetEnabled: (enabled) => ipcRenderer.send('dsh-set-enabled', enabled),
    // 点击贴图下方信息条：唤起 / 启动 DSH（主进程决定聚焦已有窗口或新开终端）
    dshLaunch: () => ipcRenderer.send('dsh-launch'),
    // 设置面板「模拟推送」：让插件模拟向桌宠推送一轮状态（验证通信链路与环节贴图覆盖）
    dshTestState: (opts) => ipcRenderer.invoke('dsh-test-state', opts),
    // 接收插件推送（说话 / 切贴图 / todolist / 输出）
    onDshMessage: (callback) => ipcRenderer.on('dsh-message', (event, payload) => callback(payload)),
});