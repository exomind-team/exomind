# ExoMind 前端设计规范（Frontend UI Spec，前端 UI 规范）

> **版本**: v1.0
> **状态**: Draft for human review（待人类评审）
> **关联 Issue**: [#807](https://github.com/exomind-team/exomind/issues/807)
> **实施计划**: `docs/plans/2026-04-02-issue-807-ui-unification-implementation-plan.md`

---

## 1. 这份文档是干什么的

这份文档是 ExoMind 前端界面的**统一设计规范**。

它不是单纯的“配色说明”，而是回答下面几个问题：

1. 页面外观到底以什么为准？
2. 哪些组件应该复用，哪些地方允许特殊设计？
3. 以后新增页面时，开发者应该先搭什么，再写什么？
4. 一个不懂前端实现细节的人，怎么判断这次 UI 改动是不是靠谱？

如果你对前端不熟，可以把这份文档理解成：

- **设计 token（设计令牌）** = 项目的颜色、文字、边框、间距这些“基础零件”
- **primitive（基础组件）** = `Button / Card / Dialog / Tabs / Select` 这类最底层通用组件
- **recipe（组合范式）** = 例如“设置项行”“页面头部”“状态卡片”这种重复出现的组合结构
- **page shell（页面壳层）** = 一个页面最外层的通用框架，比如标题栏、内容滚动区、底部安全区

一句话版：

> 以后做 ExoMind 前端，先对齐这份规范，再决定具体页面长什么样。

---

## 2. 给非前端读者的 30 秒判断法

如果你只是想快速判断“这次 UI 改动靠不靠谱”，看这 6 条就够了：

1. 颜色是不是优先用了项目 token，而不是到处写 `#C75B3A`、`#FAF7F5`？
2. 常见控件是不是优先用了统一组件，而不是每页自己重新写一套？
3. 普通页面是不是有一致的 header（页头）、content（内容区）、scroll（滚动区）结构？
4. 表单控件是不是有 label（标签）、focus state（聚焦态）和错误提示？
5. “看起来像 Tab 的东西”到底真的是 tab，还是只是模式切换按钮？
6. 像目标图、悬浮窗、拓扑图这类特殊界面，是否明确写了“这是例外，不走普通页面规范”？

如果上面 6 条里有 3 条以上答不上来，这次 UI 改动大概率还不够成熟。

---

## 3. 规范优先级

前端设计规范不是独立王国，它和项目其他文档的关系如下：

1. **产品语义 / 架构不变量（product / architecture invariants，产品语义 / 架构不变量）** 优先于视觉表现
2. **本文件 `docs/development/ui-spec.md`** 是前端视觉和交互一致性的默认权威
3. **页面 / 模块专用规格** 只能在本规范允许的例外范围内做差异化
4. **临时实现** 不能反过来定义规范

这意味着：

- 目标系统（Goals）、网络拓扑（Agent Hub）、悬浮窗（Overlay）可以保留特殊视觉语言
- 但它们的表单、弹窗、按钮、标签、状态色，仍然应该尽量复用统一基础层

---

## 4. 当前项目 UI 现状判断

截至 `2026-04-02`，项目不是“完全无规范”，而是处于**局部有统一、整体仍混合**的状态。

### 4.1 当前最统一的区域

设置页（Settings）是目前最统一的一块，因为它已经具备：

- 配置驱动的 registry（注册表）结构
- 统一的 item schema（设置项类型定义）
- 统一的 row / section / renderer（行 / 分组 / 渲染器）层
- 桌面 / 移动布局分离，但复用同一套 settings item 渲染逻辑

### 4.2 当前半统一的区域

网络页（Agents / Network）是第二梯队：

- 局部已经使用 `Tabs / Card / Badge / Button`
- 但主页面仍有较重的页面内手写结构
- 一些子区域已经像“未来标准”
- 整体仍不是完全收敛的组件系统

### 4.3 当前未统一或高度历史化的区域

这些页面仍有明显的“页面各写各的”痕迹：

- `MePage`
- `RemindersPage`
- `TaskDetailPage`
- 若干 overlay（悬浮窗）与 graph/canvas 页面

因此，Issue #807 的目标不是“从 0 到 1 建规范”，而是：

> 把已经在 Settings 和部分 Agents 页面里出现的统一做法，正式升格为项目级规范，并系统迁移到高频页面。

---

## 5. 设计原则

### 5.1 一致性优先于局部炫技

ExoMind 不是展示型 landing page（落地页），而是高频长期使用的工具。
长期使用的工具，最重要的是：

- 结构稳定
- 学习成本低
- 视觉层次清楚
- 改动可预测

所以默认策略不是“每页做得不一样”，而是：

> 同类问题优先使用同类解法。

### 5.2 语义化优先于视觉值硬编码

不要先想“这个地方是 `#C75B3A`”，而要先想：

- 它是主行动按钮色？
- 它是强调态？
- 它是危险态？
- 它是当前激活态？

前端代码应该优先表达**语义**，而不是直接表达**色值**。

### 5.3 基础组件优先于页面内自造轮子

默认复用顺序：

1. `shadcn/ui` primitive（基础组件）
2. ExoMind shared recipe（共享组合）
3. 页面级局部封装
4. 真正必要时的特化实现

只有当 1-3 都无法满足需求时，才允许第 4 步。

### 5.4 特殊界面允许特殊视觉，但不允许野生基础设施

下面这些界面可以保留明显个性：

- Goal graph（目标图）
- Agent topology（网络拓扑）
- Overlay / floating card（悬浮窗 / 浮层卡片）
- 数据可视化 / 图编辑器

但即使在这些界面里，也不应该再随意发明：

- 新的输入框风格
- 新的 dialog 交互规则
- 新的 tab 语义
- 新的按钮状态体系

也就是说：

> 允许“长得特别”，不允许“底层规则乱套”。

---

## 6. 颜色与 Token 规范

### 6.1 Source of truth（唯一来源）

ExoMind 的颜色系统默认来自：

- `src/index.css`
- `tailwind.config.js`

未来前端颜色治理的目标不是“删掉所有特殊颜色”，而是分三层管理：

1. **Global tokens（全局 token）**
2. **Semantic aliases（语义别名）**
3. **Documented exceptions（有文档的例外）**

### 6.2 推荐使用层级

写样式时按下面顺序选择：

1. `text-foreground / text-secondary / text-muted`
2. `bg-card / bg-surface / border-border-card / border-border-subtle`
3. `bg-brand-accent / text-brand-accent / bg-success / text-destructive`
4. 页面级 token，例如 `bg-page`、`bg-inactive`
5. 仅在例外清单中允许的特殊色值

### 6.3 禁止事项

默认禁止：

- 在普通业务页面直接新增 `bg-[#xxxxxx]`
- 在普通表单、卡片、按钮、tab、badge 中直接写硬编码颜色
- 用硬编码颜色表达语义（例如把“激活态”直接写死成某个 hex）

### 6.4 允许例外

以下情况允许保留局部硬编码颜色，但必须满足“可解释”：

- graph / topology / flow 节点颜色
- 品牌渐变、氛围背景、装饰性光晕
- 第三方平台品牌色
- 数据可视化中的离散分类色
- overlay 的拟物 / 玻璃 / 夜间氛围风格

这些例外必须满足至少一条：

1. 它属于“信息可视化语义”
2. 它属于“品牌 / 装饰性表现”
3. 它已经在规范文档中被列为例外

### 6.5 对非前端读者的解释

你可以把 token 理解成“颜料编号”。

如果每个画师都自己配颜色，最后整个产品会像十个人拼出来的。
如果先统一颜料编号，哪怕不同页面是不同人做的，也能看起来像同一个产品。

---

## 7. 页面壳层规范（Page Shell Hierarchy，页面壳层层级）

这里是 Issue #807 里最容易误伤项目的一点，所以必须讲清楚。

### 7.1 不是所有页面都应该强行套 `PageShell`

`PageShell` 适用于**普通内容页**，例如：

- `NowPage`
- `TasksPage`
- `MePage`
- `RemindersPage`
- `SettingsPage`

但它**不应该**强行覆盖下面这些页面：

- 已由路由层提供主壳层的页面
- Graph / canvas / topology 页面
- Floating overlay（悬浮窗）
- 需要精确控制 viewport（视口）或 safe area（安全区）的特殊表面

### 7.2 推荐层级

ExoMind 页面结构建议分四层看：

1. **App shell（应用壳层）**
   路由级容器、侧边栏、底部导航、桌面 / 移动框架
2. **Page shell（页面壳层）**
   普通页面头部、内容区、滚动区
3. **Feature shell（功能壳层）**
   某个复杂功能内部自己的布局，例如 Task Detail 的分区、Goal graph 的 panel
4. **Overlay shell（浮层壳层）**
   Dialog、Drawer、Sheet、悬浮窗

### 7.3 规则

- `routes.tsx` 负责 App shell
- 普通业务页优先复用统一 `PageShell`
- 复杂功能页允许有自己的 `Feature shell`
- Overlay 不走普通 `PageShell`

一句话版：

> `PageShell` 是“默认页壳”，不是“万物总壳”。

---

## 8. Tab、Segmented Control、Mode Switch 的区别

这也是旧计划里最大的风险之一。

### 8.1 什么时候是 Tab

满足下面条件时，应该用 `Tabs`：

- 同一页面内有多个内容面板
- 当前激活项决定下方内容区切换
- 这些面板在语义上是并列视图

例如：

- `NowPage` 的“专注 / 记录 / 今日”
- `WorkspaceTabs` 的“知识库 / 行动日志 / 身份”

### 8.2 什么时候不是 Tab

下面这些不应机械改成 `Tabs`：

- 浏览 / 编辑这种模式切换
- Graph 工具栏里的状态切换
- 纯排序或过滤按钮
- 锚点跳转导航（anchor navigation，锚点导航）

例如：

- `GoalsPage` 的浏览 / 编辑，更接近 **mode switch（模式切换）**
- `TaskDetailPage` 移动端分区导航，更接近 **anchor chips（锚点胶囊导航）**

### 8.3 判断口诀

- 切换**面板内容**：用 `Tabs`
- 切换**操作模式**：用 `Segmented Control` 或模式开关
- 切换**滚动定位**：用锚点导航

---

## 9. 表单控件规范

### 9.1 Select

普通下拉选择统一原则：

- 优先用 `shadcn Select`
- 不再新增原生 `<select>`
- 如果是系统原生选择器有明显平台收益，必须写明例外理由

### 9.2 Input / Textarea

所有输入控件至少要有：

- label（标签）或可访问名称
- placeholder（占位提示）仅做辅助，不代替标签
- error state（错误态）
- visible focus state（可见聚焦态）

### 9.3 提交交互

默认规则：

- 提交前按钮可点击
- 请求开始后才进入 loading
- 保存失败要给出明确错误，不要只说“失败”
- 配置改动要让用户知道“已保存 / 未保存 / 正在保存”

---

## 10. Dialog / Drawer / Sheet 规范

### 10.1 为什么要统一

Dialog、Drawer、Sheet 是用户最容易“迷路”的地方。
如果每个页面弹层规则不同，用户会不知道：

- 现在是在页内还是浮层里
- 返回方式是什么
- 保存按钮在哪
- 关闭后有没有丢内容

### 10.2 默认规则

- 桌面端优先 `Dialog`
- 移动端优先 `Drawer / Sheet`
- 标题、描述、正文、操作按钮顺序保持一致
- 关闭方式统一：关闭按钮、点击外部、ESC 的行为要可预测

### 10.3 例外

日志面板、全屏编辑器、图谱侧栏详情，这些可以不长得像普通 dialog，但仍应复用：

- 关闭逻辑
- 标题层级
- 滚动区
- 操作区

---

## 11. 可访问性（Accessibility，易用性/无障碍）底线

这是强制要求，不是“以后再补”。

### 11.1 必须满足

- icon-only button（纯图标按钮）必须有 `aria-label`
- 表单控件必须有 label 或 `aria-label`
- 不要 `outline-none` 却不给替代 focus 样式
- 错误提示要靠近输入控件
- 能用原生语义元素时，不要用 `div onClick`

### 11.2 对非前端读者的解释

你可以把这理解成：

> 用户不能靠“猜”来知道哪个东西能点、点了会发生什么、键盘怎么操作。

如果一个控件只有鼠标能用、只有视觉上看得懂，那它就还没做完整。

---

## 12. 响应式与 Safe Area 规范

### 12.1 普通页面

普通页面建议统一使用：

- `px-5 md:px-8 lg:px-10` 或同等级 spacing（间距）
- `min-h-0 flex-1 overflow-y-auto` 作为内容滚动区基础

### 12.2 移动端安全区

凡是贴近底部、顶部、系统栏、悬浮导航的界面，都必须考虑：

- `env(safe-area-inset-bottom)`
- `env(safe-area-inset-top)`

### 12.3 不要到处自己算

能复用已有安全区工具类时，优先复用；不要每个页面重新发明一套底部 padding 公式。

---

## 13. 特殊页面例外清单

以下页面属于“特殊表面（special surface，特殊表面）”，不要求完全按普通页面模板长：

- `GoalsPage`
- `AgentsPage` 主拓扑视图
- `NowWorkbenchOverlayPage`

但这些页面仍应遵守：

- 颜色语义尽量复用 token
- 表单控件不再野生增长
- 模态层统一
- focus / label / hover / disabled 规则统一

---

## 14. 对开发者的执行顺序

以后做前端 UI 改动，默认按这个顺序：

1. 先看本规范
2. 判断当前页面属于普通页还是特殊表面
3. 优先复用 token / primitive / recipe
4. 只有证明确实不适配时，才写页面级特化实现
5. 提交前按本规范做一次自检

---

## 15. 对评审者的审查清单

评审一个前端 PR 时，按下面顺序看：

### P0（必须先过）

1. 有没有把普通控件继续做成野生实现？
2. 有没有把本来不是 tab 的东西硬改成 tab？
3. 有没有把不该套 `PageShell` 的特殊页面强行套进去？
4. 有没有新增无解释的硬编码颜色？

### P1（强烈建议过）

1. 文案、层级、标题、操作区是不是清楚？
2. 是否保留了统一的按钮、卡片、表单手感？
3. 深色模式有没有明显断裂？
4. 移动端安全区和滚动区有没有考虑？

### P2（体验质量）

1. hover / focus / active 细节是否顺手？
2. 是否存在可进一步抽象的重复模式？
3. 是否需要补充到共享 recipe 层？

---

## 16. 当前 Issue #807 的落地目标

Issue #807 不追求“一次性做完所有历史 UI 债务”，而是追求建立一个**可持续执行**的统一化体系。

这个 issue 的合理产出应包括：

1. 一份正式的项目级前端设计规范
2. 一份可执行的分阶段实施计划
3. 明确的例外边界
4. 明确的评审入口
5. 对 `CLAUDE.md` 与 `AGENTS.md` 的引用，让 Agent 默认遵守

如果这 5 件事没完成，只做一些页面改色或换组件，统一化仍然不算真正开始。

---

## 17. 参考文件

- `src/index.css`
- `tailwind.config.js`
- `src/ui/app/pages/SettingsPage.tsx`
- `src/ui/app/components/settings-shared.tsx`
- `src/ui/app/components/settings/settings-renderers.tsx`
- `src/ui/app/pages/agents/WorkspaceTabs.tsx`
- `docs/plans/2026-04-02-issue-807-ui-unification-implementation-plan.md`

---

## 18. 给你的最后一句人话

如果你以后看一个前端改动，觉得“好像更统一了，但我说不出哪里统一”，那通常说明它在朝正确方向走。

如果你一眼就觉得“这个页面像另一个产品做的”，那大概率就是它绕开了 token、组件层和页面壳层规范。
