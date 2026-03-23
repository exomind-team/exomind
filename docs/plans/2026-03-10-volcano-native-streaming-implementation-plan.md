# Volcano Native Streaming Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将全局语音快捷键在火山 provider 下改为 provider-native streaming（提供商原生流式），让悬浮窗实时展示火山中间结果，并在停录后几乎直接拿到同一条链路的最终结果。

**Architecture:** 前端在火山模式下不再走 `MediaRecorder -> 整段 WAV -> volcano_asr_recognize`，而是用 Web Audio 采集 16k PCM 并按 200ms 分包推给 Rust。Rust 维护火山 WebSocket 流式会话，持续把 partial / final 事件回传前端；前端悬浮窗直接消费这些事件，最终结果仍走现有剪贴板 + EventLog 双写。

**Tech Stack:** React 18 + TypeScript、Tauri v2、Rust、tokio-tungstenite、Vitest、cargo test

---

### Task 1: 先锁定火山原生流式的前端行为

**Files:**
- Modify: `tests/unit/services/voice-shortcut.service.test.ts`
- Test: `tests/unit/pages/VoiceOverlayPage.test.tsx`

**Step 1: Write the failing test**

- 新增一个火山模式测试：
  - `start` 后调用 `volcano_asr_stream_start`
  - 录音期间通过流式事件推动悬浮窗实时文字
  - `stop` 后调用 `volcano_asr_stream_finish`
  - 最终结果写入剪贴板和 EventLog
- 不再要求火山路径调用 `convertWebmBlobToWav` / `volcano_asr_recognize`

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/services/voice-shortcut.service.test.ts`

Expected: FAIL，提示火山模式仍在调用旧的整段识别接口。

**Step 3: Write minimal implementation**

- 仅先搭前端火山分支的接口形态，不完成细节。

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/services/voice-shortcut.service.test.ts`

Expected: PASS

### Task 2: 提取前端火山 PCM 流式采集器

**Files:**
- Create: `src/lib/asr/volcano-streaming-capture.ts`
- Modify: `src/services/voice-shortcut.service.ts`
- Test: `tests/unit/lib/volcano-streaming-capture.test.ts`

**Step 1: Write the failing test**

- 断言采集器能够：
  - 从 `MediaStream` 生成 16kHz mono PCM
  - 累积到约 200ms（3200 samples / 6400 bytes）时输出 chunk
  - `stop` 时 flush 剩余样本

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/volcano-streaming-capture.test.ts`

Expected: FAIL，模块不存在。

**Step 3: Write minimal implementation**

- 封装 `AudioContext + MediaStreamSource + ScriptProcessor`
- 输出 `Int16 PCM` chunk
- 提供 `start / stop / cancel`

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/volcano-streaming-capture.test.ts`

Expected: PASS

### Task 3: Rust 侧引入火山流式会话管理

**Files:**
- Modify: `src-tauri/src/commands/asr_commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/commands/asr_commands.rs`

**Step 1: Write the failing test**

- 为 Rust helper 增加最小单测：
  - `bigmodel_async + flags=3` 能识别为 final
  - 流式事件 payload 生成时会正确标记 `partial / final`

**Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml volcano_stream`

Expected: FAIL，相关 helper 或命令不存在。

**Step 3: Write minimal implementation**

- 新增命令：
  - `volcano_asr_stream_start`
  - `volcano_asr_stream_push`
  - `volcano_asr_stream_finish`
  - `volcano_asr_stream_cancel`
- 新增 manager/state：
  - 管理活跃 session
  - WebSocket 后台任务接收 chunk
  - 将中间结果通过 Tauri event 发给前端

**Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml volcano_stream`

Expected: PASS

### Task 4: 接上 VoiceShortcutService 的火山原生流式分支

**Files:**
- Modify: `src/services/voice-shortcut.service.ts`
- Modify: `src/lib/asr/live-preview.ts`
- Test: `tests/unit/services/voice-shortcut.service.test.ts`

**Step 1: Write the failing test**

- 增加测试覆盖：
  - 火山模式不再使用浏览器 live preview
  - 录音时消费 `volcano-asr-stream-event`
  - `partial` 事件更新 overlay
  - `finish` 返回最终结果后写入落字链路

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/services/voice-shortcut.service.test.ts`

Expected: FAIL，服务仍走旧路径。

**Step 3: Write minimal implementation**

- 保留 MOSS 路径不变
- 火山路径改为：
  - start: `stream_start + PCM capture start`
  - recording: `stream_push`
  - stop: `capture stop + flush + stream_finish`
  - cancel: `stream_cancel`

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/services/voice-shortcut.service.test.ts`

Expected: PASS

### Task 5: 验证悬浮窗显示与回归

**Files:**
- Modify: `tests/unit/pages/VoiceOverlayPage.test.tsx`
- Verify: `src/pages/VoiceOverlayPage.tsx`

**Step 1: Write the failing test**

- 新增或调整断言：
  - 火山 partial 文本显示为实时预览
  - final 文本由同一条链路直接过渡为 done

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/pages/VoiceOverlayPage.test.tsx`

Expected: FAIL

**Step 3: Write minimal implementation**

- 若 payload 字段需要扩展，最小化修改页面展示逻辑。

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/pages/VoiceOverlayPage.test.tsx`

Expected: PASS

### Task 6: 全量验证

**Files:**
- Verify only

**Step 1: Run focused frontend tests**

Run: `npx vitest run tests/unit/lib/volcano-streaming-capture.test.ts tests/unit/services/voice-shortcut.service.test.ts tests/unit/pages/VoiceOverlayPage.test.tsx`

Expected: PASS

**Step 2: Run type check**

Run: `npx tsc --noEmit`

Expected: PASS

**Step 3: Run Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml volcano_stream`

Expected: PASS

**Step 4: Run build**

Run: `bun run build`

Expected: exit 0
