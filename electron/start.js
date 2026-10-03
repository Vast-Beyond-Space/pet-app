// ============================================================
// start.js —— 启动器（npx/npm start 的入口）
// ------------------------------------------------------------
// 为什么不用 `electron .`：
//   npm 包 electron 的 CLI（cli.js）会读取环境变量 ELECTRON_RUN_AS_NODE。
//   某些受限终端 / 宿主程序会把这个变量注入到子进程环境里（在本机 `env`
//   里看不到，但每个子进程都继承），于是 Electron 被当成纯 Node 运行：
//       require('electron') 只返回 electron.exe 的路径字符串
//       → app 为 undefined → `app.commandLine` 抛 TypeError → 一闪而过
//   本脚本直接 spawn 打包好的 electron.exe，并显式从环境里删掉该变量，
//   因此 `npm start` 在任何终端里都能正常起来。
//
// 另外会探测「Chromium 沙箱是否可用」（远程桌面 / 容器 / 安全软件拦截时
// 沙箱初始化会失败，进程被系统以 0x80000003 终止），不可用则自动补上
// --no-sandbox --disable-gpu-sandbox。命令行里已显式给出这些开关时不再重复。
// ============================================================

const { spawn, execFileSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const root = __dirname
const argFile = path.join(root, 'node_modules', 'electron', 'path.txt')

function resolveElectronBinary() {
    // 标准路径优先：path.txt 里是 dist 目录下的可执行文件名
    try {
        const name = fs.readFileSync(argFile, 'utf8').trim()
        if (name) {
            const candidate = path.join(root, 'node_modules', 'electron', 'dist', name)
            if (fs.existsSync(candidate)) return candidate
        }
    } catch (e) { /* 继续往下找 */ }
    const fallbacks = [
        path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
        path.join(root, 'node_modules', 'electron', 'dist', 'electron'),
        path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
    ]
    for (const f of fallbacks) if (fs.existsSync(f)) return f
    return null
}

const binary = resolveElectronBinary()
if (!binary) {
    console.error('[start] 找不到 Electron 可执行文件。请先执行: npm install')
    process.exit(1)
}

const userArgs = process.argv.slice(2)
const hasSandboxFlag = userArgs.some((a) => /^--(no-sandbox|disable-gpu-sandbox)$/.test(a))

// 关键：先清掉会让 Electron 退化成纯 Node 的变量，再拿它去探测沙箱，
// 否则探测本身也会被当成 Node 运行，测出的结果没有意义。
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_NO_ATTACH_CONSOLE

// 探测 Chromium 沙箱是否可用：带沙箱启动 --version，非 0 退出即视为不可用
let sandboxOk = true
if (process.platform === 'win32' && !hasSandboxFlag) {
    try {
        sandboxOk = !!execFileSync(binary, ['--version'], {
            timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, env
        }).toString().trim()
    } catch (e) {
        sandboxOk = false
    }
}

const flags = []
if (!sandboxOk && !hasSandboxFlag) {
    flags.push('--no-sandbox', '--disable-gpu-sandbox')
    console.warn('[start] 当前环境 Chromium 沙箱不可用，已自动添加 --no-sandbox 启动。')
}

const target = ['.', ...userArgs]
console.log('[start] ' + binary + ' ' + [...flags, ...target].join(' '))

const child = spawn(binary, [...flags, ...target], {
    cwd: root,
    env,
    stdio: 'inherit',
    windowsHide: false
})

child.on('error', (err) => {
    console.error('[start] 启动 Electron 失败：' + err.message)
    process.exit(1)
})
child.on('exit', (code) => process.exit(code == null ? 0 : code))
