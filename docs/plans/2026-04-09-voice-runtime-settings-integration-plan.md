# Voice Tab Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把当前分散在设置页、语音实验台、快捷语音输入里的语音能力整理成一个独立的 `语音（Voice）` 顶层 Tab，并按能力拆成 `快捷语音输入` 与 `常驻语音助手` 两个可同时开启的模块，优先适配 `Doubao Realtime（豆包实时）` 和 `qwen3.5-omni-plus / Omni Compatible（千问半实时）`。

**Architecture:** 设置页新增 `voice（语音）` 顶层分类与桌面顶栏 Tab。语音页内部不再按“输入大类 + 诊断页”组织，而是按能力组织：`快捷语音输入` 是独立的 ASR / 文本输入能力，`常驻语音助手` 是更高阶的 assistant runtime，内部再选 `按键说话 / 环境监听` 模式。每个能力组都先选 `Provider（提供商）`，再显示对应配置；诊断不单独成页，而是挂在各 provider 的高级区中。

**Tech Stack:** React 18 + TypeScript, Tauri v2, registry-driven settings（注册表驱动设置页）, Vitest

---

## Final Product Decisions（最终产品决策）

1. 设置页新增一个顶层 `语音` Tab，不再把语音能力塞在 `输入` Tab 下面。
2. `语音` Tab 内有两个并列能力组：
   - `快捷语音输入`
   - `常驻语音助手`
3. 这两个能力组都各自有开关，可以同时开启，不是互斥关系。
4. `常驻语音助手` 内部模式首期保持单选：
   - `按键说话`
   - `环境监听`
5. `快捷语音输入` 和 `常驻语音助手` 都是“先选 Provider，再出现对应配置项”。
6. `语音诊断` 不再作为独立二级 Tab 或独立设置分组，而是挂在各 provider 的高级区里，因为不同 provider 的原始事件与诊断内容不同。
7. `Doubao Realtime` 是正式实时对话主路径；`qwen3.5-omni-plus / Omni Compatible` 是正式半实时主路径；`Omni Realtime` 保留实验属性。

## Scope（范围）

- 新增 `voice` 设置分类与顶层 Tab
- 整理 `快捷语音输入` 的 provider 选择与配置显示
- 整理 `常驻语音助手` 的模式、provider 选择与配置显示
- 将 `Doubao` 与 `Omni Compatible` 作为正式主支持 provider
- 将诊断入口嵌入 provider 高级区，而不是独立诊断页配置入口

## Non-Goals（本轮非目标）

- 不在本轮支持 `常驻语音助手` 同时启用 `按键说话 + 环境监听`
- 不在本轮改造底层音频采集架构
- 不在本轮解决 `qwen3.5-omni-plus-realtime` 权限问题
- 不在本轮统一所有设置页为通用“双层 Tab 框架”，只先把语音页做出来

---

### Task 1: 增加顶层 `语音` Tab 与 `voice` 分类

**Files:**
- Modify: `src/ui/app/config/settings/settings-types.ts`
- Modify: `src/ui/app/config/settings/desktop-tab-config.ts`
- Modify: `src/ui/app/layouts/MobileSettingsLayout.tsx`
- Modify: `src/ui/app/layouts/DesktopSettingsLayout.tsx`
- Test: `tests/unit/settings/settings-desktop-vc-tabs.issue198.test.tsx`
- Test: `tests/unit/settings/settings-layouts.test.tsx`

**Step 1: Write the failing test**

增加测试，断言：
- 顶层 Tab 出现 `语音`
- 原先语音相关条目不再混在 `输入`
- `语音` Tab 能正常滚动到对应 section

**Step 2: Run test to verify it fails**

Run:

```bash
bunx vitest run tests/unit/settings/settings-desktop-vc-tabs.issue198.test.tsx tests/unit/settings/settings-layouts.test.tsx
```

Expected: FAIL

**Step 3: Write minimal implementation**

