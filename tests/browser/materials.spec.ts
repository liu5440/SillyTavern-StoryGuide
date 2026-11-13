import { openGuide } from './helpers';
import { test, expect } from '@playwright/test';

test('素材库无需故事即可筛选收藏复制，刷新保留收藏且不发送聊天', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await openGuide(page);
  await expect(page.locator('.sg-status')).toContainText('条资料已读取');
  await page.getByRole('button', { name: '场景素材库', exact: true }).click();
  await expect(page.locator('.sg-material-card')).toHaveCount(16);
  await page.getByLabel('素材分类', { exact: true }).selectOption('outfit');
  await page.getByLabel('搜索素材', { exact: true }).fill('缎面');
  await expect(page.locator('.sg-material-card')).toHaveCount(1);
  await page.getByRole('button', { name: '收藏', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消收藏', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '复制素材', exact: true }).click();
  await expect(page.locator('.sg-material-status')).toContainText('已复制');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('缎面');
  expect(await page.evaluate(() => window.SillyTavern?.getContext().chat?.length)).toBe(0);
  await page.reload();
  await openGuide(page);
  await expect(page.locator('.sg-status')).toContainText('条资料已读取');
  await page.getByRole('button', { name: '场景素材库', exact: true }).click();
  await page.getByLabel('只看收藏').check();
  await expect(page.locator('.sg-material-card')).toHaveCount(1);
});

test('对话选区预览保存、来源纯文本、个人备份与跨聊天关闭', async ({ page }) => {
  await page.goto('/');
  await openGuide(page);
  await expect(page.locator('.sg-status')).toContainText('条资料已读取');
  await page.getByRole('button', { name: '场景素材库', exact: true }).click();
  await page.getByRole('button', { name: '整理粘贴的对话' }).click();
  const text = '<img src=x onerror=alert(1)>\n成年旧友在书店重逢。';
  await page.getByLabel('对话来源名称').fill('手动粘贴样例');
  await page.getByLabel('对话原文').fill(text);
  await page.getByLabel('对话原文').evaluate((node) => {
    const input = node as HTMLTextAreaElement;
    input.setSelectionRange(0, input.value.length);
  });
  await page.getByRole('button', { name: '使用选中片段' }).click();
  await page.getByLabel('素材标题').fill('书店重逢');
  await page.getByLabel('素材描述（用户改编）').fill('成年旧友在书店重逢。');
  await page.getByLabel('剧情开场（用户改编）').fill('要不要一起喝杯茶？');
  await page.getByRole('button', { name: '预览素材' }).click();
  await expect(page.locator('.sg-material-preview')).toContainText('手动粘贴样例');
  await expect(page.locator('.sg-material-preview img')).toHaveCount(0);
  await page.getByRole('button', { name: '保存到个人素材' }).click();
  await expect(page.locator('.sg-material-status')).toContainText('已保存');
  await page.getByLabel('只看个人素材').check();
  await expect(page.locator('.sg-material-card')).toHaveCount(1);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出素材备份' }).click();
  expect((await download).suggestedFilename()).toContain('materials');
  await page.evaluate(() => {
    const c = window.SillyTavern?.getContext();
    if (c) c.chatId = 'other';
    (window as unknown as { testSwitch: () => void }).testSwitch();
  });
  await expect(page.locator('.sg-material-library')).toHaveCount(0);
  await page.evaluate(() => {
    const c = window.SillyTavern?.getContext();
    if (c) {
      c.characters.push({ avatar: 'other.png', name: '另一位成年角色', description: '住在城中的成年作家。' });
      c.characterId = 1;
    }
    (window as unknown as { testSwitch: () => void }).testSwitch();
  });
  await expect(page.locator('.sg-header h2')).toHaveText('另一位成年角色的剧情指南');
  await page.getByRole('button', { name: '场景素材库', exact: true }).click();
  await expect(page.locator('.sg-material-card')).toHaveCount(16);
  await page.getByLabel('只看个人素材').check();
  await expect(page.locator('.sg-material-card')).toHaveCount(0);
});
