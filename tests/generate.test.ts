import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeDraft, splitSources, generateStory, regenerateNode } from '../src/application/generate.ts';
import { fixture, source } from './fixtures.ts';
import type { Host, ContextSnapshot } from '../src/host/tavern.ts';
import { parseStory } from '../src/domain/story.ts';
const snapshot: ContextSnapshot = {
  user: 'u',
  characterKey: 'alice.png',
  characterName: '艾琳',
  chatKey: 'c',
  sources: [source],
  bookNames: [],
  api: 'test',
  transcript: 't',
};
const draft = () => {
  const f = fixture();
  return { title: f.title, summary: f.summary, nodes: f.nodes, edges: f.edges };
};
test('分批不截断长条目，原始引用 ID 保持不变', () => {
  const chunks = splitSources([{ ...source, text: '字'.repeat(25001) }]);
  assert.equal(chunks.length, 3);
  assert.equal(
    chunks
      .flat()
      .map((s) => s.text)
      .join('').length,
    25001,
  );
  assert.ok(chunks.flat().every((s) => s.id === source.id));
});
test('解析无依据事实失败，创作不能伪装明确原设定', () => {
  const d = draft();
  d.nodes[0]!.provenance = 'explicit';
  assert.throws(() => decodeDraft(JSON.stringify(d), snapshot, 'create'), /来源/);
  assert.throws(() => decodeDraft('hello', snapshot, 'analyze'));
});
test('取消后旧模型结果不形成故事', async () => {
  const controller = new AbortController();
  const host = {
    generate: async () => {
      controller.abort();
      return JSON.stringify(draft());
    },
    isCurrent: () => true,
  } as unknown as Host;
  await assert.rejects(
    generateStory(host, { snapshot, mode: 'create', brief: '探险' }, controller.signal, () => {}),
    /取消/,
  );
});
test('切换角色后丢弃旧结果，不自动修复过期任务', async () => {
  let calls = 0;
  const host = {
    generate: async () => {
      calls++;
      return JSON.stringify(draft());
    },
    isCurrent: () => false,
  } as unknown as Host;
  await assert.rejects(
    generateStory(host, { snapshot, mode: 'create', brief: '' }, new AbortController().signal, () => {}),
    /切换/,
  );
  assert.equal(calls, 1);
});
test('锁定节点不发起局部重生成请求', async () => {
  const story = parseStory(fixture());
  story.nodes[0]!.locked = true;
  let calls = 0;
  const host = {
    generate: async () => {
      calls++;
      return '';
    },
    isCurrent: () => true,
  } as unknown as Host;
  await assert.rejects(regenerateNode(host, snapshot, story, 'a', new AbortController().signal), /锁定/);
  assert.equal(calls, 0);
});
