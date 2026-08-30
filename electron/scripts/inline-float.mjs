// ============================================================
// inline-float.mjs —— 把 voice.js / float.js 重新 base64 内联进 float.html
// ------------------------------------------------------------
// float.html 是唯一把渲染脚本 base64 内联进 HTML 的页面（浮窗/聊天窗口都加载它，
// 不引用外部脚本）。因此改完 float.js / voice.js 后必须重跑本脚本，改动才会生效。
// 用法：node scripts/inline-float.mjs
// ============================================================

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const htmlPath = join(root, 'float.html')

/** 按解码内容特征替换内联脚本块（不依赖块的顺序）。 */
function replaceBlock(html, sourceFile, detect) {
  const code = readFileSync(join(root, sourceFile), 'utf8')
  const b64 = Buffer.from(code, 'utf8').toString('base64')
  const re = /src="data:application\/javascript;base64,([A-Za-z0-9+/=]+)"/g
  let match
  while ((match = re.exec(html)) !== null) {
    const decoded = Buffer.from(match[1], 'base64').toString('utf8')
    if (decoded.includes(detect)) {
      const attr = `src="data:application/javascript;base64,${b64}"`
      return { html: html.slice(0, match.index) + attr + html.slice(match.index + match[0].length), replaced: true }
    }
  }
  throw new Error(`inline block not found for ${sourceFile} (detect: "${detect}")`)
}

let html = readFileSync(htmlPath, 'utf8')
html = replaceBlock(html, 'voice.js', 'VoiceManager').html
html = replaceBlock(html, 'float.js', 'isChatMode').html
writeFileSync(htmlPath, html)
console.log('float.html inline scripts updated (voice.js + float.js)')
