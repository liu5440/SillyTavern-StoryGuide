import type { Page } from '@playwright/test';

export async function openGuide(page: Page) {
  const settings = page.locator('#story-guide-settings');
  const expanded = await settings.evaluate((node) => node instanceof HTMLDetailsElement && node.open);
  if (!expanded) await settings.locator('summary').click();
  await page.getByRole('button', { name: '打开剧情指南', exact: true }).click();
  if (!(await page.locator('.sg-panel').evaluate((panel) => panel.classList.contains('sg-show-settings'))))
    await page.getByRole('button', { name: '资料设置', exact: true }).click();
  const tools = page.locator('.sg-phone-tools');
  if (!(await tools.evaluate((node) => node instanceof HTMLDetailsElement && node.open)))
    await tools.locator('summary').click();
}
