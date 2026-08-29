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

function run(cmd, args) {
    console.log(`\n$ ${cmd} ${args.join(' ')}`);
    const res = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: true });
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
run('npx', ['electron-builder', '--win', '--x64']);

console.log('\n打包完成 ✅  安装包位于 dist/ 目录：' + path.join(ROOT, 'dist'));