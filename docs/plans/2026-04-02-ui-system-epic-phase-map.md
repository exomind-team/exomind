# UI System Epic Phase Map

> **状态**: Draft for human review（待人类评审）
> **目标**: 为 ExoMind 的 UI/UX 整体重构建立跨 issue、跨阶段、跨交互形态的路线图
> **相关 Issue**:
> - `#807` 前端 UI/UX 统一重构
> - `#728` Agent Workbench 统一工作台
> - `#793` 无头外心 / UI 退化为客户端
> - `#541` 从 Settings 提炼通用组件族
> - `#684` Dialog / Drawer / Form / Feedback 模态组件栈收敛
> - `#502` 语音输入扩展到系统动作与 Agent 执行

---

## 1. 这份路线图解决什么问题

当前仓库的 UI 重构讨论，容易在四种不同层级之间来回跳：

1. **可视页面 UI（visual UI，可见界面）**
   例如设置页、任务页、提醒页、网络页、目标页
2. **工作台 UI（workbench UI，工作台交互界面）**
   例如多面板、多容器、手动编排、Agent 编排、跨窗口 surface（表面）
3. **无屏 UI（headless / voice-first UI，无屏 / 语音优先交互）**
   例如语音指令、命令触发、状态确认、系统反馈
4. **客户端 / 核心边界（client/core boundary，客户端 / 核心边界）**
   例如“按钮按下后到底谁负责业务动作”“CLI / GUI / Voice 是否都只是 RT 的客户端”

以前的问题是，这三者经常被混在一个“UI 要统一”里讨论，结果：

- 规范太抽象，落不下来
- 页面先各自修，越修越分叉
- 工作台和语音交互永远像“以后再说”

这份 phase map（阶段图）的核心作用，就是把它们放进同一个大 epic，但按阶段推进。

一句话版：

> 这次不是只做页面美化，而是要把 ExoMind 的“可视界面 + 工作台 + 无屏交互 + RT 客户端边界”收敛成同一套系统。

---

## 2. 大 Epic 的总判断

### 2.1 母问题

ExoMind 最终并不是“一个只有 GUI（图形界面）的桌面软件”。
它长期会演化成：

- UI 只是一个客户端
- Workbench 是一个可编排的交互空间
- Voice / command（语音 / 命令）本身也是 UI
- CLI 也是一个客户端入口
- RT 是业务真相和动作编排的核心

所以 UI/UX 重构不能只问：

- 页面长得是不是一致

还要同时问：

- 页面之间能不能共享结构
- 工作台对象能不能共享交互语义
- 语音与可视界面是不是同一套反馈逻辑
- GUI / CLI / Voice 触发的动作，是不是都走同一套 RT 能力
- 哪些逻辑应该留在客户端，哪些必须进 RT

### 2.2 这次大 Epic 的统一目标

统一的不是“长相完全一样”，而是下面 5 层：

1. **Design token（设计令牌）**
2. **Primitive（基础组件）**
3. **Recipe（可复用交互组合）**
4. **Surface model（表面模型）**
5. **Interaction semantics（交互语义）**
6. **Client/Core contract（客户端 / 核心契约）**

只有这 6 层统一了，页面、工作台、语音交互和 RT 客户端化才不会继续各长各的。

---

## 3. 统一对象分层

### Layer A: Visual Foundation（可视基础层）

这一层解决的是“普通前端到底应该怎么长”。

包括：

- color tokens（颜色 token）
- spacing / radius / border / shadow（间距、圆角、边框、阴影）
- typography（排版）
- PageShell
- Tabs / Select / Dialog / Drawer / Button / Card
- Settings 已经验证过的共享模式

对应问题：

- 页面是否一致
- 常见控件是否复用
- 样式是否可治理

### Layer B: Surface System（表面系统层）

这一层解决的是“页面、面板、浮层、窗口，到底是什么关系”。

包括：

- page surface（页面表面）
- panel surface（面板表面）
- modal surface（弹层表面）
- workbench surface（工作台表面）
- window / overlay surface（窗口 / 悬浮表面）

对应问题：

- 什么时候是 PageShell
- 什么时候是 Feature shell（功能壳）
- 什么时候是特殊 surface，不该套普通页面壳

### Layer C: Orchestration UI（编排 UI 层）

这一层解决的是“工作台怎么组织任务、人、Agent、结果、上下文”。

包括：

- manual layout（手动编排）
- agent orchestration（Agent 编排）
- workspace / workbench object graph（工作空间 / 工作台对象图）
- cross-window federation（跨窗口联邦）

