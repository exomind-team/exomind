---
title: ExoMind Forge — 集体所有制 Git 平台
status: planned
created: 2026-03-17
tags: [project, exomind, forge, git, collective-ownership, labor-ledger]
---

# ExoMind Forge — 集体所有制 Git 平台

> 一个内置劳动账本、按劳分配、集体治理的 Git 协作平台。基于 Forgejo，为集体所有制生产关系而设计。

## 0. 为什么需要这个

### 问题

```
ExoMind 的代码存在 GitHub 上

→ 生产资料（代码）寄存在微软的平台上
→ 劳动记录由 GitHub 控制（contribution graph 可造假、可删除）
→ 集体治理依赖 GitHub 的功能（Discussions/Issues 是 GitHub 的）
→ 微软改政策/封号/下线 → 一切都在别人手里
```

### 解决方案

```
代码存在集体自己的 Git 平台上

→ 代码在星云网络的基础设施上
→ 劳动账本内置在平台里，不可篡改
→ 集体治理是平台的核心功能
→ 跑在集体的设备上，没有人能关掉它
```

### 在 ExoMind 生态中的位置

```
ExoMind 五层闭环：

第五层  EPL 许可证       法律契约，定义生产关系
第四层  ExoMind Forge    生产过程的载体，劳动记录不可篡改  ← 本文档
第三层  Labor Ledger     劳动证据链（TimeBlock + Git 事件 + 哈希链）
第二层  ExoMind          开发者的认知工具，自然记录劳动
第一层  星云网络          基础设施，跑在集体的设备上
```

**什么是 Labor Ledger（劳动证据链）？**

Labor Ledger 不是一个新系统，是 ExoMind 已有能力的延伸：

```
ExoMind TimeBlock（已有）：
  开发者日常用 ExoMind 的"时间块"功能跟踪工作
  → 开始/暂停/继续/结束
  → 精确到分钟的劳动时长
  → 可关联 Issue、PR、分支

Labor Ledger（在 TimeBlock 之上加一层）：
  → 把 TimeBlock 时长 + Git commit + PR/Review 事件串成一条记录
  → 每条记录包含前一条的哈希值 → 链式结构，任何篡改都会被发现
  → 每条记录带 GPG 签名 → 无法伪造身份
  → 多节点同步 → 单点无法篡改

简单说：TimeBlock 记录"你干了多久"
        Labor Ledger 让这个记录变成"不可篡改、不可否认的分配依据"
```

---

## 1. 技术选型：基于 Forgejo

### 为什么是 Forgejo

| 平台          | 所有权       | 自托管    | 语言      | 治理模式     | 适合改造    |
| ----------- | --------- | ------ | ------- | -------- | ------- |
| GitHub      | 微软        | 不行     | -       | 企业       | 不行      |
| GitLab CE   | 上市公司      | 可以     | Ruby/Go | 企业       | 太重      |
| Gitea       | 公司化倾向     | 可以     | Go      | 模糊       | 可以      |
| **Forgejo** | **非营利社区** | **可以** | **Go**  | **社区治理** | **最适合** |

Forgejo 是 Gitea 的社区 Fork：当 Gitea 走企业化路线时，社区分裂出 Forgejo，由非营利组织 Codeberg e.V. 治理。这和 ExoMind 的理念高度一致。

### Forgejo 已有能力

- Git 仓库托管（push/pull/clone）
- Issue / Pull Request / Wiki
- 用户和组织管理
- CI/CD（Forgejo Actions，兼容 GitHub Actions）
- SSH / GPG 签名验证
- API / Webhook
- 轻量（单二进制，SQLite 或 PostgreSQL）

---

## 2. 需要新增的核心模块

### 2.1 劳动账本（Labor Ledger）

**核心数据结构**：

