# AI Provider 抽象评审报告

**审计时间**: 2026-04-08
**审计团队**: 6维度并行审计 + Team Lead 汇总
**审计范围**: ExoMind AI Provider 架构全扫描

---

## 一、执行摘要

审计了架构、商业、代码、功能、安全、UX 六大维度，共发现 **29 个问题**：
- **P0 问题 8 个**（必须立即修复）
- **P1 问题 12 个**（计划内修复）
- **P2 问题 9 个**（持续改进）

**核心结论**：系统有良好的多供应商抽象骨架（AI Registry），但实际只有 MiniMax/豆包两根柱子撑着；最紧急的是修复安全漏洞、补齐 Port 抽象、激活 Fallback 链。

---

## 二、各维度审计发现

### 2.1 架构问题（architect 审计）

| 严重度 | 问题 | 位置 | 影响 |
|--------|------|------|------|
| P0 | IASRPort 双重定义 | `ports/` vs `environment/` | 类型分叉风险 |
| P0 | Voice Runtime Provider 无 Port 抽象 | `voice-runtime/` | 无法热切换语音提供商 |
| P0 | Agent Provider ID 与 Registry 冲突 | `agent-provider/types.ts` | 供应商分类错误 |
| P0 | LLM Port 纸上演习 | `ports/llm-port.ts` | 定义了但无实现 |
| P1 | AIModelModality 缺少 TTS/Realtime | `ai-registry/types.ts` | 无法表达语音合成能力 |
| P1 | Voice Runtime 与 Registry 完全隔离 | 配置层 | API Key 分散管理 |
| P1 | Capability ID 生成策略不一致 | `admin.ts` vs `runtime-profile.ts` | 跨模块匹配失败 |
| P2 | AIOffering paramSchemaOverride 功能重复 | types.ts | 无合并逻辑 |

**架构评分**: 6.4/10 — ASR Port/Adapter 规范良好，Voice/LLM/TTS 混乱

### 2.2 商业风险（business-analyst 审计）

| 风险 | 等级 | 影响 |
|------|------|------|
| 语音单一供应商（豆包硬编码） | 致命 | 政策变化即中断 |
| 配额监控仅 MiniMax | 致命 | 无法跨供应商成本对比 |
| quota.exhausted 无实际降级 | 致命 | 额度耗尽继续请求 |
| 无 OpenRouter 聚合接入 | 高 | 每年多花数千元 |
| 语音/LLM 额度不隔离 | 高 | 互相消耗额度 |

**已有能力**：定期心跳轮询、预警信号、耗尽告警
**缺失能力**：主动限流、智能路由降级、成本预测、按成本设阈值

### 2.3 代码问题（code-reviewer 审计）

| 严重度 | 问题 | 位置 |
|--------|------|------|
| P0 | ApiProviderId = 'openai' \| 'anthropic' 硬编码 | `agent-provider/types.ts:1` |
| P0 | PCM 转换代码重复 4 次 | ASR 适配器 |
| P0 | API Key 规范化重复 4 次 | `moss-asr.ts`, `qwen-omni-asr.ts` |
| P1 | Factory 模式完全缺失 | ASR 适配器无工厂 |
| P1 | isAvailable() 异步语义错误 | `VolcanoHTTPASRAdapter` |
| P1 | VOICE_RUNTIME_PROVIDER_VALUES 硬编码 | `voice-runtime-settings.ts:3` |
| P2 | invoke 返回值用 `as` 强转 | `volcano-engine-asr.ts` |
| P2 | 抛出字符串而非 Error | ASR 适配器 |

### 2.4 功能缺口（product-analyst 审计）

| 严重度 | 缺口 | 影响 |
|--------|------|------|
| P0 | TTS Port 完全缺失 | 语音播报无法闭环 |
| P0 | LLM Port 功能不足（无 Tool Calling/多模态） | Agent 能力受限 |
| P0 | Vision Port 缺失 | Scout Agent 图像理解无法路由 |
| P0 | Reasoning 参数建模缺失 | o3/o4 类模型无法正确路由 |
| P1 | Video Generation Port 缺失 | MiniMax Video 未接入 |
| P1 | Energy Source 健康监控未激活 | 无法基于状态降级 |
| P2 | VolcanoEngine WS 代理未完成 | ASR fallback 不完整 |

**核心问题**：类型丰富（6种 capability）、接口贫瘠（只有 ASR + 不完整的 LLM Port）

### 2.5 安全风险（security-engineer 审计）

