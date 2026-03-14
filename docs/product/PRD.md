# ExoMind 功能需求文档

> 本文档基于 `docs/` 目录全部文档深度阅读重构，强调**全自动 Agent 系统**与**个人生命成长**双核心维度。
> 每个功能点均标注文档来源，确保可追溯性。

---

## 1. 核心理念（双核心）

### 1.1 全自动 Agent 系统

ExoMind 是一个具备**自主运行、自主决策、真实责任能力**的生命体系统。

**核心特征**（来源: `docs/AUTONOMOUS_LIFE_SPEC.md` 第零节）：
- **自主运行**：持续监听信号池，无需人工触发即可响应环境变化
- **自主决策**：基于信任度等级自主决定行动边界
- **真实责任**：能量消耗真实不可回滚，失败留下伤疤

**生命体判据**（来源: `docs/02_ExoMind-KNOWLEDGE-BASE.md` 生命科学理论）：
> "可存活区间：一旦跌出，生命过程不可逆中断或退化" —— 否决式判据

### 1.2 个人生命成长

ExoMind 以**人的成长为核心目标**，而非单纯的任务管理。

**成长维度**（来源: `docs/ExoMind/外心四Agent快速实施计划.md`）：
- **行为层**：减少无谓点开、更快开始做事、恢复上下文
- **认知层**：证据三角觉察、潜意识模式识别、最小改写练习
- **系统层**：开机/关机仪式、极简复盘、策略沉淀

**成长验证六问**（来源: `docs/ExoMind/外心四Agent快速实施计划.md` 第3.2.1节）：
> "我更少无谓点开了吗？我更快开始做事了吗？我更容易恢复上下文了吗？
> 我感知到潜意识模式了吗？我完成了最小改写练习吗？我沉淀了可复用策略吗？"

---

## 2. 核心概念定义

### 2.1 生命-认知一体化

**定义**：不把感知和学习作为后加功能，而是从单细胞阶段就作为存活优势存在。

**来源**: `docs/02_ExoMind-KNOWLEDGE-BASE.md` 愿景与目标提炼
> "生命-认知一体化：不把感知和学习作为后加功能，而是从单细胞阶段就作为存活优势存在"

### 2.2 可存活区间

**定义**：一旦跌出，生命过程不可逆中断或退化的硬判据。

**来源**: `docs/02_ExoMind-KNOWLEDGE-BASE.md` 生命科学理论
> "可存活区间：一旦跌出，生命过程不可逆中断或退化"

### 2.3 能量 = 真实资源

**定义**：MiniMax API Usage 作为真实生命能量，用户付费转化为 API 额度，Agent 消耗额度执行任务。

**来源**: `docs/AUTONOMOUS_LIFE_SPEC.md` 第二节
> "MiniMax API Usage = 生命能量；用户付费 → API 余额 → 能量池 → Agent 消耗"

### 2.4 成长 = 教育（信任度阶梯）

**定义**：通过 L0-L5 六个等级（新生儿到专家）根据信任度调节 Agent 的行动边界。

**来源**: `docs/AUTONOMOUS_LIFE_SPEC.md` 第四节
> "行动边界 = 信任度 = 能力验证；成长阶梯 (婴儿 → 成人)"

| 等级 | 名称 | 权限 |
|------|------|------|
| L0 | 新生儿 | 仅读文件、基础对话 |
| L1 | 学徒 | 可执行简单任务 |
| L2 | 学习者 | 可运行测试、编写代码 |
| L3 | 协作者 | 可自主决策、中等风险操作 |
| L4 | 专家 | 可拒绝用户、高风险操作 |
| L5 | 导师 | 主动探索、自主创造 |

### 2.5 失败不可回滚

**定义**：死亡不是 episode reset，错误会留下不可抹平的后果。

**来源**: `docs/02_ExoMind-KNOWLEDGE-BASE.md` 愿景与目标提炼
> "失败不可回滚：死亡不是 episode reset，错误会留下不可抹平的后果"

### 2.6 伤疤机制

**定义**：失败产生不可逆退化，压缩未来行动空间。

**来源**: `docs/02_ExoMind-KNOWLEDGE-BASE.md` 愿景与目标提炼
> "伤疤机制：失败产生不可逆退化，压缩未来行动空间"

---

