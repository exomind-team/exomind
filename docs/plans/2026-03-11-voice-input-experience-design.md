# Voice Input Experience Design

**Status:** Requirement frozen（需求已冻结，未进入方案变更）

**Goal:** Improve voice input behavior and voice overlay usability without mixing user intent with implementation details.

## Scope

This design covers two areas:

1. Voice input send behavior（语音输入发送行为）
2. Voice overlay display preferences（语音悬浮窗显示偏好）

## User Intent

### 1. `Now` page voice behavior must stay independent

- The `Now` page setting only applies to the in-app `Now` input flow.
- Its `direct send` meaning is: send recognized text directly into the `event stream（信息流）`.
- It is **not** an Enter key simulation.
- It is **not** the same as chat send behavior.

### 2. Chat / external input voice behavior must be a separate setting

- Agent chat and other external input targets need an independent setting.
- The setting meaning is:
  - insert recognized text at the current cursor target
  - optionally trigger `auto enter send（自动回车发送）`
- This behavior must not affect the `Now` page event-stream workflow.

### 3. Voice overlay diagnostics are display-only

- Diagnostic details like first frame, microphone readiness, session readiness, activation delay, and first text latency are display-layer content.
- They need a user-visible on/off switch.
- Toggling diagnostics must not change recognition behavior.

### 4. Overlay transcript area must be configurable

- Real-time transcript content must no longer behave like a near-single-line view.
- Users need a configurable line count from `1` to `5`.
- Default value is `3` lines.

### 5. Overlay position must be configurable

- The overlay should avoid visually conflicting with the Windows taskbar area.
- Users should be able to adjust the vertical placement through settings.
- Default placement should already be lifted enough to avoid taskbar obstruction.

## Product Settings Definition

### `Now` page

- Setting name: `当下页语音转写后`
- Options:
  - `插入输入框`
  - `直接发送到信息流`
- Default: `插入输入框`

### Chat / external input

- Setting name: `聊天与外部输入语音完成后`
- Options:
  - `仅插入文本`
  - `自动回车发送`
- Default: `仅插入文本`

### Voice overlay

- Setting name: `显示语音悬浮窗诊断信息`
- Options:
  - `关闭`
  - `开启`
- Default: `关闭`

- Setting name: `悬浮窗实时文本行数`
- Range:
  - `1` to `5`
- Default: `3`

- Setting name: `悬浮窗距任务栏间距`
- Type:
  - adjustable value（可调节数值）
- Default:
  - should visually avoid the taskbar in normal Windows desktop layout

## Acceptance Criteria

### Behavior separation

- Changing the `Now` page voice setting only affects `Now`.
- Changing the chat / external input voice setting only affects chat and external input targets.
- `Now` direct send must continue to mean `send into event stream`.
- Chat / external auto send must mean `insert + immediate send`.

### Overlay preferences

- Disabling diagnostics hides diagnostic detail rows while preserving core status and transcript text.
- Transcript line count supports `1` through `5` and defaults to `3`.
- Adjusting overlay position changes the visible vertical placement.
- Default overlay placement avoids covering the taskbar area in the normal Windows desktop case.

## Non-Goals

- No change to ASR provider selection semantics.
- No change to recognition engine internals.
- No change to event-log write semantics outside the clarified behavior split.
