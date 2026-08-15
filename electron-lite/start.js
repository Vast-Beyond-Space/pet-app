// electron-lite 启动器（独立版）：仅使用本目录安装的 electron
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const exe = path.join(__dirname, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
if (!fs.existsSync(exe)) {
    console.error('未找到 electron。请先在 electron-lite 目录运行 `npm install`。');
    process.exit(1);
}

const child = spawn(exe, [__dirname], { stdio: 'inherit' });
child.on('error', (err) => { console.error('启动失败：', err.message); process.exit(1); });
child.on('close', (code) => process.exit(code == null ? 0 : code));