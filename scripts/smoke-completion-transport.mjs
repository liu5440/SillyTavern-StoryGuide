// 独立测试根：真实酒馆发送器 + 拦截响应，不调用真实模型、不读用户聊天。
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
await build({
  entryPoints: ['src/host/chat-completion.ts'],
  bundle: true,
  format: 'esm',
  outfile: '.local/transport-test-module.js',
});
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
try {
  const page = await browser.newPage();
  const requests = [];
  await page.route('**/story-guide-transport-test.js', (route) =>
    route.fulfill({ path: '.local/transport-test-module.js', contentType: 'text/javascript' }),
  );
  await page.route('**/api/backends/chat-completions/generate', async (route) => {
    const body = route.request().postDataJSON();
    requests.push({
      stream: body.stream,
      messageCount: body.messages?.length,
      n: body.n,
      logprobs: body.logprobs,
      maxTokens: body.max_tokens,
    });
    if (body.stream) {
      const event = (content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
      await route.fulfill({
        contentType: 'text/event-stream',
        body: event('{"ok":') + event('true}') + 'data: [DONE]\n\n',
      });
    } else {
      await route.fulfill({
        json: {
          choices: [{ message: { role: 'assistant' }, finish_reason: 'stop' }],
          usage: { completion_tokens: 0 },
        },
      });
    }
  });
  await page.addLocatorHandler(page.locator('dialog.popup[open]:has(.onboarding)'), async (dialog) => {
    await dialog.locator('.popup-input').fill('测试玩家');
    await dialog.locator('.popup-button-ok').evaluate((button) => button.click());
  });
  await page.goto(process.env.TAVERN_TEST_URL || 'http://127.0.0.1:8001');
  await page.waitForFunction(() => window.SillyTavern?.getContext().characters, { timeout: 30000 });
  const result = await page.evaluate(async () => {
    const native = await import('/scripts/openai.js');
    Object.assign(native.oai_settings, {
      chat_completion_source: 'custom',
      custom_model: 'test-model',
      stream_openai: true,
      n: 3,
      logprobs: 5,
      openai_max_tokens: 300,
    });
    const messages = [
      { role: 'system', content: '只输出JSON' },
      { role: 'user', content: '传输测试' },
    ];
    const quiet = await native.sendOpenAIRequest('quiet', messages, new AbortController().signal);
    const adapter = await import('/story-guide-transport-test.js');
    const text = await adapter.sendCompatibleCompletion(
      await adapter.loadCompletionSender(),
      '传输测试',
      new AbortController().signal,
    );
    if (text !== '{"ok":true}') throw new Error('原生累计流式正文不符合预期');
    return {
      quietHasContent: Boolean(quiet.choices?.[0]?.message?.content),
      streamedJson: text === '{"ok":true}',
      settingsUnchanged:
        native.oai_settings.n === 3 &&
        native.oai_settings.logprobs === 5 &&
        native.oai_settings.openai_max_tokens === 300,
    };
  });
  if (requests.length !== 2 || requests[0].stream !== false || requests[1].stream !== true)
    throw new Error('流式参数差异验证失败');
  if (requests[1].n !== 1 || requests[1].logprobs !== false || !result.settingsUnchanged)
    throw new Error('请求隔离验证失败');
  if (requests[0].maxTokens !== 300 || requests[1].maxTokens !== 6000)
    throw new Error('后台输出预算验证失败');
  console.log(
    JSON.stringify({ nativeHost: true, mockedResponses: true, realModelCalled: false, requests, ...result }),
  );
} finally {
  await browser.close();
}
