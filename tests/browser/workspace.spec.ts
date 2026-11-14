import { test, expect } from '@playwright/test';
import { openGuide } from './helpers';

test('工作台资料不变事件，人工路线保存并刷新恢复', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await page.goto('/');
  await openGuide(page);
  await page.getByRole('button', { name: '打开剧情工作台', exact: true }).click();
  const workspace = page.locator('.sg-workspace');
  await expect(workspace.getByText('尚无剧情事件')).toBeVisible();
  await workspace.getByRole('button', { name: '新建事件', exact: true }).click();
  await workspace.getByRole('textbox', { name: '事件名称', exact: true }).fill('钟楼会面');
  await workspace.getByRole('textbox', { name: '剧情简介', exact: true }).fill('两人在钟楼会面。');
  await workspace.getByRole('button', { name: '应用事件', exact: true }).click();
  await workspace.getByRole('button', { name: '新建事件', exact: true }).click();
  await workspace.getByRole('textbox', { name: '事件名称', exact: true }).fill('归还信件');
  await workspace.getByRole('button', { name: '应用事件', exact: true }).click();
  await workspace.getByRole('button', { name: '建立连接', exact: true }).click();
  await workspace.getByLabel('来源事件').selectOption({ label: '钟楼会面' });
  await workspace.getByLabel('目标事件').selectOption({ label: '归还信件' });
  await workspace.getByRole('textbox', { name: '触发条件', exact: true }).fill('选择交还信件');
  await workspace.getByRole('button', { name: '应用连接', exact: true }).click();
  await workspace.getByRole('button', { name: '保存工作台', exact: true }).click();
  await expect(workspace.getByText('已保存到当前浏览器', { exact: true })).toBeVisible();
  await page.reload();
  await openGuide(page);
  await page.getByRole('button', { name: '打开剧情工作台', exact: true }).click();
  await expect(
    page.locator('.sg-workspace').getByText('选择交还信件', { exact: true }).first(),
  ).toBeVisible();
});

