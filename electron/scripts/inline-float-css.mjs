// ============================================================
// inline-float-css.mjs —— 把 css/float-ui-additions.css 注入到
//   1) float.css 末尾
//   2) float.html 内联 <style> 块末尾
// ------------------------------------------------------------
// 背景：float.html 是「唯一把渲染脚本内联进 HTML」的页面（见 inline-float.mjs），
// 它的 <style> 块是 float.css 的一份压缩副本。UI 重做的增量样式如果只改一份，
// 两个窗口就会出现两套外观。所以这里统一由本脚本注入，两份永远一致。
//
// 只动被标记的托管段，其余内容按原样写回；脚本会校验字节数变化是否
// 恰好等于托管段的长度差，出现异常直接报错退出。
//
// 用法：node scripts/inline-float-css.mjs
// ============================================================

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const srcPath = join(root, 'css', 'float-ui-additions.css')
const cssPath = join(root, 'float.css')
const htmlPath = join(root, 'float.html')

const START = '/* ==== UI-REDESIGN-INJECT-START ==== */'
const END = '/* ==== UI-REDESIGN-INJECT-END ==== */'

/** 生成托管段（带标记的增量样式）。 */
function buildSection(additions) {
  const header =
    '\n\n' + START + '\n' +
    '/* 以下内容由 scripts/inline-float-css.mjs 从 css/float-ui-additions.css 注入。\n' +
    '   请修改源文件后重新运行脚本，不要直接改这一段。 */\n'
  return header + additions.trimEnd() + '\n' + END + '\n'
}

/** 替换（或首次插入）文件中的托管段。 */
function inject(text, additions, label) {
  const section = buildSection(additions)
  const startIdx = text.indexOf(START)
  const endIdx = text.indexOf(END)

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = text.slice(0, startIdx)
    const after = text.slice(endIdx + END.length)
    const out = before + section.trimStart() + after
    console.log(`[${label}] 替换已有托管段：${(endIdx + END.length) - startIdx} 字节 → ${section.trimStart().length} 字节`)
    return out
  }

  if (startIdx !== -1 || endIdx !== -1) {
    throw new Error(`[${label}] 托管段标记不完整（START=${startIdx} END=${endIdx}），请手工检查`)
  }

  console.log(`[${label}] 首次注入：追加 ${section.trimStart().length} 字节`)
  return text.trimEnd() + section
}

const additions = readFileSync(srcPath, 'utf8')
console.log(`源文件 css/float-ui-additions.css：${additions.length} 字节`)

// ---------- 1. float.css ----------
const css = readFileSync(cssPath, 'utf8')
const cssOut = inject(css, additions, 'float.css')
writeFileSync(cssPath, cssOut)
console.log(`[float.css] ${css.length} → ${cssOut.length} 字节`)

// ---------- 2. float.html 内联 <style> ----------
const html = readFileSync(htmlPath, 'utf8')
const open = html.indexOf('<style>')
const close = html.indexOf('</style>')

if (open === -1 || close === -1 || close < open) {
  throw new Error('float.html 中找不到完整的 <style>…</style> 块，已中止（未写入任何文件）')
}

const block = html.slice(open + '<style>'.length, close)
const blockOut = inject(block, additions, 'float.html<style>')
const htmlOut = html.slice(0, open + '<style>'.length) + blockOut + html.slice(close)

if (htmlOut.length - html.length !== blockOut.length - block.length) {
  throw new Error('float.html 写入前长度校验失败，已中止')
}

writeFileSync(htmlPath, htmlOut)
console.log(`[float.html] ${html.length} → ${htmlOut.length} 字节（内联块 ${block.length} → ${blockOut.length}）`)
console.log('完成：float.css 与 float.html 内联样式已同步为同一份增量样式。')
