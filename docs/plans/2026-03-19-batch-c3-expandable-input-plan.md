# 批次 C3：通用可伸缩多行输入组件

> **状态**：待执行
> **分支**：直接在 `dev` 上开发
> **关联 Issue**：#587

---

## Context

当前项目中的输入组件主要是底部条状单行/少行输入（如 NowInputRow），不适合需要较长文本录入的场景（事件记录、任务描述、Agent 对话）。需要补充一个「能屈能伸」的多行输入变体：内容少时紧凑，内容多时自然扩展，在允许的宽高范围内自适应。

**本轮范围**：只做组件本身 + 1-2 个关键页面集成演示。全量替换现有输入框为后续 issue 单独跟踪。

---

## 步骤 1：新建 ExpandableTextInput 组件

### 1.1 组件设计

**新建文件**：`src/ui/app/components/ExpandableTextInput.tsx`

**核心特性**：
- 默认紧凑（类似单行输入条的高度）
- 输入内容增加时自动增高（基于 `scrollHeight`）
- 有最大高度限制（可配置），超出后内部滚动
- 支持 `Enter` 发送 / `Shift+Enter` 换行（或反过来，取决于 send mode）
- 兼容当前条状输入的交互语义（发送按钮、语音图标等插槽）
- 深浅模式兼容

```tsx
import { useCallback, useEffect, useRef, type KeyboardEvent, type ChangeEvent } from 'react';

export interface ExpandableTextInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  disabled?: boolean;
  maxRows?: number;           // 最大可见行数，默认 8
  minRows?: number;           // 最小行数，默认 1
  enterToSubmit?: boolean;    // true: Enter 发送, Shift+Enter 换行; false: 反过来
  className?: string;         // 外层容器额外样式
  /** 右侧插槽（如发送按钮、语音图标） */
  trailingSlot?: React.ReactNode;
  /** 自动聚焦 */
  autoFocus?: boolean;
  'data-testid'?: string;
}

export function ExpandableTextInput({
  value,
  onChange,
  onSubmit,
  placeholder = '',
  disabled = false,
  maxRows = 8,
  minRows = 1,
  enterToSubmit = true,
  className = '',
  trailingSlot,
  autoFocus = false,
  'data-testid': testId,
}: ExpandableTextInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // 自动调整高度
  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // 重置高度以获取 scrollHeight
    textarea.style.height = 'auto';

    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 20;
    const minHeight = lineHeight * minRows;
    const maxHeight = lineHeight * maxRows;

    const newHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);
    textarea.style.height = `${newHeight}px`;
  }, [maxRows, minRows]);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    onChange(event.target.value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter') {
      if (enterToSubmit && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
        // Enter 发送
        event.preventDefault();
        onSubmit?.();
      } else if (!enterToSubmit && (event.ctrlKey || event.metaKey)) {
        // Ctrl/Cmd+Enter 发送
        event.preventDefault();
        onSubmit?.();
      }
      // 其他情况（Shift+Enter 或非提交模式的 Enter）正常换行
    }
  }

  return (
    <div
      className={[
        'flex items-end gap-2 rounded-2xl border border-[#E7E5E4] bg-white px-3 py-2 transition-colors',
        'focus-within:border-[#C75B3A]',
        'dark:border-[#292524] dark:bg-[#1C1917] dark:focus-within:border-[#FDBA74]',
        disabled ? 'opacity-50 cursor-not-allowed' : '',
        className,
      ].join(' ')}
      data-testid={testId}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        rows={minRows}
        className={[
          'flex-1 resize-none bg-transparent text-sm text-[#1C1917] outline-none',
          'placeholder:text-[#A8A29E]',
          'dark:text-[#FAFAF9]',
          'scrollbar-thin scrollbar-thumb-[#D6D3D1] dark:scrollbar-thumb-[#44403C]',
        ].join(' ')}
        style={{ overflow: 'auto' }}
      />
      {trailingSlot ? (
        <div className="flex shrink-0 items-center gap-1">
          {trailingSlot}
        </div>
      ) : null}
    </div>
  );
}
```

### 1.2 关键行为说明

**自动增高算法**：
1. 每次 `value` 变化时触发 `adjustHeight`
2. 先设 `height: auto` 让 textarea 收缩到内容高度
3. 读取 `scrollHeight`（内容实际需要的高度）
4. 用 `Math.min(scrollHeight, lineHeight * maxRows)` 限制最大高度
5. 超过 maxRows 后启用内部滚动（`overflow: auto`）

**发送模式**：
- `enterToSubmit = true`（默认）：Enter 发送，Shift+Enter 换行
- `enterToSubmit = false`：Ctrl/Cmd+Enter 发送，Enter 换行

**插槽**：`trailingSlot` 放在 textarea 右侧底部对齐，适合放发送按钮、语音图标等。

### 1.3 验证

