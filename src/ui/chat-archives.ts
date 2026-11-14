import type { MaterialsController } from '../application/materials';
import { chatArchiveFileName } from '../domain/chat-archive';
import { el, button, field, showModal, download } from './dom';
import type { ChatArchive } from '../domain/chat-archive';

export function openChatArchives(app: MaterialsController) {
  showModal('聊天剧情归档', (body) => {
    const status = el('p', '', '正在读取当前角色归档…');
    status.setAttribute('role', 'status');
    const list = el('div');
    const search = field('搜索片段标题、标签或聊天', '');
    let archives: ChatArchive[] = [];
    body.append(
      el(
        'p',
        'sg-muted',
        '归档只属于当前账号和角色，可导出完整JSON供其他工具管理。原始消息与AI内容分开保存；部分完成不会冒充完整整理。',
      ),
      status,
      search.root,
      list,
    );
    let busy = false;
    const safe = async (action: () => Promise<void>) => {
      if (busy) return;
      busy = true;
      try {
        app.guard();
        if (!body.isConnected) throw new Error('归档窗口已关闭');
        await action();
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : '归档操作失败';
      } finally {
        busy = false;
      }
    };
    const load = async () => {
      const rows = await app.archives();
      if (!body.isConnected) return;
      archives = rows;
      render();
    };
    const render = () => {
      const term = search.input.value.trim().toLocaleLowerCase();
      const rows = archives.filter((archive) =>
        [archive.title ?? '', archive.characterName, archive.chatKey, ...(archive.tags ?? [])]
          .join('\n')
          .toLocaleLowerCase()
          .includes(term),
      );
      list.replaceChildren();
      for (const archive of rows) {
        const row = el('section', 'sg-chat-archive');
        row.append(
          el('h3', '', archive.title || archive.characterName),
          el('p', 'sg-muted', (archive.tags ?? []).map((tag) => `#${tag}`).join(' ')),
          el(
            'p',
            '',
            `${archive.chatKey} · ${archive.messages.length}条消息 · ${archive.materials.length}条整理结果`,
          ),
          el(
            'small',
            'sg-muted sg-archive-meta',
            `${archive.createdAt} · ${{ raw: '仅原始消息', complete: '完整整理', partial: '部分完成' }[archive.status]} · ${archive.completedBatches}/${archive.totalBatches}批`,
          ),
          button('导出归档JSON', () =>
            safe(async () => {
              download(chatArchiveFileName(archive), archive);
              status.textContent = '归档已导出';
            }),
          ),
          button('删除归档', () => {
            showModal('删除聊天归档', (confirm, close) => {
              confirm.append(
                el('p', '', `删除${archive.characterName}的这份归档？可先导出留存，不影响原始聊天。`),
                button('确认删除归档', () =>
                  safe(async () => {
                    await app.removeArchive(archive.id);
                    await load();
                    close();
                  }),
                ),
              );
            });
          }),
        );
        const actions = el('div', 'sg-toolbar');
        for (const action of row.querySelectorAll(':scope > button')) actions.append(action);
        row.append(actions);
        const preview = el('details', 'sg-details');
        preview.append(el('summary', '', `阅读原文（${archive.messages.length}条）`));
        let rendered = false;
        preview.addEventListener('toggle', () => {
          if (!preview.open || rendered) return;
          rendered = true;
          for (const message of archive.messages) {
            const section = el('section');
            section.append(
              el('h4', '', `第${message.number}条 · ${message.speaker}`),
              el('pre', 'sg-material-source', message.text),
            );
            preview.append(section);
          }
        });
        row.append(preview);
        list.append(row);
      }
      status.textContent = rows.length
        ? `当前角色共有${rows.length}份归档`
        : '当前角色暂无归档，可在“从当前聊天整理”中保存。';
    };
    search.input.addEventListener('input', render);
    queueMicrotask(() => {
      void safe(load);
    });
  });
}
