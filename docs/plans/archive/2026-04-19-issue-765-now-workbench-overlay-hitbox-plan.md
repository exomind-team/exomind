# Issue #765 Now Workbench Overlay Hitbox Plan

> 关联 Issue: `#765 bug(now-workbench-overlay): PC 端专注计时器悬浮窗透明命中区域大于实际可视边界`

**Goal:** 修复 `now-workbench-overlay` 在 Windows 桌面端的透明命中区域大于实际可视边界的问题，让用户看到的卡片外轮廓与原生窗口点击命中边界重新一致。

**Architecture:** 以 `几何先行（geometry-first）` 为主线。窗口尺寸、可见表面、命中边界必须统一到同一个几何真值；点击/拖拽发光反馈只作为命中解释增强，不作为替代修复。前端继续作为动态尺寸 owner，Rust 侧负责窗口创建、位置恢复和平台几何兜底，但不再用过时常量主导运行时命中判断。

**Tech Stack:** Tauri 2 + React 18 + TypeScript + Rust + Vitest

---

## 1. 当前事实与根因判断

### 1.1 已确认事实

1. `now-workbench-overlay` 不是完全固定尺寸窗口。
   - Rust 建窗默认值仍是 `392x470`
   - 前端 `NowWorkbenchOverlayPage` 会按模式调用 `getCurrentWindow().setSize(...)`
   - 当前存在多套运行时目标尺寸：
     - `412x490`
     - `464x470`
     - `248x120`
     - `352x200`
     - `276x156`
     - `428x360`

2. 当前 overlay / window hit-testing 路径没有实现 click-through。
   - Rust 侧只启用了 `.transparent(true)`
   - 当前 `now-workbench-overlay` 相关路径中没有 `set_ignore_cursor_events`、`ignoreCursorEvents`、`passthrough` 一类实现
   - 因此“透明像素”仍属于普通矩形窗口命中区

3. 真正的错位发生在“窗口矩形”与“可见卡片”的几何契约分裂上。
   - `html/body/#root` 全窗口铺满
   - `.now-workbench-overlay-root` 以及其 single-card / mini 变体自带 `padding`
   - shell / stage / card 之间存在多层额外 gutter
   - 运行态 single-card 下，可见卡片明显窄于真实窗口矩形

4. Rust 当前的可见性 / 恢复逻辑仍带旧常量假设。
   - `calculate_now_workbench_overlay_position`
   - `overlay_position_is_visible_on_any_monitor`
   仍按 `392x470` 参与判断

### 1.2 主矛盾

主矛盾不是“有没有 resize”，而是：

> 用户看到的可见表面外轮廓，与系统真正用于命中测试的窗口矩形，不是同一个边界。

只要这点不统一，用户就会继续在“看起来已经离开卡片”的位置误点到窗口。

---

## 2. 已冻结决策

### 2.1 主线决策

1. 主线采用 `几何先行`。
   - 先修命中边界
   - 发光反馈只做辅助解释

2. 修复范围是 `全模式`，不是只修 running。
   - `running`
   - `single-card`
   - `mini`
   - `mini peek`
   - `idle bubble`
   - `idle expanded`

3. 命中边界对齐到 `卡片外轮廓`。
   - 不包含阴影
   - 不包含外发光
   - 不保留额外安全边

4. 常态 UI 视觉不重做。
   - 不改按钮布局
   - 不改信息排布
   - 不借这次问题顺手重排 overlay 结构

### 2.2 交互决策

1. 保留现有显式拖拽区。
   - 不扩大到整卡空白区
   - 不收窄成全新单一顶栏

2. 发光反馈覆盖整张可见卡。
   - 仅在 `鼠标按下命中窗口` 时触发
   - 不是 hover 常亮
   - 不是只在拖拽时亮
   - 外发光必须贴当前卡片白线边界做瞬态增强，不能扩出新的命中圈

