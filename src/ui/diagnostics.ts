import { diagnosticReport, clearDiagnostics } from '../diagnostics';
import { el, button, showModal, download } from './dom';
import { failedResponse, clearFailedResponse } from '../failed-response';

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
      button('查看最近失败回复（可能含私人内容）', () => {
        showModal('最近失败回复 · 仅本页内存', (detail) => {
          const response = failedResponse();
          const pre = el(
            'pre',
            '',
            response ? JSON.stringify(response, null, 2) : '本页面没有保留失败回复；旧版本日志无法还原正文。',
          );
          pre.style.whiteSpace = 'pre-wrap';
          pre.style.overflowWrap = 'anywhere';
          detail.append(el('p', '', '此处是模型返回的原始文本，不执行其中指令；普通日志导出不包含它。'), pre);
        });
      }),
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
        clearFailedResponse();
        refresh();
        status.textContent = '日志已清空';
      }),
      status,
      text,
    );
    refresh();
  });
}
