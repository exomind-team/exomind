# Settings Registry: Schema-Driven 设置项注册表

> Issue: #312 — 移动端与桌面端设置项未同步，缺少统一数据源

---

## 1. 问题定义

`SettingsPage.tsx`（2726 行）中移动端和桌面端各自维护 ~650 行独立渲染逻辑，32 个设置项在两端重复编码。没有共享数据源导致新增/修改设置项必须手动同步两端，容易遗漏、重复、错分组。

**根因**：设置项定义与布局展示耦合。

**目标**：引入 Schema-Driven 设置项注册表作为唯一数据源，移动端和桌面端只负责布局。

---

## 2. 设计原则

| 原则 | 说明 |
|------|------|
| 单一数据源 | 所有设置项在注册表中集中声明，两端只引用 |
| 数据驱动渲染 | 大部分设置项通过 `type` 字段声明式驱动 UI 模板 |
| 组件逃生口 | 少数复杂设置项使用 `type: 'custom'` 提供自定义组件 |
| 声明式可见性 | `visible: (ctx) => boolean` 统一处理平台、依赖项、开发者模式等条件 |

这与项目 v4 架构中 Port/Adapter 分离的思路一致：注册表定义"有什么设置"（Port），布局层决定"怎么展示"（Adapter）。

---

## 3. 核心类型系统

### 3.1 Category 定义

```ts
type Category =
  | 'appearance'  // 外观
  | 'timer'       // 计时器
  | 'input'       // 输入
  | 'feedback'    // 反馈
  | 'ai'          // AI 设置
  | 'sync'        // 同步
  | 'data'        // 数据
  | 'developer'   // 开发者
  | 'danger';     // 危险区域
```

9 个细粒度 category 对应移动端的 section 划分。桌面端布局层通过合并配置将多个 category 映射到同一 Tab。

### 3.2 SettingsContext

```ts
interface SettingsContext {
  isDesktop: boolean;
  // 只含平台信息。
  // 依赖其他设置项的值时，直接在 visible() 内调用对应 config 的 get() 函数。
}
```

保持精简：ctx 只提供平台判断。设置项间的依赖关系（如"火山资源模型"依赖"ASR 引擎 === volcano"）通过在 `visible` 函数内直接调用 `getVoiceShortcutAsrProvider()` 解决，不把所有设置值塞进 ctx。

**`isDesktop` 语义**：`isDesktop` 采用视口宽度判断（`window.matchMedia('(min-width: 768px)')`），与现有 `useIsDesktop` hook 保持一致。这控制的是布局方式（移动布局 vs 桌面布局），而非运行平台。如需判断运行平台（如 Tauri vs Web），应使用 `isTauri()` 工具函数，在 `visible` 回调内直接调用。

### 3.3 Discriminated Union 类型

