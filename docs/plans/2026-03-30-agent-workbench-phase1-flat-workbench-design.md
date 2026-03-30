# Agent Workbench Phase 1：平铺工作台与跨窗口联邦前置抽象

> 日期：2026-03-30  
> 状态：review pending（待评审）  
> 类型：architecture / implementation design（架构 / 实施设计）  
> 关联：
> - Parent Epic: `#728`
> - 相关：`#385`、`#535`、`#646`、`#702`
> - 上位规格：`docs/architecture/agent-workbench-shared-graph-spec.md`

---

## 1. 这份文档解决什么问题

这份文档不是再讨论长期愿景，而是把 `Agent Workbench` 的第一阶段收敛成可以直接开工的范围。

当前判断是：

1. 不先做自由画布
2. 不先做完整窗口管理器
3. 先做一个稳定的 `Flat Workbench（平铺工作台）`
4. 先让 `agent / PTY / SSH` 能被统一纳管，并给 `browser runtime` 预留模型入口
5. 先把多个窗口共享同一 `WorkbenchSpace（工作空间）` 的联邦骨架立起来

一句话概括：

> Phase 1 不是“先把 UI 做自由”，而是“先让多个运行时工作面在同一个工作空间里稳定存在、稳定恢复、稳定跨窗口协同”。

---

## 2. 目标与非目标

## 2.1 目标

1. 交付一个稳定的 `WorkbenchPage`
2. 同一 `WorkbenchSpace` 下可恢复多个会话 pane
3. `SessionObject + RuntimeBinding` 统一承载现有 `AgentSession`、PTY、SSH，并预留 `browser runtime`
4. 新增第二窗口时，仍然工作在同一个共享空间与同一个共享对象模型上
5. 事实层先打通 `FocusRun + EventTape`

## 2.2 非目标

1. 不做自由画布拖拽编排
2. 不做完整 `network` 编辑器
3. 不做完整插件系统
4. 不做任意对象类型一次性统一
5. 不做完整 browser automation（浏览器自动化）协议

---

## 3. Phase 1 核心对象与最小关系

## 3.1 核心对象

1. `WorkbenchSpace`
   - 长期工作空间
   - 回答“我当前在哪个工作场景里干活”
2. `ViewInstance`
   - 平铺 pane 的语义视图
3. `SurfaceSlot + SurfaceNavigationState`
   - 当前窗口/承载面的语义挂载点
4. `SessionObject`
   - 一次会话过程的历史容器
5. `RuntimeBinding`
   - 真实运行时句柄
   - Phase 1 首批闭环类型：`agent-session / pty / ssh`
   - `browser-runtime` 保留为模型预留，不作为 Phase 1 关闭 issue 的必选范围
6. `EventTape`
   - 事实流
   - 记录输入、输出、控制事件

## 3.1.1 Phase 1 runtime 支持分档

1. `must ship`
   - `agent-backed session`
   - 双 pane 工作面
   - 最近工作台恢复
2. `should ship`
   - 现有 `PTY / SSH` 被统一纳入 `RuntimeBinding`
   - 至少可以恢复、展示或附着到工作台
3. `model-only`
   - `browser-runtime`
   - 只要求模型预留与统一注册入口

## 3.2 最小关系集

Phase 1 只要求下面这组关系稳定存在：

1. `space_contains`
2. `surface_shows`
3. `session_anchors_to`
4. `session_attaches_runtime`
5. `session_emits_event`

说明：

1. 这不是最终全部关系类型
2. 但足以支撑“一个空间、多个 pane、多个运行时、多个窗口、同一事实流”
3. 这些词是 `Phase 1 operational alias（阶段操作别名）`，不能替代长期正式模型

### 3.2.1 与长期正式模型的映射

1. `space_contains`
   - 对应长期模型中的 `SpaceObjectMembership`
2. `surface_shows`
   - 对应 `SurfaceSlot / ViewInstance` 的承载关系
