# Qwen Omni Plus Minimal Voice Provider Implementation Plan

> Status（状态）: **Partially implemented, currently paused（部分实现，当前暂停）**.  
> Follow-up / handoff（交接文档）: [docs/development/2026-04-03-qwen-omni-voice-handoff.md](../development/2026-04-03-qwen-omni-voice-handoff.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 ExoMind 的桌面快捷语音链路新增一个最小可用的 `Qwen Omni Plus（通义千问全模态）` 供应商，同时尽量复用现有 `AI Registry / provider profile（供应商档案）` 的密钥与 Base URL 管理，不再新增一套独立 Secret 存储。

**Architecture:** 保留现有 `moss / volcano` 双轨结构，在 `voice-shortcut.service.ts` 增加第三个 provider 分支。配置上不直接新增“Qwen API Key”单独存储，而是新增一个“语音供应商档案引用（voice provider profile id）”，复用现有 `AI Registry` 中的 `openai-compatible（OpenAI 兼容）` 档案提供 `apiKey / baseUrl`，语音侧只额外保存 `voice model id（语音模型 ID）` 与最小提示词配置。

**Tech Stack:** React 18 + TypeScript, Tauri v2, existing `IASRPort`, existing settings registry, existing AI Registry / provider profile storage

---

## Scope

### In Scope

- 为 `快捷语音引擎` 增加 `qwen-omni` 选项
- 新增一个最小 `QwenOmniASRAdapter`，走 `OpenAI-compatible chat/completions + input_audio（音频输入）`
- 复用 `AI Registry` 里已有的 provider profile（供应商档案）作为凭证来源
- 新增最小配置：
  - `voice provider profile id（语音供应商档案 ID）`
  - `voice omni model id（语音全模态模型 ID）`
  - `voice omni optimize enabled（是否启用二次排版）`
- 第一期仅接入 `voice shortcut（全局语音快捷键）`

### Out of Scope

- 不改 `VoiceInputButton / VoiceMessageInput` 页面内按钮逻辑
- 不扩展 `AI Registry capability（能力）` 到正式 `audio.transcribe`
- 不做通用 prompt 编辑器
- 不做实时流式多模态字幕

## Option Comparison

### Option A: 独立 Qwen 语音设置

- 优点：改动最小，最快能跑
- 缺点：会变成 `MOSS Token / 火山 Key / Qwen Key` 三套配置，后续一定返工

### Option B: 复用 Provider Profile（推荐）

- 优点：密钥、Base URL、供应商来源统一；只在语音侧新增“引用哪个档案 + 用哪个模型”
- 缺点：设置页要多一个 profile 选择项

### Option C: 直接把语音能力完全并入 AI Registry

- 优点：长期最干净
- 缺点：超出“最小接入”，会碰 capability/resolution/rules 全链路

**Recommendation:** 采用 Option B。它符合“只是加一个供应商”的边界，同时把“供应商管理”收敛到已有模型供应商体系，不会埋下第二次配置迁移债务。

## File Map

### Create

- `src/lib/adapters/asr/qwen-omni-asr.ts`
- `src/config/voice-omni-profile.ts`
- `src/config/voice-omni-settings.ts`
- `src/lib/voice/qwen-omni-prompts.ts`

### Modify

- `src/config/voice-shortcut-asr-provider.ts`
- `src/services/voice-shortcut.service.ts`
- `src/ui/app/config/settings/settings-registry.ts`
- `src/lib/adapters/index.ts`
- `src/ui/app/pages/SettingsPage.tsx`

### Optional Tests

- `src/config/__tests__/voice-shortcut-asr-provider.test.ts`
- `src/lib/adapters/asr/__tests__/qwen-omni-asr.test.ts`

## Task 1: 扩展 Provider 枚举与设置入口

**Files:**
- Modify: `src/config/voice-shortcut-asr-provider.ts`
- Modify: `src/ui/app/config/settings/settings-registry.ts`
- Modify: `src/ui/app/pages/SettingsPage.tsx`

- [ ] 把 `VOICE_SHORTCUT_ASR_PROVIDER_VALUES` 从 `['moss', 'volcano']` 扩成 `['moss', 'volcano', 'qwen-omni']`
- [ ] 更新 `normalizeProvider()`，避免旧值回退时误伤
- [ ] 更新 `getVoiceShortcutAsrProviderLabel()`，新增 `Qwen Omni`
- [ ] 在设置页 `快捷语音引擎` 增加第三个选项
- [ ] 新增 `qwenOmniOnly(ctx)` 可见性函数，为后续配置项做 gating（按供应商显示）

**Done When:**
- 设置页能选到 `Qwen Omni`
- 悬浮窗 `providerLabel` 不再写死只支持 `MOSS / 火山`

## Task 2: 增加“供应商档案引用”配置，而不是新增独立 Key 存储

**Files:**
- Create: `src/config/voice-omni-profile.ts`
- Create: `src/config/voice-omni-settings.ts`
- Modify: `src/ui/app/config/settings/settings-registry.ts`

- [ ] 新增 `voice-omni-profile-id` 配置模块，保存选中的 provider profile id
- [ ] 新增 `voice-omni-model-id` 配置模块，默认值设为 `qwen3.5-omni-plus`
- [ ] 新增 `voice-omni-optimize-enabled` 配置模块，默认 `false`
- [ ] 在设置页增加三项：
  - `Qwen Omni 供应商档案`
  - `Qwen Omni 模型 ID`
  - `Qwen Omni 二次排版`
- [ ] provider profile 下拉只显示 `provider === 'openai'` 的档案，因为 DashScope / OpenAI-compatible 都能落在这类档案上

**Decision:**
- 第一期不新增单独 `apiKey/baseUrl` 输入框
- 如果用户没选档案，运行时报错并指向 `AI Registry` 或 provider profile 创建入口

## Task 3: 实现最小 Qwen Omni ASR Adapter

**Files:**
- Create: `src/lib/adapters/asr/qwen-omni-asr.ts`
- Create: `src/lib/voice/qwen-omni-prompts.ts`
- Modify: `src/lib/adapters/index.ts`

- [ ] 新建 `QwenOmniASRAdapter implements IASRPort`
- [ ] 输入仍然接收 `preRecordedAudio: Uint8Array`，不改上层录音结构
- [ ] 请求格式参考 ByeType 的 `OpenAI-compatible + input_audio`
- [ ] 默认 `baseUrl` 不在 adapter 内写死，从 provider profile 解析
- [ ] 系统提示词第一期只做最小内建常量：
  - `agent prompt（只做转写，不执行命令）`
  - `rules prompt（最少保留中文标点、口语清理）`
  - 可选 `optimize prompt（只做分段排版）`
- [ ] 如果 `optimize enabled` 为 `false`，只发一次请求
- [ ] 如果启用优化，则做“转写 -> 二次文本优化”两步调用

**Adapter Contract:**

- `transcribe()` 返回 `ASRResult`
- `streamTranscribe()` 第一版直接 `throw new Error('Qwen Omni adapter does not support streaming yet')`
- `isAvailable()` 判断 profile + apiKey + model 是否完整

## Task 4: 把 Qwen Omni 接到现有 Voice Shortcut 主链路

**Files:**
- Modify: `src/services/voice-shortcut.service.ts`

- [ ] 在构造阶段不再把 `this.adapter` 固定理解成 `MOSS adapter`
- [ ] 新增 `getQwenOmniRuntimeConfigOrThrow()`：
  - 读取 `voice-omni-profile-id`
  - 通过 `resolveRegistryProviderProfile()` 取 `apiKey / baseUrl`
  - 读取 `voice-omni-model-id`
- [ ] 修改 `transcribeWithSelectedProvider()`：
  - `volcano` 走原生 Tauri 命令
  - `moss` 走现有 `MOSSASRAdapter`
  - `qwen-omni` 走新 `QwenOmniASRAdapter`
- [ ] 修改 `getActiveProviderLabel()`，展示为：
  - `Qwen Omni Plus · OpenAI-compatible`
  - 或 `Qwen Omni Plus · <profile name>`
- [ ] 明确：`Qwen Omni` 第一版仍走“一次录完再识别”，不接入火山的流式预热会话

**Non-goal:**
- 不把 `prewarmResourcesForProvider()` 复杂化到 Qwen Omni 会话预热

## Task 5: 设置页体验收敛

**Files:**
- Modify: `src/ui/app/config/settings/settings-registry.ts`

- [ ] `MOSS` 相关 token 项仅在 `mossOnly`
- [ ] `火山` 相关 key / endpoint / resource 项仅在 `volcanoOnly`
- [ ] `Qwen Omni` 相关 profile / model / optimize 项仅在 `qwenOmniOnly`
- [ ] 给 `Qwen Omni 供应商档案` 增加 helper text：
  - “请先在 AI Registry / Agent Provider 中配置 DashScope 或其他 OpenAI-compatible 档案”
- [ ] 给 `Qwen Omni 模型 ID` 默认填 `qwen3.5-omni-plus`

## Task 6: 最小验证链路

**Files:**
- Optional Test: `src/lib/adapters/asr/__tests__/qwen-omni-asr.test.ts`

- [ ] 手工验证 1：设置页能切换到 `Qwen Omni`
- [ ] 手工验证 2：未选 provider profile 时，快捷键录音后给出明确错误
- [ ] 手工验证 3：选中有效 DashScope/OpenAI-compatible 档案后，录音结束能得到最终文本
- [ ] 手工验证 4：文本仍能走现有：
  - `clipboard write（写剪贴板）`
  - `simulate_paste（模拟粘贴）`
  - `publishVoiceTranscriptSignal（发布语音信号）`
  - `EventLog fallback（事件日志回退）`
- [ ] 手工验证 5：`providerLabel` 在 overlay 中正确显示

## Acceptance Criteria

- 用户能在现有“快捷语音引擎”里选择 `Qwen Omni`
- 不需要新增单独的 `Qwen API Key` 存储
- `Qwen Omni` 的凭证来源复用现有 provider profile / AI Registry
- 语音快捷键主流程可用：录音、识别、粘贴、发布信号、写入 EventLog 回退
- `MOSS / 火山` 原有链路不回归

## Risks

- 当前 provider profile 只有 `openai / anthropic` 两类语义，`Qwen` 需要以 `openai-compatible` 心智接入；UI 文案必须写清楚
- 如果用户把默认 LLM 档案配置成 OpenAI 正常聊天模型而非 Qwen Omni 模型，语音模型 ID 不能盲目复用 LLM 默认模型
- `Qwen Omni` 的响应结构若与当前 ByeType 样例不完全一致，需要在 adapter 内做一层容错解析

## Follow-up (Not in MVP)

- 把 `voice transcription（语音转写）` 提升为 AI Registry 正式 capability
- 允许每个输入场景绑定不同 prompt / vocabulary profile
- 页面内 `VoiceInputButton` 与全局快捷键共用同一 provider 解析层
