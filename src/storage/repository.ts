import { parseStory, runSchema, type Story, type RunState } from '../domain/story';
import { materialSchema, materialIdSchema, type Material } from '../domain/materials';
import { z } from 'zod';
import { chatArchiveSchema, type ChatArchive } from '../domain/chat-archive';

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
    signal?: AbortSignal,
  ): Promise<T> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records', mode);
      const request = operation(tx.objectStore('records'));
      const cancel = () => {
        try {
          tx.abort();
        } catch (error) {
          // 已越过数据库提交点时不能回滚；最终以complete/abort的真实结果为准。
          if (!(error instanceof DOMException && error.name === 'InvalidStateError')) reject(error);
        }
      };
      const cleanup = () => {
        signal?.removeEventListener('abort', cancel);
        db.close();
      };
      tx.oncomplete = () => {
        cleanup();
        resolve(request.result);
      };
      tx.onabort = tx.onerror = () => {
        cleanup();
        reject(new Error(signal?.aborted ? '已取消保存，事务已回滚' : failure));
      };
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
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
    return this.saveMaterials(user, character, [card]);
  }
  async saveMaterials(
    user: string,
    character: string,
    cards: Material[],
    checkCurrent?: () => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const valid = z.array(materialSchema).min(1).max(200).parse(cards);
    if (valid.some((card) => card.origin !== 'dialogue')) throw new Error('内置原创不能覆盖为个人条目');
    if (new Set(valid.map((card) => card.id)).size !== valid.length) throw new Error('本批次素材ID重复');
    const range = IDBKeyRange.bound(['material', user, character], ['material', user, character, []]);
    await this.transact(
      'readwrite',
      (store) => {
        const count = store.count(range);
        count.onsuccess = () => {
          try {
            checkCurrent?.();
          } catch {
            store.transaction.abort();
            return;
          }
          if (count.result + valid.length > 200) store.transaction.abort();
          else
            for (const card of valid) {
              const write = store.add(card, ['material', user, character, card.id]);
              write.onsuccess = () => {
                try {
                  checkCurrent?.();
                } catch {
                  store.transaction.abort();
                }
              };
            }
        };
        return count;
      },
      '个人素材保存失败：每个角色最多200条且同ID不能覆盖；请导出并清理素材或检查可用空间',
      signal,
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
  /** 拆分、合并及备份另存只追加新条目；源素材CAS、配额和收藏与新增在同一事务完成。 */
  async saveMaterialCopies(
    user: string,
    character: string,
    cards: Material[],
    expected: Material[],
    favorites: string[],
    guard: () => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const valid = z.array(materialSchema).min(1).max(200).parse(cards);
    const originals = z.array(materialSchema).max(200).parse(expected);
    const ids = new Set(valid.map((card) => card.id));
    if (ids.size !== valid.length || valid.some((card) => card.origin !== 'dialogue'))
      throw new Error('新增素材ID重复或包含内置内容，未保存');
    if (favorites.some((id) => !ids.has(id))) throw new Error('收藏只能引用本次新增素材');
    const range = IDBKeyRange.bound(['material', user, character], ['material', user, character, []]);
    await this.transact(
      'readwrite',
      (store) => {
        const read = store.getAll(range);
        read.onsuccess = () => {
          try {
            guard();
            const current = (read.result as unknown[]).map((row) => materialSchema.parse(row));
            const previous = new Map(current.map((card) => [card.id, card]));
            if (current.length + valid.length > 200) throw new Error('个人素材超过200条');
            if (valid.some((card) => previous.has(card.id))) throw new Error('新增素材ID已存在');
            if (originals.some((card) => JSON.stringify(previous.get(card.id)) !== JSON.stringify(card)))
              throw new Error('源素材已变化，请重新预览');
            const check = () => {
              try {
                guard();
              } catch {
                store.transaction.abort();
              }
            };
            for (const card of valid)
              store.add(card, ['material', user, character, card.id]).onsuccess = check;
            for (const id of new Set(favorites))
              store.add({ schemaVersion: 1, id }, ['material-favorite', user, character, id]).onsuccess =
                check;
          } catch {
            store.transaction.abort();
          }
        };
        return read;
      },
      '素材另存失败：源素材已变化、条目冲突、超过200条或存储不可用；原记录保持不变',
      signal,
    );
  }
  /** 人工编辑不能替换原文证据；旧内容与更新在同一事务保存，失败一起回滚。 */
  async updateMaterial(
    user: string,
    character: string,
    card: Material,
    checkCurrent?: () => void,
    signal?: AbortSignal,
    expected?: Material,
  ): Promise<void> {
    const valid = materialSchema.parse(card);
    if (valid.origin !== 'dialogue') throw new Error('不能覆盖内置素材');
    const key = ['material', user, character, valid.id];
    await this.transact(
      'readwrite',
      (store) => {
        const read = store.get(key);
        read.onsuccess = () => {
          try {
            checkCurrent?.();
            const previous = materialSchema.parse(read.result);
            if (expected && JSON.stringify(previous) !== JSON.stringify(materialSchema.parse(expected)))
              throw new Error('素材已被其他窗口修改，请重新载入后编辑');
            if (
              previous.origin !== valid.origin ||
              previous.method !== valid.method ||
              previous.quote !== valid.quote ||
              JSON.stringify(previous.source) !== JSON.stringify(valid.source) ||
              JSON.stringify(previous.evidence) !== JSON.stringify(valid.evidence) ||
              JSON.stringify(previous.derivedFromIds) !== JSON.stringify(valid.derivedFromIds)
            )
              throw new Error('原文证据不能被编辑替换');
            store.add(previous, [
              'material-history',
              user,
              character,
              valid.id,
              `${Date.now()}-${crypto.randomUUID()}`,
            ]);
            const write = store.put(valid, key);
            write.onsuccess = () => {
              try {
                checkCurrent?.();
              } catch {
                store.transaction.abort();
              }
            };
          } catch {
            store.transaction.abort();
          }
        };
        return read;
      },
      '素材编辑保存失败：原文证据变化、条目不存在或存储不可用，原记录保持不变',
      signal,
    );
  }
  async loadMaterialHistory(user: string, character: string, id: string): Promise<Material[]> {
    materialIdSchema.parse(id);
    const range = IDBKeyRange.bound(
      ['material-history', user, character, id],
      ['material-history', user, character, id, []],
    );
    const rows: unknown[] = await this.transact('readonly', (store) => store.getAll(range));
    return rows.map((row) => materialSchema.parse(row)).reverse();
  }
  async saveChatArchive(user: string, archive: ChatArchive, check: () => void, signal?: AbortSignal) {
    const valid = chatArchiveSchema.parse(archive);
    const range = IDBKeyRange.bound(
      ['chat-archive', user, valid.characterKey],
      ['chat-archive', user, valid.characterKey, []],
    );
    await this.transact(
      'readwrite',
      (store) => {
        const count = store.count(range);
        count.onsuccess = () => {
          try {
            check();
          } catch {
            store.transaction.abort();
            return;
          }
          if (count.result >= 50) {
            store.transaction.abort();
            return;
          }
          const write = store.add(valid, ['chat-archive', user, valid.characterKey, valid.id]);
          write.onsuccess = () => {
            try {
              check();
            } catch {
              store.transaction.abort();
            }
          };
        };
        return count;
      },
      '归档保存失败：每个角色最多50份，请导出并删除旧归档或检查可用空间',
      signal,
    );
  }
  async loadChatArchives(user: string, character: string): Promise<ChatArchive[]> {
    const range = IDBKeyRange.bound(['chat-archive', user, character], ['chat-archive', user, character, []]);
    const rows: unknown[] = await this.transact('readonly', (store) => store.getAll(range));
    return rows
      .map((row) => chatArchiveSchema.parse(row))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  /** 仅升级同一原文快照的raw归档，原子替换；不能覆盖已有整理版本或其他消息。 */
  async finalizeChatArchive(user: string, archive: ChatArchive, check: () => void, signal?: AbortSignal) {
    const valid = chatArchiveSchema.parse(archive);
    const key = ['chat-archive', user, valid.characterKey, valid.id];
    await this.transact(
      'readwrite',
      (store) => {
        const read = store.get(key);
        read.onsuccess = () => {
          try {
            check();
            const old = chatArchiveSchema.parse(read.result);
            if (
              old.status !== 'raw' ||
              valid.status === 'raw' ||
              old.chatKey !== valid.chatKey ||
              old.transcript !== valid.transcript ||
              JSON.stringify(old.messages) !== JSON.stringify(valid.messages)
            )
              throw new Error('原文快照不一致');
            const write = store.put({ ...valid, createdAt: old.createdAt }, key);
            write.onsuccess = () => {
              try {
                check();
              } catch {
                store.transaction.abort();
              }
            };
          } catch {
            store.transaction.abort();
          }
        };
        return read;
      },
      '归档升级失败：原文已变化或已整理，原归档保持不变',
      signal,
    );
  }
  async removeChatArchive(user: string, character: string, id: string) {
    await this.transact('readwrite', (store) => store.delete(['chat-archive', user, character, id]));
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
