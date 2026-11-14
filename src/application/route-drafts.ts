import { z } from 'zod';
import {
  storyEventSchema,
  storyEdgeSchema,
  storyRouteSchema,
  parseLibrary,
  type StoryLibrary,
  type RouteDraft,
} from '../domain/library';
import { routeBaseline, type RouteDraftInput } from '../domain/route-drafts';
import { routeDraftPrompt } from '../ai/route-prompts';
import { libraryId } from './library';
import { requestModel } from './model-request';
import type { Host } from '../host/tavern';
const resultSchema = z
  .object({
    events: z
      .array(storyEventSchema.omit({ revision: true, status: true, userEditedFields: true, locked: true }))
      .max(100),
    edges: z.array(storyEdgeSchema.omit({ revision: true, status: true })).max(300),
    routes: z.array(storyRouteSchema.omit({ revision: true })).max(20),
  })
  .strict();
/** 主动单次请求，无自动修复/重试。结果只进入草稿，保存由调用方已有仓储处理。 */
export async function generateRouteDraft(
  host: Pick<Host, 'generate'>,
  lib: StoryLibrary,
  input: RouteDraftInput,
  signal: AbortSignal,
  isCurrent: () => boolean = () => true,
  progress: (message: string) => void = () => {},
): Promise<StoryLibrary> {
  const guard = () => {
    if (signal.aborted) throw new Error('已取消生成');
    if (!isCurrent()) throw new Error('上下文已变化，过期草稿已丢弃');
  };
  guard();
  if (input.style.length > 20000 || input.length.length > 500) throw new Error('风格或篇幅超出限制');
  const sources = input.referenceSourceIds.map((id) => {
    const x = lib.sources.find((x) => x.id === id);
    if (!x) throw new Error('参考来源不存在');
    return x;
  });
  const characters = input.targetCharacterMaterialIds.map((id) => {
    const x = lib.materials.find((x) => x.id === id && x.categories.includes('character'));
    if (!x) throw new Error('目标人物资料不存在');
    return x;
  });
  const events = (input.referenceEventIds ?? []).map((id) => {
    const x = lib.events.find((x) => x.id === id);
    if (!x) throw new Error('参考事件不存在');
    return x;
  });
  if (input.mode === 'infer' && events.length < 2) throw new Error('推断关系至少选择两个已有事件');
  const prompt = routeDraftPrompt(input, { sources, characters, events });
  if (prompt.length > 120000) throw new Error('所选资料超过120000字符单次请求限制，请缩小范围；没有截断资料');
  const raw = await requestModel(host, prompt, signal, '路线草稿生成', progress);
  guard();
  if (raw.length > 2_000_000) throw new Error('模型输出超过2M字符限制');
  const result = resultSchema.parse(JSON.parse(raw.trim()));
  if (!result.events.length && !result.edges.length && !result.routes.length)
    throw new Error('模型未提供候选内容');
  if (input.mode === 'infer' && result.events.length) throw new Error('推断模式不得新增事件');
  const all = [...result.events, ...result.edges, ...result.routes];
  if (new Set(all.map((x) => x.id)).size !== all.length) throw new Error('模型临时ID重复');
  const existing = new Set(
    [...lib.events, ...lib.edges, ...lib.routes, ...lib.materials, ...lib.sources].map((x) => x.id),
  );
  if (all.some((x) => existing.has(x.id))) throw new Error('模型不得修改或覆盖既有实体');
  const ids = new Map(all.map((x) => [x.id, libraryId('proposal')]));
  const eventId = (id: string) => {
    const mapped = ids.get(id);
    if (mapped && result.events.some((x) => x.id === id)) return mapped;
    if (events.some((x) => x.id === id)) return id;
    throw new Error('关系或路线引用未选择的事件');
  };
  const edgeId = (id: string) => {
    const mapped = ids.get(id);
    if (mapped && result.edges.some((x) => x.id === id)) return mapped;
    throw new Error('路线关系引用无效');
  };
  for (const item of [...result.events, ...result.edges]) {
    if (item.origin === 'user_manual') throw new Error('模型内容不能标为人工');
    if (input.mode === 'infer' && item.origin === 'ai_generated') throw new Error('推断模式不得新增创作关系');
    if ('kind' in item && item.origin !== 'ai_generated') throw new Error('新增事件必须标为AI创作');
    if (item.origin === 'ai_generated' && item.evidence.some((e) => e.role !== 'creative_reference'))
      throw new Error('AI创作的引用只能标记创作参考');
    for (const e of item.evidence) {
      const source = sources.find((s) => s.id === e.sourceSnapshotId);
      if (!source || e.start >= e.end || source.text.slice(e.start, e.end) !== e.quote)
        throw new Error('模型引用定位无效');
    }
  }
  for (const item of result.events)
    if (item.materialIds.some((id) => !characters.some((x) => x.id === id)))
      throw new Error('模型引用未选择的人物资料');
  const draft: RouteDraft = {
    id: libraryId('draft'),
    revision: 1,
    mode: input.mode,
    baseLibraryRevision: lib.revision,
    status: 'draft',
    referenceSourceIds: input.referenceSourceIds,
    referenceEventIds: input.referenceEventIds ?? [],
    referenceEvents: structuredClone(events),
    targetCharacterMaterialIds: input.targetCharacterMaterialIds,
    sourceSnapshots: structuredClone(sources),
    style: input.style,
    length: input.length,
    baselineFingerprint: routeBaseline(lib),
    itemReviews: {},
    adoptedItemIds: [],
    proposedEvents: result.events.map((x) => ({
      ...x,
      id: ids.get(x.id) ?? '',
      revision: 1,
      status: 'pending',
      locked: false,
      userEditedFields: [],
    })),
    proposedEdges: result.edges.map((x) => ({
      ...x,
      id: ids.get(x.id) ?? '',
      revision: 1,
      status: 'pending',
      sourceNodeId: eventId(x.sourceNodeId),
      targetNodeId: eventId(x.targetNodeId),
    })),
    proposedRoutes: result.routes.map((x) => ({
      ...x,
      id: ids.get(x.id) ?? '',
      revision: 1,
      eventIds: x.eventIds.map(eventId),
      edgeIds: x.edgeIds.map(edgeId),
      positions: {},
    })),
  };
  guard();
  return parseLibrary({ ...lib, revision: lib.revision + 1, drafts: [...lib.drafts, draft] });
}