| 风险 | 等级 | 说明 |
|------|------|------|
| localStorage 明文存储 API Key | 高 | XSS 可窃取全部密钥 |
| HTTP 明文传输（跨设备同步） | 高 | 中间人可截获 |
| LAN 模式无认证 | 高 | 同局域网任意设备可读写配置 |
| Runtime API 无速率限制 | 中 | DoS 风险 |
| 外部 Token 无强度校验 | 中 | 弱密码可被暴力破解 |
| WebSocket 可降级为非 TLS | 中 | 语音数据明文传输 |
| 语音转写无 Prompt 注入防御 | 中 | 用户语音指令原样注入 LLM |
| 无 API Key 轮换机制 | 低 | 密钥长期不变 |

**评分**: 本地存储⚠️弱、传输⚠️弱、访问控制⚠️中

### 2.6 UX 问题（ux-researcher 审计）

| 严重度 | 问题 | 影响 |
|--------|------|------|
| P0 | AI Registry Dialog 硬编码颜色值 | 违反 ui-spec.md，深色模式断裂 |
| P0 | 无首次配置引导（onboarding） | 用户看到空表单不知所措 |
| P0 | 删除 offering 无二次确认 | 误操作风险 |
| P1 | 表单混用 native input + shadcn Select | 交互不一致 |
| P1 | 表单无实时验证 | 提交后才发现错误 |
| P1 | 无 ARIA 标注 | 无障碍支持差 |
| P1 | 中英术语混用 | 用户困惑 |
| P2 | 质量分无帮助文本 | 用户不知如何填写 |
| P2 | window.location.href 破坏 SPA 路由 | Voice Runtime Lab |

---

## 三、P0 问题详情（必须立即修复）

### P0-1: localStorage 明文存储 API Key

**文件**: `runtime-config-cache.ts:494`
**链路**: `saveAIEnergySecret() → setRuntimeConfigValue(sensitive:true) → writeLocalStorageValue(明文)`
**修复**: sensitive:true 的 key 跳过 localStorage，仅通过 Tauri IPC 存储于 Rust 后端

### P0-2: API Key 日志泄露

**文件**: 多个 ASR 适配器
**修复**: 删除所有 `console.log`/`debug` 中的 API Key 打印

### P0-3: ApiProviderId 硬编码

**文件**: `src/lib/agent-provider/types.ts:1`
```typescript
// 当前
type ApiProviderId = 'openai' | 'anthropic';

// 应改为
type ApiProviderId = string;
// 或
type ApiProviderId = 'openai' | 'anthropic' | 'minimax' | 'qwen' | 'doubao' | string;
```

### P0-4: IASRPort 双副本

**文件**: `ports/asr-port.ts` vs `environment/interfaces/asr.port`
**修复**: 删除 `environment/interfaces/`，统一从 `ports/` 导入

### P0-5: Voice Runtime Provider 无 Port 抽象

**文件**: `voice-runtime/providers/`
**修复**: 定义 `VoiceProviderPort`，抽象 Tauri invoke 调用

### P0-6: quota.exhausted 无实际降级

**文件**: `signals.rs` → 无 consumer
**修复**: 将 quota.exhausted 信号 wiring 到限流逻辑

### P0-7: TTS Port 缺失

**文件**: 无
**修复**: 定义 `ITTSSPort`，接入 MiniMax TTS

### P0-8: AI Registry Dialog 违反 UI 规范

**文件**: `ai-registry-settings-card.tsx`
**修复**: 迁移到语义 token 系统（`cn()` + `bg-card` 等）

---

## 四、目标架构设计

### 4.1 分层架构

```
┌─────────────────────────────────────────────────────────────┐
│                        UI 层 (L4)                           │
│  Settings Registry │ AI Registry Dialog │ Voice Runtime Lab │
└────────────────────────────┬────────────────────────────────┘
                             │ 统一配置
┌────────────────────────────┴────────────────────────────────┐
│                    AI Registry (L3)                         │
│  Channel → Model → Capability → Offering → EnergySource      │
│  Resolution Rule: default → fallback → recommended           │
└────────────────────────────┬────────────────────────────────┘
                             │ Port 接口
┌────────────────────────────┴────────────────────────────────┐
│                      Port 层 (L2)                          │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌────────┐ │
│  │ ASR Port│ │LLM Port │ │ TTS Port│ │Vision   │ │Voice   │ │
│  │ ✅ 已有 │ │⚠️ 不完整│ │❌ 缺失  │ │Port ❌  │ │Port ❌ │ │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └───┬────┘ │
└───────┼───────────┼───────────┼───────────┼──────────┼──────┘
        │           │           │           │          │
┌───────┼───────────┼───────────┼───────────┼──────────┼──────┐
│       ▼           ▼           ▼           ▼          ▼      │
│  Adapter 层 (L1)                                      Adapter │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐     │
│  │ Qwen   │ │ MOSS   │ │Volcano │ │MiniMax │ │ Doubao │     │
│  │ ASR    │ │ ASR    │ │ ASR    │ │ TTS    │ │ Voice  │     │
│  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘     │
│                     External Provider                         │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 核心 Port 接口设计

```typescript
// LLM Port（需扩展）
interface ILLMPort {
  complete(req: LLMRequest): Promise<LLMResponse>;
  stream(req: LLMRequest): AsyncGenerator<string>;
  // 需新增
  completeWithTools(req: LLMWithToolsRequest): Promise<LLMWithToolsResponse>;
}

