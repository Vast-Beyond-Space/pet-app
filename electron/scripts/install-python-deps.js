/**
 * 一次性安装 TTS / STT 服务所需依赖，并解压 STT 模型。
 * 在 npm install 的 postinstall 阶段自动执行，也可在打包前（npm run setup）手动执行。
 *
 * 优先使用仓库自带「嵌入式 Python 3.11 运行时」（python/python.exe）：
 *   - 它内置 ensurepip，可引导出 pip；
 *   - 确保 python311._pth 启用 site 与 Lib/site-packages，装进去的包可直接 import；
 *   - 这样完全不依赖用户系统的 Python/pip，彻底规避「旧系统 Python 导致
 *     edge-tts from versions: none」这类问题。
 *
 * 兜底：若找不到嵌入式运行时（如 Linux 开发机），退回到「系统 Python/pip 并使用
 * --target 安装到 python/Lib/site-packages」。
 *
 * 该脚本「容错」：任何一步失败都不会让 npm install 整体失败，只打印警告，
 * 此时 TTS/STT 功能降级不可用，修复后重新运行 `npm run setup` 即可。
 */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PY_DIR = path.join(ROOT, 'python');
const SITE_PACKAGES = path.join(PY_DIR, 'Lib', 'site-packages');
const PYTHON_EXE = path.join(PY_DIR, 'python.exe');
const MODEL_ZIP = path.join(ROOT, 'stt_service', 'models', 'vosk-model-small-cn-0.22.zip');
const MODEL_DIR = path.join(ROOT, 'stt_service', 'models', 'vosk-model-small-cn-0.22');
const GET_PIP_PY = path.join(PY_DIR, 'get-pip.py');

// pip 安装镜像回退链：先走 pip 自身配置，再官方 PyPI，再到国内镜像，覆盖镜像缺失/网络差异
const INDEXES = [null, 'https://pypi.org/simple', 'https://pypi.tuna.tsinghua.edu.cn/simple', 'https://mirrors.aliyun.com/pypi/simple'];

function log(msg) {
    console.log('[install-deps] ' + msg);
}

// 执行命令，失败返回 null（输出透传，方便看到 pip 日志）
function run(cmd) {
    try {
        execSync(cmd, { stdio: 'inherit' });
        return true;
    } catch (e) {
        return false;
    }
}

// 执行命令并捕获输出，失败返回 null
function runOut(cmd) {
    try {
        return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
    } catch (e) {
        return null;
    }
}

