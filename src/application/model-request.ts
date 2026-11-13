import type { Host } from '../host/tavern';
import { diagnosticId, recordDiagnostic, classifyFailure } from '../diagnostics';

/** 每个请求单独计时；宿主忽略取消时也结束本地等待，并丢弃迟到结果。 */
export async function requestModel(
  host: Host,
  prompt: string,
  signal: AbortSignal,
  stage: string,
  progress: (message: string) => void,
  timeoutMs = 180000,
  intervalMs = 1000,
): Promise<string> {
  const controller = new AbortController();
  const started = Date.now();
  const requestId = diagnosticId(controller.signal);
  recordDiagnostic({
    requestId,
    event: 'request',
    stage: stage.includes('修复')
      ? '修复'
      : stage.includes('解析')
        ? '解析'
        : stage.includes('合并')
          ? '合并'
          : '生成',
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let abort = () => {};
  try {
    return await new Promise<string>((resolve, reject) => {
      abort = () => {
        controller.abort();
        reject(new Error('已取消生成；宿主模型请求可能仍在结束，旧结果不会采用'));
      };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      const report = () =>
        progress(
          `${stage}｜已等待 ${Math.floor((Date.now() - started) / 1000)} 秒，单次最多 ${timeoutMs / 1000} 秒；可取消`,
        );
      report();
      heartbeat = setInterval(report, intervalMs);
      timer = setTimeout(() => {
        controller.abort();
        reject(
          new Error(
            `${stage}：等待超过 ${timeoutMs / 1000} 秒，已结束本地等待。宿主模型请求可能仍在结束，迟到结果不会采用；请检查酒馆模型连接后重试。`,
          ),
        );
      }, timeoutMs);
      Promise.resolve()
        .then(() => {
          if (controller.signal.aborted) throw new Error('已取消生成');
          return host.generate(prompt, controller.signal);
        })
        .then(resolve, reject);
    });
  } catch (error) {
    recordDiagnostic({
      requestId,
      event: 'failure',
      elapsedMs: Date.now() - started,
      reason: classifyFailure(error),
    });
    throw error;
  } finally {
    clearTimeout(timer);
    clearInterval(heartbeat);
    signal.removeEventListener('abort', abort);
  }
}