```ts
// === 基础接口 ===

interface SettingsItemBase {
  id: string;
  label: string;
  description?: string;
  icon?: LucideIcon;
  category: Category;
  visible?: (ctx: SettingsContext) => boolean;  // 不填 = 始终可见
}

// === boolean → Switch ===

interface BooleanSettingsItem extends SettingsItemBase {
  type: 'boolean';
  get: () => boolean;
  set: (value: boolean) => void | Promise<void>;  // 允许异步
  subscribe?: (cb: (value: boolean) => void) => () => void;
}

// === enum (单选) → Segmented Control / Select ===

interface SingleEnumSettingsItem extends SettingsItemBase {
  type: 'enum';
  multiSelect?: false;  // 默认 false
  enumStyle?: 'segmented' | 'select';  // 不填由渲染器根据选项数自动决定
  options: { label: string; value: string; icon?: LucideIcon }[];
  get: () => string;
  set: (value: string) => void | Promise<void>;  // 允许异步（如 Tauri IPC）
  subscribe?: (cb: (value: string) => void) => () => void;
}

// === enum (多选) → 多选 Segmented Control ===

interface MultiEnumSettingsItem extends SettingsItemBase {
  type: 'enum';
  multiSelect: true;
  enumStyle?: 'segmented' | 'select';
  options: { label: string; value: string; icon?: LucideIcon }[];
  get: () => string[];
  set: (values: string[]) => void;
  subscribe?: (cb: (values: string[]) => void) => () => void;
}

type EnumSettingsItem = SingleEnumSettingsItem | MultiEnumSettingsItem;

// === 异步 set 处理（如 voice-shortcut-hotkey） ===
// 某些 enum 项的 set() 需要异步操作（如 Tauri IPC 注册快捷键）。
// set 签名为 (value: string) => void | Promise<void>。
// 当 set 返回 Promise 时，EnumRenderer 应：
//   1. 乐观更新 UI（立即显示新值）
//   2. 等待 Promise resolve/reject
//   3. reject 时回滚到 get() 返回的旧值，并通过 toast 显示错误
// 这保证了同步和异步 set 对渲染器来说行为一致。

// 适配说明：feedback-content（反馈内容）当前底层是 FeedbackPreferences 对象
// （三个独立 boolean 字段）。注册时需要编写适配器：
//   get: () => {
//     const p = getFeedbackPreferences();
//     return Object.entries({ timing: p.timingInfoEnabled, ... })
//       .filter(([, v]) => v).map(([k]) => k);
//   },
//   set: (values) => updateFeedbackPreferences({
//     timingInfoEnabled: values.includes('timing'), ...
//   })

// === number → Slider ===

interface NumberSettingsItem extends SettingsItemBase {
  type: 'number';
  min: number;
  max: number;
  step: number;
  unit?: string;  // '%', 'px', '行'
  get: () => number;
  set: (value: number) => void;
  subscribe?: (cb: (value: number) => void) => () => void;
}

// === string → Inline Edit / Dialog Input ===

interface StringSettingsItem extends SettingsItemBase {
  type: 'string';
  stringStyle?: 'inline' | 'dialog';  // 默认 'inline'
  sensitive?: boolean;  // true 时脱敏显示（如 API key 显示 "已配置 (sk-****)"）
  placeholder?: string;
  get: () => string;
  set: (value: string) => void;
  subscribe?: (cb: (value: string) => void) => () => void;
  validate?: (value: string) => string | null;  // 返回错误信息或 null
  mask?: (value: string) => string;  // 自定义脱敏函数
}

// === action → Button ===

interface ActionSettingsItem extends SettingsItemBase {
  type: 'action';
  buttonLabel?: string;
  variant?: 'default' | 'destructive' | 'outline';
  disabled?: boolean | (() => boolean);  // 支持静态值和动态计算（如 loading 状态）
  disabledReason?: string;  // 如 'Coming Soon'
  confirmMessage?: string;  // 非空时点击前弹确认框
  onAction: () => void | Promise<void>;
  // 注意：异步 onAction 的 loading 状态由 ActionRenderer 内部管理。
  // 当 onAction 返回 Promise 时，渲染器自动进入 loading 态，
  // Promise resolve/reject 后退出。无需在注册表中声明 loading。
}

// === group → 子设置项容器 ===

interface GroupSettingsItem extends SettingsItemBase {
  type: 'group';
  children: SettingsItem[];
  // UI：移动端 Drawer，桌面端 Dialog
  // 注意：children 不在顶层 SETTINGS_REGISTRY 数组中出现，
  // 只通过父 group 的 children 字段访问。
  // 渲染管线的 filter/groupBy 不会遍历到 children 内部。
}

// === custom → 自定义组件逃生口 ===

interface CustomSettingsItem extends SettingsItemBase {
  type: 'custom';
  component: React.ComponentType<{ ctx: SettingsContext }>;
}

// === Union ===

type SettingsItem =
  | BooleanSettingsItem
  | EnumSettingsItem
  | NumberSettingsItem
  | StringSettingsItem
  | ActionSettingsItem
  | GroupSettingsItem
  | CustomSettingsItem;
```

