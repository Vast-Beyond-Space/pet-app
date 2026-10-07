# AGENTS.md — 给后来 agent 的工作约定

> 本文件是写给在本项目（G:\electron 及其副本）中工作的 AI agent 的硬性约定，请遵守。

## 文件删除规则（重要）

- **删除文件/目录时直接删除（`del`/`rm`/`Remove-Item`），不要移入回收站**，也不要用任何"移到回收站"的第三方方式。本项目目录内被要求删除的东西（构建产物、临时文件、废弃脚本等）一律视为确认要删的。
- 删除前仍需**列清单说明要删什么**；删除后**报告结果**。
- 例外：涉及 `Desktop`/`Downloads`/`Documents` 等个人目录时，仍先请示用户，不适用本条。

## 临时文件夹维护

- **时常检查并清理临时文件夹**，至少在每次构建/打包任务开始前检查一次：
  - `G:\electron\.build-tmp\`（构建临时目录，脚本会自动清空，但失败中断时可能残留）
  - `G:\electron\dsh-temp\`（验收脚本的 out/err/png 产物，会持续累积）
  - `G:\electron\pip-*`（pip 构建残留目录，全部可删）
  - `G:\electron\dist\`（每轮打包约 1.5GB 中间产物，构建脚本不自动清理上一轮）
  - 系统临时目录（本项目曾用 `D:\Temp`，D 盘长期紧张，注意检查其占用）
- 清理后报告释放的空间大小。

## 背景备忘

- 项目曾因 `scripts/installer.nsh` 使用不存在的 NSIS 指令 `SetPluginsDir` 导致打包失败，2026-10-04 已修复（详见 `.workbuddy/memory/2026-10-04.md`）；`installer.nsh.disabled` 是废弃残留，勿再启用。
- 多份工程拷贝（F:\electron 只读参考 / G:\electron 主工作副本 / D:\pet-app\electron 副本）共用同一 appId 与 `%APPDATA%\pet-app`，多实例互锁会引发 `npm start` 报 0x5/EPERM——动 G 之前先确认没有残留 pet-app/electron 进程。
- F:\electron 是早期可正常打包的参考版本，**只读，禁止修改**。
- 完整备份（2026-10-06）位于 `F:\electron-backup-20261006`。
