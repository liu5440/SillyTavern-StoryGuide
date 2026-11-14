# Galgame 剧情资料库、路线编辑与核心场景素材改造方案

日期：2026-11-14。状态：用户授权先按此方向推进，待实施、待验证，可按体验调整。本文件不声明功能已完成或模型质量已验证。

## 1. 产品问题与目标

用户认可现有资料阅读能力，但反馈事件和路线无法有效整理，素材结果没有抓住 CG 核心剧情，无法支持后续创作。当前证据是用户反馈及代码静态审查，尚无定量效果基线。

面向在 SillyTavern 游玩角色卡、维护剧情和整理已有聊天文本的玩家，提供“查资料—整理事件—编辑路线—保存复用”的闭环。允许任意风格世界书作为资料输入，不承诺所有世界书都能自动提取完整路线。没有世界书时仍可基于角色资料创作草稿。

产品采用原作剧情还原、AI 辅助路线生成、用户手动编辑确认三种能力。核心成果是可维护的剧情资料库和路线，而非把全部世界书条目画成节点。

## 2. 已发现的结构问题与最小改造边界

- `application/local-catalog.ts` 把每条原资料保存为 event；`analysis-result.ts` 再将资料卡附加到事件中。文案虽称“不代表事件”，数据仍混用。应分离资料与事件，不继续添加标题特判。
- `domain/story.ts` 的来源分类已有基础，但仅有故事级 draft/adopted，没有节点/关系逐项审核状态，也没有独立路线实体。
- 引用校验目前证明摘录存在，不能证明摘录支持关系语义；无效引用降为 inferred 后仍与其他内容共处一张图。
- `application/generate.ts` 一次要求模型输出事件及图；批次失败停止后续批次，最后再次由模型合并。应保存中间实体并逐项接收有效结果。
- 宿主读取遇到坏条目会升级为整本书错误；书名、数组下标及全文去重不够支持稳定来源身份和完整出处。
- `domain/materials.ts` 和 `ai/material-prompts.ts` 以服装、姿态、互动、场景及原创开场为目标，无法完整描述关键事件与关系转折。世界书 StoryMaterial 与现有聊天 Material 不得直接混用。

保留 TypeScript、Zod、现有宿主适配层、IndexedDB 事务、版本与上下文守卫、悬浮阅读、节点和连接编辑、SVG 图及 JSON 基础能力。不新增后台、账号、云服务或图像生成。本轮不更换 UI 框架或图库。

## 3. 来源、审核与路线规则（FR-02 / FR-03 / FR-05）

来源 origin：`worldbook_explicit`、`ai_inferred`、`ai_generated`、`user_manual`。审核 status：`draft`、`pending`、`confirmed`、`rejected`。来源、审核、路线完整度和本局进度互相独立。

- 原作事件/关系必须有可定位直接依据；不能因引用存在就自动视为语义成立。确定性结构提取可在校验后确认，模型理解的关系提供人工核对。
- ai_inferred 仅推断已有内容关系；ai_generated 表示新增创作，二者不混用。创作参考不冒充直接证据，用户确认也不改变来源类型。
- 人工实质改写保留原版本和出处，记录 user_manual 修订。共享事件编辑显示影响路线，用户主动创建变体时才复制。
- 正式图只读取 confirmed 事件和 confirmed 关系，关系两端均须有效。草稿独立预览，确认采用是原子操作。
- 禁止按人物名、条目顺序、位置、同组关系或视觉完整度创建连接。孤立事件和无边结果都是有效成果。
- 关系区分时间先于、剧情衔接、前置依赖、玩家选择和结局分支；时间先后不自动等价为可游玩跳转。
- 路线完整度区分 fragment 与 playable。片段缺入口、出口或结局是整理提示，不能阻止保存。重复 ID、悬空引用等是结构错误。
- P0 游玩衔接图仍限制环路；不将回忆、引用等非衔接关系套用同一种环路规则。完整可游玩路线再检查入口、出口和结局可达性，不要求整个事件库形成单一完整 DAG。

## 4. 世界书导入管线（FR-01 / FR-02）

读取并保存快照 → 逐条格式标准化 → 多标签分类 → 事件候选提取 → 明确关系候选提取 → 引用/结构/业务校验 → 事件库与待整理工作台 → 正式图。

候选关系推断由用户主动发起，不作为每次导入的强制模型调用。静态性格是人物资料；明确的行动和变化可提取事件；条件规则不是已发生事件。一条资料可关联多个分类、多个事件，不能确定的内容保留为素材。

