// ============================================================
// inline-float.mjs —— 把 voice.js / ai-fallback.js / float.js 重新 base64 内联进 float.html
// ------------------------------------------------------------
// float.html 是唯一把渲染脚本 base64 内联进 HTML 的页面（浮窗/聊天/设置窗口都加载它，
// 不引用外部脚本）。因此改完这些 .js 后必须重跑本脚本，改动才会生效。
// 用法：node scripts/inline-float.mjs
// ============================================================

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const htmlPath = join(root, 'float.html')

// 需要内联的脚本：顺序即加载顺序（ai-fallback 必须在 float.js 之前）
const BLOCKS = [
  { file: 'voice.js', detect: 'VoiceManager' },
  { file: 'ai-fallback.js', detect: 'ai-fallback.js' },
  { file: 'float.js', detect: 'isChatMode' },
]

/** 按解码内容特征定位内联脚本块（不依赖块的顺序）。 */
function findBlock(html, detect) {
  const re = /src="data:application\/javascript;base64,([A-Za-z0-9+/=]+)"/g
  let match
  while ((match = re.exec(html)) !== null) {
    const decoded = Buffer.from(match[1], 'base64').toString('utf8')
    if (decoded.includes(detect)) return match
  }
  return null
}

function encode(file) {
  return Buffer.from(readFileSync(join(root, file), 'utf8'), 'utf8').toString('base64')
}

/** 找到包含 detect 内容的 <script ...> 标签整体（含标签起始位置）。 */
function findTagStart(html, detect) {
  const match = findBlock(html, detect)
  if (!match) return -1
  const start = html.lastIndexOf('<script', match.index)
  return start === -1 ? -1 : start
}

let html = readFileSync(htmlPath, 'utf8')
let changed = 0

for (const block of BLOCKS) {
  const b64 = encode(block.file)
  const found = findBlock(html, block.detect)
  if (found) {
    const attr = `src="data:application/javascript;base64,${b64}"`
    if (found[0] !== attr) {
      html = html.slice(0, found.index) + attr + html.slice(found.index + found[0].length)
      changed++
    }
    continue
  }
  // 尚未内联过：整块插到 float.js 标签之前（保证依赖顺序），没有 float.js 块时插到 </body> 前
  const anchorStart = findTagStart(html, 'isChatMode')
  const tag = `<script src="data:application/javascript;base64,${b64}"></script>`
  if (anchorStart !== -1) {
    html = html.slice(0, anchorStart) + tag + '\r\n    ' + html.slice(anchorStart)
  } else {
    html = html.replace('</body>', `  ${tag}\r\n</body>`)
  }
  changed++
  console.log(`inserted inline block: ${block.file}`)
}

writeFileSync(htmlPath, html)
console.log(`float.html inline scripts updated (${BLOCKS.map(b => b.file).join(' + ')}), changed=${changed}`)
