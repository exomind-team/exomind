# 批次 D：设置页拆分 + 语音输入来源感知

> **状态**：待执行
> **分支**：直接在 `dev` 上开发
> **关联 Issue**：#611, #612
> **执行顺序**：#611 → #612

---

## Context

1. **#611**：火山引擎的"配置"和"测试"混在同一个页面（`VolcanoASRTestPage`），设置页入口名不副实。需要把配置项提取到设置页，测试页保留为诊断工具。
2. **#612**：语音输入自动记录到 EventLog 的行为需要：(a) 设置项开关控制，(b) 记录时标记来源为语音，(c) UI 中以特殊形态展示语音来源消息。

---

## 步骤 1：#611 拆分火山引擎 API 配置与 ASR 测试入口

### 1.1 分析当前结构

**当前**：设置页有一个"火山引擎 API 配置"入口，点击后跳到 `VolcanoASRTestPage`。该页面同时承载：
- AppKey / AccessKey / Resource ID 等配置输入
- ASR 录音测试功能

**目标**：
- 设置页直接展示火山配置项（AppKey、AccessKey、识别模式、资源模型、Resource ID、识别语言）
- "火山引擎 ASR 测试"保留为独立入口，仅用于诊断

### 1.2 改动

**文件**：设置页相关文件（检查 `src/ui/app/pages/SettingsPage.tsx` 或类似文件）

1. 在设置页中新增"火山引擎"配置分组，直接内联配置项（参考 MOSS API Token 的设置方式）
2. 每个配置项使用 localStorage 或已有的配置存储机制
3. 原"火山引擎 API 配置"入口改名为"火山引擎 ASR 测试"，保持跳转到 `VolcanoASRTestPage`
4. `VolcanoASRTestPage` 中的配置输入改为读取设置页的配置值（只读展示或引导回设置页）

**配置项清单**：
- AppKey（密码型输入）
- AccessKey（密码型输入）
- 识别模式（单选枚举）
- 资源模型（单选枚举或文本输入）
- Resource ID（文本输入）
- 识别语言（单选枚举）

**注意**：检查 `VolcanoASRTestPage` 中已有的配置项定义（状态名、localStorage key 等），设置页应复用相同的存储 key，而非新建。

### 1.3 验证

```bash
bunx tsc --noEmit
```

**手动验证**：
- 设置页直接可见火山配置项 ✓
- 修改配置后 ASR 测试页读取到新值 ✓
- ASR 测试页仍可正常录音测试 ✓

---

## 步骤 2：#612 语音输入自动记录开关 + 来源感知展示

### 2.1 设置项开关

**文件**：设置页

新增"语音输入自动记录"开关（boolean），默认开启。

```ts
const VOICE_AUTO_RECORD_KEY = 'exomind:voice-auto-record';

// 默认 true（与当前行为一致）
function readVoiceAutoRecord(): boolean {
  try {
    const saved = window.localStorage.getItem(VOICE_AUTO_RECORD_KEY);
    if (saved === '0') return false;
  } catch { /* ignore */ }
  return true;
}
```

### 2.2 语音输入来源标记

**文件**：语音输入写入 EventLog 的入口（检查 `src/services/voice-shortcut.service.ts` 或 `NowInputRow` 中的语音提交逻辑）

在写入事件时，metadata 中追加来源标记：

```ts
metadata: {
  source: getEventSourceMetadata(),
  inputSource: 'voice',       // ★ 新增：标记来源
  inputMethod: 'recognition', // ★ 新增：识别方式
}
```

同时在写入前检查开关：

```ts
if (!readVoiceAutoRecord()) {
  return; // 开关关闭时不自动记录
}
```

### 2.3 UI 来源感知展示

**文件**：事件日志渲染组件（检查 `EventMarkdown.tsx` 或事件列表的渲染组件）

当事件的 `metadata.inputSource === 'voice'` 时，以特殊形态展示：

```tsx
// 在事件项渲染中：
const isVoiceInput = event.metadata?.inputSource === 'voice';

{isVoiceInput ? (
  <span className="inline-flex items-center gap-1 text-[10px] text-[#A8A29E]">
    <Mic size={10} /> {/* lucide-react Mic 图标 */}
    语音输入
  </span>
) : null}
```

