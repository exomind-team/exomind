# 外心语音链路接入 DeepSeek 工具 API 计划

> 2026-11-15，Asia/Shanghai。状态：**待实施**，供开发 Agent 接续。
> 范围：快捷语音输入新增 `deepseek` ASR provider；新增最小 TTS 朗读能力。
> 不改火山 provider 的既有行为，不把 DeepSeek 设为默认。

## 1. 来龙去脉

2026-11-13，DeepSeek 开放「全家桶应用 API」：把 App 内的联网搜索、链接阅读、文件解析、内容安全、语音输入和朗读拆成独立接口。官方文档把它们归在 **Tool APIs** 下：

| 能力 | 官方文档 | 端点 |
|---|---|---|
| 搜索 / 抓取 | <https://api-docs.deepseek.com/guides/search> | `POST https://api.deepseek.com/v1/tools/search`、`/v1/tools/fetch` |
| 文字识别 | <https://api-docs.deepseek.com/guides/ocr> | `POST https://api.deepseek.com/v1/tools/ocr` |
| 语音合成 | <https://api-docs.deepseek.com/guides/tts> | `POST https://api.deepseek.com/v1/tools/tts`（另有 WebSocket 流式） |
| 语音识别 | <https://api-docs.deepseek.com/guides/asr> | `POST https://api.deepseek.com/v1/tools/asr` |

2026-11-15 在本地用官方 key 对五项逐一实测，全部 HTTP 200：

| 能力 | 实测耗时 | 结果 |
|---|---|---|
| 文字搜索 | 约 0.33 s | 返回结构化结果与摘要 |
| 网页抓取 | 约 0.16 s | 返回 Markdown 正文 |
| OCR | 约 2.6 s/页 | 中文表格逐行还原 |
| ASR | 1.24–1.50 s | 5–9 秒中英文音频，回灌一字不差 |
| TTS | 1.51–2.54 s | 24 kHz 单声道 16-bit WAV |

这次实测说明：**语音识别与语音合成可以只用一个 DeepSeek key 打通，成本按量计，不需要另配整套云厂商凭据。**

## 2. 外心现状（已核对源码）

### 2.1 已经跑通的部分

- 录音：`getUserMedia` + `MediaRecorder`（webm/opus）
- 转码：`convertWebmBlobToWav` → 16 kHz、单声道、16-bit PCM WAV（`src/lib/media/wav-audio.ts`，`DEFAULT_ASR_TARGET_SAMPLE_RATE = 16000`）
- 快捷键：`Alt+Q`（默认）/ `Alt+W` / `Ctrl+Space`，`Esc` 取消（`src/config/voice-shortcut-hotkey.ts`）
- 结果注入：`writeText` → 恢复前台窗口 → `simulate_paste`；`auto-enter-send` 时再 `simulate_enter`（`src/services/voice-shortcut.service.ts` 的 `handleResult`）
- 火山链路：应用内 `VolcanoRecognizeASRAdapter` → Tauri `volcano_asr_recognize`；快捷键走 Rust 流式 `volcano_asr_stream_start/push/finish`

### 2.2 缺口

- 当前 `VoiceShortcutAsrProvider` 只有 `'volcano'` 一个取值（`src/config/voice-shortcut-asr-provider.ts`）
- 本地联调中火山云端识别尚未配置成功（凭据不完整），录音与粘贴这段是好的，断在识别
- TTS 没有落地实现：`AI Registry` 只有 `audio.tts` 能力位（`src/lib/ai-registry/admin.ts`），没有 TTS Port、没有播放器
- `IASRPort.transcribe` 已接受 `preRecordedAudio: Uint8Array`（WAV），与 DeepSeek 的 multipart 上传一一对应（`src/lib/ports/asr-port.ts`）
- 历史上有过 `moss / volcano / qwen-omni` 三轨，`b5d01576` 精简时删除；可参考其 provider 分支写法

### 2.3 关键文件

| 文件 | 作用 |
|---|---|
| `src/config/voice-shortcut-asr-provider.ts` | provider 枚举、持久化、标签 |
| `src/config/volcano-asr-settings.ts` | 火山凭据与端点设置（新增 DeepSeek 可仿照） |
| `src/services/voice-shortcut.service.ts` | 录音、转码、provider 分支、结果注入 |
| `src/lib/ports/asr-port.ts` | `IASRPort` 合同 |
| `src/lib/adapters/asr/` | 火山三个适配器 |
| `src-tauri/src/commands/asr_commands.rs` | 火山 Tauri 命令（新增 DeepSeek 可仿照） |
| `src/lib/ai-registry/admin.ts` | `audio.transcribe` / `audio.tts` 能力位 |

## 3. 目标与非目标

### 目标