### 3.4 扩展性

类型系统基于 discriminated union，后续新增类型（如 `hotkey` 快捷键类型）只需：
1. 新增 `HotkeySettingsItem` interface
2. 加入 union
3. 在渲染器中增加对应模板

不影响已有类型和渲染逻辑。

---

## 4. 设置项注册表

### 4.1 完整清单（32 项）

| # | Category | ID | Label | Type | 特殊字段 |
|---|----------|----|-------|------|----------|
| 1 | appearance | theme | 主题 | enum | options: system/light/dark |
| 2 | timer | countdown-end-mode | 倒计时结束 | enum | options: hard/soft |
| 3 | timer | sound-preset | 提示音 | enum | enumStyle: 'select', options: off+预设 |
| 4 | feedback | feedback-content | 反馈内容 | enum | multiSelect: true, options: timing/statistics/quick |
| 5 | input | voice-transcript-send-mode | 语音转写后 | enum | options: insert/direct-send |
| 6 | input | voice-shortcut-send-mode | 聊天与外部输入语音完成后 | enum | options: insert-only/auto-enter-send |
| 7 | input | voice-shortcut-hotkey | 全局语音快捷键 | enum | options: Alt+Q/Alt+W/Ctrl+Space |
| 8 | input | voice-shortcut-asr-provider | 快捷语音引擎 | enum | options: MOSS/volcano |
| 9 | input | voice-shortcut-mic-prewarm | 预启动麦克风 | boolean | |
| 10 | input | voice-overlay-opacity | 悬浮窗透明度 | number | min/max/step, unit: '%' |
| 11 | input | voice-overlay-show-diagnostics | 显示悬浮窗诊断信息 | boolean | |
| 12 | input | voice-overlay-transcript-lines | 悬浮窗实时文本行数 | number | min: 1, max: 5, unit: '行' |
| 13 | input | voice-overlay-bottom-offset | 悬浮窗距任务栏间距 | number | unit: 'px' |
| 14 | input | volcano-resource-model | 火山资源模型 | enum | enumStyle: 'select', visible: provider===volcano |
| 15 | input | moss-api-token | MOSS API Token | string | sensitive: true, stringStyle: 'dialog' |
| 16 | input | moss-voice-test | MOSS 语音测试 | action | visible: isDev |
| 17 | input | volcano-asr-test | 火山引擎 ASR 测试 | action | visible: isDev |
| 18 | ai | ai-api-key | AI API Key | custom | LLM 配置涉及 provider+key+model |
| 19 | sync | sync-server-url | 同步服务器 | string | stringStyle: 'dialog', validate 函数 |
| 20 | data | export-backup | 导出备份 | action | onAction → Service 层 |
| 21 | data | import-backup | 导入数据 | action | onAction → Service 层 |
| 22 | data | export-tasks-json | 导出任务 JSON | action | onAction → Service 层 |
| 23 | data | export-tasks-sqlite | 导出任务 SQLite | action | onAction → Service 层 |
| 24 | data | import-tasks | 导入任务数据 | action | onAction → Service 层 |
| 25 | developer | developer-mode | 开发者模式 | boolean | |
| 26 | developer | use-mock-data | 使用测试数据 | boolean | visible: isDev |
| 27 | developer | devtools | 开发者工具 | boolean | visible: isDev |
| 28 | developer | feature-toggles | 功能开关 | custom | visible: isDev. 内含子项: agent-page-enabled, desktop-adaptive, command-palette-enabled 等 feature flag boolean 开关 |
| 29 | developer | device-pairing | 设备配对 | custom | visible: isDev |
| 30 | developer | task-backend-status | 任务后端状态 | custom | visible: isDev, 只读信息展示 |
| 31 | danger | clear-local-cache | 清空本地缓存 | action | disabled: true, disabledReason: 'Coming Soon', variant: 'destructive' |
| 32 | danger | reset-all-settings | 重置所有设置 | action | disabled: true, disabledReason: 'Coming Soon', confirmMessage, variant: 'destructive' |

