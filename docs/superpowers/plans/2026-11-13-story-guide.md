# 酒馆剧情指南 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可由 Git URL 安装的中文 SillyTavern 扩展及构建产物。

**Architecture:** 原生 DOM 面板与 SVG 流程图；TypeScript 领域逻辑、应用用例、宿主适配与持久化分层。模型仅生成待审核草稿，不自动修改聊天和原资料。

**Tech Stack:** TypeScript、esbuild、Zod、Node test runner；无 UI 框架与 CDN 运行时依赖。

**Spec:** docs/requirements.md、docs/project-conventions.md。

## Global Constraints

- 中文界面；单角色；有书解析与无书创作；明确来源；独立聊天进度。
- 原生扩展清单、预构建产物提交 Git；用户安装不需 npm。
- 验证过的宿主契约与测试结果独立记录，未测试能力不宣称支持。

## Review Focus

- 切角色时旧任务结果不可写入新角色，应用层测试覆盖。
- 存储失败不得更新已保存状态，存储测试覆盖。
- 无路线资料不能伪造作者结局，验证与提示测试覆盖。
- 隐藏信息不可通过图、搜索及建议泄漏，可见性测试覆盖。
- 导入恶意或损坏数据不得破坏已有版本，Schema 与存储测试覆盖。

## Task 1：领域和构建

Files: package.json、tsconfig.json、src/domain/story.ts、tests/domain.test.ts。

Interfaces: parseStory(unknown): Story；validateGraph(Story): string[]；visibleNodes(Story, RunState, boolean): StoryNode[]。

- [ ] 先写来源、图与可见性失败测试，执行确认失败。
- [ ] 实现 Schema、引用检查、图验证、条件计算、统一可见性。
- [ ] 执行测试、类型检查与构建。

## Task 2：宿主与持久化

Files: src/host/tavern.ts、src/storage/repository.ts、docs/host-contract.md、tests/storage.test.ts。

Interfaces: Host.snapshot(): Promise<ContextSnapshot>；Host.generate(prompt, signal): Promise<string>；Repository.saveStory/loadStories/saveRun/loadRun。

- [ ] 核对本机源码，记录上下文、世界书、模型调用与事件契约。
- [ ] 测试角色/聊天隔离、旧版本读取、写失败。
- [ ] 实现宿主读取、取消结果丢弃与账号范围的 IndexedDB 事务保存。

## Task 3：生成用例

Files: src/ai/prompts.ts、src/application/generate.ts、tests/generate.test.ts。

Interfaces: generateStory(host, input, signal, onProgress): Promise<Story>。

- [ ] 测试无效 JSON、来源错误、取消和批次失败，不允许虚假成功。
- [ ] 实现来源批次提取、合并、创作、一次格式修复，保留失败批次结果。
- [ ] 确保采用前运行图与来源校验；不自动调用聊天发送接口。

## Task 4：中文面板、图和游玩

Files: src/entry.ts、src/ui/panel.ts、src/ui/graph.ts、style.css、manifest.json。

- [ ] 实现资料选择、两种模式、草稿编辑、采用、图拖动缩放、分支编辑、来源查看。
- [ ] 实现无剧透指南、手动进度、撤销、聊天建议、版本选择、导入导出。
- [ ] 为交互和错误状态建立浏览器测试，检查窄屏与焦点。

## Task 5：发布准备和验证

Files: README.md、docs/verification.md、.github/workflows/ci.yml、dist/。

- [ ] 运行 typecheck、lint、test、build；提交可安装 bundle。
- [ ] 真实酒馆无模型读取与安装冒烟；有模型验证仅在实际可用时进行，不读取密钥。
- [ ] 记录未完成或未实测验收项，准备发布步骤与 GitHub URL 安装说明。
