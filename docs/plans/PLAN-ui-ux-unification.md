# 前端 UI/UX 统一重构计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Issue**: #807
> **标准参照**: 信号网络页 (AgentsPage) Tab 规范

**Tech Stack:** React 18 + TypeScript, shadcn/ui (Radix), Tailwind CSS, Tauri v2

---

## 0. 现状诊断

| 问题 | 数量 | 严重度 |
|------|------|--------|
| 硬编码颜色 | 1,560 处 / 436 文件 | 🔴 |
| 原生 HTML `<select>` | 18 处 / 13 文件 | 🔴 |
| 手搓 Tab（非 Radix） | 3+ 页面 | 🟡 |
| 页面壳层无统一 | 15 个页面各自实现 | 🟡 |
| 缺少 shadcn Select | 组件库缺失 | 🔴 |

**已有但被忽略的基础**:
- `src/index.css` 已定义 28+ CSS 变量（`--brand-accent`, `--text-muted`, `--bg-card` 等）
- `tailwind.config.js` 已扩展了 `brand`, `success`, `warning` 等 color alias
- 13 个 shadcn/ui 组件已安装

---

## 1. Scope

### In Scope

- 设计 Token 补全 + 硬编码颜色批量迁移
- shadcn Select 组件引入 + 替换 18 处原生 select
- PageShell + PageTabs 统一组件提取
- 所有页面 Tab 收敛到 shadcn Tabs
- 页面壳层（header/content/footer）统一
- UI 规范文档

### Out of Scope

- 功能性改动（不改业务逻辑）
- 图标重设计（#795 单独处理）
- 品牌配色大改（保持现有配色，只做变量化）
- 新页面设计（如目标系统 v2）

---

## Task 1: 补全设计 Token + Tailwind 映射

**Files:**
- Modify: `src/index.css`
- Modify: `tailwind.config.js`
- Create: `docs/development/ui-spec.md`

**Step 1: 审计现有 CSS 变量，补缺失的**

当前已有的变量：
```css
--background, --foreground, --primary, --secondary
--brand, --brand-accent, --success, --warning, --destructive
--text-primary, --text-strong, --text-secondary, --text-muted
--bg-card, --bg-surface, --border-card, --border-subtle
--sidebar, --sidebar-foreground, --sidebar-border
```

需要补充的变量（从硬编码中提取）：

```css
:root {
  /* 页面级 */
  --page-bg: 30 33% 98%;            /* #FAF7F5 */
  --page-bg-dark: 20 14% 4%;        /* #0C0A09 */

  /* 交互态 */
  --active-bg: 14 56% 50%;          /* #C75B3A */
  --active-bg-hover: 14 59% 44%;    /* #B24D2F */
  --inactive-bg: 30 26% 94%;        /* #F5F0ED */
  --inactive-bg-dark: 24 10% 10%;   /* #1C1917 */

  /* 边框补充 */
  --border-page: 30 20% 92%;        /* #F0ECE8 */
  --border-input: 30 7% 89%;        /* #E7E5E4 */

  /* 输入域 */
  --input-text: 24 9% 24%;          /* #44403C */
  --input-text-dark: 30 7% 89%;     /* #E7E5E4 */
}
```

**Step 2: Tailwind 映射**

在 `tailwind.config.js` 的 `extend.colors` 中添加：

```js
page: {
  DEFAULT: 'hsl(var(--page-bg))',
  dark: 'hsl(var(--page-bg-dark))',
},
active: {
  DEFAULT: 'hsl(var(--active-bg))',
  hover: 'hsl(var(--active-bg-hover))',
},
inactive: {
  DEFAULT: 'hsl(var(--inactive-bg))',
  dark: 'hsl(var(--inactive-bg-dark))',
},
```

这样 `bg-[#FAF7F5]` → `bg-page`，`bg-[#C75B3A]` → `bg-active`。

**Step 3: 写 UI 规范文档**

Create `docs/development/ui-spec.md`:

