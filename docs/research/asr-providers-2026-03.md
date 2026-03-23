# ASR 提供商与库调研报告 (2026-03-06)

> 调研目标: 为 ExoMind (Tauri 2.0 + React + Rust) 选择最优 ASR 方案
> 调研方式: 3 个 Agent 并行深度调研 (TS/JS SDK + Rust 库 + 架构方案)

---

## 一、核心结论

### 推荐技术栈

| 层级 | 推荐方案 | 理由 |
|------|---------|------|
| **Rust 后端 ASR** | **sherpa-rs** (v0.6.8, 300 stars) | 原生流式 + 内置 VAD + Android 官方支持 + 中文流式模型仅 14MB |
| **前端 VAD** | **@ricky0123/vad-web** (v0.0.30, 1.8K stars) | Silero VAD v5 ONNX, <2MB, 浏览器 AudioWorklet |
| **云端 ASR (免费)** | **SiliconFlow SenseVoice** | 免费 + 中文超越 Whisper + OpenAI 兼容格式 |
| **云端 ASR (极速)** | **Groq Whisper** ($0.04/h) | 216x 实时速度 + OpenAI 兼容 |
| **云端 ASR (流式)** | **Deepgram Nova-3** ($0.0043/min) | WebSocket 实时流式 + 中文 Tier 1 |

### 分阶段实施路线

```
Phase 1 (2-3周): VAD 增强 + 云端优化
  - 集成 @ricky0123/vad-web (自动检测语音起止)
  - 新增 SiliconFlow 适配器 (免费 SenseVoice, OpenAI 兼容)
  - 统一 IASRPort 接口 (当前存在两份定义)

Phase 2 (3-4周): Android ASR + Rust 本地
  - Rust 侧集成 sherpa-rs (流式 + VAD + 中文)
  - Tauri Command 暴露 ASR 能力
  - Android aarch64 交叉编译验证

Phase 3 (6-8周): 完全离线 + 多引擎
  - 模型管理系统 (下载/切换/进度)
  - SenseVoice 离线中文 (via sherpa-onnx)
  - Moonshine v2 低延迟英文 (50ms)
```

---

## 二、Rust ASR 库对比

| 库 | 版本 | 下载量 | 流式 | 中文 | GPU | Android | VAD | 推荐度 |
|----|------|--------|------|------|-----|---------|-----|--------|
| **sherpa-rs** | 0.6.8 | 51K | 原生 | 优秀 | CUDA/DirectML | 官方 | 内置 | **A+** |
| **whisper-rs** | 0.15.1 | 191K | 伪流式 | 好 | CUDA/Metal/Vulkan | 可行 | 需外置 | **A** |
| **transcribe-rs** | 0.2.9 | 11K | 否 | 好 | Metal/Vulkan | 未验证 | 否 | B |
| **qwen-asr** | 0.3.0 | 215 | 5种模式 | 优秀 | 否 | 理论可行 | 内置 | B (太新) |
| **candle (Whisper)** | 0.9.2 | 1.15M | 否 | 好 | CUDA/Metal | 理论可行 | 否 | B+ |
| **vosk** | 0.3.1 | 34K | 原生 | 中 | 否 | 有限 | 否 | C+ |
| deepspeech | 0.9.1 | 35K | - | 否 | - | - | - | 已废弃 |
| coqui-stt | 1.0.2 | 20K | - | 否 | - | - | - | 已废弃 |

### sherpa-rs 关键优势
- 底层 sherpa-onnx (10.6K stars) 生态成熟
- 中文流式模型: `zipformer-bilingual-zh-en` (14MB), `paraformer-trilingual-zh-cantonese-en` (20MB)
- 内置 Silero VAD, 说话人识别, 关键词检测
- 全平台: Windows/macOS/Linux/Android/iOS

### Rust VAD 生态
- `voice_activity_detector` (v0.2.1, 44K 下载) - Silero VAD 独立 crate
- sherpa-rs 内置 VAD

---

## 三、TS/JS 云端 ASR 对比

