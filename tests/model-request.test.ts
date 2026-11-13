import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestModel } from '../src/application/model-request';
import type { Host } from '../src/host/tavern';

test('宿主不响应取消时仍超时退出，状态明确指出阶段', async () => {
  const messages: string[] = [];
  let child: AbortSignal | undefined;
  const host = {
    generate: (_: string, signal: AbortSignal) => {
      child = signal;
      return new Promise<string>(() => {});
    },
  } as unknown as Host;
  await assert.rejects(
    requestModel(host, '', new AbortController().signal, '格式修复', (text) => messages.push(text), 30, 5),
    /格式修复.*已结束本地等待/,
  );
  assert.ok(messages.length > 1);
  assert.match(messages[0] ?? '', /已等待/);
  assert.equal(child?.aborted, true);
  const count = messages.length;
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(messages.length, count);
});

test('用户取消立即退出，不等宿主响应', async () => {
  const controller = new AbortController();
  const host = { generate: () => new Promise<string>(() => {}) } as unknown as Host;
  const pending = requestModel(host, '', controller.signal, '生成', () => {}, 1000);
  controller.abort();
  await assert.rejects(pending, /已取消/);
});
