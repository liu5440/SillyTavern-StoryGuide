import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLibrary, createEvent } from '../src/application/library';
import { generateRouteDraft } from '../src/application/route-drafts';
import { adoptRouteDraft, reviewDraftItem } from '../src/domain/route-drafts';
const input = {
  mode: 'mixed' as const,
  targetCharacterMaterialIds: [],
  referenceSourceIds: [],
  style: '',
  length: '',
};
const response = {
  events: [
    {
      id: 'new',
      kind: 'ending',
      title: '结局',
      summary: '新增',
      characters: [],
      location: '',
      time: '',
      preconditions: '',
      materialIds: [],
      origin: 'ai_generated',
      evidence: [],
    },
  ],
  edges: [],
  routes: [
    {
      id: 'r',
      title: '新线',
      kind: 'custom',
      characters: [],
      eventIds: ['new'],
      edgeIds: [],
      completeness: 'fragment',
      positions: {},
    },
  ],
};
test('草稿隔离、逐项审核、依赖闭合及重复采用保护', async () => {
  const lib = createLibrary('c');
  let next = await generateRouteDraft(
    { generate: async () => JSON.stringify(response) },
    lib,
    input,
    new AbortController().signal,
  );
  const draft = next.drafts[0]!;
  const event = draft.proposedEvents[0]!;
  const route = draft.proposedRoutes[0]!;
  assert.equal(next.events.length, 0);
  assert.notEqual(event.id, 'new');
  assert.throws(() => adoptRouteDraft(next, draft.id), /确认/);
  next = reviewDraftItem(next, draft.id, route.id, 'confirmed');
  assert.throws(() => adoptRouteDraft(next, draft.id, [route.id]), /依赖/);
  next = reviewDraftItem(next, draft.id, event.id, 'confirmed');
  next = adoptRouteDraft(next, draft.id, [event.id]);
  next = adoptRouteDraft(next, draft.id, [route.id]);
  assert.equal(next.events.length, 1);
  assert.equal(next.events[0]!.origin, 'ai_generated');
  assert.equal(next.routes.length, 1);
  assert.throws(() => adoptRouteDraft(next, draft.id, [event.id]), /采用/);
});
test('推断不得新增事件；过期和取消不返回草稿；无自动重试', async () => {
  const lib = createEvent(createEvent(createLibrary('c'), { title: '甲' }), { title: '乙' });
  let calls = 0;
  const host = {
    generate: async () => {
      calls++;
      return JSON.stringify(response);
    },
  };
  await assert.rejects(
    generateRouteDraft(
      host,
      lib,
      { ...input, mode: 'infer', referenceEventIds: lib.events.map((x) => x.id) },
      new AbortController().signal,
    ),
    /推断/,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    generateRouteDraft(host, lib, input, new AbortController().signal, () => false),
    /变化|过期/,
  );
  const c = new AbortController();
  c.abort();
  await assert.rejects(generateRouteDraft(host, lib, input, c.signal), /取消/);
});
test('基线变化拒绝采用且旧v2草稿兼容', async () => {
  let lib = await generateRouteDraft(
    { generate: async () => JSON.stringify(response) },
    createLibrary('c'),
    input,
    new AbortController().signal,
  );
  const d = lib.drafts[0]!;
  lib = reviewDraftItem(lib, d.id, d.proposedEvents[0]!.id, 'confirmed');
  lib = createEvent(lib, { title: '人工事件' });
  assert.throws(() => adoptRouteDraft(lib, d.id, [d.proposedEvents[0]!.id]), /基线/);
});

