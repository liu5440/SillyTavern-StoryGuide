import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectChatMessages,
  decodeChatMaterials,
  planChatBatches,
  type ChatCapture,
} from '../src/domain/chat-materials.ts';
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

test('100条原文不依赖模型分批即可归档，标题标签与完整正文保留', async () => {
  const state = setup(async () => {
    throw new Error('不应调用模型');
  });
  const rows = Array.from({ length: 100 }, (_, index) => ({
    number: index + 1,
    role: 'character' as const,
    speaker: '艾琳',
    text: `片段${index}。<script>只是文本</script>`,
  }));
  const raw = { ...capture, messages: rows };
  const archive = state.app.archive(
    raw,
    rows.map((row) => row.number),
    undefined,
    [],
    { title: '钟楼调查', tags: ['艾琳', '钟楼'] },
  );
  await state.app.saveArchive(archive);
  const saved = (await state.repository.loadChatArchives('u', 'alice.png'))[0];
  assert.equal(saved?.status, 'raw');
  assert.equal(saved?.messages.length, 100);
  assert.deepEqual(saved?.messages, rows);
  assert.deepEqual(saved?.tags, ['艾琳', '钟楼']);
  assert.equal(saved?.title, '钟楼调查');
  await assert.rejects(
    state.app.generate(
      raw,
      rows.map((row) => row.number),
      new AbortController().signal,
    ),
    /1–50/,
  );
});

test('整理结果只能原子升级同一raw快照，错误消息不能覆盖已保存原文', async () => {
  const state = setup();
  const raw = state.app.archive(capture, [3]);
  await state.app.saveArchive(raw);
  const wrong = {
    ...raw,
    status: 'complete' as const,
    messages: [{ ...raw.messages[0]!, text: '不同原文' }],
  };
  await assert.rejects(state.app.saveArchive(wrong, undefined, true));
  assert.equal((await state.repository.loadChatArchives('u', 'alice.png'))[0]?.status, 'raw');
  const complete = { ...raw, status: 'complete' as const };
  await state.app.saveArchive(complete, undefined, true);
  const rows = await state.repository.loadChatArchives('u', 'alice.png');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.status, 'complete');
  assert.deepEqual(rows[0]?.messages, raw.messages);
});

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

test('提交超过50条不调用模型，保存前关闭使批量事务中止', async () => {
  let calls = 0;
  const state = setup(async () => {
    calls++;
    return output();
  });
  const read = state.app.read(1, 3);
  await assert.rejects(
    state.app.generate(
      { ...read, messages: Array.from({ length: 51 }, (_, i) => ({ ...messages[1]!, number: i + 1 })) },
      Array.from({ length: 51 }, (_, i) => i + 1),
      new AbortController().signal,
    ),
    /50/,
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

test('50条长消息分批不截断，单条长消息保留原文偏移', () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({
    number: i + 1,
    role: 'character' as const,
    speaker: '成年角色',
    text: '内容'.repeat(3000),
  }));
  const batches = planChatBatches(rows);
  assert.ok(batches.length > 1);
  for (const batch of batches) assert.ok(batch.reduce((n, m) => n + m.text.length, 0) <= 12000);
  for (const row of rows)
    assert.equal(
      batches
        .flat()
        .filter((m) => m.number === row.number)
        .map((m) => m.text)
        .join(''),
      row.text,
    );
  const original = { ...rows[0]!, text: '前'.repeat(12000) + '后'.repeat(2000) };
  const split = planChatBatches([original]);
  const response = output()
    .replace('"messageNumber":3', '"messageNumber":1')
    .replace('她把另一杯热茶推向你。', '后后');
  const card = decodeChatMaterials(response, { ...capture, messages: split[1]! }, [original])[0]!;
  assert.equal(card.source?.text, original.text);
  assert.equal(card.source?.start, 12000);
});

test('超过12000字符自动多次调用，失败保留已完成草稿并可导出完整原文', async () => {
  let calls = 0;
  const state = setup(async (prompt) => {
    calls++;
    if (calls === 2) throw new Error('第二批网络中断');
    const data = JSON.parse(prompt.slice(prompt.lastIndexOf('\n[') + 1)) as {
      number: number;
      text: string;
    }[];
    return JSON.stringify({
      materials: [
        {
          title: '日常片段',
          category: 'scene',
          tags: [],
          description: '成年朋友一起散步。',
          opening: '要一起走走吗？',
          messageNumber: data[0]!.number,
          quote: data[0]!.text.slice(0, 10),
        },
      ],
    });
  });
  const rows = Array.from({ length: 50 }, (_, i) => ({
    number: i + 1,
    role: 'character' as const,
    speaker: '成年角色',
    text: '普通日常'.repeat(400),
  }));
  const read = { ...capture, messages: rows };
  const draft = await state.app.generate(
    read,
    rows.map((m) => m.number),
    new AbortController().signal,
  );
  assert.equal(calls, 2);
  assert.equal(draft.completedBatches, 1);
  assert.ok(draft.error);
  assert.equal(draft.cards.length, 1);
  const archive = state.app.archive(
    read,
    rows.map((m) => m.number),
    draft,
    draft.cards,
  );
  assert.equal(archive.messages.length, 50);
  assert.equal(archive.status, 'partial');
  assert.equal(archive.messages.map((m) => m.text).join(''), rows.map((m) => m.text).join(''));
  await state.app.saveArchive(archive);
  assert.equal((await state.repository.loadChatArchives('u', 'alice.png')).length, 1);
  assert.equal((await state.repository.loadChatArchives('u', 'other.png')).length, 0);
  await state.repository.removeChatArchive('u', 'alice.png', archive.id);
  assert.equal((await state.repository.loadChatArchives('u', 'alice.png')).length, 0);
});
