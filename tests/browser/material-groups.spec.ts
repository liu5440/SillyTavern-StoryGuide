import { test, expect } from '@playwright/test';
import { openGuide } from './helpers';

test('同文资料折叠保留出处，批量分类保存刷新且手机可用', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const configure = () =>
    page.evaluate(() => {
      const w = window as unknown as { testContext: Record<string, unknown> };
      w.testContext.characters = [
        {
          avatar: 'groups.png',
          name: '分组测试',
          data: {
            extensions: { world: '外部书' },
            character_book: { entries: [{ id: 1, content: '同一段城市背景。', comment: '城市背景' }] },
          },
        },
      ];
      w.testContext.loadWorldInfo = async () => ({
        entries: {
          1: { uid: 1, content: '同一段城市背景。', comment: '城市背景' },
        },
      });
    });
  await configure();
  await openGuide(page);
  await page.getByRole('button', { name: '打开剧情工作台', exact: true }).click();
  const workspace = page.locator('.sg-workspace');
  await workspace.getByRole('button', { name: '资料', exact: true }).click();
  await expect(workspace.locator('.sg-material-group')).toHaveCount(1);
  await expect(workspace.getByText('2 条原始资料，显示为 1 组')).toBeVisible();
  await workspace.getByText('全部出处（2）', { exact: true }).click();
  await expect(workspace.getByRole('button', { name: '外部书 / 城市背景', exact: true })).toBeVisible();
  await workspace.getByRole('checkbox', { name: '选择资料：内嵌世界书 / 城市背景' }).check();
  await expect(workspace.getByText('已选择 2 条原始资料；同文组包含全部出处')).toBeVisible();
  await workspace.getByLabel('搜索资料和事件').fill('不存在的标题');
  await expect(workspace.getByText('已选择 0 条原始资料；同文组包含全部出处')).toBeVisible();
  await workspace.getByLabel('搜索资料和事件').fill('外部书');
  await workspace.getByLabel('批量资料分类').selectOption('world');
  await workspace.getByRole('button', { name: '全选当前结果', exact: true }).click();
  await expect(workspace.getByLabel('批量资料分类')).toHaveValue('world');
  await workspace.getByRole('button', { name: '应用批量分类', exact: true }).click();
  await expect(workspace.locator('.sg-status')).toContainText('已分类 2 条资料');
  await expect(workspace.locator('.sg-material-group')).toHaveCount(1);
  await workspace.getByRole('button', { name: '保存工作台', exact: true }).click();
  await expect(workspace.locator('.sg-status')).toHaveText('已保存到当前浏览器');
  await page.reload();
  await configure();
  await openGuide(page);
  await page.getByRole('button', { name: '打开剧情工作台', exact: true }).click();
  await workspace.getByRole('button', { name: '资料', exact: true }).click();
  const category = workspace
    .locator('.sg-workspace-library > details')
    .filter({ has: page.locator('summary', { hasText: /^世界背景/ }) });
  await expect(category.locator('.sg-material-group')).toHaveCount(1);
  expect(await workspace.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(
    await workspace.locator('.sg-workspace-library').evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
});
