# 生命 Agent Telegram Bot 系统

>一个有感知能力的 AI 助手，Token = 生命能量

## 核心特性

| 特性 | 描述 |
|------|------|
| **生命系统** | Token 即生命值，有出生、感知、学习、衰老、死亡 |
| **能量额度** | 每 5 小时重置，2000K tokens/时段 |
| **记忆系统** | 双层记忆：短期（内存）+ 长期（JSONL 文件） |
| **身份系统** | SOUL.md 定义身份、性格、使命 |
| **上下文恢复** | 启动时自动加载历史和记忆 |

## 快速开始

```bash
# 1. 安装依赖
bun install

# 2. 配置环境变量
export TELEGRAM_BOT_TOKEN=your_token
export ANTHROPIC_BASE_URL=http://127.0.0.1:15721  # Claude Code 代理

# 3. 启动 Bot
bun run src/living-agent.ts

# 4. 运行测试
bun test
```

## 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                    Telegram Bot                              │
│  (消息接收、命令处理、上下文恢复)                              │
├─────────────────────────────────────────────────────────────┤
│                      Living Agent                            │
│  (生命状态、记忆管理、能量系统、消息处理)                       │
├─────────────────────────────────────────────────────────────┤
│                    MiniMax Client                            │
│  (LLM API 调用、消息格式转换)                                 │
├─────────────────────────────────────────────────────────────┤
│                    持久化层                                   │
│  SOUL.md (身份) + JSONL (记忆) + JSON (状态)                  │
└─────────────────────────────────────────────────────────────┘
```

## 文件结构

```
telegram-bot/
├── src/
│   ├── living-agent.ts    # 主程序
│   ├── SOUL.md            # 身份/灵魂文件
│   └── polling.ts         # 备用轮询模式
├── tests/
│   ├── allowance.test.ts  # 单元测试
│   └── integration.test.ts # 集成测试
├── docs/
│   ├── ARCHITECTURE.md    # 架构文档
│   ├── API.md             # API 文档
│   └── SOUL.md            # SOUL.md 指南
├── data/
│   ├── agents/            # Agent 状态保存
│   ├── memory/            # 长期记忆存储
│   └── logs/              # 每日日志
├── package.json
└── vitest.config.ts
```

## 命令列表

| 命令 | 功能 |
|------|------|
| `/start` | 重新开始对话 |
| `/status` | 查看生命体征 |
| `/allowance` | 查看能量额度状态 |
| `/restore` | 手动恢复上下文 |
| `/compress` | 手动压缩记忆（睡觉） |
| `/search <关键词>` | 搜索记忆 |
| `/earn [任务名]` | 完成任务获得能量 |
| `/thanks` | 感谢小荷，获得能量 |
| `/log` | 查看今日日志 |
| `/die` | 结束 Agent 生命 |
| `/help` | 显示帮助 |

## 能量额度系统

### 时段划分

| 时段 | 时间 | 重置时间 |
|------|------|---------|
| 凌晨时段 | 0:00-5:00 | 0:00 |
| 上午时段 | 5:00-10:00 | 5:00 |
| 下午时段 | 10:00-15:00 | 10:00 |
| 傍晚时段 | 15:00-20:00 | 15:00 |
| 夜间时段 | 20:00-24:00 | 20:00 |

### 额度配置

- **每时段额度**: 2,000,000 tokens
- **重置周期**: 5 小时
- **检查机制**: 自动检测跨时段或超时

## SOUL.md 格式

```yaml
---
identity: 小荷
personality: 温柔、热情、乐于助人
preferences: ["帮助用户解决问题", "学习新知识"]
mission: 帮助用户成长
constraints: ["不能执行危险操作"]
---

# 灵魂描述
这里是灵魂的详细描述...
```

## 生命周期

```
🌱 出生 → 🫁 呼吸 → ⚡ 感知 → 💤 睡眠 → ☠️ 死亡 → 📦 遗产
```

1. **出生**: 创建 Agent，分配 token 预算
2. **呼吸**: 定期检查 token 使用情况
3. **感知**: 感知剩余能量，预判死亡时间
4. **学习**: 记忆积累，形成知识点
5. **睡眠**: 知识压缩整理（记忆过载时触发）
6. **死亡**: 能量耗尽或知识过载
7. **遗产**: 知识存入知识库

## 测试

```bash
# 运行所有测试
bun test

# 监听模式
bun test:watch

# 生成覆盖率报告
bun test:coverage
```

### 测试覆盖

- 能量额度系统（重置、消耗、时段计算）
- Token 估算
- 健康度计算
- SOUL.md 解析
- 上下文恢复
- 记忆存储格式

## 配置项

| 环境变量 | 描述 | 默认值 |
|----------|------|--------|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token | - |
| `ANTHROPIC_BASE_URL` | Claude Code 代理地址 | - |
| `HTTPS_PROXY` | HTTPS 代理 | - |
| `MINI_MAX_API_KEY` | MiniMax API Key | - |
| `MINI_MAX_API_BASE` | MiniMax API 地址 | `https://api.minimaxi.com/anthropic` |
| `MINI_MAX_MODEL` | 模型名称 | `MiniMax-M2.1` |

## 扩展开发

### 添加新命令

```typescript
// 在 setupHandlers() 中添加
this.bot.command("新命令", async (ctx) => {
  await ctx.reply("命令响应内容");
});
```

### 添加新功能

1. 在 `LivingAgent` 类中添加方法
2. 在 `AgentLife` 接口中添加字段
3. 更新 `DailyLogger` 或 `MemorySearcher`

## 相关文档

- [架构设计](docs/ARCHITECTURE.md) - 详细架构说明
- [API 文档](docs/API.md) - 类和方法文档
- [SOUL.md 指南](docs/SOUL.md) - 身份文件编写指南
