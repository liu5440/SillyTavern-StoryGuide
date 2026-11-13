// 仅在独立酒馆测试数据根执行。要求预先运行 smoke-tavern.mjs 创建测试角色；不调用模型。
import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
try {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage({ viewport: { width: 1280, height: 900 } });
  // 独立数据根首次访问可能弹出宿主用户名引导，仅为测试账号设置名称。
  await page.addLocatorHandler(page.locator('dialog.popup[open]:has(.onboarding)'), async (dialog) => {
    await dialog.locator('.popup-input').fill('测试玩家');
    await dialog.locator('.popup-button-ok').evaluate((button) => button.click());
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.TAVERN_TEST_URL || 'http://127.0.0.1:8001');
  await page.locator('#story-guide-settings').waitFor({ state: 'attached', timeout: 60000 });
  const selectTestCharacter = async () =>
    page.evaluate(async () => {
      await window.SillyTavern.getContext().getCharacters();
      const context = window.SillyTavern.getContext();
      const index = context.characters.findIndex((character) => character.name === '剧情指南测试角色');
      if (index < 0) throw new Error('请先运行真实宿主 smoke-tavern 测试创建测试角色');
      await context.selectCharacterById(index);
    });
  const open = async () => {
    await page.locator('#story-guide-settings').waitFor({ state: 'attached', timeout: 60000 });
    await selectTestCharacter();
    await page.locator('#story-guide-settings button').evaluate((button) => button.click());
    await expect(page.locator('.sg-status')).toContainText('条资料已读取');
    await page.getByRole('button', { name: '场景素材库', exact: true }).click();
    await expect(page.locator('.sg-material-card').first()).toBeVisible();
  };
  await open();
  await page.getByLabel('素材分类', { exact: true }).selectOption('outfit');
  await page.getByLabel('搜索素材', { exact: true }).fill('缎面');
  await expect(page.locator('.sg-material-card')).toHaveCount(1);
  const favorite = page.getByRole('button', { name: '收藏', exact: true });
  if (await favorite.count()) await favorite.click();
  await expect(page.getByRole('button', { name: '取消收藏', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '复制素材' }).click();
  await expect(page.locator('.sg-material-status')).toContainText('已复制');
  if (!(await page.evaluate(() => navigator.clipboard.readText())).includes('缎面'))
    throw new Error('复制文本不匹配');
  await page.getByRole('button', { name: '整理粘贴的对话' }).click();
  await page.getByLabel('对话原文').fill('成年旧友在书店重逢，一起讨论喜欢的书。');
  await page.getByLabel('对话原文').evaluate((input) => input.setSelectionRange(0, input.value.length));
  await page.getByRole('button', { name: '使用选中片段' }).click();
  const name = `真实宿主素材测试-${Date.now()}`;
  await page.getByLabel('素材标题').fill(name);
  await page.getByLabel('素材描述（用户改编）').fill('两位成年旧友相约聊书。');
  await page.getByLabel('剧情开场（用户改编）').fill('要不要去旁边的咖啡店坐坐？');
  await page.getByRole('button', { name: '预览素材' }).click();
  await page.getByRole('button', { name: '保存到个人素材' }).click();
  await expect(page.locator('.sg-material-status')).toContainText('已保存');
  await page.reload();
  await open();
  await page.getByLabel('搜索素材', { exact: true }).fill(name);
  await expect(page.locator('.sg-material-card')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page
    .locator('.sg-material-library')
    .evaluate((node) => node.scrollWidth > node.clientWidth + 1);
  if (overflow) throw new Error('素材库窄屏横向溢出');
  await page.screenshot({ path: '.local/material-library-smoke.png' });
  console.log(
    JSON.stringify({
      host: 'SillyTavern',
      savedAndReloaded: true,
      clipboard: true,
      narrowScreen: true,
      pageErrors: errors,
    }),
  );
  if (errors.length) throw new Error('宿主页面存在未捕获异常');
} finally {
  await browser.close();
}
