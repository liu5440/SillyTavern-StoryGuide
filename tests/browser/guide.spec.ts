import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/');
  await page.getByRole('button', { name: '打开剧情指南' }).click();
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
  await page.getByRole('button', { name: '打开剧情指南' }).click();
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
