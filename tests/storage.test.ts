import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Repository } from '../src/storage/repository.ts';
import { parseStory } from '../src/domain/story.ts';
import { fixture } from './fixtures.ts';
test('存档隔离账号、角色、聊天，版本不互相覆盖', async () => {
  const repo = new Repository('test-storage');
  const a = parseStory(fixture());
  await repo.saveStory('u1', a);
  await repo.saveStory('u1', { ...a, revision: 2, title: '第二版' });
  assert.equal((await repo.loadStories('u1', a.characterKey)).length, 2);
  assert.equal((await repo.loadStories('u2', a.characterKey)).length, 0);
  assert.equal((await repo.loadStories('u1', 'bob.png')).length, 0);
  const run = {
    schemaVersion: 1 as const,
    storyId: a.id,
    revision: 1,
    chatKey: 'chat1',
    current: 'a',
    states: {},
    choices: [],
    variables: {},
    transcript: '',
    needsReview: false,
  };
  await repo.saveRun('u1', a.characterKey, run);
  assert.equal((await repo.loadRun('u1', a.characterKey, 'chat1', a.id, 1))?.current, 'a');
  assert.equal(await repo.loadRun('u1', a.characterKey, 'chat2', a.id, 1), undefined);
});
test('无效写入不会破坏旧故事', async () => {
  const repo = new Repository('test-failure');
  const a = parseStory(fixture());
  await repo.saveStory('u1', a);
  await assert.rejects(repo.saveStory('u1', { ...a, revision: 0 }));
  assert.equal((await repo.loadStories('u1', a.characterKey))[0]?.title, a.title);
});
