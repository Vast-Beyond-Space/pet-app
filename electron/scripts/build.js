/**
 * 一键打包脚本：确保二进制资源就绪 → 安装 Python 依赖 → 触发 electron-builder。
 *
 * 从 GitHub 克隆后，在项目根目录依次执行：
 *   npm install            # 自动下载 python 运行时 + STT 模型 + 安装 TTS/STT 依赖
 *   npm run build          # 一键打包 Windows 安装包（输出到 dist/）
 *
 * 若跳过 npm install 直接运行 build，本脚本也会先兜底下载缺失资源并安装依赖。
 */
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// NSIS 在打包卸载器时需要向临时目录写入插件临时文件；当系统临时目录不可写/接近写满
// （例如受限环境或系统盘空间不足）时，会报
// "Error writing temporary file. Make sure your temp folder is valid" 并以退出码 2 失败。
// 这里为整个构建过程指定项目内独立、可写的临时目录，规避该问题。
const BUILD_TMP = process.env.PETAPP_BUILD_TMP || path.join(ROOT, '.build-tmp');
// 先清空上一轮遗留：多次打包会让临时目录持续膨胀（曾累积到数 GB）。
try { fs.rmSync(BUILD_TMP, { recursive: true, force: true }); } catch (e) {}
fs.mkdirSync(BUILD_TMP, { recursive: true });
const BUILD_ENV = { ...process.env, TEMP: BUILD_TMP, TMP: BUILD_TMP, TMPDIR: BUILD_TMP };

// 一次完整打包会在项目盘上额外产生约 1.5GB 中间产物
// （win-unpacked + .nsis.7z + setup.exe）。空间不足时最典型的表现就是
// NSIS 报 "Error writing temporary file. Make sure your temp folder is valid"。
function warnIfLowSpace(minGB) {
    try {
        const st = fs.statfsSync(ROOT);
        const freeGB = (st.bsize * st.bavail) / (1024 ** 3);
        console.log(`[build] 项目所在盘剩余空间：${freeGB.toFixed(1)} GB`);
        if (freeGB < minGB) {
            console.warn(`[build] ⚠️ 剩余空间低于 ${minGB} GB，打包/安装很可能因临时文件写入失败而中断。`);
            console.warn('[build]    建议清理空间，或把工程放到空间充足的盘（如 G:）再打包。');
        }
    } catch (e) { /* 旧版 Node 无 statfsSync，跳过检查 */ }
}

function run(cmd, args) {
    console.log(`\n$ ${cmd} ${args.join(' ')}`);
    const res = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: true, env: BUILD_ENV });
    if (res.status !== 0) {
        console.error(`${cmd} 执行失败（退出码 ${res.status}）`);
        process.exit(res.status == null ? 1 : res.status);
    }
    return res;
}

// 1. 兜底：确保 python 运行时与 STT 模型 zip 已下载
console.log('\n===== [build] 1/3 检查并下载缺失资源 =====');
run('node', ['scripts/bootstrap.js']);

// 2. 解压 python 运行时 + 安装 TTS/STT Python 依赖
console.log('\n===== [build] 2/3 安装 Python 依赖 =====');
run('node', ['scripts/extract-python.js']);
run('node', ['scripts/install-python-deps.js']);

// 3. 打包
console.log('\n===== [build] 3/3 打包 Windows 安装包 =====');
warnIfLowSpace(4);
run('npx', ['electron-builder', '--win', '--x64']);

console.log('\n打包完成 ✅  安装包位于 dist/ 目录：' + path.join(ROOT, 'dist'));