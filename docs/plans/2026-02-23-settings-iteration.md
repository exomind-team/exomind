# Settings 页迭代 — More/Legal Section + 测试数据开关 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 对照 Pencil 设计稿补全设置页，新增 User Card 激活按钮、More Section、Legal Section、Version Info 对齐设计稿、Developer Section 新增 Mock Data toggle。

**Architecture:** 在现有 `NewSettingsPage.tsx` 中新增 Section 组件，复用已有的 `SettingRow` / `SectionCard` / `SectionTitle` / `Divider` 组件模式。所有新增行为纯 UI 展示（链接跳转 / 占位），不涉及后端逻辑。

**Tech Stack:** React 18 + TypeScript, Tailwind CSS, lucide-react, Vitest, Playwright

---

## 差异分析（设计稿 vs 现有代码）

| 区域 | 设计稿 | 现有代码 | 操作 |
|------|--------|----------|------|
| User Card Action Row | 激活 + 切换账户 + 登出 | 切换账户 + 登出（缺激活） | 新增「激活」按钮 |
| More Section | 更新 / 遥测 / 报告问题 / 调试日志 | 无 | 新增整个 Section |
| Legal Section | 隐私政策 / 用户协议 / 官网 / 赞助 / 开源许可 | 无 | 新增整个 Section |
| Version Info | 标题「关于」，版本 / 构建 / 开发者注释 | 有版本信息但格式不同 | 重构对齐设计稿 |
| Developer Mock Data | 「使用测试数据」toggle | 已有但位置需确认 | 确认对齐 |
| Developer 功能开关 | 彩色图标点 + chevron | 已有 | 确认对齐 |

---

## Task 1: User Card — 新增「激活」按钮

**Files:**
- Modify: `src/ui/new/components/UserCard.tsx`
- Test: `src/ui/new/components/__tests__/UserCard.test.tsx`

**Step 1: 写失败测试**

```tsx
// src/ui/new/components/__tests__/UserCard.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UserCard } from '../UserCard';

// Mock dependencies
vi.mock('@/ui/stores/sync-store', () => ({
  useSyncStore: () => ({
    isLoggedIn: true,
    currentUser: 'TestUser',
    logout: vi.fn(),
  }),
}));

describe('UserCard', () => {
  it('renders activate button when logged in', () => {
    render(<UserCard />);
    expect(screen.getByText('激活')).toBeInTheDocument();
  });
});
```

**Step 2: 运行测试验证失败**

Run: `bunx vitest run src/ui/new/components/__tests__/UserCard.test.tsx`
Expected: FAIL — 找不到「激活」文本

**Step 3: 实现激活按钮**

在 `UserCard.tsx` 的 Action Row 中，已登录状态下在「切换账户」按钮前添加「激活」按钮：

```tsx
<button
  className="flex items-center gap-1.5 rounded-[10px] bg-white/20 px-3 py-2"
  onClick={() => {/* TODO: 激活逻辑 */}}
>
  <Sparkles className="h-[15px] w-[15px] text-[#FFE4B5]" />
  <span className="text-[13px] font-medium text-[#FFE4B5]">激活</span>
</button>
```

**Step 4: 运行测试验证通过**

Run: `bunx vitest run src/ui/new/components/__tests__/UserCard.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add -A && git commit -m "feat(UserCard): 新增激活按钮对齐设计稿"
```

---

## Task 2: More Section — 更新/遥测/报告问题/调试日志

**Files:**
- Modify: `src/ui/new/pages/NewSettingsPage.tsx`
- Test: `src/ui/new/pages/__tests__/NewSettingsPage.more.test.tsx`

**Step 1: 写失败测试**