| 提供商 | npm 包 | 流式 | 中文 | 定价/min | 延迟 | 推荐场景 |
|--------|--------|------|------|----------|------|---------|
| **SiliconFlow** | `openai` (兼容) | 否 | 极佳 | **免费** | ~2s | 默认云端 |
| **Groq** | `groq-sdk` | 否 | 好 | $0.0007 | 极速 | 高频调用 |
| **Deepgram** | `@deepgram/sdk` v5 | WebSocket | 好 | $0.0043 | 实时 | 流式需求 |
| **AssemblyAI** | `assemblyai` | 是 | 好 | $0.0025 | 实时 | 高级功能 |
| OpenAI | `openai` | 否 | 好 | $0.006 | ~3s | 通用 |
| 火山引擎 | `@volcengine/openapi` | WebSocket | 极佳 | ~0.01元 | 实时 | 方言 |
| Google | `@google-cloud/speech` | gRPC | 好 | $0.024 | 实时 | 企业级 |
| Azure | `ms-speech-sdk` | 是 | 好 | $0.017 | 实时 | 企业级 |
| 腾讯云 | `tencentcloud-speech-sdk-js` | 是 | 极佳 | ~0.01元 | 实时 | 国内部署 |
| 讯飞 | `xunfeisdk` (社区) | WebSocket | 业界领先 | ~0.01元 | 实时 | 中文极致 |

### TS/JS 本地方案

| 方案 | npm 包 | Stars | 流式 | WASM | VAD |
|------|--------|-------|------|------|-----|
| **sherpa-onnx** | `sherpa-onnx` v1.12.28 | 10.6K | 是 | 是 | 内置 |
| **@ricky0123/vad-web** | v0.0.30 | 1.8K | VAD only | 是 | 专用 |
| Web Speech API | 浏览器原生 | - | 是 | - | 内置 |
| vosk-browser | v0.0.8 | 14K | 是 | 是 | 内置 |
| whisper-node | v1.1.1 | 298 | 否 | 否 | 否 |

---

## 四、平台兼容性矩阵

| 方案 | Windows | macOS | Linux | Android WebView | Android Native |
|------|---------|-------|-------|----------------|---------------|
| Web Speech API | OK | OK | **不支持** | **不支持** | N/A |
| sherpa-rs (Rust) | OK | OK | OK | N/A | **OK** |
| sherpa-onnx WASM | OK | OK | OK | OK | N/A |
| @ricky0123/vad-web | OK | OK | OK | OK | N/A |
| 云端 HTTP API | OK | OK | OK | OK | N/A |

**关键发现**: Android WebView 不支持 Web Speech API (Chromium bug #487255, 2015年至今未修复)

---

## 五、ExoMind 当前 ASR 状态

### 已有适配器 (4个)
| 适配器 | 类型 | 状态 |
|--------|------|------|
| WebSpeechASRAdapter | 浏览器原生 | 可用 (Windows/macOS) |
| MOSSASRAdapter | 云端 HTTP | **主力** |
| VolcanoEngineASRAdapter | 云端 WebSocket | 受限 (CORS) |
| VolcanoHTTPASRAdapter | 云端经后端代理 | 可用 |

### 已知问题
1. IASRPort 接口存在两份定义 (`environment/interfaces/asr.port.ts` + `ports/asr-port.ts`)
2. 所有适配器依赖网络, 无离线能力
3. 无 VAD, 用户需手动按住/松手
4. Android 无 ASR 能力

### 当前流程
Alt+Q -> MediaRecorder (WebM) -> WAV(16kHz) -> MOSS API -> 剪贴板 + EventLog

---

## 六、开源项目参考

| 项目 | 技术栈 | ASR 方案 | 启示 |
|------|--------|---------|------|
| Whispering/Epicenter | Tauri+Svelte | transcribe-rs (从whisper-rs迁移) | 多引擎+GPU加速 |
| Handy | Tauri+Rust | whisper-rs + CPAL | 成熟的本地ASR产品 |
| Pothook | Tauri+whisper.cpp | 直接 Rust 调用 | 参考集成代码 |
| Buzz | Python+Qt | 多引擎策略 | 用户选择引擎 |
| tauri-plugin-stt | Tauri 2.x 插件 | 桌面Vosk + 移动端原生 | 最匹配的现成方案 |

---

## 七、新兴模型值得关注

| 模型 | 发布 | 特点 |
|------|------|------|
| **Moonshine v2** | 2026-02 | 50ms延迟(tiny), 比Whisper Large快43.7x |
| **SenseVoice** | 阿里达摩院 | 中文CER最优, 比Whisper-Small快5x |
| **Qwen3-ASR** | 阿里通义 | 0.6B/1.7B, 纯Rust推理可用 |
| **FireRedASR2** | 新一代 | 中英+数十种方言 |

---

*调研完成时间: 2026-03-06*
*Agent 消耗: ~220K tokens, ~1287s*
