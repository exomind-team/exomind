/**
 * Manual debugging script for time block feedback persistence.
 *
 * Usage:
 *   node tests/e2e/debug-feedback.js
 *
 * Optional env:
 *   E2E_BASE_URL=http://localhost:1420
 *   HEADLESS=1
 */

import { chromium } from 'playwright';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:1420';
const HEADLESS = process.env.HEADLESS === '1';

function nowTag() {
  return Date.now().toString();
}

async function findTaskInput(page) {
  const preferred = page.locator('input[placeholder*="任务标题"]').first();
  if (await preferred.count()) return preferred;
  return page.locator('input[type="text"]').first();
}

async function run() {
  const browser = await chromium.launch({ headless: HEADLESS, channel: 'chrome' });
  const page = await browser.newPage();
  const runId = nowTag();
  const taskName = `debug-feedback-${runId}`;
  const feedbackText = `feedback-${runId}`;

  try {
    console.log(`[INFO] Open ${BASE_URL}/eventlog`);
    await page.goto(`${BASE_URL}/eventlog`);
    await page.waitForLoadState('domcontentloaded');

    console.log('[INFO] Expand TimeBlock panel');
    await page.locator('svg.lucide-chevron-down').first().click();
    await page.waitForTimeout(300);

    console.log('[INFO] Fill task name');
    const taskInput = await findTaskInput(page);
    await taskInput.fill(taskName);

    console.log('[INFO] Start block');
    await page.locator('button:has-text("开始")').first().click();
    await page.waitForTimeout(500);

    console.log('[INFO] End block');
    await page.locator('button:has-text("结束")').first().click();

    console.log('[INFO] Fill feedback and confirm');
    const dialog = page.locator('[role="dialog"]');
    await dialog.waitFor({ state: 'visible', timeout: 5000 });
    await dialog.locator('input').first().fill(feedbackText);
    await dialog.locator('button:has-text("确认结束")').first().click();

    await page.waitForTimeout(2000);
    const eventText = await page.locator('[data-testid="event-list"]').textContent();
    const ok = Boolean(eventText && eventText.includes(feedbackText));

    await page.screenshot({ path: `test-results/debug-feedback-${runId}.png` });

    if (!ok) {
      console.error('[FAIL] feedback text not found in event list');
      console.error(`[FAIL] expected snippet: ${feedbackText}`);
      process.exitCode = 1;
      return;
    }

    console.log('[PASS] feedback text is visible in event list');
    console.log(`[PASS] task=${taskName}`);
    console.log(`[PASS] feedback=${feedbackText}`);
  } catch (error) {
    console.error('[ERROR]', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

run();
