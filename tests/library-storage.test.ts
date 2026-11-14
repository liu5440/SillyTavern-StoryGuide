import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LibraryRepository } from '../src/storage/library-repository.ts';
import { Repository } from '../src/storage/repository.ts';
import { createEvent, createLibrary } from '../src/application/library.ts';
import { parseStory } from '../src/domain/story.ts';
import { fixture } from './fixtures.ts';
test('v2隔离账号角色、拒绝旧版本覆盖、可恢复上一版', async () => {
  const repo = new LibraryRepository('library-isolation');
  const lib = await repo.save('u', createLibrary('alice'));
  assert.equal(await repo.load('other', 'alice'), undefined);
  assert.equal(await repo.load('u', 'bob'), undefined);
  await repo.save('u', createEvent(lib, { title: '新增' }));
  const stale = createEvent(createEvent(lib, { title: '过期甲' }), { title: '过期乙' });
  await assert.rejects(repo.save('u', stale), /已被其他操作更新/);
  await assert.rejects(repo.save('u', lib), /已被其他操作更新/);
  assert.equal((await repo.restore('u', 'alice')).events.length, 0);
  const fresh = await repo.load('u', 'alice');
  assert.ok(fresh);
  const saved = await repo.save('u', createEvent(fresh, { title: '连续保存甲' }));
  await repo.save('u', createEvent(saved, { title: '连续保存乙' }));
});
test('迁移保留旧存档；上下文失效写入整体回滚', async () => {
  const name = 'library-migration';
  const oldRepo = new Repository(name);
  const repo = new LibraryRepository(name);
  const story = parseStory(fixture());
  await oldRepo.saveStory('u', story);
  const lib = await repo.migrate('u', story);
  assert.deepEqual((await oldRepo.loadStories('u', story.characterKey))[0], story);
  await assert.rejects(
    repo.save('u', createEvent(lib, { title: '不应保存' }), () => {
      throw new Error('切换角色');
    }),
  );
  assert.equal((await repo.load('u', story.characterKey))?.revision, lib.revision);
});