3. `session_anchors_to`
   - 对应 `SessionAnchor`
4. `session_attaches_runtime`
   - 对应 `RuntimeAttachment`
5. `session_emits_event`
   - 对应 `EventTape / TapeEvent`

## 3.3 核心对象图

```mermaid
classDiagram
  class WorkbenchSpace {
    +id
    +name
    +scope
  }

  class ViewInstance {
    +id
    +viewType
    +target
  }

  class SurfaceSlot {
    +id
    +surfaceProfile
    +mode
  }

  class SurfaceNavigationState {
    +id
    +activeSurfaceSlotId
    +activeLeafViewId
  }

  class SessionObject {
    +id
    +sessionKind
    +status
  }

  class RuntimeBinding {
    +id
    +bindingType
    +runtimeRef
    +status
  }

  class EventTape {
    +id
    +focusRunId
  }

  WorkbenchSpace --> ViewInstance : contains
  WorkbenchSpace --> SurfaceSlot : mounts
  SurfaceSlot --> SurfaceNavigationState : navigates
  ViewInstance --> SessionObject : targets
  SessionObject --> RuntimeBinding : attaches
  SessionObject --> EventTape : emits
```

## 3.4 `SessionObject` 生命周期

```mermaid
stateDiagram-v2
  [*] --> running
  running --> waiting_input
  waiting_input --> running
  running --> paused
  paused --> running
  running --> completed
  running --> error
  waiting_input --> error
  paused --> archived
  completed --> archived
  error --> archived
```

---

## 4. 三条关键用户旅程

## 4.1 打开默认工作台

```mermaid
sequenceDiagram
  participant U as User 用户
  participant R as Router 路由
  participant W as WorkbenchService 工作台服务
  participant S as SessionInteropAdapter 会话桥接
  participant UI as Flat Workbench UI

  U->>R: 打开 /workbench
  R->>W: resolveDefaultSpace()
  W->>S: loadRecentSessions(spaceId)
  S-->>W: SessionObject[]
  W-->>UI: space + panes + sessions
  UI-->>U: 展示平铺工作台
```

用户看到的效果是：

1. 不是回到一个空白页
2. 而是回到最近工作的空间
3. 最近活跃的多个会话以平铺 pane 的方式恢复出来

## 4.2 在同一空间里新增运行时 pane

1. 用户选择新建 `agent / PTY / SSH`
2. 系统创建 `SessionObject`
3. 系统创建对应 `RuntimeBinding`
4. 新 pane 进入当前 `WorkbenchSpace`
5. 该会话的输入/输出开始进入 `EventTape`

这里的重点不是 UI，而是：

1. 新运行时不再各自长一套页面语义
2. 而是统一进入 `SessionObject + RuntimeBinding`

## 4.3 从主窗口派生第二窗口

```mermaid
flowchart LR
  MW["Main Window<br/>主窗口"] --> SS["SurfaceSlot<br/>主承载面"]
  MW --> V1["Session Pane A"]
  MW --> V2["Session Pane B"]

  MW -->|弹出 / 派生| SW["Secondary Window<br/>次窗口"]
  SW --> SS2["SurfaceSlot<br/>次承载面"]
  SW --> V3["Session Pane C / Browser View"]

  MW -.共享同一空间.-> WS["WorkbenchSpace"]
  SW -.共享同一空间.-> WS
```

这里要保证：

1. 两个窗口看的不是两套独立状态
2. 而是同一 `WorkbenchSpace` 的不同投影子集

---

## 5. 实施切片

## 5.0 推荐执行顺序

1. `Slice A`
   - 先把 `/workbench` 壳层与平铺 pane 打开
2. `Slice B`
   - 再统一 `SessionObject + RuntimeBinding`
3. `Slice E`
   - 再把恢复能力补上，让“最近工作台恢复”成为可见功能
4. `Slice C`
   - 然后上桌面端 / Tauri 的次窗口工作面