// 确保嵌入式运行时的 python311._pth 启用 site 并加入 Lib/site-packages，
// 否则即使装好了包，运行时也 import 不到。
function ensurePth() {
    try {
        const pth = path.join(PY_DIR, 'python311._pth');
        if (!fs.existsSync(pth)) return;
        let content = fs.readFileSync(pth, 'utf8');
        // 取消注释 import site
        content = content.replace(/^\s*#\s*import site\s*$/m, 'import site');
        const lines = content.split(/\r?\n/);
        const hasSitePackages = lines.some((l) => /site-packages/i.test(l.trim()));
        const blocksSite = !/import site/i.test(content);
        if (!hasSitePackages || blocksSite) {
            lines.push(...(!hasSitePackages ? ['Lib/site-packages'] : []), ...(blocksSite ? ['import site'] : []));
            content = lines.join('\n');
        }
        fs.writeFileSync(pth, content);
        if (!hasSitePackages || blocksSite) log('已修正 python311._pth：启用 site 与 Lib/site-packages');
    } catch (e) {
        log('python311._pth 修正失败：' + e.message);
    }
}

// 优先使用嵌入式 Python 运行时，返回 pip 命令（如 "..."python.exe" -m pip），失败返回 null
// 注意：本函数必须保证所有引导步骤同步完成，避免后续判断错觉。
function findEmbeddedPip() {
    if (process.platform !== 'win32') return null; // 嵌入式运行时仅面向 Windows 打包
    if (!fs.existsSync(PYTHON_EXE)) {
        log('未找到嵌入式运行时 python/python.exe（可先运行 bootstrap/extract 下载解压）');
        return null;
    }
    ensurePth();
    if (runOut(`"${PYTHON_EXE}" -m pip --version`)) {
        log(`使用嵌入式 Python 运行时：${PYTHON_EXE}`);
        return `"${PYTHON_EXE}" -m pip`;
    }
    // 未内置 pip：先用内置 ensurepip，失败再用 get-pip.py（需同步下载）
    log('嵌入式 Python 未发现 pip，尝试引导安装...');
    if (runOut(`"${PYTHON_EXE}" -m ensurepip --version`)) {
        log('使用内置 ensurepip 引导 pip...');
        run(`"${PYTHON_EXE}" -m ensurepip --upgrade`);
    } else {
        log('下载 get-pip.py 引导 pip...');
        if (downloadFileSync('https://bootstrap.pypa.io/get-pip.py', GET_PIP_PY)) {
            run(`"${PYTHON_EXE}" "${GET_PIP_PY}" --no-warn-script-location --disable-pip-version-check`);
        }
    }
    if (!runOut(`"${PYTHON_EXE}" -m pip --version`)) {
        log('嵌入式 Python 的 pip 引导失败，稍后将回退使用系统 Python/pip');
        return null;
    }
    log(`使用嵌入式 Python 运行时：${PYTHON_EXE}`);
    return `"${PYTHON_EXE}" -m pip`;
}

// 同步下载小文件（用于 get-pip.py 引导）。Node 的 https 是异步的，
// 这里将其写入临时脚本，由 execSync 阻塞等待完成。
function downloadFileSync(url, dest, redirectsLeft = 5) {
    const script = `
const https = require('https');
const fs = require('fs');
function get(u, left) {
  https.get(u, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && left > 0) {
      res.resume();
      return get(new URL(res.headers.location, u).toString(), left - 1);
    }
    if (res.statusCode === 200) {
      res.pipe(fs.createWriteStream(${JSON.stringify(dest)}));
    } else {
      res.resume();
    }
    const t = setTimeout(() => process.exit(0), 2000);
    res.on('end', () => { clearTimeout(t); process.exit(0); });
  }).on('error', () => process.exit(1)).setTimeout(120000, function(){ this.destroy(); process.exit(1); });
}
get(${JSON.stringify(url)}, ${redirectsLeft});
`;
    const tmp = path.join(PY_DIR, '_download_tmp.js');
    try {
        fs.mkdirSync(PY_DIR, { recursive: true });
        fs.writeFileSync(tmp, script);
        execSync(`node "${tmp}"`, { stdio: 'ignore', timeout: 120000 });
        return fs.existsSync(dest) && fs.statSync(dest).size > 0;
    } catch (e) {
        return false;
    } finally {
        try { fs.rmSync(tmp, { force: true }); } catch (e) {}
    }
}

// 回退：系统 Python/pip（选择版本最高且可用的那个），配合 --target 安装
function pythonVersion(cmd) {
    const out = runOut(`${cmd} --version`);
    const m = out && out.match(/Python (\d+)\.(\d+)/);
    return m ? parseInt(m[1], 10) * 100 + parseInt(m[2], 10) : 0;
}
function findSystemPip() {
    const candidates = ['python', 'py -3', 'python3'];
    let best = null, bestVer = -1;
    for (const c of candidates) {
        if (!runOut(`${c} -m pip --version`)) continue;
        const v = pythonVersion(c);
        if (v > bestVer) { best = c; bestVer = v; }
    }
    if (best) {
        log(`使用系统 Python/pip：${best}（Python ${(bestVer / 100).toFixed(0)}.${bestVer % 100}）`);
    }
    return best;
}

// 检测 pip 版本，过旧则自动升级。
// 旧 pip 是无法解析包导致 "from versions: none" 的头号原因，这里无论当前版本高低都强制升级到最新。
function ensurePipVersion(pipCmd) {
    // 获取当前脚本使用的 python 是否过旧（<3.8 时 edge-tts 无一版本可用，会报 "from versions: none"）
    const pyCmd = pipCmd.replace(/ -m pip.*$/, '');
    const verOut = runOut(`${pyCmd} -c "import sys;print(sys.version_info.major, sys.version_info.minor, sys.version_info.micro)"`);
    const m = verOut && verOut.match(/^(\d+)\s+(\d+)/);
    if (m) {
        const major = parseInt(m[1], 10), minor = parseInt(m[2], 10);
        log(`当前 Python 版本：${major}.${minor}${m && verOut ? '' : ''}`);
        if (major * 100 + minor < 308) {
            log(`⚠️  Python ${major}.${minor} 过旧，edge-tts 需要 Python 3.8+，这正是 "from versions: none" 的原因。`);
            log('    请运行 `node scripts/bootstrap.js` 下载嵌入式 Python 3.11 到 electron/python/，或安装 Python 3.10+ 并勾选 "Add to PATH"。');
        }
    }
    const idxs = [null, 'https://pypi.org/simple', 'https://pypi.tuna.tsinghua.edu.cn/simple', 'https://mirrors.aliyun.com/pypi/simple'];
    log('尝试将 pip 升级到最新版本（避免旧 pip 导致 "from versions: none"）...');
    for (const idx of idxs) {
        const idxArg = idx ? ` --index-url "${idx}"` : '';
        // 无 --target：直接升级当前 python 的 pip 本体
        if (run(`${pipCmd} install --upgrade pip${idxArg} --disable-pip-version-check`)) {
            log('pip 已升级 ✅');
            return true;
        }
    }
    log('pip 升级失败（继续尝试安装，旧 pip 可能仍导致 "from versions: none"）');
    return true;
}

function runPip(pipCmd, spec, idx, useTarget) {
    const idxArg = idx ? ` --index-url "${idx}"` : '';
    const targetArg = useTarget ? ` --target "${SITE_PACKAGES}"` : '';
    return run(`${pipCmd} install ${spec}${idxArg}${targetArg} --disable-pip-version-check`);
}

function ensurePackage(pipCmd, useTarget, pkgName, markerName, fallbackSpecs) {
    const marker = path.join(SITE_PACKAGES, markerName.split('/')[0]);
    if (fs.existsSync(marker)) {
        log(`${markerName} 已安装，跳过`);
        return true;
    }
    fs.mkdirSync(SITE_PACKAGES, { recursive: true });
    const specs = [pkgName, ...(fallbackSpecs || [])];
    for (const spec of specs) {
        for (const idx of INDEXES) {
            log(`安装 ${spec}` + (idx ? `（镜像：${idx}）` : '（pip 默认源）'));
            if (runPip(pipCmd, spec, idx, useTarget) && fs.existsSync(marker)) {
                return true;
            }
        }
    }
    log(`${pkgName} 安装失败。若两套 Python 均异常，请安装 Python 3.10+ 并勾选 "Add to PATH" 后重试，或运行 npm run setup 重试。`);
    return false;
}

// 解压 STT 模型
function ensureModel() {
    if (fs.existsSync(MODEL_DIR)) {
        log('STT 模型已解压，跳过');
        return true;
    }
    if (!fs.existsSync(MODEL_ZIP)) {
        log('未找到 STT 模型 zip（stt_service/models/vosk-model-small-cn-0.22.zip）。');
        log('  请从 https://alphacephei.com/vosk/models 下载 vosk-model-small-cn-0.22.zip 放入上述目录后重新运行 npm run setup。');
        return false;
    }
    log('解压 STT 模型到 ' + MODEL_DIR);
    try {
        const AdmZip = require('adm-zip');
        const zip = new AdmZip(MODEL_ZIP);
        fs.mkdirSync(path.dirname(MODEL_DIR), { recursive: true });
        zip.extractAllTo(path.dirname(MODEL_DIR), true);
        return fs.existsSync(MODEL_DIR);
    } catch (e) {
        log('模型解压失败：' + e.message);
        return false;
    }
}

// 从 pip 命令串中取出真正的 Python 可执行命令（如 `python3`、`py -3`、`"C:\\...\\python.exe"`）
function pythonCmdOf(pipCmd) {
    return pipCmd ? pipCmd.replace(/\s+-m\s+pip.*$/, '').trim() : '';
}

// 以退出码判断命令是否成功（不打印输出）
function runOk(cmd) {
    try {
        execSync(cmd, { stdio: 'ignore' });
        return true;
    } catch (e) {
        return false;
    }
}

// 用「运行时将实际使用的 Python」实测 cffi + vosk 能否导入。
// 若 cffi 缺底层编译后端 `_cffi_backend`（如装了不带预编译二进制的版本），此处会失败，
// 从而在 install 阶段就暴露，而不是等 STT 启动时才报 "No module named '_cffi_backend'"。
function sttImportsWork(pipCmd) {
    const pyCmd = pythonCmdOf(pipCmd);
    if (!pyCmd) return false;
    // 系统 Python(--target 安装)需把 site-packages 手动加进 sys.path；嵌入式 Python 经 .pth 配置已可 import
    const pathC = useTarget ? `sys.path.insert(0, ${JSON.stringify(SITE_PACKAGES)});` : '';
    const code = `import sys;${pathC}import cffi;from vosk import Model, KaldiRecognizer`;
    return runOk(`${pyCmd} -c ${JSON.stringify(code)}`);
}

// 强制重装（忽略已有、可能损坏的包），逐版本 + 逐镜像回退
function forceInstall(pipCmd, specs) {
    fs.mkdirSync(SITE_PACKAGES, { recursive: true });
    for (const spec of specs) {
        for (const idx of INDEXES) {
            const idxArg = idx ? ` --index-url "${idx}"` : '';
            const targetArg = useTarget ? ` --target "${SITE_PACKAGES}"` : '';
            log(`强制重装 ${spec}` + (idx ? `（镜像：${idx}）` : '（pip 默认源）'));
            if (runOk(`${pipCmd} install --force-reinstall ${spec}${idxArg}${targetArg} --disable-pip-version-check`)) {
                return true;
            }
        }
    }
    return false;
}

// ---- 主流程 ----
let pipCmd = null;
let useTarget = false;

// 1) 首选：嵌入式 Python 运行时（Windows）
pipCmd = findEmbeddedPip();
if (pipCmd) useTarget = false;

// 2) 兜底：系统 Python/pip（--target 装进嵌入式运行时）
if (!pipCmd) {
    const sys = findSystemPip();
    if (sys) { pipCmd = sys; useTarget = true; }
}

if (pipCmd) ensurePipVersion(pipCmd);
const ttsOk = ensurePackage(pipCmd, useTarget, 'edge-tts', 'edge_tts', ['edge-tts==6.1.19', 'edge-tts==6.1.10']);
// ---- STT 依赖：显式安装 cffi（vosk 的依赖，提供 _cffi_backend 编译后端）+ vosk，并做可导入验证 ----
// 若不固定 cffi，pip 常解析到不带预编译 _cffi_backend 的新版本，导致运行时
// "No module named '_cffi_backend'"。这里固定到有预编译后端的稳定版本。
ensurePackage(pipCmd, useTarget, 'cffi', 'cffi', ['cffi==1.17.1', 'cffi==1.16.0', 'cffi==1.15.1']);
ensurePackage(pipCmd, useTarget, 'vosk', 'vosk', ['vosk==0.3.45', 'vosk==0.3.42']);
let sttOk = sttImportsWork(pipCmd);
if (!sttOk) {
    // 实测 import 失败：大概率是 cffi 装了缺 _cffi_backend 的版本，强制重装稳定版本后复验
    log('STT 依赖 import 验证失败（常见原因：cffi 缺少底层编译后端 _cffi_backend），尝试强制重装稳定版...');
    forceInstall(pipCmd, ['cffi==1.17.1', 'cffi==1.16.0', 'cffi==1.15.1']);
    forceInstall(pipCmd, ['vosk==0.3.45', 'vosk==0.3.42']);
    sttOk = sttImportsWork(pipCmd);
}
if (sttOk) log('STT 依赖验证通过：cffi + vosk 可正常导入 ✅');
else log('STT 依赖未能通过 import 验证，STT 功能暂时降级不可用。可修复后运行 `npm run setup`。');
const modelOk = ensureModel();

if (ttsOk && sttOk && modelOk) {
    log('全部依赖就绪：edge-tts、vosk、STT 模型。');
} else {
    log('部分依赖尚未就绪，TTS/STT 功能暂时降级。可修复后运行 `npm run setup`。');
}
// 始终以 0 退出，避免阻断 npm install
process.exit(0);