/**
 * 安装 TTS 服务所需的第三方依赖（edge-tts）到嵌入式 Python 运行时。
 * 在 Windows 上打包前执行：npm run setup-tts
 *
 * 说明：
 * - 嵌入式 python.exe 不带 pip，因此这里使用系统 Python 的 pip，
 *   通过 --target 把 edge-tts 及其依赖安装到 python/Lib/site-packages。
 * - python311._pth 已启用 site 并加入 Lib/site-packages，嵌入式运行时即可 import edge_tts。
 * - 该目录会随 extraResources("python") 一起打包，解决打包后 TTS 无声的问题。
 */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const TARGET = path.join(__dirname, '..', 'python', 'Lib', 'site-packages');
const MARKER = path.join(TARGET, 'edge_tts');

if (fs.existsSync(MARKER)) {
    console.log('[install-tts] edge_tts 已安装，跳过');
    process.exit(0);
}

fs.mkdirSync(TARGET, { recursive: true });
console.log('[install-tts] 安装 edge-tts 到 ' + TARGET);

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
    console.error('[install-tts] 未找到可用的 python/pip。');
    console.error('[install-tts] 请先在 Windows 安装 Python 并勾选 "Add to PATH"，然后重新运行。');
    process.exit(1);
}

try {
    execSync(`${cmd} -m pip install edge-tts --target "${TARGET}"`, { stdio: 'inherit' });
    console.log('[install-tts] 完成。可执行 npm run build 进行打包。');
} catch (e) {
    console.error('[install-tts] 安装失败：', e.message);
    process.exit(1);
}