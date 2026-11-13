import { z } from 'zod';

const text = z.string().max(20000);
const id = z.string().min(1).max(180);
export const provenanceSchema = z.enum(['explicit', 'inferred', 'original', 'user']);
export const refSchema = z.object({ sourceId: id, quote: z.string().min(1).max(2000) }).strict();
export const sourceSchema = z.object({ id, label: text, text: z.string().max(300000), disabled: z.boolean(), fingerprint: id }).strict();
export const nodeSchema = z.object({
  id, type: z.enum(['start', 'event', 'choice', 'ending']), title: z.string().min(1).max(160), summary: text,
  location: text, characters: z.array(z.string().max(160)).max(50), time: text, chapter: text,
  provenance: provenanceSchema, refs: z.array(refSchema).max(30), spoiler: z.boolean(), locked: z.boolean(),
}).strict();
export const edgeSchema = z.object({ id, from: id, to: id, label: text, condition: text, provenance: provenanceSchema, refs: z.array(refSchema).max(30) }).strict();
export const storySchema = z.object({
  schemaVersion: z.literal(1), id, revision: z.number().int().positive(), characterKey: id,
  title: z.string().min(1).max(160), summary: text, mode: z.enum(['analyze', 'create']), status: z.enum(['draft', 'adopted']), createdAt: text,
  sources: z.array(sourceSchema).max(2000), nodes: z.array(nodeSchema).max(500), edges: z.array(edgeSchema).max(1500),
  positions: z.record(z.object({ x: z.number().finite().min(0).max(20000), y: z.number().finite().min(0).max(20000) }).strict()),
}).strict();
export type Story = z.infer<typeof storySchema>;
export type StoryNode = z.infer<typeof nodeSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type Edge = z.infer<typeof edgeSchema>;
export const runSchema = z.object({ schemaVersion: z.literal(1), storyId: id, revision: z.number().int().positive(), chatKey: id, current: z.string().max(180), states: z.record(z.enum(['done', 'skipped', 'pending'])), variables: z.record(z.union([z.boolean(), z.number().finite(), z.string().max(200)])), choices: z.array(id).max(1500), transcript: z.string().max(100), needsReview: z.boolean() }).strict();
export type RunState = z.infer<typeof runSchema>;
export type ProgressView = Pick<RunState, 'current' | 'states'>;

/** 先限制文本体积并拒绝危险键，再验证结构；导入结果始终是新对象。 */
export function parseStory(value: unknown): Story {
  const raw = JSON.stringify(value);
  if (!raw || raw.length > 8_000_000) throw new Error('故事文件超过 8 MB 字符限制');
  if (/"(?:__proto__|constructor|prototype)"\s*:/.test(raw)) throw new Error('文件含非法键');
  return storySchema.parse(value);
}

/** 图与引用使用同一份结构校验；资料不提供路线时允许事件清单，没有结局要求。 */
export function validateGraph(story: Story): string[] {
  const errors: string[] = [];
  const ids = new Set(story.nodes.map(n => n.id));
  if (ids.size !== story.nodes.length) errors.push('节点 ID 重复');
  if (new Set(story.edges.map(e => e.id)).size !== story.edges.length) errors.push('连线 ID 重复');
  const sources = new Map(story.sources.map(s => [s.id, s]));
  if (sources.size !== story.sources.length) errors.push('来源 ID 重复');
  for (const item of [...story.nodes, ...story.edges]) {
    if (item.provenance === 'explicit' && item.refs.length === 0) errors.push(`${item.id} 缺少原文来源`);
    if (story.mode === 'analyze' && item.provenance === 'original') errors.push(`${item.id} 解析模式不能混入原创事件`);
    for (const ref of item.refs) {
      const source = sources.get(ref.sourceId);
      if (!source) errors.push(`${item.id} 来源不存在：${ref.sourceId}`);
      else if (!source.text.includes(ref.quote)) errors.push(`${item.id} 摘录不在原文中`);
    }
  }
  const adjacency = new Map(story.nodes.map(n => [n.id, [] as string[]]));
  const incoming = new Set<string>();
  for (const edge of story.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) errors.push(`连线 ${edge.id} 的节点不存在`);
    else { adjacency.get(edge.from)?.push(edge.to); incoming.add(edge.to); }
  }
  const visiting = new Set<string>(); const visited = new Set<string>();
  function visit(key: string): boolean {
    if (visiting.has(key)) return true;
    if (visited.has(key)) return false;
    visiting.add(key);
    for (const next of adjacency.get(key) ?? []) if (visit(next)) return true;
    visiting.delete(key); visited.add(key); return false;
  }
  for (const key of ids) if (visit(key)) { errors.push('剧情图存在环路'); break; }
  if (story.mode === 'create') {
    const starts = story.nodes.filter(n => n.type === 'start');
    if (starts.length !== 1) errors.push('原创故事必须有且只有一个开场');
    const reached = new Set<string>();
    const walk = (key: string) => { if (reached.has(key)) return; reached.add(key); (adjacency.get(key) ?? []).forEach(walk); };
    starts.forEach(n => walk(n.id));
    if (reached.size !== ids.size) errors.push('存在从开场不可达的节点');
    if (!story.nodes.some(n => n.type === 'ending' && reached.has(n.id))) errors.push('缺少可达结局');
    for (const node of story.nodes) {
      if (node.type !== 'ending' && !adjacency.get(node.id)?.length) errors.push(`${node.title} 没有出口`);
      if (node.type === 'ending' && adjacency.get(node.id)?.length) errors.push(`${node.title} 结局不能有后续连线`);
    }
  }
  return [...new Set(errors)];
}

export function visibleNodes(story: Story, run: ProgressView | undefined, spoilers: boolean): StoryNode[] {
  return story.nodes.filter(n => spoilers || !n.spoiler || run?.current === n.id || run?.states[n.id] === 'done');
}
export function visibleStory(story: Story, run: ProgressView | undefined, spoilers: boolean): Story {
  const nodes = visibleNodes(story, run, spoilers); const ids = new Set(nodes.map(n => n.id));
  // 无剧透时整体梗概和原始来源都可能透露隐藏结局，必须屏蔽。
  return { ...story, summary: spoilers ? story.summary : '开启完整攻略可查看故事梗概与原文依据。', sources: spoilers ? story.sources : [], nodes: nodes.map(n => spoilers ? n : { ...n, refs: [] }), edges: story.edges.filter(e => ids.has(e.from) && ids.has(e.to)).map(e => spoilers ? e : { ...e, label: '继续探索', condition: '条件未公开，请自然探索', refs: [] }) };
}
export function fingerprint(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16); // 用于变更提示，不用于安全校验。
}
export type Condition = { variable: string; op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'; value: string | boolean | number };
export function evaluateCondition(c: Condition, vars: Record<string, string | boolean | number>): boolean | 'unknown' {
  const value = vars[c.variable];
  if (value === undefined || typeof value !== typeof c.value) return 'unknown';
  if (c.op === 'eq') return value === c.value;
  if (c.op === 'ne') return value !== c.value;
  if (typeof value !== 'number' || typeof c.value !== 'number') return 'unknown';
  return c.op === 'gt' ? value > c.value : c.op === 'gte' ? value >= c.value : c.op === 'lt' ? value < c.value : value <= c.value;
}
