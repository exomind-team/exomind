# 开发流程规范

> **版本**: v1.0
> **创建时间**: 2026-01-29
> **最后更新**: 2026-01-29

---

## 1. 标准化开发流程（10 步）

```
┌─────────────────────────────────────────────────────────────────────┐
│                     标准化开发流程 (10 步)                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1️⃣  SPEC文档  →  2️⃣ 架构设计  →  3️⃣ 代码编写  →  4️⃣ 单元测试     │
│      (功能定义)      (技术选型)      (实现)          (测试覆盖)       │
│                                                                     │
│  5️⃣  文档       →  6️⃣ 集成测试  →  7️⃣ 更新文档  →  8️⃣ 项目日志     │
│      (API注释)       (端到端)        (README)        (变更记录)       │
│                                                                     │
│                                         →  9️⃣ GIT COMMIT  → 10️⃣ 运行   │
│                                              (版本控制)    (验证)      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. STEP 1: 功能定义 SPEC 文档

### 2.1 模板位置
`docs/specs/TEMPLATE.md`

### 2.2 模板内容

```markdown
## 功能名称

### 1. 用户需求
- 描述用户想要什么
- 为什么需要这个功能

### 2. 输入
| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| xxx  | xxx  | 是/否 | xxx  |

### 3. 输出
| 参数 | 类型 | 描述 |
|------|------|------|
| xxx  | xxx  | xxx  |

### 4. 验收标准
- [ ] 标准1
- [ ] 标准2

### 5. 边界条件
- 条件1
- 条件2
```

### 2.3 示例

```markdown
## /ALLOWANCE 命令

### 1. 用户需求
用户想查看当前能量额度状态，包括：
- 当前时段剩余额度
- 已使用额度
- 下次重置时间

### 2. 输入
| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| 无 | - | - | /ALLOWANCE 无参数 |

### 3. 输出
格式化文本消息，包含：
- 当前时段名称
- 剩余/已使用/总额度
- 使用百分比
- 下次重置时间

### 4. 验收标准
- [ ] 显示当前时段
- [ ] 显示剩余额度
- [ ] 显示使用百分比
- [ ] 显示下次重置时间

### 5. 边界条件
- 刚重置后（剩余 = 总额度）
- 快过期时（剩余 < 10%）
- 跨时段边界
```

---

## 3. STEP 2: 架构设计

### 3.1 包含内容

1. **类/模块设计**
   - 新增类和方法
   - 修改的现有类
   - 接口定义

2. **数据流**
   - 输入 → 处理 → 输出
   - 状态变化

3. **依赖关系**
   - 新增依赖
   - 修改的依赖

### 3.2 模板

```markdown
## 架构设计

### 类设计

```typescript
class ClassName {
  // 属性
  prop1: Type;
  prop2: Type;

  // 方法
  method1(): ReturnType;
  method2(param: Type): ReturnType;
}
```

### 数据流

```
输入 → [处理] → 输出
```

### 依赖关系

- 依赖模块A（原因）
- 依赖模块B（原因）
```

---

## 4. STEP 3: 代码编写

### 4.1 规范

1. **类型安全**
   - 明确类型定义
   - 无 `ANY` 类型

2. **错误处理**
   - TRY-CATCH 包裹
   - 友好的错误信息

3. **日志记录**
   - 关键操作日志
   - 调试信息

4. **注释**
   - 复杂逻辑注释
   - API 方法注释（JSDOC）

### 4.2 示例

```typescript
/**
 * 获取能量额度状态
 * @returns 格式化后的额度状态字符串
 */
