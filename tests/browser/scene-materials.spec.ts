import { test, expect } from '@playwright/test';
import { openGuide } from './helpers';

test('手机关键场景整理、编辑、刷新及恢复不改变原文', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.evaluate(() => {
    const context = window.SillyTavern?.getContext();
    if (!context) throw new Error('缺少Mock宿主');
    context.chat = [{ mes: '她接受道歉，决定继续调查。', name: '艾琳', is_user: false }];
    context.generateRaw = async () =>
      JSON.stringify({
        materials: [
          {
            title: '道歉后的调查',
            category: 'scene',
            tags: [],
            description: '两人继续调查。',
            scene: {
              participants: ['艾琳', '玩家'],
              location: '未知',
              time: '未知',
              context: '争执后',
              trigger: '道歉',
              keyEvents: ['接受道歉'],
              choices: ['继续调查'],
              relationshipChanges: ['和解'],
              consequences: ['继续调查'],
            },
            evidence: [{ messageNumber: 1, quote: '她接受道歉，决定继续调查。' }],
          },
        ],
      });
  });
  await openGuide(page);
  await expect(page.locator('.sg-status')).toContainText('条资料已读取');
  await page.getByRole('button', { name: '场景素材库', exact: true }).click();
  await page.getByRole('button', { name: '从当前聊天整理', exact: true }).click();
  await page.getByRole('button', { name: '用当前模型整理', exact: true }).click();
  await expect(page.getByLabel('关键事件（每行一项）')).toHaveValue('接受道歉');
  await expect(page.getByLabel('原创开场1', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '保存选中素材', exact: true }).click();
  await page.getByLabel('只看个人素材').check();
  await expect(page.locator('.sg-material-card')).toHaveCount(1);
  await page.reload();
  await openGuide(page);
  await expect(page.locator('.sg-status')).toContainText('条资料已读取');
  await page.getByRole('button', { name: '场景素材库', exact: true }).click();
  await page.getByLabel('只看个人素材').check();
  await expect(page.locator('.sg-material-card')).toHaveCount(1);
  await page.getByRole('button', { name: '编辑整理', exact: true }).click();
  await page.getByLabel('后果（每行一项）').fill('进入后续调查');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.locator('.sg-material-card')).toContainText('进入后续调查');
  await page.getByRole('button', { name: '历史与恢复', exact: true }).click();
  await page.getByText('旧版本 1 · 道歉后的调查', { exact: true }).click();
  await page.getByRole('button', { name: '恢复此版本', exact: true }).click();
  await expect(page.locator('.sg-material-card')).not.toContainText('进入后续调查');
  await page.getByRole('button', { name: '查看来源', exact: true }).click();
  await expect(page.locator('.sg-modal').last()).toContainText('她接受道歉，决定继续调查。');
  expect(await page.evaluate(() => window.SillyTavern?.getContext().chat?.length)).toBe(0);
});
