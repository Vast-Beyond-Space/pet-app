/**
 * 一键引导脚本：检测本机工具链，并自动下载缺失的二进制资源。
 *
 * 从 GitHub 克隆仓库后，仓库不会包含体积较大的二进制文件，因此在有网络的
 * 情况下运行本脚本（npm install 的 postinstall 阶段自动触发，无需手动运行）：
 *
 *   1. 校验 node / npm / git / python / pip 是否可用；
 *   2. 若 electron/python/python.exe 不存在，自动下载 python-3.11.9-embed-amd64.zip；
 *   3. 若 STT 模型未解压且 zip 不存在，自动下载 vosk-model-small-cn-0.22.zip；
 *
 * 本脚本「容错」：任何一步失败仅打印警告，不会阻断 npm install。
 * 下载使用 Node 内置 https，不依赖第三方包，可在全新克隆下直接运行。
 */
const path = require('path');
const fs = require('fs');
const https = require('https');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// ---- 需要自动下载的资源（与仓库内现有文件保持一致） ----
const ASSETS = [
    {
        name: 'python-3.11.9-embed-amd64.zip',
        url: 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip',
        dest: path.join(ROOT, 'python-3.11.9-embed-amd64.zip'),
        // 存在该文件即认为资源已就绪（只要目标 zip 在）
        requirement: () => fs.existsSync(path.join(ROOT, 'python-3.11.9-embed-amd64.zip')),
    },
    {
        name: 'vosk-model-small-cn-0.22.zip',
        url: 'https://alphacephei.com/vosk/models/vosk-model-small-cn-0.22.zip',
        dest: path.join(ROOT, 'stt_service', 'models', 'vosk-model-small-cn-0.22.zip'),
        // 模型已解压或 zip 已存在均视为就绪
        requirement: () =>
            fs.existsSync(path.join(ROOT, 'stt_service', 'models', 'vosk-model-small-cn-0.22')) ||
            fs.existsSync(path.join(ROOT, 'stt_service', 'models', 'vosk-model-small-cn-0.22.zip')),
    },
];

function log(msg) {
    console.log('[bootstrap] ' + msg);
}

// ---- 工具链检测 ----
function checkCommand(cmd, versionFlag) {
    try {
        const out = execSync(`${cmd} ${versionFlag}`, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
        return out || true;
    } catch (e) {
        return null;
    }
}

function checkToolchain() {
    const node = checkCommand('node', '-v');
    const npm = checkCommand('npm', '-v');
    const git = checkCommand('git', '--version');
    let pip = checkCommand('python', '-m pip --version') || checkCommand('python3', '-m pip --version') || checkCommand('py -3', '-m pip --version');

    log('工具链检测：');
    log(`  node : ${node || '❌ 未安装（需安装 Node.js 14+，建议 18+）'}`);
    log(`  npm  : ${npm || '❌ 未安装（随 Node.js 一起安装）'}`);
    log(`  git  : ${git || '❌ 未安装（可选，仅在从源码构建时需要）'}`);
    log(`  pip  : ${pip ? '✅ 可用' : '❌ 未安装（TTS/STT 依赖需要。请安装 Python 3.8+ 并勾选 "Add to PATH"）'}`);

    const fatal = [];
    if (!node) fatal.push('Node.js');
    if (!npm) fatal.push('npm');

    // 打包/启动需要 node；缺 python/pip 只是 TTS/STT 降级，不致命
    if (fatal.length && process.env.NODE_ENV !== 'development') {
        log(`⚠️  缺少关键工具：${fatal.join('、')}。请先安装后再继续。`);
        // 仍返回，不阻断后续下载尝试；下载本身只依赖 node
    }
    return !!node;
}

// ---- 下载（支持重定向） ----
function downloadFile(url, dest, redirectsLeft = 5) {
    return new Promise((resolve) => {
        const finish = (ok) => {
            if (!ok && fs.existsSync(dest)) {
                try { fs.rmSync(dest, { force: true }); } catch (e) {}
            }
            resolve(ok);
        };

        let req;
        const handleError = (e) => {
            console.error(`    下载出错：${e.code || e.message}`);
            finish(false);
        };

        req = https.get(url, (res) => {
            // 处理重定向
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
                res.resume();
                const next = new URL(res.headers.location, url).toString();
                log(`    重定向到 ${next}`);
                downloadFile(next, dest, redirectsLeft - 1).then(finish);
                return;
            }
            if (res.statusCode !== 200) {
                console.error(`    HTTP ${res.statusCode}，下载失败：${url}`);
                res.resume();
                finish(false);
                return;
            }

            const size = parseInt(res.headers['content-length'] || '0', 10);
            log(`    开始下载（${size ? (size / 1024 / 1024).toFixed(1) + ' MB' : '大小未知'}）：${url}`);
            const file = fs.createWriteStream(dest);
            res.pipe(file);
            file.on('finish', () => file.close(() => finish(true)));
            file.on('error', handleError);
        });
        req.setTimeout(120000, () => req.destroy(new Error('下载超时')));
        req.on('error', handleError);
    });
}

// ---- 下载缺失资源 ----
let allOk = true;
async function downloadMissingAssets() {
    for (const asset of ASSETS) {
        fs.mkdirSync(path.dirname(asset.dest), { recursive: true });
        if (asset.requirement()) {
            log(`${asset.name} 已存在，跳过下载`);
            continue;
        }
        log(`下载缺失资源：${asset.name}`);
        const ok = await downloadFile(asset.url, asset.dest);
        if (ok) {
            log(`${asset.name} 下载完成 ✅`);
        } else {
            log(`${asset.name} 下载失败 ⚠️  可稍后手动下载放入：${asset.dest}`);
            allOk = false;
        }
    }
}

(async () => {
    const hasNode = checkToolchain();
    await downloadMissingAssets();

    if (allOk && hasNode) {
        log('引导完成：二进制资源就绪 ✅');
    } else {
        log('引导完成（部分资源未就绪，依赖安装阶段会给出具体提示）');
    }
    // 始终 0 退出，避免阻断 npm install
    process.exit(0);
})();