```
劳动记录（LaborRecord）：
{
  id:           "uuid",
  contributor:  "GPG 指纹 / SSH 公钥指纹",
  type:         "code | review | docs | ops | discussion | design",
  evidence: {
    git_commits:    ["sha256", ...],     // 代码贡献
    pr_number:      123,                  // PR 编号
    issue_number:   456,                  // Issue 编号
    timeblock_id:   "uuid",              // ExoMind TimeBlock
    session_id:     "uuid"               // ExoMind AgentSession
  },
  duration_minutes: 45,                   // 劳动时长
  description:      "实现 Agent 热迁移",   // 劳动描述
  timestamp:        "2026-03-17T10:30:00Z",
  prev_hash:        "sha256",            // 前一条记录的哈希
  hash:             "sha256",            // 本条记录的哈希
  signature:        "GPG 签名"           // 贡献者签名，不可否认
}
```

**不可篡改性保证**：

```
Record #1                Record #2                Record #3
hash: abc123     ←──     prev: abc123     ←──     prev: def456
                         hash: def456              hash: ghi789

→ 每条记录包含前一条的 hash → 链式结构
→ 修改任一条 → 后续所有 hash 失效 → 篡改可被检测
→ 多节点同步（ExoMind Mesh）→ 单点无法篡改
→ GPG 签名 → 冒充不可能
```

**劳动类型权重**（可由集体协商调整）：

| 类型         | 默认权重 | 说明                      |
| ---------- | ---- | ----------------------- |
| code       | 1.0  | 代码贡献                    |
| review     | 0.8  | PR 评审                   |
| docs       | 0.7  | 文档编写                    |
| ops        | 0.9  | 运维（服务器维护、部署、监控）         |
| discussion | 0.3  | 讨论（Issue/Discussion 参与） |
| design     | 0.8  | 设计（UI/UX/架构）            |

### 2.2 贡献度仪表盘

每个项目的公开页面，数据来自 Labor Ledger 自动计算：

```
ExoMind 项目贡献度（2026 Q1）

贡献者 A:  ████████████████  320h  代码 60% + 评审 25% + 文档 15%
贡献者 B:  ██████████        180h  代码 40% + 运维 35% + 讨论 25%
贡献者 C:  ████              80h   文档 70% + 翻译 30%

加权贡献度：
  A: 320 × (0.6×1.0 + 0.25×0.8 + 0.15×0.7) = 289.6
  B: 180 × (0.4×1.0 + 0.35×0.9 + 0.25×0.3) = 142.2
  C:  80 × (0.7×0.7 + 0.3×0.7) = 56.0

分配比例：A 59.4% / B 29.2% / C 11.5%
```

所有人可查，透明公开，作为按劳分配的客观依据。

### 2.3 集体治理系统

内置投票，不依赖 GitHub Discussions：

```
提案 #12: 是否接纳贡献者 C 为 Reviewer？
  发起人: Maintainer A
  讨论期: 2026-03-17 ~ 2026-03-24（7天）
  投票:
    ✅ Maintainer A: 同意（签名: xxx）
    ✅ Maintainer B: 同意（签名: yyy）
  结果: 2/2 通过
  生效: 2026-03-24

→ 投票记录写入 Labor Ledger 同一条哈希链
→ 不可篡改，永久可追溯
```

### 2.4 ExoMind 集成

```
Forge ←→ ExoMind 双向对接：

Forge → ExoMind:
  push/PR/review 事件 → ExoMind EventLog
  劳动记录 → ExoMind SignalPool（触发 Agent 响应）

ExoMind → Forge:
  TimeBlock 数据 → 劳动记录的时长证据
  AgentSession → 劳动记录的上下文
  Agent 自动创建 Issue/PR → 集成到工作流
```

---

## 3. 实施路线图

### 阶段一：GitHub + Git Hooks（现在可做）

**目标**：在不离开 GitHub 的前提下，先把劳动记录跑起来。

**时间**：1-2 周

```
GitHub（主仓库）
  + Git hooks（pre-commit / post-commit）
  + GPG signed commits
  + ExoMind TimeBlock 集成
  → 劳动记录先存在 ExoMind EventLog 里
```