test('逐字引用校验、只发送选择范围及迟到结果守卫', async () => {
  const { importSources } = await import('../src/application/library');
  const { source } = await import('./fixtures');
  const lib = importSources(createLibrary('c'), [
    source,
    { ...source, id: 'secret', text: '绝不发送的秘密', fingerprint: 'secret' },
  ]);
  const chosen = lib.sources[0]!;
  let prompt = '';
  const bad = {
    ...response,
    edges: [
      {
        id: 'edge',
        sourceNodeId: 'new',
        targetNodeId: 'new',
        relationType: 'continues',
        choiceText: '',
        condition: '',
        origin: 'worldbook_explicit',
        evidence: [{ sourceSnapshotId: chosen.id, start: 0, end: 2, quote: '伪造', role: 'direct_support' }],
      },
    ],
  };
  await assert.rejects(
    generateRouteDraft(
      {
        generate: async (text) => {
          prompt = text;
          return JSON.stringify(bad);
        },
      },
      lib,
      { ...input, referenceSourceIds: [chosen.id] },
      new AbortController().signal,
    ),
    /引用/,
  );
  assert.ok(!prompt.includes('绝不发送的秘密'));
  let current = true;
  await assert.rejects(
    generateRouteDraft(
      {
        generate: async () => {
          current = false;
          return JSON.stringify(response);
        },
      },
      lib,
      input,
      new AbortController().signal,
      () => current,
    ),
    /过期/,
  );
});
test('旧v2草稿可读但缺基线不能直接采用；拒绝不更改原作来源', async () => {
  const { parseLibrary } = await import('../src/domain/library');
  const lib = await generateRouteDraft(
    { generate: async () => JSON.stringify(response) },
    createLibrary('c'),
    input,
    new AbortController().signal,
  );
  const draft = lib.drafts[0]!;
  const old = {
    id: 'old',
    revision: 1,
    mode: 'infer',
    baseLibraryRevision: 1,
    status: 'draft',
    proposedEvents: [],
    proposedEdges: [],
    proposedRoutes: [],
  };
  assert.doesNotThrow(() => parseLibrary({ ...createLibrary('old'), drafts: [old] }));
  const next = reviewDraftItem(lib, draft.id, draft.proposedEvents[0]!.id, 'rejected');
  assert.equal(next.drafts[0]!.proposedEvents[0]!.origin, 'ai_generated');
  assert.throws(() => adoptRouteDraft(next, draft.id), /确认/);
});

test('引用既有事件的草稿不阻止正式事件删除，随后采用报告基线冲突', async () => {
  const { deleteEvent } = await import('../src/application/library');
  let lib = createEvent(createEvent(createLibrary('c'), { title: '甲' }), { title: '乙' });
  const ids = lib.events.map((x) => x.id);
  const result = {
    events: [],
    edges: [
      {
        id: 'e',
        sourceNodeId: ids[0],
        targetNodeId: ids[1],
        relationType: 'continues',
        choiceText: '',
        condition: '',
        origin: 'ai_inferred',
        evidence: [],
      },
    ],
    routes: [],
  };
  lib = await generateRouteDraft(
    { generate: async () => JSON.stringify(result) },
    lib,
    { ...input, mode: 'infer', referenceEventIds: ids },
    new AbortController().signal,
  );
  const d = lib.drafts[0]!;
  lib = reviewDraftItem(lib, d.id, d.proposedEdges[0]!.id, 'confirmed');
  lib = deleteEvent(lib, ids[0]!);
  assert.throws(() => adoptRouteDraft(lib, d.id), /基线/);
});

