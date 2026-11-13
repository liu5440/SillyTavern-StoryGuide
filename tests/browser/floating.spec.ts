import { test, expect } from '@playwright/test';

test('悬浮手册不锁聊天，收起恢复保留草稿，支持大窗口和窄屏', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/');
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.evaluate(() => {
    const c = window.SillyTavern?.getContext();
    const character = c?.characters[0];
    if (character && typeof character === 'object')
      Object.assign(character, {
        description:
          '姓名：艾琳\n身份：旧城档案员\n\n艾琳负责整理钟楼街的旧档案。她习惯将每条线索标记日期，再按人物和地点归档；遇到没有证据的传闻，她会另写一张待核对便签。\n\n旧城的图书馆每周三闭馆。她通常利用这段时间去码头访问船员，询问旧信件的去向。想和她展开调查，可以先从寄信人的笔迹谈起，或者一起查阅馆内的航运记录。\n\n人物关系：白榆是熟悉港口的向导，两人曾共同整理过一批遇水损坏的地图。青岚负责修复钟楼，会向她提供近期的维修记录。资料没有规定三人的固定路线或结局。',
      });
    const input = document.createElement('textarea');
    input.id = 'send_textarea';
    input.setAttribute('aria-label', '酒馆聊天输入');
    input.style.cssText = 'position:fixed;left:10px;bottom:10px;width:200px;height:50px;';
    document.body.append(input);
  });
  await page.locator('#story-guide-settings summary').click();
  await page.getByRole('button', { name: '打开剧情指南', exact: true }).click();
  await expect(page.locator('.sg-sidebar')).toBeHidden();
  await expect(page.locator('.sg-panel')).toHaveJSProperty('open', true);
  await page.getByRole('textbox', { name: '酒馆聊天输入' }).fill('边阅读边输入');
  await expect(page.getByRole('textbox', { name: '酒馆聊天输入' })).toBeFocused();
  await page.getByRole('button', { name: '资料设置', exact: true }).click();
  await page.getByRole('button', { name: '建立本地资料目录（无需AI）' }).click();
  await page.getByRole('button', { name: '资料设置', exact: true }).click();
  await page.getByRole('button', { name: '收起', exact: true }).click();
  await expect(page.locator('.sg-panel')).toBeHidden();
  await page.getByRole('textbox', { name: '酒馆聊天输入' }).fill('继续聊天');
  await page.locator('.sg-guide-bubble').click();
  await expect(page.locator('.sg-panel')).toBeVisible();
  await page.getByText('故事操作', { exact: true }).click();
  await expect(page.getByRole('button', { name: '保存草稿版本', exact: true })).toBeVisible();
  await page.getByText('故事操作', { exact: true }).click();
  await page.locator('.sg-phone-tools > summary').click();
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await expect(page.locator('.sg-panel')).toHaveClass(/sg-expanded/);
  await page.getByRole('button', { name: '悬浮阅读', exact: true }).click();
  await page.locator('.sg-phone-tools > summary').click();
  const phone = await page.locator('.sg-panel').boundingBox();
  if (!phone) throw new Error('缺少手机窗口');
  expect(phone.height / phone.width).toBeGreaterThan(1.8);
  await page.getByRole('combobox', { name: '选择查看的人物' }).selectOption('character:艾琳');
  await expect(page.locator('.sg-event-row')).toContainText('旧城档案员');
  await page.screenshot({ path: 'test-results/floating-guide-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = await page.locator('.sg-panel').boundingBox();
  const chat = await page.getByRole('textbox', { name: '酒馆聊天输入' }).boundingBox();
  if (!panel || !chat) throw new Error('缺少布局尺寸');
  expect(panel.y + panel.height).toBeLessThan(chat.y);
  expect(panel.height / panel.width).toBeGreaterThan(1.8);
  const size = await page
    .locator('.sg-panel')
    .evaluate((node) => ({ client: node.clientWidth, scroll: node.scrollWidth }));
  expect(size.scroll).toBeLessThanOrEqual(size.client + 2);
  await page.getByRole('textbox', { name: '酒馆聊天输入' }).fill('窄屏仍能聊天');
  await page.screenshot({ path: 'test-results/floating-guide-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 640, height: 400 });
  await page.locator('.sg-phone-tools > summary').click();
  const menu = await page.locator('.sg-phone-tool-items').boundingBox();
  const compact = await page.locator('.sg-panel').boundingBox();
  if (!menu || !compact) throw new Error('缺少低高度菜单尺寸');
  expect(menu.y).toBeGreaterThanOrEqual(compact.y);
  expect(menu.y + menu.height).toBeLessThanOrEqual(compact.y + compact.height);
  await expect(page.getByRole('button', { name: '放大', exact: true })).toBeVisible();
});