对应问题：

- Workbench 为什么不是另一个普通页面
- Signal Network / Canvas / Replay 为什么会收敛到一个系统

### Layer D: Headless Interaction（无屏交互层）

这一层解决的是“没有传统 GUI 时，交互是否仍然统一”。

包括：

- voice command（语音指令）
- command palette（命令面板）
- spoken confirmation（语音确认）
- feedback / status / interruption model（反馈 / 状态 / 打断模型）

对应问题：

- “最终软件没有 UI”这句话怎么成立
- 为什么语音也必须纳入 UI 规范

### Layer E: Client/Core Boundary（客户端 / 核心边界层）

这一层解决的是：

> 一个动作被触发之后，真正的业务编排到底应该发生在 UI / CLI，还是 RT？

包括：

- GUI button -> RT action（界面按钮触发 RT 动作）
- CLI command -> RT action（CLI 命令触发 RT 动作）
- voice command -> RT action（语音命令触发 RT 动作）
- feature API（功能 API）
- state ownership（状态归属）
- orchestration ownership（编排归属）

对应问题：

- “按钮按下后关联哪些事情启动”为什么不该放在 UI 里
- 前后端 / 客户端和核心逻辑怎么切分
- 为什么最终 `GUI / CLI / Voice` 都应该只是 RT 的不同客户端

---

## 4.5 客户端化原则（Clientization Principle，客户端化原则）

这次大 epic 需要明确一个硬原则：

### 原则

**任何跨实体、跨状态、跨模块的业务动作，都不应该只存在于 UI 层。**

例如：

- 点击按钮后同时启动多个对象
- 关联任务后触发状态联动
- 从工作台发起一次编排行动
- 语音指令触发系统动作

这些都应该优先落到 RT：

- 作为 `feature API（功能 API）`
- 或作为 `command / act endpoint（命令/动作端点）`
- 或作为 RT 内部编排能力

UI、CLI、Voice 只负责：

- 采集输入
- 发起动作
- 展示结果
- 提供局部交互反馈

### 不应该留在 UI 的逻辑

- 业务动作编排
- 真正的状态机推进
- 多对象联动
- 持久化真相
- 跨客户端一致性约束

### 可以留在 UI 的逻辑

- hover / focus / open / close
- 草稿态
- 临时输入态
- 纯展示排序
- 纯本地动画和转场

一句话版：

> UI 可以负责“怎么触发、怎么展示”，RT 应该负责“真正发生了什么”。

---

## 5. 阶段图（Phase Map）

下面是我建议的大 epic 推进方式。

### Phase 0: 规范固化（Specification Freeze，规范冻结）

目标：

- 把前端规范从“讨论”升级成“项目入口”
- 把例外边界讲清楚
- 把 Agent 执行链路接进规范
- 把客户端 / RT 边界原则写进大 epic

纳入范围：

- `docs/development/ui-spec.md`
- `docs/plans/PLAN-ui-ux-unification.md`
- `docs/plans/2026-04-02-issue-807-ui-unification-implementation-plan.md`
- `CLAUDE.md`
- `AGENTS.md`
- `docs/README.md`
- `#793` / `#675` / `#676` 的边界关系说明

完成条件：

- 规范能被人类读懂
- Agent 默认会先读规范
- “不是 tab 的不要改 tabs”“不是普通页的不要硬套 PageShell”被写成硬边界
- “业务编排优先进 RT，客户端负责触发和展示”被写成硬边界

### Phase 1: 共享层收口（Shared Layer Convergence，共享层收口）

目标：

- 不先大改页面
- 先把基础设施做强

纳入范围：

- token strategy（token 策略）
- `PageShell`
- `PageTabs`
- `Select`
- modal shell（模态壳层）
- settings 提炼出的 recipe（组合范式）
- action invocation UI（动作触发 UI）和 result feedback（结果反馈）统一样式入口

主要关联 issue：

- `#541`
- `#684`
- `#807`

完成条件：

- 普通页面迁移时，不需要再页面内重新造轮子
- 共享层足以承载 70% 以上高频普通 UI
- 客户端不再继续发明“带业务语义的临时局部动作组件”

### Phase 2: 高价值普通页面迁移（High-Value Page Migration，高价值普通页面迁移）

目标：

- 把最常用、最能代表产品日常体验的页面先迁移

建议优先级：

1. `NowPage`
2. `TasksPage`
3. `MePage`
4. `RemindersPage`
5. `SettingsPage`
6. `TaskDetailPage`（谨慎迁移）

