import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractMaterial } from '../src/domain/materials.ts';
import { Repository } from '../src/storage/repository.ts';
const original = () =>
  extractMaterial({
    id: 'personal:source',
    title: '场景',
    category: 'scene',
    tags: [],
    description: '原场景',
    opening: '',
    source: { label: '原文', text: '已有剧情', start: 0, end: 4 },
  });

test('素材派生与收藏原子新增，保留原条目且拒绝跨角色或旧基线', async () => {
  const repo = new Repository('material-copies-cas');
  const card = original();
  await repo.saveMaterial('u', 'c', card);
  const copy = { ...card, id: 'personal:copy', title: '拆分一' };
  await repo.saveMaterialCopies('u', 'c', [copy], [card], [copy.id], () => {});
  assert.equal((await repo.loadMaterials('u', 'c')).length, 2);
  assert.deepEqual(await repo.loadMaterialFavorites('u', 'c'), [copy.id]);
  await assert.rejects(
    repo.saveMaterialCopies('u', 'other', [{ ...copy, id: 'personal:other' }], [card], [], () => {}),
  );
  await repo.updateMaterial('u', 'c', { ...card, title: '较新编辑' });
  await assert.rejects(
    repo.saveMaterialCopies('u', 'c', [{ ...copy, id: 'personal:stale' }], [card], [], () => {}),
  );
  assert.equal((await repo.loadMaterials('u', 'c')).length, 2);
});

test('派生素材冲突或取消时没有部分条目及收藏，不允许收藏非新增ID', async () => {
  const repo = new Repository('material-copies-atomic');
  const card = original();
  await repo.saveMaterial('u', 'c', card);
  await assert.rejects(
    repo.saveMaterialCopies(
      'u',
      'c',
      [{ ...card, id: 'personal:new' }, card],
      [],
      ['personal:new'],
      () => {},
    ),
  );
  await assert.rejects(
    repo.saveMaterialCopies('u', 'c', [{ ...card, id: 'personal:new' }], [], ['personal:missing'], () => {}),
  );
  await assert.rejects(
    repo.saveMaterialCopies('u', 'c', [{ ...card, id: 'personal:new' }], [], ['personal:new'], () => {
      throw new Error('上下文已变');
    }),
  );
  assert.equal((await repo.loadMaterials('u', 'c')).length, 1);
  assert.deepEqual(await repo.loadMaterialFavorites('u', 'c'), []);
});
