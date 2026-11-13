// 只对独立测试数据根运行。不会读取模型密钥或向模型发出请求。
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const base = process.env.TAVERN_TEST_URL || 'http://127.0.0.1:8001';
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  await page.locator('#story-guide-settings').waitFor({ state: 'attached', timeout: 60000 });
  const welcome = page.locator('.popup').filter({ hasText: '用户设定名称' });
  if (await welcome.count()) {
    const input = welcome.locator('input[type=text]');
    if (await input.count()) await input.fill('测试玩家');
    await welcome.locator('.popup-button-ok').click();
  }
  const result = await page.evaluate(async () => {
    const context = window.SillyTavern.getContext();
    const token = (await (await fetch('/csrf-token')).json()).token;
    const world = await fetch('/api/worldinfo/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify({
        name: '剧情指南测试世界',
        data: {
          entries: {
            0: {
              uid: 0,
              comment: '钟楼街事件',
              content: '第二天傍晚，钟楼街出现一封没有署名的信。',
              key: ['钟楼街'],
              disable: false,
            },
          },
        },
      }),
    });
    if (!world.ok) throw new Error('测试世界书创建失败');
    const form = new FormData();
    form.set('ch_name', '剧情指南测试角色');
    form.set('description', '住在钟楼街的调查员，正在寻找一封旧信。');
    form.set('first_mes', '你也收到那封信了吗？');
    form.set('world', '剧情指南测试世界');
    const created = await fetch('/api/characters/create', {
      method: 'POST',
      headers: { 'X-CSRF-Token': token },
      body: form,
    });
    if (!created.ok) throw new Error(`测试角色创建失败：${created.status}`);
    const avatar = await created.text();
    await context.getCharacters();
    const next = window.SillyTavern.getContext();
    const index = next.characters.findIndex((c) => c.avatar === avatar);
    if (index < 0) throw new Error('测试角色没有加载');
    await next.selectCharacterById(index);
    return { avatar, name: next.characters[index].name };
  });
  // 只在测试页中打开扩展，不操作原用户浏览器。
  await page.locator('#story-guide-settings button').evaluate((button) => button.click());
  await page.getByRole('heading', { name: `${result.name}的剧情指南` }).waitFor();
  await page.locator('.sg-status').filter({ hasText: '条资料已读取' }).waitFor();
  await mkdir('.local', { recursive: true });
  await page.screenshot({ path: '.local/tavern-smoke.png', fullPage: true });
  console.log(
    JSON.stringify({ result, status: await page.locator('.sg-status').innerText(), pageErrors: errors }),
  );
} finally {
  await browser.close();
}
