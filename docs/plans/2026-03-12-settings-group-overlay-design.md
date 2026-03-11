# Settings Group Overlay Alignment Design

**Goal**

把 `功能开关` 从临时 `custom` 抽屉收敛成真正的 `group` 设置项，并让 group 容器支持横屏模态框、竖屏抽屉；同时把 `火山资源模型` 收敛回行内单选枚举，去掉冗余的“模型 ”前缀。

**Decision**

1. `GroupSettingsItem` 扩展为正式可交互容器，而不是只渲染一条占位行。
2. group 的展示形态使用统一的自适配 overlay：
   - 横屏：`Dialog`
   - 竖屏：`Drawer`
3. group 内部子项继续复用已有 `SettingsItemRenderer`，不新造一套“抽屉专用开关卡片”。
4. `功能开关` 由 registry 中的 `custom` 改为 `group`，其子项为数个 `boolean` 设置项。
5. `火山资源模型` 从 `select` 改为默认行内单选枚举，标签裁为 `1.0 小时版 / 1.0 并发版 / 2.0 小时版 / 2.0 并发版`。

**Why**

- 这符合当前核心原则：优先从 `dev` 已有设置项组件与布局中抽取通用能力，而不是继续保留手写 `custom` 外壳。
- 现有 `功能开关` 抽屉的卡片边框是写死颜色，视觉上无法自然继承 section tone；group 化后直接走共享设置项 renderer，可统一边框、分隔线、开关主题色。
- `火山资源模型` 当前 `select` 与设置页现有枚举家族不一致，也与用户明确要求相悖。

**Scope**

- 修改 settings types / registry / renderer，补齐 group overlay 渲染能力。
- 删除 `FeatureTogglesSetting` 这类仅承载一组布尔项的临时 custom 包装。
- 更新相关测试与覆盖审计清单。

**Non-Goals**

- 本轮不处理其他多字段复杂对话框的进一步 group 化。
- 不改 Rust / Tauri 端逻辑。
