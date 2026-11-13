/** 仅在当前页面内存保留最近100条，不接收原始提示、回复或异常正文。 */
export interface Diagnostic {
  time: string;
  requestId: string;
  event: 'request' | 'response' | 'failure' | 'cancel' | 'validation';
  api?: string;
  elapsedMs?: number;
  inputChars?: number;
  outputChars?: number;
  reason?: string;
  fields?: string[];
  stage?: '生成' | '解析' | '合并' | '修复';
}
const requestIds = new WeakMap<AbortSignal, string>();
export function diagnosticId(signal: AbortSignal): string {
  let id = requestIds.get(signal);
  if (!id) {
    id = crypto.randomUUID();
    requestIds.set(signal, id);
  }
  return id;
}
const entries: Diagnostic[] = [];
export function recordDiagnostic(entry: Omit<Diagnostic, 'time'>) {
  entries.push({ ...entry, fields: entry.fields?.slice(0, 10), time: new Date().toISOString() });
  if (entries.length > 100) entries.splice(0, entries.length - 100);
}
export function diagnosticReport() {
  return {
    format: 'story-guide-diagnostics',
    schemaVersion: 1,
    version: '0.4.3',
    modelSource: 'SillyTavern.getContext().generateRaw',
    retention: '当前页面内存最近100条，刷新清空',
    entries: entries.map((entry) => ({ ...entry, fields: entry.fields?.slice() })),
  };
}
export function clearDiagnostics() {
  entries.length = 0;
}

/** 任意服务端异常可能含密钥和原文，只记录分类与标准HTTP状态码。 */
export function classifyFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const status = message.match(/\b(400|401|403|404|408|413|429|500|502|503|504)\b/)?.[1];
  if (status) return `HTTP ${status}`;
  if (/超时|timeout/i.test(message)) return '请求超时';
  if (/取消|abort/i.test(message)) return '已取消';
  if (/上一次模型请求仍在结束/.test(message)) return '前次宿主请求尚未结束，拒绝重复调用';
  if (/请先在酒馆中连接模型/.test(message)) return '酒馆模型尚未连接';
  if (/不支持 generateRaw/.test(message)) return '宿主缺少generateRaw能力';
  if (/network|fetch|网络/i.test(message)) return '网络请求失败';
  return '宿主模型调用失败（未保存异常原文）';
}
