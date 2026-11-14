// 仅对独立测试数据根运行，不操作用户游玩窗口，不调用模型。
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const base = process.env.TAVERN_TEST_URL || 'http://127.0.0.1:8001';
if (new URL(base).port !== '8001') throw new Error('本脚本仅允许独立测试端口8001');
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => void dialog.accept());
  await page.addLocatorHandler(page.locator('dialog.popup[open]:has(.onboarding)'), async (dialog) => {
    await dialog.locator('.popup-input').fill('测试玩家');
    await dialog.locator('.popup-button-ok').evaluate((button) => button.click());
  });
  async function selectCharacter() {
    await page.evaluate(async () => {
      await window.SillyTavern.getContext().getCharacters();
      const context = window.SillyTavern.getContext();
      const index = context.characters.findIndex((character) => character.name === '剧情指南测试角色');
      if (index < 0) throw new Error('独立测试角色不存在，请先运行smoke-tavern.mjs');
      await context.selectCharacterById(index);
    });
  }
  async function openWorkspace() {
    const settings = page.locator('#story-guide-settings');
    await settings.locator('summary').evaluate((node) => {
      node.parentElement.open = true;
    });
    await settings.locator('button').evaluate((node) => node.click());
    try {
      await expect(page.locator('.sg-panel > header h2')).toContainText('剧情指南测试角色的剧情指南');
    } catch (error) {
      console.error(await page.locator('.sg-panel').innerText());
      throw error;
    }
    await page.locator('.sg-phone-tools > summary').click();
    await page.getByRole('button', { name: '打开剧情工作台', exact: true }).click();
    return page.locator('.sg-workspace');
  }
  await page.goto(base);
  await page.locator('#story-guide-settings').waitFor({ state: 'attached', timeout: 60000 });
  await selectCharacter();
  const workspace = await openWorkspace();
  for (const title of ['P0宿主会面', 'P0宿主选择']) {
    await workspace.getByRole('button', { name: '新建事件', exact: true }).click();
    await workspace.getByRole('textbox', { name: '事件名称', exact: true }).fill(title);
    await workspace.getByRole('button', { name: '应用事件', exact: true }).click();
  }
  await workspace.getByRole('button', { name: '建立连接', exact: true }).click();
  await workspace.getByLabel('来源事件').selectOption({ label: 'P0宿主会面' });
  await workspace.getByLabel('目标事件').selectOption({ label: 'P0宿主选择' });
  await workspace.getByRole('textbox', { name: '触发条件', exact: true }).fill('玩家手动选择继续调查');
  await workspace.getByRole('button', { name: '应用连接', exact: true }).click();
  if (process.env.P1_SMOKE === '1') {
    await workspace.getByRole('button', { name: '管理当前路线', exact: true }).click();
    await workspace.getByLabel('路线名称', { exact: true }).fill('宿主个人路线');
    await workspace.getByLabel('路线类型').selectOption('character');
    await workspace.getByLabel('路线人物（逗号分隔）').fill('测试人物');
    await workspace.getByRole('button', { name: '应用路线设置', exact: true }).click();
    await workspace.getByRole('button', { name: 'AI 剧情工坊', exact: true }).click();
    const workshop = page.locator('.sg-route-workshop');
    await expect(workshop.getByLabel('生成模式').locator('option')).toHaveCount(3);
    await expect(workshop.getByRole('button', { name: '生成路线草稿', exact: true })).toBeVisible();
    await workshop.getByRole('button', { name: '返回正式路线', exact: true }).click();
  }
  if (process.env.TRIAGE_SMOKE === '1') {
    await workspace.getByRole('button', { name: '全选当前结果', exact: true }).click();
    await workspace.getByLabel('批量资料分类').selectOption('world');
    await workspace.getByRole('button', { name: '应用批量分类', exact: true }).click();
    await expect(workspace.locator('.sg-status')).toContainText('已分类');
  }
  await workspace.getByRole('button', { name: '保存工作台', exact: true }).click();
  await expect(workspace.locator('.sg-status')).toHaveText('已保存到当前浏览器');
  await mkdir('.local', { recursive: true });
  await page.screenshot({ path: '.local/p0-workspace-desktop.png' });
  await page.reload();
  await page.locator('#story-guide-settings').waitFor({ state: 'attached', timeout: 60000 });
  await selectCharacter();
  const reading = await openWorkspace();
  await expect(reading).toHaveClass(/sg-workspace-reading-mode/);
  await expect(reading).toContainText('玩家手动选择继续调查');
  if (process.env.TRIAGE_SMOKE === '1') {
    const world = reading
      .locator('.sg-workspace-library > details')
      .filter({ has: page.locator('summary', { hasText: /^世界背景/ }) });
    if (!(await world.locator('.sg-material-group').count())) throw new Error('批量分类刷新未恢复');
  }

  if (process.env.P1_SMOKE === '1') await expect(reading).toContainText('人物个人线 · 测试人物');
  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await reading.getByRole('button', { name: '路线', exact: true }).click();
    await expect(reading.locator('.sg-workspace-route')).toBeVisible();
    const overflows = await reading.evaluate((node) => node.scrollWidth > node.clientWidth);
    if (overflows) throw new Error(`手机${width}px工作台横向溢出`);
  }
  await page.screenshot({ path: '.local/p0-workspace-mobile.png' });
  await reading.getByRole('button', { name: '收起工作台', exact: true }).click();
  await expect(reading).toBeHidden();
  const restore = page.getByRole('button', { name: '恢复剧情工作台', exact: true });
  try {
    await restore.click({ timeout: 5000 });
  } catch (error) {
    console.log(
      JSON.stringify(
        await restore.evaluate((node) => {
          const style = getComputedStyle(node);
          return {
            rect: node.getBoundingClientRect().toJSON(),
            position: style.position,
            top: style.top,
            bottom: style.bottom,
            left: style.left,
            right: style.right,
            transform: style.transform,
          };
        }),
      ),
    );
    await page.screenshot({ path: '.local/p0-workspace-restore-failure.png' });
    throw error;
  }
  await expect(reading).toBeVisible();
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      host: 'SillyTavern 1.19.0',
      result:
        process.env.P1_SMOKE === '1'
          ? 'route-metadata-workshop-entry-save-reload-mobile passed'
          : 'manual-route-save-reload-mobile passed',
      pageErrors: errors,
      modelCalls: 0,
      materialClassification: process.env.TRIAGE_SMOKE === '1' ? 'save-reload passed' : 'not tested',
    }),
  );
} finally {
  await browser.close();
}