5. `Slice D`
   - 最后把 `EventTape` 接进来，避免事实层阻塞前面可见工作面
6. `Slice F`
   - 用于功能封板与关闭 issue 前的人类验收

## 5.1 Slice A：Flat Shell

交付：

1. `WorkbenchPage.tsx`
2. `flat preset（平铺预设）`
3. `/workbench` 路由入口
4. `/agents/*` shim

验收：

1. 页面能打开
2. 可稳定显示多个 pane
3. 不破坏当前移动端二级页面

## 5.2 Slice B：Session / Runtime Federation

交付：

1. `SessionInteropAdapter`
2. 统一 `RuntimeBinding`
3. `AgentSession -> SessionObject` 映射
4. `PTY / SSH -> RuntimeBinding` 映射

验收：

1. 旧会话可恢复
2. 多运行时可共存
3. 语义上不再把 PTY 节点伪装成 agent

## 5.3 Slice C：Cross-Window Skeleton

交付：

1. 主窗口打开次窗口的最小链路
2. `SurfaceSlot` 与窗口承载关系
3. 窗口间共享空间与活动会话集合

验收：

1. 次窗口可打开
2. 次窗口能展示同一空间下的子集工作面
3. 不要求任意停靠与拖拽

## 5.4 Slice D：EventTape Ingress

交付：

1. `FocusRun` 基础接入
2. `EventTape` 追加写入
3. 会话输入/输出/系统控制事件入流

验收：

1. 基础时间线可回放
2. 派生层有稳定来源链路

## 5.5 Slice E：Recovery / Review Read Model

交付：

1. 会话列表 + active panes 读模型
2. 空间恢复逻辑
3. outcome / inspector 的基础只读面板

验收：

1. 关闭重开后可恢复最近工作台
2. 文档中的对象模型与实际实现结构一致

## 5.6 Slice F：可见功能封板与人类验收

交付：

1. Phase 1 最低可见功能面全部可访问
2. 验收入口清晰，不依赖阅读实现细节
3. issue 中的验收项与真实工作台界面一致

验收：

1. 人类可直接进入 `/workbench`
2. 人类可看见至少 2 个 pane 同时存在，且必须跨 runtime 类型
3. 人类可看见最近工作台恢复成功
4. 人类可看见次窗口仍属于同一 `WorkbenchSpace`

---

## 6. 可见功能验收清单

## 6.1 最低可见功能

1. `WorkbenchPage` 可访问
2. `Flat Workbench` 平铺布局可见
3. 至少 2 个 session pane 可同时显示
   - 且至少 1 个 pane 对应真实运行时恢复或真实运行时挂载
   - 且至少 1 个 pane 不是 `agent-backed session`
4. 最近工作台恢复可见
5. 桌面端 / Tauri 下的次窗口工作面可见
6. `browser runtime` 在 Phase 1 只要求模型预留与注册入口，不作为关闭条件

## 6.2 人类手测步骤

1. 打开 `/workbench`
   - 预期：进入平铺工作台，而不是旧页面空壳
2. 新建或恢复两个会话 pane
   - 预期：两者可同时可见，且至少一者不是 `agent-backed session`
3. 刷新或重启应用
   - 预期：最近工作台恢复
4. 从当前工作台弹出一个次窗口
   - 预期：仅在桌面端 / Tauri 路径验证
   - 预期：次窗口仍属于同一空间，且能看到该空间的子集工作面
5. 在其中一个 pane 内继续操作
   - 预期：事实流继续记录，不出现“切窗口后丢状态”的明显断裂
6. 打开代表性旧入口
   - 例如 `/agents/chat/*`、`/agents/pty/*`
   - 预期：仍能落到正确的 `Workbench` pane / space / 返回路径

## 6.2.1 Given / When / Then 验收模板

