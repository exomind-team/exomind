import { expect, test, type Locator, type Page } from '@playwright/test';

const counters = (page: Page) => page.evaluate(() => (window as unknown as { __betaUiFixture: { counters: Record<string, number> } }).__betaUiFixture.counters);
async function activate(page: Page, locator: Locator) {
  if (test.info().project.use.hasTouch) await locator.tap(); else await locator.click();
}
test.beforeEach(async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/beta-workspace.html');
  await expect(page.getByRole('textbox', { name: '记录当下' })).toBeVisible();
  await expect(page.getByLabel('记录历史')).toHaveAttribute('aria-busy', 'false');
});

test('one editor survives image preview, reading, independent panes, navigation and reload', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const input = page.getByRole('textbox', { name: '记录当下' });
  await input.fill('还在写的半句话，不要被界面切换打断。');
  const editor = await input.elementHandle();
  const image = page.getByRole('button', { name: '预览图片 把此刻留给下一刻.png' });
  await expect(image.getByRole('img')).toBeVisible();
  await page.screenshot({ path: info.outputPath('initial-workspace.png'), fullPage: true });
  const reads = (await counters(page)).imageReads;
  await activate(page, image);
  await expect(page.getByRole('dialog').getByRole('img')).toBeVisible();
  await expect(page.getByRole('dialog')).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Close' })).toBeInViewport({ ratio: 1 });
  await activate(page, page.getByRole('dialog').getByRole('button', { name: 'Close' }));
  await expect(image).toBeFocused();
  expect((await counters(page)).imageReads).toBe(reads);
  const history = page.getByLabel('记录历史');
  await history.evaluate(element => { element.scrollTop = Math.round(element.scrollHeight / 3); element.dispatchEvent(new Event('scroll', { bubbles: true })); });
  const before = await history.evaluate(element => element.scrollTop);
  await activate(page, page.getByRole('button', { name: '折叠记录', exact: true }));
  await expect(history).toBeHidden();
  await activate(page, page.getByRole('button', { name: '折叠记录', exact: true }));
  await expect.poll(() => history.evaluate(element => element.scrollTop)).toBe(before);
  await activate(page, page.getByRole('button', { name: '隐藏记录', exact: true }));
  await activate(page, page.getByRole('button', { name: '隐藏专注', exact: true }));
  await expect(history).toBeHidden(); await expect(input).toBeVisible();
  await input.press('End'); await input.press('Shift+ArrowLeft');
  await activate(page, page.getByRole('button', { name: '设置', exact: true }));
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  await activate(page, page.getByRole('button', { name: '当下', exact: true }));
  expect(await input.evaluate((element, previous) => element === previous, editor)).toBe(true);
  await expect(input).toHaveValue('还在写的半句话，不要被界面切换打断。');
  await activate(page, page.getByRole('button', { name: '恢复默认视图' }));
  await expect(history).toBeVisible();
  await expect.poll(() => history.evaluate(element => element.scrollTop)).toBe(before);
  expect((await counters(page)).captures).toBe(0);
  await page.screenshot({ path: info.outputPath('workspace.png'), fullPage: true });
  await activate(page, page.getByRole('button', { name: '隐藏专注', exact: true }));
  await page.reload();
  await expect(page.getByRole('textbox', { name: '记录当下' })).toHaveValue('还在写的半句话，不要被界面切换打断。');
  await expect(page.getByRole('button', { name: '隐藏专注' })).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('timer, feedback and message input keep their own keyboard and touch semantics', async ({ page }, info) => {
  await activate(page, page.getByRole('button', { name: '配置时间块', exact: true }));
  await activate(page, page.getByTestId('new-focus-config-collapse-button'));
  expect((await counters(page)).timerCommands).toBe(0);
  await activate(page, page.getByRole('button', { name: '配置时间块', exact: true }));
  const name = page.getByTestId('new-focus-task-input');
  await name.fill('写下一轮计划');
  await expect(page.getByRole('button', { name: '开始计时', exact: true })).toBeInViewport();
  await activate(page, page.getByRole('button', { name: '开始计时', exact: true }));
  await expect(page.getByTestId('new-focus-running-name-display')).toHaveText('写下一轮计划');
  await activate(page, page.getByTestId('new-focus-pause-resume-button'));
  await expect(page.getByTestId('new-focus-pause-resume-button')).toHaveAccessibleName('继续（Resume）');
  await activate(page, page.getByTestId('new-focus-pause-resume-button'));
  await activate(page, page.getByRole('button', { name: '追加反馈', exact: true }));
  const feedback = page.getByTestId('new-focus-feedback-textarea');
  await feedback.fill('现在的操作保持在同一段上下文里。');
  const before = (await counters(page)).timerCommands;
  await feedback.press('Enter'); await feedback.press('Shift+Enter');
  expect((await counters(page)).timerCommands).toBe(before);
  if (info.project.use.hasTouch) await activate(page, page.getByTestId('new-focus-feedback-confirm'));
  else await feedback.press('Control+Enter');
  await expect(page.getByRole('dialog')).toBeHidden();
  expect((await counters(page)).timerCommands).toBe(before + 1);
  const input = page.getByRole('textbox', { name: '记录当下' });
  await input.fill('这一条由记录输入框提交');
  if (info.project.use.hasTouch) await activate(page, page.getByRole('button', { name: '发送', exact: true }));
  else await input.press('Control+Enter');
  await expect(input).toHaveValue('');
  await expect(page.getByLabel('记录历史').getByText('这一条由记录输入框提交', { exact: true })).toBeVisible();
  expect((await counters(page)).captures).toBe(1);
});

test('real container keeps controls reachable and fits narrow or short layouts', async ({ page }, info) => {
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('textbox', { name: '记录当下' })).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.setViewportSize(info.project.use.hasTouch ? { width: 844, height: 390 } : { width: 860, height: 580 });
  await expect(page.getByRole('textbox', { name: '记录当下' })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await activate(page, page.getByRole('button', { name: '配置时间块', exact: true }));
  await page.getByTestId('new-focus-task-input').fill('短屏仍能开始');
  await activate(page, page.getByRole('button', { name: '开始计时', exact: true }));
  await expect(page.getByTestId('new-focus-running-name-display')).toHaveText('短屏仍能开始');
  await expect(page.getByRole('textbox', { name: '记录当下' })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: info.outputPath('short-layout.png'), fullPage: true });
});

