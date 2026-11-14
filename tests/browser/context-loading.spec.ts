import { openGuide } from './helpers';
import { test, expect } from '@playwright/test';

test('损坏条目单独记录，同书有效条目仍可读取', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const w = window as unknown as { testContext: Record<string, unknown> };
    w.testContext.characters = [
      { avatar: 'mixed.png', name: '混合资料', data: { extensions: { world: '混合书' } } },
    ];
    w.testContext.loadWorldInfo = async () => ({
      entries: {
        good: { content: '可保留的有效背景', comment: '有效背景' },
        broken: { content: 42 },
      },
    });
  });
  await openGuide(page);
  await expect(page.locator('.sg-sidebar')).toContainText('混合书 / 有效背景');
  await expect(page.locator('.sg-load-error')).toHaveCount(0);
  await expect(page.locator('.sg-panel')).toContainText('有 1 条资料读取异常，其余资料已保留');
});

test('切换立即清空旧资料，失败可重试并跳过指定世界书', async ({ page }) => {
  await page.goto('/');
  await openGuide(page);
  await page.getByRole('button', { name: '建立本地资料目录（无需AI）' }).click();
  await expect(page.locator('.sg-panel main')).toContainText('调查员');
  await page.evaluate(() => {
    const w = window as unknown as {
      testContext: Record<string, unknown>;
      testSwitch: () => void;
      rejectBook: () => void;
    };
    w.testContext.characters = [
      {
        avatar: 'new.png',
        name: '新角色',
        description: '新人物资料',
        data: { extensions: { world: '损坏书' } },
      },
    ];
    w.testContext.chatMetadata = { world_info: '正常书' };
    w.testContext.loadWorldInfo = (name: string) =>
      name === '损坏书'
        ? new Promise((_resolve, reject) => {
            w.rejectBook = () => reject(new Error('fixture failure'));
          })
        : Promise.resolve({ entries: { a: { content: '正常书的资料', comment: '有效条目' } } });
    w.testSwitch();
  });
  await expect(page.locator('.sg-panel > header h2')).toContainText('新角色 · 正在读取');
  await expect(page.locator('.sg-panel main')).not.toContainText('调查员');
  await page.waitForFunction(
    () => typeof (window as unknown as { rejectBook: unknown }).rejectBook === 'function',
  );
  await page.evaluate(() => (window as unknown as { rejectBook: () => void }).rejectBook());
  await expect(page.getByRole('button', { name: '重试读取', exact: true })).toBeVisible();
  await expect(page.locator('.sg-load-error')).toContainText('损坏书');
  await page.evaluate(() => {
    const w = window as unknown as { testContext: Record<string, unknown> };
    w.testContext.loadWorldInfo = async (name: string) => {
      if (name === '损坏书') throw new Error('still unavailable');
      return { entries: { a: { content: '正常书的资料', comment: '有效条目' } } };
    };
  });
  await page.getByRole('button', { name: '重试读取', exact: true }).click();
  await expect(page.locator('.sg-load-error')).toContainText('损坏书');
  await page.getByRole('button', { name: '跳过「损坏书」并继续' }).click();
  await expect(page.locator('.sg-panel main')).toContainText('当前资料不完整');
  await expect(page.locator('.sg-sidebar')).toContainText('正常书 / 有效条目');
  await expect(page.locator('.sg-sidebar')).not.toContainText('调查员');
  await page.evaluate(() => {
    const w = window as unknown as { testContext: Record<string, unknown> };
    w.testContext.loadWorldInfo = async () => ({
      entries: { b: { content: '恢复的资料', comment: '恢复条目' } },
    });
  });
  await page.getByRole('button', { name: '重新读取全部资料' }).click();
  await expect(page.locator('.sg-sidebar')).toContainText('损坏书 / 恢复条目');
  await expect(page.locator('.sg-panel main')).not.toContainText('当前资料不完整');
});

test('新角色无资料显示空状态，旧读取失败不能覆盖新角色', async ({ page }) => {
  await page.goto('/');
  await openGuide(page);
  await page.evaluate(() => {
    const w = window as unknown as {
      testContext: Record<string, unknown>;
      testSwitch: () => void;
      rejectOld: () => void;
    };
    w.testContext.characters = [
      { avatar: 'pending.png', name: '等待角色', data: { extensions: { world: '旧书' } } },
    ];
    w.testContext.loadWorldInfo = () =>
      new Promise((_resolve, reject) => {
        w.rejectOld = () => reject(new Error('old failure'));
      });
    w.testSwitch();
  });
  await page.waitForFunction(
    () => typeof (window as unknown as { rejectOld: unknown }).rejectOld === 'function',
  );
  await page.evaluate(() => {
    const w = window as unknown as {
      testContext: Record<string, unknown>;
      testSwitch: () => void;
      rejectOld: () => void;
    };
    w.testContext.characters = [{ avatar: 'empty.png', name: '空角色' }];
    w.testSwitch();
    w.rejectOld();
  });
  await expect(page.locator('.sg-panel main')).toContainText('当前角色没有可读取资料');
  await expect(page.locator('.sg-panel > header h2')).toContainText('空角色的剧情指南');
  await expect(page.locator('.sg-load-error')).toHaveCount(0);
  await expect(page.locator('.sg-sidebar')).not.toContainText('调查员');
});