1. Given：
   - 已存在一个默认 `WorkbenchSpace`
   - 已存在至少一个最近活跃的 `agent-backed session`
   - 已存在或可新建至少一个 `PTY / SSH` 运行时
2. When：
   - 打开 `/workbench`
   - 新建或恢复第二个 pane
   - 刷新或重启应用
   - 从桌面端 / Tauri 弹出次窗口
3. Then：
   - 人类能看到同一空间名称或同一空间标识
   - 至少 2 个 pane 同时可见
   - 至少 1 个 pane 不是 `agent-backed session`
   - 最近工作台恢复
   - 次窗口仍指向同一空间语义
   - 代表性旧入口落点正确

## 6.3 自动化与验证建议

1. 单元测试
   - `SessionObject / RuntimeBinding / SurfaceSlot` 的状态映射与恢复逻辑
2. 集成测试
   - `/agents/*` shim 到 `/workbench` 的兼容导航
3. E2E 测试
   - `/workbench` 打开、跨 runtime 双 pane 显示、恢复最近工作台
4. 人类手测
   - 桌面端 / Tauri 的次窗口同空间语义
   - 基本 session 输入/输出仍正常

## 6.4 开发纪律

1. 行为变更先写失败测试，再写最小实现
2. 每个 Slice 完成后都要做 reviewer 复核
3. 对外宣称“完成”之前，必须有新鲜验证证据
4. Phase 1 的“完成”必须同时满足：
   - 自动化验证通过
   - 人类可见功能可手测
5. 最低验证门槛建议：
   - `bunx tsc --noEmit`
   - 新增或受影响的定向 `vitest`
   - 新增或受影响的定向 Playwright / E2E
   - 桌面端 / Tauri 的次窗口手测烟雾验证

## 6.5 关闭 issue 前的最终门槛

1. `/workbench` 可访问
2. 至少 2 个 pane 同时可见
   - 且至少 1 个 pane 不是 `agent-backed session`
3. 最近工作台恢复通过
4. 桌面端 / Tauri 的次窗口工作面通过
5. 至少 2 个代表性旧入口兼容通过
6. 自动化验证与人类手测都完成

---

## 7. 现有代码映射

1. [AgentsPage.tsx](../../src/ui/app/pages/AgentsPage.tsx)
   - 提供多会话、PTY、详情面板、移动端入口经验
   - 但对象语义需要被桥接，而不是直接复用
2. [TaskDagPage.tsx](../../src/ui/app/pages/TaskDagPage.tsx)
   - 提供 inspector 共存与状态恢复经验
3. [routes.tsx](../../src/routes.tsx)
   - 需要建立 `/workbench` 与 `/agents/*` shim
4. [issue-646-deep-analysis.md](../analysis/issue-646-deep-analysis.md)
   - 提供多窗口、聚合、回退和状态同步研究

---

## 8. 风险与评审点

## 8.1 主要风险

1. 如果 Phase 1 又偷偷回到自由画布，会拖慢交付
2. 如果 `browser runtime` 只写进文案、不进模型，后续还会断层
3. 如果窗口层没有“共享同一空间语义”，会退化成多个孤立页面
4. 如果 `EventTape` 不先打通，结构化层后面会变成伪真相
5. 如果 issue 没有明确可见验收面，阶段执行会再次滑回抽象实现

## 8.2 评审时重点看什么

1. 当前阶段是否真的收敛到了 `Flat Workbench`
2. `SessionObject + RuntimeBinding` 是否已经成为统一入口
3. 次窗口是否共享同一 `WorkbenchSpace`
4. 文档和 issue 的阶段切分是否足够清楚

---

## 9. 结论

Phase 1 的正确交付物，不是一个很自由的 UI，而是一个：

1. 能恢复
2. 能跨窗口
3. 能统一纳管多运行时
4. 能留下事实流

的稳定工作台。

只要这层打稳，后面的 `canvas / network / replay` 都是在同一底座上长出来，而不是另起一套产品。
