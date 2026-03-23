# Issue 136 Focus BGM Player Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 `#136` 落地专注过程背景音乐 / 白噪音播放能力，支持预设噪音、自定义本地音频、多文件顺序播放、循环播放，以及与专注计时联动的自动开始/停止。

**Architecture:** 新增 `focus-bgm-preferences` 作为本地设置真值（source of truth，真实来源），新增 `focus-bgm-player` 作为单例播放引擎（singleton player，单例播放器），通过设置页 `custom setting（自定义设置项）` 配置播放参数，再由 `FocusTimerWidget` 在专注开始 / 结束 / 暂停 / 恢复时驱动播放器。Tauri 端通过新增多音频文件选择命令返回绝对路径，前端按需读取二进制并生成 `blob:` URL 播放。

**Tech Stack:** React 18, TypeScript, Vitest, Tauri v2, tauri-plugin-dialog, localStorage, HTMLAudioElement, Web Audio API

---

### Task 1: 定义 BGM 偏好与预设模型

**Files:**
- Create: `src/config/focus-bgm-preferences.ts`
- Create: `src/lib/media/focus-bgm-presets.ts`
- Test: `tests/unit/config/focus-bgm-preferences.test.ts`

**Step 1: Write the failing test**

- 覆盖默认值、非法值归一化、`subscribe` 触发、`multiple tracks（多轨）` 持久化。

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/config/focus-bgm-preferences.test.ts`

Expected: FAIL because the module does not exist yet.

**Step 3: Write minimal implementation**

- 定义：
  - `enabled`
  - `sourceType: 'preset' | 'custom'`
  - `presetId`
  - `customTracks: { path: string; name: string }[]`
  - `playbackMode: 'loop' | 'sequence'`
  - `stopBehavior: 'timer-end' | 'manual-end'`
  - `volume`
- 提供 `get/set/update/subscribe`。

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/config/focus-bgm-preferences.test.ts`

Expected: PASS

### Task 2: 补 Tauri 多音频文件选择能力

**Files:**
- Modify: `src-tauri/src/commands/file_commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `src/lib/media/focus-bgm-file-picker.ts`
- Test: `tests/unit/media/focus-bgm-file-picker.test.ts`

**Step 1: Write the failing test**

- 覆盖：
  - Web 下返回“不支持持久本地音频选择”
  - Tauri 下调用 `pick_audio_files`
  - 返回多文件时保留文件名与路径顺序

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/media/focus-bgm-file-picker.test.ts`

Expected: FAIL because picker helpers do not exist yet.

**Step 3: Write minimal implementation**

- Rust 新增 `pick_audio_files` 命令，过滤常见音频扩展名并支持 `blocking_pick_files()`
- TS 新增文件选择封装与返回类型

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/media/focus-bgm-file-picker.test.ts`

Expected: PASS

### Task 3: 实现背景音播放器单例

**Files:**
- Create: `src/lib/media/focus-bgm-player.ts`
- Test: `tests/unit/media/focus-bgm-player.test.ts`

**Step 1: Write the failing test**

- 覆盖：
  - 预设噪音开始播放 / 停止
  - 自定义多轨在 `sequence` 模式按顺序切换
  - `loop` 模式循环当前曲目
  - 修改音量后同步到当前播放实例

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/media/focus-bgm-player.test.ts`

Expected: FAIL because the player does not exist yet.

**Step 3: Write minimal implementation**

- 用单例管理当前 `Audio` / `AudioContext`
- 自定义本地音频通过 `read_file_binary` + `Blob URL` 播放
- 生成型噪音预设用 Web Audio API
- 暴露 `startFromPreferences / pause / resume / stop / toggle / subscribe`

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/media/focus-bgm-player.test.ts`

Expected: PASS

### Task 4: 在设置页落地 BGM 配置入口

**Files:**
- Modify: `src/ui/app/components/settings/settings-custom-items.tsx`
- Modify: `src/ui/app/config/settings/settings-registry.ts`
- Modify: `tests/unit/components/settings/setup-settings-mocks.tsx`
- Create: `tests/unit/settings/settings-focus-bgm.issue136.test.tsx`

**Step 1: Write the failing test**

- 覆盖：
  - “专注背景音”行可见
  - 打开配置面板
  - 切换预设 / 本地音频来源
  - 选择播放模式 / 停止策略 / 音量
  - Tauri mock 下可选择多本地音频

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/settings/settings-focus-bgm.issue136.test.tsx`

Expected: FAIL because the BGM setting UI does not exist yet.

**Step 3: Write minimal implementation**

- 新增 `FocusBgmSetting`
- 注册到 `timer` 分类
- 行右侧显示当前摘要（例如 `白噪音 · 循环` / `3 首本地音频 · 顺序`）

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/settings/settings-focus-bgm.issue136.test.tsx`

Expected: PASS

### Task 5: 接入专注计时联动与运行中快捷控制

**Files:**
- Modify: `src/ui/app/components/FocusTimerWidget.tsx`
- Create: `tests/unit/components/FocusTimerWidget.bgm.issue136.test.tsx`

**Step 1: Write the failing test**

- 覆盖：
  - 专注开始时自动播放
  - 暂停时暂停 BGM，恢复时继续
  - 倒计时结束且 `stopBehavior='timer-end'` 时停止
  - 手动结束时总是停止
  - 运行态有 BGM 播放/暂停按钮

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/FocusTimerWidget.bgm.issue136.test.tsx`

Expected: FAIL because the widget does not control BGM yet.

**Step 3: Write minimal implementation**

- 在 `handleStart / handlePauseOrResume / handleOpenEndDialog / countdown end branch / submit end` 中接入播放器
- 增加运行态快捷按钮
- 避免影响现有提示音逻辑

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/FocusTimerWidget.bgm.issue136.test.tsx`

Expected: PASS

### Task 6: 回归验证

**Files:**
- Test: `tests/unit/components/FocusTimerWidget.countdown-end-settings.issue182.test.tsx`
- Test: `tests/unit/settings/settings-timer-card.issue182.test.tsx`
- Test: `tests/unit/settings/settings-focus-bgm.issue136.test.tsx`
- Test: `tests/unit/components/FocusTimerWidget.bgm.issue136.test.tsx`

**Step 1: Run targeted verification**

Run: `npx vitest run tests/unit/config/focus-bgm-preferences.test.ts tests/unit/media/focus-bgm-file-picker.test.ts tests/unit/media/focus-bgm-player.test.ts tests/unit/settings/settings-focus-bgm.issue136.test.tsx tests/unit/components/FocusTimerWidget.bgm.issue136.test.tsx tests/unit/components/FocusTimerWidget.countdown-end-settings.issue182.test.tsx tests/unit/settings/settings-timer-card.issue182.test.tsx`

Expected: PASS

**Step 2: Run typecheck**

Run: `npx tsc --noEmit`

Expected: PASS