逐条记录 read、normalize、classify、event、relation 阶段结果；读取失败、分类失败、没有事件、没有关系分别表达。无关系不是解析失败，单条异常不使好条目失效。批次保留完成范围和中间结果，不用空数据假装成功，不静默截断，不无限重试。

## 5. 核心场景素材纠偏（FR-09 / FR-10）

### 5.1 素材的价值单位

CG／关键场景指具有叙事价值的场景单元，不要求原文真的含有 CG 图片，也不据此增加图片生成能力。核心回答：谁在何种背景下做了什么、出现了什么选择或转折、人物关系和后续剧情发生了什么变化。

每项建议包含：稳定 ID、标题、参与人物、地点/时间、前情、触发条件、关键事件、选择、关系变化、结果/后果、关联路线/事件，以及完整原文归档定位。缺失信息标未知，不强行补齐；服装、姿态、氛围和物件作为可选辅助标签。

先提供“关键场景整理”和“原文收藏”，保留旧分类浏览及旧素材读取。用户可合并跨消息场景、拆分多个事件、编辑归纳并建立事件关联；不能将同一场景的每件服装分别算作核心剧情成果。

### 5.2 原文、提取、创作三个独立操作

1. 原文保存：不依赖 AI，保留所选文本、换行及定位；遵守明确容量限制，超限报错而不截断。已有 raw 归档优先及失败可恢复能力继续保留。
2. 已有内容提取：以用户提供文本为依据整理，不默认编写开场、不续写、不增加刺激性细节、不凭空补写行为或双方意愿。成人题材和敏感词不是整条消息、整个场景的自动排除依据；不能只留下穿搭与氛围却丢掉关键事件及后果。
3. 新增创作：用户主动选择才生成，独立草稿和来源标记，不混入原文事实，不作为提取成功的必要条件。

用户提供的成人题材文本可用于已有内容的整理和转换；本需求不要求模型绕过自身限制，也不承诺所有模型都能处理所有输入。模型拒绝、未提取、格式错误、引用失败及部分完成分别展示；不能悄悄改成无关日常素材。无法处理的内容保留原始归档及定位，供人工整理，不以空数组声称完成。

多消息场景使用证据数组，每段证据分别定位消息及连续摘录，不把跨消息拼接冒充单段原文。用户填写的摘要标人工，AI 摘要标模型归纳；引用必须保持逐字一致。

### 5.3 验收

- 固定场景样例能保留关键事件、选择、关系变化和后果；缺失字段明确未知，不为凑字段创作。
- 成人题材的已有文本整理不因单个敏感词丢弃整条消息；原文存档与归纳分别可查看，拒绝或失败有可解释结果。
- 提取默认不产生原创开场；已有原文不被 AI 改写或覆盖。
- 跨消息来源分别可定位；素材关联事件后不复制整份事件，不自动改路线或本局进度。
- 旧素材和原文归档仍可读、可导出，迁移失败可恢复。

## 6. 四个核心视图（FR-04 / FR-05 / FR-09）

| 视图 | 核心操作 |
| --- | --- |
| 剧情资料库 | 世界书导入、人物/地点/世界观/规则/剧情素材分类、搜索、原文与事件关联；允许零事件 |
| 剧情路线图 | 公共线/个人线切换、搜索和高亮、自动/手动布局、拖动连线、节点/条件编辑、多结局与未连接事件区 |
| AI 剧情工坊 | 人物、参考资料、风格、长度、推断/扩展/混合模式，生成、差异预览、编辑、确认；无书原创可用 |
| 待整理工作台 | 未分类、未连接、待确认关系、重复候选、冲突与异常，分别定位及人工处理 |

素材整理作为资料库中的独立入口，可从现有场景素材库访问，不要求先生成故事。保持手机阅读及窄屏体验；表单连线作为拖动连线的键盘/移动端替代。节点用类型和来源两种标识；AI 创作事件仍可属于选择、结局等事件类型。

从路线移除事件与从资料库删除事件分开；显示共享影响并提供恢复。拖入路线或自动布局不生成连线。边详情包含起终点、关系类型、选择文本、条件、来源、审核状态及编辑删除操作。正式预览与草稿预览明确分开，用户可逐项或整组确认依赖闭合的内容。

### 6.1 阅读入口与整理工作台（2026-11-14 用户补充，FR-04/05/06/08）

