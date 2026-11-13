# 聊天剧情归档JSON格式

入口：剧情指南 → 场景素材库 → 从当前聊天整理 → 保存聊天归档 / 导出所选聊天JSON。已保存文件在素材库的“聊天剧情归档”中再次导出。

此格式用于其他工具按角色管理聊天与归纳结果，不是可执行剧情，也不接受为故事JSON导入。全部文本按不可信数据处理。

| 字段 | 含义 |
| --- | --- |
| format | 固定 `story-guide-chat-archive` |
| schemaVersion | 当前为 `1`，与扩展版本号不同 |
| id | 该归档的独立标识 |
| characterKey / characterName | 角色稳定标识（avatar）与显示名，其他工具宜按characterKey分组 |
| chatKey | 来源聊天标识 |
| transcript | 捕获时当前聊天内容指纹，用于失效核对，不是安全散列 |
| createdAt | 归档创建时刻，ISO 8601格式；不是原消息发送时间 |
| status | `raw` 仅原文、`complete` 全部批次完成、`partial` 部分完成 |
| completedBatches / totalBatches | 已完成及计划模型批次数；raw状态均为0 |
| error | 部分完成时停止的原因，成功时不提供 |
| messages | 完整所选消息，最多50条，按聊天顺序保存 |
| messages[].number | 原聊天数组下标+1；过滤系统/空消息后序号可能不连续 |
| messages[].role / speaker / text | 玩家user或角色character、显示名及完整消息文本 |
| materials | 本次勾选并编辑后的归纳结果；仅导出原文时为空数组 |
| materials[].method / quote / source | AI标记、精确摘录及来源消息快照，含消息序号、chatKey和字符偏移 |

原文与AI结果分开存储。`complete`仅表示所有请求批次通过结构/摘录检查，并不保证AI理解正确或每条消息都有对应素材；模型可能返回零条适合的素材。

长消息分批时，导出的messages[].text仍为完整消息；素材source.start/end是相对于完整原消息的UTF-16偏移（与JavaScript slice一致）。不把自动分段当作新消息序号。

归档在当前浏览器按账号和角色隔离，每角色最多50份；导出文件不含账号凭证或API密钥。它包含你所选的聊天原文，分享前应自行确认内容。本版支持导出，不支持自动导入；后续格式变更另行记录。
