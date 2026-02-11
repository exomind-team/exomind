import { expect, test, type Page } from '@playwright/test';

type TimerMode = 'countup' | 'countdown';

function parseTimerToSeconds(timerText: string): number {
  const parts = timerText.trim().split(':').map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) {
    throw new Error(`Invalid timer text: ${timerText}`);
  }

  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return minutes * 60 + seconds;
  }

  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return hours * 3600 + minutes * 60 + seconds;
  }

  throw new Error(`Unexpected timer format: ${timerText}`);
}

function createActiveBlock(mode: TimerMode, paused: boolean) {
  return {
    startId: 'issue82-block',
    name: 'Issue 82 regression',
    startTime: Date.now() - 5000,
    elapsed: mode === 'countup' ? 1000 : 5 * 60 * 1000,
    mode,
    targetMinutes: mode === 'countdown' ? 5 : undefined,
    paused,
    pausedAt: paused ? Date.now() - 1000 : undefined,
  };
}

async function seedActiveBlock(page: Page, mode: TimerMode, paused: boolean) {
  const block = createActiveBlock(mode, paused);
  await page.addInitScript((activeBlock) => {
    const keysToDelete: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith('exomind_')) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach((key) => localStorage.removeItem(key));

    localStorage.setItem('exomind_active_block', JSON.stringify(activeBlock));
    localStorage.setItem('exomind_time_blocks', '[]');
  }, block);
}

async function readTimerSeconds(page: Page): Promise<number> {
  const timer = page.locator('div.font-mono.text-lg span').first();
  await expect(timer).toBeVisible();
  const text = (await timer.textContent())?.trim() ?? '';
  return parseTimerToSeconds(text);
}

async function expectTimerIncreasing(page: Page) {
  const before = await readTimerSeconds(page);
  await page.waitForTimeout(2200);
  const after = await readTimerSeconds(page);
  expect(after).toBeGreaterThan(before);
}

async function expectTimerStable(page: Page) {
  const before = await readTimerSeconds(page);
  await page.waitForTimeout(2200);
  const after = await readTimerSeconds(page);
  expect(after).toBe(before);
}

test.describe('Issue #82: TimeBlock timer restore behavior', () => {
  test('running block keeps ticking after route remount and refresh', async ({ page }) => {
    await seedActiveBlock(page, 'countup', false);
    await page.goto('/eventlog');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('button', { name: '暂停' })).toBeVisible();
    await expectTimerIncreasing(page);

    await page.getByRole('link', { name: '设置' }).click();
    await expect(page).toHaveURL(/\/settings/);
    await page.getByRole('link', { name: '事件日志' }).click();
    await expect(page).toHaveURL(/\/eventlog/);
    await expectTimerIncreasing(page);

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: '暂停' })).toBeVisible();
    await expectTimerIncreasing(page);
  });

  test('paused block stays stable after route remount and refresh', async ({ page }) => {
    await seedActiveBlock(page, 'countup', true);
    await page.goto('/eventlog');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('button', { name: '继续' })).toBeVisible();
    await expectTimerStable(page);

    await page.getByRole('link', { name: '设置' }).click();
    await expect(page).toHaveURL(/\/settings/);
    await page.getByRole('link', { name: '事件日志' }).click();
    await expect(page).toHaveURL(/\/eventlog/);
    await expectTimerStable(page);

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: '继续' })).toBeVisible();
    await expectTimerStable(page);
  });
});
