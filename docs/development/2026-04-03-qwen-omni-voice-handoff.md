# Qwen Omni 语音适配交接说明（2026-04-03）

## 结论先行

本轮已经完成：

- 为 `快捷语音引擎` 新增 `qwen-omni` 供应商分支
- 复用 `AI Registry / provider profile` 管理 DashScope `API Key / Base URL`
- 将 `byetype` 风格的 4 份提示词文档接入外心，并支持在设置页统一管理、编辑、重置
- 完成 `qwen3-omni-flash` 的基础 prompt 调优与真实音频回归

本轮明确暂停：

- 暂停继续调试阿里云 `Qwen3.5-Omni-Plus / Qwen3.5-Omni-Plus-2026-03-15`
- 暂停继续投入 `Qwen3-Omni-Flash` 的生产级语音识别适配

原因：

- `Qwen3.5-Omni-Plus*` 当前账号返回 `403 access_denied`
- `Qwen3-Omni-Flash` 虽然模型可访问，但用户最新实测结论是“当前语音识别仍不成功”
- 旧模型额度也不理想，继续消耗按量付费模型做适配不划算
- 用户决定等待后续 `Qianwen 3.5 Omni Flash Runtime` 模型申请成功后再继续

---

## 本轮完成内容

### 1. 语音供应商接入

已完成 `qwen-omni` 最小接入：

- `src/config/voice-shortcut-asr-provider.ts`
- `src/services/voice-shortcut.service.ts`
- `src/lib/adapters/asr/qwen-omni-asr.ts`

支持：

- 在全局语音快捷键链路中选择 `Qwen Omni`
- 从 `provider profile` 读取 DashScope 凭证
- 在 `volcano / moss / qwen-omni` 三条链路之间分发

### 2. 提示词文档统一管理

已将 `byetype` 风格提示词体系引入外心，且不再硬编码为只读常量。

新增/修改：

- `src/lib/voice/qwen-omni-prompts.ts`
- `src/config/voice-omni-prompts.ts`
- `src/ui/app/components/settings/settings-custom-items.tsx`
- `src/ui/app/config/settings/settings-registry.ts`

当前可管理的 4 份文档：

- `agent`
- `rules`
- `vocabulary`
- `textOptimize`

设置页中已新增：

- `Qwen Omni 供应商档案`
- `Qwen Omni 提示词`
- `Qwen Omni 模型 ID`
- `启用 Qwen 二次排版`

### 3. 已做的真实验证

已验证过的事实：

- DashScope 北京地址 `https://dashscope.aliyuncs.com/compatible-mode/v1` 正常
- 新旧 Key 都可访问 `qwen-plus`
- 新旧 Key 都可访问 `qwen-omni-turbo-latest`
- `Qwen3.5-Omni-Plus*` 返回 `403 access_denied`
- `qwen3-omni-flash` 对真实中文音频在 `byetype` 风格 prompt 下可输出接近转写结果
- `qwen3-omni-flash` 对静音样本可输出 `No content, please re-enter.`

但用户最终实测结论是：

- 当前阿里云语音识别链路依然“不够成功 / 不够可用”

因此本轮不再继续在现有阿里云模型上投入时间。

---

## 当前代码状态

当前代码默认值已调整到更合理的实验路径：

- `voiceOmniModelId` 默认值：`qwen3-omni-flash`
- `Qwen3.5-Omni-Plus*` 的错误提示已改为明确说明权限问题，不再模糊报错

相关文件：

- `src/config/voice-omni-settings.ts`
- `src/lib/adapters/asr/qwen-omni-asr.ts`

注意：

- 这不等于功能已达到“可正式使用”的标准
- 当前应将其视为“实验性接入 + 暂停状态”

---

## 为什么暂停

暂停不是因为完全没有进展，而是因为继续投入的性价比明显下降。

### 已确认的问题

1. `Qwen3.5-Omni-Plus*` 是权限问题，不是配置问题

- 同一把 Key 可访问别的模型
- 唯独 `Qwen3.5-Omni-Plus*` 返回 `403 access_denied`

2. `Qwen3-Omni-Flash` 是“效果/稳定性”问题，不是模型不可达问题

- 模型可访问
- prompt 也已明显改善输出
- 但用户的真实使用结论仍是“现在语音识别不成功”

3. 继续在旧模型上按量付费调试，不符合当前投入产出比

---

## 后续建议

### 短期

- 不再继续调试当前阿里云语音模型
- 将本轮成果保留为“实验基础设施”
- 下一轮对话不要再从零开始排查供应商接入和提示词管理

### 中期

等待用户申请到新的：

- `Qianwen 3.5 Omni Flash Runtime`

申请成功后再恢复语音实验。

### 恢复时的起点

恢复时优先从这些文件继续：

- `src/services/voice-shortcut.service.ts`
- `src/lib/adapters/asr/qwen-omni-asr.ts`
- `src/config/voice-omni-prompts.ts`
- `src/ui/app/components/settings/settings-custom-items.tsx`

---

## PR / Decom 摘要（可复用）

### 建议标题

`docs: handoff qwen omni voice experiment and pause aliyun tuning`

### 建议摘要

- 新增 `qwen-omni` 语音供应商分支，接入全局语音快捷键链路
- 复用 `AI Registry / provider profile` 管理 DashScope 凭证
- 将 `byetype` 风格的 4 份提示词文档接入外心，并支持在设置页统一管理
- 记录 `Qwen3.5-Omni-Plus*` 权限失败与 `Qwen3-Omni-Flash` 实测仍不可用的暂停结论
- 明确后续等待 `Qianwen 3.5 Omni Flash Runtime` 申请通过后再继续

### 不应声称

- 不应声称“阿里云语音链路已可正式使用”
- 不应声称“Qwen3.5-Omni-Plus 已打通”

---

## 下一轮对话建议开场

可直接引用：

> 继续基于 `docs/development/2026-04-03-qwen-omni-voice-handoff.md`，不要重新排查旧的 DashScope/Qwen Omni 权限问题。本轮目标是基于新的 Runtime 模型继续语音适配。