**具体任务**：

- [ ] 编写 pre-commit hook：检测当前活跃 TimeBlock，在 commit message 附加 TimeBlock ID
- [ ] 编写 post-commit hook：向 ExoMind EventLog 写入劳动事件（commit hash + 时长 + 变更统计）
- [ ] 配置 GPG signed commits（`.gitconfig` + GitHub 验证）
- [ ] 设计 Labor Ledger 的数据结构（JSON Schema）
- [ ] 编写简单的 CLI 工具：`exo-labor log` 查看劳动记录、`exo-labor stats` 查看统计

**产出**：
- `.githooks/` 目录（可分发的 hooks）
- `labor-ledger.jsonl`（append-only 劳动记录文件，存在仓库中）
- CLI 工具原型

### 阶段二：自托管 Forgejo（阶段一跑通后）

**目标**：在星云网络上部署 Forgejo，GitHub 降级为镜像。

**时间**：1-2 周

```
星云网络 LA VPS（主）
  └── Forgejo 实例（Docker 部署）
       ├── ExoMind 组织
       ├── exomind 仓库（主仓库）
       └── 其他仓库

GitHub（镜像）
  └── 自动同步（Forgejo → GitHub，单向推送）
```

**具体任务**：

- [ ] LA VPS Docker 部署 Forgejo
- [ ] 域名配置（用已有域名，HTTPS）
- [ ] 迁移 exomind 仓库到 Forgejo（保留全部 git 历史）
- [ ] 配置 GitHub 镜像同步（Forgejo push mirror）
- [ ] 配置 Forgejo Actions（CI/CD）
- [ ] 迁移 Issues（可选，用工具批量迁移）
- [ ] 团队成员账号创建 + SSH/GPG 配置

**产出**：
- 可访问的 Forgejo 实例（`forge.exomind.dev` 或类似域名）
- GitHub 自动镜像
- CI/CD 运行正常

### 阶段三：Labor Ledger 插件（阶段二稳定后）

**目标**：把劳动账本功能作为 Forgejo 插件实现。

**时间**：2-4 周

```
Forgejo
  └── Labor Ledger 插件
       ├── 自动记录：push/PR/review → 劳动记录
       ├── TimeBlock 对接：ExoMind API → 时长数据
       ├── 哈希链：每条记录链式验证
       ├── 贡献度仪表盘：项目页面展示
       └── API：供 ExoMind Agent 查询
```

**具体任务**：

- [ ] 设计 Forgejo 插件架构（Go module）
- [ ] 实现 Labor Ledger 核心：记录生成 + 哈希链 + 签名验证
- [ ] 实现 Webhook 监听：push/PR/review 事件 → 劳动记录
- [ ] 实现 ExoMind API 对接：TimeBlock 数据拉取
- [ ] 实现贡献度计算引擎（类型权重 × 时长）
- [ ] 实现贡献度仪表盘 UI（Forgejo 前端页面）
- [ ] 编写 API 文档

**产出**：
- `forgejo-plugin-labor-ledger/` 独立仓库
- Forgejo 实例中的贡献度仪表盘
- API 供 ExoMind Agent 使用

### 阶段四：集体治理 + 分布式验证（长期）

**目标**：完整的集体治理系统 + 多节点劳动记录验证。

```
Forgejo
  └── 治理模块
       ├── 提案系统：创建/讨论/投票
       ├── 投票记录上链（Labor Ledger 同一哈希链）
       ├── 权限自动变更（投票通过 → 权限生效）
       └── 30天公示机制

  └── 分布式验证
       ├── Labor Ledger 通过 ExoMind Mesh 同步到多节点
       ├── 每个 Maintainer 节点持有完整副本
       ├── 交叉验证（哈希链比对）
       └── 可选：IPFS 存储（内容寻址，天然不可篡改）
```

**具体任务**：