test('playable提案允许pending保存，确认后采用仍验证可达结局与完整性', async () => {
  const data = {
    events: [{ ...response.events[0], id: 'start', kind: 'opening', title: '入口' }, response.events[0]],
    edges: [
      {
        id: 'e',
        sourceNodeId: 'start',
        targetNodeId: 'new',
        relationType: 'ending_branch',
        choiceText: '',
        condition: '',
        origin: 'ai_generated',
        evidence: [],
      },
    ],
    routes: [{ ...response.routes[0], eventIds: ['start', 'new'], edgeIds: ['e'], completeness: 'playable' }],
  };
  let lib = await generateRouteDraft(
    { generate: async () => JSON.stringify(data) },
    createLibrary('c'),
    input,
    new AbortController().signal,
  );
  const d = lib.drafts[0]!;
  assert.equal(d.proposedRoutes[0]!.completeness, 'playable');
  assert.equal(lib.routes.length, 0);
  for (const x of [...d.proposedEvents, ...d.proposedEdges, ...d.proposedRoutes])
    lib = reviewDraftItem(lib, d.id, x.id, 'confirmed');
  lib = adoptRouteDraft(lib, d.id);
  assert.equal(lib.routes[0]!.completeness, 'playable');
  const broken = { ...data, edges: [], routes: [{ ...data.routes[0], edgeIds: [] }] };
  let b = await generateRouteDraft(
    { generate: async () => JSON.stringify(broken) },
    createLibrary('c'),
    input,
    new AbortController().signal,
  );
  const bd = b.drafts[0]!;
  for (const x of [...bd.proposedEvents, ...bd.proposedRoutes])
    b = reviewDraftItem(b, bd.id, x.id, 'confirmed');
  assert.throws(() => adoptRouteDraft(b, bd.id), /可游玩/);
});
test('同值草稿编辑保留AI来源和确认状态，实质修改重置待确认并标人工', async () => {
  const { editDraftItem } = await import('../src/domain/route-drafts');
  let lib = await generateRouteDraft(
    { generate: async () => JSON.stringify(response) },
    createLibrary('c'),
    input,
    new AbortController().signal,
  );
  const d = lib.drafts[0]!,
    e = d.proposedEvents[0]!;
  lib = reviewDraftItem(lib, d.id, e.id, 'confirmed');
  lib = editDraftItem(lib, d.id, e.id, { title: e.title, summary: e.summary });
  assert.equal(lib.drafts[0]!.proposedEvents[0]!.origin, 'ai_generated');
  assert.equal(lib.drafts[0]!.itemReviews?.[e.id], 'confirmed');
  lib = editDraftItem(lib, d.id, e.id, { summary: '用户修改' });
  assert.equal(lib.drafts[0]!.proposedEvents[0]!.origin, 'user_manual');
  assert.equal(lib.drafts[0]!.itemReviews?.[e.id], 'pending');
});
test('AI创作的有效原文引用必须是创作参考，不能作为直接支持', async () => {
  const { importSources } = await import('../src/application/library');
  const { source } = await import('./fixtures');
  const lib = importSources(createLibrary('c'), [source]),
    s = lib.sources[0]!;
  const evidence = [
    { sourceSnapshotId: s.id, start: 0, end: 1, quote: s.text.slice(0, 1), role: 'direct_support' },
  ];
  const bad = { ...response, events: [{ ...response.events[0], evidence }] };
  await assert.rejects(
    generateRouteDraft(
      { generate: async () => JSON.stringify(bad) },
      lib,
      { ...input, referenceSourceIds: [s.id] },
      new AbortController().signal,
    ),
    /创作参考/,
  );
  const good = {
    ...response,
    events: [
      { ...response.events[0], evidence: evidence.map((e) => ({ ...e, role: 'creative_reference' })) },
    ],
  };
  await assert.doesNotReject(
    generateRouteDraft(
      { generate: async () => JSON.stringify(good) },
      lib,
      { ...input, referenceSourceIds: [s.id] },
      new AbortController().signal,
    ),
  );
});

test('pending草稿也拒绝剧情关系环路', async () => {
  const events = [
    { ...response.events[0], id: 'a' },
    { ...response.events[0], id: 'b' },
  ];
  const edge = {
    relationType: 'continues',
    choiceText: '',
    condition: '',
    origin: 'ai_generated',
    evidence: [],
  };
  const data = {
    events,
    edges: [
      { ...edge, id: 'ab', sourceNodeId: 'a', targetNodeId: 'b' },
      { ...edge, id: 'ba', sourceNodeId: 'b', targetNodeId: 'a' },
    ],
    routes: [{ ...response.routes[0], eventIds: ['a', 'b'], edgeIds: ['ab', 'ba'] }],
  };
  await assert.rejects(
    generateRouteDraft(
      { generate: async () => JSON.stringify(data) },
      createLibrary('c'),
      input,
      new AbortController().signal,
    ),
    /环路/,
  );
});
