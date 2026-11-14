import { test, expect } from '@playwright/test';
import { openGuide } from './helpers';

test('扩展清理会关闭在途工坊和工作台，不遗留模态窗口', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const ctx = window.SillyTavern?.getContext();
    if (ctx) ctx.generateRaw = async () => new Promise<string>(() => {});
  });
  await openGuide(page);
  await page.getByRole('button', { name: '打开剧情工作台', exact: true }).click();
  await page.getByRole('button', { name: 'AI 剧情工坊', exact: true }).click();
  const workshop = page.locator('.sg-route-workshop');
  await workshop.getByRole('checkbox', { name: '角色卡 / 人物描述', exact: true }).check();
  await workshop.getByRole('button', { name: '生成路线草稿', exact: true }).click();
  await page.evaluate(() => window.storyGuideCleanup?.());
  await expect(workshop).toHaveCount(0);
  await expect(page.locator('.sg-workspace')).toHaveCount(0);
});
test('AI工坊草稿与正式图隔离，编辑审核后采用并保存恢复', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await page.goto('/');
  await page.evaluate(() => {
    const ctx = window.SillyTavern?.getContext();
    if (ctx)
      ctx.generateRaw = async () =>
        JSON.stringify({
          events: [
            {
              id: 'new',
              kind: 'ending',
              title: '候选结局',
              summary: '新增剧情',
              characters: [],
              location: '',
              time: '',
              preconditions: '',
              materialIds: [],
              origin: 'ai_generated',
              evidence: [],
            },
          ],
          edges: [],
          routes: [
            {
              id: 'route',
              title: '候选个人线',
              kind: 'custom',
              characters: [],
              eventIds: ['new'],
              edgeIds: [],
              completeness: 'fragment',
              positions: {},
            },
          ],
        });
  });
  await openGuide(page);
  await page.getByRole('button', { name: '打开剧情工作台', exact: true }).click();
  await page.getByRole('button', { name: 'AI 剧情工坊', exact: true }).click();
  const workshop = page.locator('.sg-route-workshop');
  await workshop.getByRole('checkbox', { name: '角色卡 / 人物描述', exact: true }).check();
  await workshop.getByRole('button', { name: '生成路线草稿', exact: true }).click();
  await expect(workshop.getByText('草稿已生成')).toBeVisible();
  await expect(page.locator('.sg-workspace .sg-graph-node')).toHaveCount(0);
  await workshop.getByRole('button', { name: '返回正式路线', exact: true }).click();
  await page.getByRole('button', { name: '保存工作台', exact: true }).click();
  await expect(page.locator('.sg-workspace .sg-status')).toHaveText('已保存到当前浏览器');
  await page.reload();
  await openGuide(page);
  await page.getByRole('button', { name: '打开剧情工作台', exact: true }).click();
  await page.getByRole('button', { name: 'AI 剧情工坊', exact: true }).click();
  await expect(workshop.getByRole('checkbox').first()).not.toBeChecked();
  const event = workshop.locator('.sg-route-workshop-item').nth(0);
  await event.getByRole('textbox', { name: '候选名称' }).fill('人工修订结局');
  const route = workshop.locator('.sg-route-workshop-item').nth(1);
  await route.getByRole('textbox', { name: '候选名称' }).fill('人工修订路线');
  await event.getByRole('button', { name: '应用候选编辑' }).click();
  await expect(route.getByRole('textbox', { name: '候选名称' })).toHaveValue('人工修订路线');
  await event.getByRole('button', { name: '确认此项', exact: true }).click();
  await expect(workshop.locator('[role=status]')).toContainText('请先应用候选编辑');
  await route.getByRole('button', { name: '应用候选编辑' }).click();
  for (const item of await workshop.locator('.sg-route-workshop-item').all())
    await item.getByRole('button', { name: '确认此项', exact: true }).click();
  await workshop.getByRole('button', { name: '采用已确认项', exact: true }).click();
  await expect(workshop.getByText('已采用；请返回工作台保存')).toBeVisible();
  await workshop.getByRole('button', { name: '返回正式路线', exact: true }).click();
  await page.getByRole('button', { name: '保存工作台', exact: true }).click();
  await expect(page.locator('.sg-workspace .sg-status')).toHaveText('已保存到当前浏览器');
  await page.reload();
  await openGuide(page);
  await page.getByRole('button', { name: '打开剧情工作台', exact: true }).click();
  await page.getByRole('button', { name: 'AI 剧情工坊', exact: true }).click();
  await expect(
    page.locator('.sg-route-workshop').getByRole('textbox', { name: '候选名称' }).first(),
  ).toHaveValue('人工修订结局');
});

test('手机工坊取消旧请求后不载入草稿，失败明确展示且无横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.evaluate(() => {
    const ctx = window.SillyTavern?.getContext();
    if (ctx)
      ctx.generateRaw = async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        ctx.onlineStatus = 'finished';
        return '{}';
      };
  });
  await openGuide(page);
  await page.getByRole('button', { name: '打开剧情工作台', exact: true }).click();
  await page.getByRole('button', { name: 'AI 剧情工坊', exact: true }).click();
  const workshop = page.locator('.sg-route-workshop');
  await workshop.getByRole('checkbox', { name: '角色卡 / 人物描述', exact: true }).check();
  await workshop.getByRole('button', { name: '生成路线草稿', exact: true }).click();
  await workshop.getByRole('button', { name: '取消生成', exact: true }).click();
  await expect(workshop.locator('[role=status]')).toContainText('取消');
  await expect(workshop.locator('.sg-route-workshop-item')).toHaveCount(0);
  await expect(workshop.getByRole('button', { name: '生成路线草稿', exact: true })).toBeEnabled();
  await expect
    .poll(() => page.evaluate(() => window.SillyTavern?.getContext().onlineStatus))
    .toBe('finished');
  await workshop.getByRole('button', { name: '生成路线草稿', exact: true }).click();
  await expect(workshop.locator('[role=status]')).toContainText('Required');
  for (const width of [360, 390, 430, 844]) {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