```tsx
// src/ui/new/pages/__tests__/NewSettingsPage.more.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('Settings - More Section', () => {
  it('renders More section title', () => {
    // render Settings page (with necessary mocks)
    expect(screen.getByText('更多')).toBeInTheDocument();
  });

  it('renders update settings row', () => {
    expect(screen.getByText('检查更新')).toBeInTheDocument();
  });

  it('renders telemetry row', () => {
    expect(screen.getByText('使用数据与分析')).toBeInTheDocument();
  });

  it('renders report problem row', () => {
    expect(screen.getByText('报告问题')).toBeInTheDocument();
  });

  it('renders debug log row', () => {
    expect(screen.getByText('调试日志')).toBeInTheDocument();
  });
});
```

**Step 2: 运行测试验证失败**

Run: `bunx vitest run src/ui/new/pages/__tests__/NewSettingsPage.more.test.tsx`
Expected: FAIL

**Step 3: 在 NewSettingsPage.tsx 中添加 More Section**

在 Developer Section 之前（或 Sync Section 之后）插入：

```tsx
{/* ── More Section (更多) ── */}
<section className="space-y-2">
  <SectionTitle>更多</SectionTitle>
  <SectionCard>
    <SettingRow
      icon={<Download className="h-[18px] w-[18px] text-[#78716C]" />}
      label="检查更新"
      right={<ChevronRight className="h-4 w-4 text-[#A8A29E]" />}
      onClick={() => navigate({ to: '/new/update' })}
    />
    <Divider />
    <SettingRow
      icon={<Upload className="h-[18px] w-[18px] text-[#78716C]" />}
      label="使用数据与分析"
      right={<ChevronRight className="h-4 w-4 text-[#A8A29E]" />}
      onClick={() => {/* TODO */}}
    />
    <Divider />
    <SettingRow
      icon={<Speech className="h-[18px] w-[18px] text-[#78716C]" />}
      label="报告问题"
      right={<ChevronRight className="h-4 w-4 text-[#A8A29E]" />}
      onClick={() => {/* TODO */}}
    />
    <Divider />
    <SettingRow
      icon={<Code className="h-[18px] w-[18px] text-[#78716C]" />}
      label="调试日志"
      right={<ChevronRight className="h-4 w-4 text-[#A8A29E]" />}
      onClick={() => {/* TODO */}}
    />
  </SectionCard>
</section>
```

**Step 4: 运行测试验证通过**

**Step 5: Commit**

```bash
git add -A && git commit -m "feat(Settings): 新增 More Section — 更新/遥测/报告问题/调试日志"
```

---

## Task 3: Legal Section — 隐私政策/用户协议/官网/赞助/开源许可

**Files:**
- Modify: `src/ui/new/pages/NewSettingsPage.tsx`
- Test: `src/ui/new/pages/__tests__/NewSettingsPage.legal.test.tsx`

**Step 1: 写失败测试**

```tsx
describe('Settings - Legal Section', () => {
  it('renders Legal section title', () => {
    expect(screen.getByText('法律与支持')).toBeInTheDocument();
  });

  it('renders privacy policy row', () => {
    expect(screen.getByText('隐私政策')).toBeInTheDocument();
  });

  it('renders terms of service row', () => {
    expect(screen.getByText('用户协议')).toBeInTheDocument();
  });

  it('renders website row with external link icon', () => {
    expect(screen.getByText('官网')).toBeInTheDocument();
  });

  it('renders sponsor row', () => {
    expect(screen.getByText('赞助开发者')).toBeInTheDocument();
  });

  it('renders open source row', () => {
    expect(screen.getByText('开源软件使用声明')).toBeInTheDocument();
  });
});
```

**Step 2: 运行测试验证失败**

**Step 3: 实现 Legal Section**

设计稿中：隐私政策/用户协议用 `chevron-right`，官网/赞助用 `external-link`，开源许可用 `chevron-right`。

