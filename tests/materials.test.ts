import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  materialSchema,
  extractMaterial,
  filterMaterials,
  materialText,
  builtinMaterials,
} from '../src/domain/materials.ts';
import { Repository } from '../src/storage/repository.ts';

const input = {
  id: 'personal:test',
  title: '窗边等候',
  category: 'scene' as const,
  tags: ['重逢'],
  description: '等雨停后再出发。',
  opening: '她把另一杯热茶推向你。',
  source: { label: '自选对话', text: '开头\n她在窗边等雨停。\n结尾', start: 3, end: 11 },
};

test('对话摘录保留准确选区，用户改编与原文分开', () => {
  const card = extractMaterial(input);
  assert.equal(card.quote, input.source.text.slice(3, 11));
  assert.equal(card.origin, 'dialogue');
  assert.match(materialText(card), /用户改编/);
  assert.throws(() => extractMaterial({ ...input, source: { ...input.source, end: 500 } }));
  assert.throws(() => materialSchema.parse({ ...card, quote: '并不存在的原文' }));
  assert.throws(() => extractMaterial({ ...input, source: { ...input.source, text: '字'.repeat(20001) } }));
});

test('内置素材都有原创标记，分类与搜索共用过滤', () => {
  assert.ok(builtinMaterials.length >= 16);
  for (const card of builtinMaterials) assert.equal(materialSchema.parse(card).origin, 'builtin');
  const result = filterMaterials(builtinMaterials, 'outfit', '缎面');
  assert.ok(result.length > 0);
  assert.ok(result.every((card) => card.category === 'outfit'));
  assert.equal(filterMaterials(builtinMaterials, 'all', '完全不存在的搜索').length, 0);
});

test('个人素材与收藏隔离账号角色，删除不影响其他角色', async () => {
  const repo = new Repository('materials-isolation');
  const card = extractMaterial(input);
  await repo.saveMaterial('u1', 'a', card);
  await repo.setMaterialFavorite('u1', 'a', card.id, true);
  assert.equal((await repo.loadMaterials('u1', 'a')).length, 1);
  assert.deepEqual(await repo.loadMaterialFavorites('u1', 'a'), [card.id]);
  assert.equal((await repo.loadMaterials('u2', 'a')).length, 0);
  assert.equal((await repo.loadMaterials('u1', 'b')).length, 0);
  assert.deepEqual(await repo.loadMaterialFavorites('u2', 'a'), []);
  await assert.rejects(repo.saveMaterial('u1', 'a', { ...card, quote: '错误引用' }));
  assert.equal((await repo.loadMaterials('u1', 'a'))[0]?.quote, card.quote);
  await repo.removeMaterial('u1', 'a', card.id);
  assert.deepEqual(await repo.loadMaterials('u1', 'a'), []);
  assert.deepEqual(await repo.loadMaterialFavorites('u1', 'a'), []);
});

test('并发新增不突破200条上限，同ID不覆盖旧条目', async () => {
  const repo = new Repository('materials-limits');
  const card = extractMaterial(input);
  for (let i = 0; i < 199; i++) await repo.saveMaterial('u', 'a', { ...card, id: `personal:item-${i}` });
  await assert.rejects(repo.saveMaterial('u', 'a', { ...card, id: 'personal:item-0', title: '覆盖' }));
  const results = await Promise.allSettled([
    repo.saveMaterial('u', 'a', { ...card, id: 'personal:last-a' }),
    repo.saveMaterial('u', 'a', { ...card, id: 'personal:last-b' }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal((await repo.loadMaterials('u', 'a')).length, 200);
  assert.equal(
    (await repo.loadMaterials('u', 'a')).find((row) => row.id === 'personal:item-0')?.title,
    card.title,
  );
});