- 在 `Category` 中新增 `voice`
- 在桌面顶栏 Tab 配置中新增 `voice`
- 在移动端 section 顺序和标题里加入 `语音`

**Step 4: Run test to verify it passes**

Run:

```bash
bunx vitest run tests/unit/settings/settings-desktop-vc-tabs.issue198.test.tsx tests/unit/settings/settings-layouts.test.tsx
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/ui/app/config/settings/settings-types.ts src/ui/app/config/settings/desktop-tab-config.ts src/ui/app/layouts/MobileSettingsLayout.tsx src/ui/app/layouts/DesktopSettingsLayout.tsx tests/unit/settings/settings-desktop-vc-tabs.issue198.test.tsx tests/unit/settings/settings-layouts.test.tsx
git commit -m "feat: add top-level voice settings tab"
```

---

### Task 2: 用两个能力组重构语音设置入口

**Files:**
- Modify: `src/ui/app/config/settings/settings-registry.ts`
- Modify: `tests/unit/settings/voice-runtime-settings-registry.test.ts`
- Modify: `tests/unit/settings/settings-registry-coverage.test.ts`
- Modify: `tests/unit/settings/settings-input-section.issue199.test.tsx`

**Step 1: Write the failing test**

断言 `语音` 分类下出现两个 group：
- `快捷语音输入`
- `常驻语音助手`

并且：
- 两者都有独立开关
- 不再有独立的“语音诊断” group

**Step 2: Run test to verify it fails**

Run:

```bash
bunx vitest run tests/unit/settings/voice-runtime-settings-registry.test.ts tests/unit/settings/settings-registry-coverage.test.ts tests/unit/settings/settings-input-section.issue199.test.tsx
```

Expected: FAIL

**Step 3: Write minimal implementation**

在 registry 中：
- 把原先平铺的语音条目改成两个 group
- `快捷语音输入` group 包含快捷键语音输入相关条目
- `常驻语音助手` group 包含运行时对话相关条目

**Step 4: Run test to verify it passes**

Run:

```bash
bunx vitest run tests/unit/settings/voice-runtime-settings-registry.test.ts tests/unit/settings/settings-registry-coverage.test.ts tests/unit/settings/settings-input-section.issue199.test.tsx
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/ui/app/config/settings/settings-registry.ts tests/unit/settings/voice-runtime-settings-registry.test.ts tests/unit/settings/settings-registry-coverage.test.ts tests/unit/settings/settings-input-section.issue199.test.tsx
git commit -m "refactor: split voice settings into input and assistant groups"
```

---

### Task 3: 让 `快捷语音输入` 变成“先选 provider，再显示配置”

**Files:**
- Create: `src/ui/app/components/settings/voice-input-provider-settings.tsx`
- Modify: `src/ui/app/components/settings/settings-custom-items.tsx`
- Modify: `src/ui/app/config/settings/settings-registry.ts`
- Test: `tests/unit/components/settings/voice-input-provider-settings.test.tsx`

**Step 1: Write the failing test**

覆盖：
- 选 `MOSS` 时显示 MOSS 对应配置
- 选 `火山` 时显示火山对应配置
- 选 `Qwen Omni` 时显示 Qwen Omni 对应配置

**Step 2: Run test to verify it fails**

Run:

```bash
bunx vitest run tests/unit/components/settings/voice-input-provider-settings.test.tsx
```

Expected: FAIL

**Step 3: Write minimal implementation**

做一个专门的设置组件：
- 读取 `getVoiceShortcutAsrProvider()`
- 按 provider 渲染对应配置
- 各 provider 的诊断项挂在高级区里

**Step 4: Run test to verify it passes**

Run:

```bash
bunx vitest run tests/unit/components/settings/voice-input-provider-settings.test.tsx
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/ui/app/components/settings/voice-input-provider-settings.tsx src/ui/app/components/settings/settings-custom-items.tsx src/ui/app/config/settings/settings-registry.ts tests/unit/components/settings/voice-input-provider-settings.test.tsx
git commit -m "feat: add provider-driven voice input settings"
```