### 2.4 验证

```bash
bunx tsc --noEmit
```

**手动验证**：
- 设置页可见"语音输入自动记录"开关 ✓
- 开关开启时语音输入自动写入 EventLog ✓
- 开关关闭时语音输入不写入 EventLog ✓
- EventLog 中语音来源事件显示 🎤 图标 + "语音输入"标签 ✓
- 非语音事件不显示该标签 ✓

---

## 关键文件索引

| 文件 | 改动类型 | Issue |
|------|---------|-------|
| 设置页 | 新增火山配置分组 + 语音开关 | #611 #612 |
| `VolcanoASRTestPage` | 配置读取改为引用设置页存储 | #611 |
| 语音输入服务 | 检查开关 + 追加 metadata | #612 |
| 事件列表渲染组件 | 语音来源形态展示 | #612 |

---

## ⚠️ 不要做清单

| 禁止项 | 原因 |
|--------|------|
| **不要删除 VolcanoASRTestPage** | 测试页保留为诊断工具 |
| **不要改动 ASR 识别引擎逻辑** | 只改配置 UI 和事件标记 |
| **不要改动 EventLog 的存储格式** | 只在 metadata 中追加字段 |
| **不要新建 localStorage key 替代已有的** | 复用 VolcanoASRTestPage 中已有的配置存储 key |

## ⚠️ 容易出错的关键点

1. **火山配置项的 localStorage key**：`VolcanoASRTestPage` 中已有存储逻辑，设置页必须用相同的 key，否则两处配置不同步
2. **语音开关默认值**：必须默认开启（true），与当前行为一致，否则升级后语音输入突然不记录
3. **metadata.inputSource 的判断**：事件的 metadata 可能为 undefined，需要安全访问 `event.metadata?.inputSource`
4. **Mic 图标 import**：从 `lucide-react` 导入 `Mic`，检查项目中是否已有该图标的使用

---

## 验证总表

| 场景 | 操作 | 期望结果 | Issue |
|------|------|---------|-------|
| 火山配置 | 设置页查看 | 可见 AppKey/AccessKey 等配置项 | #611 |
| 火山测试 | 点击 ASR 测试入口 | 跳到测试页，读取设置页配置 | #611 |
| 语音开关-开 | 开启自动记录，语音输入 | EventLog 新增事件 | #612 |
| 语音开关-关 | 关闭自动记录，语音输入 | EventLog 不新增事件 | #612 |
| 语音标记 | 查看 EventLog 中的语音事件 | 显示 🎤 语音输入标签 | #612 |
| 非语音 | 查看手动输入的事件 | 不显示语音标签 | #612 |
| tsc | `bunx tsc --noEmit` | 零错误 | 全部 |

---

## 完成回填

- 执行日期：2026-03-21
- 执行结果：#611、#612 已按顺序完成
- 主要落地：
  - `settings-registry.ts`：新增火山 AppKey / AccessKey / 识别模式 / 资源模型 / Resource ID / 识别语言设置项；原“火山引擎 API 配置”入口改为“火山引擎 ASR 测试”；新增“语音输入自动记录”开关，默认开启
  - `volcano-asr-settings.ts`：复用 `VolcanoASRTestPage` 原有 `VOLCANO_STORAGE_KEYS` 封装火山配置读写与订阅，无新增 localStorage key
  - `voice-auto-record.ts`：新增语音自动记录设置模块，默认值保持为 `true`
  - `VolcanoASRTestPage.tsx`：改为诊断工具形态，核心火山配置只读展示并引导回设置页；测试页保留录音测试与高级测试参数
  - `voice-shortcut-eventlog.ts` / `voice-shortcut.service.ts`：语音写入 EventLog 时追加 `metadata.source`、`metadata.inputSource = 'voice'`、`metadata.inputMethod = 'recognition'`；自动记录关闭时跳过 EventLog 追加
  - `ChatPage.tsx`：在事件日志 UI 中按 `event.metadata?.inputSource === 'voice'` 安全展示 `Mic + 语音输入` 标签
- 验证命令：
  - `bunx tsc --noEmit`
- 验证结果：
  - `tsc` 通过
