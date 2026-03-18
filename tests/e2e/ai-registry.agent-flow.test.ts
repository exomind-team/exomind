import { expect, test } from '@playwright/test';

test.describe('AI Registry agent flow（AI 注册中心到 Agent 创建链路）', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('ai-registry-e2e-initialized')) {
        localStorage.clear();
        sessionStorage.setItem('ai-registry-e2e-initialized', 'true');
      }
      localStorage.setItem('exomind:uiMode', 'new');
      localStorage.setItem('exomind:developerMode', 'true');
      localStorage.setItem('exomind:agentPageEnabled', 'true');
      localStorage.setItem('exomind:desktopAdaptiveEnabled', 'true');
      localStorage.setItem('exomind:useMockData', 'true');
    });
  });

  test('saves AI registry draft and exposes it as API provider profile（保存 AI Registry 后可在 Agent 创建中复用）', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/settings');
    await expect(page.getByText('AI Registry')).toBeVisible();

    await page.getByText('AI Registry').click();
    await expect(page.getByRole('heading', { name: 'AI Registry' })).toBeVisible();

    await page.getByPlaceholder('Primary LLM Channel').fill('AI Registry Gateway');
    await page.getByPlaceholder('https://api.openai.com/v1').fill('https://gateway.example/v1');
    await page.getByPlaceholder('gpt-4o').fill('gpt-5.4');
    await page.getByPlaceholder('sk-...').fill('sk-registry-e2e');
    await page.getByRole('button', { name: '保存' }).click();

    await expect(page.getByText('AI Registry 已保存')).toBeVisible();

    const registrySnapshot = await page.evaluate(() => {
      const raw = localStorage.getItem('exomind:ai-registry:snapshot');
      return raw ? JSON.parse(raw) : null;
    });
    expect(registrySnapshot).not.toBeNull();
    expect(registrySnapshot.channels).toHaveLength(1);
    expect(registrySnapshot.offerings).toHaveLength(1);

    await page.goto('/agents');
    await expect(page.getByTestId('agent-hub-page')).toBeVisible();

    await page.getByTestId('agent-add-node-button').click();
    await expect(page.getByTestId('agent-add-node-sheet')).toBeVisible();
    await page.getByTestId('agent-add-node-option-api').click();

    await expect(page.getByTestId('agent-create-sheet')).toBeVisible();
    const providerProfileSelect = page.getByTestId('agent-create-provider-profile-select');
    await expect(providerProfileSelect).toBeVisible();
    await expect(providerProfileSelect.locator('option:checked')).toHaveText('AI Registry Gateway · openai / gpt-5.4');
    await expect(page.getByTestId('agent-create-api-key-input')).toBeDisabled();
  });
});
