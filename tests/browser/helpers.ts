import type { Page } from '@playwright/test';

export async function openGuide(page: Page) {
  const settings = page.locator('#story-guide-settings');
  const expanded = await settings.evaluate((node) => node instanceof HTMLDetailsElement && node.open);
  if (!expanded) await settings.locator('summary').click();
  await page.getByRole('button', { name: '打开剧情指南', exact: true }).click();
}