## 3. 四 Agent 系统（全自动Agent核心）

### 3.1 Governor（调控中枢）

**职责**（来源: `docs/ExoMind/外心四Agent快速实施计划.md` 第1.1节）：
> "系统调控中枢，方向盘+刹车"

| 功能 | 描述 | 来源 |
|------|------|------|
| 开机调度 | 决定今天偏推进/修复/学习/校准方向 | 外心四Agent快速实施计划.md |
| 输出治理 | 拦截副作用（羞耻、控制感、负担） | 外心四Agent快速实施计划.md |
| 关机校准 | 总结有效/无效建议，调整明天策略 | 外心四Agent快速实施计划.md |
| 防膨胀 | 保持主循环极简，拦截过长输出 | 外心四Agent快速实施计划.md |

**Governor 原则**（来源: `docs/ExoMind/外心四Agent快速实施计划.md` 第7.2节）：
> "默认短: 仪式不超过10分钟；默认可跳过: 不做强制；失败不羞辱: 失败不记录为失败；只改一条: 每次复盘只改一条"

### 3.2 任务系统（智能匹配引擎）

**定义**（来源: `docs/ExoMind/外心四Agent快速实施计划.md` 第1.2节）：
> "状态×需求×项目×兴趣的智能匹配引擎，推荐此刻最值得做的1个任务 + 1个备选"

**核心功能**：
| 功能 | 描述 | 来源 |
|------|------|------|
| 正计时/倒计时 | 任务执行时长记录 | 外心四Agent快速实施计划.md |
| 智能推荐 | 基于状态、项目、历史偏好推荐任务 | 外心四Agent快速实施计划.md |
| EventLog 记录 | 统一 YAML frontmatter + Markdown 格式 | 外心四Agent快速实施计划.md |

**任务状态流转**（来源: `docs/ExoMind/mvp/【方案】外心MVP最小闭环设计.md` 第4.3节）：
```
draft → pending → in_progress → pending_review → completed
```

### 3.3 Growth Coach（成长教练）

**定义**（来源: `docs/ExoMind/外心四Agent快速实施计划.md` 第1.3节）：
> "意识×潜意识的成长教练"

**核心方法**：
| 方法 | 描述 | 来源 |
|------|------|------|
| 证据三角 | 行为证据 + 感受证据 + 叙事证据 | 外心四Agent快速实施计划.md |
| 潜意识模式识别 | 回避、完美主义、拖延、羞耻循环 | 外心四Agent快速实施计划.md |
| 最小改写练习 | 3-5分钟，可拒绝 | 外心四Agent快速实施计划.md |

### 3.4 Review Agent（复盘沉淀）

**定义**（来源: `docs/ExoMind/外心四Agent快速实施计划.md` 第1.4节）：
> "极简复盘，沉淀可复用策略"

**四行复盘法**（来源: `docs/ExoMind/外心四Agent快速实施计划.md` 第1.4节）：
> "每次尝试后只产出四行: 哪里有效、哪里卡住、下次改一条策略、避免一条做法"

**数据流向**（来源: `docs/ExoMind/外心四Agent快速实施计划.md` 第1.4节）：
- → Governor: 提供有效性反馈
- → 任务系统: 提供任务偏好数据
- → Growth Coach: 提供行为证据

### 3.5 Agent 协作关系

