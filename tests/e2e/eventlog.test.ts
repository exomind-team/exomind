import { expect, test, type Page } from '@playwright/test';

function eventInput(page: Page) {
  return page.getByPlaceholder(/记录当下的事实|输入内容记录事件/);
}

test.describe('EventLog Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('exomind:') || key.startsWith('exomind_')) {
          localStorage.removeItem(key);
        }
      }
      localStorage.setItem('exomind:inputSendMode', 'ctrl-enter-send');
    });
    await page.goto('/eventlog');
    await expect(eventInput(page)).toBeVisible();
  });

  test('loads eventlog shell and input area', async ({ page }) => {
    await expect(page).toHaveTitle(/ExoMind/i);
    await expect(eventInput(page)).toBeVisible();
    await expect(page.getByRole('button', { name: '附件' })).toBeVisible();
  });

  test('Ctrl+Enter sends an event and renders it in list', async ({ page }) => {
    const marker = `eventlog-${Date.now()}`;
    const input = eventInput(page);

    await input.fill(marker);
    await input.press('Control+Enter');

    await expect(page.getByText(marker)).toBeVisible();
  });

  test('Enter mode does not send on Ctrl+Enter', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('exomind:inputSendMode', 'enter-send');
      window.dispatchEvent(new CustomEvent('exomind:input-send-mode-changed', { detail: 'enter-send' }));
    });

    const marker = `eventlog-enter-mode-${Date.now()}`;
    const input = eventInput(page);
    const eventList = page.getByTestId('event-list');

    await input.fill(marker);
    await expect(eventList.getByTestId('new-mobile-user-message-row')).toHaveCount(0);
    await input.press('Control+Enter');

    await expect(input).toHaveValue(`${marker}\n`);
    await expect(eventList.getByTestId('new-mobile-user-message-row')).toHaveCount(0);
  });

  test('Shift+Enter inserts newline without sending', async ({ page }) => {
    const input = eventInput(page);

    await input.click();
    await input.type('第一行');
    await input.press('Shift+Enter');
    await input.type('第二行');

    await expect(input).toHaveValue('第一行\n第二行');
  });

  test('can switch to settings and back to eventlog', async ({ page }) => {
    await page.getByRole('link', { name: '设置' }).click();
    await expect(page).toHaveURL(/\/settings/);

    await page.getByRole('link', { name: /当下|事件日志/ }).click();
    await expect(page).toHaveURL(/\/eventlog/);
    await expect(eventInput(page)).toBeVisible();
  });
});
