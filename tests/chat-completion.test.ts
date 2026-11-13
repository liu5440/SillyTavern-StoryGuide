import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendCompatibleCompletion } from '../src/host/chat-completion';

test('原生累计流式只采用最终正文，不拼接重复片段，不附带其他聊天', async () => {
  const text = await sendCompatibleCompletion(
    async (type, messages, _signal, responseLength) => {
      assert.equal(type, 'normal');
      assert.equal(messages.length, 2);
      assert.equal(messages[1]?.content, '所选资料');
      assert.equal(responseLength, 6000);
      return async function* () {
        yield { text: '{"a":' };
        yield { text: '{"a":1}' };
      };
    },
    '所选资料',
    new AbortController().signal,
  );
  assert.equal(text, '{"a":1}');
});

test('非流式正文正常返回，空回复只失败一次而不自动重试', async () => {
  assert.equal(
    await sendCompatibleCompletion(
      async () => ({ choices: [{ message: { content: '正文' } }] }),
      '',
      new AbortController().signal,
    ),
    '正文',
  );
  let calls = 0;
  await assert.rejects(
    sendCompatibleCompletion(
      async () => {
        calls++;
        return {
          choices: [{ message: { role: 'assistant' }, finish_reason: 'stop' }],
          usage: { completion_tokens: 0 },
        };
      },
      '',
      new AbortController().signal,
    ),
    /未返回可用正文/,
  );
  assert.equal(calls, 1);
});

test('流式取消丢弃旧结果', async () => {
  const abort = new AbortController();
  await assert.rejects(
    sendCompatibleCompletion(
      async () =>
        async function* () {
          yield { text: '片段' };
          abort.abort();
          yield { text: '迟到结果' };
        },
      '',
      abort.signal,
    ),
    /abort/i,
  );
});

test('识别宿主多种正文格式，不把工具调用或思考当成正文', async () => {
  for (const data of [
    { content: [{ type: 'text', text: '正文' }] },
    { choices: [{ text: '正文' }] },
    { text: '正文' },
    { message: { content: [{ text: '正文' }] } },
  ]) {
    assert.equal(await sendCompatibleCompletion(async () => data, '', new AbortController().signal), '正文');
  }
  await assert.rejects(
    sendCompatibleCompletion(
      async () => ({ choices: [{ message: { reasoning_content: '思考', tool_calls: [] } }] }),
      '',
      new AbortController().signal,
    ),
    /未返回可用正文/,
  );
});
