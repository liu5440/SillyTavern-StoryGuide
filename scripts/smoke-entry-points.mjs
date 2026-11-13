// 仅对独立测试数据根运行；沿用已创建的测试角色，不调用模型。
import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addLocatorHandler(page.locator('dialog.popup[open]:has(.onboarding)'), async (dialog) => {
    await dialog.locator('.popup-input').fill('测试玩家');
    await dialog.locator('.popup-button-ok').evaluate((button) => button.click());
  });
  await page.goto(process.env.TAVERN_TEST_URL || 'http://127.0.0.1:8001');
  await page.locator('#story-guide-menu-entry').waitFor({ state: 'attached', timeout: 60000 });
  await page.evaluate(async () => {
    await window.SillyTavern.getContext().getCharacters();
    const context = window.SillyTavern.getContext();
    const index = context.characters.findIndex((character) => character.name === '剧情指南测试角色');
    if (index < 0) throw new Error('请先在测试数据根运行smoke-tavern.mjs');
    await context.selectCharacterById(index);
  });
  // 打开真实扩展设置抽屉，再展开原生details，核对宿主委托处理没有双重切换。
  await page.locator('#extensions-settings-button > .drawer-toggle').click();
  const settings = page.locator('#story-guide-settings');
  await expect(settings).toBeVisible();
  await expect(settings.locator('button')).toBeHidden();
  await settings.locator('summary').click();
  await expect(settings.locator('button')).toBeVisible();
  await page.screenshot({ path: '.local/entry-settings.png' });
  await settings.locator('button').click();
  await expect(page.locator('.sg-status')).toContainText('条资料已读取');
  await page.locator('.sg-header').getByRole('button', { name: '关闭', exact: true }).click();
  await page.locator('#extensions-settings-button > .drawer-toggle').click();
  await page.locator('#extensionsMenuButton').click();
  await expect(page.locator('#story-guide-menu-entry')).toBeVisible();
  await expect(page.locator('#extensionsMenu')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: '.local/entry-menu.png' });
  await page.locator('#story-guide-menu-entry').click();
  await expect(page.locator('.sg-panel')).toBeVisible();
  await expect(page.locator('.sg-status')).toContainText('条资料已读取');
  await page.locator('.sg-header').getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.locator('#extensionsMenuButton')).toBeFocused();
  console.log(
    JSON.stringify({ settingsDrawer: true, wandMenu: true, focusRestored: true, pageErrors: errors }),
  );
  if (errors.length) throw new Error('页面有未捕获异常');
} finally {
  await browser.close();
}
