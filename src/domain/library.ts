import { z } from 'zod';
import { sourceSchema } from './story';
const id = z.string().min(1).max(180);
const text = z.string().max(20000);
export const originSchema = z.enum(['worldbook_explicit', 'ai_inferred', 'ai_generated', 'user_manual']);
export const reviewStatusSchema = z.enum(['draft', 'pending', 'confirmed', 'rejected']);
export const evidenceSchema = z
  .object({
    sourceSnapshotId: id,
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    quote: z.string().min(1).max(20000),
    role: z.enum(['direct_support', 'creative_reference']),
  })
  .strict();
const authorship = {
  origin: originSchema,
  status: reviewStatusSchema,
  evidence: z.array(evidenceSchema).max(100),
};
const entity = { id, revision: z.number().int().positive() };
export const worldbookSourceSchema = sourceSchema
  .extend({ sourceKey: id, capturedAt: z.string().max(100) })
  .strict();
export const storyMaterialSchema = z
  .object({
    ...entity,
    ...authorship,
    sourceSnapshotIds: z.array(id).max(2000),
    categories: z
      .array(z.enum(['character', 'location', 'world', 'plot', 'rule', 'unclassified']))
      .min(1)
      .max(6),
    title: z.string().min(1).max(160),
    summary: text,
    relatedEventIds: z.array(id).max(1000),
    userEdited: z.boolean(),
  })
  .strict();
export const storyEventSchema = z
  .object({
    ...entity,
    ...authorship,
    kind: z.enum(['opening', 'event', 'key_event', 'choice', 'route_entry', 'ending']),
    title: z.string().min(1).max(160),
    summary: text,
    characters: z.array(z.string().max(160)).max(50),
    location: text,
    time: text,
    preconditions: text,
    materialIds: z.array(id).max(2000),
    userEditedFields: z.array(z.string().max(100)).max(30),
    locked: z.boolean(),
  })
  .strict();
export const storyEdgeSchema = z
  .object({
    ...entity,
    ...authorship,
    sourceNodeId: id,
    targetNodeId: id,
    relationType: z.enum(['precedes', 'continues', 'requires', 'choice', 'ending_branch']),
    choiceText: text,
    condition: text,
  })
  .strict();
export const storyRouteSchema = z
  .object({
    ...entity,
    title: z.string().min(1).max(160),
    kind: z.enum(['common', 'character', 'custom']),
    characters: z.array(z.string().max(160)).max(50),
    eventIds: z.array(id).max(1000),
    edgeIds: z.array(id).max(3000),
    completeness: z.enum(['fragment', 'playable']),
    positions: z.record(
      z
        .object({ x: z.number().finite().min(0).max(20000), y: z.number().finite().min(0).max(20000) })
        .strict(),
    ),
  })
  .strict();
export const importReportSchema = z
  .object({
    ...entity,
    createdAt: z.string().max(100),
    state: z.enum(['complete', 'partial', 'failed', 'cancelled']),
    sourceSnapshotIds: z.array(id).max(4000),
    issues: z
      .array(
        z
          .object({
            id,
            sourceSnapshotId: id.optional(),
            sourceKey: id.optional(),
            stage: z.enum(['read', 'normalize', 'classify', 'event', 'relation', 'migration']),
            code: z.string().max(100),
            severity: z.enum(['info', 'warning', 'error']),
            message: text,
          })
          .strict(),
      )
      .max(10000),
  })
  .strict();
export const routeDraftSchema = z
  .object({
    ...entity,
    mode: z.enum(['infer', 'expand', 'mixed']),
    baseLibraryRevision: z.number().int().positive(),
    status: reviewStatusSchema,
    proposedEvents: z.array(storyEventSchema).max(1000),
    proposedEdges: z.array(storyEdgeSchema).max(3000),
    proposedRoutes: z.array(storyRouteSchema).max(100),
  })
  .strict();
export const librarySchema = z
  .object({
    schemaVersion: z.literal(2),
    baseRevision: z.number().int().nonnegative().default(0),
    ...entity,
    characterKey: id,
    title: z.string().min(1).max(160),
    sources: z.array(worldbookSourceSchema).max(4000),
    materials: z.array(storyMaterialSchema).max(4000),
    events: z.array(storyEventSchema).max(1000),
    edges: z.array(storyEdgeSchema).max(3000),
    routes: z.array(storyRouteSchema).max(100),
    drafts: z.array(routeDraftSchema).max(100),
    reports: z.array(importReportSchema).max(200),
    legacyStoryId: id.optional(),
  })
  .strict();
