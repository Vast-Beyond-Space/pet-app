// ============================================================
// sync-inline.mjs —— 一键把源码同步进 float.html（唯一的正确入口）
// ------------------------------------------------------------
// float.html 是唯一把渲染脚本与样式 base64 / 内联进 HTML 的页面：
//   · <script src="data:application/javascript;base64,...">  ← voice.js / ai-fallback.js / float.js
//   · <style> … </style>                                     ← float.css + css/float-ui-additions.css
// 两者必须同时同步，否则会出现「改了 float.js 但界面没变」这种坑。
//
// 本脚本按固定顺序执行两件事，并逐项校验结果：
//   1) 先同步 JS（inline-float.mjs 的逻辑，内联块内容必须与磁盘文件逐字节一致）
//   2) 再同步 CSS（inline-float-css.mjs 的逻辑，托管段保持一致）
// 顺序很重要：第 2 步会整份写回 float.html。
//
// 用法：
//   node scripts/sync-inline.mjs            # 同步 + 校验
//   node scripts/sync-inline.mjs --check    # 只校验，不写文件（CI / 提交前用）
// ============================================================

import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const root = process.cwd()
const htmlPath = join(root, 'float.html')
const cssPath = join(root, 'float.css')
const additionsPath = join(root, 'css', 'float-ui-additions.css')

const CHECK_ONLY = process.argv.includes('--check')
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16)

// ---------- JS 内联块 ----------
const JS_BLOCKS = [
    { file: 'voice.js', detect: 'VoiceManager' },
    { file: 'ai-fallback.js', detect: 'ai-fallback.js' },
    { file: 'float.js', detect: 'isChatMode' }
]

function findBlock(html, detect) {
    const re = /src="data:application\/javascript;base64,([A-Za-z0-9+/=]+)"/g
    let match
    while ((match = re.exec(html)) !== null) {
        const decoded = Buffer.from(match[1], 'base64').toString('utf8')
        if (decoded.includes(detect)) return { match, decoded }
    }
    return null
}

function findTagStart(html, detect) {
    const found = findBlock(html, detect)
    if (!found) return -1
    return html.lastIndexOf('<script', found.match.index)
}

function syncJs(html) {
    let changed = 0
    const report = []
    for (const block of JS_BLOCKS) {
        const source = readFileSync(join(root, block.file), 'utf8')
        const b64 = Buffer.from(source, 'utf8').toString('base64')
        const found = findBlock(html, block.detect)
        report.push({ file: block.file, inSync: !!found && found.decoded === source, size: source.length })
        if (CHECK_ONLY) continue
        if (found) {
            const attr = `src="data:application/javascript;base64,${b64}"`
            if (found.match[0] !== attr) {
                html = html.slice(0, found.match.index) + attr + html.slice(found.match.index + found.match[0].length)
                changed++
            }
            continue
        }
        const anchorStart = findTagStart(html, 'isChatMode')
        const tag = `<script src="data:application/javascript;base64,${b64}"></script>`
        if (anchorStart !== -1) {
            html = html.slice(0, anchorStart) + tag + '\r\n    ' + html.slice(anchorStart)
        } else {
            html = html.replace('</body>', `  ${tag}\r\n</body>`)
        }
        changed++
        console.log(`  [JS] 首次插入内联块：${block.file}`)
    }
    return { html, changed, report }
}

// ---------- CSS 托管段 ----------
const START = '/* ==== UI-REDESIGN-INJECT-START ==== */'
const END = '/* ==== UI-REDESIGN-INJECT-END ==== */'

function buildCssSection(additions) {
    const header =
        '\n\n' + START + '\n' +
        '/* 以下内容由 scripts/sync-inline.mjs 从 css/float-ui-additions.css 注入。\n' +
        '   请修改源文件后重新运行脚本，不要直接改这一段。 */\n'
    return header + additions.trimEnd() + '\n' + END + '\n'
}

function injectCss(text, section, label) {
    const startIdx = text.indexOf(START)
    const endIdx = text.indexOf(END)
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        if (CHECK_ONLY) {
            const current = text.slice(startIdx, endIdx + END.length)
            return { text, inSync: current === section.trimStart().replace(/\n$/, '') || current.trim() === section.trim() }
        }
        return { text: text.slice(0, startIdx) + section.trimStart() + text.slice(endIdx + END.length), inSync: true }
    }
    if (startIdx !== -1 || endIdx !== -1) {
        throw new Error(`[${label}] CSS 托管段标记不完整，请手工检查`)
    }
    if (CHECK_ONLY) return { text, inSync: false }
    return { text: text.trimEnd() + section, inSync: false }
}

// ---------- 主流程 ----------
let html = readFileSync(htmlPath, 'utf8')
const additions = readFileSync(additionsPath, 'utf8')
const cssSection = buildCssSection(additions)

console.log(CHECK_ONLY ? '模式：只校验' : '模式：同步')

const jsResult = syncJs(html)
html = jsResult.html

const cssResult = injectCss(html, cssSection, 'float.html<style>')
html = cssResult.text

// float.css 也要同步一份（开发时直接看 float.css 的场景）
let css = readFileSync(cssPath, 'utf8')
const cssFileResult = injectCss(css, cssSection, 'float.css')
css = cssFileResult.text

if (!CHECK_ONLY) {
    writeFileSync(htmlPath, html)
    writeFileSync(cssPath, css)
}

// ---------- 校验报告 ----------
let ok = true
console.log('\nJS 内联块：')
for (const r of jsResult.report) {
    const state = r.inSync ? '一致' : (CHECK_ONLY ? '不一致' : '已更新')
    console.log(`  ${r.inSync ? '✔' : (CHECK_ONLY ? '✘' : '↻')} ${r.file.padEnd(16)} ${String(r.size).padStart(7)} 字节  ${state}  sha:${sha(readFileSync(join(root, r.file), 'utf8'))}`)
    if (!r.inSync && CHECK_ONLY) ok = false
}
console.log('CSS 托管段：')
console.log(`  ${cssFileResult.inSync || !CHECK_ONLY ? '✔' : '✘'} float.css`)
console.log(`  ${cssResult.inSync || !CHECK_ONLY ? '✔' : '✘'} float.html <style>`)

// 写完再回读一次，确保落盘结果正确
if (!CHECK_ONLY) {
    const reread = readFileSync(htmlPath, 'utf8')
    for (const block of JS_BLOCKS) {
        const source = readFileSync(join(root, block.file), 'utf8')
        const found = findBlock(reread, block.detect)
        if (!found || found.decoded !== source) {
            console.error(`  ✘ 回读校验失败：${block.file} 未正确内联`)
            ok = false
        }
    }
}

console.log('\n' + (ok
    ? (CHECK_ONLY ? '校验通过：内联内容与源码一致。' : '同步完成：float.html 与 float.css 均为最新。')
    : '校验未通过：内联内容与源码不一致，请检查上面的 ✘ 项。'))

process.exit(ok ? 0 : 1)
