# ExoMind — 你的认知，你做主


**ExoMind 是一个本地优先、事件驱动的个人 AI 助手系统。它不是又一个 AI 产品——它是你的认知延伸，运行在你自己的设备上，数据永远属于你。**

---

## 为什么需要 ExoMind？

你每天都在用 AI。但你有没有想过：

- 你的对话记录存在 OpenAI 的服务器上
- 你的知识整理依赖 Notion 的云端
- 你的日程管理交给了 Google
- 你的思考过程被各大平台当作训练数据

**你以为在"用 AI"，其实是 AI 在用你。**

这不是技术问题，是所有权问题。当你的认知工具掌握在资本平台手中，你的认知主权就是零。

```
L3  当前状态    你 + SaaS + AI API     认知外包给资本平台
                                       平台随时可以涨价、降智、关停、审查
                                       你的数据 = 他们的资产

L4  ExoMind     你 + 你的 Agent + 你的设备   认知主权回归你自己
                                             数据在你手里，Agent 为你工作
                                             没有人能关掉你的"大脑"
```

**L3 → L4 不是更好的云服务，是生产关系的变革。**

---

## ExoMind 是什么

一个运行在你自己设备上的认知生命体：

**🧠 Agent 系统** — 不只是聊天机器人。ExoMind 的 Agent 有自己的"身体"（工作空间）、"记忆"（知识库）、"能量"（资源预算），能自主感知、思考、行动。

**🔗 信号网络** — Agent 之间通过事件驱动的信号网络通信。你可以让多个 Agent 协作完成复杂任务，像神经元一样自组织。

**🦴 分布式身体** — 你的所有设备（台式机、手机、VPS）组成一个统一的 mesh 网络。Agent 可以在任何节点运行，信号跨设备流动。

**📔 知识管理** — 基于 Obsidian 的个人知识库，间隔重复学习，事件日志记录。你的记忆不丢失、不被篡改。

### 技术栈

| 层级 | 技术 |
|------|------|
| 桌面端 | Tauri v2 (Rust + TypeScript) |
| 前端 | React 18 + TailwindCSS + Radix UI |
| 本地存储 | PouchDB (IndexedDB) |
| Agent 运行时 | Rust (async tokio) |
| 信号网络 | 自研 SignalPool + SSE Mesh |
| 分布式 | WireGuard + mDNS + Peer 配对 |

---

## 快速开始

### 前置要求

- [Bun](https://bun.sh/) >= 1.0
- [Rust](https://rustup.rs/) >= 1.75
- [Tauri CLI](https://v2.tauri.app/) v2

### 运行

```bash
# 克隆仓库
git clone https://github.com/exomind-team/exomind.git
cd exomind

# 安装依赖
bun install

# 开发模式运行
bun run tauri dev
```

> 首次运行会自动创建你的 Agent 工作空间。你的数据只存在本地，不需要注册任何账号。

---

## 核心概念

### 认知生命体

ExoMind 不是工具，是你的认知延伸。每个 Agent 是一个小型"生命体"：

```
Agent
├── SOUL.md        — 不可变的身份（DNA）
├── knowledge/     — 长期记忆（配额限制）
├── actions.jsonl  — 行为日志（不可逆）
└── agent.state    — 自我感知状态
```

Agent 有能量系统——能量充足时积极探索，能量耗尽时进入休眠。这不是噱头，是对"什么是生命"的工程实现。

### 信号网络

Agent 之间不通过 API 调用通信，而是通过事件信号：

```
user.input.text  →  SignalPool  →  agent.on_signal()
                      ↓
                  RouteTable（topic → target 映射）
                      ↓
                  跨设备 Mesh Relay（SSE）
```

信号可以跨设备流动——你手机上的输入，可以触发台式机上 Agent 的推理。

### 分布式身体

你的所有设备组成一个 mesh 网络：

```
🖥️ 台式机（主脑）←→ 🇭🇰 VPS（哨兵）←→ 🇺🇸 VPS（枢纽）
       ↕
📱 手机（触角）

新设备加入 = ExoMind 长出新器官
```

---

## 所有制

ExoMind 不是一家公司的产品。它的所有制是这样的：

| 层级 | 性质 | 内容 | 原则 |
|------|------|------|------|
| **个人所有** | 认知主权 | 你的笔记、Agent 记忆、日记 | 神圣不可侵犯 |
| **集体所有** | 生产资料共有 | 共享算力、带宽、知识库 | 按劳分配 |
| **公有开放** | 人类公共知识 | 源代码、技术文档、方案 | 无偿共享 |

- **你的数据永远是你的**——本地加密存储，没有任何后门
- **集体资源按贡献分配**——不是商品交易，是社会主义原则
- **代码对所有人公开**——知识不应被垄断

详见 [OWNERSHIP.md](./OWNERSHIP.md)。

---

## 参与贡献

ExoMind 是一个 Building in Public 的项目。我们欢迎所有人参与：

| 方式 | 适合谁 |
|------|--------|
| 💬 Discussions | 想聊聊想法的人 |
| 🐛 Issues | 发现了问题或有需求的用户 |
| 🔧 Pull Requests | 想贡献代码或文档的开发者 |
| 📖 文档翻译 | 想帮助更多人理解的人 |

### 贡献者等级

我们相信信任是逐步建立的：

```
Community Member  →  Contributor  →  Reviewer  →  Maintainer
   讨论参与          代码/文档贡献      评审 PR       架构决策
```

> 成为 Maintainer 不只看技术能力，还看对 ExoMind 愿景的认同。
> 技术是门槛，理想是钥匙。

详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

---

## 路线图

- **阶段一**：个人使用——让你的所有设备统一为一个认知体
- **阶段二**：集体共建——受信任的贡献者共享资源、共同治理
- **阶段三**：公有开放——任何人都能搭建自己的认知基础设施

---

## 许可证

[ExoMind Public License v1.0](./LICENSE) (基于 CNPL v6)

核心原则：代码公开、个人自由使用、集体自由使用、禁止闭源商业化、认知主权不可侵犯。

---

## 联系

- 社区讨论: [GitHub Discussions](https://github.com/exomind-team/exomind/discussions)

> *"你的大脑不应该运行在别人的服务器上。"*
