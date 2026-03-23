import { expect, test } from '@playwright/test';

test.describe('事件日志输入框 - 多行与滚动', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('exomind:inputSendMode', 'ctrl-enter-send');
    });
    await page.goto('/eventlog');
    await page.waitForLoadState('networkidle');
  });

  test('应使用多行输入框并保持较高初始高度', async ({ page }) => {
    const textarea = page.getByPlaceholder(/记录当下的事实|输入内容记录事件/);
    await expect(textarea).toBeVisible();

    const height = await textarea.evaluate((el) => (el as HTMLTextAreaElement).clientHeight);
    expect(height).toBeGreaterThanOrEqual(40);
  });

  test('Ctrl+Enter 应发送消息并显示在事件列表', async ({ page }) => {
    const textarea = page.getByPlaceholder(/记录当下的事实|输入内容记录事件/);
    const content = `e2e-${Date.now()}`;

    await textarea.fill(content);
    await textarea.press('Control+Enter');

    await expect(page.getByText(content)).toBeVisible();
  });

  test('Shift+Enter 应插入换行而不是发送', async ({ page }) => {
    const textarea = page.getByPlaceholder(/记录当下的事实|输入内容记录事件/);

    await textarea.click();
    await textarea.type('第一行');
    await textarea.press('Shift+Enter');
    await textarea.type('第二行');

    await expect(textarea).toHaveValue('第一行\n第二行');
  });

  test('文本过长时输入框应内部纵向滚动', async ({ page }) => {
    const textarea = page.getByPlaceholder(/记录当下的事实|输入内容记录事件/);
    const longText = Array.from({ length: 24 }, (_, idx) => `第${idx + 1}行内容`).join('\n');

    await textarea.fill(longText);

    const metrics = await textarea.evaluate((el) => {
      const node = el as HTMLTextAreaElement;
      const style = window.getComputedStyle(node);
      return {
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        overflowY: style.overflowY,
      };
    });

    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
    expect(['auto', 'scroll']).toContain(metrics.overflowY);
  });
});