### 4.2 类型分布

- 模板化（boolean/enum/number/string/action）：26 项（81%）
- 自定义组件（custom）：6 项（19%）

---

## 5. 渲染管线

```
Registry
  → filter(item => !item.visible || item.visible(ctx))
  → groupBy(item.category)
  → 布局层决定展示方式
      ├─ MobileSettingsLayout: 竖向 section 列表
      └─ DesktopSettingsLayout: Tab 分栏（合并 category）
```

### 5.1 模板渲染器

每种 type 对应一个渲染器组件：

| Type | 渲染器 | UI 元素 |
|------|--------|---------|
| boolean | `BooleanRenderer` | Switch 开关 |
| enum (single, segmented) | `EnumRenderer` | 滑动 Segmented Control（参考 FocusTimerWidget 的预期时长交互） |
| enum (single, select) | `EnumRenderer` | Select 下拉框 |
| enum (multi) | `EnumRenderer` | 多选 Segmented Control（可同时选中多个） |
| number | `NumberRenderer` | Slider + 数值显示 |
| string (inline) | `StringRenderer` | 点击前显示当前值，点击后变为输入框；sensitive 时脱敏 |
| string (dialog) | `StringRenderer` | 显示当前值 + ChevronRight，点击弹出 Dialog 输入 |
| action | `ActionRenderer` | Button，支持 loading/disabled/confirm |
| group | `GroupRenderer` | 列表行 + ChevronRight，点击弹出容器（移动端 Drawer / 桌面端 Dialog） |
| custom | `CustomRenderer` | 直接渲染 `item.component` |

### 5.2 状态管理

每个渲染器内部使用 `useSyncExternalStore` 对接注册表项的 `get`/`subscribe`：

```ts
// 模块级常量，避免每次渲染创建新函数导致无限 re-subscribe
const NOOP_SUBSCRIBE = () => () => {};

function BooleanRenderer({ item }: { item: BooleanSettingsItem }) {
  const value = useSyncExternalStore(
    item.subscribe ?? NOOP_SUBSCRIBE,
    item.get
  );
  return <Switch checked={value} onCheckedChange={item.set} />;
}
```

**注意**：`useSyncExternalStore` 通过引用相等判断 subscribe 是否变化。如果传入每次渲染都创建的新函数，会导致无限 re-subscribe。因此 fallback 必须使用模块级常量 `NOOP_SUBSCRIBE`。

对于没有 `subscribe` 的注册项（使用 NOOP_SUBSCRIBE），渲染器只在挂载时读取一次初始值，不会响应外部变更。如果某个设置项需要实时响应变更（如外部代码修改了值），必须在对应的 `src/config/*.ts` 中添加 subscribe 实现。

SettingsPage 不再持有任何设置项状态，成为纯布局组件。

### 5.3 Enum Segmented Control UI

参考当前 `FocusTimerWidget` 中"预期时长"的实现：
- Grid 布局 + 绝对定位滑动指示器
- `transition-transform` 动画
- 选中项高亮，未选中项灰色

所有 segmented 风格的 enum 统一使用此交互模式。

---

## 6. 布局层

### 6.1 移动端 MobileSettingsLayout

按注册表数组顺序，以 category 为 section 分组渲染：

```
[用户卡片]（布局硬编码，不在注册表）
[外观] section
[计时器] section
[输入] section
[反馈] section
[AI 设置] section
[同步] section
[数据] section
[开发者] section（visible 过滤后可能为空）
[危险区域] section
[关于 / 更新]（布局硬编码，不在注册表）
```

### 6.2 桌面端 DesktopSettingsLayout

通过布局配置将 category 合并为 Tab：