采用同一份数据的两种使用方式：日常游玩打开阅读面板，需要整理时主动点击“打开剧情工作台”。工作台仍位于酒馆扩展内，可关闭返回阅读；不新增独立网站。工作台是编辑容器，“待整理”是其中的问题处理视图，二者不是同一概念。切换视图保留当前选择、筛选、阅读位置和未保存编辑；离开或关闭时保护未保存内容，明确显示保存中、已保存及保存失败。

桌面宽屏工作台采用三栏：

| 左：剧情资料库 | 中：路线图 | 右：详情编辑 |
| --- | --- | --- |
| 世界背景、人物、地点、规则、事件池、待整理入口 | 当前公共线／个人线、选择分支、结局、未连接事件 | 节点或关系名称、简介、条件、来源证据、影响路线、保存和删除 |

- 人物筛选属于资料检索与路线筛选，不作为剧情节点。中央默认只显示当前路线引用的事件，不展示全部资料卡。
- 事件池可拖入当前路线，也可点“加入路线”；相同事件重复加入不复制实体。未确认事件加入编辑草稿，确认前不进入正式图。
- 人物背景、地点和规则不能直接拖成事件；可点“根据此资料建立事件”填写事件内容及来源，明确人工新增或原文依据，不凭资料名称生成剧情。
- 加入事件不自动连线；拖动端口或表单指定起终点，再编辑关系类型和条件。未连接事件可单独显示。
- “连线必须有依据”指来源可解释：原作边必须直接证据，AI 边必须人工确认；人工边标 user_manual 并记录人工确认，可无原文引文，不能伪造原作依据。此规则不能误伤用户自由创作。

### 6.2 移动端阅读与编辑

移动端默认面向“整理后查看和游玩”：可切换资料、事件、路线与关键场景，阅读完整正文、条件及来源；路线提供可缩放图和纵向分支列表，列表保留分支文本及目标事件，不能只展示一张缩小的桌面图。人物资料和背景不混入路线列表。

主动打开工作台后，按“资料／路线／详情”单栏切换，详情可全屏展开并返回原位置；中等宽度可采用两栏加详情抽屉，具体断点在实测后确定。手机可以点选事件加入路线、用起终点表单连线、编辑条件并保存，不要求精确拖动，也不将编辑能力仅限桌面。

阅读面板可收起恢复以继续酒馆聊天；工作台可主动放大，退出后回到阅读。软键盘弹出时表单可滚动，保存、取消及返回可达，图拖动不影响正文滚动。桌面与手机使用相同导入导出格式；当前本地存储不提供跨设备自动同步，跨设备使用需导出导入，不能把响应式适配宣传为同步能力。

P0 交互验收：

- 宽屏三栏完成“选资料—建立事件—加入路线—手动连线—编辑条件—保存—刷新恢复”；资料卡不出现在中央剧情节点中。
- 360px、390px、430px 宽度及横竖屏切换下，阅读无整页横向溢出；路线图可在自身区域平移，长正文、原文证据和分支列表可读。
- 手机不依赖拖动完成加入事件、连线、编辑条件和保存；软键盘不遮住必需操作，返回后选择与位置保留。
- 原作缺依据边不能确认为原作事实；用户手动边无引文仍可确认保存，刷新后来源与条件不丢失。
- 读图、切换人物或自动布局不创建关系；未确认候选不出现在正式阅读中；保存失败不显示已保存。

### 6.3 后续聊天事件与个人进度（P2，FR-07 / FR-10）

P0 完成后再引入聊天记录转事件及进度候选。用户主动选择当前聊天范围，提取实际发生事件，保留聊天/消息定位，并区分回忆、假设、未来计划；先供确认，再关联既有事件或保存本局事件。聊天事实不能标 worldbook_explicit，也不能自动改写共享原作路线。届时补独立的 chat_observed 来源契约，不硬塞进当前四种世界书/创作来源。

自动进度以可审阅、可撤销候选为默认；后续若提供自动采用，需另行明确授权和规则。删除、编辑、重生成及分支聊天使相关判断待核对，不沿用失效结果。不得在 P0 为此增加自动逐轮模型调用。

## 7. 数据契约草案（FR-02 / FR-05 / FR-08 / FR-09 / FR-10）

以下为逻辑设计，实际 Zod 契约及迁移实现后方可宣称格式受支持；当前运行时仍为旧格式。

