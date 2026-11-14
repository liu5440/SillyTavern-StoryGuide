import { test, expect } from '@playwright/test';
import { openGuide } from './helpers';

test('手机素材备份导入预览、拆分合并保留原记录，刷新恢复', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await openGuide(page);
  await expect(page.locator('.sg-status')).toContainText('条资料已读取');
  await page.getByRole('button', { name: '场景素材库', exact: true }).click();
  await page.getByRole('button', { name: '导入素材备份', exact: true }).click();
  const characterKey = await page.evaluate(() => {
    const c = window.SillyTavern!.getContext();
    const character = c.characters[Number(c.characterId)];
    if (!character || typeof character !== 'object' || !('avatar' in character)) throw new Error('缺少角色');
    return character.avatar;
  });
  const card = {
    schemaVersion: 1,
    id: 'personal:sample',
    title: '原场景',
    category: 'scene',
    tags: [],
    description: '重逢后告别',
    opening: '',
    origin: 'dialogue',
    quote: '重逢后告别',
    source: { label: '片段', text: '重逢后告别', start: 0, end: 5 },
    evidence: [{ label: '片段', text: '重逢后告别', start: 0, end: 5, quote: '重逢后告别' }],
    scene: {
      participants: [],
      location: '',
      time: '',
      context: '',
      trigger: '',
      keyEvents: ['重逢'],
      choices: [],
      relationshipChanges: [],
      consequences: ['告别'],
      summaryOrigin: 'user_manual',
      status: 'confirmed',
    },
  };
  await page.getByLabel('素材备份JSON').fill(
    JSON.stringify({
      format: 'story-guide-materials',
      schemaVersion: 1,
      characterKey,
      materials: [card],
      favorites: [card.id],
    }),
  );
  await page.getByRole('button', { name: '校验并预览' }).click();
  await expect(page.getByText('旧备份未记录账号', { exact: false })).toBeVisible();
  await expect(page.locator('.sg-material-card')).toHaveCount(16);
  await page.getByRole('button', { name: '确认另存到当前角色' }).click();
  await page.getByLabel('只看个人素材').check();
  await expect(page.locator('.sg-material-card')).toHaveCount(1);
  await page.getByRole('button', { name: '拆分场景', exact: true }).click();
  await page.getByLabel('新场景1名称').fill('重逢');
  await page.getByLabel('新场景2名称').fill('告别');
  await page.getByLabel('剧情简介（人工整理）', { exact: true }).nth(0).fill('重逢');
  await page.getByLabel('剧情简介（人工整理）', { exact: true }).nth(1).fill('告别');
  await page.getByRole('button', { name: '另存新场景并保留原记录' }).click();
  await expect(page.locator('.sg-material-card')).toHaveCount(3);
  await page.getByRole('button', { name: '合并关键场景', exact: true }).click();
  await page.getByRole('checkbox', { name: '重逢', exact: true }).check();
  await page.getByRole('checkbox', { name: '告别', exact: true }).check();
  await page.getByRole('button', { name: '编辑合并摘要' }).click();
  await page.getByLabel('剧情简介（人工整理）', { exact: true }).fill('人工合并摘要');
  await page.getByRole('button', { name: '另存新场景并保留原记录' }).click();
  await expect(page.locator('.sg-material-card')).toHaveCount(4);
  await page.reload();
  await openGuide(page);
  await expect(page.locator('.sg-status')).toContainText('条资料已读取');
  await page.getByRole('button', { name: '场景素材库', exact: true }).click();
  await page.getByLabel('只看个人素材').check();
  await expect(page.locator('.sg-material-card')).toHaveCount(4);
});
