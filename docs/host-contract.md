# 宿主契约与技术决策

## 0.4.0 分批与聊天归档（覆盖下方旧版单请求限制）

FR-10默认预览最近50条，范围仍最多100条，预览原文合计上限改为1000000字符。一次勾选1–50条，每条最多20000字符；应用层按12000字符顺序分批，长消息拆分保持offset，不切断UTF-16代理对。prompt只含当前批片段；引用先在批内核对再映射到完整原文。每批最多8条素材，总结果最多200条；某批失败停止并保留先前完成结果，记录批次数，不自动重试。每批180秒，取消/切聊天仍丢弃整个旧任务。

素材批量写入上限扩为200条（角色总容量仍200），沿用事务取消检查。新增records键 `['chat-archive',user,character,id]`，不升级数据库版本；归档独立format/schemaVersion，最多50消息、200素材，每账号每角色50份，数量检查/写入和取消信号处于同一事务。保存原文无需调用模型，归档列表按当前账号角色查询，删除和导出不改原聊天。

归档字段见chat-archive-format.md。partial状态保留完整所选原文及已完成素材，不宣称后续批次已处理；raw状态完成批次数为0。旧故事/素材格式不变，无破坏性迁移。

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

## 0.4.1 故事请求等待契约（FR-02 / FR-03）

故事每次模型调用独立180秒上限，包括修复与合并；应用层竞速结束本地等待，清理定时器和取消监听。宿主原生generateRaw无单请求AbortSignal，超时/取消不调用全局停止，不保证远端停止。适配层在真实宿主请求settle前保留互斥；同步抛错也必须释放。每秒报告阶段与已等待时间；失败输出只修复一次，展示简短校验原因，不记录聊天原文。

## 0.4.2 诊断边界

适配层generate包装原有generateRaw，不改变连接、提示或模型参数。每次宿主请求记录同一AbortSignal对应的随机编号、API类型白名单、字数、耗时和安全错误分类；应用请求记录生成/解析/合并/修复阶段。故事校验记录独立事件编号和已知字段路径/错误码，未知字段名脱敏。日志全页面共享，不能识别角色，无原文；内存最多100条，刷新即清空。日志面板只以textContent渲染，导出由玩家主动触发，不联网。

## 0.4.3 聊天等待契约

聊天整理复用requestModel单请求竞速、计时及取消清理，不再依赖宿主响应abort才结束等待。保留原生generateRaw及互斥，不新增模型服务。打开窗口仅调用当前聊天只读预览；用户点击整理前不发送模型请求。