test('keyboard operates the same pane controls and keeps the editor selection across navigation', async ({ page }) => {
  const hide = page.getByRole('button', { name: '隐藏记录', exact: true });
  await hide.focus(); await hide.press('Space');
  await expect(hide).toHaveAttribute('aria-pressed', 'true');
  await hide.press('Space'); await expect(hide).toHaveAttribute('aria-pressed', 'false');
  const collapse = page.getByRole('button', { name: '折叠记录', exact: true });
  await collapse.focus(); await collapse.press('Enter');
  await expect(collapse).toHaveAttribute('aria-expanded', 'false');
  await collapse.press('Enter'); await expect(collapse).toHaveAttribute('aria-expanded', 'true');
  const input = page.getByRole('textbox', { name: '记录当下' });
  await input.fill('保留光标位置'); await input.press('Home'); await input.press('Shift+ArrowRight');
  const selected = await input.evaluate(element => ({ start: (element as HTMLTextAreaElement).selectionStart, end: (element as HTMLTextAreaElement).selectionEnd }));
  await page.getByRole('button', { name: '设置', exact: true }).focus(); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '当下', exact: true }).focus(); await page.keyboard.press('Enter');
  expect(await input.evaluate(element => ({ start: (element as HTMLTextAreaElement).selectionStart, end: (element as HTMLTextAreaElement).selectionEnd }))).toEqual(selected);
  expect((await counters(page)).captures).toBe(0);
});

test('record body and durable draft status retain readable contrast in the active theme', async ({ page }) => {
  await page.getByRole('textbox', { name: '记录当下' }).fill('对比度验收');
  const body = page.getByLabel('记录历史').getByText('第 48 条合成记录', { exact: false });
  await activate(page, page.getByRole('button', { name: '记录保存状态' }));
  const status = page.getByRole('dialog').getByText('记录草稿已暂存 · 尚未提交', { exact: true });
  await expect(status).toBeVisible();
  for (const target of [body, status]) {
    const ratio = await target.evaluate(element => {
      const channels = (color: string) => color.match(/[\d.]+/g)!.map(Number);
      const foreground = channels(getComputedStyle(element).color);
      let background: number[] | null = null;
      for (let parent: Element | null = element; parent; parent = parent.parentElement) {
        const color = channels(getComputedStyle(parent).backgroundColor);
        if (color.length === 3 || color[3] === 1) { background = color; break; }
      }
      if (!background) throw new Error('No verified opaque background');
      const luminance = (rgb: number[]) => rgb.slice(0, 3).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      const first = luminance(foreground), second = luminance(background);
      return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  }
});

test('a short workspace gives records the main area and keeps configuration beside its controls', async ({ page }, info) => {
  await page.setViewportSize({ width: 1000, height: 650 });
  const input = page.getByRole('textbox', { name: '记录当下' });
  const row = page.getByTestId('new-now-input-row');
  await expect(input).toBeInViewport({ ratio: 1 });
  const inputBox = await input.boundingBox(), rowBox = await row.boundingBox();
  expect(rowBox!.y + rowBox!.height - (inputBox!.y + inputBox!.height)).toBeLessThanOrEqual(14);
  await activate(page, page.getByRole('button', { name: '配置时间块', exact: true }));
  const card = page.locator('#new-focus-config-panel');
  const geometry = await card.evaluate(element => {
    const card = element.getBoundingClientRect(), workspace = element.closest('[data-beta-workspace]')!.getBoundingClientRect();
    const history = document.querySelector('[aria-label="记录历史"]')!.getBoundingClientRect();
    return { cardWidth: card.width, cardTop: card.top, workspaceWidth: workspace.width, historyHeight: history.height };
  });
  expect(geometry.cardWidth).toBeGreaterThan(geometry.workspaceWidth * 0.9);
  expect(geometry.cardTop).toBeLessThan(130);
  expect(geometry.historyHeight).toBeGreaterThan(200);
  await page.screenshot({ path: info.outputPath('compact-configuration.png'), fullPage: true });
  await activate(page, page.getByRole('button', { name: '简洁记录', exact: true }));
  await expect(page.getByRole('button', { name: '折叠专注', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: '折叠记录', exact: true })).toBeHidden();
  const historyBox = await page.getByLabel('记录历史').boundingBox();
  expect(historyBox!.height).toBeGreaterThan(450);
  await page.screenshot({ path: info.outputPath('quiet-records.png'), fullPage: true });
  expect((await counters(page)).timerCommands).toBe(0);
});
