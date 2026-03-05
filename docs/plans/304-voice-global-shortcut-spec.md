# #304 语音输入全局快捷键 + EventLog 双写 — 实现规范

> Issue: [#304](https://github.com/exomind-team/exomind/issues/304)
> Status: `planned`
> Created: 2026-03-05

## 概述

在桌面端注册全局快捷键，按下后开始录音，松开后 ASR 识别文本，双路输出：(A) 写入剪贴板并模拟 Ctrl+V 粘贴到当前光标位置；(B) 通过 SignalPool 发布 `user.input.voice` 信号写入 EventLog。替代 LazyTyper，实现完全集成在 ExoMind 内的语音输入体验。

## 用户故事

> 作为用户，我在任意应用中按下全局快捷键开始录音，松开后 ASR 识别，文本自动粘贴到光标位置，同时写入 EventLog。替代 LazyTyper。

**核心交互流程**：
```
按住 Alt+Q → 录音开始（系统托盘/悬浮指示）
  → 松开 Alt+Q → 录音停止 → ASR 识别（~1-3s）
  → 路径 A: 剪贴板写入 + 模拟 Ctrl+V（光标位置输出）
  → 路径 B: POST signal { topic: "user.input.voice" } → EventLog Actor 写入
```

---

## 技术方案

### 1. 全局快捷键注册

#### 1.1 方案选型

采用 **`tauri-plugin-global-shortcut`** (Tauri v2 官方插件)。

**当前状态**：
- Cargo.toml 中**未安装**此插件
- 前端快捷键仅在 `VoiceInputButton.tsx` 中通过 `window.addEventListener('keydown')` 实现（Space 触发，需窗口 focused）
- 无其他全局快捷键注册

**安装方式**：
```toml
# src-tauri/Cargo.toml [dependencies]
tauri-plugin-global-shortcut = "2"
```

**Capabilities 配置**（两个文件）：

```json
// 文件 1: src-tauri/capabilities/default.json
// 全局快捷键是应用级能力，加到主窗口 capability
{
  "permissions": [
    // ... 现有权限 ...
    "global-shortcut:allow-register",
    "global-shortcut:allow-unregister",
    "global-shortcut:allow-is-registered"
  ]
}
```

```json
// 文件 2: src-tauri/capabilities/voice-overlay.json（新建）
// 悬浮窗独立 capability，最小权限
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "voice-overlay",
  "description": "Capability for the voice overlay window",
  "windows": ["voice-overlay"],
  "permissions": [
    "core:default",
    "core:event:allow-listen",
    "core:event:allow-emit"
  ]
}
```

```rust
// src-tauri/src/lib.rs plugin 注册
.plugin(tauri_plugin_global_shortcut::init())
```

#### 1.2 快捷键设计

| 方案 | 键位 | 优点 | 缺点 |
|------|------|------|------|
| **A: PTT 按住/松开** (推荐) | `Alt+Q` 按住录音，松开停止 | 直觉（对讲机模式），防误触 | 需监听 keydown+keyup 事件 |
| B: Toggle | `Alt+Q` 按一次开始，再按一次停止 | 长录音不用持续按键 | 容易忘记停止 |
| C: 双击 | 快速双击 `Alt` | 无需占用字母键 | 误触率高，实现复杂 |

**推荐方案 A：PTT (Push-To-Talk) 模式**

理由：
1. LazyTyper 用户已习惯按住说话模式
2. PTT 天然防误触——松手即停
3. 桌面端语音输入通常是短句（5-30s），不需要长时间录音

**快捷键选择 `Alt+Q`**：
- `Alt` 修饰键 + 单字母，不与主流应用冲突
- `Q` 靠近左手，单手可操作（左手 Alt+Q，右手不需要离开鼠标）
- 不冲突分析：VS Code（Alt+Q 无绑定），Chrome（无绑定），Windows 系统（无绑定）
- 后续可在设置页自定义

#### 1.3 全局快捷键实现路径

**Rust 侧**（`src-tauri/src/commands/shortcut_commands.rs`）：
```rust
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

// 注册 PTT 快捷键
pub fn register_voice_shortcut(app: &AppHandle) {
    let shortcut = Shortcut::new(Some(Modifiers::ALT), Code::KeyQ);
    app.global_shortcut().on_shortcut(shortcut, |app, _shortcut, event| {
        match event.state {
            ShortcutState::Pressed => {
                // 发送 Tauri event 给前端: voice-recording-start
                app.emit("voice-shortcut", "start").ok();
            }
            ShortcutState::Released => {
                // 发送 Tauri event 给前端: voice-recording-stop
                app.emit("voice-shortcut", "stop").ok();
            }
        }
    });
}
```

**前端侧**（监听 Tauri event）：
```typescript
import { listen } from '@tauri-apps/api/event';

listen<string>('voice-shortcut', (event) => {
  if (event.payload === 'start') startRecording();
  if (event.payload === 'stop') stopAndRecognize();
});
```

### 2. 录音 + ASR

#### 2.1 复用现有资产

| 组件 | 路径 | 复用方式 |
|------|------|---------|
| `VoiceInputButton.tsx` | `src/components/VoiceInputButton.tsx` | 提取录音逻辑为独立 hook，UI 组件保持不变 |
| `microphone-capture.ts` | `src/lib/media/microphone-capture.ts` | 直接复用 `createCompatibleMediaRecorder`、MIME 降级 |
| `VoiceChatService` | `src/lib/services/voice-chat.service.ts` | Singleton 适配器管理，扩展 `startRecording`/`stopRecording` |
| `MOSSASRAdapter` | `src/lib/adapters/asr/moss-asr.ts` | 默认 ASR 引擎，HTTP POST + Base64 WAV |
| `IASRPort` | `src/lib/ports/asr-port.ts` | 统一接口，未来可切换 exomind-model 本地引擎 |

#### 2.2 ASR Adapter 选择策略

**Phase 1（本 spec）**：MOSS 为默认且唯一生产 adapter。

降级链路：
```
MOSS ASR（云端，默认）→ 不可用时提示用户配置 API Key
```

**Phase 2（#326 扩展后）**：
```
ExoModelASR（本地推理）→ MOSS（云端）→ Web Speech API（浏览器原生）→ 不可用
```

#### 2.3 桌面端 MediaRecorder 可用性

| 环境 | MediaRecorder | getUserMedia | 备注 |
|------|------|------|------|
| Tauri v2 WebView (Windows) | **可用** (Chromium 内核) | **可用** | 需 HTTPS 或 localhost |
| Tauri v2 WebView (macOS) | **可用** (WKWebView) | **可用** | 同上 |
| Android WebView | **可用** (已验证) | **可用** | `microphone-capture.ts` 有兼容处理 |

**结论**：MediaRecorder 在所有目标平台可用，无需 Tauri 侧原生录音（cpal）。

#### 2.4 录音流程（提取为 `useVoiceCapture` hook）

```typescript
// src/hooks/useVoiceCapture.ts

export function useVoiceCapture(options: {
  adapter: IASRPort;
  onResult: (result: ASRResult) => void;
  onError: (error: string) => void;
  onStateChange?: (state: 'idle' | 'recording' | 'recognizing') => void;
}) {
  // 1. getUserMedia → MediaStream
  // 2. createCompatibleMediaRecorder → MediaRecorder
  // 3. 收集 audio chunks
  // 4. 停止时：WebM→WAV 转换 → adapter.transcribe()
  // 返回: { startRecording, stopRecording, isRecording, duration }
}
```

### 3. 双路输出

#### 3.1 路径 A：剪贴板写入 + 模拟粘贴

**已有资产**：
- `tauri-plugin-clipboard-manager` **已安装**（Cargo.toml 已有）
- `TauriClipboardAdapter` 已实现 `writeText()` 和 `readText()`
- Capabilities 已配置：`clipboard-manager:allow-read-text`, `clipboard-manager:allow-write-text`

**流程**：
```
ASR 结果文本
  → getClipboardService().writeText(text)  // 写入剪贴板
  → 模拟 Ctrl+V 粘贴                       // 输出到光标位置
```

**模拟按键方案**：

| 方案 | 实现 | 优点 | 缺点 |
|------|------|------|------|
| **A: Tauri Rust 侧 `enigo` crate** (推荐) | `enigo::Enigo::key()` 模拟 Ctrl+V | 系统级，所有应用都能接收 | 需新增 Rust 依赖 |
| B: 前端 `document.execCommand('paste')` | JS API | 无额外依赖 | 仅在 WebView 内有效，其他应用无法接收 |
| C: Windows `SendInput` API | 直接调用 Win32 API | 最底层，最可靠 | 平台特定，需 unsafe |

**推荐方案 A：`enigo` crate**

```toml
# src-tauri/Cargo.toml
enigo = { version = "0.3", features = ["serde"] }
```

```rust
// src-tauri/src/commands/shortcut_commands.rs

#[tauri::command]
pub async fn simulate_paste() -> Result<(), String> {
    use enigo::{Enigo, Key, Keyboard, Settings};
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    // 模拟 Ctrl+V
    enigo.key(Key::Control, enigo::Direction::Press).map_err(|e| e.to_string())?;
    enigo.key(Key::Unicode('v'), enigo::Direction::Click).map_err(|e| e.to_string())?;
    enigo.key(Key::Control, enigo::Direction::Release).map_err(|e| e.to_string())?;
    Ok(())
}
```

**前端调用**：
```typescript
import { invoke } from '@tauri-apps/api/core';

// 写入剪贴板 + 模拟粘贴
await getClipboardService().writeText(asrResult.text);
await invoke('simulate_paste');
```

#### 3.2 路径 B：SignalPool → EventLog

**已有资产**：
- `SignalStreamService.publish()` — 支持 Tauri invoke 快速通道 + HTTP 降级
- `signal_publish_fast` Tauri command — Rust 侧快速发布
- `EventLogService.addEvent()` — 前端侧 EventLog 写入
- `eventlog_append` Tauri command — Rust 侧 EventLog 追加

**方案选择**：

| 方案 | 路径 | 优点 | 缺点 |
|------|------|------|------|
| **A: 前端直写 EventLog** (推荐，Phase 1) | `getEventLogService().addEvent(text, tags)` | 最简单，MOSSASRTestPage 已验证 | 不走 SignalPool |
| B: SignalPool → EventLog Actor | `signalStream.publish({ topic: 'user.input.voice' })` | 完整信号链路，支持后续 Polish Agent | 依赖 RT 运行 |

**Phase 1 推荐方案 A**：直接调用 `EventLogService.addEvent()`。

理由：
1. MOSSASRTestPage 已验证此模式可工作（`src/pages/MOSSASRTestPage.tsx:428`）
2. 无需 RT 运行，离线也能写 EventLog
3. #326 的 SignalPool 集成是后续增强，#304 不强依赖

**Phase 2 演进**（#326 时补充）：
```typescript
// 替换为 SignalPool 发布
signalStreamService.publish({
  topic: 'user.input.voice',
  source: 'voice-shortcut',
  payload: {
    raw_text: asrResult.text,
    confidence: asrResult.confidence,
    lang: asrResult.lang,
    duration_ms: asrResult.duration,
  }
});
```

#### 3.3 双路并行

```typescript
async function handleASRResult(result: ASRResult): Promise<void> {
  // 两路并行，互不阻塞
  const [clipboardResult, eventLogResult] = await Promise.allSettled([
    // 路径 A: 剪贴板 + 粘贴
    (async () => {
      await getClipboardService().writeText(result.text);
      await invoke('simulate_paste');
    })(),
    // 路径 B: EventLog
    getEventLogService().addEvent(result.text, new Set(['voice'])),
  ]);

  // 错误不阻塞另一路
  if (clipboardResult.status === 'rejected') {
    console.error('[VoiceShortcut] clipboard paste failed:', clipboardResult.reason);
  }
  if (eventLogResult.status === 'rejected') {
    console.error('[VoiceShortcut] eventlog write failed:', eventLogResult.reason);
  }
}
```

### 4. UI 反馈

#### 4.1 方案选型

| 方案 | 描述 | 适合场景 | 实现复杂度 |
|------|------|---------|-----------|
| A: 系统托盘图标变化 | 托盘图标从默认切换为"录音中"图标 | 最小干扰 | 低 |
| **B: 迷你悬浮窗** (推荐) | 屏幕角落小窗：录音波形 + 状态文字 | 跨应用可见，信息丰富 | 中 |
| C: 系统通知 | Windows Toast 通知 | 简单 | 低，但延迟高 |

**推荐方案 B：迷你悬浮窗**

理由：
1. 全局快捷键触发时 ExoMind 主窗口可能不在前台，需要跨应用可见的反馈
2. 系统托盘图标太小，用户不易注意到
3. 悬浮窗可复用 VoiceInputButton 的波形动画代码

**实现方式**：Tauri v2 动态多窗口（WebviewWindowBuilder 按需创建）

> 不在 `tauri.conf.json` 中静态声明窗口。悬浮窗在快捷键首次触发时动态创建，录音结束后隐藏（不销毁），下次触发时复用。

```rust
// src-tauri/src/commands/shortcut_commands.rs
// 在快捷键 Pressed 事件中按需创建/显示悬浮窗

fn show_voice_overlay(app: &AppHandle) -> Result<(), String> {
    // 尝试获取已存在的窗口
    if let Some(window) = app.get_webview_window("voice-overlay") {
        window.show().map_err(|e| e.to_string())?;
        return Ok(());
    }

    // 首次创建（动态，不依赖 tauri.conf.json）
    let _voice_window = tauri::WebviewWindowBuilder::new(
        app,
        "voice-overlay",
        tauri::WebviewUrl::App("voice-overlay.html".into())
    )
    .title("ExoMind Voice")
    .inner_size(200.0, 60.0)
    .position(screen_width - 220.0, screen_height - 80.0)
    .always_on_top(true)
    .decorations(false)
    .transparent(true)
    .skip_taskbar(true)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn hide_voice_overlay(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("voice-overlay") {
        window.hide().ok();
    }
}
```

**悬浮窗状态**：

| 状态 | 显示 | 持续时间 |
|------|------|---------|
| 录音中 | 红色脉冲点 + "录音中..." + 时长 | 按住期间 |
| 识别中 | 转圈动画 + "识别中..." | ASR 处理期间 |
| 完成 | 绿色勾 + 文本预览（前 20 字） | 2s 后自动隐藏 |
| 错误 | 红色叹号 + 错误信息 | 3s 后自动隐藏 |
| 空闲 | 隐藏 | — |

---

## 文件变更清单

### 新增文件

| 文件路径 | 内容 |
|---------|------|
| `src-tauri/src/commands/shortcut_commands.rs` | 全局快捷键注册 + `simulate_paste` 命令 + 悬浮窗动态创建/显示/隐藏 |
| `src-tauri/capabilities/voice-overlay.json` | 悬浮窗独立 capability（`windows: ["voice-overlay"]`，最小权限） |
| `src/hooks/useVoiceCapture.ts` | 从 VoiceInputButton 提取的录音 hook |
| `src/services/voice-shortcut.service.ts` | 全局语音快捷键服务（监听 Tauri event → 录音 → ASR → 双路输出） |
| `src/voice-overlay.html` | 悬浮窗入口 HTML |
| `src/pages/VoiceOverlayPage.tsx` | 悬浮窗 React 组件（状态指示 + 波形） |

### 修改文件

| 文件路径 | 变更内容 |
|---------|---------|
| `src-tauri/Cargo.toml` | 添加 `tauri-plugin-global-shortcut = "2"` 和 `enigo = "0.3"` |
| `src-tauri/src/lib.rs` | 注册 global-shortcut 插件 + 新增 `simulate_paste` 命令 + setup 中调用快捷键注册 |
| `src-tauri/src/commands/mod.rs` | 导出 `shortcut_commands` 模块 |
| `src-tauri/capabilities/default.json` | 添加 global-shortcut 权限（3 条） |
| `src/App.tsx` 或路由入口 | 初始化 `voice-shortcut.service` 监听 |

### 不修改文件

| 文件路径 | 理由 |
|---------|------|
| `VoiceInputButton.tsx` | 保持原有 UI 组件不变，全局快捷键走独立服务 |
| `voice-chat.service.ts` | 可考虑复用，但 Phase 1 直接在新 service 中使用 MOSSASRAdapter |
| `asr-port.ts` | 接口不变 |
| `moss-asr.ts` | 适配器不变 |

---

## 依赖分析

### 新增 Rust 依赖

| Crate | 版本 | 用途 |
|-------|------|------|
| `tauri-plugin-global-shortcut` | `2` | 全局快捷键注册（PTT keydown/keyup） |
| `enigo` | `0.3` | 模拟键盘 Ctrl+V 粘贴 |

### Tauri Capabilities 变更

**`src-tauri/capabilities/default.json`**（修改）：
```json
{
  "permissions": [
    // 现有: core:default, opener:default, clipboard-manager:*, mcp-bridge:default
    "global-shortcut:allow-register",
    "global-shortcut:allow-unregister",
    "global-shortcut:allow-is-registered"
  ]
}
```

**`src-tauri/capabilities/voice-overlay.json`**（新建）：
```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "voice-overlay",
  "description": "Capability for the voice overlay window",
  "windows": ["voice-overlay"],
  "permissions": [
    "core:default",
    "core:event:allow-listen",
    "core:event:allow-emit"
  ]
}
```

### 前端依赖

无新增。现有 `@tauri-apps/api` 已包含 `event.listen()` 和 `core.invoke()`。

---

## Definition of Done (DoD)

- [ ] **DoD-1**: 按住 `Alt+Q` 开始录音，松开停止录音，ASR 识别后文本出现在当前光标位置（任意应用中均可触发）
- [ ] **DoD-2**: 语音识别文本同步写入 EventLog，带 `voice` 标签
- [ ] **DoD-3**: 录音期间有可见的视觉反馈（悬浮窗显示录音状态/波形）
- [ ] **DoD-4**: ASR 失败时有错误提示（悬浮窗显示错误信息，3s 后消失）
- [ ] **DoD-5**: 麦克风权限未授予时提示用户授权
- [ ] **DoD-6**: 不影响现有 ExoMind 功能（VoiceInputButton、Chat 页面等正常工作）
- [ ] **DoD-7**: 快捷键不与 Windows 系统快捷键、VS Code、Chrome 常用快捷键冲突

---

## 风险与待决策项

| # | 问题 | 选项 | 推荐 | 需要确认 |
|---|------|------|------|---------|
| **R1** | 快捷键键位选择 | `Alt+Q` / `Ctrl+Shift+V` / 双击 `Alt` / 自定义 | `Alt+Q` | ~~是~~ **已确认** |
| **R2** | 交互模式 | PTT 按住/松开 vs Toggle 按一次开始再按一次停止 | PTT | ~~是~~ **已确认** |
| **R3** | 悬浮窗 vs 系统托盘 | 迷你悬浮窗（跨应用可见）vs 仅系统托盘图标变化 | 悬浮窗 | ~~是~~ **已确认** |
| **R4** | EventLog 写入方式 | 前端直写 `EventLogService` vs 走 SignalPool `user.input.voice` | 前端直写（Phase 1） | 否（Phase 2 迁移到 SignalPool） |
| **R5** | `enigo` crate 安全审计 | 模拟键盘输入的 crate 需确认无恶意代码风险 | crates.io 审查 + Cargo-audit | 否 |
| **R6** | ExoMind 最小化/后台时录音能力 | MediaRecorder 在 WebView 不可见时是否仍工作 | 需测试验证 | 是（影响架构，可能需要 Rust 侧 cpal 录音） |
| **R7** | enigo 粘贴焦点漂移 | ASR 耗时 1-3s，期间用户可能切换窗口，导致 Ctrl+V 粘贴到错误的目标窗口 | Phase 1 接受此限制（与 LazyTyper 行为一致）；Phase 2 可通过录音开始时记录目标窗口句柄 + Win32 `SetForegroundWindow` 恢复焦点后再粘贴来优化 | 否（已知限制，不阻塞） |

---

## 工时估算

| # | 子任务 | 依赖 | 估时 | 说明 |
|---|--------|------|------|------|
| **T1** | 安装 tauri-plugin-global-shortcut + 注册 Alt+Q PTT | 无 | 2h | Cargo.toml + capabilities + lib.rs + shortcut_commands.rs |
| **T2** | 提取 `useVoiceCapture` hook | 无 | 2h | 从 VoiceInputButton 提取录音逻辑 |
| **T3** | 编写 `voice-shortcut.service.ts` | T1, T2 | 3h | 监听 Tauri event → 录音 → ASR → 双路输出 |
| **T4** | 安装 enigo + `simulate_paste` 命令 | 无 | 1h | Rust 侧模拟 Ctrl+V |
| **T5** | 双路输出集成（剪贴板 + EventLog） | T3, T4 | 2h | Promise.allSettled 并行 |
| **T6** | 迷你悬浮窗 UI | T3 | 4-5h | Tauri 动态多窗口（WebviewWindowBuilder）+ React 组件 + 状态动画 + capability 配置 |
| **T7** | 端到端测试 + bug 修复 | T5, T6 | 2h | 各种应用场景验证 |
| | **合计** | | **~16-18h** | |

**关键路径**：T1 → T3 → T5 → T7（8h）
**可并行**：T2 与 T1 并行；T4 与 T1/T2 并行；T6 与 T5 部分并行

---

## 与 #326 的关系

**#304 是 #326 的前置子集**。

```
#304（本 spec）                          #326（后续扩展）
──────────────                          ──────────────
全局快捷键 PTT                          ← 复用
MediaRecorder 录音                      ← 复用
MOSS ASR                                → 扩展为多引擎（ExoModelASR）
剪贴板粘贴                              ← 保留
EventLog 直写                           → 迁移到 SignalPool 信号链路
                                        + Polish Agent（ASR 文本润色）
                                        + EventLog update 能力
                                        + Classifier Agent（意图分类）
                                        + user.input.voice Signal 类型定义
                                        + 流式 ASR 支持
```

**演进路径**：
1. **#304 交付**：全局快捷键 + 录音 + MOSS ASR + 双路输出 → 替代 LazyTyper
2. **#326 Phase 1**：新增 `ExoModelASRAdapter` + 定义 `user.input.voice` Signal + EventLog 迁移到 SignalPool
3. **#326 Phase 2**：Polish Agent + EventLog update + Classifier Agent → 完整信号链路
