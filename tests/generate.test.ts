import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeDraft, splitSources, generateStory, regenerateNode } from '../src/application/generate.ts';
import { fixture, source } from './fixtures.ts';
import type { Host, ContextSnapshot } from '../src/host/tavern.ts';
import { parseStory, type Story } from '../src/domain/story.ts';
import { clearDiagnostics, diagnosticReport } from '../src/diagnostics';
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
const draft = (): Pick<Story, 'title' | 'summary' | 'nodes' | 'edges'> => {
  const f = fixture();
  const story = parseStory(f);
  return { title: story.title, summary: story.summary, nodes: story.nodes, edges: story.edges };
};

test('分析中的错误摘录不触发整批修复，资料保留且明确提示待核对', async () => {
  const parsed = draft();
  parsed.nodes = [
    {
      ...parsed.nodes[0]!,
      type: 'event',
      provenance: 'explicit',
      refs: [{ sourceId: source.id, quote: '模型改写的错误摘录' }],
    },
  ];
  parsed.edges = [];
  let calls = 0;
  const host = {
    generate: async () => {
      calls++;
      return JSON.stringify(parsed);
    },
    isCurrent: () => true,
  } as unknown as Host;
  const story = await generateStory(
    host,
    { snapshot, mode: 'analyze', brief: '' },
    new AbortController().signal,
    () => {},
  );
  assert.equal(calls, 1);
  assert.match(story.summary, /待核对/);
  assert.equal(story.nodes.find((node) => node.id === parsed.nodes[0]!.id)?.provenance, 'inferred');
  assert.ok(story.nodes.some((node) => node.summary === source.text));
});
test('解析格式修复保留本批来源和解析约束，允许没有固定路线', async () => {
  const parsed = draft();
  parsed.nodes = [
    {
      ...parsed.nodes[0]!,
      type: 'event',
      provenance: 'explicit',
      refs: [{ sourceId: source.id, quote: source.text }],
    },
  ];
  parsed.edges = [];
  let calls = 0;
  const host = {
    generate: async (prompt: string) => {
      if (++calls === 1) return '不是JSON';
      assert.ok(prompt.includes(JSON.stringify([source])));
      assert.ok(prompt.includes('不编造新事件或结局'));
      return JSON.stringify(parsed);
    },
    isCurrent: () => true,
  } as unknown as Host;
  const story = await generateStory(
    host,
    { snapshot, mode: 'analyze', brief: '' },
    new AbortController().signal,
    () => {},
  );
  assert.equal(story.nodes[0]?.provenance, 'explicit');
  assert.equal(story.edges.length, 0);
  assert.equal(calls, 2);
});

test('最终校验失败显示本次原因，日志保留安全分类而非模型ID', async () => {
  clearDiagnostics();
  const invalid = draft();
  invalid.nodes[0]!.id = 'private-model-id';
  invalid.nodes[0]!.provenance = 'explicit';
  invalid.edges = [];
  let calls = 0;
  const host = {
    generate: async () => (++calls === 1 ? 'invalid' : JSON.stringify(invalid)),
    isCurrent: () => true,
  } as unknown as Host;
  await assert.rejects(
    generateStory(host, { snapshot, mode: 'analyze', brief: '' }, new AbortController().signal, () => {}),
    /修复后原因：.*缺少原文来源/,
  );
  const log = diagnosticReport().entries.find(
    (entry) => entry.event === 'validation' && entry.stage === '修复',
  );
  assert.ok(log?.fields?.includes('refs: missing_source'));
  assert.ok(!JSON.stringify(diagnosticReport()).includes('private-model-id'));
});
test('格式失败显示原因，只允许一次修复且失败后结束', async () => {
  let calls = 0;
  const messages: string[] = [];
  const host = {
    generate: async () => {
      calls++;
      return 'invalid';
    },
    isCurrent: () => true,
  } as unknown as Host;
  await assert.rejects(
    generateStory(host, { snapshot, mode: 'create', brief: '' }, new AbortController().signal, (text) =>
      messages.push(text),
    ),
    /修复后仍未通过校验/,
  );
  assert.equal(calls, 2);
  assert.ok(messages.some((text) => text.includes('不是有效 JSON') && text.includes('已等待')));
});
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