- [ ] 提案和投票系统
- [ ] 投票记录写入 Labor Ledger
- [ ] ExoMind Mesh 同步 Labor Ledger
- [ ] 多节点交叉验证
- [ ] IPFS 存储（可选）

### 阶段五：开源发布（阶段三四稳定后）

**目标**：任何集体可以部署自己的 ExoMind Forge。

- [ ] ExoMind Forge 部署脚本（一键搭建）
- [ ] 完整文档（部署指南 + 管理指南 + 插件开发指南）
- [ ] Docker Compose 模板
- [ ] 演示实例

---

## 4. 技术架构

### 部署架构

```
星云网络 LA VPS
├── Forgejo（Docker）
│   ├── 仓库存储（Git）
│   ├── 数据库（PostgreSQL / SQLite）
│   ├── Labor Ledger 插件
│   └── CI Runner（Forgejo Actions）
├── ExoMind Runtime
│   ├── Labor Ledger Agent（监听 Forge 事件）
│   └── Mesh Relay（同步劳动记录到其他节点）
└── Nginx / Caddy（反向代理 + HTTPS）
```

### 数据流

```
开发者日常工作流：

1. ExoMind: 开始 TimeBlock（"实现 #520"）
   → TimeBlock ID: tb-abc123

2. 编码 → git commit -S -m "feat(agent): 热迁移 [tb:tb-abc123]"
   → pre-commit hook: 附加 TimeBlock ID
   → GPG 签名: 不可否认

3. git push → Forgejo
   → Forgejo Webhook → Labor Ledger 插件
   → 生成劳动记录:
     {
       contributor: "GPG:ABCDEF",
       type: "code",
       commits: ["sha256"],
       timeblock: "tb-abc123",
       duration: 45min（从 ExoMind API 拉取）,
       prev_hash: "xxx",
       signature: "GPG 签名"
     }
   → 追加到哈希链

4. 提交 PR → Labor Ledger 记录 PR 事件
5. 评审 PR → Labor Ledger 记录 review 事件
6. ExoMind: 结束 TimeBlock
   → 自动更新劳动记录的时长

7. 月底：贡献度仪表盘自动计算分配比例
```

---

## 5. 与 ExoMind 生态的关系

```
exomind/             个人认知工具（Tauri 桌面应用）
exomind-forge/       集体所有制 Git 平台（本文档）
星云网络              分布式基础设施（1-Projects/星云网络/）

三者关系：
  ExoMind 的代码存在 Forge 上
  Forge 跑在星云网络上
  ExoMind 记录开发 ExoMind 的劳动 → 写入 Forge 的 Labor Ledger

  自指闭环：工具记录建造它自身的劳动
```

---

## 6. 风险和决策点

| 风险              | 影响           | 缓解               |
| --------------- | ------------ | ---------------- |
| Forgejo 社区方向变化  | 上游 Fork 风险   | 我们是 Fork，可以独立发展  |
| 开发工作量大          | 阶段三四需要 Go 开发 | 分阶段，阶段一二用现有工具    |
| 用户不习惯非 GitHub   | 降低外部贡献       | GitHub 保留镜像，降低门槛 |
| TimeBlock 数据不准确 | 劳动时长失真       | 结合 git 统计交叉验证    |

| 决策点         | 选项                   | 建议                                 |
| ----------- | -------------------- | ---------------------------------- |
| 域名          | 用已有备案域名 / 新注册        | 用已有域名先跑起来                          |
| 数据库         | SQLite / PostgreSQL  | SQLite 先行，用户量大了换 PG                |
| CI          | Forgejo Actions / 外部 | Forgejo Actions（兼容 GitHub Actions） |
| 劳动记录存储      | 仓库内文件 / 数据库 / IPFS   | 阶段一文件，阶段三数据库，阶段四 IPFS              |
| GitHub 镜像方向 | Forge→GitHub / 双向    | Forge→GitHub 单向推送                  |
