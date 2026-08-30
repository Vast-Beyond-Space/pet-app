// ============================================================
// reinstall-dsh-plugin.mjs —— 把 F:\electron\dsh-plugin 重新安装进 DSH Desktop profile
// ------------------------------------------------------------
// 桌面版 DSH 的插件是「generation」快照机制（.generations/live/<id>）：
//   desired.json 是唯一权威（用户启用了哪些 generation）；
//   每次启动时 projectGenerations 会把 profile 的 node_modules/<plugin>
//   指向 desired 里的 generation，并重写 web/package.json 的 link: 依赖与 bundles。
// 因此「改工作区源码」不会生效，必须重建 generation 并更新 desired.json。
// 本脚本直接调用桌面 app 自带的 dsh-desktop-market-installer（与 app 安装插件同一套代码）：
//   1. 把插件源码复制进临时 staging 目录，用 pnpm 装成独立 generation
//   2. 用新 generation id 替换 desired.json 里旧的 dsh-pet-link 条目
//   3. 重新投影 profile（node_modules 链接 + package.json）
// 用法：node scripts/reinstall-dsh-plugin.mjs
// 完成后需要重启 DSH Desktop（插件代码在启动时加载）。
// ============================================================

import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

const dshHome =
  process.env.DSH_HOME || join(process.env.APPDATA || homedir(), 'dsh-desktop', 'harness')
const pluginName = 'dsh-pet-link'
const pluginSource = join(process.cwd(), 'dsh-plugin')

const installerDir = join(dshHome, 'profiles', 'node_modules', 'dsh-desktop-market-installer')
const installerRequire = createRequire(join(installerDir, 'index.js'))

const { installGeneration } = await import(pathToFileURL(join(installerDir, 'generations', 'installer.mjs')))
const { projectGenerations } = await import(pathToFileURL(join(installerDir, 'generations', 'projection.mjs')))
const {
  readDesired,
  writeDesired,
  listGenerations,
  withRegistryLock,
} = await import(pathToFileURL(join(installerDir, 'generations', 'registry.mjs')))

// pnpm 入口（installer 自己声明的依赖，位于 profiles/node_modules/pnpm）
const pnpmManifest = installerRequire.resolve('pnpm')
const pnpmRoot = dirname(pnpmManifest)
const pnpmEntryPath = [join(pnpmRoot, 'bin', 'pnpm.cjs'), join(pnpmRoot, 'bin', 'pnpm.mjs')].find(existsSync)
if (!pnpmEntryPath) throw new Error('pnpm entry not found')
if (!existsSync(pluginSource)) throw new Error(`plugin source not found: ${pluginSource}`)

console.log(`dshHome     : ${dshHome}`)
console.log(`pluginSource: ${pluginSource}`)
console.log(`pnpm        : ${pnpmEntryPath}`)

const outcome = await withRegistryLock(dshHome, async () => {
  console.log('--- 1/3 构建新 generation（staging + pnpm install）---')
  const install = await installGeneration({
    dshHome,
    pluginSpec: `link:${pluginSource.split('\\').join('/')}`,
    expectedPluginName: pluginName,
    sourceSpec: `link:${pluginSource.split('\\').join('/')}`,
    sourceDirectory: pluginSource,
    nodeExecutablePath: process.execPath,
    pnpmEntryPath,
    onTrace: (line) => console.log(`  [installer] ${line}`),
    onOutput: (chunk) => process.stdout.write(chunk),
  })
  if (!install.ok || install.generation === undefined) {
    throw new Error(install.detail ?? 'generation install failed')
  }
  const generation = install.generation
  console.log(`  新 generation: ${generation.id} @ ${generation.directory}`)

  // 与 app 的 validateGeneration 一致：名称/版本/补丁文件
  const packageDir = join(generation.directory, 'node_modules', pluginName)
  const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'))
  if (manifest.name !== pluginName) throw new Error(`installed name mismatch: ${manifest.name}`)
  const patch = manifest.dsh?.bundle?.patch
  if (typeof patch !== 'string' || !existsSync(join(packageDir, patch))) {
    throw new Error('generation has no readable bundle patch')
  }
  const installedIndex = await readFile(join(packageDir, 'index.js'), 'utf8')
  const sourceIndex = await readFile(join(pluginSource, 'index.js'), 'utf8')
  console.log(`  index.js 与工作区一致: ${installedIndex === sourceIndex}`)

  console.log('--- 2/3 更新 desired.json（替换旧 generation）---')
  const [desired, generations] = await Promise.all([readDesired(dshHome), listGenerations(dshHome)])
  const byId = new Map(generations.map((g) => [g.id, g]))
  const kept = desired.filter((id) => {
    const g = byId.get(id)
    return g === undefined || g.pluginName !== pluginName
  })
  const removed = desired.filter((id) => !kept.includes(id))
  if (removed.length > 0) console.log(`  移除旧条目: ${removed.join(', ')}`)
  await writeDesired(dshHome, [...kept, generation.id])
  console.log(`  desired.json 现在: ${JSON.stringify([...kept, generation.id])}`)

  console.log('--- 3/3 投影 profile（node_modules 链接 + web/package.json）---')
  const projection = await projectGenerations(dshHome)
  console.log(`  已链接: ${projection.linked.join(', ')}`)
  console.log(`  bundles: ${JSON.stringify(projection.bundles)}`)

  return { generation, removed }
})

console.log('--- 完成 ---')
console.log(`新插件已就绪: ${outcome.generation.id}`)
console.log('请重启 DSH Desktop（旧 generation 会在下次冷启动时被清扫）。')
