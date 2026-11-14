import { parseLibrary, type StoryLibrary, type RouteDraft } from './library';
export interface RouteDraftInput {
  mode: RouteDraft['mode'];
  targetCharacterMaterialIds: string[];
  referenceSourceIds: string[];
  referenceEventIds?: string[];
  style: string;
  length: string;
}
/** 包含完整正式基线；草稿审阅不改变指纹，任何正式编辑均使采用失效。 */
export function routeBaseline(lib: StoryLibrary): string {
  return JSON.stringify([lib.characterKey, lib.sources, lib.materials, lib.events, lib.edges, lib.routes]);
}
function draftOf(lib: StoryLibrary, id: string): RouteDraft {
  const draft = lib.drafts.find((x) => x.id === id);
  if (!draft) throw new Error('草稿不存在');
  return draft;
}
function items(draft: RouteDraft) {
  return [...draft.proposedEvents, ...draft.proposedEdges, ...draft.proposedRoutes];
}
function change(lib: StoryLibrary, draft: RouteDraft): StoryLibrary {
  return parseLibrary({
    ...lib,
    revision: lib.revision + 1,
    drafts: lib.drafts.map((x) => (x.id === draft.id ? { ...draft, revision: draft.revision + 1 } : x)),
  });
}
export function reviewDraftItem(
  lib: StoryLibrary,
  draftId: string,
  itemId: string,
  status: 'confirmed' | 'rejected',
): StoryLibrary {
  const draft = structuredClone(draftOf(lib, draftId));
  if (!items(draft).some((x) => x.id === itemId)) throw new Error('草稿项目不存在');
  if (draft.adoptedItemIds?.includes(itemId)) throw new Error('已采用项目不能再次审核');
  draft.itemReviews = { ...draft.itemReviews, [itemId]: status };
  for (const item of [...draft.proposedEvents, ...draft.proposedEdges])
    if (item.id === itemId) item.status = status;
  return change(lib, draft);
}
export function editDraftItem(
  lib: StoryLibrary,
  draftId: string,
  itemId: string,
  patch: { title?: string; summary?: string; condition?: string; choiceText?: string },
): StoryLibrary {
  const draft = structuredClone(draftOf(lib, draftId));
  const item = items(draft).find((x) => x.id === itemId);
  if (!item) throw new Error('草稿项目不存在');
  if (draft.adoptedItemIds?.includes(itemId)) throw new Error('已采用项目不能编辑');
  let modified = false;
  for (const [key, value] of Object.entries(patch)) {
    if (!['title', 'summary', 'condition', 'choiceText'].includes(key) || !(key in item))
      throw new Error('该项目不支持此编辑字段');
    if (Reflect.get(item, key) !== value) {
      modified = true;
      Object.assign(item, { [key]: value });
    }
  }
  if (!modified) return lib;
  if ('origin' in item) {
    item.origin = 'user_manual';
    item.status = 'pending';
  }
  draft.itemReviews = { ...draft.itemReviews, [itemId]: 'pending' };
  return change(lib, draft);
}
/** 采用只追加明确选择且确认的提案；不覆盖任何既有事件。 */
export function adoptRouteDraft(lib: StoryLibrary, draftId: string, selectedIds?: string[]): StoryLibrary {
  const draft = structuredClone(draftOf(lib, draftId));
  if (!draft.baselineFingerprint || routeBaseline(lib) !== draft.baselineFingerprint)
    throw new Error('正式资料基线已变化，请重新生成草稿');
  const selected = new Set(
    selectedIds ??
      items(draft)
        .filter((x) => !draft.adoptedItemIds?.includes(x.id))
        .map((x) => x.id),
  );
  if (!selected.size) throw new Error('没有可采用项目');
  for (const id of selected) {
    if (!items(draft).some((x) => x.id === id)) throw new Error('草稿项目不存在');
    if (draft.adoptedItemIds?.includes(id)) throw new Error('项目已采用');
    if (draft.itemReviews?.[id] !== 'confirmed') throw new Error('采用前必须逐项确认');
  }
  const eventIds = new Set([
    ...lib.events.map((x) => x.id),
    ...draft.proposedEvents.filter((x) => selected.has(x.id)).map((x) => x.id),
  ]);
  const edgeIds = new Set([
    ...lib.edges.map((x) => x.id),
    ...draft.proposedEdges.filter((x) => selected.has(x.id)).map((x) => x.id),
  ]);
  for (const e of draft.proposedEdges.filter((x) => selected.has(x.id)))
    if (!eventIds.has(e.sourceNodeId) || !eventIds.has(e.targetNodeId))
      throw new Error('采用依赖不闭合：请同时采用端点事件');
  for (const r of draft.proposedRoutes.filter((x) => selected.has(x.id)))
    if (r.eventIds.some((x) => !eventIds.has(x)) || r.edgeIds.some((x) => !edgeIds.has(x)))
      throw new Error('采用依赖不闭合：请同时采用路线事件和关系');
  const next = {
    ...lib,
    events: [...lib.events, ...draft.proposedEvents.filter((x) => selected.has(x.id))],
    edges: [...lib.edges, ...draft.proposedEdges.filter((x) => selected.has(x.id))],
    routes: [...lib.routes, ...draft.proposedRoutes.filter((x) => selected.has(x.id))],
  };
  draft.adoptedItemIds = [...(draft.adoptedItemIds ?? []), ...selected];
  draft.baselineFingerprint = routeBaseline(next);
  return change(next, draft);
}