export type StoryLibrary = z.infer<typeof librarySchema>;
export type StoryMaterial = z.infer<typeof storyMaterialSchema>;
export type StoryEvent = z.infer<typeof storyEventSchema>;
export type StoryEdge = z.infer<typeof storyEdgeSchema>;
export type StoryRoute = z.infer<typeof storyRouteSchema>;
export type WorldbookSource = z.infer<typeof worldbookSourceSchema>;
export type ImportReport = z.infer<typeof importReportSchema>;
export type RouteDraft = z.infer<typeof routeDraftSchema>;
/** 文件仅作为数据；先限制体积及危险键，再校验跨实体引用。 */
export function parseLibrary(value: unknown): StoryLibrary {
  const raw = JSON.stringify(value);
  if (!raw || raw.length > 16_000_000) throw new Error('资料库超过16 MB字符限制');
  if (/"(?:__proto__|constructor|prototype)"\s*:/.test(raw)) throw new Error('文件含非法键');
  const lib = librarySchema.parse(value);
  const errors = validateLibrary(lib);
  if (errors.length) throw new Error(errors.join('；'));
  return lib;
}
export function validateLibrary(lib: StoryLibrary): string[] {
  const errors: string[] = [];
  const all = [
    ...lib.sources,
    ...lib.materials,
    ...lib.events,
    ...lib.edges,
    ...lib.routes,
    ...lib.drafts,
    ...lib.reports,
  ];
  if (new Set(all.map((x) => x.id)).size !== all.length) errors.push('实体ID重复');
  const events = new Map(lib.events.map((x) => [x.id, x]));
  const edges = new Map(lib.edges.map((x) => [x.id, x]));
  const sources = new Map(lib.sources.map((x) => [x.id, x]));
  const materials = new Set(lib.materials.map((x) => x.id));
  for (const item of [...lib.materials, ...lib.events, ...lib.edges]) {
    if (item.origin === 'worldbook_explicit' && !item.evidence.some((e) => e.role === 'direct_support'))
      errors.push(`${item.id}缺少原文直接依据`);
    for (const e of item.evidence) {
      const source = sources.get(e.sourceSnapshotId);
      if (
        !source ||
        e.start >= e.end ||
        e.end > source.text.length ||
        source.text.slice(e.start, e.end) !== e.quote
      )
        errors.push(`${item.id}引用定位无效`);
    }
  }
  for (const material of lib.materials)
    if (
      material.sourceSnapshotIds.some((x) => !sources.has(x)) ||
      material.relatedEventIds.some((x) => !events.has(x))
    )
      errors.push(`${material.id}资料引用不存在`);
  for (const event of lib.events)
    if (event.materialIds.some((x) => !materials.has(x))) errors.push(`${event.id}素材不存在`);
  for (const edge of lib.edges)
    if (!events.has(edge.sourceNodeId) || !events.has(edge.targetNodeId))
      errors.push(`${edge.id}连线端点不存在`);
  for (const route of lib.routes) {
    const selected = new Set(route.eventIds);
    if (selected.size !== route.eventIds.length || new Set(route.edgeIds).size !== route.edgeIds.length)
      errors.push(`${route.id}路线引用重复`);
    if (route.eventIds.some((x) => !events.has(x)) || route.edgeIds.some((x) => !edges.has(x)))
      errors.push(`${route.id}路线引用不存在`);
    if (Object.keys(route.positions).some((x) => !selected.has(x)))
      errors.push(`${route.id}布局引用不属于路线`);
    const adjacency = new Map(route.eventIds.map((x) => [x, [] as string[]]));
    for (const key of route.edgeIds) {
      const edge = edges.get(key);
      if (!edge) continue;
      if (!selected.has(edge.sourceNodeId) || !selected.has(edge.targetNodeId))
        errors.push(`${route.id}连线端点不属于路线`);
      else if (
        edge.status === 'confirmed' &&
        ['continues', 'choice', 'ending_branch'].includes(edge.relationType)
      )
        adjacency.get(edge.sourceNodeId)?.push(edge.targetNodeId);
    }
    const visiting = new Set<string>(),
      done = new Set<string>();
    const visit = (key: string): boolean => {
      if (visiting.has(key)) return true;
      if (done.has(key)) return false;
      visiting.add(key);
      for (const next of adjacency.get(key) ?? []) if (visit(next)) return true;
      visiting.delete(key);
      done.add(key);
      return false;
    };
    if (route.eventIds.some(visit)) errors.push(`${route.id}剧情衔接存在环路`);
    if (route.completeness === 'playable') {
      const members = route.eventIds.flatMap((key) => events.get(key) ?? []);
      const starts = members.filter((event) => event.kind === 'opening' || event.kind === 'route_entry');
      const reached = new Set<string>();
      const walk = (key: string) => {
        if (reached.has(key)) return;
        reached.add(key);
        for (const next of adjacency.get(key) ?? []) walk(next);
      };
      starts.forEach((event) => walk(event.id));
      if (
        !starts.length ||
        !members.some((event) => event.kind === 'ending' && reached.has(event.id)) ||
        reached.size !== members.length ||
        members.some((event) => event.status !== 'confirmed') ||
        route.edgeIds.some((key) => edges.get(key)?.status !== 'confirmed')
      )
        errors.push(`${route.id}可游玩路线缺少已确认入口、可达结局或存在不可达内容`);
      if (
        members.some((event) =>
          event.kind === 'ending' ? adjacency.get(event.id)?.length : !adjacency.get(event.id)?.length,
        )
      )
        errors.push(`${route.id}可游玩路线存在非结局死路或结局后续连接`);
    }
  }
  // 草稿不进入正式图，但交换文件仍须校验证据和跨实体引用，避免未来采用非法内容。
  for (const draft of lib.drafts) {
    const issues = validateLibrary({
      ...lib,
      drafts: [],
      events: [...lib.events, ...draft.proposedEvents],
      edges: [...lib.edges, ...draft.proposedEdges],
      routes: [...lib.routes, ...draft.proposedRoutes],
    });
    errors.push(...issues.map((issue) => `草稿${draft.id}：${issue}`));
  }
  return [...new Set(errors)];
}
/** 正式展示只接收已确认实体；不会补线或按位置推断关系。 */
export function formalRoute(lib: StoryLibrary, routeId: string) {
  const route = lib.routes.find((x) => x.id === routeId);
  if (!route) throw new Error('路线不存在');
  const events = lib.events.filter((x) => route.eventIds.includes(x.id) && x.status === 'confirmed');
  const ids = new Set(events.map((x) => x.id));
  return {
    route,
    events,
    edges: lib.edges.filter(
      (x) =>
        route.edgeIds.includes(x.id) &&
        x.status === 'confirmed' &&
        ids.has(x.sourceNodeId) &&
        ids.has(x.targetNodeId),
    ),
  };
}