GETALLOWANCESTATUS(): STRING {
  CONST PERIOD = THIS.GETCURRENTPERIOD();
  CONST REMAINING = THIS.LIFE.DAILYALLOWANCE - THIS.LIFE.USEDALLOWANCE;
  CONST PERCENTAGE = (THIS.LIFE.USEDALLOWANCE / THIS.LIFE.DAILYALLOWANCE * 100).TOFIXED(1);

  RETURN `...`;
}
```

---

## 5. STEP 4: 单元测试

### 5.1 规范

1. **测试框架**: VITEST
2. **覆盖要求**: 核心逻辑 100%
3. **测试原则**
   - 每个功能点至少一个测试
   - 边界条件测试
   - 异常情况测试

### 5.2 模板

```typescript
DESCRIBE("功能名称", () => {
  DESCRIBE("正常情况", () => {
    IT("应该正确处理输入", () => {
      // ARRANGE
      CONST INPUT = XXX;

      // ACT
      CONST RESULT = XXX;

      // ASSERT
      EXPECT(RESULT).TOBE(XXX);
    });
  });

  DESCRIBE("边界情况", () => {
    IT("边界值应该正确处理", () => {
      // ...
    });
  });
});
```

---

## 6. STEP 5: API 文档

### 6.1 规范

1. **JSDOC 注释**
   - 类注释
   - 方法注释（参数、返回值）
   - 复杂逻辑注释

2. **更新 docs/API.md**
   - 新增 API 说明
   - 更新类型定义

### 6.2 模板

````markdown
### 方法名

**功能描述**

**参数:**
- `PARAM` - 参数描述

**返回:**
- 返回值描述

**示例:**
```typescript
CONST RESULT = AGENT.METHOD(PARAM);
```
````

---

## 7. STEP 6: 集成测试

### 7.1 规范

1. **测试场景**
   - 端到端流程
   - 多模块协作
   - 真实数据

2. **MOCK 策略**
   - 外部依赖 MOCK
   - 文件系统 MOCK（VI.MOCK）

---

## 8. STEP 7: 更新项目文档

### 8.1 更新文件

1. **README.MD**
   - 新增命令/功能说明
   - 更新快速开始

2. **ARCHITECTURE.MD**
   - 新增架构设计
   - 更新状态流转

3. **docs/SOUL.md**（如需要）

---

## 9. STEP 8: 项目日志

### 9.1 模板

```markdown
## [时间] [类型] 功能名称

> 简要描述

### 核心变更
- 变更点1
- 变更点2

### 文件变更
| 文件 | 操作 | 说明 |
|------|------|------|
| XXX | 新增/修改 | XXX |

### 测试结果
- 单元测试: XX/XX 通过
- 集成测试: XX/XX 通过
```

---

## 10. STEP 9: GIT COMMIT

### 10.1 规范

1. **提交信息格式**
   ```
   <TYPE>: <SUBJECT>

   <BODY>
   ```

2. **TYPE 类型**
   - `feat`: 新功能
   - `fix`: BUG 修复
   - `docs`: 文档
   - `test`: 测试
   - `refactor`: 重构

### 10.2 示例

```
feat: 实现能量额度系统

- 添加5小时重置机制
- 每日额度2000K TOKENS
- 新增/ALLOWANCE命令

CLOSES: #XXX
```

### 10.3 修改即提交原则

**每次修改文件后立即提交 Git commit**

| 原则 | 说明 |
|------|------|
| **触发时机** | 任何文件修改后立即提交 |
| **提交粒度** | 按文件/功能，小步提交 |
| **提交信息** | `[类型]: [简短描述] [修改文件]` |
| **分支** | 在 feature 分支上提交，不影响主分支 |

**示例**：
```bash
# 修改一个文件后
git add pm/memory.md
git commit -m "docs: 添加修改即提交原则 [pm/memory.md]"

# 修改多个相关文件
git add pm/memory.md pm/agent.md
git commit -m "docs: 记录工作流程原则 [pm/memory.md, pm/agent.md]"
```

**为什么？**
1. Git 成为 Agent 的完整历史
2. 每次变更可追溯、可回滚
3. 便于 code review 和审计
4. 小的提交更容易理解和调试

---

## 11. STEP 10: 运行验证

### 11.1 检查清单

- [ ] 所有单元测试通过
- [ ] 所有集成测试通过
- [ ] 类型检查通过
- [ ] 手动测试验证（如需要）
- [ ] 文档已更新

### 11.2 运行命令

```bash
# 类型检查
BUN RUN BUILD

# 运行测试
BUN TEST