内容包含：
1. 颜色 Token 表（变量名 → HSL → 用途）
2. Tab 实现标准（必须用 shadcn Tabs）
3. Select 实现标准（必须用 shadcn Select）
4. 页面壳层标准（必须用 PageShell）
5. 禁止事项清单：
   - ❌ 禁止 `bg-[#xxx]` 硬编码颜色
   - ❌ 禁止手搓 Tab / Select / Dialog
   - ❌ 禁止 native HTML `<select>`
   - ✅ 必须用 CSS 变量 / Tailwind token
   - ✅ 必须用 shadcn/ui 组件

**验证:**
```bash
npx tsc --noEmit
```

---

## Task 2: 引入 shadcn Select 组件

**Files:**
- Create: `src/components/ui/select.tsx`
- Modify: 13 个文件中的 18 处 `<select>`

**Step 1: 添加 shadcn Select**

```bash
npx shadcn@latest add select
```

如果 CLI 不可用，手动从 shadcn/ui 文档复制 Select 组件代码到 `src/components/ui/select.tsx`。

基于 Radix Select primitive:
```tsx
import * as SelectPrimitive from '@radix-ui/react-select';
// Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup, SelectLabel
```

**Step 2: 逐文件替换原生 select**

按优先级排序（用户最常见的页面优先）：

| 优先 | 文件 | select 数量 | 说明 |
|------|------|------------|------|
| 1 | `TaskDetailPage.tsx` | 3 | 任务依赖选择 |
| 2 | `BlockTaskAssociationList.tsx` | 1 | 时间块关联任务 |
| 3 | `prestart-task-selection.tsx` | 1 | 预选任务 |
| 4 | `NowTodayPlannerTimeline.tsx` | 1 | 今日计划 |
| 5 | `ai-registry-settings-card.tsx` | 多个 | AI 设置 |
| 6 | `settings-renderers.tsx` | 多个 | 通用设置渲染 |
| 7 | `agents-sheets.tsx` | 1 | Agent 配置 |
| 8 | `GoalsPage.tsx` | 1 | 目标系统 |
| 9 | `SplitEdgeDialog.tsx` | 1 | 目标拆分 |
| 10 | `PtySpawnDialog.tsx` | 1 | PTY 终端 |
| 11 | `UpdateSettingsCard.tsx` | 1 | 更新设置 |
| 12 | `RouteEditPanel.tsx` | 1 | 信号路由编辑 |
| 13 | `TimeBlockWidget.tsx` | 1 | 时间块 |

替换模式：

```tsx
// Before (原生)
<select className="w-full rounded-xl border border-[#E7E5E4] ..."
  value={value} onChange={e => setValue(e.target.value)}>
  <option value="a">选项 A</option>
</select>

// After (shadcn)
<Select value={value} onValueChange={setValue}>
  <SelectTrigger className="w-full">
    <SelectValue placeholder="选择..." />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="a">选项 A</SelectItem>
  </SelectContent>
</Select>
```

**验证:**
```bash
npx tsc --noEmit
npx vitest run
```

---

## Task 3: 提取 PageShell + PageTabs 统一组件

**Files:**
- Create: `src/ui/app/components/PageShell.tsx`
- Create: `src/ui/app/components/PageTabs.tsx`

**Step 1: PageShell 组件**

```tsx
interface PageShellProps {
  title: string;
  subtitle?: string;
  headerAction?: ReactNode;
  children: ReactNode;
  /** 隐藏 header（如设置页由外层提供 header） */
  hideHeader?: boolean;
}
```

标准布局：
```
<div className="flex h-full min-h-full flex-col bg-page dark:bg-page-dark">
  {!hideHeader && (
    <header className="flex items-center justify-between border-b border-border-page px-5 py-3 md:px-6 lg:px-8">
      <h1 className="text-lg font-semibold text-foreground">{title}</h1>
      {headerAction}
    </header>
  )}
  <div className="min-h-0 flex-1 overflow-y-auto">
    {children}
  </div>
</div>
```

**Step 2: PageTabs 组件**

基于 shadcn Tabs，提供两种 variant:

```tsx
interface PageTabsProps {
  tabs: Array<{ id: string; label: string; icon?: ReactNode }>;
  activeTab: string;
  onTabChange: (tab: string) => void;
  /** grid: 等分网格（≤4 tab）; scroll: 横向滚动（>4 tab / 移动端） */
  variant?: 'grid' | 'scroll';
  children: ReactNode; // TabsContent
}
```

