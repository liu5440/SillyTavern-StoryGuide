import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLibrary, importSources } from '../src/application/library.ts';
import { groupMaterials } from '../src/domain/material-groups.ts';
import { classifyMaterials } from '../src/application/material-classification.ts';
import { source } from './fixtures.ts';

test('同文不同出处仅展示折叠，碰撞/空文/禁用状态与人工修改不折叠', () => {
  const lib = importSources(createLibrary('alice'), [source, { ...source, id: 'external', label: '外部书' }]);
  const before = JSON.stringify(lib);
  assert.equal(groupMaterials(lib).length, 1);
  assert.equal(groupMaterials(lib)[0]?.members.length, 2);
  assert.equal(JSON.stringify(lib), before);
  const changed = structuredClone(lib);
  const second = changed.materials[1];
  assert.ok(second);
  second.title = '人工改名';
  assert.equal(groupMaterials(changed).length, 2);
  second.title = '外部书';
  const snapshot = changed.sources[1];
  assert.ok(snapshot);
  snapshot.text += '不同内容';
  assert.equal(groupMaterials(changed).length, 2);
  snapshot.text = source.text;
  snapshot.disabled = !source.disabled;
  assert.equal(groupMaterials(changed).length, 2);
  assert.equal(
    groupMaterials(
      importSources(createLibrary('a'), [
        { ...source, text: '' },
        { ...source, id: 'empty2', text: '' },
      ]),
    ).length,
    2,
  );
});

test('批量分类一次修订且保留事实证据，非法ID或分类整体拒绝', () => {
  const lib = importSources(createLibrary('alice'), [source, { ...source, id: 'external' }]);
  const ids = lib.materials.map((m) => m.id);
  const next = classifyMaterials(lib, ids, 'character');
  assert.equal(groupMaterials(next).length, 1);
  assert.equal(next.revision, lib.revision + 1);
  for (const [i, material] of next.materials.entries()) {
    assert.deepEqual(material.categories, ['character']);
    assert.equal(material.origin, lib.materials[i]?.origin);
    assert.deepEqual(material.evidence, lib.materials[i]?.evidence);
    assert.equal(material.userEdited, true);
  }
  assert.deepEqual(next.sources, lib.sources);
  assert.deepEqual(next.events, lib.events);
  assert.throws(() => classifyMaterials(lib, [...ids, 'missing'], 'world'), /资料不存在/);
  assert.throws(() => classifyMaterials(lib, ids, 'invalid'), /分类/);
  assert.throws(() => classifyMaterials(lib, [], 'plot'), /选择/);
  assert.deepEqual(
    lib.materials.map((m) => m.categories),
    [['unclassified'], ['unclassified']],
  );
});
