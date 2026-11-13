import { parseStory, runSchema, type Story, type RunState } from '../domain/story';

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
        reject(new Error('本地存储失败；请导出备份并检查可用空间'));
      };
    });
  }
  async saveStory(user: string, story: Story): Promise<void> {
    const valid = parseStory(story);
    await this.transact('readwrite', (store) =>
      store.add(valid, ['story', user, valid.characterKey, valid.id, valid.revision]),
    );
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