完成条件：

- 用户最常打开的页面在 header、section、表单、弹层、tab 上不再割裂
- 普通页面看起来像同一个产品
- 高价值页面中的“业务动作按钮”开始从本地拼装转向 RT 能力调用

### Phase 2.5: RT 边界清点（Client/Core Audit，客户端 / 核心清点）

目标：

- 系统性盘点哪些“业务动作”仍然留在前端
- 为后续 RT 收口建立迁移清单

主要关联 issue：

- `#793`
- `#675`
- `#676`

纳入范围：

- 页面按钮触发的复杂业务逻辑
- workbench 手动编排触发的动作链
- Agent 编排入口
- CLI 与 Voice 的动作入口

完成条件：

- 形成“哪些逻辑必须迁到 RT”的清单
- 形成第一批 `act / command API` 收口候选
- GUI / CLI / Voice 三类客户端的共用动作边界被明确写下来

### Phase 3: Workbench Surface 收口（工作台表面收口）

目标：

- 把“统一工作台”纳入同一套 UI system，而不是单独的平行宇宙

主要关联 issue：

- `#728`
- `#789`
- 你后续的集体任务 issue

纳入范围：

- Workbench 容器结构
- panel recipe（面板范式）
- 可编排对象卡片
- 手动布局与 Agent 编排的共享表面语义
- 跨窗口 surface 组织规则

完成条件：

- Workbench 不再只是“另一个复杂页面”
- 它成为 UI system 的高级表面层
- 手动编排、Agent 编排、集体任务编排开始共享同一套 surface 语义

### Phase 4: 特殊表面治理（Special Surface Governance，特殊表面治理）

目标：

- 不强行把 graph / topology / overlay 改成普通页面
- 但要收口其基础设施

主要范围：

- `GoalsPage`
- `AgentsPage`
- Overlay / floating windows（悬浮窗）

统一的内容：

- dialog / drawer / panel / form
- token 语义
- focus / hover / label / disabled

保留个性的内容：

- graph 布局
- 拓扑节点风格
- overlay 氛围视觉

### Phase 5: Voice-First / Headless UI 收口

目标：

- 把语音交互、命令交互视为正式 UI
- 和 visual UI 共用同一套状态语义

主要关联 issue：

- `#793`
- `#502`

要统一的不是“界面长相”，而是：

- action invocation（动作触发）
- confirmation（确认）
- feedback（反馈）
- interruption / retry（打断 / 重试）
- context handoff（上下文切换）

完成条件：

- 用户通过页面操作和通过语音操作，获得的是同一套系统反馈逻辑
- Voice 与 GUI 不再各自发明业务动作链路

### Phase 6: CLI / GUI / Voice 全客户端化

目标：

- 让 GUI、CLI、Voice 都成为 RT 的正式客户端
- 让“核心逻辑在 RT，客户端只做触发与展示”真正成立

主要关联 issue：

- `#793`
- `#676`

纳入范围：

- CLI command contract（CLI 命令契约）
- GUI action contract（图形界面动作契约）
- Voice command contract（语音命令契约）
- shared feedback model（共享反馈模型）

完成条件：

- 同一个业务动作可以被 GUI / CLI / Voice 复用
- 状态推进与业务真相都在 RT
- 客户端之间不再因本地业务逻辑不同而产生行为偏差

---

## 6. 双轨路线：UI System 轨 + RT Boundary 轨

这个大 epic 不应该被误解成“只有 UI 轨道”。
它实际应该有两条主轨：

### Track A: UI System（界面系统轨）

- Phase 0
- Phase 1
- Phase 2
- Phase 3
- Phase 4
- Phase 5

### Track B: RT Boundary（核心边界轨）

- Phase 0
- Phase 2.5
- Phase 5
- Phase 6

这两条轨最终在这里汇合：

> GUI / CLI / Voice 共用同一套 RT 动作能力，而不是各自带一份本地业务逻辑。

---

## 7. 阶段之间的依赖关系

```text
Phase 0 规范固化
  ↓
Phase 1 共享层收口
  ↓
Phase 2 高价值普通页面迁移
  ↓
Phase 2.5 RT 边界清点
  ↓
Phase 3 Workbench Surface 收口
  ↓
Phase 4 特殊表面治理
  ↓
Phase 5 Voice-First / Headless UI 收口
  ↓
Phase 6 CLI / GUI / Voice 全客户端化
```

其中：

