import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractMaterial } from '../src/domain/materials.ts';
import { Repository } from '../src/storage/repository.ts';

const card = () =>
  extractMaterial({
    id: 'personal:history',
    title: '旧标题',
    category: 'scene',
    tags: [],
    description: '旧简介',
    opening: '',
    source: { label: '原文', text: '原文场景', start: 0, end: 4 },
  });

test('编辑素材保留原文并原子保存历史，其他角色不能覆盖', async () => {
  const repo = new Repository('material-history-save');
  await repo.saveMaterial('u', 'a', card());
  await repo.updateMaterial('u', 'a', { ...card(), title: '新标题' });
  assert.equal((await repo.loadMaterials('u', 'a'))[0]?.title, '新标题');
  assert.equal((await repo.loadMaterialHistory('u', 'a', card().id))[0]?.title, '旧标题');
  await assert.rejects(repo.updateMaterial('u', 'b', { ...card(), title: '串角色' }));
  const changed = extractMaterial({
    ...card(),
    source: { label: '原文', text: '不同场景', start: 0, end: 4 },
  });
  await assert.rejects(repo.updateMaterial('u', 'a', changed));
  assert.equal((await repo.loadMaterials('u', 'a'))[0]?.title, '新标题');
});

test('上下文失效时编辑事务回滚，不留下历史或部分修改', async () => {
  const repo = new Repository('material-history-guard');
  await repo.saveMaterial('u', 'a', card());
  await assert.rejects(
    repo.updateMaterial('u', 'a', { ...card(), title: '过期' }, () => {
      throw new Error('已切换');
    }),
  );
  assert.equal((await repo.loadMaterials('u', 'a'))[0]?.title, '旧标题');
  assert.equal((await repo.loadMaterialHistory('u', 'a', card().id)).length, 0);
});

test('过期素材表单不能覆盖较新的人工编辑', async () => {
  const repo = new Repository('material-history-conflict');
  const initial = card();
  await repo.saveMaterial('u', 'a', initial);
  await repo.updateMaterial('u', 'a', { ...initial, title: '已更新' }, undefined, undefined, initial);
  await assert.rejects(
    repo.updateMaterial('u', 'a', { ...initial, title: '旧窗口修改' }, undefined, undefined, initial),
  );
  assert.equal((await repo.loadMaterials('u', 'a'))[0]?.title, '已更新');
  assert.equal((await repo.loadMaterialHistory('u', 'a', initial.id)).length, 1);
});
