import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test.describe('设置页导入导出', () => {
  test('导出 JSON 应包含事件日志页面中的真实事件', async ({ page }, testInfo) => {
    const marker = `e2e-export-${Date.now()}`;

    await page.goto('/eventlog');
    await page.getByPlaceholder('输入内容记录事件...').fill(marker);
    await page.getByPlaceholder('输入内容记录事件...').press('Control+Enter');
    await expect(page.getByText(marker)).toBeVisible();

    await page.goto('/settings');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 JSON' }).click();
    const download = await downloadPromise;

    const downloadPath = path.join(testInfo.outputDir, download.suggestedFilename());
    await download.saveAs(downloadPath);

    const raw = await readFile(downloadPath, 'utf-8');
    const payload = JSON.parse(raw) as { events?: Array<{ content?: string }> };
    const contents = (payload.events ?? []).map((event) => event.content).filter(Boolean);

    expect(contents).toContain(marker);
  });
});