Grid variant（信号网络页标准）:
```tsx
<TabsList className="grid h-auto w-full grid-cols-{N} rounded-xl border border-border-card bg-card p-1 shadow-sm">
  {tabs.map(tab => (
    <TabsTrigger key={tab.id} value={tab.id} className="h-9 flex-1 gap-1.5 rounded-lg">
      {tab.icon} {tab.label}
    </TabsTrigger>
  ))}
</TabsList>
```

Scroll variant（移动端 / 多 tab）:
```tsx
<TabsList className="scrollbar-none flex gap-2 overflow-x-auto rounded-xl p-1">
  {tabs.map(tab => (
    <TabsTrigger key={tab.id} value={tab.id} className="shrink-0 rounded-full px-3 py-1.5">
      {tab.icon} {tab.label}
    </TabsTrigger>
  ))}
</TabsList>
```

**验证:**
```bash
npx tsc --noEmit
```

---

## Task 4: 各页面收敛到 PageShell + PageTabs

**Files:** 修改以下所有页面

### 4.1 当下页 (NowPage.tsx)

当前：已用 shadcn Tabs，结构接近标准。
改动：套 PageShell，Tab 样式对齐信号网络页标准（加 border + shadow）。

### 4.2 Me 页 (MePage.tsx)

当前：手搓 button + useState。
改动：
- 移除手动 active state 管理
- 替换为 PageTabs（grid variant, 3 cols）
- 套 PageShell

### 4.3 提醒页 (RemindersPage.tsx)

当前：手搓 button。
改动：同 Me 页，替换为 PageTabs。

### 4.4 任务详情页 (TaskDetailPage.tsx)

当前：手搓 sticky pill tabs。
改动：替换为 PageTabs（scroll variant for mobile, grid for desktop）。

### 4.5 任务页 (TasksPage.tsx)

当前：无内部 tab，用 Link 跳转到子页面。
改动：评估是否需要 tab 化。如果保持 Link 模式，至少套 PageShell 统一 header。

### 4.6 信号网络页 (AgentsPage.tsx)

当前：已是标准。
改动：套 PageShell（可能 hideHeader，因为页面结构特殊），确保 WorkspaceTabs 的子 tab 使用 PageTabs。

### 4.7 设置页 (SettingsPage.tsx)

当前：Registry 驱动，无 tab。
改动：保持现有模式，但套 PageShell（hideHeader）。确保内部组件使用统一 token。

### 4.8 其他页面

TaskTimelinePage, TaskDagPage, TimeBlockDetailPage, FocusPage 等：
- 套 PageShell
- 确保 header 格式统一

**每个页面改完后验证:**
```bash
npx tsc --noEmit
```

---

## Task 5: 硬编码颜色批量迁移

**Files:** 436 个文件，1,560 处

**策略: 分批替换，高频先行**

### 5.1 建立替换映射表

| 硬编码 | 替换为 | 出现次数 |
|--------|--------|---------|
| `bg-[#FAF7F5]` | `bg-page` | 41 |
| `dark:bg-[#0C0A09]` | `dark:bg-page-dark` | 26 |
| `bg-[#C75B3A]` | `bg-active` | 61 |
| `text-[#78716C]` | `text-muted-foreground` | 77 |
| `text-[#A8A29E]` | `text-muted` | 121 |
| `border-[#E7E5E4]` | `border-border` | 75 |
| `dark:border-[#292524]` | `dark:border-border` | 119 |
| `bg-[#1C1917]` | `dark:bg-card` | 119 |
| `bg-[#F5F0ED]` | `bg-inactive` | 32 |
| `text-[#57534E]` | `text-foreground` | 32 |
| `text-[#FAFAF9]` | `dark:text-foreground` | 66 |
| `text-[#D6D3D1]` | `dark:text-muted-foreground` | 41 |
| `bg-[#F0ECE8]` | `border-page` | 16 |
| `text-[#44403C]` | `text-input` | 14 |

### 5.2 执行策略

