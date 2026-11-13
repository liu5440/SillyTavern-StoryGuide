import { test, expect } from '@playwright/test';

test('默认折叠设置，键盘展开后打开；魔杖菜单打开同一面板', async ({ page }) => {
  await page.goto('/');
  const settings = page.locator('#story-guide-settings');
  await expect(settings).toBeVisible();
  await expect(settings.locator('button')).toBeHidden();
  await settings.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(settings.locator('button')).toBeVisible();
  await settings.locator('button').click();
  await expect(page.locator('.sg-panel')).toBeVisible();
  await page.locator('.sg-header').getByRole('button', { name: '关闭', exact: true }).click();
  await page.locator('#story-guide-menu-entry').click();
  await expect(page.locator('.sg-panel')).toBeVisible();
  await expect(page.locator('.sg-panel')).toHaveCount(1);
});

test('重复初始化、延迟菜单与清理不影响其他扩展', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#story-guide-settings')).toBeVisible();
  await page.evaluate(async () => {
    const path = '/dist/index.js?entry-reinit=1';
    await import(path);
  });
  await expect(page.locator('#story-guide-menu-entry')).toHaveCount(1);
  await expect(page.locator('#story-guide-settings')).toHaveCount(1);
  await expect(page.locator('#other-extension')).toHaveCount(1);
  await page.evaluate(async () => {
    document.querySelector('#extensionsMenu')?.remove();
    const path = '/dist/index.js?entry-reinit=2';
    await import(path);
    const menu = document.createElement('div');
    menu.id = 'extensionsMenu';
    document.body.append(menu);
  });
  await expect(page.locator('#story-guide-menu-entry')).toHaveCount(1);
  await page.evaluate(() => window.storyGuideCleanup?.());
  await expect(page.locator('#story-guide-settings')).toHaveCount(0);
  await expect(page.locator('#story-guide-menu-entry')).toHaveCount(0);
  await expect(page.locator('.sg-panel')).toHaveCount(0);
});
