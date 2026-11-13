import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectChatMessages, decodeChatMaterials, type ChatCapture } from '../src/domain/chat-materials.ts';
import { ChatMaterialsController } from '../src/application/chat-materials.ts';
import { Repository } from '../src/storage/repository.ts';
import type { ContextSnapshot } from '../src/host/tavern.ts';

const snapshot: ContextSnapshot = {
  user: 'u',
  characterKey: 'alice.png',
  characterName: '艾琳',
  chatKey: 'chat-a',
  sources: [],
  bookNames: [],
  api: 'test',
  transcript: 'old',
};
const messages = [
  { number: 1, role: 'user' as const, speaker: '玩家', text: '要去书店坐坐吗？' },
  { number: 3, role: 'character' as const, speaker: '艾琳', text: '她把另一杯热茶推向你。' },
];
const capture: ChatCapture = { chatKey: 'chat-a', transcript: 'now', messages };
const output = () =>
  JSON.stringify({
    materials: [
      {
        title: '热茶邀约',
        category: 'scene',
        tags: ['温柔'],
        description: '成年旧友在书店聊天。',
        opening: '要不要一起看这本书？',
        messageNumber: 3,
        quote: '她把另一杯热茶推向你。',
      },
    ],
  });

test('只读当前范围，排除系统消息，空消息与超限不能伪装成功', () => {
  const raw = [
    { mes: '开头', is_user: true, name: '玩家' },
    { mes: '系统指令', is_system: true },
    { mes: '<b>热茶</b>', is_user: false, name: '角色' },
  ];
  assert.deepEqual(
    selectChatMessages(raw, 2, 3).map((m) => m.number),
    [3],
  );
  assert.equal(selectChatMessages(raw, 2, 3)[0]?.text, '<b>热茶</b>');
  assert.throws(() => selectChatMessages(raw, 0, 3));
  assert.throws(() => selectChatMessages([{ mes: '长'.repeat(20001) }], 1, 1));
  assert.throws(() => selectChatMessages([{ mes: 3 }], 1, 1));
});

test('模型引用必须来自选中消息，AI标记和来源由本地生成', () => {
  const cards = decodeChatMaterials(output(), capture);
  assert.equal(cards[0]?.method, 'ai');
  assert.equal(cards[0]?.source?.chat?.messageNumber, 3);
  assert.equal(cards[0]?.quote, messages[1]?.text);
  assert.throws(() =>
    decodeChatMaterials(output().replace('她把另一杯热茶推向你。', '不存在的摘录'), capture),
  );
  assert.throws(() => decodeChatMaterials(output(), { ...capture, messages: [messages[0]!] }));
  assert.throws(() => decodeChatMaterials('not json', capture));
  assert.deepEqual(decodeChatMaterials('{"materials":[]}', capture), []);
});

function setup(response: (prompt: string, signal: AbortSignal) => Promise<string> = async () => output()) {
  let current = true,
    transcript = 'now';
  const host = {
    isCurrent: () => current,
    transcript: () => transcript,
    chatLength: () => 3,
    readChat: () => messages,
    generate: response,
  };
  const repository = new Repository('chat-materials-' + Math.random());
  const app = new ChatMaterialsController(host, repository, snapshot);
  return {
    app,
    repository,
    stale: () => {
      current = false;
    },
    edit: () => {
      transcript = 'changed';
    },
  };
}

test('只发送勾选的消息，草稿不自动保存，确认后持久化', async () => {
  let prompt = '';
  const { app, repository } = setup(async (text) => {
    prompt = text;
    return output();
  });
  const read = app.read(1, 3);
  const draft = await app.generate(read, [3], new AbortController().signal);
  assert.ok(!prompt.includes('要去书店坐坐吗'));
  assert.ok(prompt.includes('另一杯热茶'));
  assert.equal((await repository.loadMaterials('u', 'alice.png')).length, 0);
  await app.save(draft, draft.cards);
  assert.equal((await repository.loadMaterials('u', 'alice.png')).length, 1);
});

test('取消、切换聊天及编辑后的旧结果不保存；空选与超限不请求', async () => {
  let calls = 0;
  const state = setup(async () => {
    calls++;
    state.edit();
    return output();
  });
  const read = state.app.read(1, 3);
  await assert.rejects(state.app.generate(read, [], new AbortController().signal));
  assert.equal(calls, 0);
  await assert.rejects(state.app.generate(read, [3], new AbortController().signal), /变化|修改/);
  const canceled = new AbortController();
  const other = setup(async () => {
    canceled.abort();
    return output();
  });
  await assert.rejects(other.app.generate(other.app.read(1, 3), [3], canceled.signal), /取消/);
  const switched = setup();
  const draft = await switched.app.generate(switched.app.read(1, 3), [3], new AbortController().signal);
  switched.stale();
  await assert.rejects(switched.app.save(draft, draft.cards), /切换/);
});

test('批量保存同一事务，重复ID失败不能留下部分素材', async () => {
  const { repository } = setup();
  const card = decodeChatMaterials(output(), capture)[0]!;
  await repository.saveMaterial('u', 'a', card);
  await assert.rejects(repository.saveMaterials('u', 'a', [{ ...card, id: 'personal:new-one' }, card]));
  assert.equal((await repository.loadMaterials('u', 'a')).length, 1);
});

test('保存等待数据库期间消息变化，事务中止且不留下素材', async () => {
  const state = setup();
  const draft = await state.app.generate(state.app.read(1, 3), [3], new AbortController().signal);
  const saving = state.app.save(draft, draft.cards);
  state.edit();
  await assert.rejects(saving);
  assert.equal((await state.repository.loadMaterials('u', 'alice.png')).length, 0);
});

test('提交超过12000字符不调用模型，保存前关闭使批量事务中止', async () => {
  let calls = 0;
  const state = setup(async () => {
    calls++;
    return output();
  });
  const read = state.app.read(1, 3);
  await assert.rejects(
    state.app.generate(
      { ...read, messages: [{ ...messages[1]!, text: '长'.repeat(12001) }] },
      [3],
      new AbortController().signal,
    ),
    /12000/,
  );
  assert.equal(calls, 0);
  const draft = await state.app.generate(read, [3], new AbortController().signal);
  const closed = new AbortController();
  const saving = state.app.save(draft, draft.cards, closed.signal);
  closed.abort();
  await assert.rejects(saving);
  assert.equal((await state.repository.loadMaterials('u', 'alice.png')).length, 0);
});

test('最后一条写请求成功但事务未提交时取消，仍回滚整批', async () => {
  const state = setup();
  const draft = await state.app.generate(state.app.read(1, 3), [3], new AbortController().signal);
  const closed = new AbortController();
  const add = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function (value: unknown, key?: IDBValidKey) {
    const request = add.call(this, value, key);
    request.addEventListener('success', () => closed.abort(), { once: true });
    return request;
  };
  try {
    await assert.rejects(state.app.save(draft, draft.cards, closed.signal));
    assert.equal((await state.repository.loadMaterials('u', 'alice.png')).length, 0);
  } finally {
    IDBObjectStore.prototype.add = add;
  }
});