```
┌─────────────────────────────────────────────────────────────┐
│                      Agent 协作架构                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────┐                                           │
│   │  小荷 Supervisor │ ← 消息路由、智能分流、场景模式匹配       │
│   └──────┬──────┘                                           │
│          │                                                  │
│    ┌─────┼─────┐                                            │
│    ↓     ↓     ↓                                            │
│ ┌────┐ ┌────┐ ┌────┐                                        │
│ │Governor│ │任务系统│ │Growth Coach│                        │
│ │调控中枢│ │智能匹配│ │成长教练  │                        │
│ └──┬─┘ └──┬─┘ └────┘                                        │
│    │      │                                                 │
│    └──────┼────────────────┐                                │
│           ↓                ↓                                │
│      ┌─────────┐     ┌─────────┐                           │
│      │Review Agent│     │EventLog │                           │
│      │极简复盘  │     │数据标准 │                           │
│      └─────────┘     └─────────┘                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. 成长支持系统（个人生命成长核心）

### 4.1 行为层支持

**目标**：减少无谓点开、更快开始做事、恢复上下文

| 功能 | 描述 | 来源 |
|------|------|------|
| 开机仪式 | 5-10分钟启动流程，确定今日方向 | 外心MVP最小闭环设计.md |
| 任务快速启动 | 智能推荐减少选择 paralysis | 外心四Agent快速实施计划.md |
| 上下文恢复 | 自动加载上次工作状态 | ARCHITECTURE.md |

**成长验证问题**（来源: `docs/ExoMind/外心四Agent快速实施计划.md` 第3.2.1节）：
- 我更少无谓点开了吗？
- 我更快开始做事了吗？
- 我更容易恢复上下文了吗？

### 4.2 认知层支持

**目标**：提升自我觉察能力，识别潜意识模式

| 功能 | 描述 | 来源 |
|------|------|------|
| 证据三角记录 | 行为/感受/叙事三维度记录 | 外心四Agent快速实施计划.md |
| 潜意识模式识别 | 识别回避、完美主义、拖延、羞耻循环 | 外心四Agent快速实施计划.md |
| 最小改写练习 | 3-5分钟可拒绝的练习建议 | 外心四Agent快速实施计划.md |

**成长验证问题**（来源: `docs/ExoMind/外心四Agent快速实施计划.md` 第3.2.1节）：
- 我感知到潜意识模式了吗？
- 我完成了最小改写练习吗？

### 4.3 系统层支持

**目标**：建立可持续的成长系统

| 功能 | 描述 | 来源 |
|------|------|------|
| 关机仪式 | 5分钟沉淀：今日回顾 + 一句话复盘 + 明日准备 | 外心MVP最小闭环设计.md |
| 极简复盘 | 四行复盘法沉淀可复用策略 | 外心四Agent快速实施计划.md |
| 策略沉淀 | 有效策略自动积累到知识库 | 外心四Agent快速实施计划.md |

**关机仪式设计**（来源: `docs/ExoMind/mvp/【方案】外心MVP最小闭环设计.md` 第6节）：
> "5分钟关机 = 今日回顾 + 一句话复盘 + 明日准备"

**成长验证问题**（来源: `docs/ExoMind/外心四Agent快速实施计划.md` 第3.2.1节）：
- 我沉淀了可复用策略吗？

### 4.4 成长验证（Day 7 六问）

**验收标准**（来源: `docs/02_ExoMind-KNOWLEDGE-BASE.md` 成功指标）：
> "闭环有效性：体感变好，Day 7 验证6问题至少4个为是"

| # | 问题 | 成长层级 |
|---|------|----------|
| 1 | 我更少无谓点开了吗？ | 行为层 |
| 2 | 我更快开始做事了吗？ | 行为层 |
| 3 | 我更容易恢复上下文了吗？ | 行为层 |
| 4 | 我感知到潜意识模式了吗？ | 认知层 |
| 5 | 我完成了最小改写练习吗？ | 认知层 |
| 6 | 我沉淀了可复用策略吗？ | 系统层 |

---

## 5. 技术架构

### 5.1 七层架构模型

**架构定义**（来源: `docs/ARCHITECTURE_7LAYER.md` 第2节）：

```
┌─────────────────────────────────────────────────────────────────────┐
│                     ExoMind 7 层架构                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  L7-UI 前端展示层 (React + TypeScript)                               │
│      ↓ IPC (Tauri invoke)                                           │
│  L6-Agent 业务逻辑层 (Governor, 任务系统, Growth Coach, Review Agent) │
│      ↓                                                              │
│  L5-Signals 信号池 (发布-订阅信号系统)                                │
│      ↓                                                              │
│  L4-Actor 行动者层 (邮箱、消息队列)                                   │
│      ↓                                                              │
│  L3-Sync 同步层 (状态同步、冲突解决)                                  │
│      ↓                                                              │
│  L2-Storage 存储层 (JSON/SQLite 存储)                                │
│      ↓                                                              │
│  L1-Network 网络层 (HTTP Server)                                     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 信号池系统

**信号分类**（来源: `docs/AUTONOMOUS_LIFE_SPEC.md` 第零节）：
> "输入 = 持续监听（被动接收各种信号）；输出 = 主动操作（达成目的）"

