import { parseLibrary, type StoryLibrary } from '../domain/library';
import { parseStory, type Story } from '../domain/story';
import { migrateStory } from '../application/library';
/** 与旧版共用records但使用独立键；首次迁移和每次保存均保留可恢复的上一版。 */
export class LibraryRepository {
  constructor(private name = 'sillytavern-story-guide-v1') {}
  private db(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.name, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('records')) req.result.createObjectStore('records');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error('无法打开剧情资料库存储'));
      req.onblocked = () => reject(new Error('资料库被其他页面阻止，请关闭其他酒馆页面'));
    });
  }
  private async read(key: IDBValidKey): Promise<unknown> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records', 'readonly');
      const req = tx.objectStore('records').get(key);
      tx.oncomplete = () => {
        db.close();
        resolve(req.result);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        reject(new Error('资料库读取失败，原数据未修改'));
      };
    });
  }
  async load(user: string, character: string): Promise<StoryLibrary | undefined> {
    const value = await this.read(['library-v2', user, character]);
    if (value === undefined) return undefined;
    const valid = parseLibrary(value);
    return { ...valid, baseRevision: valid.revision };
  }
  async save(
    user: string,
    value: StoryLibrary,
    checkCurrent?: () => void,
    signal?: AbortSignal,
  ): Promise<StoryLibrary> {
    const valid = parseLibrary(value);
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite');
      const store = tx.objectStore('records');
      let reason = '资料库保存失败；原记录保持不变，请导出备份并检查空间';
      const abort = () => {
        try {
          tx.abort();
        } catch (error) {
          if (!(error instanceof DOMException && error.name === 'InvalidStateError')) reason = '取消保存失败';
        }
      };
      const cleanup = () => {
        signal?.removeEventListener('abort', abort);
        db.close();
      };
      tx.oncomplete = () => {
        cleanup();
        resolve({ ...valid, baseRevision: valid.revision });
      };
      tx.onerror = tx.onabort = () => {
        cleanup();
        reject(new Error(signal?.aborted ? '已取消保存，原记录保持不变' : reason));
      };
      const req = store.get(['library-v2', user, valid.characterKey]);
      req.onsuccess = () => {
        try {
          checkCurrent?.();
          if (signal?.aborted) throw new Error('已取消');
          const old = req.result === undefined ? undefined : parseLibrary(req.result);
          if (old && valid.revision <= old.revision)
            throw new Error('资料库已被其他操作更新，请重新载入后编辑');
          if ((old?.revision ?? 0) !== valid.baseRevision)
            throw new Error('资料库已被其他操作更新，请重新载入后编辑');
          if (old && old.id !== valid.id) throw new Error('资料库身份冲突，请将导入内容另存或先备份恢复');
          if (old) store.put(old, ['library-v2-backup', user, valid.characterKey]);
          const write = store.put({ ...valid, baseRevision: valid.revision }, [
            'library-v2',
            user,
            valid.characterKey,
          ]);
          write.onsuccess = () => {
            try {
              checkCurrent?.();
            } catch {
              reason = '角色上下文已变化，保存已回滚';
              abort();
            }
          };
        } catch (error) {
          reason = error instanceof Error ? error.message : reason;
          abort();
        }
      };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
  async migrate(
    user: string,
    value: Story,
    checkCurrent?: () => void,
    signal?: AbortSignal,
  ): Promise<StoryLibrary> {
    const story = parseStory(value);
    const current = await this.load(user, story.characterKey);
    if (current) return current;
    const library = migrateStory(story);
    return this.save(user, library, checkCurrent, signal);
  }
  async restore(user: string, character: string, checkCurrent?: () => void): Promise<StoryLibrary> {
    const backup = await this.read(['library-v2-backup', user, character]);
    if (backup === undefined) throw new Error('没有上一版备份');
    const restored = parseLibrary(backup);
    const current = await this.load(user, character);
    const next = {
      ...restored,
      baseRevision: current?.revision ?? 0,
      revision: (current?.revision ?? restored.revision) + 1,
    };
    return this.save(user, next, checkCurrent);
  }
}
