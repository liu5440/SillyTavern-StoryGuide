import { openGuide } from './helpers';
import { test, expect } from '@playwright/test';
test('切换聊天会关闭旧编辑器，不能把旧节点写入新聊天', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/');
  await openGuide(page);
  await page.getByRole('button', { name: '生成故事草稿' }).click();
  await expect(page.getByRole('heading', { name: '旧城来信' })).toBeVisible();
  await page.getByRole('button', { name: '采用此故事' }).click();
  await expect(page.locator('.sg-story-heading .sg-badge')).toContainText('已采用');
  await page.locator('.sg-event-row').first().click();
  await expect(page.locator('.sg-modal')).toBeVisible();
  await page.evaluate(() => {
    const w = window as unknown as {
      testContext: { getCurrentChatId: () => string };
      testSwitch: () => void;
    };
    w.testContext.getCurrentChatId = () => 'new-chat';
    w.testSwitch();
  });
  await expect(page.locator('.sg-modal')).toHaveCount(0);
  await expect(page.locator('.sg-output')).toContainText('当前：抵达钟楼街');
  await expect(page.locator('.sg-event-row').filter({ hasText: '已完成' })).toHaveCount(0);
});