1. 新增 `deepseek` ASR provider：按住说话 → 松开 → WAV → DeepSeek `/v1/tools/asr` → 粘贴到前台窗口。
2. 新增最小 TTS：`stella`（女）/ `tide`（男），供「朗读回答 / 播报」使用。
3. 保留火山 provider 与现有快捷键链路；默认行为不变，由用户显式选择 DeepSeek。

### 非目标

- 不做实时流式字幕、ambient 常驻监听（DeepSeek ASR 是批量接口）。
- 不接 OCR / 搜索（另立计划）。
- 不把 API key、录音样本、真实转写文本提交进仓库。
- 不重构 `VoiceInputButton` / `VoiceMessageInput` 的页面内逻辑，除非复用同一 adapter。

## 4. 方案

### 4.1 ASR provider

**合同**：新增 `DeepSeekASRAdapter implements IASRPort`（`src/lib/adapters/asr/deepseek-asr.ts`）。

- `transcribe(input)`：
  - 若 `input.preRecordedAudio` 存在，直接用它；
  - 否则从 `input.stream` 录制并转 WAV（复用现有录制/转码工具）；
  - `POST {baseUrl}/v1/tools/asr`，`multipart/form-data`，字段名 `file`，文件名 `speech.wav`；
  - 返回 `{ text, confidence: 1, lang: input.lang ?? 'zh-CN', duration: duration_ms }`。
- `streamTranscribe(input)`：DeepSeek 不支持流式，产出一次 `{ text, isFinal: true }` 后结束。
- `isAvailable()`：`Boolean(apiKey)`。

**为什么建议走 Rust 命令**：Tauri WebView 里直接 `fetch` 第三方域名会受 CORS 限制，且 multipart 需要自定义 header。仿照 `volcano_asr_recognize` 新增：

```rust
#[tauri::command]
pub async fn deepseek_asr_recognize(
    audio_data: Vec<u8>,   // 完整 WAV 字节
    api_key: String,
    base_url: String,
) -> Result<DeepSeekAsrResult, String>
```

- `reqwest` 需要启用 `multipart` feature（当前 `src-tauri/Cargo.toml` 只开了 `json`、`rustls-tls`）。
- 错误映射：`400` 音频格式不支持、`408` 上传超时、`413` 超过 8 MiB、`429` 并发已满、`503/504` 服务繁忙/超时；都转成可读中文，不吞掉。
- 不把 `api_key` 写日志；不把音频落盘（除非用户显式保留）。

**provider 分支**：

1. `src/config/voice-shortcut-asr-provider.ts`：`VOICE_SHORTCUT_ASR_PROVIDER_VALUES = ['volcano', 'deepseek']`；`normalizeProvider` 保留旧值回退 `volcano`；标签 `DeepSeek`。
2. 新增 `src/config/deepseek-asr-settings.ts`：`apiKey`、`baseUrl`（默认 `https://api.deepseek.com`），仿 `volcano-asr-settings.ts` 的 `createConfigModule`。
3. `voice-shortcut.service.ts`：
   - `transcribeWithSelectedProvider(wavData)` 按 `this.asrProvider` 分支；
   - DeepSeek 分支直接把完整 WAV 交给 Tauri 命令（**不要** `wavData.slice(44)`，那是火山 PCM 路径）；
   - 跳过火山专属的 warm session、mic prewarm、流式事件监听。
4. 设置页：新增 DeepSeek 面板（key 输入、Base URL、连通性测试、隐私提示），仿 `voice-input-provider-settings.tsx`。

**UI 文案**：首次选择 DeepSeek 时明确提示「音频会上传到 DeepSeek 云端」，不做静默切换。

### 4.2 TTS

**合同**：新增最小 `ITTSPort`（或直接 service）：

```ts
interface TTSRequest { text: string; voiceId?: 'stella' | 'tide'; format?: 'wav' | 'pcm'; }
interface ITTSPort { speak(req: TTSRequest): Promise<Uint8Array>; }
```

- `POST {baseUrl}/v1/tools/tts`，JSON：`{ text, voice_id, format: 'wav' }`。
- 应用内播放：把返回字节包成 `Blob` → `URL.createObjectURL` → `HTMLAudioElement`。
- 快捷键/播报：Tauri 命令保存临时 WAV → 系统播放器；播放完清理。
- 文本处理：
  - 默认 `filter_markdown: true`，不读 `**`、反引号；
  - 中文按 2 个计费字符算，单次 ≤10,000 计费字符；长文按 ≤9,000 切块，串行合成；
  - 不做语速控制（接口不支持）。
- **WAV 头坑**：流式返回的 RIFF/data 长度是 `0xFFFFFFFF` 占位。播放前回填真实长度（`fileSize - 8`、`dataSize`），或改用 `format: 'pcm'` 后自行封装 44 字节头；否则部分播放器/编辑器会显示错误时长。
- 音色：`stella`（女，默认）、`tide`（男）；语言自动检测。