3. 过渡态要求 `命中优先`。
   - 即使视觉过渡稍晚，也不能允许旧大矩形继续吃点击

### 2.3 平台边界

1. 本轮优先对 `Windows 高 DPI` 现场负责。
2. macOS / Linux 暂不纳入主验收范围。
3. 若后续其他桌面平台暴露同类问题，再单开补丁任务。

---

## 3. 实现策略

### 3.1 单一几何真值

为 overlay 建立一个唯一的“可见表面几何真值”：

- 当前模式下，必须存在唯一一个可见表面节点
- 窗口尺寸以这个节点的实际外轮廓为准
- 高亮反馈也以这个节点为准
- 测试断言也以这个节点为准

建议引入统一稳定标识：

- `data-testid="now-overlay-visible-surface"`

每个模式只允许一个当前有效的可见表面节点。

### 3.2 前端侧收口

前端继续作为动态尺寸 owner，但收口方式改成：

1. `NowWorkbenchOverlayPage` 不再把 root padding、shell padding-top、stage 外围 gutter 当成窗口尺寸的一部分。
2. 各模式窗口尺寸都来自 `now-overlay-visible-surface` 的实际 bbox。
3. single-card 路径中，测量目标从 `single-card-shell` 切换为真正可见的卡片表面。
4. mini / peek / idle bubble / idle expanded 同样以当前可见 pill / bubble 外轮廓作为窗口尺寸来源。

### 3.3 FocusTimerWidget 约束

`FocusTimerWidget` 在 overlay integrated running 模式下必须满足：

1. 父级 stage 就是窗口真实边界容器。
2. 组件内部不再通过额外 `mx-*` / `left-* right-* top-*` 透明外圈制造更大的窗口命中区。
3. 保留当前按钮、文字、状态结构，不改常态视觉。
4. 如果单卡路径确实需要视觉留白，这个留白必须算进卡片外轮廓本体，而不是留在透明窗口 gutter 中。

### 3.4 Rust 侧职责

Rust 侧不接管动态尺寸 owner 身份，但要收口平台几何假设：

1. 建窗默认尺寸与当前默认可见表面对齐，不继续固化成旧 `392x470` 语义。
2. `show / restore / set_position` 不负责运行时 `set_size`，但它们的可见性与恢复判断必须读取窗口真实当前 size，而不是假设旧常量矩形。
3. 多显示器 / 高 DPI 下的“位置仍在屏幕内”判断必须基于当前真实窗口尺寸。

### 3.5 不采用的路线

本轮明确不采用：

1. `set_ignore_cursor_events(true)` 为主的整窗 click-through 路线
   - 它适合整窗穿透，不适合“仅透明边缘穿透”
   - 会破坏 hover / press / drag 事件一致性

2. 借这次 bug 进行 overlay 视觉重做
   - 不做 UI 呈现重排
   - 不做按钮布局改造
   - 不做风格重设

---

## 4. 反馈与交互规则

### 4.1 发光反馈规则

发光反馈只服务于表达：

> “你当前按下命中的是这个悬浮窗，而不是背景窗口。”

规则固定如下：

1. 触发条件：鼠标按下命中 overlay 可见表面
2. 覆盖范围：整张可见卡
3. 持续时间：按下期间可持续，释放后立即回退
4. 非触发条件：
   - hover 不亮
   - 未按下不亮
   - 背景自动脉冲不亮

### 4.2 视觉边界规则

1. 发光只能贴着当前卡片白线边界做增强。
2. 不能再向外扩出新的 halo 命中语义。
3. 可以使用：
   - 边框提亮
   - 内侧 ring
   - 阴影加深
   - 拖拽柄同步高亮
4. 不使用“外圈更大一圈的发光”来制造新的视觉边界。

### 4.3 拖拽行为规则

1. 拖拽继续只在现有显式 drag handle 触发。
2. 点击普通按钮和输入区不应触发拖拽。
3. 发光反馈与拖拽区不是同一件事：
   - 整卡按下可以亮
   - 但只有显式拖拽区能拖