```bash
npx tsc --noEmit
```

**新增测试**（`tests/unit/ui/expandable-text-input.test.tsx`）：

```ts
describe('ExpandableTextInput', () => {
  it('renders with placeholder', () => { ... });
  it('calls onChange on input', () => { ... });
  it('Enter submits when enterToSubmit=true', () => { ... });
  it('Shift+Enter does not submit', () => { ... });
  it('Ctrl+Enter submits when enterToSubmit=false', () => { ... });
  it('renders trailingSlot', () => { ... });
  it('disabled state prevents input', () => { ... });
});
```

---

## 步骤 2：在 1-2 个关键页面集成

### 2.1 选择集成页面

在以下页面中选择 1-2 个最适合的位置进行集成演示：

1. **事件日志输入**（NowInputRow 或类似组件）— 最典型的多行输入场景
2. **任务描述编辑**（TaskDetailPage 的描述字段）— 另一个需要多行的场景

**集成方式**：
- 用 `ExpandableTextInput` 替换现有的 `input` 或简单 `textarea`
- 保持原有的提交逻辑和回调
- 配置合适的 `maxRows`、`minRows`、`enterToSubmit`
- 保持 `trailingSlot` 插槽放原有的按钮

### 2.2 兼容要求

- 新组件在视觉上应与当前输入条保持一致的基调（圆角、边框颜色、padding）
- 在窄屏/条状布局下表现为紧凑单行（`minRows=1`）
- 在宽屏/大块布局下可以展开更多行
- 不应因替换而破坏现有的交互流程（发送、语音等）

### 2.3 验证

```bash
npx tsc --noEmit
npx vitest run tests/unit/ui/expandable-text-input.test.tsx
```

**手动验证**：
- 输入少量文字 → 紧凑单行 ✓
- 输入多行文字 → 自动增高 ✓
- 超过 maxRows → 出现内部滚动条 ✓
- 删除内容 → 自动缩回 ✓
- Enter 发送 / Shift+Enter 换行 ✓
- 深色模式下颜色正常 ✓

---

## 关键文件索引

| 文件 | 改动类型 | Issue |
|------|---------|-------|
| `src/ui/app/components/ExpandableTextInput.tsx` | **新建** | #587 |
| `tests/unit/ui/expandable-text-input.test.tsx` | **新建** | #587 |
| 集成页面（1-2 个） | 替换现有输入组件 | #587 |

---

## ⚠️ 不要做清单

| 禁止项 | 原因 |
|--------|------|
| **不要全量替换所有输入框** | 本轮只做组件 + 1-2 个集成，全量替换后续跟踪 |
| **不要改动 NowInputRow 的业务逻辑** | 只替换输入 UI，不改发送/语音/状态逻辑 |
| **不要引入新的 UI 库** | 用原生 textarea + Tailwind 实现自动增高 |
| **不要删除现有的条状输入组件** | 保留作为后续全量迁移的参考 |

## ⚠️ 容易出错的关键点

1. **`height: auto` 必须在读 `scrollHeight` 之前设置**：否则 scrollHeight 返回的是约束后的高度而非内容高度
2. **`lineHeight` 获取**：`getComputedStyle` 返回的 `lineHeight` 可能是 `'normal'`（非数字），需要 fallback 到 20px
3. **IME 输入（中文/日文）**：组合输入期间不应触发 Enter 提交。检查 `event.isComposing` 或 `event.nativeEvent.isComposing`
4. **受控组件的 cursor 位置**：React 的 textarea 受控模式在某些浏览器中可能导致光标跳到末尾。如果出现，用 `useRef` 跟踪 selectionStart/selectionEnd
5. **scrollbar 样式**：`scrollbar-thin` 是 Tailwind plugin，检查项目是否已安装 `tailwind-scrollbar` 插件。如果没有，用浏览器默认滚动条

---

## 验证总表

| 场景 | 操作 | 期望结果 | Issue |
|------|------|---------|-------|
| 紧凑态 | 输入 1 行文字 | 高度等于 1 行 | #587 |
| 自动增高 | 输入 5 行文字 | 高度增加到 5 行 | #587 |
| 最大高度 | 输入 20 行文字 | 高度停在 maxRows，内部滚动 | #587 |
| 自动缩回 | 删除到 1 行 | 高度缩回 | #587 |
| Enter 发送 | enterToSubmit=true 时按 Enter | 触发 onSubmit | #587 |
| 换行 | Shift+Enter | 插入换行，不提交 | #587 |
| IME | 中文输入法组合期间按 Enter | 不提交，正常上屏 | #587 |
| 深色模式 | 切换深色模式 | 颜色正常 | #587 |
| 插槽 | 传入 trailingSlot | 右侧显示按钮 | #587 |
| tsc | `npx tsc --noEmit` | 零错误 | 全部 |

---

## 完成回填

（Codex 执行完毕后在此填写）