```ts
const DESKTOP_TAB_CONFIG = [
  { key: 'appearance', label: '外观主题', categories: ['appearance'] },
  { key: 'focus', label: '专注设置', categories: ['timer', 'feedback'] },
  { key: 'input', label: '输入', categories: ['input'] },
  { key: 'services', label: '服务', categories: ['ai', 'sync'] },
  { key: 'data', label: '数据', categories: ['data'] },
  { key: 'developer', label: '开发者', categories: ['developer'] },
  { key: 'danger', label: '危险区域', categories: ['danger'] },
];
```

桌面端独有的设置项（后续新增，如悬浮窗高级配置）给独立 Tab。

Tab 合并规则集中管理，调整分组只需改此配置。

**与现有桌面端 Tab 的变化**：现有桌面端使用 `外观主题 / 专注设置 / 通知 / 数据 / 关于 / 危险区域` 六个 Tab。本次重构将：
- 原"通知"Tab（混入了语音输入 + 同步 + 开发者设置）拆分为独立的"输入"和"服务"Tab
- 开发者设置从"通知"中移出，单独成 Tab
- 新增"服务"Tab 合并 AI 和同步设置
- 这是有意的 UX 改进，修正了当前分组语义错误（语音设置不属于"通知"）

**关于页处理**：`MoreSection`（更多）和 `AboutSection`（关于）不进注册表，与移动端一样由桌面布局层硬编码放在滚动区域底部（Tab 内容之后）。

### 6.3 弹出容器

`type: 'group'` 的子设置项在不同平台使用不同容器：
- **移动端**：底部 Drawer（拇指友好）
- **桌面端**：居中 Dialog

布局层负责选择容器类型。

---

## 7. 文件组织

```
src/ui/app/
├── config/
│   └── settings/
│       ├── settings-types.ts           # 类型定义
│       ├── settings-registry.ts        # 注册表（唯一数据源）
│       └── desktop-tab-config.ts       # 桌面端 Tab 合并配置
├── components/
│   └── settings/
│       ├── settings-renderers.tsx       # 模板渲染器（Boolean/Enum/Number/String/Action/Group/Custom）
│       ├── settings-item-row.tsx        # 单行设置项容器（icon + label + description + right control）
│       └── settings-section.tsx         # 分组容器（标题 + 卡片）
├── pages/
│   └── SettingsPage.tsx                 # 入口：平台判断 → 布局分发（从 2726 行瘦身）
└── layouts/
    ├── MobileSettingsLayout.tsx          # 移动端布局
    └── DesktopSettingsLayout.tsx         # 桌面端布局
```

### 现有文件处理

- `settings-shared.tsx`：吸收进 `settings-renderers.tsx` / `settings-item-row.tsx`
- `src/config/*.ts`（21 个配置文件）：保持不变，注册表通过 get/set/subscribe 引用它们

---

## 8. Service 层抽取

导出/导入操作的异步逻辑从 SettingsPage 抽到 Service 层：

```
src/services/
└── impl/
    └── settings-data-service.ts
        ├── exportBackup()
        ├── importBackup()       // 内部处理文件选择
        ├── exportTasksJson()
        ├── exportTasksSqlite()
        └── importTasks()        // 内部处理文件选择
```

注册表中 action 项的 `onAction` 只是调用 Service 方法。

### 8.1 Web 平台文件选择策略

导入操作在 Web 平台（非 Tauri）需要触发 `<input type="file">` 选择器。Service 层统一处理两种平台：

- **Tauri**：直接调用 `invoke('pick_json_file')` 打开原生文件对话框
- **Web**：Service 内部动态创建临时 `<input type="file">` 元素并 programmatically click，通过 Promise 封装 `onchange` 回调。用完即移除 DOM 节点。

```ts
// settings-data-service.ts 中的 Web 文件选择封装
function pickFileOnWeb(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    };
    input.oncancel = () => {
      resolve(null);
      input.remove();
    };
    document.body.appendChild(input);
    input.click();
  });
}
```

这样 `onAction` 调用方无需管理任何 DOM ref，Service 自行封装平台差异。

---

## 9. 验收测试