```tsx
{/* ── Legal Section (法律与支持) ── */}
<section className="space-y-2">
  <SectionTitle>法律与支持</SectionTitle>
  <SectionCard>
    <SettingRow
      icon={<Shield className="h-[18px] w-[18px] text-[#78716C]" />}
      label="隐私政策"
      right={<ChevronRight className="h-4 w-4 text-[#A8A29E]" />}
      onClick={() => {/* TODO: open privacy policy */}}
    />
    <Divider />
    <SettingRow
      icon={<FileText className="h-[18px] w-[18px] text-[#78716C]" />}
      label="用户协议"
      right={<ChevronRight className="h-4 w-4 text-[#A8A29E]" />}
      onClick={() => {/* TODO: open terms */}}
    />
    <Divider />
    <SettingRow
      icon={<Globe className="h-[18px] w-[18px] text-[#78716C]" />}
      label="官网"
      right={<ExternalLink className="h-4 w-4 text-[#A8A29E]" />}
      onClick={() => {/* TODO: open website */}}
    />
    <Divider />
    <SettingRow
      icon={<Heart className="h-[18px] w-[18px] text-[#78716C]" />}
      label="赞助开发者"
      right={<ExternalLink className="h-4 w-4 text-[#A8A29E]" />}
      onClick={() => {/* TODO: open sponsor */}}
    />
    <Divider />
    <SettingRow
      icon={<Code className="h-[18px] w-[18px] text-[#78716C]" />}
      label="开源软件使用声明"
      right={<ChevronRight className="h-4 w-4 text-[#A8A29E]" />}
      onClick={() => {/* TODO: open OSS licenses */}}
    />
  </SectionCard>
</section>
```

**Step 4: 运行测试验证通过**

**Step 5: Commit**

```bash
git add -A && git commit -m "feat(Settings): 新增 Legal Section — 隐私政策/用户协议/官网/赞助/开源许可"
```

---

## Task 4: Version Info 重构 — 对齐设计稿「关于」Section

**Files:**
- Modify: `src/ui/new/pages/NewSettingsPage.tsx`
- Test: `src/ui/new/pages/__tests__/NewSettingsPage.version.test.tsx`

**Step 1: 写失败测试**

```tsx
describe('Settings - Version Info (About)', () => {
  it('renders About section title', () => {
    expect(screen.getByText('关于')).toBeInTheDocument();
  });

  it('renders version row with version number', () => {
    expect(screen.getByText('版本')).toBeInTheDocument();
  });

  it('renders build row', () => {
    expect(screen.getByText('构建')).toBeInTheDocument();
  });

  it('renders developer note', () => {
    expect(screen.getByText(/ExoMind/)).toBeInTheDocument();
  });
});
```

**Step 2: 运行测试验证失败**

**Step 3: 重构 Version Info**

将现有版本信息替换为设计稿格式：标题「关于」，卡片内含版本行、构建行、开发者注释。

```tsx
{/* ── About Section (关于) ── */}
<section className="space-y-2">
  <SectionTitle>关于</SectionTitle>
  <SectionCard>
    <SettingRow
      icon={<Info className="h-[18px] w-[18px] text-[#78716C]" />}
      label="版本"
      right={<span className="text-sm text-[#A8A29E]">{versionBuildInfo.version}</span>}
    />
    <Divider />
    <SettingRow
      icon={<Package className="h-[18px] w-[18px] text-[#78716C]" />}
      label="构建"
      right={<span className="text-sm text-[#A8A29E]">{versionBuildInfo.buildTag || 'DEV'}</span>}
    />
    <Divider />
    <div className="px-4 py-[14px]">
      <div className="flex items-center gap-3">
        <Heart className="h-[18px] w-[18px] text-[#78716C]" />
        <span className="text-sm text-[#1C1917] dark:text-[#FAFAF9]">开发者的话</span>
      </div>
      <p className="mt-1 pl-[30px] text-xs leading-[1.4] text-[#A8A29E]">
        ExoMind — 个人生命成长助手，探索生命与认知的本质。
      </p>
    </div>
  </SectionCard>
</section>
```

**Step 4: 运行测试验证通过**

**Step 5: Commit**

```bash
git add -A && git commit -m "feat(Settings): Version Info 重构为「关于」Section 对齐设计稿"
```

---

