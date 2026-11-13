import { diagnosticReport, clearDiagnostics } from '../diagnostics';
import { el, button, showModal, download } from './dom';

export function openDiagnostics() {
  showModal('排查日志', (body) => {
    body.append(
      el(
        'p',
        '',
        '继续使用酒馆当前AI连接。仅保存本页面最近100条；刷新后清空，请先导出。日志不含聊天、完整模型回复或密钥。',
      ),
    );
    const text = el('pre');
    text.style.whiteSpace = 'pre-wrap';
    text.style.overflowWrap = 'anywhere';
    const status = el('p');
    const refresh = () => {
      text.textContent = JSON.stringify(diagnosticReport(), null, 2);
    };
    body.append(
      button('刷新日志', refresh),
      button('复制日志', async () => {
        try {
          await navigator.clipboard.writeText(JSON.stringify(diagnosticReport(), null, 2));
          status.textContent = '日志已复制';
        } catch {
          status.textContent = '复制失败，请使用导出日志';
        }
      }),
      button('导出日志', () => download('剧情指南-排查日志.json', diagnosticReport())),
      button('清空日志', () => {
        clearDiagnostics();
        refresh();
        status.textContent = '日志已清空';
      }),
      status,
      text,
    );
    refresh();
  });
}
