import {
  parseLibrary,
  type StoryLibrary,
  type StoryEvent,
  type StoryEdge,
  type StoryRoute,
  type StoryMaterial,
  type ImportReport,
} from '../domain/library';
import { parseStory, type Source, type Story } from '../domain/story';
export function libraryId(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}
export function createLibrary(characterKey: string, title = '剧情资料库'): StoryLibrary {
  return parseLibrary({
    schemaVersion: 2,
    id: libraryId('library'),
    revision: 1,
    characterKey,
    title,
    sources: [],
    materials: [],
    events: [],
    edges: [],
    routes: [],
    drafts: [],
    reports: [],
  });
}
function changed(lib: StoryLibrary): StoryLibrary {
  return parseLibrary({ ...lib, revision: lib.revision + 1 });
}
function contentChanged<T extends object>(before: T, patch: Partial<T>, ignored: string[]): boolean {
  return (Object.keys(patch) as (keyof T)[]).some(
    (key) => !ignored.includes(String(key)) && JSON.stringify(before[key]) !== JSON.stringify(patch[key]),
  );
}
export interface ReadIssue {
  sourceKey: string;
  label: string;
  code: string;
  message: string;
}
/** 原始快照只追加；重导入不会修改事件、人工资料或路线。新快照另列待整理。 */
export function importSources(
  lib: StoryLibrary,
  sources: Source[],
  readIssues: ReadIssue[] = [],
): StoryLibrary {
  const next = structuredClone(lib);
  const report: ImportReport = {
    id: libraryId('report'),
    revision: 1,
    createdAt: new Date().toISOString(),
    state: readIssues.length ? 'partial' : 'complete',
    sourceSnapshotIds: [],
    issues: readIssues.map((x) => ({
      id: libraryId('issue'),
      sourceKey: x.sourceKey,
      stage: 'read',
      code: x.code,
      severity: 'error',
      message: `${x.label}：${x.message}`,
    })),
  };
  for (const source of sources) {
    const prior = next.sources.filter((x) => x.sourceKey === source.id);
    const same = prior.find((x) => x.fingerprint === source.fingerprint && x.text === source.text);
    if (same) {
      report.sourceSnapshotIds.push(same.id);
      continue;
    }
    const snapshot = {
      ...source,
      id: libraryId('source'),
      sourceKey: source.id,
      capturedAt: new Date().toISOString(),
    };
    next.sources.push(snapshot);
    report.sourceSnapshotIds.push(snapshot.id);
    next.materials.push({
      id: libraryId('material'),
      revision: 1,
      origin: 'worldbook_explicit',
      status: 'confirmed',
      evidence: source.text
        ? [
            {
              sourceSnapshotId: snapshot.id,
              start: 0,
              end: source.text.length,
              quote: source.text.slice(0, 20000),
              role: 'direct_support',
            },
          ]
        : [],
      sourceSnapshotIds: [snapshot.id],
      categories: ['unclassified'],
      title: source.label.slice(0, 160) || '未命名资料',
      summary: '原文资料，尚未分类或提取剧情事件。',
      relatedEventIds: [],
      userEdited: false,
    });
    const material = next.materials.at(-1);
    if (material && source.text.length > 20000)
      material.evidence[0] = {
        sourceSnapshotId: snapshot.id,
        start: 0,
        end: 20000,
        quote: source.text.slice(0, 20000),
        role: 'direct_support',
      };
    if (!source.text && material) {
      material.origin = 'user_manual';
      material.status = 'pending';
    }
    if (prior.length)
      report.issues.push({
        id: libraryId('issue'),
        sourceSnapshotId: snapshot.id,
        stage: 'normalize',
        code: 'source_changed',
        severity: 'warning',
        message: `${source.label}已变化；原快照、人工修改与路线保持不变，请审阅新资料。`,
      });
    report.issues.push({
      id: libraryId('issue'),
      sourceSnapshotId: snapshot.id,
      stage: 'classify',
      code: 'unclassified',
      severity: 'info',
      message: '原文已保存，等待人工分类；未自动创建事件或关系。',
    });
  }
  next.reports.push(report);
  return changed(next);
}
export function createEvent(
  lib: StoryLibrary,
  input: Partial<Omit<StoryEvent, 'id' | 'revision'>> & { title: string },
): StoryLibrary {
  return changed({
    ...lib,
    events: [
      ...lib.events,
      {
        id: libraryId('event'),
        revision: 1,
        kind: 'event',
        summary: '',
        characters: [],
        location: '',
        time: '',
        preconditions: '',
        materialIds: [],
        userEditedFields: [],
        locked: false,
        origin: 'user_manual',
        status: 'confirmed',
        evidence: [],
        ...input,
      },
    ],
  });
}
export function updateEvent(
  lib: StoryLibrary,
  id: string,
  patch: Partial<Omit<StoryEvent, 'id' | 'revision'>>,
): StoryLibrary {
  if (!lib.events.some((x) => x.id === id)) throw new Error('事件不存在');
  return changed({
    ...lib,
    events: lib.events.map((x) =>
      x.id === id
        ? {
            ...x,
            ...patch,
            id,
            revision: x.revision + 1,
            origin: contentChanged(x, patch, ['status', 'locked', 'origin']) ? 'user_manual' : x.origin,
            userEditedFields: [...new Set([...x.userEditedFields, ...Object.keys(patch)])],
          }
        : x,
    ),
  });
}
export function createRoute(
  lib: StoryLibrary,
  title: string,
  kind: StoryRoute['kind'] = 'custom',
): StoryLibrary {
  return changed({
    ...lib,
    routes: [
      ...lib.routes,
      {
        id: libraryId('route'),
        revision: 1,
        title,
        kind,
        characters: [],
        eventIds: [],
        edgeIds: [],
        completeness: 'fragment',
        positions: {},
      },
    ],
  });
}
export function addEventToRoute(lib: StoryLibrary, routeId: string, eventId: string): StoryLibrary {
  if (!lib.routes.some((x) => x.id === routeId)) throw new Error('路线不存在');
  return changed({
    ...lib,
    routes: lib.routes.map((x) =>
      x.id === routeId
        ? { ...x, revision: x.revision + 1, eventIds: [...new Set([...x.eventIds, eventId])] }
        : x,
    ),
  });
}
export function createEdge(
  lib: StoryLibrary,
  routeId: string,
  input: Partial<Omit<StoryEdge, 'id' | 'revision'>> & Pick<StoryEdge, 'sourceNodeId' | 'targetNodeId'>,
): StoryLibrary {
  if (!lib.routes.some((x) => x.id === routeId)) throw new Error('路线不存在');
  const edge: StoryEdge = {
    id: libraryId('edge'),
    revision: 1,
    relationType: 'continues',
    choiceText: '',
    condition: '',
    origin: 'user_manual',
    status: 'confirmed',
    evidence: [],
    ...input,
  };
  return changed({
    ...lib,
    edges: [...lib.edges, edge],
    routes: lib.routes.map((x) =>
      x.id === routeId ? { ...x, revision: x.revision + 1, edgeIds: [...x.edgeIds, edge.id] } : x,
    ),
  });
}
export function updateEdge(
  lib: StoryLibrary,
  id: string,
  patch: Partial<Omit<StoryEdge, 'id' | 'revision'>>,
): StoryLibrary {
  if (!lib.edges.some((x) => x.id === id)) throw new Error('连线不存在');
  return changed({
    ...lib,
    edges: lib.edges.map((x) =>
      x.id === id
        ? {
            ...x,
            ...patch,
            id,
            revision: x.revision + 1,
            origin: contentChanged(x, patch, ['status', 'origin']) ? 'user_manual' : x.origin,
          }
        : x,
    ),
  });
}
export function deleteEdge(lib: StoryLibrary, id: string): StoryLibrary {
  return changed({
    ...lib,
    edges: lib.edges.filter((x) => x.id !== id),
    routes: lib.routes.map((x) => ({ ...x, edgeIds: x.edgeIds.filter((k) => k !== id) })),
  });
}
export function removeEventFromRoute(lib: StoryLibrary, routeId: string, eventId: string): StoryLibrary {
  const edges = new Set(
    lib.edges.filter((x) => x.sourceNodeId === eventId || x.targetNodeId === eventId).map((x) => x.id),
  );
  return changed({
    ...lib,
    routes: lib.routes.map((x) => {
      if (x.id !== routeId) return x;
      const positions = { ...x.positions };
      delete positions[eventId];
      return {
        ...x,
        eventIds: x.eventIds.filter((k) => k !== eventId),
        edgeIds: x.edgeIds.filter((k) => !edges.has(k)),
        positions,
      };
    }),
  });
}
export function deleteEvent(lib: StoryLibrary, id: string): StoryLibrary {
  let next = lib;
  for (const route of lib.routes) next = removeEventFromRoute(next, route.id, id);
  return changed({
    ...next,
    events: next.events.filter((x) => x.id !== id),
    edges: next.edges.filter((x) => x.sourceNodeId !== id && x.targetNodeId !== id),
    materials: next.materials.map((x) => ({
      ...x,
      relatedEventIds: x.relatedEventIds.filter((k) => k !== id),
    })),
  });
}
export function setRoutePosition(
  lib: StoryLibrary,
  routeId: string,
  eventId: string,
  position: { x: number; y: number },
): StoryLibrary {
  if (!lib.routes.some((x) => x.id === routeId)) throw new Error('路线不存在');
  return changed({
    ...lib,
    routes: lib.routes.map((x) =>
      x.id === routeId ? { ...x, positions: { ...x.positions, [eventId]: position } } : x,
    ),
  });
}
/** 保守迁移不改变旧故事；旧显式/AI内容需重新审阅，人工确认记录可保留。 */
export function migrateStory(value: Story): StoryLibrary {
  const story = parseStory(value);
  const catalogIds = new Set(
    story.nodes
      .filter((n) => n.chapter === '原始资料（不代表事件）' && /^_*(?:material-)?source-\d+$/.test(n.id))
      .map((n) => n.id),
  );
  let lib = importSources(createLibrary(story.characterKey, story.title), story.sources);
  const sourceMap = new Map(lib.sources.map((x) => [x.sourceKey, x]));
  const origins = {
    explicit: 'worldbook_explicit',
    inferred: 'ai_inferred',
    original: 'ai_generated',
    user: 'user_manual',
  } as const;
  const evidence = (refs: Story['nodes'][number]['refs']) =>
    refs.flatMap((ref) => {
      const source = sourceMap.get(ref.sourceId);
      const start = source?.text.indexOf(ref.quote) ?? -1;
      return source && start >= 0
        ? [
            {
              sourceSnapshotId: source.id,
              start,
              end: start + ref.quote.length,
              quote: ref.quote,
              role: 'direct_support' as const,
            },
          ]
        : [];
    });
  lib = {
    ...lib,
    legacyStoryId: story.id,
    events: story.nodes
      .filter((n) => !catalogIds.has(n.id))
      .map((n) => ({
        id: n.id,
        revision: 1,
        kind: n.type === 'start' ? 'opening' : n.type,
        title: n.title,
        summary: n.summary,
        characters: n.characters,
        location: n.location,
        time: n.time,
        preconditions: '',
        materialIds: [],
        locked: n.locked,
        userEditedFields: n.provenance === 'user' ? ['legacy'] : [],
        origin:
          n.provenance === 'explicit' && !evidence(n.refs).length ? 'ai_inferred' : origins[n.provenance],
        status: n.provenance === 'user' ? 'confirmed' : 'pending',
        evidence: evidence(n.refs),
      })),
    edges: story.edges
      .filter((e) => !catalogIds.has(e.from) && !catalogIds.has(e.to))
      .map((e) => ({
        id: e.id,
        revision: 1,
        sourceNodeId: e.from,
        targetNodeId: e.to,
        relationType: 'continues',
        choiceText: e.label,
        condition: e.condition,
        origin:
          e.provenance === 'explicit' && !evidence(e.refs).length ? 'ai_inferred' : origins[e.provenance],
        status: e.provenance === 'user' ? 'confirmed' : 'pending',
        evidence: evidence(e.refs),
      })),
  };
  lib = createRoute(lib, story.title, 'common');
  const route = lib.routes[0];
  if (route) {
    route.eventIds = lib.events.map((x) => x.id);
    route.edgeIds = lib.edges.map((x) => x.id);
    route.positions = Object.fromEntries(
      Object.entries(story.positions).filter(([key]) => route.eventIds.includes(key)),
    );
  }
  lib.reports.push({
    id: libraryId('report'),
    revision: 1,
    createdAt: new Date().toISOString(),
    state: 'complete',
    sourceSnapshotIds: lib.sources.map((x) => x.id),
    issues: [
      {
        id: libraryId('issue'),
        stage: 'migration',
        code: 'legacy_pending',
        severity: 'warning',
        message: `旧记录保持不变；已将${catalogIds.size}项可识别资料目录移至资料库，移除其关联边${story.edges.filter((e) => catalogIds.has(e.from) || catalogIds.has(e.to)).length}条；其余旧事件与AI/原作关系转为待确认。`,
      },
    ],
  });
  return parseLibrary(lib);
}

/** 分类与备注是资料整理；不改变原文快照或将资料自动转换为事件。 */
export function updateMaterial(
  lib: StoryLibrary,
  id: string,
  patch: Partial<Pick<StoryMaterial, 'title' | 'summary' | 'categories' | 'relatedEventIds' | 'status'>>,
): StoryLibrary {
  if (!lib.materials.some((x) => x.id === id)) throw new Error('资料不存在');
  return changed({
    ...lib,
    materials: lib.materials.map((x) =>
      x.id === id
        ? {
            ...x,
            ...patch,
            revision: x.revision + 1,
            userEdited: true,
            origin:
              (patch.title !== undefined && patch.title !== x.title) ||
              (patch.summary !== undefined && patch.summary !== x.summary)
                ? 'user_manual'
                : x.origin,
          }
        : x,
    ),
  });
}