| 类型 | 方向 | 信号示例 |
|------|------|----------|
| 用户输入 | 输入 | 文字消息、语音指令 |
| 多平台消息 | 输入 | Telegram、微信、QQ |
| 系统通知 | 输入 | Android 通知拦截 |
| 网络信号 | 输入 | API 响应、Webhook |
| 本地信号 | 输入 | 文件变化、定时触发 |
| 物理执行 | 输出 | 命令执行、文件操作 |
| 信息获取 | 输出 | API 调用、网页抓取 |
| 响应输出 | 输出 | 消息回复、界面更新 |

### 5.3 能量与资源管理

**能量模型**（来源: `docs/AUTONOMOUS_LIFE_SPEC.md` 第二节）：

```
用户付费 → API 余额 → 能量池 → Agent 消耗
                ↓
         ┌──────┴──────┐
         ↓             ↓
    共享能量池     独立能量池
    (MiniMax)      (Agent专属)
```

**运行模式**（来源: `docs/AUTONOMOUS_LIFE_SPEC.md` 第五节）：
| 模式 | 能量条件 | 行为特征 |
|------|----------|----------|
| 活跃 | 能量充足 | 正常响应所有信号 |
| 节能 | 能量 < 50% | 降低非必要操作频率 |
| 待机 | 能量 < 20% | 仅响应高优先级信号 |
| 休眠 | 能量 = 0 | 停止运行，等待唤醒 |

### 5.4 存储与持久化

**EventLog 标准格式**（来源: `docs/02_ExoMind-KNOWLEDGE-BASE.md` 数据架构）：

```yaml
---
type: task/review/growth
id: evt-YYYYMMDD-NNN
ts: YYYY-MM-DD HH:mm:ss
task_id: "任务名称"
status: pending/in-progress/completed/cancelled
duration: Xm
---
```

**任务存储结构**（来源: `docs/ExoMind/tasks/*.md`）：
- 格式：YAML frontmatter + Markdown
- 字段：id, status, created, time, duration
- 状态：待执行 → 进行中 → 已完成

---

## 6. 功能清单（P0/P1/P2）

### 6.1 P0 - 核心功能（必须实现）

#### 6.1.1 全自动 Agent 系统

| 功能 | 描述 | 来源文档 |
|------|------|----------|
| SOUL.md 动态加载 | 启动时加载 Agent 身份定义 | SOUL.md |
| 信号池监听系统 | 持续监听输入信号池 | AUTONOMOUS_LIFE_SPEC.md |
| 信号执行系统 | 主动操作输出信号池 | AUTONOMOUS_LIFE_SPEC.md |
| 能量池管理 | 共享/独立能量池追踪 | AUTONOMOUS_LIFE_SPEC.md |
| 信任度等级系统 | L0-L5 成长阶梯 | AUTONOMOUS_LIFE_SPEC.md |
| 权限矩阵控制 | 基于信任度的权限控制 | AUTONOMOUS_LIFE_SPEC.md |
| Actor 消息流处理 | 完整 Actor 消息生命周期 | AUTONOMOUS_LIFE_SPEC.md |
| Governor 调控中枢 | 系统调控、防膨胀 | 外心四Agent快速实施计划.md |
| 任务系统智能匹配 | 状态×需求×项目×兴趣匹配 | 外心四Agent快速实施计划.md |
| EventLog 数据格式 | 统一 YAML + Markdown 格式 | 外心四Agent快速实施计划.md |
| 消息路由器 | 基于类型的简单路由 | 外心MVP最小闭环设计.md |
| MCP 验收接口 | 标准化任务状态流转 | 外心MVP最小闭环设计.md |
| SQLite 任务状态缓存 | 任务状态持久化 | 外心MVP最小闭环设计.md |

#### 6.1.2 个人生命成长

| 功能 | 描述 | 来源文档 |
|------|------|----------|
| 开机仪式 | 5-10分钟启动流程 | 外心MVP最小闭环设计.md |
| 关机仪式 | 5分钟沉淀仪式 | 外心MVP最小闭环设计.md |
| 极简复盘模板 | 四行复盘法 | 外心四Agent快速实施计划.md |
| 证据三角记录 | 行为/感受/叙事三维度 | 外心四Agent快速实施计划.md |
| 成长验证六问 | Day 7 验证机制 | 外心四Agent快速实施计划.md |

