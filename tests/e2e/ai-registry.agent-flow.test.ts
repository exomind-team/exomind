import { expect, test } from "@playwright/test";

test.describe("AI Registry agent flow（AI 注册中心到 Agent 创建链路）", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem("ai-registry-e2e-initialized")) {
        localStorage.clear();
        sessionStorage.setItem("ai-registry-e2e-initialized", "true");
      }
      localStorage.setItem("exomind:uiMode", "new");
      localStorage.setItem("exomind:developerMode", "true");
      localStorage.setItem("exomind:agentPageEnabled", "true");
      localStorage.setItem("exomind:desktopAdaptiveEnabled", "true");
      localStorage.setItem("exomind:useMockData", "true");
    });
  });

  test("manages multiple offerings and exposes only llm.chat channels to Agent create flow（支持多供给项管理，且仅 llm.chat 进入 Agent 创建链路）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto("/settings");
    await expect(page.getByText("AI Registry")).toBeVisible();

    await page.getByText("AI Registry").click();
    await expect(
      page.getByRole("heading", { name: "AI Registry" }),
    ).toBeVisible();

    await page
      .getByPlaceholder("Primary LLM Channel")
      .fill("AI Registry Gateway Alpha");
    await page
      .getByPlaceholder("https://api.openai.com/v1")
      .fill("https://gateway.example/v1");
    await page.getByPlaceholder("gpt-4o").fill("gpt-5.4");
    await page.getByPlaceholder("sk-...").fill("sk-registry-e2e-alpha");
    await page.getByRole("button", { name: "保存" }).scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "保存" }).click();

    await expect(page.getByText("AI Registry 已保存")).toBeVisible();

    await page.getByRole("button", { name: "新建供给项" }).click();
    await page
      .getByPlaceholder("Primary LLM Channel")
      .fill("AI Registry Gateway Beta");
    await page
      .getByPlaceholder("https://api.openai.com/v1")
      .fill("https://beta-gateway.example/v1");
    await page.getByPlaceholder("gpt-4o").fill("gpt-5.4-mini");
    await page.getByPlaceholder("sk-...").fill("sk-registry-e2e-beta");
    await page.getByRole("button", { name: "保存" }).scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "保存" }).click();

    await expect(
      page.getByText("AI Registry 已保存：AI Registry Gateway Beta / llm.chat"),
    ).toBeVisible();

    await page.getByRole("button", { name: "新建供给项" }).click();
    await page
      .locator('input[list="ai-registry-capability-options"]')
      .fill("image.generate");
    await page.getByPlaceholder("LLM Chat").fill("Image Generate");
    await page
      .getByPlaceholder("Primary LLM Channel")
      .fill("AI Registry Image Gateway");
    await page
      .getByPlaceholder("https://api.openai.com/v1")
      .fill("https://image-gateway.example/v1");
    await page.getByPlaceholder("gpt-4o").fill("gpt-image-1");
    await page.getByPlaceholder("sk-...").fill("sk-registry-e2e-image");
    await page.getByRole("button", { name: "保存" }).scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "保存" }).click();

    await expect(
      page.getByText(
        "AI Registry 已保存：AI Registry Image Gateway / image.generate",
      ),
    ).toBeVisible();

    const registrySnapshot = await page.evaluate(() => {
      const raw = localStorage.getItem("exomind:ai-registry:snapshot");
      return raw ? JSON.parse(raw) : null;
    });
    expect(registrySnapshot).not.toBeNull();
    expect(registrySnapshot.channels).toHaveLength(3);
    expect(registrySnapshot.offerings).toHaveLength(3);
    expect(registrySnapshot.capabilities).toHaveLength(2);
    expect(registrySnapshot.resolutionRules).toHaveLength(2);

    await page.goto("/agents");
    await expect(page.getByTestId("agent-hub-page")).toBeVisible();

    await page.getByTestId("agent-add-node-button").click();
    await expect(page.getByTestId("agent-add-node-sheet")).toBeVisible();
    await page.getByTestId("agent-add-node-option-api").click();

    await expect(page.getByTestId("agent-create-sheet")).toBeVisible();
    const providerProfileSelect = page.getByTestId(
      "agent-create-provider-profile-select",
    );
    await expect(providerProfileSelect).toBeVisible();
    await expect(providerProfileSelect.locator("option")).toHaveCount(3);
    await expect(providerProfileSelect).toContainText(
      "AI Registry Gateway Alpha · openai / gpt-5.4",
    );
    await expect(providerProfileSelect).toContainText(
      "AI Registry Gateway Beta · openai / gpt-5.4-mini",
    );
    await expect(providerProfileSelect).not.toContainText(
      "AI Registry Image Gateway",
    );
    await expect(providerProfileSelect.locator("option:checked")).toHaveText(
      "AI Registry Gateway Beta · openai / gpt-5.4-mini",
    );
    await expect(page.getByTestId("agent-create-api-key-input")).toBeDisabled();
  });

  test("keeps the dialog inside a short desktop viewport and scrolls internally（矮视口下弹窗不超出窗口且内部滚动）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 640 });
    await page.goto("/settings");
    await expect(page.getByText("AI Registry")).toBeVisible();

    await page.getByText("AI Registry").click();

    const dialog = page.getByRole("dialog", { name: "AI Registry" });
    const shell = page.getByTestId("ai-registry-dialog-shell");
    const scrollRegion = page.getByTestId("ai-registry-scroll-region");

    await expect(dialog).toBeVisible();
    await expect(shell).toBeVisible();
    await expect(scrollRegion).toBeVisible();

    const dialogBox = await dialog.boundingBox();
    expect(dialogBox).not.toBeNull();
    expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(640);

    const metrics = await scrollRegion.evaluate((node) => {
      const element = node as HTMLElement;
      return {
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        overflowY: window.getComputedStyle(element).overflowY,
      };
    });

    expect(metrics.overflowY).toBe("auto");
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);

    const initialScrollTop = await scrollRegion.evaluate(
      (node) => (node as HTMLElement).scrollTop,
    );
    await scrollRegion.evaluate((node) => {
      const element = node as HTMLElement;
      element.scrollTop = element.scrollHeight;
    });
    await expect
      .poll(async () =>
        scrollRegion.evaluate((node) => (node as HTMLElement).scrollTop),
      )
      .toBeGreaterThan(initialScrollTop);
  });
});