## Task 5: Developer Section — 确认 Mock Data Toggle 和功能开关对齐

**Files:**
- Modify: `src/ui/new/pages/NewSettingsPage.tsx`（如需调整）
- Test: `src/ui/new/pages/__tests__/NewSettingsPage.developer.test.tsx`

**Step 1: 写失败测试**

```tsx
describe('Settings - Developer Section', () => {
  it('renders mock data toggle when developer mode is on', () => {
    // 需要 mock developerMode = true
    expect(screen.getByText('使用测试数据')).toBeInTheDocument();
  });

  it('renders feature toggles row', () => {
    expect(screen.getByText('功能开关')).toBeInTheDocument();
  });

  it('renders old pages row', () => {
    expect(screen.getByText('旧版页面')).toBeInTheDocument();
  });
});
```

**Step 2: 运行测试验证**

**Step 3: 调整 Developer Section 对齐设计稿**

确认 Mock Data Row 使用 `database` 图标 + Switch，功能开关行有彩色图标点。

**Step 4: 运行测试验证通过**

**Step 5: Commit**

```bash
git add -A && git commit -m "feat(Settings): Developer Section 对齐设计稿 — Mock Data + 功能开关"
```

---

## Task 6: Section 排列顺序对齐设计稿

**Files:**
- Modify: `src/ui/new/pages/NewSettingsPage.tsx`

设计稿中 Settings Content 的 Section 顺序（从上到下）：
1. User Card
2. 外观 (Theme)
3. 计时器 (Timer)
4. 语音 (Voice)
5. 同步 (Sync)
6. 更多 (More) ← 新增
7. 法律与支持 (Legal) ← 新增
8. 关于 (About/Version) ← 重构
9. 开发者 (Developer) — 仅 developerMode 时显示

**Step 1: 调整 JSX 中 Section 顺序**

**Step 2: Commit**

```bash
git add -A && git commit -m "refactor(Settings): 调整 Section 排列顺序对齐设计稿"
```

---

## Task 7: Playwright E2E 测试

**Files:**
- Create: `e2e/settings-sections.spec.ts`

**Step 1: 编写 E2E 测试**

```ts
import { test, expect } from '@playwright/test';

test.describe('Settings Page Sections', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/new/settings');
  });

  test('More section is visible', async ({ page }) => {
    await expect(page.getByText('更多')).toBeVisible();
    await expect(page.getByText('检查更新')).toBeVisible();
    await expect(page.getByText('使用数据与分析')).toBeVisible();
    await expect(page.getByText('报告问题')).toBeVisible();
  });

  test('Legal section is visible', async ({ page }) => {
    await expect(page.getByText('法律与支持')).toBeVisible();
    await expect(page.getByText('隐私政策')).toBeVisible();
    await expect(page.getByText('用户协议')).toBeVisible();
    await expect(page.getByText('官网')).toBeVisible();
    await expect(page.getByText('赞助开发者')).toBeVisible();
    await expect(page.getByText('开源软件使用声明')).toBeVisible();
  });

  test('About section is visible', async ({ page }) => {
    await expect(page.getByText('关于')).toBeVisible();
    await expect(page.getByText('版本')).toBeVisible();
    await expect(page.getByText('构建')).toBeVisible();
  });

  test('User card has activate button', async ({ page }) => {
    await expect(page.getByText('激活')).toBeVisible();
  });
});
```

**Step 2: 运行 E2E 测试**

Run: `bunx playwright test e2e/settings-sections.spec.ts`

**Step 3: Commit**

```bash
git add -A && git commit -m "test(Settings): Playwright E2E 测试 — More/Legal/About/UserCard"
```

---

## Task 8: PR 描述更新 + 代码评审

**Step 1: 更新 PR 描述**

使用 `gh pr edit 219 --body-file pr-body.md` 更新完整 PR 描述。

**Step 2: 使用 requesting-code-review skill 进行代码评审**

**Step 3: 将评审结果写入 PR 评论**