```ts
type Id = string;
type Origin = 'worldbook_explicit' | 'ai_inferred' | 'ai_generated' | 'user_manual';
type Status = 'draft' | 'pending' | 'confirmed' | 'rejected';
interface Entity { id: Id; revision: number }
interface Evidence {
  sourceSnapshotId: Id;
  start: number; end: number; quote: string;
  role: 'direct_support' | 'creative_reference';
}
interface Authorship {
  origin: Origin; status: Status; evidence: Evidence[];
  rationale?: string; derivedFromId?: Id;
}
interface WorldbookSource extends Entity {
  sourceKey: Id; kind: 'worldbook_entry' | 'character_field';
  bookId?: Id; entryUid?: string; label: string;
  text: string; fingerprint: string; capturedAt: string;
}
interface StoryMaterial extends Entity, Authorship {
  sourceSnapshotIds: Id[];
  categories: Array<'character' | 'location' | 'world' | 'plot' | 'rule' | 'unclassified'>;
  title: string; summary: string; relatedEventIds: Id[];
}
interface StoryEvent extends Entity, Authorship {
  kind: 'opening' | 'event' | 'key_event' | 'choice' | 'route_entry' | 'ending';
  title: string; summary: string;
  characterMaterialIds: Id[]; locationMaterialIds: Id[]; materialIds: Id[];
  temporalRole: 'past' | 'initial' | 'possible_future' | 'unknown';
  preconditions: string[]; userEditedFields: string[]; locked: boolean;
}
interface StoryEdge extends Entity, Authorship {
  sourceNodeId: Id; targetNodeId: Id;
  relationType: 'precedes' | 'continues' | 'requires' | 'choice' | 'ending_branch';
  choiceText?: string;
  condition: { text: string; evaluation: 'manual' };
}
interface StoryRoute extends Entity {
  title: string; kind: 'common' | 'character' | 'custom';
  characterMaterialIds: Id[]; eventIds: Id[]; edgeIds: Id[];
  entryEventIds: Id[]; endingEventIds: Id[];
  completeness: 'fragment' | 'playable';
  positions: Record<Id, { x: number; y: number }>;
}
interface RouteDraft extends Entity {
  mode: 'infer' | 'expand' | 'mixed'; baseLibraryRevision: number;
  referenceSourceIds: Id[]; targetCharacterMaterialIds: Id[];
  style: string; length: string; status: Status;
  proposedEvents: StoryEvent[]; proposedEdges: StoryEdge[];
  proposedRoutes: StoryRoute[];
  updates: Array<{
    entityId: Id; baseRevision: number;
    proposed: StoryEvent | StoryEdge | StoryRoute;
  }>;
}
interface ImportReport extends Entity {
  sourceSnapshotIds: Id[];
  state: 'complete' | 'partial' | 'failed' | 'cancelled';
  issues: Array<{
    id: Id; sourceSnapshotId?: Id;
    stage: 'read' | 'normalize' | 'classify' | 'event' | 'relation';
    code: string; severity: 'info' | 'warning' | 'error'; message: string;
  }>;
}
interface SceneMaterial extends Entity {
  title: string; tags: string[]; participants: string[];
  location: string; time: string; context: string; trigger: string;
  keyEvents: string[]; choices: string[];
  relationshipChanges: string[]; consequences: string[];
  summaryOrigin: 'ai_extracted' | 'user_manual';
  status: Status; relatedEventIds: Id[]; relatedRouteIds: Id[];
  evidence: Array<{
    archiveId: Id; messageNumber: number;
    start: number; end: number; quote: string;
  }>;
}
interface StoryLibrary extends Entity {
  schemaVersion: 2; characterKey: Id;
  sources: WorldbookSource[]; materials: StoryMaterial[];
  events: StoryEvent[]; edges: StoryEdge[]; routes: StoryRoute[];
  drafts: RouteDraft[]; reports: ImportReport[];
}
```

sourceSnapshotId 指向不可变快照，sourceKey 指向逻辑来源；内容变化产生新快照而非覆盖旧证据。证据偏移采用 UTF-16 左闭右开，与 JavaScript slice 一致。人物/地点引用分别校验为对应分类的资料实体。SceneMaterial 单独存储，复用现有聊天原文归档，不强塞入世界书 StoryMaterial 或旧 Material。

实体首次接收后分配持久 ID；不能采用模型临时 ID、数组顺序或纯内容哈希作为永久身份。关系也有独立 ID，路线仅引用事件/关系。去重保留全部出处，同名不自动合并，歧义进入工作台。

## 8. 持久化、重导入与兼容（FR-08）