**触发点**（按优先级）：

1. 消息气泡上的「朗读」按钮；
2. 已有 `voice.runtime.speak.request/cancel` 信号（若仍在）作为消费端；
3. 外部 Agent 通过 MCP 调用（另立计划，不在本次范围）。

### 4.3 不做的事

- 不把 DeepSeek TTS 做成 Magpie provider：Magpie 的 provider 抽象只覆盖 chat/responses/anthropic，音频应走 TTS Port 或 MCP。
- 不做 OCR。DeepSeek OCR 适合文档，不属于语音链路。

## 5. 实施清单

- [ ] `src/config/voice-shortcut-asr-provider.ts`：增加 `deepseek`，保留旧值迁移。
- [ ] `src/config/deepseek-asr-settings.ts`：key / baseUrl / 连通性测试。
- [ ] `src-tauri/Cargo.toml`：`reqwest` 增加 `multipart` feature。
- [ ] `src-tauri/src/commands/asr_commands.rs`：新增 `deepseek_asr_recognize`，注册到 `invoke_handler`。
- [ ] `src/lib/adapters/asr/deepseek-asr.ts`：实现 `IASRPort`。
- [ ] `src/lib/adapters/index.ts`：导出新 adapter。
- [ ] `src/services/voice-shortcut.service.ts`：provider 分支；跳过火山专属逻辑。
- [ ] `src/ui/app/components/settings/voice-input-provider-settings.tsx`：DeepSeek 面板与隐私提示。
- [ ] `src/lib/ports/tts-port.ts` + 最小 TTS service。
- [ ] 消息「朗读」入口（先做单条消息，不做批量）。
- [ ] 单元测试：请求构造、错误映射、WAV 头回填、长文切块。
- [ ] 手工回归：火山 provider 不受影响。

## 6. 验收标准

1. 真实麦克风录 3 秒中文，松开后 ≤3 秒内文本出现在前台窗口（端到端）。
2. 英文与中英混排各一条，转写可用。
3. 超过 120 秒的录音给出明确错误，不静默截断、不丢录音。
4. 401 / 429 / 503 各自给出可读错误，可重试。
5. 切换回火山 provider，原有行为不回归。
6. key 不出现在日志、仓库、崩溃报告。
7. TTS：6 秒中文生成可播放 WAV，ffprobe 时长正确；Markdown 符号不被读出。
8. TTS：超过 10,000 计费字符的文本被切块并串行合成，不截断。
9. 首次使用 DeepSeek 时有明确的「音频上传到第三方」提示。

## 7. 风险与边界

| 风险 | 处理 |
|---|---|
| ASR 批量、非流式 | 只用于 push-to-talk；实时字幕仍走火山/未来的实时 provider |
| 单次 ≤120 s、≤8 MiB | 录音超限时提示并保留音频；不自动切片（切片会破坏语义） |
| 第三方数据处理 | 首次使用提示；私密内容不默认走 DeepSeek；文档写明 |
| 账户余额/限流 | 401/402/429 可读提示；不做自动降级到其他厂商 |
| WAV 头占位 | 播放前回填；写单测 |
| 默认行为变化 | 默认仍是火山，DeepSeek 由用户显式选择 |

## 8. 复现与证据

官方 curl（不含 key）：

```bash
curl https://api.deepseek.com/v1/tools/asr \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  -F file="@speech.wav"

curl https://api.deepseek.com/v1/tools/tts \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"你好，我是外心。","voice_id":"stella","format":"wav"}' \
  --output speech.wav
```

本地实测记录（2026-11-15，不含 key）：

- ASR：6.68 s 中文 → 1.28 s；5.24 s 英文 → 1.24 s；9.04 s 中英混排 → 1.50 s
- TTS：38 字中文 → 6.68 s 音频，合成 2.15 s；15 词英文 → 5.24 s，合成 1.51 s
- OCR：1 页中文定价表 → 2.56 s，表格完整
- 成本：按官方人民币刊例，搜索/抓取 ¥5/千次、OCR ¥1.5/千页、ASR ¥0.39/小时（限时 5 折）、TTS ¥1.5/万字符（限时 5 折）

## 9. 交接说明

开发 Agent 的起点：

1. 读本文件、`AGENTS.md`、`src/services/voice-shortcut.service.ts`、`src/lib/ports/asr-port.ts`。
2. 先做 ASR（最小闭环），再做 TTS。
3. 每一步给出可复现证据：命令、日志、测试结果；不把「代码写完」当成「功能可用」。
4. 不提交 key、录音、真实转写文本；不修改默认 provider。
5. 若火山凭据仍不可用，DeepSeek 是当前唯一能打通识别的最小路径；先让它工作，再谈多 provider 抽象。