---

### Task 4: 让 `常驻语音助手` 变成“先选模式，再选 provider，再显示配置”

**Files:**
- Create: `src/ui/app/components/settings/voice-assistant-provider-settings.tsx`
- Modify: `src/ui/app/components/settings/settings-custom-items.tsx`
- Modify: `src/ui/app/config/settings/settings-registry.ts`
- Modify: `src/config/voice-runtime-settings.ts`
- Modify: `src/config/voice-runtime-mode.ts`
- Test: `tests/unit/components/settings/voice-assistant-provider-settings.test.tsx`

**Step 1: Write the failing test**

覆盖：
- `常驻语音助手` 可开启 / 关闭
- 模式只能二选一：`按键说话 / 环境监听`
- 选择 `Doubao` 时显示其配置
- 选择 `Omni Compatible` 时显示其配置
- `Omni Compatible` 下若模式为 `环境监听`，UI 要明确禁用或提示不支持

**Step 2: Run test to verify it fails**

Run:

```bash
bunx vitest run tests/unit/components/settings/voice-assistant-provider-settings.test.tsx
```

Expected: FAIL

**Step 3: Write minimal implementation**

组件职责：
- 先显示模式选择
- 再显示 provider 选择
- 再按 provider 渲染配置区
- 每个 provider 自己带高级 / 诊断折叠区

**Step 4: Run test to verify it passes**

Run:

```bash
bunx vitest run tests/unit/components/settings/voice-assistant-provider-settings.test.tsx
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/ui/app/components/settings/voice-assistant-provider-settings.tsx src/ui/app/components/settings/settings-custom-items.tsx src/ui/app/config/settings/settings-registry.ts src/config/voice-runtime-settings.ts src/config/voice-runtime-mode.ts tests/unit/components/settings/voice-assistant-provider-settings.test.tsx
git commit -m "feat: add mode and provider driven assistant settings"
```

---

### Task 5: 把 Doubao / Omni Compatible 的正式配置迁回设置，并把诊断嵌到 provider 高级区

**Files:**
- Modify: `src/config/voice-runtime-doubao.ts`
- Modify: `src/config/voice-runtime-omni.ts`
- Modify: `src/config/voice-runtime-omni-compatible.ts`
- Modify: `src/ui/app/pages/voice-runtime/VoiceRuntimeLabPage.tsx`
- Modify: `src/ui/app/pages/voice-runtime/voice-runtime-lab-controller.ts`
- Test: `tests/unit/pages/voice-runtime/VoiceRuntimeLabPage.test.tsx`
- Test: `tests/unit/pages/voice-runtime/voice-runtime-lab-controller.test.ts`

**Step 1: Write the failing test**

断言：
- 正式配置在设置页即可完成
- 诊断项保留，但只作为 provider 高级区或联调区内容
- `Omni Compatible` 仍明确为 `Semi-realtime（半实时）`

**Step 2: Run test to verify it fails**

Run:

```bash
bunx vitest run tests/unit/pages/voice-runtime/VoiceRuntimeLabPage.test.tsx tests/unit/pages/voice-runtime/voice-runtime-lab-controller.test.ts
```

Expected: FAIL

**Step 3: Write minimal implementation**

- 将正式 provider 配置迁回设置页
- 实验页改成更纯粹的联调 / 验证页
- 诊断入口在语音设置里通过 provider 高级区跳转或展开

**Step 4: Run test to verify it passes**

Run:

```bash
bunx vitest run tests/unit/pages/voice-runtime/VoiceRuntimeLabPage.test.tsx tests/unit/pages/voice-runtime/voice-runtime-lab-controller.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/config/voice-runtime-doubao.ts src/config/voice-runtime-omni.ts src/config/voice-runtime-omni-compatible.ts src/ui/app/pages/voice-runtime/VoiceRuntimeLabPage.tsx src/ui/app/pages/voice-runtime/voice-runtime-lab-controller.ts tests/unit/pages/voice-runtime/VoiceRuntimeLabPage.test.tsx tests/unit/pages/voice-runtime/voice-runtime-lab-controller.test.ts
git commit -m "refactor: move provider config into voice settings"
```