- `Phase 3 / 4 / 5 / 6` 可以局部并行讨论
- 但真正的代码实施仍应以 `Phase 1 -> Phase 2` 为第一落点

原因很简单：

> 没有共享层，后面的工作台、特殊表面、语音交互都只会继续长成新的孤岛；没有 RT 边界清点，客户端逻辑又会继续长歪。

---

## 8. 一个 PR 应该落到哪一层

虽然这是一个大 epic，但**第一个 PR 不应该试图做完整个 epic**。

我建议第一个 PR 的实际范围是：

### PR-1 范围

- Phase 0：规范固化
- Phase 1：共享层收口
- Phase 2：高价值普通页面迁移（至少核心一批）
- Phase 2.5：RT 边界清点的文档与第一批候选动作识别

也就是：

- 规范文档
- Agent 入口
- PageShell / PageTabs / Select / modal shell 的共享层
- `Now / Tasks / Me / Reminders / Settings`
- `TaskDetailPage` 只做谨慎迁移，不追求彻底重写
- 第一批“应迁到 RT 的业务动作”清单

### PR-1 明确不做

- 不完整实现 Workbench 总体重构
- 不在一个 PR 里重做 Goals / Agents 主拓扑
- 不完整实现 voice-first UI
- 不在一个 PR 里完成 RT 大迁移
- 不一次性消灭所有历史硬编码颜色

换句话说：

> 第一个 PR 是“把系统拉回正确轨道，并明确 UI 与 RT 的边界”，不是“把未来三个月的 UI 和 RT 全做完”。

---

## 9. 推荐的 issue / Project 组织方式

### 7.1 Issue 层

建议保留：

- `#807` 作为 UI system 主 epic

建议关联：

- `#541` 共享组件提炼
- `#684` 模态组件栈收敛
- `#728` Workbench 统一工作台
- `#793` Headless RT / UI 退化为客户端
- `#675` UI → RT 迁移清点
- `#676` Feature API /act 路径
- 你后面自己要建的“集体任务 UI” issue

### 7.2 Project 层

这件事已经明显超出单 issue 追踪能力，适合上 GitHub Project。

推荐的项目视图字段：

- `Track（轨道）`
  - Spec
  - Shared Layer
  - Page Migration
  - RT Boundary
  - Workbench
  - Special Surface
  - Voice / Headless
- `Phase（阶段）`
  - 0
  - 1
  - 2
  - 3
  - 4
  - 5
- `Status（状态）`
  - Backlog
  - Ready
  - In Progress
  - Review
  - Done

### 7.3 当前限制

我现在仍然**无法读取 GitHub Project**，因为当前 `gh` token 还缺：

- `read:project`

所以我现在能做的是：

- 把 Project 结构设计出来
- 把 issue 拆法建议出来

但还不能帮你直接检查或落到现有 Project。

---

## 10. 工作区 / 分支 / PR 方案

### 推荐 worktree

使用已存在的全局 worktree 目录：

`C:\Users\starlin\.config\superpowers\worktrees\exomind\`

### 推荐分支名

`feature/issue-807-ui-unification`

### 推荐工作区目录名

`C:\Users\starlin\.config\superpowers\worktrees\exomind\issue-807-ui-unification`

### 推荐 PR 范围标题

`feat(ui-system): establish UI spec, shared layer, and migrate high-value pages`

---

## 11. 这条路线为什么比“只做页面统一”更靠谱

因为 ExoMind 的未来不是“越来越多页面”，而是：

- 页面越来越像客户端
- Workbench 越来越像主交互空间
- 语音和命令越来越像核心入口

如果今天只统一视觉页面，明天 Workbench、Voice、CLI 和 RT 动作边界会重新长出另一套系统。
那就会再次重演“规范存在，但没人真能坚持”的问题。

所以这次正确做法不是缩小视野，而是：

> 在战略上把 visual UI / workbench UI / headless UI / RT boundary 放进同一个 epic，在战术上只先做第一段可落地 PR。

---

## 12. 当前建议

我建议你现在就按下面顺序推进：

1. 认可这个 phase map 作为母路线
2. 用 `#807` 承接 UI system 主 epic
3. 先不扩散大量新 issue
4. 先准备一个独立 worktree + 一个独立 PR
5. 第一 PR 只做 `规范 + 共享层 + 高价值普通页面迁移 + RT 边界清点`
6. Workbench / Voice / CLI / 集体任务进入关联 issue 和后续阶段

这样做，既不会失去大方向，也不会把第一轮实施炸成不可 review 的巨型 PR。
