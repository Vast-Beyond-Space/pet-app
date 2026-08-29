# 桌宠小屋 (Desktop Pet App)

基于 Electron 的桌面宠物应用，集成了 AI 聊天、语音交互、屏幕感知、桌面游荡和记忆系统等功能。

> **当前版本：1.0.0-Preview**

## 目录

- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [架构概览](#架构概览)
- [窗口体系](#窗口体系)
- [功能模块](#功能模块)
- [IPC 通信](#ipc-通信)
- [AI 系统](#ai-系统)
- [语音系统](#语音系统)
- [Agent 工具系统](#agent-工具系统)
- [记忆系统](#记忆系统)
- [配置项](#配置项)
- [技术栈](#技术栈)
- [运行要求](#运行要求)
- [打包发布](#打包发布)
- [开发说明](#开发说明)
- [浮窗物理与渲染对位（踩坑记录）](#浮窗物理与渲染对位踩坑记录)

## 快速开始

> 从 GitHub 克隆后，体积较大的二进制资源（嵌入式 Python 运行时 zip、STT 模型 zip）
> **不随源码分发**。以下命令在**联网**状态下会自动检测本机工具链并下载缺失资源。

```bash
# 1. 一键安装依赖
#    自动完成：检测 node/npm/git → 下载 python 运行时 zip（若缺失）→ 解压嵌入式 Python
#    → 引导 pip（用内置 ensurepip / get-pip.py）→ 安装 TTS/STT 依赖(edge-tts/vosk) → 解压 STT 模型
npm install

# 2. 开发运行
npm start

# 3. 一键打包 Windows 安装包（输出到 dist/，也会兜底下载并安装依赖）
npm run build

# 其他打包命令
npm run dist    # 同 build，仅打包
npm run rebuild # 先清空 dist 再打包
```

工具链要求（`npm install` 时会自动检测）：**Node.js 14+**（建议 18+）、**npm**。

依赖安装优先使用仓库自带的**嵌入式 Python 3.11 运行时**（`python/python.exe`，Windows 下不需额外装 Python）：安装脚本会为其引导出 pip，并把 `edge-tts` / `vosk` 装上，自动规避「系统 Python 过旧导致 `edge-tts from versions: none`」类报错。仅当嵌入式运行时缺失（如 Linux 开发机）时，才回退要求系统 **Python 3.8+ 且勾选 Add to PATH**。均不可用时 TTS/STT 降级不可用，应用本身仍可运行，修复后重跑 `npm run setup` 即可。

## 项目结构

```
electron/
├── main.js                      # Electron 主进程：窗口管理、IPC、TTS/STT 子进程管理、AI 请求代理、Agent 工具系统
├── preload.js                   # 预加载脚本：通过 contextBridge 暴露 electronAPI，桥接渲染进程与主进程
├── index.html                   # 「家里」次要窗口：房子 + 桌宠 + 聊天面板 + 家里专属设置（由浮窗"回家"唤起）
├── float.html                   # 默认启动窗口：桌宠游荡模式 + 聊天 + 设置面板（通过 ?mode=chat / ?mode=settings 区分）
├── companion.html               # 陪伴模式窗口：麦克风图标 + 语音对话气泡 + 立绘
├── cookie.html                  # 饼干窗口：可拖拽的饼干道具
│
├── voice.js                     # 浏览器端语音管理模块（VoiceManager 类）：Web Speech API TTS/STT
├── companion.js                 # 陪伴模式逻辑：录音、VAD、智谱 AI 对话、屏幕感知、主动搭话
├── float.js                     # 浮窗逻辑：游荡/抛物线/重力移动、聊天、TTS 朗读、设置面板
├── cookie.js                    # 饼干逻辑：拖拽移动、投喂交互、动画
├── companion.css                # 陪伴模式样式
├── float.css                    # 浮窗/聊天窗口样式
├── cookie.css                   # 饼干窗口样式
│
├── css/
│   ├── index.css                # 主窗口样式（设置面板、聊天框、状态栏、房子等）
│   └── grid-editor.css          # 网格编辑器样式
│
├── js/
│   ├── index.js                 # 主窗口核心逻辑：状态系统、聊天、AI 对话、设置管理、记忆系统、网格交互
│   ├── grid-system.js           # 网格地图渲染系统：菱形/正方形视角、房间绘制、家具摆放
│   └── grid-editor.js           # 网格编辑器：房间增删改、墙面/地板颜色、家具管理
│
├── img/                         # 图片资源
│   ├── icon.png / icon.ico      # 应用图标
│   ├── pet.png / pet.jpg        # 桌宠立绘
│   ├── mood_*.png               # 心情表情（开心、兴奋、好奇、害羞、惊讶、撒娇、无语、生气、难过、鼓励）
│   ├── 浮窗_*.png               # 浮窗桌宠状态图（发呆、吃饭、吃饼干、嘴馋、工作、生气、睡觉、饼干）
│   ├── 被拖动.png               # 被拖拽时的状态图
│   └── 家具系列.png             # 墙面、床、沙发、餐桌、灶台、冰箱、电视、衣柜、洗衣机、马桶、水槽、浴室等
│
├── tts_service/                 # Edge TTS 语音合成服务（Python 子进程）
│   ├── tts_server.py            # 服务端：从 stdin 读取 JSON 请求，通过 edge-tts 合成，通过 stdout 返回 base64 音频
│   ├── requirements.txt         # 依赖：edge-tts
│   └── ort_cpu_runtime.py       # ONNX Runtime 辅助模块
│
├── stt_service/                 # Vosk 离线语音识别服务（Python 子进程）
│   ├── stt_server.py            # 服务端：基于能量 VAD + Vosk 模型的持续录音与自动断句识别
│   ├── requirements.txt         # 依赖：vosk
│   └── models/
│       └── vosk-model-small-cn-0.22.zip  # 中文语音识别模型（需解压）
│
├── scripts/
│   └── extract-python.js        # 构建时解压嵌入式 Python 压缩包
│
├── python/                      # 嵌入式 Python 3.11.9 运行时（npm install 时自动解压）
├── dist/                        # electron-builder 打包输出目录
├── package.json                 # 项目配置、依赖、打包脚本
└── README.md                    # 本文件
```

## 架构概览

```
┌───────────────────────────────────────────────────────────────┐
│                      Electron 主进程 (main.js)                │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │ 窗口管理器   │  │ IPC 消息路由  │  │ Agent 工具系统       │ │
│  │ - 主窗口     │  │ - 配置同步    │  │ - 笔记/应用/系统     │ │
│  │ - 浮窗       │  │ - 饼干管理    │  │ - 程序资产管理       │ │
│  │ - 聊天窗口   │  │ - 记忆持久化  │  │ - 屏幕/Python 执行   │ │
│  │ - 陪伴窗口   │  │ - AI 请求代理 │  │ - 图像/翻译/天气     │ │
│  │ - 饼干窗口   │  │ - TTS/STT    │  │                      │ │
│  └─────────────┘  └──────────────┘  └──────────────────────┘ │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Python 子进程管理                                         │ │
│  │ - tts_server.py  (Edge TTS 语音合成，stdin/stdout JSON)   │ │
│  │ - stt_server.py  (Vosk 语音识别，stdin/stdout JSON)       │ │
│  └──────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
         │                    │                    │
    ┌────▼────┐         ┌────▼────┐          ┌────▼────┐
    │ 浮窗     │         │ 家里     │          │ 陪伴窗口 │
    │  float  │ ← 启动  │  index   │          │companion│
    │ +聊天    │ 默认窗口 │ +聊天     │          │         │
    │ +设置    │ 　      │ 次要窗口   │          │         │
    └─────────┘  回家⚠   └─────────┘          └─────────┘
```

> **启动窗口说明**：应用启动即打开浮窗（桌宠）作为默认窗口；家里（`index.html`）降级为次要窗口，通过浮窗或设置面板中的"🏠 回家"按钮唤起。

## 窗口体系

### 浮窗 (`float.html`) —— **默认启动窗口**

- 无边框透明小窗口，始终置顶，默认 160x140 固定尺寸
- **应用启动即打开浮窗（桌宠）作为首要窗口**，桌宠直接出现在桌面
- 桌宠模式：自由游荡 / 重力模式（底部行走 + 抛物线上抛），可碰撞应用窗口
- 拖拽交互：拖拽身体可移动（打断当前状态链），释放后抛物线回落
- 聊天气泡：点击后进入独立聊天窗口（`float.html?mode=chat`）
- **设置面板**：独立窗口（`float.html?mode=settings`），集中管理所有非"家里"专属设置（见下）
- **回家**：气泡中"🏠 回家"按钮唤起主窗口 `index.html`（降级为次要窗口）
- **陪伴**：气泡中"🌸 陪伴"按钮进入陪伴模式

### 主窗口 / 家里 (`index.html`) —— **次要窗口**

- 无边框透明窗口，始终置顶，窗口大小与屏幕比例一致
- **降级为次要窗口**，默认不随启动打开，由浮窗"🏠 回家"按钮唤起
- 核心功能：网格化房子（客厅/卧室/厨房/卫生间/阳台）、桌宠状态与行为模拟、AI 聊天面板、网格编辑器、房间/家具专属设置
- 最小化时自动切换到浮窗（桌宠游荡模式），恢复时展示家里窗口
- 支持全屏切换、透明度调节、竖屏适配
- 家里专属设置（窗口/墙面/地板透明度、主桌宠/家具/按钮大小、房间布局、网格编辑、AI 决定去向、开发者模式等）保留在主窗口设置面板中

### 聊天窗口 (`float.html?mode=chat`)

- 带系统原生标题栏，可调整大小、最小化、最大化
- 默认大小：屏幕 40% 宽 × 50% 高
- 加载与浮窗同一页面，通过 URL 参数 `?mode=chat` 区分
- 关闭时自动完成记忆总结，然后显示浮窗

### 陪伴模式窗口 (`companion.html`)

- 无边框小窗口，始终置顶，默认 180x200
- 核心功能：持续麦克风录音（VAD 静音检测 + 自动断句）、智谱 AI 语音对话、屏幕定时截图感知、AI 主动搭话
- 进入陪伴模式时自动最小化主窗口
- 提供"返回主窗口"和"切换到浮窗聊天"两个出口

### 饼干窗口 (`cookie.html`)

- 无边框透明小窗口，始终置顶
- 主进程级定时器每 30 秒在屏幕角落随机生成饼干
- 支持拖拽移动，释放后重力下落
- 桌宠靠近时触发"吃饼干"动画，恢复状态值

## 功能模块

### 主窗口核心功能

| 模块 | 文件 | 说明 |
|------|------|------|
| 状态系统 | `js/index.js` | 饱食/快乐/精力/清洁/无聊/好感度，随时间自然衰减，影响行为 |
| 行为系统 | `js/index.js` | 自动行走、随机玩耍、跟随鼠标、与家具互动、蹭墙、吃东西 |
| 网格系统 | `js/grid-system.js` | 菱形/正方形视角切换，房间绘制，家具渲染，碰撞检测 |
| 网格编辑器 | `js/grid-editor.js` | 房间增删改、墙面/地板颜色、家具摆放、拖拽编辑 |
| 聊天系统 | `js/index.js` | 发送消息、DeepSeek AI 回复、立绘表情切换、多轮对话 |
| 设置面板 | `js/index.js` | 只保留"家里"专属设置（显示/桌宠比例/AI决策/开发者/网格/房间等） |
| 存档系统 | `js/index.js` | 保存/加载/导出/导入（JSON 格式），包含状态、记忆、网格、配置 |

### 浮窗核心功能

| 模块 | 文件 | 说明 |
|------|------|------|
| 自由游荡 | `float.js` | 随机方向移动，屏幕边界反弹，速度随机变化 |
| 重力模式 | `float.js` | 底部水平行走，抛物线上抛，碰撞窗口反弹 |
| 拖拽交互 | `float.js` | 鼠标拖拽桌宠，释放后抛物线回落；拖拽/发现饼干可打断状态链 |
| 聊天模式 | `float.js` | 进入独立聊天窗口，AI 对话，TTS 朗读回复 |
| 饼干检测 | `float.js` | 检测饼干位置，靠近时自动走过去吃掉 |
| **状态链** | `float.js` | 可配置的状态序列（如 吃饭→吃饭→睡觉），以一定概率被随机触发；被打断后进入用户指定的中断状态，可在设置面板增删 |
| **设置面板** | `float.js` | 独立窗口（`?mode=settings`），管理浮窗/饼干/贴图/AI/语音/记忆/状态链/开机自启/回家等全部非"家里"专属设置 |
| **开机自启** | `main.js` | 设置面板"🚀 开机自启动"开关，通过 `app.setLoginItemSettings` 实现 |

### 陪伴模式核心功能

| 模块 | 文件 | 说明 |
|------|------|------|
| 持续录音 | `companion.js` | 浏览器 MediaRecorder API，30ms 分帧发送到 STT 服务 |
| VAD 检测 | `stt_server.py` | 基于能量的语音活动检测，800ms 静音超时自动断句 |
| 语音识别 | `stt_server.py` | Vosk 离线中文模型，无需联网 |
| AI 对话 | `companion.js` | 智谱 GLM-4-Flash，支持语音输入理解和屏幕上下文 |
| 屏幕感知 | `main.js` → `companion.js` | 定时截图（桌面捕捉），通过智谱 GLM-4V 分析 |
| 主动搭话 | `companion.js` | 基于屏幕内容、时间上下文、对话历史，AI 自主决定是否开口 |
| 语音朗读 | `companion.js` | AI 回复自动通过 Edge TTS 朗读 |

## IPC 通信

`preload.js` 通过 `contextBridge` 向渲染进程暴露 `window.electronAPI`，提供以下 IPC 通道：

### 窗口管理
- `restore-main-window` / `window-minimize` / `window-maximize` / `window-close`
- `window-set-size` / `set-window-opacity`
- `main-window-resize` / `window-minimized` / `window-restored`
- `show-index-window`（浮窗"🏠 回家"唤起主窗口 index.html）
- `float-open-settings` / `settings-close`（独立打开/关闭设置窗口）
- `set-login-item`（开机自启动开关）

### 浮窗通信
- `float-enter-chat-mode` / `float-exit-chat-mode`
- `update-float-message` / `move-float-window` / `resize-float-window`
- `set-float-pet-size` / `set-float-move-mode` / `set-float-bounce-windows`
- `set-float-show-illust` / `set-cookie-spawn-enabled`

### 饼干系统
- `get-cookie-position` / `cookie-position-update` / `request-eat-cookie` / `cookie-eaten`
- `request-spawn-cookie` / `close-cookie-window` / `set-cookie-size`
- `cookie-config` / `pet-position-update` / `eat-cookie` / `cookie-drag-timeout`

### 记忆系统
- `memory-load` / `memory-save` / `save-memory-item` / `get-memory-items`
- `trigger-memory-summary` / `memory-updated`

### 配置同步
- `set-zhipu-key` / `set-multimodal-enabled` / `set-cost-saving` / `set-ai-prompt`
- `config-updated` / `get-multimodal-config`

### 语音系统
- `speak-text` (TTS) / `get-tts-voices`
- `stt-stream-init` / `stt-stream-audio` / `stt-stream-reset` / `stt-stream-end`
- `stt-ready` / `stt-result` / `stt-ended`

### AI 请求
- `ai-chat-request` (主进程代理，解决渲染进程 SSL 问题)
- `capture-screen` (桌面截图 + 智谱 GLM-4V 分析)
- `generate-image` (智谱 CogView 图像生成)
- `save-chat-log` / `save-image-from-url`

### Agent 工具
- `execute-tool` (工具调度，详见下方)

## AI 系统

### DeepSeek API（主窗口聊天）

- 模型：`deepseek-chat`
- 功能：多轮对话、立绘表情控制、记忆引用
- 提示词：通过设置面板自定义 AI 人设，支持 `[MEMORY]` 引用长期记忆
- 记忆系统：对话结束时自动总结生成长期记忆，避免重复记录

### 智谱 AI（陪伴模式）

- 对话模型：`glm-4-flash`（轻量快速）
- 视觉模型：`glm-4v-flash`（屏幕截图分析）
- 图像生成：`cogview-3-flash`（AI 画图）
- API 地址：`https://open.bigmodel.cn/api/paas/v4/chat/completions`
- 费用控制：节省成本模式（自动开启）

### 陪伴模式 AI 提示词设计

陪伴模式 AI 遵循严格的语音交互规则：

- 只说纯文本，禁止任何动作描写、旁白或括注
- 感知方式：消息可能是语音转文字（有识别错误），屏幕快照是过去的（延迟视角）
- 说话约束：有想法就开口，没想法就沉默，别硬聊
- 语气：轻快口语化，常用"嘛""呀""啦""喔""诶"
- 主动搭话不是"发起对话"，只是随口说一句

## 语音系统

### TTS（语音合成）

- 引擎：Edge TTS（通过 `edge-tts` Python 库，云端合成）
- 实现：`main.js` 启动 `tts_server.py` 子进程，通过 stdin/stdout JSON 通信
- 支持的语音：14 种中文神经网络语音（如 Xiaoxiao、Yunxi、Yunjian 等）
- 功能：音色选择、音量调节（0-100%）、试听、朗读开关、自动发送开关
- 浏览器端：`voice.js` 提供 `VoiceManager` 类，使用 Web Speech API 作为备选

**TTS 通信流程：**

```
渲染进程                   主进程                    Python 子进程
    │  speakText(text, voice)  │                          │
    │─────────────────────────►│  JSON {text, voice, id}  │
    │                          │─────────────────────────►│
    │                          │                          │  edge-tts API
    │                          │                          │  synthesize
    │                          │  JSON {success, audio}   │
    │                          │◄─────────────────────────│
    │  base64 audio            │                          │
    │◄─────────────────────────│                          │
    │  Web Audio API 播放      │                          │
```

### STT（语音识别）

- 引擎：Vosk 离线模型（`vosk-model-small-cn-0.22`）
- 实现：`main.js` 启动 `stt_server.py` 子进程，通过 stdin/stdout JSON 通信
- VAD：基于能量的语音活动检测，800ms 静音超时，300ms 最短语音
- 音频格式：16kHz, 16bit, 单声道 PCM
- 使用场景：陪伴模式持续录音 + 自动断句

**STT 模型下载说明：**

`npm install` 的 `postinstall` 会自动解压 `stt_service/models/vosk-model-small-cn-0.22.zip` 并安装 `vosk` 依赖。由于模型体积较大（约 40MB）可能未随源码分发，若首次安装后 STT 不可用，请：

1. 从 <https://alphacephei.com/vosk/models> 下载 `vosk-model-small-cn-0.22.zip`；
2. 放入 `stt_service/models/` 目录（保持文件名不变）；
3. 重新运行 `npm run setup`（或 `npm install`）完成解压。

> 解压后目录应为 `stt_service/models/vosk-model-small-cn-0.22/`，内含 `am/`、`conf/`、`graph/` 等子目录。

## Agent 工具系统

主进程通过 `execute-tool` IPC 提供统一的工具调用接口，AI 可在对话中调用以下工具：

### 笔记操作
- `write_note` / `read_note` / `delete_note`：管理纯文本笔记（保存在 `Documents/PetNotes/`）

### 系统操作
- `open_app`：打开系统应用（计算器、记事本、浏览器、微信、QQ、VS Code 等）
- `open_url`：在浏览器中打开网址
- `set_volume` / `get_volume`：调节/获取系统音量
- `screenshot`：截屏保存到桌面
- `get_system_info`：获取 CPU/内存/磁盘使用率

### 信息查询
- `get_weather`：查询指定城市天气（通过 wttr.in）
- `get_time`：获取当前日期时间
- `translate`：翻译文本（通过 mymemory.translate.net）
- `calculate`：安全数学计算

### 程序资产管理
- `save_program` / `add_program` / `list_programs` / `describe_program`
- `run_program` / `update_program` / `delete_program` / `edit_program_description` / `export_program`
- 支持 Python、JavaScript、Bash、HTML 四种类型
- 程序保存在 `Documents/PetWorkspace/programs/`，元信息在 `manifest.json`

### 媒体与 AI
- `capture_screen`：截图 + 智谱 GLM-4V 分析
- `generate_image`：智谱 CogView 图像生成
- `run_python`：执行临时 Python 脚本

## 记忆系统

### 长期记忆

- 触发时机：对话结束时（聊天窗口关闭/对话内容删除前）
- 存储位置：`{userData}/petMemory.json`
- 持久化：主进程直接读写文件，通过 IPC 广播到所有窗口
- 总结策略：
  - 只记录用户偏好、重要事实、约定、重大事件
  - 不总结日常琐事（如"桌宠做了什么"）
  - 提示词包含已保存记忆全文，防止重复
  - 无条数上下限，如无值得记忆的内容则不记录

### 记忆管理

- 启用/禁用开关
- 手动添加/删除记忆条目
- 记忆列表展示（设置面板中）
- 多窗口实时同步

### 图像记忆（多模态）

启用多模态后，对话中的屏幕截图会临时上传到 DeepSeek Files API；关闭聊天窗口时由视觉模型一次性完成总结：输出文本记忆要点 + `KEEP:<编号>|<描述>` 的截图保留清单。被保留的截图成为**图像记忆**（图片 + 描述），其余截图自动从 Files API 删除。

- **手动添加**：设置面板中"🖼 图片记忆"按钮选择本地图片，自动上传获取 `file_id` 并保存为图像记忆（描述必填：记忆输入框有文字则用它，否则弹出填写框）
- **删除**：删除图像记忆时会同步调用 DELETE 接口清理 Files API 中的图片
- **对话中使用**：vision 模型对话时，所有已保存的图像记忆会以真实图片（file_id）附带在请求中，模型提问时可看到图片内容
- **注意事项**：DeepSeek Files API 中的文件有服务端保留期，若图像记忆的 `file_id` 过期失效，重新添加一次该图片记忆即可

### 强制图像记忆（forcememory）

想强制把本次对话的**最后一张截图**保存为图像记忆（描述固定为 `test`）时：

1. 在对话中发送一条包含触发词的消息，支持以下写法（大小写不限）：

   ```
   forcememory
   forcemomory        # 常见拼写变体，同样识别
   force memory       # 带空格/连字符/下划线亦识别
   ```

2. **关闭聊天窗口**，触发记忆总结（主进程先拦截关闭 → 执行总结 → 确认关闭）。

机制说明：

- 关键词由程序检测，并向总结提示词注入【强制指令】：AI 必须把最后一张截图输出为 `KEEP:<编号>|test`；总结动作由 AI 完成，程序按编号还原 `file_id` 并保存为描述为 `test` 的图像记忆
- 关键词会被从发给 AI 的文本中剔除，避免被记成一条无意义的文本记忆
- 该回合必须存在截图，否则无图可保存（指令不会注入）
- 主进程日志可验证：`[float:summary] start ... forceMemory=true lastIdx=N` → `done ... imageMemories=1`

## 配置项

所有配置通过 `localStorage` 的 `petConfig` 键存储，由**统一设置窗口**（`float.html?mode=settings`）统一管理，通过 IPC 同步到各窗口。主窗口（家里）与浮窗共用同一套设置界面：主窗口右上角 ⚙️ 与浮窗气泡里的 ⚙️ 都打开同一个设置窗口，改动实时生效。

| 分类 | 配置项 | 说明 |
|------|--------|------|
| 浮窗 | 桌宠大小、移动模式、碰撞窗口、饼干生成/大小、立绘显示 | 控制浮窗（默认窗口）行为 |
| 显示设置 | 窗口/墙面/地板透明度、竖屏适配 | 控制家里窗口外观 |
| 桌宠设置（家里） | 主窗口桌宠/家具/按钮大小、陪伴窗口宽度 | 控制家里与陪伴窗口尺寸 |
| AI | API Key、API 地址、AI 人设 | 控制 AI 对话参数 |
| 多模态 | 智谱 API Key、启用开关、节省成本 | 控制多模态 AI 功能 |
| 语音 | 朗读开关、音色选择、音量 | 控制 TTS 语音设置 |
| 记忆 | 启用开关 | 管理长期记忆 |
| **状态链** | 状态序列列表、被打断后进入状态 | 可增删的桌宠状态链（如 吃饭→吃饭→睡觉），随机触发 |
| **启动** | 开机自启动 | 随系统开机自动运行桌宠 |
| **家里窗口** | 回家按钮 | 从设置窗口唤起家里窗口 |
| **退出** | 退出应用 | 彻底退出整个应用 |

## 技术栈

| 层级 | 技术 | 用途 |
|------|------|------|
| 框架 | Electron 31 | 桌面应用框架 |
| 前端 | 原生 HTML / CSS / JavaScript | 渲染进程 UI |
| 打包 | electron-builder (NSIS) | Windows 安装包构建 |
| AI 对话 | DeepSeek API (deepseek-chat) | 主窗口聊天 AI |
| AI 对话 | 智谱 GLM-4-Flash | 陪伴模式对话 AI |
| AI 视觉 | 智谱 GLM-4V-Flash | 屏幕截图分析 |
| AI 图像 | 智谱 CogView-3-Flash | AI 图像生成 |
| 语音合成 | Edge TTS (edge-tts Python 库) | 云端语音合成 |
| 语音识别 | Vosk 离线模型 | 本地语音识别 |
| 嵌入式 Python | 3.11.9 embeddable | TTS/STT 服务运行环境 |

## 运行要求

- Windows 10/11 x64（主要目标平台）
- Node.js 18+
- 网络连接（Edge TTS、DeepSeek API、智谱 API 需要联网）
- 麦克风（陪伴模式语音输入需要）
- Vosk 中文模型（需解压到 `stt_service/models/vosk-model-small-cn-0.22/`）

## 打包发布

```bash
npm run build   # 生成 dist/ 目录下的 NSIS 安装包
```

打包配置（`package.json` → `build`）：

- 应用 ID：`com.example.petapp`
- 安装包名：`pet-app-{version}-setup.exe`
- 包含文件：`main.js`、`index.html`、`float.html`、`preload.js`、`css/`、`js/`、`img/`、`package.json`
- 额外资源：`python/` 目录（嵌入式 Python 运行时）
- NSIS 安装选项：可选择安装路径、创建桌面快捷方式、开始菜单快捷方式

## 开发说明

### 关键设计决策

1. **多窗口架构**：主窗口、浮窗、聊天窗口、陪伴窗口、饼干窗口各自独立，通过 IPC 通信和状态同步协同工作。

2. **Python 子进程**：TTS 和 STT 服务通过独立 Python 子进程运行，使用 stdin/stdout JSON 行协议通信，避免阻塞 Electron 主进程。

3. **主进程 AI 代理**：所有 AI API 请求通过主进程发起（`ai-chat-request` IPC），解决渲染进程 SSL 证书验证问题。

4. **配置持久化**：配置通过 `localStorage` 存储，记忆通过主进程直接读写 JSON 文件，确保数据可靠性和跨窗口同步。

5. **安全性**：使用 `contextBridge` + `preload.js` 进行安全的 IPC 暴露，不启用 `nodeIntegration`，遵循 Electron 安全最佳实践。

### 浮窗物理与渲染对位（踩坑记录）

> 现象：重力模式下窗口下半个一直跑到屏幕外，怎么改碰撞参数都没反应；且用浏览器直接打开 `float.html` 与在 Electron 中运行时，贴图显示位置不一致。

**根因有三层，且会互相掩盖：**

1. **尺寸 CSS 变量初始化时序**：`applySavedFloatConfig()` 改了 `currentPetSize` 后，若没有立即调用 `updateWindowSize()`，`.float-container` 尺寸与 `--float-pet-bottom` / `--float-pet-size` 就停留在默认值（160×140 / fallback）。Electron 下要等主进程 `float-pet-size` 的 IPC 消息到达才更新，浏览器下该 IPC 永不触发、永不更新 → 两种环境渲染分叉，且物理碰撞用的是过期的 `getContainerHeight()`，改参数自然"没变化"。
   **结论**：任何配置项应用到运行时后，必须**同步立即刷新**容器/窗口尺寸与 CSS 变量，不能只依赖 IPC 到达。

2. **碰撞箱坐标系混淆**：`posY` / `lastWindowY` 是**窗口顶部**坐标，窗口底部 = `posY + winH`。旧代码底部边界用的是 `getPetBottomOffset()`（贴图内部偏移，约等于半个窗口高），而非整个 `winH`，导致窗口底部多出近一个窗口高度，下半屏落在屏幕外。修正：底边界 = `workArea.y + workArea.height - winH`，顶边界 = `workArea.y`，左右边界 = `workArea.x` / `workArea.x + width - winW` —— 即统一按"窗口顶部坐标 + 整窗尺寸"表达边界，而不是贴图偏移量。

3. **`lastWindowX/Y` 与实际位置脱节**：初始化若硬编码为屏幕右下角，或 resize 后用 `setTimeout(0)`/立即读 `window.screenY` 试图回写物理位置，会读到/覆写成旧值 —— IPC `setBounds` 是异步的，尚未生效。这会让重力物理从错误高度起跳、并把 `wander` 已设好的地面坐标覆盖掉。
   **结论**：渲染进程的"逻辑位置变量"与主进程窗口实际位置的同步，必须发生在主进程真正完成坐标变更之后；不要在 IPC 调用后立即读取回写。

**为什么"只加了设置、没改数值"问题就自愈**：新增设置滑块并重新加载浮窗时，`applySavedFloatConfig()` 后紧跟着的 `updateWindowSize()` 一起生效，把第 1 条（容器/窗口尺寸初始化）修复了，物理碰撞随之回到正确尺寸，因此即使滑块保持默认值，显示也恢复正常。

### 调试

- 开发者模式：设置面板中启用，可双击 Ctrl 生成测试饼干、查看和编辑 AI 提示词
- 全局快捷键：`Ctrl+Shift+C` 在开发者模式下生成饼干
- 日志：主进程控制台输出 `[Main]`、`[TTS]`、`[STT]` 等标签日志，渲染进程输出 `[Voice]`、`[Float]` 等标签日志
- 用户数据路径：启动时打印 `userData`、`localStorage`、`petMemory.json` 路径

## ☕ 请作者喝一杯咖啡

如果这个桌宠小屋给你带来了快乐，欢迎请我喝一杯咖啡~

![收款码](img/donate.png)