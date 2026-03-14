# Settings Registry: 实现演化记录

> 本文档记录设置注册表从初始设计（`2026-03-11-settings-registry-design.md`）到当前实现的所有演化。
>
> 相关提交：
> - `616d0e5` — 设置页注册表重构后 39 个测试文件全部通过
> - `63f56a1` — `ARCJ137442` 修复注册表驱动后 45→0 测试失败 (#522)
> - `f7f4c79` — `ARCJ137442` 恢复「更多」「关于」功能（更新 & 官网）

---

## 1. Category 扩展

**设计文档**：9 个 category。

**当前实现**：11 个 category，新增 `'more'` 和 `'about'`。

```ts
type Category =
  | 'appearance' | 'timer' | 'input' | 'feedback'
  | 'ai' | 'sync' | 'data' | 'developer'
  | 'more'     // 新增：更多操作（检查更新、帮助中心、反馈、遥测、调试日志、报告 Bug）
  | 'about'    // 新增：关于（官网、赞助）
  | 'danger';
```

**设计文档描述**：原先「更多」和「关于」由布局层硬编码（`MoreSection` / `AboutSection`），不进注册表。

**变更原因**：为实现注册表驱动的完整统一，将「更多」「关于」也纳入注册表，使用 `action` 类型统一声明。布局层不再需要硬编码特殊 section。

---

## 2. SettingsContext 扩展

**设计文档**：

```ts
interface SettingsContext {
  isDesktop: boolean;
}
```

**当前实现**：

```ts
interface SettingsContext {
  isDesktop: boolean;
  isLandscape?: boolean;           // 横屏判断（移动端布局适配）
  developerMode?: boolean;         // 开发者模式状态（替代 visible 内调 get）
  desktopAdaptiveEnabled?: boolean; // 桌面自适应布局是否启用
  voiceShortcutAsrProvider?: string; // 当前 ASR 引擎（控制火山相关项可见性）
}
```

**变更原因**：原设计建议在 `visible()` 内直接调用 `getVoiceShortcutAsrProvider()` 等函数。实践中发现这些值被多个设置项频繁引用，提升到 Context 中减少重复调用并保证一致性。

---

## 3. 通用字段扩展

### 3.1 测试基础设施字段

所有类型新增：

| 字段 | 类型 | 说明 |
|------|------|------|
| `rowTestId` | `string` | 行容器的 `data-testid` |
| `controlTestId` | `string` | 控件的 `data-testid` |

Enum 类型额外新增：

| 字段 | 类型 | 说明 |
|------|------|------|
| `optionTestId` | `(value, index) => string` | 选项级 `data-testid` 生成器 |

**目的**：使测试能精确定位注册表驱动的 UI 元素，替代旧版硬编码 testId。

### 3.2 操作反馈字段

所有带 `set()` / `onAction()` 的类型新增：

| 字段 | 类型 | 说明 |
|------|------|------|
| `successMessage` | `string \| ((value) => string)` | 操作成功后的 toast 消息 |
| `errorMessagePrefix` | `string` | 操作失败时的 toast 前缀 |

### 3.3 set() 返回类型变更

**设计文档**：`set: (value: T) => void | Promise<void>`

**当前实现**：`set: (value: T) => T | void | Promise<T | void>`

返回值为 `string` 时可作为自定义成功消息传递给渲染器。

---

## 4. Enum `'dialog'` 样式

**设计文档**：`enumStyle?: 'segmented' | 'select'`

**当前实现**：`enumStyle?: 'segmented' | 'select' | 'dialog'`

新增 `'dialog'` 样式时附带字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `dialogTitle` | `string` | Dialog 标题 |
| `dialogDescription` | `string` | Dialog 描述 |
| `helperText` | `(value) => string \| null` | 选中值下方的辅助文本 |

Options 扩展：

| 字段 | 类型 | 说明 |
|------|------|------|
| `description` | `string` | 选项描述（dialog 模式下显示） |
| `summaryLabel` | `string` | 选中后在行内显示的缩略标签 |

**适用场景**：选项较多或需要详细说明时（如计时器提示音选择），用 Dialog 替代 Select 下拉框。Dialog 使用 `role="dialog"` 和 `aria-label` 增强无障碍访问。

---

## 5. StringSettingsItem 扩展

**设计文档**：5 个字段（`stringStyle`, `sensitive`, `placeholder`, `validate`, `mask`）

**当前实现**：14 个字段，新增：

| 字段 | 类型 | 说明 |
|------|------|------|
| `dialogFieldKind` | `'plain' \| 'secret'` | Dialog 输入框类型 |
| `dialogInputType` | `'text' \| 'url'` | 输入框 HTML type |
| `dialogTitle` | `string` | Dialog 标题 |
| `dialogDescription` | `string` | Dialog 描述 |
| `dialogFooterStart` | `text \| secret-toggle` | Dialog 底部左侧内容 |
| `dialogFooterEnd` | `string` | Dialog 底部右侧文本 |
| `allowClear` | `boolean` | 是否显示清除按钮 |
| `clearSuccessMessage` | `string \| ((value) => string)` | 清除成功后消息 |
| `emptyValueLabel` | `string` | 值为空时的显示文本 |

**变更原因**：MOSS API Token、同步服务器 URL 等敏感字符串设置需要更丰富的 Dialog 交互（显示/隐藏切换、URL 验证、清除操作）。

---

## 6. ActionSettingsItem 扩展

**设计文档**：标准 Button 模式。

**当前实现**新增：

| 字段 | 类型 | 说明 |
|------|------|------|
| `actionMode` | `'row' \| 'button'` | `'row'` = 整行可点击，`'button'` = 仅按钮可点 |
| `hideChevron` | `boolean` | 隐藏右侧箭头（如纯按钮式操作） |
| `rightText` | `string \| (() => string)` | 右侧显示的状态文本（如版本号） |

`onAction` 返回类型从 `void | Promise<void>` 变为 `string | void | Promise<string | void>`，返回 string 时作为 toast 消息。

**适用场景**：「更多」section 中的导航型 action（检查更新、帮助中心）使用 `actionMode: 'row'` + 整行点击；数据操作（导出、导入）保持 `'button'` 模式。

---

## 7. GroupSettingsItem 扩展

新增字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `groupStyle` | `'adaptive-overlay'` | 子设置项容器样式（自适应覆盖层） |
| `dialogTitle` | `string` | 弹出容器标题 |
| `dialogDescription` | `string` | 弹出容器描述 |

---

## 8. `openExternalUrl` 工具函数

`f7f4c79` 引入的跨平台 URL 打开工具：

```ts
async function openExternalUrl(url: string): Promise<void> {
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
```

- Tauri 环境使用 `@tauri-apps/plugin-opener` 调用系统浏览器
- Web 环境 fallback 到 `window.open`
- 用于「帮助中心」「反馈」「报告 Bug」「官网」等外部链接

---

## 9. 测试基础设施变更（`63f56a1`）

### 9.1 新增 Mock

| Mock 目标 | 文件 | 说明 |
|-----------|------|------|
| `@tauri-apps/plugin-log` | `tests/__mocks__/@tauri-apps/plugin-log.ts` | 空 mock，解决 Vite import 错误 |
| `voice-shortcut-asr-provider` subscribe | `setup-settings-mocks.tsx` | 模拟 listener 通知机制 |
| Dialog `role`/`aria-label` | `setup-settings-mocks.tsx` | 支持 dialog enum 的无障碍属性查询 |

### 9.2 Vitest 配置

`vitest.config.ts` 新增 resolve alias：

```ts
'@tauri-apps/plugin-log': resolve(__dirname, 'tests/__mocks__/@tauri-apps/plugin-log.ts')
```

### 9.3 测试迁移

| 测试文件 | 变更 |
|----------|------|
| `settings-timer-card.issue182.test.tsx` | 迁移到 `setup-settings-mocks`，适配 registry dialog enum（原 191 行 → 精简） |
| `settings-desktop-vc-tabs.issue198.test.tsx` | 按钮标签 `'导出备份'` → `'导出数据'` |
| `settings-input-section.issue199.test.tsx` | Skip mount-time hotkey sync（registry 版暂未实现） |

---

## 10. 设置项清单更新

**设计文档**：32 项。

**当前实现**：约 40+ 项（新增 `more` 和 `about` category）。

### 新增 `more` category 项

| ID | Label | Type | 说明 |
|----|-------|------|------|
| `more-update` | 检查更新 | action | 导航到 `/update` 页面 |
| `more-help` | 帮助中心 | action | 打开 GitHub Wiki |
| `more-feedback` | 反馈 | action | 打开 GitHub Issue（feedback 模板） |
| `more-telemetry` | 匿名使用数据 | boolean | 遥测开关 |
| `more-debug-log` | 调试日志 | action | 导航到调试日志页面 |
| `more-report-bug` | 报告 Bug | action | 打开 GitHub Issue（bug 模板） |

### 新增 `about` category 项

| ID | Label | Type | 说明 |
|----|-------|------|------|
| `about-website` | 官方网站 | action | 打开 exo-mind.ai |
| `about-sponsor` | 赞助 | action | 赞助页面 |

---

## 11. 架构影响

这些演化 **不改变** 设计文档中的核心架构决策：

- **单一数据源**：注册表仍是唯一数据源，更多/关于的纳入反而强化了这一点
- **数据驱动渲染**：新增字段全部是声明式的，渲染器自动适配
- **类型安全**：Discriminated Union 模式不变，新增字段为可选
- **渲染管线**：`filter → groupBy → layout` 流程不变

变更的本质是：在实践中发现初始设计中部分"布局层硬编码"的决策不如统一进注册表，以及 Dialog 交互需要更丰富的声明式配置。

---

*文档版本: v1.0*
*更新: 2026-03-14*
*作者: 基于 ARCJ137442 提交 + 代码分析自动生成*
