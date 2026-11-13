# 宿主契约与技术决策

## 0.3.0 当前聊天素材整理（FR-10）

核对本机1.19.0的getContext().chat及script.js消息写入：mes为当前消息文本、is_user区分玩家与角色、is_system表示系统消息、name为说话者；chat数组下标+1作为显示序号。只读取当前数组和当前选中swipe，不读其他聊天文件或历史swipe。

TavernHost.chatLength/readChat集中执行身份检查与范围读取。预览范围最多100条、原文合计最多100000字符，单条最多20000字符；系统消息不返回，空文本不返回，非法字段显式报错。AI提交最多50条、合计12000字符，单次最多8条素材、输出最多80000字符；超限拒绝而不截断。调用现有generateRaw适配器，共享在途锁，不读密钥。源码确认generateRaw会触发宿主提示事件，其他插件可修改提示；本扩展只主动提交所选消息，不承诺控制其他插件的处理。

个人素材schemaVersion保持1，新增可选method='ai'及source.chat快照（chatKey、messageNumber、role、speaker、transcript），兼容原有手工条目。来源text仅保存该条被引用消息，start/end从经核对的quote推导，不接受模型提供的原文或来源标签。保存时再次校验捕获的聊天标识与全文指纹；批量1–8条在同一IndexedDB事务完成，容量检查含本次数量；取消信号绑定至事务complete/abort，写请求success时复查来源，数据库提交点后无法回滚。没有自动数据迁移。

## 0.2.1 入口布局（FR-01）

核对本机1.19.0的 scripts/extensions.js、scripts/templates/wandMenu.html 和 caption 扩展：initExtensions 先创建 #extensionsMenu，菜单项使用 extension_container、list-group-item、extensionsMenuExtensionButton 等类，宿主统一处理菜单显隐。扩展只向该容器追加自有按钮，不点击发送按钮或改输入框；缺少菜单时使用可清理的 MutationObserver 等待其挂载，设置入口仍可用。

设置栏挂载到原有 #extensions_settings2（回退 #extensions_settings），用 details/summary 实现默认折叠与键盘操作，复用 inline-drawer-toggle/inline-drawer-header 外观类。summary 阻止 click 冒泡，避免酒馆委托的折叠逻辑与原生 details 双重切换；自有 toggle 事件更新箭头。所有宿主DOM接入集中到 src/host/entry-points.ts，初始化和卸载均清理自有节点及观察器，不改动其他扩展入口。

## 0.2.0 素材库契约

复用既有账号与角色身份，不新增宿主 API。IndexedDB v1 的 records 新增 `['material', user, character, id]` 与 `['material-favorite', user, character, id]` 键，不迁移故事记录。单条写入和收藏切换等事务完成才返回；个人素材最多 200 条，收藏最多 500 条，新增计数与写入在同一事务完成。素材带 schemaVersion=1，来源包含 label、text、start、end，摘录以 text.slice(start,end) 验证；原文 20000 字符、摘录 2000 字符。个人条目与内置条目使用不同 ID 前缀。只保存用户主动粘贴内容，无新增网络请求。备份导出是素材专用格式，不混用故事导入。

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