复用现有 IndexedDB，账号/角色隔离，聊天进度继续按聊天及故事版本隔离。多个书有独立来源身份，用户可显式组合跨书路线。路线布局独立保存，实体共享不导致布局共享。

迁移前保留并提供导出 v1 原记录，内存转换/校验后，在同一事务写 v2、ID 映射及完成标记；失败继续使用旧版，不原地覆盖。回滚后允许单独导出 v2 新编辑。无法可靠识别的旧资料节点进入待整理，不盲目把旧 explicit 全部认定为已确认事实。

重新导入对来源快照、上次提取结果及当前人工版本做三方差异比较；人工字段、锁定、手动边、拒绝记录及删除记录必须保留，不悄悄复活已删实体。新冲突先预览，旧采用版本保持有效。AI 草稿确认校验基准版本，避免覆盖较新人工修改。JSON 导入校验结构、体积、引用及冲突，提供另存，禁止静默替换。

## 9. 分阶段交付与验收

| 阶段 | 范围与 FR | 阶段出口 |
| --- | --- | --- |
| 0 文档与契约 | FR-02/05/08/09/10 | 本方案写入；实现前补运行时契约、历史样本和迁移回滚设计；不改代码冒充交付 |
| 1 P0 资料与事件分离 | FR-01/02/04/08 | 纯人设零事件可保存；坏条目不阻断好条目；原文完整可读导出；刷新恢复 |
| 2 P0 手动路线闭环 | FR-05/08 | 创建路线、共享事件、编辑连接条件、独立节点、布局、JSON 往返；同事件两路线 ID 相同、布局不同；片段无结局可保存 |
| 3 P0 核心场景素材 | FR-09/10 | 按第5节整理已有内容；不默认生成开场；保留原文和跨消息证据；人工编辑、事件关联及旧素材恢复可用 |
| 4 P0 安全重导入 | FR-02/08 | 原文变化差异预览；人工修改、手动连接、拒绝/删除记录保留；写失败旧版可恢复 |
| 5 P1 AI 候选与草稿 | FR-02/03/05 | 推断/扩展/混合最小生成审阅界面；未确认不入正式图；混合保留原事件 ID；人物线和多结局展示 |
| 6 P2 完整工坊与游玩辅助 | FR-03/07 | 完善工坊，再新增聊天关联、自动进度候选及解锁；不同聊天隔离，不反写原作事实 |

优先级保留既有功能，不以新计划删除当前手动进度或无书创作。P1 必须包含最小可用确认界面，不能等 P2 才提供人工审核。

当前执行范围锁定 P0（阶段1至4），阶段2同时交付第6.1/6.2节的最小工作台与移动端阅读/表单编辑，优先完成资料/事件分离、正式连接来源可信、手动连接持久化这三个闭环。新增 AI 自动路线和聊天自动进度不提前接入；P0 验收后再根据试用反馈调整后续阶段。

每阶段使用纯人物书、明确分支书、开放沙盒、冲突来源、重复正文多书、单条损坏及超长资料样例；素材阶段增加跨消息关键场景及成人题材已有文本整理样例。测试样例与生产真实数据分开。

当前量化基线未建立；各阶段发布前固定样例目标：无依据自动连线0、未确认AI内容进入正式图0、重导入丢失人工修改0、原文被提取结果覆盖0。关键场景预先人工标注事件/选择/变化/后果，逐项报告提取覆盖与错误，不用素材条数代替质量；首轮真实试用后再设质量阈值。

## 10. 风险、取舍与验证边界

- 自然语言证据不能完全自动证明关系，接受人工核对成本；不保证每本书都有完整路线。
- 大书按阶段保存中间结果，避免一次大合并重写全部图；模型限制、费用和输出长度分别实测。
- 共享编辑显示影响并保留历史；多标签与相同文本不等于同一事件。
- 本地保存不等于云备份，清理站点、换设备或地址仍依赖用户导出。
- 图性能先验证现有方案，再决定是否引入依赖；200节点/300边仍是待验证目标。
- 模型提取质量和成人题材转换能力受实际连接影响；不承诺统一支持，不自动切换模型或重试绕过拒绝。
- Mock 验证契约、失败、隔离和迁移；真实宿主单独验证读取、交互、模型质量、刷新恢复和导入导出。文档计划不能记为功能测试通过。

下一实施切片为阶段1；先确认迁移恢复方法，再分离资料和事件，保持已有阅读、原文归档与宿主交互可用。具体技术决策在实施前同步宿主契约，结果写入 verification.md。