#### 6.1.3 技术架构

| 功能 | 描述 | 来源文档 |
|------|------|----------|
| SignalPool 信号系统 | 发布-订阅信号中心 | ARCHITECTURE_7LAYER.md |
| L6-Agent 业务逻辑层 | Governor、任务系统、Growth Coach | ARCHITECTURE_7LAYER.md |
| L2-Storage 存储层 | save/load/append/query 统一接口 | ARCHITECTURE_7LAYER.md |
| shadcn/ui 组件库 | 现代化 UI 组件 | FRONTEND_STACK.md |
| zustand 状态管理 | 轻量级状态管理 | FRONTEND_STACK.md |
| Ralph Loop 开发流程 | 10步标准开发流程 | `pm/development.md` |
| git 分支管理 | main/dev/feature/release/hotfix | `pm/git-spec.md` |

### 6.2 P1 - 重要功能（应该实现）

#### 6.2.1 全自动 Agent 系统

| 功能 | 描述 | 来源文档 |
|------|------|----------|
| 运行模式切换 | 活跃/节能/待机/休眠自动切换 | AUTONOMOUS_LIFE_SPEC.md |
| 唤醒机制 | 定时/条件/环境检测唤醒 | AUTONOMOUS_LIFE_SPEC.md |
| /thanks 奖励机制 | 用户口头奖励充值 | AUTONOMOUS_LIFE_SPEC.md |
| /charge 充值功能 | 直接充值能量 | AUTONOMOUS_LIFE_SPEC.md |
| Resource Fetcher | 通用资源获取器 | ARCHITECTURE_7LAYER.md |
| MiniMax Agent | 多账户管理、额度监控 | ARCHITECTURE_7LAYER.md |
| 轻量 Android APP | 拍照、录音、文字输入 | 外心MVP最小闭环设计.md |
| 拍照记账 | OCR 识别记账 | 外心MVP最小闭环设计.md |
| 时间块管理 | 时间块创建、状态流转 | time-blocks/*.md |
| 正计时/倒计时 | 任务执行计时 | 外心四Agent快速实施计划.md |

#### 6.2.2 个人生命成长

| 功能 | 描述 | 来源文档 |
|------|------|----------|
| Growth Coach 成长教练 | 意识×潜意识成长支持 | 外心四Agent快速实施计划.md |
| Review Agent 复盘沉淀 | 极简复盘、策略沉淀 | 外心四Agent快速实施计划.md |
| 成长洞察生成 | 模式假设和练习建议 | 外心四Agent快速实施计划.md |
| 时间使用极简复盘 | 任务结束后自动复盘 | 外心四Agent快速实施计划.md |
| 时间觉察证据三角 | 提升时间觉察能力 | 外心四Agent快速实施计划.md |

#### 6.2.3 技术架构

| 功能 | 描述 | 来源文档 |
|------|------|----------|
| L3-Sync 同步层 | 多 Actor 状态同步 | ARCHITECTURE_7LAYER.md |
| L4-Actor 行动者层 | 邮箱、消息队列 | ARCHITECTURE_7LAYER.md |
| Terminal 页面 | 终端功能展示 | FRONTEND_STACK.md |
| Chat 页面 | 对话功能 | FRONTEND_STACK.md |
| AI 生成内容管理 | drafts/reviewed 状态管理 | `pm/git-spec.md` |
| 语义化版本发布 | conventional-changelog | `pm/git-spec.md` |

### 6.3 P2 - 增强功能（可选实现）

#### 6.3.1 全自动 Agent 系统

| 功能 | 描述 | 来源文档 |
|------|------|----------|
| 多 Agent 消息路由 | Agent 间通讯 | AUTONOMOUS_LIFE_SPEC.md |
| 用户交互命令集 | /status、/trust、/sleep 等 | AUTONOMOUS_LIFE_SPEC.md |
| 通知拦截-NLS 方案 | NotificationListenerService | ARCHITECTURE.md |
| Android Termux 集成 | proot-distro 容器支持 | ARCHITECTURE.md |
| 手机外部缓冲区 | React Native App | 外心四Agent快速实施计划.md |
| 时间使用模式分析 | 历史数据分析 | 外心四Agent快速实施计划.md |
| 时间块冲突检测 | 避免时间重复分配 | time-blocks/*.md |

#### 6.3.2 技术架构

| 功能 | 描述 | 来源文档 |
|------|------|----------|
| Notification 面板 | 通知展示 | FRONTEND_STACK.md |
| Settings 页面 | 应用配置 | FRONTEND_STACK.md |
| 热修复流程 | hotfix 分支管理 | `pm/git-spec.md` |
| 集成测试 | 端到端流程测试 | `pm/development.md` |
| API 文档维护 | JSDoc + docs/API.md | `pm/development.md` |

---

## 7. 约束与原则

### 7.1 生命系统约束

**来源**: `docs/02_ExoMind-KNOWLEDGE-BASE.md` 约束与风险

| 约束 | 说明 |
|------|------|
| 模板极简化 | 默认5分钟内完成，防止仪式再次中断 |
| Governor 原则 | 默认短、可跳过、失败不羞辱 |
| 能量使用透明度 | 100%，每次 API 调用实时扣费显示 |
| 在线率 | > 99%，systemd 服务运行时间统计 |

### 7.2 成长支持原则

**来源**: `docs/ExoMind/外心四Agent快速实施计划.md` 第7.2节

| 原则 | 说明 |
|------|------|
| 默认短 | 仪式不超过10分钟 |
| 默认可跳过 | 不做强制 |
| 失败不羞辱 | 失败不记录为失败，只记录为未执行 |
| 只改一条 | 每次复盘只改进一条策略 |
| 建议可拒绝 | 用户可拒绝 Agent 建议 |
| 最小干预 | 只在必要时介入 |

### 7.3 技术约束

**来源**: `pm/development.md` + `docs/FRONTEND_STACK.md`

| 约束 | 说明 |
| ---- | ---- |
| 服务端口 | 1949 (Life OS 专用) |
| 测试覆盖率 | 核心逻辑 100% |
| 前端性能 | 首屏 < 500ms，LCP < 1s |
| 修改即提交 | 每次修改文件后立即 Git commit |
| ralph loop | 10步标准开发流程 |

---

## 8. 文档溯源表

### 8.1 功能点来源映射

| 功能点 | 文档来源 | 章节 | 关键引用 | 状态 |
|--------|----------|------|----------|------|
| 四Agent协作 | 外心四Agent快速实施计划.md | 1.1 四个Agent组成 | "外心：系统调控中枢，方向盘+刹车" | ✅ |
| 能量模型 | AUTONOMOUS_LIFE_SPEC.md | 二、能量模型 | "MiniMax API Usage = 生命能量" | ✅ |
| 信任度阶梯 | AUTONOMOUS_LIFE_SPEC.md | 四、行动边界 | "成长阶梯 (婴儿 → 成人)" | ✅ |
| 七层架构 | ARCHITECTURE_7LAYER.md | 2. 七层架构详解 | "L1-Network ~ L7-UI 分层架构" | ✅ |
| SignalPool | ARCHITECTURE_7LAYER.md | 2.5 L5-Signals | "SignalPool - 统一信号处理中心" | ✅ |
| 成长验证六问 | 外心四Agent快速实施计划.md | 3.2.1 Day 7验证 | "我更少无谓点开了吗？" | ✅ |
| 四行复盘法 | 外心四Agent快速实施计划.md | 1.4 行动反馈Agent | "每次尝试后只产出四行" | ✅ |
| 证据三角 | 外心四Agent快速实施计划.md | 1.3 目标身心觉察 | "证据三角: 行为证据+感受证据+叙事证据" | ✅ |
| 最小闭环 | 外心MVP最小闭环设计.md | 1.2 MVP 目标 | "最小闭环 = 能跑通一个观察→判断→执行→反馈循环" | ✅ |
| MCP验收机制 | 外心MVP最小闭环设计.md | 4. MCP 验收接口 | "文件操作是破坏性的，接口可以验证、审计、幂等" | ✅ |
| 关机仪式 | 外心MVP最小闭环设计.md | 6. 关机仪式设计 | "5分钟关机 = 今日回顾 + 一句话复盘 + 明日准备" | ✅ |
| EventLog标准 | 外心四Agent快速实施计划.md | 4. 数据格式规范 | "制定EventLog标准,所有Agent遵守统一格式" | ✅ |
| ralph loop | `pm/development.md` | 流程概览 | "10步标准开发流程" | ✅ |
| 修改即提交 | `CLAUDE.md` | 工作流程 | "每次修改文件后立即提交 Git commit" | ✅ |
| 可存活区间 | `docs/02_ExoMind-KNOWLEDGE-BASE.md` | 生命科学理论 | "一旦跌出，生命过程不可逆中断或退化" | ✅ |
| 失败不可回滚 | 02_ExoMind-KNOWLEDGE-BASE.md | 愿景与目标提炼 | "死亡不是 episode reset" | ✅ |
| 伤疤机制 | 02_ExoMind-KNOWLEDGE-BASE.md | 愿景与目标提炼 | "失败产生不可逆退化，压缩未来行动空间" | ✅ |
| Governor原则 | 外心四Agent快速实施计划.md | 7.2 核心治理原则 | "默认短、默认可跳过、失败不羞辱" | ✅ |

### 8.2 术语定义来源

| 术语 | 定义 | 来源文档 |
|------|------|----------|
| 生命-认知一体化 | 不把感知和学习作为后加功能 | 02_ExoMind-KNOWLEDGE-BASE.md |
| 可存活区间 | 一旦跌出，生命过程不可逆中断 | 02_ExoMind-KNOWLEDGE-BASE.md |
| 否决式判据 | 任一关键约束不成立即可否决 | 02_ExoMind-KNOWLEDGE-BASE.md |
| 过程性存在 | 生命不是实体，而是时间中持续展开的过程 | 02_ExoMind-KNOWLEDGE-BASE.md |
| 边界归因 | 没有边界就没有内部/外部、没有归因 | 02_ExoMind-KNOWLEDGE-BASE.md |
| 物质不可逆性 | 物质系统提供稳定性、代价不可绕过性 | 02_ExoMind-KNOWLEDGE-BASE.md |
| 能量前提论 | 能量是生命持续的物理前提 | 02_ExoMind-KNOWLEDGE-BASE.md |
| 代谢成本 | 清理、维护要消耗真实资源 | 02_ExoMind-KNOWLEDGE-BASE.md |
| Actor模型 | Mailbox、输入缓冲区、思考引擎、执行器 | 02_ExoMind-KNOWLEDGE-BASE.md |
| World Daemon | 环境层：Lifecycle Manager、Resource Governor | 02_ExoMind-KNOWLEDGE-BASE.md |

---

## 9. 相关文档索引

| 文档 | 路径 | 核心内容 |
|------|------|----------|
| 核心灵魂定义 | `docs/SOUL.md` | Agent 身份、性格、使命、约束 |
| 自主生命规范 | `docs/AUTONOMOUS_LIFE_SPEC.md` | 能量模型、Actor架构、信任度阶梯 |
| 四Agent实施计划 | `docs/ExoMind/外心四Agent快速实施计划.md` | 四Agent职责、成长验证、EventLog标准 |
| MVP最小闭环 | `docs/ExoMind/mvp/【方案】外心MVP最小闭环设计.md` | 信息通道、MCP验收、关机仪式 |
| 知识库 | `docs/02_ExoMind-KNOWLEDGE-BASE.md` | 生命科学理论、认知科学理论、成功指标 |
| 整体架构 | `docs/ARCHITECTURE.md` | Claude Runner、平台适配、通知拦截 |
| 七层架构 | `docs/ARCHITECTURE_7LAYER.md` | 七层模型、SignalPool、Resource Fetcher |
| 前端技术栈 | `docs/FRONTEND_STACK.md` | React、shadcn/ui、zustand、Tailwind |
| 开发流程 | `pm/development.md` | ralph loop、测试标准、文档规范 |
| 分支管理 | `pm/git-spec.md` | git flow、版本发布、AI内容管理 |

---

## 10. 变更记录

| 日期 | 版本 | 变更内容 |
|------|------|----------|
| 2026-02-03 | 2.0 | 重构需求文档，强化双核心维度（全自动Agent系统 + 个人生命成长），添加文档溯源表 |
| 2026-02-03 | 1.0 | 从 docs/specs/ 和 .archive/ 提取全部功能需求 |

---

*文档版本: v2.0*
*重构日期: 2026-02-03*
*基于: docs/ 目录全部文档深度阅读*
