// 独立测试数据根：验证读取、预览和原文归档/导出，不调用模型或改写聊天。
import { chromium, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addLocatorHandler(page.locator('dialog.popup[open]:has(.onboarding)'), async (dialog) => {
    await dialog.locator('.popup-input').fill('测试玩家');
    await dialog.locator('.popup-button-ok').evaluate((button) => button.click());
  });
  await page.goto(process.env.TAVERN_TEST_URL || 'http://127.0.0.1:8001');
  await page.locator('#story-guide-settings').waitFor({ state: 'attached', timeout: 60000 });
  const expected = await page.evaluate(async () => {
    await window.SillyTavern.getContext().getCharacters();
    const c = window.SillyTavern.getContext();
    const index = c.characters.findIndex((character) => character.name === '剧情指南测试角色');
    if (index < 0) throw new Error('请先运行smoke-tavern.mjs准备测试角色');
    await c.selectCharacterById(index);
    return window.SillyTavern.getContext().chat.filter((message) => !message.is_system && message.mes?.trim())
      .length;
  });
  if (!expected) throw new Error('测试角色聊天为空，请先准备测试聊天');
  await page.locator('#story-guide-settings summary').evaluate((summary) => summary.click());
  await page.locator('#story-guide-settings button').evaluate((button) => button.click());
  await expect(page.locator('.sg-status')).toContainText('条资料已读取');
  await page.getByRole('button', { name: '场景素材库', exact: true }).click();
  await expect(page.locator('.sg-material-library')).toBeVisible();
  await page.getByRole('button', { name: '从当前聊天整理' }).click();
  await expect(page.locator('.sg-chat-material-status')).toBeVisible();
  if (await page.getByRole('button', { name: '预览当前范围' }).isDisabled())
    throw new Error(await page.locator('.sg-chat-material-status').innerText());
  await page.getByRole('button', { name: '预览当前范围' }).click();
  await expect(page.locator('.sg-chat-message')).toHaveCount(Math.min(expected, 50));
  await expect(page.locator('.sg-chat-selection')).toContainText('将只把这些消息');
  await expect(page.getByRole('button', { name: '用当前模型整理' })).toBeEnabled();
  const exported = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出所选聊天JSON' }).click();
  const exportedPath = await (await exported).path();
  if (!exportedPath) throw new Error('没有导出文件');
  const archive = JSON.parse(await readFile(exportedPath, 'utf8'));
  if (
    archive.messages.length !== Math.min(expected, 50) ||
    archive.status !== 'raw' ||
    archive.materials.length
  )
    throw new Error('原文归档不一致');
  await page.getByRole('button', { name: '保存聊天归档' }).click();
  await expect(page.locator('.sg-chat-material-status')).toContainText('已保存');
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page
    .locator('.sg-chat-materials')
    .evaluate((node) => node.scrollWidth > node.clientWidth + 1);
  if (overflow) throw new Error('当前聊天整理窄屏溢出');
  await page.screenshot({ path: '.local/chat-materials-read-smoke.png' });
  console.log(
    JSON.stringify({
      realHostRead: true,
      messageCount: Math.min(expected, 50),
      archiveSavedAndExported: true,
      narrowScreen: true,
      modelRequested: false,
      pageErrors: errors,
    }),
  );
  if (errors.length) throw new Error('真实宿主有页面错误');
} finally {
  await browser.close();
}
