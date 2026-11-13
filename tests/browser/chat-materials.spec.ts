import { test, expect } from '@playwright/test';
import { openGuide } from './helpers';
import { readFile } from 'node:fs/promises';

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
  await expect(page.locator('.sg-chat-material-status')).toContainText('已刷新第1次预览');
}

test('打开即预览且不调用模型，等待有秒数，窗口内可看日志并取消', async ({ page }) => {
  await prepare(page);
  await expect(page.getByRole('button', { name: '用当前模型整理' })).toBeEnabled();
  expect(
    await page.evaluate(() => (window as unknown as { testPrompt?: string }).testPrompt),
  ).toBeUndefined();
  await page.evaluate(() => {
    const c = window.SillyTavern?.getContext();
    if (!c) throw new Error('缺少测试宿主');
    c.generateRaw = async () => new Promise<string>(() => {});
  });
  await page.getByRole('button', { name: '用当前模型整理' }).click();
  await expect(page.locator('.sg-chat-material-status')).toContainText('已等待 1 秒');
  await page.locator('.sg-chat-materials').getByRole('button', { name: '排查日志', exact: true }).click();
  const logs = page.locator('.sg-modal').last();
  await expect(logs.locator('pre')).toContainText('inputChars');
  await logs.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '取消整理', exact: true }).click();
  await expect(page.getByRole('button', { name: '用当前模型整理' })).toBeEnabled();
});

test('默认只导出AI回复，切换全部对话后包含玩家，切回后排除', async ({ page }) => {
  await prepare(page);
  const scope = page.getByRole('combobox', { name: '整理消息来源' });
  await expect(scope).toHaveValue('assistant');
  await expect(page.locator('.sg-chat-selection')).toContainText('选中1条');
  await scope.selectOption('all');
  await expect(page.getByLabel('选择第1条 · 玩家')).toBeChecked();
  await expect(page.locator('.sg-chat-selection')).toContainText('选中2条');
  await scope.selectOption('assistant');
  await expect(page.getByLabel('选择第1条 · 玩家')).toHaveCount(0);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出所选聊天JSON' }).click();
  const path = await (await pending).path();
  if (!path) throw new Error('缺少导出文件');
  const data = JSON.parse(await readFile(path, 'utf8')) as { messages: { number: number; role: string }[] };
  expect(data.messages.map((message) => message.number)).toEqual([3]);
  expect(data.messages[0]?.role).toBe('character');
});

test('所选聊天由当前模型整理，预览编辑后保存并回看消息来源', async ({ page }) => {
  await prepare(page);
  await expect(page.locator('.sg-chat-message')).toHaveCount(1);
  await expect(page.locator('.sg-chat-message img')).toHaveCount(0);
  await expect(page.getByLabel('选择第1条 · 玩家')).toHaveCount(0);
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

test('50条长消息自动分批，原文与结果归档后可导出', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const c = window.SillyTavern?.getContext();
    if (!c) throw new Error('缺宿主');
    c.chat = Array.from({ length: 50 }, (_, i) => ({
      mes: `第${i + 1}段成年朋友日常。` + '日常'.repeat(1500),
      name: '成年朋友',
      is_user: false,
    }));
    (window as unknown as { batchCalls: number }).batchCalls = 0;
    c.generateRaw = async (options) => {
      (window as unknown as { batchCalls: number }).batchCalls++;
      const data = JSON.parse(options.prompt.slice(options.prompt.lastIndexOf('\n[') + 1)) as {
        number: number;
        text: string;
      }[];
      return JSON.stringify({
        materials: [
          {
            title: `日常${data[0]!.number}`,
            category: 'scene',
            tags: [],
            description: '成年朋友讨论日常。',
            opening: '一起去散步吧。',
            messageNumber: data[0]!.number,
            quote: data[0]!.text.slice(0, 10),
          },
        ],
      });
    };
  });
  await openGuide(page);
  await expect(page.locator('.sg-status')).toContainText('条资料已读取');
  await page.getByRole('button', { name: '场景素材库', exact: true }).click();
  await page.getByRole('button', { name: '从当前聊天整理' }).click();
  await page.getByRole('button', { name: '预览当前范围' }).click();
  await expect(page.locator('.sg-chat-message')).toHaveCount(50);
  await expect(page.locator('.sg-chat-selection')).toContainText('自动分');
  const rawDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出所选聊天JSON' }).click();
  const rawPath = await (await rawDownload).path();
  if (!rawPath) throw new Error('没有导出文件');
  const raw = JSON.parse(await readFile(rawPath, 'utf8')) as { status: string; messages: unknown[] };
  expect(raw.messages).toHaveLength(50);
  expect(raw.status).toBe('raw');
  expect(await page.evaluate(() => (window as unknown as { batchCalls: number }).batchCalls)).toBe(0);
  await page.getByRole('button', { name: '用当前模型整理' }).click();
  await expect(page.locator('.sg-chat-material-status')).toContainText('已完成');
  expect(await page.evaluate(() => (window as unknown as { batchCalls: number }).batchCalls)).toBeGreaterThan(
    1,
  );
  await page.getByRole('button', { name: '保存聊天归档' }).click();
  await expect(page.locator('.sg-chat-material-status')).toContainText('已保存50条');
  await page.getByRole('button', { name: '保存选中素材' }).click();
  await expect(page.locator('.sg-material-status')).toContainText('已保存');
  await page.getByLabel('只看个人素材').check();
  expect(await page.locator('.sg-material-card').count()).toBeGreaterThan(8);
  await page.getByRole('button', { name: '聊天剧情归档', exact: true }).click();
  await expect(page.locator('.sg-chat-archive')).toHaveCount(1);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出归档JSON' }).click();
  const archivePath = await (await download).path();
  if (!archivePath) throw new Error('没有归档文件');
  const archive = JSON.parse(await readFile(archivePath, 'utf8')) as {
    messages: unknown[];
    materials: unknown[];
    status: string;
  };
  expect(archive.messages).toHaveLength(50);
  expect(archive.materials.length).toBeGreaterThan(1);
  expect(archive.status).toBe('complete');
});