test('手机工作台通过单栏表单建立事件且没有页面横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await openGuide(page);
  await page.getByRole('button', { name: '打开剧情工作台', exact: true }).click();
  const workspace = page.locator('.sg-workspace');
  await workspace.getByRole('button', { name: '资料', exact: true }).click();
  await workspace.getByRole('button', { name: '新建事件', exact: true }).click();
  await workspace.getByRole('textbox', { name: '事件名称', exact: true }).fill('手机事件');
  await workspace.getByRole('button', { name: '应用事件', exact: true }).click();
  await workspace.getByRole('button', { name: '路线', exact: true }).click();
  await expect(workspace.getByText('手机事件', { exact: true }).first()).toBeVisible();
  await workspace.getByRole('button', { name: '资料', exact: true }).click();
  await workspace.getByRole('button', { name: '新建事件', exact: true }).click();
  await workspace.getByRole('textbox', { name: '事件名称', exact: true }).fill('手机结局');
  await workspace.getByRole('button', { name: '应用事件', exact: true }).click();
  await workspace.getByRole('button', { name: '路线', exact: true }).click();
  await workspace.getByRole('button', { name: '建立连接', exact: true }).click();
  await workspace.getByLabel('来源事件').selectOption({ label: '手机事件' });
  await workspace.getByLabel('目标事件').selectOption({ label: '手机结局' });
  await workspace.getByRole('textbox', { name: '触发条件', exact: true }).fill('选择一起出发');
  await workspace.getByRole('button', { name: '应用连接', exact: true }).click();
  await workspace.getByRole('button', { name: '保存工作台', exact: true }).click();
  await expect(workspace.locator('.sg-status')).toHaveText('已保存到当前浏览器');
  await workspace.getByRole('button', { name: '路线', exact: true }).click();
  await workspace.getByRole('button', { name: '正式阅读（仅已确认）', exact: true }).click();
  for (const width of [360, 390, 430, 844]) {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 844 });
    await expect(workspace.getByText('选择一起出发', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('详情未应用不能误报保存成功，正式阅读可收起并恢复', async ({ page }) => {
  await page.goto('/');
  await openGuide(page);
  await page.getByRole('button', { name: '打开剧情工作台', exact: true }).click();
  const workspace = page.locator('.sg-workspace');
  await workspace.getByRole('button', { name: '新建事件', exact: true }).click();
  await workspace.getByRole('textbox', { name: '事件名称', exact: true }).fill('待应用事件');
  await workspace.getByRole('button', { name: '保存工作台', exact: true }).click();
  await expect(workspace.locator('.sg-status')).toContainText('详情表单尚未应用');
  await workspace.getByRole('button', { name: '应用事件', exact: true }).click();
  await workspace.getByRole('button', { name: '保存工作台', exact: true }).click();
  await expect(workspace.locator('.sg-status')).toHaveText('已保存到当前浏览器');
  await workspace.getByRole('button', { name: '正式阅读（仅已确认）', exact: true }).click();
  await expect(workspace).toHaveClass(/sg-workspace-reading-mode/);
  // 真实酒馆html有transform且内容主要固定定位，不能按零高包含块bottom定位恢复按钮。
  await page.addStyleTag({ content: 'html { transform: translateZ(0); height: 0; } body { height: 0; }' });
  await workspace.getByRole('button', { name: '收起工作台', exact: true }).click();
  await expect(workspace).toBeHidden();
  const bubbleBounds = await page.getByRole('button', { name: '恢复剧情工作台', exact: true }).boundingBox();
  expect(bubbleBounds?.y).toBeGreaterThanOrEqual(0);
  await page.getByRole('button', { name: '恢复剧情工作台', exact: true }).click();
  await expect(workspace.getByText('待应用事件', { exact: true }).first()).toBeVisible();
});

test('拖事件加入路线不复制，拖连接端口只打开人工连接表单', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await page.goto('/');
  await openGuide(page);
  await page.getByRole('button', { name: '打开剧情工作台', exact: true }).click();
  const workspace = page.locator('.sg-workspace');
  for (const title of ['事件甲', '事件乙']) {
    await workspace.getByRole('button', { name: '新建事件', exact: true }).click();
    await workspace.getByRole('textbox', { name: '事件名称', exact: true }).fill(title);
    await workspace.getByRole('button', { name: '应用事件', exact: true }).click();
  }
  await workspace.getByRole('button', { name: '从当前路线移除', exact: true }).click();
  await expect(workspace.locator('.sg-graph-node')).toHaveCount(1);
  const item = workspace.locator('.sg-workspace-event').filter({ hasText: '事件乙' });
  await item.dragTo(workspace.locator('.sg-graph-viewport'));
  await expect(workspace.locator('.sg-graph-node')).toHaveCount(2);
  await expect(workspace.locator('.sg-workspace-event')).toHaveCount(2);
  const first = workspace.locator('.sg-graph-node').filter({ hasText: '事件甲' });
  const second = workspace.locator('.sg-graph-node').filter({ hasText: '事件乙' });
  await expect(first).toContainText('人工编辑 · 已确认');
  await first.locator('.sg-workspace-port').dragTo(second);
  await expect(workspace.getByLabel('来源事件')).toHaveValue(
    (await workspace
      .getByLabel('来源事件')
      .locator('option')
      .filter({ hasText: '事件甲' })
      .getAttribute('value')) as string,
  );
  await expect(workspace.locator('.sg-lines g')).toHaveCount(0);
  await workspace.getByRole('button', { name: '应用连接', exact: true }).click();
  await expect(workspace.locator('.sg-lines g')).toHaveCount(1);
});

test('JSON预览采用后可保存，未确认AI事件不进入正式图；重导入保留人工内容', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await page.goto('/');
  await openGuide(page);
  await page.getByRole('button', { name: '打开剧情工作台', exact: true }).click();
  const workspace = page.locator('.sg-workspace');
  await workspace.getByRole('button', { name: '新建事件', exact: true }).click();
  await workspace.getByRole('textbox', { name: '事件名称', exact: true }).fill('人工保留');
  await workspace.getByRole('button', { name: '应用事件', exact: true }).click();
  await workspace.getByRole('button', { name: '保存工作台', exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await workspace.getByRole('button', { name: '导出 JSON', exact: true }).click();
  const download = await downloaded;
  const { readFile } = await import('node:fs/promises');
  const library = JSON.parse(await readFile(await download.path(), 'utf8'));
  const pending = {
    ...library.events[0],
    id: 'event:pending',
    title: 'AI待确认',
    origin: 'ai_generated',
    status: 'pending',
  };
  library.events.push(pending);
  library.routes[0].eventIds.push(pending.id);
  const chooser = page.waitForEvent('filechooser');
  await workspace.getByRole('button', { name: '导入 JSON', exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: 'library.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(library)),
  });
  await expect(workspace.getByRole('heading', { name: '导入差异预览', exact: true })).toBeVisible();
  await workspace.getByRole('button', { name: '确认载入草稿', exact: true }).click();
  await workspace.getByRole('button', { name: '保存工作台', exact: true }).click();
  await expect(workspace.locator('.sg-status')).toHaveText('已保存到当前浏览器');
  await workspace.getByRole('button', { name: '正式阅读（仅已确认）', exact: true }).click();
  await expect(workspace.locator('.sg-graph-node').filter({ hasText: 'AI待确认' })).toHaveCount(0);
  await expect(workspace.locator('.sg-graph-node').filter({ hasText: '人工保留' })).toHaveCount(1);
  await page.evaluate(() => {
    const c = window.SillyTavern?.getContext();
    const character = c?.characters[0];
    if (character && typeof character === 'object')
      Object.assign(character, { description: '新的世界背景。' });
  });
  await workspace.getByRole('button', { name: '重导入当前资料', exact: true }).click();
  await workspace.getByRole('button', { name: '确认载入草稿', exact: true }).click();
  await expect(workspace.locator('.sg-graph-node').filter({ hasText: '人工保留' })).toHaveCount(1);
  await workspace.getByRole('button', { name: '保存工作台', exact: true }).click();
  await expect(workspace.locator('.sg-status')).toHaveText('已保存到当前浏览器');
});
