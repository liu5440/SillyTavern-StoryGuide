import { test, expect } from '@playwright/test';

test('悬浮手册不锁聊天，收起恢复保留草稿，支持大窗口和窄屏', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/');
  await page.evaluate(() => {
    const input = document.createElement('textarea');
    input.id = 'send_textarea';
    input.setAttribute('aria-label', '酒馆聊天输入');
    input.style.cssText = 'position:fixed;left:10px;bottom:10px;width:200px;height:50px;';
    document.body.append(input);
  });
  await page.locator('#story-guide-settings summary').click();
  await page.getByRole('button', { name: '打开剧情指南', exact: true }).click();
  await expect(page.locator('.sg-sidebar')).toBeHidden();
  await expect(page.locator('.sg-panel')).toHaveJSProperty('open', true);
  await page.getByRole('textbox', { name: '酒馆聊天输入' }).fill('边阅读边输入');
  await expect(page.getByRole('textbox', { name: '酒馆聊天输入' })).toBeFocused();
  await page.getByRole('button', { name: '资料设置', exact: true }).click();
  await page.getByRole('button', { name: '建立本地资料目录（无需AI）' }).click();
  await page.getByRole('button', { name: '资料设置', exact: true }).click();
  await page.getByRole('button', { name: '收起', exact: true }).click();
  await expect(page.locator('.sg-panel')).toBeHidden();
  await page.getByRole('textbox', { name: '酒馆聊天输入' }).fill('继续聊天');
  await page.locator('.sg-guide-bubble').click();
  await expect(page.locator('.sg-panel')).toBeVisible();
  await expect(page.getByRole('button', { name: '保存草稿版本', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await expect(page.locator('.sg-panel')).toHaveClass(/sg-expanded/);
  await page.getByRole('button', { name: '悬浮阅读', exact: true }).click();
  await page.screenshot({ path: 'test-results/floating-guide-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = await page.locator('.sg-panel').boundingBox();
  const chat = await page.getByRole('textbox', { name: '酒馆聊天输入' }).boundingBox();
  if (!panel || !chat) throw new Error('缺少布局尺寸');
  expect(panel.y + panel.height).toBeLessThan(chat.y);
  const size = await page
    .locator('.sg-panel')
    .evaluate((node) => ({ client: node.clientWidth, scroll: node.scrollWidth }));
  expect(size.scroll).toBeLessThanOrEqual(size.client + 2);
  await page.getByRole('textbox', { name: '酒馆聊天输入' }).fill('窄屏仍能聊天');
  await page.screenshot({ path: 'test-results/floating-guide-mobile.png', fullPage: true });
});
