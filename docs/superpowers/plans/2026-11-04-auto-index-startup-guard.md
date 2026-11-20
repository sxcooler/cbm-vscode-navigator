# 自动索引启动保护 Implementation Plan

> **For agentic workers:** Implement this bounded change with TDD in the current repair branch; perform a fresh review before the final commit.

**Goal:** 开启自动索引时，加载扩展只检查配置，等待手动连接。
**Architecture:** 复用运行时探测的本地命令执行接口；在 `RootManager` 创建前拦截自动连接；复用连接/重试命令和现有连接后状态。
**Tech Stack:** TypeScript、VS Code API、Vitest、Node.js execFile。
**Spec:** `docs/superpowers/specs/2026-11-04-auto-index-startup-guard-design.md`

## Global Constraints

- 不写共享 CBM 配置，不重放原高负载目录的索引，不增加依赖。
- 当前分支 `fix/auto-index-startup-guard`；基线 `20c29fd`，116 passed / 4 skipped。
- 所有本次提交最终保留为一个中文提交。

## Review Focus

- CLI 失败、超时或未知输出均不能被当作 false。
- 取消手动确认不得建立 MCP 会话。
- 授予工作区信任后仍执行配置检查。
- 配置检查期间释放扩展不得启动后端。
- 手动连接显示 Connecting，并保留连接成功、缺索引及连接失败的原有状态。

## Task 1: 配置检查和连接状态

**Files:** `src/cbm/runtimeDiscovery{,.test}.ts`、`src/extension{,.test}.ts`、`src/contracts.ts`、`src/status{,.test}.ts`、`package{,-lock}.json`、`src/cbm/mcpClient.ts`、`README.md`、`CHANGELOG.md`。

- [x] 写读取布尔配置和初始化/手动连接的回归测试，运行旧实现确认失败。
- [x] 增加 `readAutoIndex(executablePath, run): Promise<boolean>`，仅执行 `config get auto_index`，5 秒超时，严格解析 true/false。
- [x] 增加 Disconnected / Connecting 状态；实现自动连接保护及手动确认，覆盖 Review Focus。
- [x] 运行目标测试、全量单元测试、TypeScript 检查、构建和现有 VS Code 集成检查。
- [x] 更新文档和版本，打包 VSIX，完成独立复核并准备单次中文提交。

## 验证记录

- RED：目标测试 17 failed / 12 passed，确认旧实现会绕过配置检查并缺少连接状态。
- GREEN：目标测试 29 passed；全量 133 passed / 4 skipped；TypeScript 检查通过。
- 独立 VS Code 1.135.0：激活与命令注册 1 passed；3 个需要实机导航参数的用例 pending。
- 本机 CBM 0.11.0：新读取函数使用与 MCP 相同的默认环境，实际执行只读配置命令得到 `true`。
- 独立只读复核未发现 Critical / Important / Minor 问题；现有安装后验证及已开始连接的生命周期不属于本次重构范围。
- VSIX：0.1.6，15 个文件；核对包内版本、连接命令和保护代码，开发源文件未入包。
- VSIX SHA-256：`8F9C663652692FFBC76E3725ADF6B8E3086F699B60597F85D36505118A880D41`。
- 未执行原高负载目录索引，未修改共享 CBM 配置。

## Task 2: 默认导航查询等待 5 秒

**Files:** `src/cbm/graphAdapter{,.test}.ts`、`src/extension.ts`、`src/test/contract/cbm.contract.test.ts`、`package.json`、`README.md`、`CHANGELOG.md`。

- [x] 用模拟 3 秒返回的查询复现原 2 秒取消问题；默认 5 秒边界测试同样在旧实现失败。
- [x] 将配置与运行时默认值改为 5000ms，扩展及契约测试复用构造函数默认值。
- [x] 验证慢查询成功、5 秒终止、自定义超时及编辑器主动取消，运行全量单元测试与类型检查。
- [x] 完成只读复核，准备与本会话启动保护改动合为单次中文提交；不重新打包，上一轮 VSIX 不包含本任务的导航超时调整。

本任务验证：旧实现目标测试 2 failed / 12 passed；实现后全量 136 passed / 4 skipped，TypeScript 检查通过。只读复核未发现问题，5 秒为单次图请求的超时。未运行真实大项目的慢查询，未执行构建或重新打包；现有 VSIX 哈希保持不变。
