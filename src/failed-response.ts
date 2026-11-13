/** 单独保留最近一次失败正文，不进入普通日志、存档或网络。刷新/清空即丢弃。 */
let last: { text: string; stage: string; reason: string; time: string } | undefined;
export function setFailedResponse(text: string, stage: string, reason: string) {
  last = { text, stage, reason, time: new Date().toISOString() };
}
export function failedResponse() {
  return last ? { ...last } : undefined;
}
export function clearFailedResponse() {
  last = undefined;
}
