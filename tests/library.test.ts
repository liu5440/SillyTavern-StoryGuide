import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLibrary,
  importSources,
  createEvent,
  createRoute,
  addEventToRoute,
  createEdge,
  migrateStory,
} from '../src/application/library.ts';
import { formalRoute, parseLibrary } from '../src/domain/library.ts';
import { parseStory } from '../src/domain/story.ts';
import { fixture, source } from './fixtures.ts';

test('资料分类不改原来源，人工改写归纳必须标人工且保留原文', async () => {
  const { updateMaterial } = await import('../src/application/library.ts');
  const lib = importSources(createLibrary('alice'), [source]);
  const material = lib.materials[0]!;
  const classified = updateMaterial(lib, material.id, { categories: ['world'] });
  assert.equal(classified.materials[0]!.origin, 'worldbook_explicit');
  const edited = updateMaterial(classified, material.id, { summary: '人工新增的剧情解释' });
  assert.equal(edited.materials[0]!.origin, 'user_manual');
  assert.equal(edited.sources[0]!.text, source.text);
  assert.deepEqual(edited.materials[0]!.evidence, material.evidence);
});

test('JSON导入不能藏入悬空草稿关系或假称空路线可游玩', () => {
  let lib = createRoute(createLibrary('alice'), '空路线');
  lib.routes[0]!.completeness = 'playable';
  assert.throws(() => parseLibrary(lib), /可游玩/);
  lib = createLibrary('alice');
  lib.drafts.push({
    id: 'draft:bad',
    revision: 1,
    mode: 'infer',
    baseLibraryRevision: 1,
    status: 'pending',
    proposedEvents: [],
    proposedRoutes: [],
    proposedEdges: [
      {
        id: 'edge:bad',
        revision: 1,
        origin: 'worldbook_explicit',
        status: 'confirmed',
        evidence: [],
        sourceNodeId: 'missing:a',
        targetNodeId: 'missing:b',
        relationType: 'continues',
        choiceText: '',
        condition: '',
      },
    ],
  });
  assert.throws(() => parseLibrary(lib), /草稿.*(直接依据|端点不存在)/);
});

test('资料导入不创建事件，重导入保留旧证据及人工内容', () => {
  let lib = importSources(createLibrary('alice'), [source]);
  assert.equal(lib.events.length, 0);
  assert.equal(lib.materials.length, 1);
  lib = createEvent(lib, { title: '人工事件' });
  const id = lib.events[0]!.id;
  lib = importSources(lib, [{ ...source, text: '变化内容', fingerprint: 'v2' }]);
  assert.equal(lib.events[0]!.id, id);
  assert.equal(lib.sources.length, 2);
  assert.equal(lib.reports.at(-1)!.issues[0]!.code, 'source_changed');
});
test('共享引用、正式确认投影及无依据原作连线校验', () => {
  let lib = createEvent(createEvent(createLibrary('alice'), { title: '甲' }), { title: '乙' });
  lib = createRoute(lib, '共同线');
  const r = lib.routes[0]!.id;
  for (const event of lib.events) lib = addEventToRoute(lib, r, event.id);
  const input = { sourceNodeId: lib.events[0]!.id, targetNodeId: lib.events[1]!.id };
  assert.throws(() => createEdge(lib, r, { ...input, origin: 'worldbook_explicit' }));
  lib = createEdge(lib, r, input);
  assert.equal(formalRoute(lib, r).edges.length, 1);
  lib.edges[0]!.status = 'pending';
  assert.equal(formalRoute(lib, r).edges.length, 0);
  lib = createRoute(lib, '个人线');
  lib = addEventToRoute(lib, lib.routes[1]!.id, lib.events[0]!.id);
  assert.equal(lib.events.length, 2);
  assert.equal(parseLibrary(lib).routes.length, 2);
});
test('v1迁移不假定旧引用是已审核事实', () => {
  const old = parseStory(fixture());
  old.nodes[0]!.provenance = 'explicit';
  old.nodes[0]!.refs = [{ sourceId: source.id, quote: source.text }];
  const copy = JSON.stringify(old);
  const lib = migrateStory(old);
  assert.equal(lib.events[0]!.status, 'pending');
  assert.equal(JSON.stringify(old), copy);
});