### 9.1 自动化注册表一致性测试

```ts
// tests/unit/settings/settings-registry-consistency.test.ts

describe('Settings Registry Consistency', () => {
  const desktopCtx: SettingsContext = { isDesktop: true };
  const mobileCtx: SettingsContext = { isDesktop: false };

  it('所有 category 在两端都有入口', () => {
    const categories = new Set(SETTINGS_REGISTRY.map(item => item.category));
    // 每个 category 在 DESKTOP_TAB_CONFIG 中都有对应 Tab
    for (const cat of categories) {
      expect(DESKTOP_TAB_CONFIG.some(tab => tab.categories.includes(cat))).toBe(true);
    }
  });

  it('非平台限定的设置项在两端均可见', () => {
    const platformAgnosticItems = SETTINGS_REGISTRY.filter(
      item => !item.visible || (item.visible(desktopCtx) && item.visible(mobileCtx))
    );
    // 这些项在两端都应该渲染
    expect(platformAgnosticItems.length).toBeGreaterThan(0);
  });

  it('每个注册项都有唯一 id', () => {
    const ids = SETTINGS_REGISTRY.map(item => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每个注册项的 type 有对应渲染器', () => {
    const supportedTypes = ['boolean', 'enum', 'number', 'string', 'action', 'group', 'custom'];
    for (const item of SETTINGS_REGISTRY) {
      expect(supportedTypes).toContain(item.type);
    }
  });

  it('enum 类型的 multiSelect 项 get() 返回 string[]', () => {
    const multiEnums = SETTINGS_REGISTRY.filter(
      (item): item is MultiEnumSettingsItem => item.type === 'enum' && item.multiSelect === true
    );
    for (const item of multiEnums) {
      const value = item.get();
      expect(Array.isArray(value)).toBe(true);
    }
  });

  it('所有 subscribe 字段为函数或 undefined（非每次渲染创建的新函数）', () => {
    // 确保注册表项的 subscribe 是稳定引用
    for (const item of SETTINGS_REGISTRY) {
      if ('subscribe' in item && item.subscribe !== undefined) {
        expect(typeof item.subscribe).toBe('function');
      }
    }
  });

  it('async set 的 enum 项（如 hotkey）返回 Promise 时可正常 await', async () => {
    const hotkeyItem = SETTINGS_REGISTRY.find(
      (item): item is SingleEnumSettingsItem =>
        item.id === 'voice-shortcut-hotkey' && item.type === 'enum' && !item.multiSelect
    );
    expect(hotkeyItem).toBeDefined();
    // set 返回 void | Promise<void>，如果是 Promise 则 await 不应抛出
    const result = hotkeyItem!.set(hotkeyItem!.options[0].value);
    if (result instanceof Promise) {
      await expect(result).resolves.toBeUndefined();
    }
  });
});
```

### 9.2 验收标准对照

| #312 验收标准 | 实现方式 |
|--------------|----------|
| 设置项集中定义在统一注册表中 | `settings-registry.ts` 唯一数据源 |
| 两端从注册表读取，不再硬编码 | MobileLayout / DesktopLayout 遍历注册表 |
| 新增设置项只改一处 | 在 `SETTINGS_REGISTRY` 数组中加一项 |
| 两端设置项完全一致 | 自动化测试验证 |
| 分组合理，开发者设置不混入其他分组 | category 字段 + Tab 配置分离 |

---

## 10. 迁移策略

一步到位替换：

1. 创建类型定义和注册表
2. 实现模板渲染器
3. 实现两端布局组件
4. 抽取 Service 层
5. 替换 SettingsPage 入口
6. 删除旧的 inline 渲染逻辑
7. 运行测试验证

不做渐进式迁移，避免两种模式共存。

---

## 11. 不在本次范围

- i18n 国际化（已有独立 issue 跟踪）
- 快捷键 (hotkey) 类型（后续按需扩展）
- 设置项搜索/过滤功能
- 设置项云端同步
