import { openGuide } from './helpers';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/');
  await openGuide(page);
});

test('本地资料目录不调用模型，也能查看原文卡片', async ({ page }) => {
  await page.evaluate(() => {
    const c = window.SillyTavern?.getContext();
    if (c)
      c.generateRaw = async () => {
        throw new Error('不应调用模型');
      };
  });
  await page.getByRole('button', { name: '建立本地资料目录（无需AI）' }).click();
  await expect(page.locator('.sg-status')).toContainText('未调用AI');
  await expect(page.getByLabel('完整攻略（含剧透）')).not.toBeChecked();
  await expect(page.locator('.sg-output')).toContainText('一位住在旧城的调查员。');
  await page.getByRole('button', { name: '保存草稿版本', exact: true }).click();
  await expect(page.locator('.sg-status')).toContainText('已保存');
  await page.reload();
  await openGuide(page);
  await expect(page.getByLabel('完整攻略（含剧透）')).not.toBeChecked();
  await expect(page.locator('.sg-output')).toContainText('一位住在旧城的调查员。');
});

test('兼容调用消费当前酒馆流式接口，不触发generateRaw', async ({ page }) => {
  await page.route('**/scripts/openai.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `
    export const oai_settings = {stream_openai:true, n:3, logprobs:5, chat_completion_source:'custom'};
    export function getChatCompletionModel(){ return 'test'; }
    export async function createGenerationParameters(settings, model, type, messages) {
      if (settings.n !== 1 || settings.logprobs !== 0 || oai_settings.n !== 3) throw new Error('请求隔离失败');
      return {stream:true, generate_data:{stream:true, n:settings.n, messages, tools:[{type:"function"}], tool_choice:"required"}};
    }
    export function getStreamingReply(data){ return data.text; }
    `,
    }),
  );
  await page.route('**/script.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `
    export function getRequestHeaders(){return {'Content-Type':'application/json'};}
    export const eventSource={emit:async()=>{}};
    export const event_types={CHAT_COMPLETION_SETTINGS_READY:'settings'};
  `,
    }),
  );
  await page.route('**/scripts/sse-stream.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `
    export function getEventSourceStream(){return new TransformStream({transform(chunk,controller){controller.enqueue({data:new TextDecoder().decode(chunk)});}});}
  `,
    }),
  );
  await page.route('**/api/backends/chat-completions/generate', async (route) => {
    const body = route.request().postDataJSON();
    expect(body.n).toBe(1);
    expect(body.logprobs).toBe(false);
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
    expect(body.messages).toHaveLength(2);
    const draft = await page.evaluate(() => (window as unknown as { testDraft: unknown }).testDraft);
    await route.fulfill({
      body: JSON.stringify({ text: JSON.stringify(draft) }),
      contentType: 'text/event-stream',
    });
  });
  await page.evaluate(() => {
    const c = window.SillyTavern?.getContext();
    if (c) {
      c.mainApi = 'openai';
      c.generateRaw = async () => {
        throw new Error('不应使用quiet');
      };
    }
  });
  await page.getByRole('combobox', { name: '模型调用方式' }).selectOption('compatible');
  await page.getByRole('button', { name: '生成故事草稿' }).click();
  await expect(page.getByRole('heading', { name: '旧城来信' })).toBeVisible();
});

test('宿主同步报错后可重试，修复等待显示原因并可取消', async ({ page }) => {
  await page.evaluate(() => {
    if (!window.SillyTavern) throw new Error('Missing test host');
    const context = window.SillyTavern.getContext();
    context.generateRaw = () => {
      throw new Error('测试同步失败');
    };
  });
  await page.getByRole('button', { name: '生成故事草稿' }).click();
  await expect(page.locator('.sg-status')).toContainText('测试同步失败');
  await page.evaluate(() => {
    let calls = 0;
    if (!window.SillyTavern) throw new Error('Missing test host');
    window.SillyTavern.getContext().generateRaw = async () => {
      calls++;
      if (calls === 1) return 'invalid';
      return new Promise<string>(() => {});
    };
  });
  await page.getByRole('button', { name: '生成故事草稿' }).click();
  await expect(page.locator('.sg-status')).toContainText('不是有效 JSON');
  await expect(page.locator('.sg-status')).toContainText('已等待 1 秒');
  await page.getByRole('button', { name: '取消生成', exact: true }).click();
  await expect(page.getByRole('button', { name: '生成故事草稿' })).toBeEnabled();
  await page.getByRole('button', { name: '排查日志', exact: true }).click();
  const logs = page.locator('.sg-modal').last();
  await expect(logs.locator('pre')).toContainText('JSON解析失败');
  await expect(logs.locator('pre')).toContainText('SillyTavern.getContext().generateRaw');
  await expect(logs.locator('pre')).not.toContainText('测试同步失败');
  const exported = page.waitForEvent('download');
  await logs.getByRole('button', { name: '导出日志', exact: true }).click();
  expect((await exported).suggestedFilename()).toBe('剧情指南-排查日志.json');
  await logs.getByRole('button', { name: '清空日志', exact: true }).click();
  await expect(logs.locator('pre')).toContainText('"entries": []');
});
test('无书创作、剧透控制、安全文本、采用、进度与刷新恢复', async ({ page }) => {
  await expect(page.getByRole('heading', { name: '艾琳的剧情指南' })).toBeVisible();
  await page.getByRole('button', { name: '生成故事草稿' }).click();
  await expect(page.getByRole('heading', { name: '旧城来信' })).toBeVisible();
  await expect(page.getByText('隐藏的真相', { exact: true })).toHaveCount(0);
  await expect(page.locator('.sg-panel img')).toHaveCount(0);
  await page.getByLabel('完整攻略（含剧透）').check();
  await expect(page.getByText('隐藏的真相', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '路线图', exact: true }).click();
  await expect(page.locator('.sg-graph-node')).toHaveCount(2);
  await page.getByRole('button', { name: '采用此故事' }).click();
  await page.locator('.sg-graph-node').first().click();
  await page.getByRole('button', { name: '标记已完成' }).click();
  await expect(page.locator('.sg-status')).toHaveText('本局进度已保存');
  await page.reload();
  await openGuide(page);
  await expect(page.locator('.sg-story-heading .sg-badge')).toContainText('已采用');
  await page.getByRole('button', { name: '事件', exact: true }).click();
  await expect(page.getByText(/用户设定|原创故事.*已完成/).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/guide-desktop.png', fullPage: true });
});
test('窄屏没有面板横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '生成故事草稿' })).toBeVisible();
  const size = await page
    .locator('.sg-panel')
    .evaluate((e) => ({ width: e.clientWidth, scroll: e.scrollWidth }));
  expect(size.scroll).toBeLessThanOrEqual(size.width + 1);
  await page.screenshot({ path: 'test-results/guide-mobile.png', fullPage: true });
});
test('导出的本局备份可以导入并采用，完成状态不丢失', async ({ page }) => {
  await page.getByRole('button', { name: '生成故事草稿' }).click();
  await expect(page.getByRole('heading', { name: '旧城来信' })).toBeVisible();
  await page.getByRole('button', { name: '采用此故事' }).click();
  await expect(page.locator('.sg-story-heading .sg-badge')).toContainText('已采用');
  await page.locator('.sg-event-row').first().click();
  await page.getByRole('button', { name: '标记已完成' }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '备份故事与本局进度' }).click();
  const path = await (await downloading).path();
  if (!path) throw new Error('下载未完成');
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: await readFile(path) });
  await page.getByLabel('同时恢复备份进度到当前聊天（需重新核对）').check();
  await page.getByRole('button', { name: '另存为新故事' }).click();
  await expect(page.locator('.sg-modal')).toHaveCount(0);
  await page.getByRole('button', { name: '采用此故事' }).click();
  await expect(page.locator('.sg-story-heading .sg-badge')).toContainText('已采用');
  await expect(page.locator('.sg-event-row')).toContainText('已完成');
});