test('确认保留AI来源；旧资料节点迁移不污染事件；引用越界拒绝', async () => {
  const { updateEvent, updateEdge, updateMaterial, setRoutePosition } = await import(
    '../src/application/library.ts'
  );
  let lib = createEvent(createLibrary('alice'), { title: '建议', origin: 'ai_generated', status: 'pending' });
  lib = updateEvent(lib, lib.events[0]!.id, { status: 'confirmed' });
  assert.equal(lib.events[0]!.origin, 'ai_generated');
  lib = createEvent(lib, { title: '终点' });
  lib = createRoute(lib, '路线');
  const r = lib.routes[0]!.id;
  for (const e of lib.events) lib = addEventToRoute(lib, r, e.id);
  lib = createEdge(lib, r, {
    sourceNodeId: lib.events[0]!.id,
    targetNodeId: lib.events[1]!.id,
    origin: 'ai_inferred',
    status: 'pending',
  });
  lib = updateEdge(lib, lib.edges[0]!.id, { status: 'confirmed' });
  assert.equal(lib.edges[0]!.origin, 'ai_inferred');
  assert.throws(() => setRoutePosition(lib, 'missing', lib.events[0]!.id, { x: 1, y: 2 }), /路线不存在/);
  const old = parseStory(fixture());
  old.nodes[0]!.id = 'source-1';
  old.nodes[0]!.chapter = '原始资料（不代表事件）';
  old.edges = [];
  const migrated = migrateStory(old);
  assert.equal(migrated.events.length, 1);
  assert.equal(migrated.materials.length, 1);
  let imported = importSources(
    createLibrary('alice'),
    [source],
    [{ sourceKey: 'bad', label: '坏条目', code: 'invalid_entry', message: '格式错误' }],
  );
  assert.equal(imported.reports.at(-1)!.issues[0]!.sourceKey, 'bad');
  assert.equal(imported.reports.at(-1)!.state, 'partial');
  imported = updateMaterial(imported, imported.materials[0]!.id, { categories: ['character'] });
  assert.deepEqual(imported.materials[0]!.categories, ['character']);
  imported.materials[0]!.evidence[0]!.end = 99999;
  assert.throws(() => parseLibrary(imported), /引用定位无效/);
});

