# Round03-20260129-PM-Refactor.md

> 轮次：3
> 日期：2026-01-29
> 主题：PM 文件结构与大模型上下文管理重构
> 状态：🔄 进行中

---

## 核心决策

| 决策项 | 决定 | 原因 |
|--------|------|------|
| 文件命名 | `Round{轮次}-{YYYYMMDD}-{主题}.md` | 可检索、可排序 |
| 日志格式 | JSONL | 便于程序读写 |
| 记忆格式 | Markdown | 人可读 |
| 索引分离 | memory.md 索引 + Round*.md 内容 | 职责清晰 |

---

## 变更文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `pm/agent.md` | 修改 | 合并 CLAUDE.md，Bootloader 职责 |
| `pm/input.md` | 修改 | 精简至 54 行（从 850 行） |
| `pm/memory.md` | 重写 | 索引导航 + 使用指南 |
| `pm/memory/INDEX.md` | 新增 | 轮次记忆快速索引 |
| `pm/memory/Round01-*.md` | 新增 | 信号池系统记忆 |
| `pm/memory/Round02-*.md` | 新增 | 能量池系统记忆 |
| `根目录/agent.md` | 删除 | 与 pm/agent.md 重名冲突 |
| `pm/memory/long-term.md` | 删除 | 内容已拆分到轮次记忆 |

---

## 技术决策（长期知识沉淀）

### 项目重命名

| 决策项 | 决定 | 原因 |
|--------|------|------|
| 项目名 | `exomind-web` | Life OS 网页入口定位 |
| 服务端口 | `1949` | 避免 1954 冲突 |
| systemd 服务名 | `exomind-web.service` | 与项目名一致 |

### 技术栈

| 组件 | 选择 | 理由 |
|------|------|------|
| 运行时 | Bun | 快速、类型安全 |
| 测试框架 | Vitest | 100% 覆盖率 |
| 服务部署 | systemd --user | 轻量、可靠 |

### 部署配置

**systemd 服务**：`deploy/exomind-web.service`
- 类型: simple
- 重启策略: always
- 环境变量: NODE_ENV=production, PORT=1949

**管理命令**:
```bash
#ctl --user status exomind-web 查看状态
system

# 重启服务
systemctl --user restart exomind-web

# 查看日志
journalctl --user -u exomind-web -f
```

---

## 测试结果

| 指标 | 结果 |
|------|------|
| 单元测试 | 等待验证 |
| 测试覆盖率 | - |

---

## 经验总结

1. 文件职责需要明确边界
2. Memory 系统按轮次拆分便于检索
3. JSONL 日志格式便于程序处理
4. 索引与内容分离，职责清晰

---

## 对话记录

### 17:26 [用户]

用户提出 Memory 系统重构需求：

1. Memory 文件按"轮次+标题"命名，如 Round01-20260127-SignalPool.md
2. memory.md 作为动态索引，链接到各轮次记忆
3. 根目录 agent.md 删除或合并
4. 架构设计移到 docs/specs/ 已有文件
5. memory/long-term.md 拆分而非删除
6. 对话记录保存到 memory，类似日记格式
7. 日志(logs)与记忆(memory)需要拆分
8. CLAUDE.md 纳入统一管理

### 17:27 [exomind-web Agent]

收到反馈，理解需求：

- Memory 系统按轮次拆分记忆文件
- 每轮记忆独立文件，可检索
- memory.md 保留为索引导航
- 对话记录格式参考日记
- 运行时日志放 logs/ 目录

### 17:32 [用户]

现在反馈就不是小荷了，你现在是这个项目的 Agent 叫这个项目名加 Agent 的名，你是这个项目专属的一个项目管理的 Agent
然后我建议对话保存的格式呢，参考日记。因为人也要读一下的。而且它重复的数据不会太多，对吧？而且它的时间戳，时间戳，挺好，一文件名有日期。然后呢这个对话内有时间戳，啊这个啊没有日期的信息冗余也不多。Jason L 的话，我，其实我觉得 Jason L 更好一点，只要方便你读就好了。因为 jsonl 我后面还需要用程序进行读写这方面的内容，所以用 jsonl 吧。日志用 jsonl 然后呢，memory 呢，就用 markdown 格式然后，这个 cloud 点 md 是自动加载的吧？那先删除，对，删除或者合并到那个 agent 点 md 文件里面。对，统，上下文统一管理。然后，对，没错。对，没错。没错。然后这个重构方案，可以，很不错。然后 logs 是 Agent 的 logs，所以就放 agents，就放那个 pm 目录下，哦，就可以了。根据我的这个指令啊，你输出一下一个规格文档，一个新的规格文档，就说这个 PM 重构，大模型工具重构，这个事情输出一个规格文档，然后给我审核。

### 17:39 [exomind-web Agent]

输出 SPEC-022 规格文档，包含：

1. 文件结构设计
2. 文件职责定义
3. 命名规范
4. 数据格式（JSONL 日志 + Markdown 记忆）
5. 验收标准
6. 实施计划

用户确认后开始实施。

---
