import { parseStory, runSchema, type Story, type RunState } from '../domain/story';
import { materialSchema, materialIdSchema, type Material } from '../domain/materials';
import { z } from 'zod';

/** 每次写入等事务完成再返回，避免配额失败时显示保存成功。 */
export class Repository {
  constructor(private name = 'sillytavern-story-guide-v1') {}
  private async db(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('records');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('无法打开本地存储，请检查浏览器隐私设置'));
      request.onblocked = () => reject(new Error('数据库升级被其他标签页阻止，请关闭其他酒馆页面'));
    });
  }
  private async transact<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
    failure = '本地存储失败；请导出备份并检查可用空间',
  ): Promise<T> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records', mode);
      const request = operation(tx.objectStore('records'));
      tx.oncomplete = () => {
        db.close();
        resolve(request.result);
      };
      tx.onabort = tx.onerror = () => {
        db.close();
        reject(new Error(failure));
      };
    });
  }
  async saveStory(user: string, story: Story): Promise<void> {
    return this.saveVersion(user, story);
  }
  async loadMaterials(user: string, character: string): Promise<Material[]> {
    const range = IDBKeyRange.bound(['material', user, character], ['material', user, character, []]);
    const rows: unknown[] = await this.transact('readonly', (store) => store.getAll(range));
    return rows.map((row) => materialSchema.parse(row));
  }
  async saveMaterial(user: string, character: string, card: Material): Promise<void> {
    const valid = materialSchema.parse(card);
    if (valid.origin !== 'dialogue') throw new Error('内置原创不能覆盖为个人条目');
    const range = IDBKeyRange.bound(['material', user, character], ['material', user, character, []]);
    await this.transact(
      'readwrite',
      (store) => {
        const count = store.count(range);
        count.onsuccess = () => {
          if (count.result >= 200) store.transaction.abort();
          else store.add(valid, ['material', user, character, valid.id]);
        };
        return count;
      },
      '个人素材保存失败：每个角色最多200条且同ID不能覆盖；请导出并清理素材或检查可用空间',
    );
  }
  async loadMaterialFavorites(user: string, character: string): Promise<string[]> {
    const range = IDBKeyRange.bound(
      ['material-favorite', user, character],
      ['material-favorite', user, character, []],
    );
    const rows: unknown[] = await this.transact('readonly', (store) => store.getAll(range));
    const schema = z.object({ schemaVersion: z.literal(1), id: materialIdSchema }).strict();
    return rows.map((row) => schema.parse(row).id);
  }
  async setMaterialFavorite(user: string, character: string, id: string, favorite: boolean): Promise<void> {
    materialIdSchema.parse(id);
    const key = ['material-favorite', user, character, id];
    if (!favorite) {
      await this.transact('readwrite', (store) => store.delete(key));
      return;
    }
    const range = IDBKeyRange.bound(
      ['material-favorite', user, character],
      ['material-favorite', user, character, []],
    );
    await this.transact('readwrite', (store) => {
      const count = store.count(range);
      count.onsuccess = () => {
        if (count.result >= 500) store.transaction.abort();
        else store.put({ schemaVersion: 1, id }, key);
      };
      return count;
    });
  }
  async removeMaterial(user: string, character: string, id: string): Promise<void> {
    if (!materialIdSchema.parse(id).startsWith('personal:')) throw new Error('不能删除内置素材');
    await this.transact('readwrite', (store) => {
      store.delete(['material-favorite', user, character, id]);
      return store.delete(['material', user, character, id]);
    });
  }
  /** 故事与继承的本局进度在同一事务提交，失败时一起回滚。 */
  async saveVersion(user: string, story: Story, run?: RunState): Promise<void> {
    const valid = parseStory(story);
    const progress = run ? runSchema.parse(run) : undefined;
    if (
      progress &&
      (!progress.chatKey || progress.storyId !== valid.id || progress.revision !== valid.revision)
    )
      throw new Error('进度与故事版本不一致');
    await this.transact('readwrite', (store) => {
      if (progress)
        store.put(progress, ['run', user, valid.characterKey, progress.chatKey, valid.id, valid.revision]);
      return store.add(valid, ['story', user, valid.characterKey, valid.id, valid.revision]);
    });
  }
  async loadStories(user: string, character: string): Promise<Story[]> {
    const range = IDBKeyRange.bound(['story', user, character], ['story', user, character, []]);
    const rows: unknown[] = await this.transact('readonly', (store) => store.getAll(range));
    return rows
      .map(parseStory)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.revision - a.revision);
  }
  async saveRun(user: string, character: string, run: RunState): Promise<void> {
    const valid = runSchema.parse(run);
    if (!valid.chatKey) throw new Error('没有有效聊天标识，不能保存本局进度');
    await this.transact('readwrite', (store) =>
      store.put(valid, ['run', user, character, valid.chatKey, valid.storyId, valid.revision]),
    );
  }
  async loadRun(
    user: string,
    character: string,
    chat: string,
    story: string,
    revision: number,
  ): Promise<RunState | undefined> {
    const data: unknown = await this.transact('readonly', (store) =>
      store.get(['run', user, character, chat, story, revision]),
    );
    return data === undefined ? undefined : runSchema.parse(data);
  }
}
