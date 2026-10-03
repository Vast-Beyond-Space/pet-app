# 增加本地 LLM 支持（OpenAI 兼容）

## Context
当前应用只支持云端 DeepSeek / 智谱 GLM 两个 AI 提供商，陪伴模式的高频调用（思考、说话、立绘判断、屏幕分析）全部走智谱 GLM-4.6V-Flash，模型访问量大、成本高。用户希望增加**本地 LLM**作为备选：通过 OpenAI 兼容接口接入 Ollama / LM Studio / vLLM / llama.cpp 等本地推理服务，优先跑在本地以降低成本。

已确认的两个决策：
1. **通用 OpenAI 兼容接入**：可自定义本地 API 地址 + 可选 Key + 可选模型名，默认填 Ollama 地址 `http://localhost:11434/v1/chat/completions`。
2. **多模态带图尝试、失败降级**：屏幕分析优先带截图调用本地模型，若模型不支持图片则自动降级为纯文本描述。

## 新增配置字段（贯穿全链路）
- `localApiUrl`：本地端点，默认 `http://localhost:11434/v1/chat/completions`
- `localApiKey`：可选，多数本地服务留空
- `localModel`：可选，如 `qwen2.5:7b`（Ollama 必填；LM Studio 可留空，留空时请求体不传 model 字段）

新提供商值：`multimodalProvider = 'local'`。

## 改动清单

### 1. d:\pet-app\electron\float.html（设置窗口 UI，主入口）
- `aiProviderSelect`（L1651）增加 `<option value="local">本地 LLM</option>`。
- `apiUrlInput`（L1662）之后新增模型名输入框：
  ```html
  <div class="sb-item" id="localModelItem" style="display:none;">
      <label>本地模型名（可选）</label>
      <input type="text" id="localModelInput" placeholder="如 qwen2.5:7b（Ollama 必填，LM Studio 可留空）">
  </div>
  ```

### 2. d:\pet-app\electron\float.js（设置窗口逻辑）
- `mmProviderDefaults()`（L318-L323）增加：
  ```js
  local: { url: 'http://localhost:11434/v1/chat/completions', keyLabel: '本地 API Key（可选）', keyPlaceholder: '本地服务一般不需要 Key，留空即可' }
  ```
- `chatCredentials()`（L340-L346）增加 local 分支：`{ base: toChatCompletionsUrl(config.localApiUrl), key: config.localApiKey || '' }`。
- `refreshMultimodalUI()`（L351-L367）：local 时 keyValue=`config.localApiKey`、urlValue=`config.localApiUrl || def.url`；并根据 provider 显示/隐藏 `localModelItem`、回填 `localModelInput.value = config.localModel`。
- `apiKeyInput` change（L1077）：加 local 分支写 `config.localApiKey`。
- `apiUrlInput` change（L1087）：加 local 分支写 `config.localApiUrl`。
- 新增 `localModelInput` change 绑定 → `config.localModel` + `saveConfig()`。
- 测试按钮（L1124-L1148）：provider=local 时向 `testApi` 附带 `model: config.localModel`，并在本地 Key 为空时仍发起测试（不再要求 key 必填）。
- `saveConfig()`：确认 local 三字段随 config 对象序列化（`petConfig` JSON）。

### 3. d:\pet-app\electron\index.html（隐藏设置控件层）
- `multimodalProviderSelect`（L2169）增加 `<option value="local">本地 LLM</option>`。
- 增加隐藏控件 `<input type="text" id="localApiUrlInput">`、`<input type="text" id="localModelInput">`（供 index.js 读取/绑定）。

### 4. d:\pet-app\electron\js\index.js（主窗口逻辑）
- `config` 默认值（L85-L128）增加 `localApiUrl: ''`、`localApiKey: ''`、`localModel: ''`。
- `aiCredentials()`（L1134-L1147）增加 local 分支：
  ```js
  apiUrl: config.localApiUrl || 'http://localhost:11434/v1/chat/completions',
  apiKey: config.localApiKey || '',
  model: (config.localModel || '').trim()
  ```
- 所有用 `c.model` 拼请求体的调用点（L1156、L2153、L2450、L2629、L2718 等约 6 处）：`model: c.model` 改为 `...(c.model ? { model: c.model } : {})`，避免本地未填模型名时发送空字符串导致 400。
- `initMultimodalUI()`（L3362-L3384）：provider 变 local 时 `config.localApiUrl = config.localApiUrl || 'http://localhost:11434/v1/chat/completions'`；新增 `localApiUrlInput`/`localModelInput` 的 change 绑定与保存。
- 保存/回填路径（applyStatsBtn、refreshSettingsValues 等）加 local 字段。

