/**
 * postinstall / setup-tts：把 edge-tts 安装到嵌入式 Python 的 Lib/site-packages。
 * 嵌入式 python.exe 不带 pip，因此用系统 Python 的 pip，通过 --target 安装。
 * python311._pth 已启用 site 并加入 Lib/site-packages，独立运行时即可 import edge_tts。
 */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const TARGET = path.join(__dirname, '..', 'python', 'Lib', 'site-packages');
const MARKER = path.join(TARGET, 'edge_tts');

if (fs.existsSync(MARKER)) {
    console.log('[tts] edge_tts 已安装，跳过');
    process.exit(0);
}

fs.mkdirSync(TARGET, { recursive: true });
console.log('[tts] 安装 edge-tts 到 ' + TARGET);

// 查找可用的系统 Python/pip
let cmd = null;
const candidates = ['python', 'py -3', 'python3'];
for (const c of candidates) {
    try {
        execSync(`${c} -m pip --version`, { stdio: 'ignore' });
        cmd = c;
        break;
    } catch (e) { /* 尝试下一个 */ }
}
if (!cmd) {
    console.error('[tts] 未找到可用的 python/pip。');
    console.error('[tts] 请先在 Windows 安装 Python 并勾选 "Add to PATH"，然后重新运行 `npm run setup-tts`。');
    process.exit(1);
}

try {
    execSync(`${cmd} -m pip install edge-tts --target "${TARGET}"`, { stdio: 'inherit' });
    console.log('[tts] edge-tts 安装完成。');
} catch (e) {
    console.error('[tts] 安装失败：', e.message);
    process.exit(1);
}