**用 IDE 全局替换或脚本批量处理**，按颜色分批：

Round 1: 背景色（`bg-[#FAF7F5]` → `bg-page` 等）
Round 2: 文字色（`text-[#78716C]` → `text-muted-foreground` 等）
Round 3: 边框色（`border-[#E7E5E4]` → `border-border` 等）
Round 4: 交互色（`bg-[#C75B3A]` → `bg-active` 等）
Round 5: 剩余零散色值

**每轮替换后验证:**
```bash
npx tsc --noEmit
npx vitest run
bun dev  # 视觉检查
```

### 5.3 添加 lint 规则（可选）

在 `.eslintrc` 或自定义脚本中添加规则，**禁止新的硬编码颜色**：

```bash
# 检查是否还有硬编码颜色
grep -r 'bg-\[#\|text-\[#\|border-\[#' src/ --include='*.tsx' --include='*.ts' | wc -l
# 目标: 0
```

---

## Task 6: UI 规范文档

**File:** Create `docs/development/ui-spec.md`

内容大纲:

```markdown
# ExoMind UI 规范

## 强制规则

### 1. 颜色
- ✅ 必须使用 CSS 变量 / Tailwind token
- ❌ 禁止 bg-[#xxx] / text-[#xxx] / border-[#xxx]
- 颜色 Token 速查表...

### 2. 组件
- ✅ Tab → shadcn Tabs (Radix)
- ✅ Select → shadcn Select (Radix)
- ✅ Dialog → shadcn Dialog (Radix)
- ✅ 页面壳 → PageShell
- ❌ 禁止手搓 Tab / Select / Dialog
- ❌ 禁止原生 HTML <select>

### 3. 页面结构
- 所有页面必须使用 PageShell
- Tab 使用 PageTabs（grid 或 scroll variant）
- Header 标准: title + action area, border-b

### 4. 响应式
- 标准断点: md (768px) / lg (1024px)
- 标准间距: px-5 md:px-6 lg:px-8

### 5. 深色模式
- 所有组件必须有 dark: 变体
- 使用 CSS 变量自动切换
```

---

## Task 7: 最终验证

**Step 1: 全量检查**
```bash
npx tsc --noEmit
npx vitest run
bun build
```

**Step 2: 硬编码颜色清零检查**
```bash
grep -r 'bg-\[#\|text-\[#\|border-\[#' src/ --include='*.tsx' --include='*.ts' | wc -l
# 目标: 0
```

**Step 3: 原生 select 清零检查**
```bash
grep -r '<select' src/ --include='*.tsx' | wc -l
# 目标: 0
```

**Step 4: 视觉验证**
```bash
bun dev
```
逐页面检查：当下、任务、Me、信号网络、提醒、设置、任务详情。

---

## 验收标准 (DoD)

- [ ] `npx tsc --noEmit` 通过
- [ ] `npx vitest run` 全部通过
- [ ] `bun build` 成功
- [ ] 硬编码颜色 grep 结果 = 0
- [ ] 原生 `<select>` grep 结果 = 0
- [ ] 所有 Tab 使用 shadcn Tabs
- [ ] 所有页面使用 PageShell
- [ ] `docs/development/ui-spec.md` 已创建
- [ ] 深色模式全页面一致
- [ ] 视觉回归无异常

## 分支

```
feature/issue-807-ui-unification
```

目标合并到 `dev`。

## 执行建议

7 个 Task 有依赖关系：

```
Task 1 (Token 补全) ← 其他 Task 都依赖这个
Task 2 (Select 组件) ← Task 4 替换页面时用
Task 3 (PageShell/Tabs) ← Task 4 替换页面时用
Task 4 (页面收敛) ← 依赖 1+2+3
Task 5 (颜色迁移) ← 依赖 1，可与 4 并行
Task 6 (规范文档) ← 可随时写
Task 7 (验证) ← 最后
```

**建议拆成 2-3 个 Agent 并行**:
- Agent A: Task 1 → Task 5（Token + 颜色迁移）
- Agent B: Task 2 → Task 3（组件库）
- Agent C: Task 4（页面收敛，等 A+B 完成后开始）
- 最后: Task 6 + 7
