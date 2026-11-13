import type { MaterialsController } from '../application/materials';
import { chatArchiveFileName } from '../domain/chat-archive';
import { el, button, showModal, download } from './dom';

export function openChatArchives(app: MaterialsController) {
  showModal('聊天剧情归档', (body) => {
    const status = el('p', '', '正在读取当前角色归档…');
    status.setAttribute('role', 'status');
    const list = el('div');
    body.append(
      el(
        'p',
        'sg-muted',
        '归档只属于当前账号和角色，可导出完整JSON供其他工具管理。原始消息与AI内容分开保存；部分完成不会冒充完整整理。',
      ),
      status,
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
      list.replaceChildren();
      for (const archive of rows) {
        const row = el('section', 'sg-chat-archive');
        row.append(
          el('h3', '', archive.characterName),
          el(
            'p',
            '',
            `${archive.chatKey} · ${archive.messages.length}条消息 · ${archive.materials.length}条整理结果`,
          ),
          el(
            'small',
            'sg-muted',
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
        list.append(row);
      }
      status.textContent = rows.length
        ? `当前角色共有${rows.length}份归档`
        : '当前角色暂无归档，可在“从当前聊天整理”中保存。';
    };
    queueMicrotask(() => {
      void safe(load);
    });
  });
}
