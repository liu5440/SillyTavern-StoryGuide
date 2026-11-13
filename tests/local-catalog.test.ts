import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalCatalog } from '../src/application/local-catalog';
import { source } from './fixtures';
import type { ContextSnapshot } from '../src/host/tavern';
const snapshot: ContextSnapshot = {
  user: 'u',
  characterKey: 'c',
  characterName: '测试角色',
  chatKey: 'chat',
  sources: [source],
  bookNames: [],
  api: 'test',
  transcript: '',
};
test('本地目录保留原文及准确引用，不编造路线或地点', () => {
  const story = buildLocalCatalog(snapshot);
  assert.equal(story.nodes.length, 1);
  assert.equal(story.nodes[0]?.summary, source.text);
  assert.equal(story.nodes[0]?.refs[0]?.sourceId, source.id);
  assert.equal(story.nodes[0]?.location, '');
  assert.deepEqual(story.edges, []);
  assert.equal(story.status, 'draft');
});
test('超长资料保留完整来源，摘录明确标注，空选和超限报错', () => {
  const story = buildLocalCatalog({ ...snapshot, sources: [{ ...source, text: '字'.repeat(25000) }] });
  assert.equal(story.sources[0]?.text.length, 25000);
  assert.match(story.nodes[0]?.summary ?? '', /完整内容见来源/);
  assert.throws(() => buildLocalCatalog({ ...snapshot, sources: [] }), /至少/);
  assert.throws(
    () => buildLocalCatalog({ ...snapshot, sources: Array.from({ length: 501 }, () => source) }),
    /500/,
  );
});
