import { test, expect } from '@playwright/test';
import { openGuide } from './helpers';

const result = {
  materials: [
    {
      title: '书店的热茶',
      category: 'scene',
      tags: ['温柔'],
      description: '两位成年旧友在书店共饮热茶。',
      opening: '要不要一起翻翻这本书？',
      messageNumber: 3,
      quote: '她递来一杯热茶。',
    },
  ],
};
async function prepare(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.evaluate((output) => {
    const c = window.SillyTavern?.getContext();
    if (!c) throw new Error('缺少测试宿主');
    c.chat = [
      { mes: '不选择的玩家消息', is_user: true, name: '玩家' },
      { mes: '系统秘密', is_system: true },
      {
        mes: '两位成年旧友在书店重逢。她递来一杯热茶。<img src=x onerror=alert(1)>',
        is_user: false,
        name: '艾琳',
      },
    ];
    c.generateRaw = async (options) => {
      (window as unknown as { testPrompt: string }).testPrompt = options.prompt;
      return JSON.stringify(output);
    };
  }, result);
  await openGuide(page);
  await expect(page.locator('.sg-status')).toContainText('条资料已读取');
  await page.getByRole('button', { name: '场景素材库', exact: true }).click();
  await page.getByRole('button', { name: '从当前聊天整理' }).click();
  await page.getByRole('button', { name: '预览当前范围' }).click();
}

test('所选聊天由当前模型整理，预览编辑后保存并回看消息来源', async ({ page }) => {
  await prepare(page);
  await expect(page.locator('.sg-chat-message')).toHaveCount(2);
  await expect(page.locator('.sg-chat-message img')).toHaveCount(0);
  await page.getByLabel('选择第1条 · 玩家').uncheck();
  await page.getByRole('button', { name: '用当前模型整理' }).click();
  await expect(page.locator('.sg-chat-draft')).toHaveCount(1);
  const prompt = await page.evaluate(() => (window as unknown as { testPrompt: string }).testPrompt);
  expect(prompt).toContain('她递来一杯热茶');
  expect(prompt).not.toContain('不选择的玩家消息');
  expect(prompt).not.toContain('系统秘密');
  await page.getByLabel('草稿标题1').fill('编辑后的热茶场景');
  await page.getByRole('button', { name: '保存选中素材' }).click();
  await expect(page.locator('.sg-material-status')).toContainText('已保存');
  await page.getByLabel('只看个人素材').check();
  await expect(page.locator('.sg-material-card')).toHaveCount(1);
  await expect(page.locator('.sg-material-card')).toContainText('AI归纳');
  await expect(page.locator('.sg-material-card')).toContainText('编辑后的热茶场景');
  await page.getByRole('button', { name: '查看来源' }).click();
  await expect(page.locator('.sg-modal').last()).toContainText('第3条');
  await expect(page.locator('.sg-modal').last()).toContainText('她递来一杯热茶。');
});

test('取消在途请求、消息修改与非JSON不会产生可保存素材', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    const c = window.SillyTavern?.getContext();
    if (!c) throw new Error('缺少宿主');
    c.generateRaw = () =>
      new Promise((resolve) => {
        (window as unknown as { finishMaterial: (text: string) => void }).finishMaterial = resolve;
      });
  });
  await page.getByRole('button', { name: '用当前模型整理' }).click();
  await expect(page.locator('.sg-chat-material-status')).toContainText('正在');
  await page.getByRole('button', { name: '取消整理' }).click();
  await page.evaluate(
    (output) =>
      (window as unknown as { finishMaterial: (text: string) => void }).finishMaterial(
        JSON.stringify(output),
      ),
    result,
  );
  await expect(page.locator('.sg-chat-draft')).toHaveCount(0);
  await expect(page.locator('.sg-chat-material-status')).toContainText('取消');
  await page.evaluate(() => {
    const c = window.SillyTavern?.getContext();
    if (c) c.generateRaw = async () => 'not json';
  });
  await page.getByRole('button', { name: '用当前模型整理' }).click();
  await expect(page.locator('.sg-chat-material-status')).toContainText('JSON');
  await page.evaluate(() => {
    const c = window.SillyTavern?.getContext();
    if (c?.chat?.[2]) c.chat[2].mes = '消息已修改';
    (window as unknown as { testEdit: () => void }).testEdit();
  });
  await expect(page.locator('.sg-chat-material-status')).toContainText('变化');
  await expect(page.getByRole('button', { name: '用当前模型整理' })).toBeDisabled();
});
