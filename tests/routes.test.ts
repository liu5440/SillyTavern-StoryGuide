import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLibrary,
  createRoute,
  createEvent,
  addEventToRoute,
  createEdge,
  setRoutePosition,
} from '../src/application/library.ts';
import { updateRoute, deleteRoute, duplicateRoute } from '../src/application/routes.ts';

test('人物路线改名不改ID，复制共享事件但独立布局，删除不删共享事件和边', () => {
  let lib = createEvent(createEvent(createLibrary('alice'), { title: '会面' }), { title: '选择' });
  lib = createRoute(lib, '公共线', 'common');
  const routeId = lib.routes[0]!.id;
  for (const event of lib.events) lib = addEventToRoute(lib, routeId, event.id);
  lib = createEdge(lib, routeId, { sourceNodeId: lib.events[0]!.id, targetNodeId: lib.events[1]!.id });
  lib = setRoutePosition(lib, routeId, lib.events[0]!.id, { x: 100, y: 120 });
  lib = updateRoute(lib, routeId, { title: '艾琳个人线', kind: 'character', characters: ['艾琳'] });
  assert.equal(lib.routes[0]!.id, routeId);
  assert.deepEqual(lib.routes[0]!.characters, ['艾琳']);
  lib = duplicateRoute(lib, routeId, '另一条路线');
  const duplicateId = lib.routes[1]!.id;
  assert.deepEqual(lib.routes[1]!.eventIds, lib.routes[0]!.eventIds);
  lib = setRoutePosition(lib, duplicateId, lib.events[0]!.id, { x: 500, y: 600 });
  assert.equal(lib.routes[0]!.positions[lib.events[0]!.id]!.x, 100);
  lib = deleteRoute(lib, routeId);
  assert.equal(lib.routes[0]!.id, duplicateId);
  assert.equal(lib.events.length, 2);
  assert.equal(lib.edges.length, 1);
});

test('无效路线操作和空路线假设可游玩均明确拒绝，不改变输入', () => {
  const lib = createRoute(createLibrary('alice'), '片段');
  const before = JSON.stringify(lib);
  assert.throws(() => updateRoute(lib, 'missing', { title: '不存在' }), /不存在/);
  assert.throws(() => deleteRoute(lib, 'missing'), /不存在/);
  assert.throws(() => duplicateRoute(lib, 'missing', '复制'), /不存在/);
  assert.throws(() => updateRoute(lib, lib.routes[0]!.id, { completeness: 'playable' }), /可游玩/);
  assert.equal(JSON.stringify(lib), before);
});