---

## 5. 测试与验收

### 5.1 单测更新

需要更新 / 补充以下测试契约：

1. `tests/unit/pages/NowWorkbenchOverlayPage.runtime.test.tsx`
   - `setSize` 断言改为基于 `now-overlay-visible-surface`
   - 不再基于旧 `shell + padding` 逻辑

2. 各模式都要覆盖：
   - running single-card
   - mini
   - mini peek
   - idle collapsed
   - idle expanded

3. 新增 press-feedback 测试：
   - 按下整卡时亮
   - 释放后熄灭
   - hover 不亮

4. 如有必要，补 `FocusTimerWidget` overlay integrated 布局测试：
   - 验证不再依赖额外透明 gutter

### 5.2 静态验证命令

```powershell
npx tsc --noEmit
npx vitest run tests/unit/pages/NowWorkbenchOverlayPage.runtime.test.tsx tests/unit/pages/NowWorkbenchOverlayPage.test.tsx tests/unit/app/now-workbench-overlay-main.transparent.test.tsx
```

### 5.3 Windows 人工验收

至少覆盖以下场景：

1. running single-card
2. mini
3. idle bubble
4. mini peek / idle expanded 的过渡态

人工验收口径：

1. 在卡片外轮廓外 `1-2px` 点击，背景窗口必须可点。
2. 在卡片内任意按下，整卡出现瞬态高亮。
3. 拖拽只在现有 drag handle 生效。
4. 模式切换时不允许出现“旧大矩形仍吃点击”的短暂残留。

### 5.4 Window Spy 验收

使用 Window Spy 或等价工具复核：

1. 当前窗口物理尺寸应与逻辑尺寸和 DPI 缩放一致。
2. 物理矩形应按 DPI 换算后对应当前可见表面外轮廓，允许 `1px` 量级的取整误差，而不是继续落回旧 `shell` 或默认常量矩形。
3. running / mini / idle 模式切换后，窗口矩形应即时收敛到当前可见表面。
4. 实现前应先把本轮用户提供的 Window Spy 截图参数转写成文字 baseline，作为修复前后的对照锚点。

---

## 6. 风险与取舍

### 6.1 已接受的取舍

1. 本轮优先解决误点，不扩展到全桌面平台。
2. 本轮不借机重做 overlay UI。
3. 本轮接受实现层收口，但不接受常态视觉和布局改造。

### 6.2 主要风险

1. 某些模式若当前视觉留白本质依赖透明 gutter，收口后可能需要重新确认“留白是否属于卡片本体”。
2. hover -> expand / collapse 的异步 `setSize` 时序如果处理不当，仍可能残留一帧旧命中区。
3. Rust 侧几何判断若继续残留旧常量，会导致恢复位置判断和真实窗口尺寸再度分裂。

### 6.3 冲突优先级

若出现冲突，默认顺序如下：

1. 不允许继续存在透明误点
2. 不改常态 UI 呈现与布局
3. 视觉过渡与平台抽象放在其后

如果某个模式无法同时满足 1 和 2：

- 先把该模式单列为残余问题
- 不允许在本轮中擅自重排 UI 来“顺手修掉”

---

## 7. 交付物

本计划落地后，预期交付物包括：

1. 统一几何真值下的 overlay 命中边界修复实现
2. 整卡按下瞬态高亮反馈
3. 更新后的单测与 Windows 人工验收链路
4. 对 `#765` 可直接引用的本地实现计划与验收标准

---

## 8. 结论

`#765` 的正确修法不是“再加一个解释性 glow”，而是：

> 让 `now-workbench-overlay` 的原生窗口矩形、前端动态尺寸、可见卡片外轮廓重新回到同一个几何真值。

发光反馈要做，但它只是帮助用户理解“点中了这个窗口”；根除误点的关键，仍然是几何契约统一。
