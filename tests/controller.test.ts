import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GuideController, decodeImport } from '../src/application/controller.ts';
import { parseStory, visibleStory } from '../src/domain/story.ts';
import { fixture } from './fixtures.ts';
import type { TavernHost, ContextSnapshot } from '../src/host/tavern.ts';
import type { Repository } from '../src/storage/repository.ts';
import 'fake-indexeddb/auto';
import { Repository as RealRepository } from '../src/storage/repository.ts';
const snapshot: ContextSnapshot = {
  user: 'u',
  characterKey: 'alice.png',
  characterName: '艾琳',
  chatKey: 'chat',
  sources: [],
  bookNames: [],
  api: 'test',
  transcript: 't',
};
test('保存查询期间切换角色，禁止继续提交', async () => {
  let current = true;
  let writes = 0;
  const host = { isCurrent: () => current } as unknown as TavernHost;
  const repository = {
    loadStories: async () => {
      current = false;
      return [];
    },
    saveStory: async () => {
      writes++;
    },
  } as unknown as Repository;
  await assert.rejects(new GuideController(host, repository).save(snapshot, parseStory(fixture())), /切换/);
  assert.equal(writes, 0);
});
test('拒绝把其他角色故事保存到当前角色', async () => {
  const host = { isCurrent: () => true } as unknown as TavernHost;
  const repository = { loadStories: async () => [], saveStory: async () => {} } as unknown as Repository;
  await assert.rejects(
    new GuideController(host, repository).save(snapshot, {
      ...parseStory(fixture()),
      characterKey: 'bob.png',
    }),
    /角色/,
  );
});
test('备份包含故事和本局记录，可识别且不接收未知版本', () => {
  const story = parseStory(fixture());
  const run = {
    schemaVersion: 1,
    storyId: story.id,
    revision: story.revision,
    chatKey: 'chat',
    current: 'a',
    states: {},
    variables: {},
    choices: [],
    transcript: '',
    needsReview: false,
  };
  const raw = JSON.stringify({ format: 'story-guide-backup', schemaVersion: 1, story, run });
  assert.equal(decodeImport(raw).run?.current, 'a');
  assert.throws(() => decodeImport(raw.replace('"schemaVersion":1', '"schemaVersion":2')));
});
test('边的条件和标签默认保守隐藏，不向建议或图泄漏秘密', () => {
  const story = parseStory(fixture());
  story.nodes[1]!.spoiler = false;
  story.edges[0]!.condition = '发现艾琳是真凶';
  story.edges[0]!.label = '质问真凶';
  const publicStory = visibleStory(story, undefined, false);
  assert.ok(!JSON.stringify(publicStory).includes('真凶'));
  assert.ok(JSON.stringify(visibleStory(story, undefined, true)).includes('真凶'));
});
test('采用导入草稿新版本时保留已恢复进度', async () => {
  const host = { isCurrent: () => true, transcript: () => 't' } as unknown as TavernHost;
  const repo = new RealRepository('adopt-progress');
  const app = new GuideController(host, repo);
  const story = parseStory(fixture());
  await repo.saveStory('u', story);
  const run = await app.run(snapshot, story);
  run.states.a = 'done';
  await app.saveRun(snapshot, run);
  const adopted = await app.adopt(snapshot, story);
  const restored = await app.run(snapshot, adopted);
  assert.equal(restored.states.a, 'done');
});