---

### Task 6: 统一运行边界并验收主路径

**Files:**
- Modify: `src/services/voice-shortcut.service.ts`
- Modify: `src/services/voice-runtime-agent.service.ts`
- Modify: `src/lib/services/voice-signal.service.ts`
- Test: `tests/unit/services/voice-shortcut.service.test.ts`
- Test: `tests/unit/pages/voice-runtime/voice-runtime-lab-controller.optimistic-updates.test.ts`
- Test: `tests/unit/lib/voice-runtime/providers/qwen-omni-compatible-provider.test.ts`

**Step 1: Write the failing test**

断言：
- `快捷语音输入` 与 `常驻语音助手` 可以同时开启
- `常驻语音助手` 内部模式仍然单选
- `Omni Compatible` 不抢占 `Doubao` 的全局持续监听配置
- 统一文本总线仍然生效

**Step 2: Run test to verify it fails**

Run:

```bash
bunx vitest run tests/unit/services/voice-shortcut.service.test.ts tests/unit/pages/voice-runtime/voice-runtime-lab-controller.optimistic-updates.test.ts tests/unit/lib/voice-runtime/providers/qwen-omni-compatible-provider.test.ts
```

Expected: FAIL 或缺少覆盖

**Step 3: Write minimal implementation**

- 收敛 `快捷语音输入` 与 `常驻语音助手` 的配置边界
- 保留本地 provider 隔离
- 补齐 `Doubao` 与 `qwen3.5-omni-plus` 主路径验证

**Step 4: Run full verification**

Run:

```bash
bunx tsc --noEmit
bunx vitest run tests/unit/settings/voice-runtime-settings-registry.test.ts tests/unit/settings/settings-registry-coverage.test.ts tests/unit/settings/settings-input-section.issue199.test.tsx tests/unit/settings/settings-layouts.test.tsx tests/unit/settings/settings-desktop-vc-tabs.issue198.test.tsx tests/unit/components/settings/voice-input-provider-settings.test.tsx tests/unit/components/settings/voice-assistant-provider-settings.test.tsx tests/unit/pages/voice-runtime/VoiceRuntimeLabPage.test.tsx tests/unit/pages/voice-runtime/voice-runtime-lab-controller.test.ts tests/unit/pages/voice-runtime/voice-runtime-lab-controller.optimistic-updates.test.ts tests/unit/services/voice-shortcut.service.test.ts tests/unit/lib/voice-runtime/providers/qwen-omni-compatible-provider.test.ts
```

Expected: PASS

**Step 5: Manual verification**

在 `1420` 端口桌面实例验证：
- `快捷语音输入` 可独立配置并工作
- `常驻语音助手` 可独立配置并工作
- `Doubao Realtime` 的环境监听路径可用
- `qwen3.5-omni-plus / Omni Compatible` 的按住说话路径可用
- 两个能力可同时开启

**Step 6: Commit**

```bash
git add .
git commit -m "feat: integrate voice tab with input and assistant capabilities"
```

---

## Acceptance Checklist（验收清单）

- 设置页顶层出现 `语音` Tab
- `语音` Tab 内有两个能力组：`快捷语音输入`、`常驻语音助手`
- 两个能力组可同时开启
- `常驻语音助手` 的 `按键说话 / 环境监听` 首期保持单选
- 两个能力组都是“先选 provider，再显示配置”
- 诊断不再单独成分组，而是进入 provider 高级区
- `Doubao Realtime` 与 `qwen3.5-omni-plus / Omni Compatible` 是正式主支持路径
- 实验页保留，但不再承担正式配置职责

## Suggested Execution Order（建议执行顺序）

1. Task 1
2. Task 2
3. Task 3
4. Task 4
5. Task 5
6. Task 6
