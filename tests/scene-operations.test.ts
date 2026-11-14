import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractMaterial } from '../src/domain/materials.ts';
import { deriveScenes, previewMaterialBackup } from '../src/domain/scene-operations.ts';
const card = extractMaterial({
  id: 'personal:a',
  title: '场景',
  category: 'scene',
  tags: [],
  description: '摘要',
  opening: '',
  source: { label: '原文', text: '甲乙丙', start: 0, end: 3 },
  scene: {
    participants: [],
    location: '',
    time: '',
    context: '',
    trigger: '',
    keyEvents: ['甲'],
    choices: [],
    relationshipChanges: [],
    consequences: [],
    summaryOrigin: 'user_manual',
    status: 'confirmed',
  },
});
test('拆分保留全部证据、人工标记和派生身份，禁止冒充原记录', () => {
  const rows = deriveScenes(
    [card],
    [
      { title: '一', description: '人工一', scene: card.scene! },
      { title: '二', description: '人工二', scene: card.scene! },
    ],
    () => crypto.randomUUID(),
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0]?.evidence, card.evidence);
  assert.deepEqual(rows[0]?.derivedFromIds, [card.id]);
  assert.equal(rows[0]?.scene?.summaryOrigin, 'user_manual');
  assert.throws(() => deriveScenes([card], [{ title: '一', description: '一' }]));
  assert.throws(() =>
    deriveScenes([{ ...card, scene: undefined }], [{ title: '一', description: '一', scene: card.scene! }]),
  );
});
test('备份先校验角色账号、引用、容量与类型，另存ID且收藏只指实际导入项', () => {
  const backup = {
    format: 'story-guide-materials',
    schemaVersion: 1,
    characterKey: 'c',
    user: 'u',
    materials: [card],
    favorites: [card.id, 'builtin:fake'],
  };
  const preview = previewMaterialBackup(JSON.stringify(backup), 'u', 'c', [card]);
  assert.equal(preview.conflicts.length, 1);
  assert.notEqual(preview.cards[0]?.id, card.id);
  assert.deepEqual(preview.favorites, [preview.cards[0]?.id]);
  assert.throws(() => previewMaterialBackup(JSON.stringify({ ...backup, user: 'other' }), 'u', 'c', []));
  assert.throws(() =>
    previewMaterialBackup(JSON.stringify({ ...backup, characterKey: 'other' }), 'u', 'c', []),
  );
  assert.throws(() =>
    previewMaterialBackup(
      JSON.stringify({ ...backup, materials: [{ ...card, quote: '伪造' }] }),
      'u',
      'c',
      [],
    ),
  );
  assert.throws(() =>
    previewMaterialBackup(JSON.stringify({ ...backup, format: 'story-guide-chat-archive' }), 'u', 'c', []),
  );
  assert.throws(() =>
    previewMaterialBackup(
      JSON.stringify(backup),
      'u',
      'c',
      Array.from({ length: 200 }, () => card),
    ),
  );
  assert.equal(
    previewMaterialBackup(JSON.stringify({ ...backup, user: undefined }), 'u', 'c', []).legacyAccount,
    true,
  );
});

test('合并保留各消息独立快照，不把跨消息拼成一条引用', () => {
  const other = extractMaterial({
    id: 'personal:b',
    title: '另一场景',
    category: 'scene',
    tags: [],
    description: '另一摘要',
    opening: '',
    source: { label: '第二段', text: '丁戊己', start: 0, end: 3 },
    scene: card.scene,
  });
  const [merged] = deriveScenes(
    [card, other],
    [{ title: '合并', description: '人工合并', scene: card.scene }],
  );
  assert.deepEqual(merged?.evidence, [...(card.evidence ?? []), ...(other.evidence ?? [])]);
  assert.deepEqual(merged?.derivedFromIds, [card.id, other.id]);
  assert.deepEqual(merged?.relatedEventIds, []);
  assert.deepEqual(merged?.source, card.source);
  assert.throws(() =>
    deriveScenes([card, card], [{ title: '重复', description: '重复', scene: card.scene }]),
  );
});
