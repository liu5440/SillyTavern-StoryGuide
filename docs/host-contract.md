# 宿主契约与技术决策

2026-11-13：核对本机 `H:/sillytavern/SillyTavern` 源码，package.json 为 1.19.0。此记录是源码契约，不等于完成真实模型测试。

- `SillyTavern.getContext()`：角色列表、characterId、groupId、chatId、getCurrentChatId、chat、eventSource/eventTypes、generateRaw、loadWorldInfo、getWorldInfoNames、accountStorage。群聊首版拒绝。
- 角色：使用 avatar 作为身份；描述等取 data 字段或顶层；主世界书为 data.extensions.world，内嵌书为 data.character_book.entries。
- 附加世界书：`/scripts/world-info.js` 导出 world_info.charLore；按去扩展名的 avatar 匹配 name，取 extraBooks；聊天书为 chatMetadata.world_info。动态导入的宿主路径与扩展安装目录无关。
- `loadWorldInfo(name)`：Promise 返回 `{ entries: Record<uid, entry> }`，失败返回 null，不可当空书。entry.content/comment/key/disable 对应内容/标题/关键词/禁用。
- `generateRaw({prompt, systemPrompt, responseLength, trimNames})`：返回 Promise<string>，使用当前模型配置，不主动包含聊天和世界书；仅发送扩展显式选取资料。
- generateRaw 没有局部 AbortSignal 参数：取消逻辑停止后续批次、丢弃返回结果，不调用全局 stopGeneration 影响玩家聊天。UI 明示服务端可能继续计费；实际请求未结束前阻止再次生成。
- `eventSource.on/removeListener` 配合 eventTypes.CHAT_CHANGED、MESSAGE_EDITED、MESSAGE_DELETED、MESSAGE_SWIPED；切聊天使任务结果过期；编辑消息使本局进度待核对。
- `/scripts/user.js` 导出 getCurrentUserHandle，用作 IndexedDB 账号命名空间。正文仅保存在当前浏览器当前站点，事务完成才表示本地保存，不声称同步服务器。更换浏览器前导出备份。
- 扩展入口挂到 `#extensions_settings2`（回退 `#extensions_settings`），独立原生 dialog 承载主面板。

技术决策：TypeScript strict；esbuild 生成单个 ES Module，提交 dist/index.js；原生 DOM 与 SVG 避免框架和图组件依赖。Zod 3.24.2（MIT）随 bundle 用于不可信数据校验，运行时无 CDN/遥测。开发依赖不参与用户安装。

限制：解析单批 12000 字符，单条会拆分但保留原来源 ID；最多 2000 个来源、500 节点、1500 边、8 MB 字符导入。超过时显式拒绝，不静默截断。条件首版在图边使用人工可读说明，自动变量表达式作为后续能力；不会执行条件脚本。