test('共享事件的路线布局独立，移除当前路线引用不删除另一条路线事件与连接', async () => {
  const { setRoutePosition, removeEventFromRoute } = await import('../src/application/library.ts');
  let lib = createEvent(createEvent(createLibrary('alice'), { title: '共享甲' }), { title: '共享乙' });
  lib = createRoute(createRoute(lib, '公共线'), '个人线');
  const [r1, r2] = lib.routes;
  assert.ok(r1 && r2);
  for (const route of [r1, r2])
    for (const event of lib.events) lib = addEventToRoute(lib, route.id, event.id);
  const [a, b] = lib.events;
  assert.ok(a && b);
  for (const route of [r1, r2]) lib = createEdge(lib, route.id, { sourceNodeId: a.id, targetNodeId: b.id });
  lib = setRoutePosition(lib, r1.id, a.id, { x: 10, y: 20 });
  lib = setRoutePosition(lib, r2.id, a.id, { x: 300, y: 400 });
  assert.deepEqual(lib.routes[0]!.positions[a.id], { x: 10, y: 20 });
  assert.deepEqual(lib.routes[1]!.positions[a.id], { x: 300, y: 400 });
  lib = removeEventFromRoute(lib, r1.id, a.id);
  assert.equal(lib.events.length, 2);
  assert.equal(lib.routes[0]!.edgeIds.length, 0);
  assert.equal(formalRoute(lib, r2.id).edges.length, 1);
  assert.equal(lib.routes[1]!.eventIds.length, 2);
});
test('剧情衔接环路拒绝，待确认关系不进入正式图且确认时检测环路', async () => {
  const { updateEdge } = await import('../src/application/library.ts');
  let lib = createEvent(createEvent(createLibrary('alice'), { title: '甲' }), { title: '乙' });
  lib = createRoute(lib, '路线');
  const r = lib.routes[0]!.id;
  for (const e of lib.events) lib = addEventToRoute(lib, r, e.id);
  const a = lib.events[0]!.id,
    b = lib.events[1]!.id;
  lib = createEdge(lib, r, { sourceNodeId: a, targetNodeId: b });
  assert.throws(() => createEdge(lib, r, { sourceNodeId: b, targetNodeId: a }), /环路/);
  lib = createEdge(lib, r, { sourceNodeId: b, targetNodeId: a, status: 'pending', origin: 'ai_inferred' });
  assert.equal(formalRoute(lib, r).edges.length, 1);
  assert.throws(() => updateEdge(lib, lib.edges.at(-1)!.id, { status: 'confirmed' }), /环路/);
});
test('证据起止相等、反向、越界和摘录不符均拒绝', () => {
  const original = importSources(createLibrary('alice'), [source]);
  for (const patch of [{ start: 2, end: 2 }, { start: 3, end: 1 }, { end: 9999 }, { quote: '伪造' }]) {
    const lib = structuredClone(original);
    Object.assign(lib.materials[0]!.evidence[0]!, patch);
    assert.throws(() => parseLibrary(lib), /引用定位无效/);
  }
});
test('多次重导入及来源变化保留分类、人工事件、原证据并复用相同快照', async () => {
  const { updateMaterial, updateEvent } = await import('../src/application/library.ts');
  let lib = importSources(createLibrary('alice'), [source]);
  const materialId = lib.materials[0]!.id;
  lib = updateMaterial(lib, materialId, { categories: ['plot'], summary: '人工整理' });
  lib = createEvent(lib, { title: '核心场景', materialIds: [materialId] });
  const eventId = lib.events[0]!.id;
  lib = updateEvent(lib, eventId, { summary: '人工修订' });
  const same = importSources(lib, [source]);
  assert.equal(same.materials.length, 1);
  assert.equal(same.sources.length, 1);
  const updated = { ...source, text: '新的原文内容', fingerprint: 'changed' };
  lib = importSources(same, [updated]);
  lib = importSources(lib, [updated]);
  assert.equal(lib.sources.length, 2);
  assert.equal(lib.materials.length, 2);
  assert.equal(lib.materials[0]!.summary, '人工整理');
  assert.deepEqual(lib.materials[0]!.categories, ['plot']);
  assert.equal(lib.events[0]!.summary, '人工修订');
  assert.equal(lib.events[0]!.id, eventId);
  assert.equal(lib.sources[0]!.text, source.text);
});
test('AI确认不改变来源，实质人工改写才改变来源且保留证据', async () => {
  const { updateEvent, updateEdge } = await import('../src/application/library.ts');
  let lib = createEvent(
    createEvent(createLibrary('alice'), { title: '甲', origin: 'ai_generated', status: 'pending' }),
    { title: '乙' },
  );
  const event = lib.events[0]!;
  lib = updateEvent(lib, event.id, {
    title: event.title,
    summary: event.summary,
    status: 'confirmed',
    origin: 'user_manual',
  });
  assert.equal(lib.events[0]!.origin, 'ai_generated');
  lib = updateEvent(lib, event.id, { summary: '人工新剧情' });
  assert.equal(lib.events[0]!.origin, 'user_manual');
  lib = createRoute(lib, '路线');
  const r = lib.routes[0]!.id;
  for (const e of lib.events) lib = addEventToRoute(lib, r, e.id);
  lib = createEdge(lib, r, {
    sourceNodeId: lib.events[0]!.id,
    targetNodeId: lib.events[1]!.id,
    origin: 'ai_inferred',
    status: 'pending',
  });
  const edge = lib.edges[0]!;
  lib = updateEdge(lib, edge.id, { condition: edge.condition, status: 'confirmed', origin: 'user_manual' });
  assert.equal(lib.edges[0]!.origin, 'ai_inferred');
  lib = updateEdge(lib, edge.id, { condition: '人工触发条件' });
  assert.equal(lib.edges[0]!.origin, 'user_manual');
});