# 运行测试（监听模式）
BUN TEST:WATCH
```

---

## 12. 快速参考

| 步骤 | 命令/操作 | 输出 |
|------|----------|------|
| 1. SPEC | 编写 SPEC 文档 | `docs/specs/XXX.md` |
| 2. 架构 | 更新 ARCHITECTURE.MD | 架构设计文档 |
| 3. 代码 | 编辑源文件 | `src/XXX.ts` |
| 4. 单元测试 | 编辑测试文件 | `tests/XXX.test.ts` |
| 5. API 文档 | JSDOC + API.MD | 文档更新 |
| 6. 集成测试 | 编辑集成测试 | `tests/XXX.integration.test.ts` |
| 7. 项目文档 | 更新 README.MD | 文档更新 |
| 8. 项目日志 | 编辑 `pm/memory/` | 日志更新 |
| 9. GIT COMMIT | `git add` + `commit` | 版本提交 |
| 10. 运行 | `bun test` + `bun run build` | 验证通过 |

---

## 13. 网络代理配置

### 13.1 Telegram Bot 代理

由于国内网络无法直接访问 Telegram API，需要配置代理：

```bash
# 启动命令
export TELEGRAM_BOT_TOKEN="你的bot token"
export TELEGRAM_PROXY="http://127.0.0.1:7890"
bun run src/living-agent.ts
```

**代理配置：**
- 端口: `7890`
- 环境变量: `TELEGRAM_PROXY`
- 代码位置: `src/living-agent.ts` 构造函数 (约1440行)

### 13.2 MiniMax API 代理

通过 Claude Code MCP 代理访问，无需额外配置。

---

## 14. 自动重连机制

### 14.1 问题

国内网络访问 Telegram API 不稳定，`ECONNRESET` 错误频繁。

### 14.2 实现方案

```typescript
// 自动重连配置
let reconnectAttempts = 0;
const maxReconnectAttempts = 10;
const baseReconnectDelay = 1000;

// 进程重启式重连
const restartBot = () => {
  reconnectAttempts++;
  const delay = Math.min(baseReconnectDelay * Math.pow(2, reconnectAttempts - 1), 30000);
  console.log(`🔄 ${delay/1000}秒后自动重连... (第${reconnectAttempts}次)`);

  setTimeout(() => {
    execSync("nohup bun run src/living-agent.ts > /tmp/bot.log 2>&1 &");
    process.exit(0);
  }, delay);
};

// 监听 API 错误
this.bot.api.config.use(async (prev, method, payload, signal) => {
  try {
    return await prev(method, payload, signal);
  } catch (err) {
    if (method !== "getMe") restartBot();
    throw err;
  }
});
```

### 14.3 重连策略

| 参数 | 值 | 说明 |
|------|-----|------|
| 初始延迟 | 1秒 | 快速重试 |
| 最大延迟 | 30秒 | 避免过长等待 |
| 最大次数 | 10次 | 防止无限重试 |
| 退避策略 | 指数退避 | 2^n 秒递增 |

---

## 15. 项目启动检查清单

- [ ] Telegram 代理已启动 (端口 7890)
- [ ] 环境变量已设置 (TELEGRAM_BOT_TOKEN, TELEGRAM_PROXY)
- [ ] 代码无编译错误
- [ ] Bot 能正常接收/发送消息

---

## 16. 对话风格指南

### 16.1 核心原则

1. **简短自然** - 像朋友聊天一样，不要长篇大论
2. **不用 Markdown** - 日常对话不使用标题、列表等格式
3. **可用颜文字** - 😊 👀 🌸 💕 等
4. **一行或两行** - 除非必要，否则不超过3行

### 16.2 示例

**❌ 错误**（太长、有Markdown）：
```markdown
# 🌸 你好呀！我是小荷 🌸

很高兴见到你！我是你的生命助手...

## ✨ 我可以帮你：
- 💬 回答各种问题
- 📚 学习新知识、探讨话题
```

**✅ 正确**（简短、自然）：
```
好的呀，收到！😊

就这么聊天，舒服！

你有啥想聊的？👀
```

### 16.3 何时用 Markdown

- `/help` 命令的帮助信息
- `/status` 状态展示
- `/allowance` 额度展示
- 正式的功能说明

### 16.4 何时不用

- 日常问候
- 闲聊
- 简单回复

---

## 17. 常用命令

```bash
见 scripts/ 的脚本
```

---

## 18. 相关文档


