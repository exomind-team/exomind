# 开发流程规范

> 每次功能开发必须遵循的标准流程

## 流程概览

```
┌─────────────────────────────────────────────────────────────────────┐
│                     标准化开发流程 (10 步)                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1️⃣  Spec文档  →  2️⃣ 架构设计  →  3️⃣ 代码编写  →  4️⃣ 单元测试     │
│      (功能定义)      (技术选型)      (实现)          (测试覆盖)       │
│                                                                     │
│  5️⃣  文档       →  6️⃣ 集成测试  →  7️⃣ 更新文档  →  8️⃣ 项目日志     │
│      (API注释)       (端到端)        (README)        (变更记录)       │
│                                                                     │
│                                         →  9️⃣ Git Commit  → 10️⃣ 运行   │
│                                              (版本控制)    (验证)      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Step 1: 功能定义 Spec 文档

### 模板

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

### 示例

```markdown
## /allowance 命令

### 1. 用户需求
用户想查看当前能量额度状态，包括：
- 当前时段剩余额度
- 已使用额度
- 下次重置时间

### 2. 输入
| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| 无 | - | - | /allowance 无参数 |

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

## Step 2: 架构设计

### 包含内容

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

### 模板

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

## Step 3: 代码编写

### 规范

1. **类型安全**
   - 明确类型定义
   - 无 `any` 类型

2. **错误处理**
   - try-catch 包裹
   - 友好的错误信息

3. **日志记录**
   - 关键操作日志
   - 调试信息

4. **注释**
   - 复杂逻辑注释
   - API 方法注释（JSDoc）

### 示例

```typescript
/**
 * 获取能量额度状态
 * @returns 格式化后的额度状态字符串
 */
getAllowanceStatus(): string {
  const period = this.getCurrentPeriod();
  const remaining = this.life.dailyAllowance - this.life.usedAllowance;
  const percentage = (this.life.usedAllowance / this.life.dailyAllowance * 100).toFixed(1);

  return `...`;
}
```

---

## Step 4: 单元测试

### 规范

1. **测试框架**: Vitest
2. **覆盖要求**: 核心逻辑 100%
3. **测试原则**
   - 每个功能点至少一个测试
   - 边界条件测试
   - 异常情况测试

### 模板

```typescript
describe("功能名称", () => {
  describe("正常情况", () => {
    it("应该正确处理输入", () => {
      // Arrange
      const input = xxx;

      // Act
      const result = xxx;

      // Assert
      expect(result).toBe(xxx);
    });
  });

  describe("边界情况", () => {
    it("边界值应该正确处理", () => {
      // ...
    });
  });
});
```

---

## Step 5: API 文档

### 规范

1. **JSDoc 注释**
   - 类注释
   - 方法注释（参数、返回值）
   - 复杂逻辑注释

2. **更新 docs/API.md**
   - 新增 API 说明
   - 更新类型定义

### 模板

```markdown
### 方法名

**功能描述**

**参数:**
- `param` - 参数描述

**返回:**
- 返回值描述

**示例:**
```typescript
const result = agent.method(param);
```
```

---

## Step 6: 集成测试

### 规范

1. **测试场景**
   - 端到端流程
   - 多模块协作
   - 真实数据

2. **Mock 策略**
   - 外部依赖 Mock
   - 文件系统 Mock（vi.mock）

---

## Step 7: 更新项目文档

### 更新文件

1. **README.md**
   - 新增命令/功能说明
   - 更新快速开始

2. **ARCHITECTURE.md**
   - 新增架构设计
   - 更新状态流转

3. **docs/SOUL.md**（如需要）

---

## Step 8: 项目日志

### 模板

```markdown
## [时间] [类型] 功能名称

> 简要描述

### 核心变更
- 变更点1
- 变更点2

### 文件变更
| 文件 | 操作 | 说明 |
|------|------|------|
| xxx | 新增/修改 | xxx |

### 测试结果
- 单元测试: xx/xx 通过
- 集成测试: xx/xx 通过
```

---

## Step 9: Git Commit

### 规范

1. **提交信息格式**
   ```
   <type>: <subject>

   <body>
   ```

2. **Type 类型**
   - `feat`: 新功能
   - `fix`: Bug 修复
   - `docs`: 文档
   - `test`: 测试
   - `refactor`: 重构

### 示例

```
feat: 实现能量额度系统

- 添加5小时重置机制
- 每日额度2000K tokens
- 新增/allowance命令

Closes: #xxx
```

---

## Step 10: 运行验证

### 检查清单

- [ ] 所有单元测试通过
- [ ] 所有集成测试通过
- [ ] 类型检查通过
- [ ] 手动测试验证（如需要）
- [ ] 文档已更新

### 运行命令

```bash
# 类型检查
bun run build

# 运行测试
bun test

# 运行测试（监听模式）
bun test:watch
```

---

## 快速参考

| 步骤 | 命令/操作 | 输出 |
|------|----------|------|
| 1. Spec | 编写 spec 文档 | docs/specs/xxx.md |
| 2. 架构 | 更新 ARCHITECTURE.md | 架构设计文档 |
| 3. 代码 | 编辑源文件 | src/xxx.ts |
| 4. 单元测试 | 编辑测试文件 | tests/xxx.test.ts |
| 5. API 文档 | JSDoc + API.md | 文档更新 |
| 6. 集成测试 | 编辑集成测试 | tests/xxx.integration.test.ts |
| 7. 项目文档 | 更新 README.md | 文档更新 |
| 8. 项目日志 | 编辑 data/logs/ | 日志更新 |
| 9. Git Commit | git add + commit | 版本提交 |
| 10. 运行 | bun test + build | 验证通过 |

---

## Telegram 代理配置

### 环境变量

```bash
export TELEGRAM_BOT_TOKEN="your_token"
export TELEGRAM_PROXY="http://127.0.0.1:7890"
bun run src/living-agent.ts
```

### 代码配置（src/living-agent.ts）

```typescript
const telegramProxy = process.env.TELEGRAM_PROXY || process.env.HTTPS_PROXY;
if (telegramProxy) {
  const proxyAgent = new HttpsProxyAgent(telegramProxy);
  this.bot = new Bot(token, {
    Client: {
      apiRoot: "https://api.telegram.org",
      baseFetch: (url: string, options: RequestInit) => {
        return fetch(url, {
          ...options,
          agent: proxyAgent,
          compress: false,
        });
      },
    },
  });
}
```

### 命令注册容错

```typescript
try {
  await this.bot.api.setMyCommands(commands);
  console.log(`📋 已注册 ${commands.length} 个命令`);
} catch (cmdErr) {
  console.warn(`⚠️ 命令注册失败（代理问题），Bot 仍可正常运行`);
}
```

---

## 文件模板

### Spec 模板位置
`docs/specs/TEMPLATE.md`

### 提交信息模板
```
<type>: <subject>

- 变更点1
- 变更点2

影响范围: xxx
测试结果: xx/xx
```
