import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeChatMaterials, type ChatCapture } from '../src/domain/chat-materials.ts';
import { materialSchema, materialText } from '../src/domain/materials.ts';
import { Repository } from '../src/storage/repository.ts';
import { ChatMaterialsController } from '../src/application/chat-materials.ts';
import type { ContextSnapshot } from '../src/host/tavern.ts';
import { MaterialsController } from '../src/application/materials.ts';
import { LibraryRepository } from '../src/storage/library-repository.ts';
import { createLibrary, createEvent } from '../src/application/library.ts';
import type { GuideController } from '../src/application/controller.ts';

const capture: ChatCapture = {
  chatKey: 'route-a',
  transcript: 'snapshot',
  messages: [
    { number: 1, role: 'character', speaker: '甲', text: '两位成年伴侣在亲密场景后约定坦诚交谈。' },
    { number: 2, role: 'user', speaker: '玩家', text: '我选择道歉，两人因此重新建立信任。' },
  ],
};
const response = () =>
  JSON.stringify({
    materials: [
      {
        title: '重建信任',
        category: 'scene',
        tags: [],
        description: '交谈与道歉改变了关系。',
        scene: {
          participants: ['甲', '玩家'],
          location: '未知',
          time: '未知',
          context: '亲密场景后',
          trigger: '坦诚交谈',
          keyEvents: ['约定交谈', '道歉'],
          choices: ['选择道歉'],
          relationshipChanges: ['重新建立信任'],
          consequences: ['未知'],
        },
        evidence: [
          { messageNumber: 1, quote: capture.messages[0]!.text },
          { messageNumber: 2, quote: capture.messages[1]!.text },
        ],
      },
    ],
  });

test('关键场景可跨消息提取事件、选择和后果，不要求原创开场', async () => {
  const card = decodeChatMaterials(response(), capture)[0]!;
  assert.equal(card.opening, '');
  assert.deepEqual(card.scene?.choices, ['选择道歉']);
  assert.equal(card.evidence?.length, 2);
  assert.equal(card.scene?.summaryOrigin, 'ai_extracted');
  assert.equal(card.scene?.status, 'draft');
  assert.ok(materialText(card).includes('重新建立信任'));
  const repository = new Repository('scene-' + Math.random());
  await repository.saveMaterial('u', 'a', card);
  assert.deepEqual((await repository.loadMaterials('u', 'a'))[0], card);
  assert.deepEqual(await repository.loadMaterials('u', 'b'), []);
});

test('跨消息证据不能拼接原文或引用未选消息', () => {
  assert.throws(
    () =>
      decodeChatMaterials(
        response().replace('我选择道歉，两人因此重新建立信任。', '约定坦诚交谈。我选择道歉'),
        capture,
      ),
    /引用/,
  );
  assert.throws(
    () => decodeChatMaterials(response(), { ...capture, messages: capture.messages.slice(0, 1) }),
    /引用/,
  );
});

test('旧素材可读，新素材证据偏移被篡改时拒绝保存', () => {
  const legacy = {
    schemaVersion: 1,
    id: 'personal:legacy',
    title: '旧场景',
    category: 'scene',
    tags: [],
    description: '旧描述',
    opening: '旧开场',
    origin: 'dialogue',
    quote: '原文',
    source: { label: '旧来源', text: '原文', start: 0, end: 2 },
  };
  assert.equal(materialSchema.parse(legacy).opening, '旧开场');
  const card = decodeChatMaterials(response(), capture)[0]!;
  assert.equal(
    materialSchema.safeParse({ ...card, evidence: [{ ...card.evidence![0], start: 1 }] }).success,
    false,
  );
});

test('AI草稿保存不能替换第二段来源，原文和模型未提取原因分别保留', async () => {
  const repository = new Repository('scene-guards-' + Math.random());
  const snapshot: ContextSnapshot = {
    user: 'u',
    characterKey: 'a',
    characterName: '甲',
    chatKey: capture.chatKey,
    transcript: capture.transcript,
    sources: [],
    bookNames: [],
    api: 'test',
  };
  const controller = new ChatMaterialsController(
    {
      isCurrent: () => true,
      transcript: () => capture.transcript,
      chatLength: () => 2,
      readChat: () => capture.messages,
      generate: async () => response(),
    },
    repository,
    snapshot,
  );
  const draft = await controller.generate(capture, [1, 2], new AbortController().signal);
  const card = draft.cards[0]!;
  const evidence = card.evidence!.map((row, index) => (index ? { ...row, label: '伪造标签' } : row));
  await assert.rejects(controller.save(draft, [{ ...card, evidence }]), /来源/);
  assert.throws(() => controller.archive(capture, [1, 2], draft, [{ ...card, evidence }]), /引用/);
  let reason = '';
  assert.deepEqual(
    decodeChatMaterials('{"materials":[],"reason":"无法提取"}', capture, capture.messages, (value) => {
      reason = value;
    }),
    [],
  );
  assert.equal(reason, '无法提取');
  await controller.save(draft, [{ ...card, scene: { ...card.scene!, status: 'confirmed' } }]);
  assert.deepEqual((await repository.loadMaterials('u', 'a'))[0]?.evidence, card.evidence);
});

test('场景只能关联当前角色实际存在事件，失效引用可显式移除', async () => {
  const name = 'scene-links-' + Math.random();
  const repository = new Repository(name);
  const libraries = new LibraryRepository(name);
  const snapshot: ContextSnapshot = {
    user: 'u',
    characterKey: 'a',
    characterName: '甲',
    chatKey: capture.chatKey,
    transcript: capture.transcript,
    sources: [],
    bookNames: [],
    api: 'test',
  };
  const controller = new MaterialsController(
    { guard: () => {}, repository } as unknown as GuideController,
    snapshot,
    libraries,
  );
  const lib = await libraries.save('u', createEvent(createLibrary('a'), { title: '调查' }));
  const card = decodeChatMaterials(response(), capture)[0]!;
  await repository.saveMaterial('u', 'a', card);
  await assert.rejects(controller.setLinks(card, ['event:nonexistent'], []), /不存在/);
  await controller.setLinks(card, [lib.events[0]!.id], []);
  assert.deepEqual((await repository.loadMaterials('u', 'a'))[0]?.relatedEventIds, [lib.events[0]!.id]);
  const links = await controller.links();
  assert.equal(links?.events[0]?.title, '调查');
  await controller.setLinks((await repository.loadMaterials('u', 'a'))[0]!, [], []);
  assert.deepEqual((await repository.loadMaterials('u', 'a'))[0]?.relatedEventIds, []);
});