// TTS Port（需新增）
interface ITTSPort {
  speak(text: string, config?: TTSConfig): Promise<AudioBuffer>;
  streamSpeak(text: string, config?: TTSConfig): AsyncGenerator<Uint8Array>;
}

// Vision Port（需新增）
interface IVisionPort {
  analyze(image: ImageInput, prompt: string): Promise<string>;
}

// Voice Provider Port（需新增）
interface IVoiceProviderPort {
  executeCommand(cmd: string, args: Record<string, unknown>): Promise<unknown>;
}
```

### 4.3 迁移路径

```
Phase 1: 紧急修复 (Day 1-2)
  ├── [安全] 删除 API Key 日志泄露
  ├── [安全] 敏感凭证不写入 localStorage
  └── [安全] LAN 模式加认证提示

Phase 2: P0 问题修复 (Week 1-2)
  ├── [架构] 统一 IASRPort 定义
  ├── [代码] 扩展 ApiProviderId 支持任意 Provider
  ├── [代码] 提取 shared/audio-utils.ts
  └── [UX]   AI Registry Dialog 迁移到语义 token

Phase 3: Port 抽象完善 (Week 2-3)
  ├── [架构] 定义 VoiceProviderPort
  ├── [功能] 实现 TTS Port + MiniMax TTS 适配器
  ├── [功能] 扩展 LLM Port 支持 Tool Calling
  └── [功能] 定义 Vision Port

Phase 4: 能力闭环 (Week 4)
  ├── [商业] quota.exhausted wiring 到限流
  ├── [商业] 配置 OpenRouter fallback 链
  ├── [架构] Voice Runtime 配置纳入 Registry
  └── [功能] Energy Source 健康监控激活

Phase 5: 长期演进 (Month 2+)
  ├── [功能] Video Generation Port
  ├── [商业] 多供应商成本对比
  └── [架构] 完整的多模态支持
```

---

## 五、Issue 创建建议

| 优先级 | Title | 标签 |
|--------|-------|------|
| P0 | `fix(security): 删除 ASR 适配器中的 API Key 日志泄露` | security |
| P0 | `fix(security): 敏感凭证不写入 localStorage` | security |
| P0 | `refactor(registry): 统一 IASRPort 定义，删除双副本` | architecture |
| P1 | `feat(registry): 扩展 ApiProviderId 支持任意 Provider` | feature |
| P1 | `feat(capability): 定义 ITTSPort 并实现 MiniMax TTS 适配器` | feature |
| P1 | `feat(architecture): 定义 IVoiceProviderPort 抽象 Tauri invoke` | architecture |
| P1 | `feat(ux): AI Registry Dialog 迁移到语义 token 系统` | ui |
| P2 | `feat(capability): 扩展 ILLMPort 支持 Tool Calling` | feature |
| P2 | `feat(reliability): 实现 quota.exhausted → 限流 wiring` | reliability |
| P2 | `feat(registry): 配置 OpenRouter fallback 链` | feature |

---

## 六、团队分工建议

建议由 Team Lead 分配以下工作流：

```
Team Lead
├── 安全修复组
│   ├── Agent A: P0-1, P0-2, S2, S3
│   └── Agent B: M1, M2, L2, L3
├── 架构重构组
│   ├── Agent C: P0-4 (IASRPort 统一), P0-5 (VoiceProviderPort)
│   └── Agent D: P0-3 (ApiProviderId), 代码重复消除
├── 功能实现组
│   ├── Agent E: TTS Port + MiniMax TTS
│   ├── Agent F: LLM Port 扩展
│   └── Agent G: Vision Port
└── UX 优化组
    └── Agent H: AI Registry Dialog 重构
```

---

## 七、验收标准

每个 Issue 完成需满足：
1. 代码通过 `npx tsc --noEmit`
2. 相关单元测试通过 `npx vitest run`
3. 无 console.error 或警告
4. 符合 ui-spec.md token 规范（如涉及 UI）
5. PR 描述包含测试命令和结果截图

---

*报告生成: 2026-04-08*
*审计团队: architect, business-analyst, code-reviewer, product-analyst, security-engineer, ux-researcher*
*汇总: team-lead*