### 5. d:\pet-app\electron\main.js（主进程）
- 状态变量区（L79-L95 附近）加 `let localApiUrl='', localApiKey='', localModel=''`。
- `hydrateRuntimeFromUnified()`（L140 起）与 `config-sync`（L172-L233）加三个字段的同步：`if (cfg.localApiUrl != null) localApiUrl = cfg.localApiUrl;` 等。
- `broadcastConfigUpdate()`（L104）与 `get-multimodal-config`（L2145）配置对象里补 `localApiUrl, localApiKey, localModel`。
- **`ai-chat-request`（L1939-L2016，陪伴模式唯一入口）改为按 `multimodalProvider` 路由**：
  - `'zhipu'`：保留现有 GLM 回退链（https.request，open.bigmodel.cn）。
  - `'local'`：新增分支，用 Node `fetch`（支持 http://localhost）请求 `localApiUrl`：
    - headers 仅当 `localApiKey` 非空才加 `Authorization`；
    - body 仅当 `localModel || model` 非空才带 model 字段；`max_tokens`/`temperature` 沿用传入值；
    - 用 `AbortController` 设 20s 超时；解析 `choices[0].message.content`，错误抛 `new Error(msg)`。
  - `'deepseek'`（顺带补全）：fetch `apiUrl + apiKey`，model `deepseek-flash`。
- **`describeScreen`（L2983-L3029）增加 local 分支**（放在 zhipu 分支后）：
  1. 带图尝试：fetch `localApiUrl`，messages 含 `image_url`（dataURL base64）+ 文本；
  2. 失败（HTTP 错误 / 解析失败 / choices 空）时降级：重试一次去掉图片块，只发文本；
  3. 仍失败则抛错，上层已有 catch 容错。
- **`ai-test-api`（L3216-L3265）**：
  - 入参增加 `model`；`key` 为空不再直接返回失败（local 时允许无 Key，仅不传 Authorization 头）；
  - provider=local 时 model 用 `model || localModel || undefined`（undefined 则不传）；url 为空时回退 `localApiUrl`。

### 6. d:\pet-app\electron\companion.js（陪伴模式）
- `loadConfig()`（L78-L119）与 `pullAuthoritativeConfig()` keys 数组（L137-L143）加 `localApiUrl, localApiKey, localModel, apiKey, apiUrl`。
- `onConfigUpdated`（L173 起）同步 local 三字段。
- 新增两个工具函数：
  ```js
  function isAiConfigured() {
      const p = config.multimodalProvider || 'deepseek';
      if (p === 'zhipu') return !!config.zhipuApiKey;
      if (p === 'local') return !!(config.localApiUrl || '').trim();
      return !!config.apiKey;
  }
  function companionModel() {
      const p = config.multimodalProvider || 'deepseek';
      if (p === 'zhipu') return 'glm-4.6v-flash';
      if (p === 'local') return (config.localModel || '').trim();
      return 'deepseek-flash';
  }
  ```
- 把 `config.zhipuApiKey` 判断（L332、L400、L705、L781、L881 等）改为 `isAiConfigured()`。
- 把硬编码 `model: 'glm-4.6v-flash'`（runOneThought L415、callZhipu L747、updateMoodFromResponse L789、compressDialogs L888 等）改为 `model: companionModel()`。
- `callZhipu` 的 local 路径：图片仍按现有逻辑传（本地视觉模型支持则成功，不支持则报错走现有 catch 回退模板/本地映射）。

### 7. d:\pet-app\electron-lite\main.js（低优先级，可选）
- `multimodalProvider` 概念存在，但 lite 版无统一 config-sync；若需要，给 `ai-chat`/`capture-screen` 加 local 分支（fetch localApiUrl，字段从渲染进程传入）。**默认只做语法兼容，不强制**。主版完成后视用户反馈决定。

## 验证
1. 语法检查：`node --check` 对 main.js、float.js、index.js、companion.js（companion/float/index 为渲染脚本，`node --check` 可查语法）。
2. 启动应用（npm start 或 electron 主入口），打开设置窗口 → AI 设置：
   - 下拉出现"本地 LLM"；选中后出现模型名输入框，API Key 提示"可选"。
   - 本机已装 Ollama 时：填模型名（如 `qwen2.5:7b`）→ 点"🧪 测试 API 连接"应返回 ✅。
   - 未装本地服务时：测试应返回明确的连接失败提示（而非崩溃）。
3. 陪伴模式：
   - 设置"本地 LLM"并填好模型后，开启陪伴模式，确认思考气泡/说话由本地模型产出（日志 `[Companion] thought:`）。
   - 屏幕感知：本地视觉模型（qwen2.5-vl/llava）时能看到画面内容；纯文本模型时日志显示降级，不报错。
   - 切回"智谱 AI"确认 GLM 回退链不受影响。
4. 主窗口聊天（浮窗聊天框）：provider=local 时对话走本地端点；模型名留空时请求体不携带 model 字段。

## 不做的事
- 不自动探测本地服务/模型列表（保持简单，用户手填）。
- 不修改 DeepSeek 云端默认行为；本地 LLM 仅新增一种提供商选项。
