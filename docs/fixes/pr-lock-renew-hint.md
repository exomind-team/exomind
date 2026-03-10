# PR 锁续期提示功能

## 设计理念：轻量级提示，而非自动续期

### 类比：汽车油量警告灯

```
🚗 汽车油量警告灯的设计：
   ✅ 油量低于 1/4 时亮起警告灯
   ✅ 提醒驾驶员该加油了
   ✅ 不会自动加油
   ✅ 驾驶员决定何时加油

🔒 PR 锁续期提示的设计：
   ✅ 剩余时间不足一半时设置 should_renew: true
   ✅ 提供 renew_reason 说明原因
   ✅ 不会自动续期
   ✅ Agent 决定是否续期
```

---

## 功能演示

### 场景 1: 锁刚获取（剩余时间充足）

```bash
$ bun pr-lock.ts acquire 436 60 agent-a
{
  "success": true,
  "lock": {
    "lock_id": "lock-1773100000000-abc123",
    "agent_id": "agent-a",
    "acquired_at": "2026-03-10T00:00:00.000Z",
    "lock_duration_minutes": 60
  }
}

$ bun pr-lock.ts check 436
{
  "lock_id": "lock-1773100000000-abc123",
  "agent_id": "agent-a",
  "acquired_at": "2026-03-10T00:00:00.000Z",
  "lock_duration_minutes": 60,
  "expires_at": "2026-03-10T01:00:00.000Z",
  "remaining_minutes": 60,
  "is_expired": false,
  "should_renew": false          ← 不建议续期
}
```

**解释**：剩余 60 分钟 ≥ 锁时长 60 分钟的一半（30 分钟），不需要续期。

---

### 场景 2: 工作 35 分钟后（剩余时间不足一半）

```bash
# 35 分钟后...
$ bun pr-lock.ts check 436
{
  "lock_id": "lock-1773100000000-abc123",
  "agent_id": "agent-a",
  "acquired_at": "2026-03-10T00:00:00.000Z",
  "lock_duration_minutes": 60,
  "expires_at": "2026-03-10T01:00:00.000Z",
  "remaining_minutes": 25,
  "is_expired": false,
  "should_renew": true,          ← 建议续期！
  "renew_reason": "剩余 25 分钟（不足锁时长 60 分钟的一半），建议调用 renew() 续期"
}

⚠️  续期建议：
   剩余 25 分钟（不足锁时长 60 分钟的一半），建议调用 renew() 续期
   命令：bun pr-lock.ts renew 436 30 agent-a
```

**解释**：剩余 25 分钟 < 锁时长 60 分钟的一半（30 分钟），建议续期。

---

### 场景 3: Agent 根据提示续期

```bash
$ bun pr-lock.ts renew 436 30 agent-a
{
  "success": true,
  "lock": {
    "lock_id": "lock-1773100000000-abc123",
    "agent_id": "agent-a",
    "acquired_at": "2026-03-10T00:00:00.000Z",
    "lock_duration_minutes": 90          ← 60 + 30 = 90 分钟
  }
}

$ bun pr-lock.ts check 436
{
  "lock_id": "lock-1773100000000-abc123",
  "agent_id": "agent-a",
  "acquired_at": "2026-03-10T00:00:00.000Z",
  "lock_duration_minutes": 90,
  "expires_at": "2026-03-10T01:30:00.000Z",
  "remaining_minutes": 55,
  "is_expired": false,
  "should_renew": false          ← 续期后不再提示
}
```

**解释**：续期后，剩余 55 分钟 ≥ 锁时长 90 分钟的一半（45 分钟），不再提示。

---

## Agent 代码示例

### 简单轮询模式

```typescript
async function workWithLock(prNumber: number, agentId: string) {
  const lockManager = new PRLockManager('exomind-team/exomind', agentId);

  // 获取锁
  const acquireResult = await lockManager.acquire(prNumber, 60);
  if (!acquireResult.success) {
    console.error('获取锁失败:', acquireResult.error);
    return;
  }

  try {
    // 工作循环
    while (true) {
      // 检查锁状态
      const lock = await lockManager.checkLock(prNumber);

      if (!lock || lock.is_expired) {
        console.log('锁已过期，停止工作');
        break;
      }

      // 如果建议续期，自动续期
      if (lock.should_renew) {
        console.log('⚠️  续期提示:', lock.renew_reason);
        const renewResult = await lockManager.renew(prNumber, 30);
        if (renewResult.success) {
          console.log('✅ 续期成功');
        } else {
          console.error('❌ 续期失败:', renewResult.error);
        }
      }

      // 执行工作
      await doSomeWork();

      // 等待 5 分钟
      await sleep(5 * 60 * 1000);
    }
  } finally {
    // 释放锁
    await lockManager.release(prNumber);
  }
}
```

---

## 时间线演示

### 60 分钟锁的生命周期

```
时间轴 ────────────────────────────────────────────────────────────>
       0min    10min   20min   30min   40min   50min   60min

获取锁: [●]
        60min

检查:         [check]       [check]       [check]       [check]
              ↓             ↓             ↓             ↓
剩余:         50min         40min         30min         20min
              ↓             ↓             ↓             ↓
提示:         ✅ 否         ✅ 否         ⚠️ 是         ⚠️ 是
              (≥30min)      (≥30min)      (<30min)      (<30min)

续期:                                   [renew +30]
                                        ↓
新时长:                                 90min
                                        ↓
新剩余:                                 60min
                                        ↓
提示:                                   ✅ 否
                                        (≥45min)
```

---

## 优势分析

### ✅ 保持 checkLock() 纯净

```typescript
// checkLock() 仍然是只读操作
const lock = await lockManager.checkLock(prNumber);

// 不会修改任何状态
// 不会触发续期
// 不会产生副作用

// 只是在返回值中增加了信息
if (lock.should_renew) {
  console.log('建议续期:', lock.renew_reason);
}
```

### ✅ 决策权在调用者

```typescript
// Agent 可以选择忽略提示
const lock = await lockManager.checkLock(prNumber);
// 不续期，继续工作

// Agent 可以选择接受提示
if (lock.should_renew) {
  await lockManager.renew(prNumber, 30);
}

// Agent 可以自定义续期策略
if (lock.should_renew && lock.remaining_minutes < 10) {
  await lockManager.renew(prNumber, 60);  // 续期更长时间
}
```

### ✅ 零侵入性

```typescript
// 现有代码不受影响
const lock = await lockManager.checkLock(prNumber);
console.log('剩余时间:', lock.remaining_minutes);

// 新增字段是可选的
if (lock.should_renew) {
  // 处理续期提示
}
```

### ✅ 易于测试

```typescript
test('should suggest renew when remaining < half', async () => {
  const lock = await lockManager.checkLock(prNumber);

  // 明确的断言
  expect(lock.should_renew).toBe(true);
  expect(lock.renew_reason).toContain('不足锁时长');
});
```

---

## 对比其他方案

| 方案 | checkLock() 内置自动续期 | checkAndRenew() | 续期提示（当前） |
|------|------------------------|----------------|----------------|
| **便利性** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **语义清晰** | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **可测试性** | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **安全性** | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **轻量级** | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **零侵入** | ⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |

---

## 总结

续期提示方案完美平衡了：

1. **便利性**：Agent 不需要手动计算剩余时间
2. **纯净性**：checkLock() 保持只读，不修改状态
3. **灵活性**：Agent 可以自定义续期策略
4. **安全性**：不会导致无限续期
5. **轻量级**：只增加两个字段，零侵入

就像汽车的油量警告灯：**提醒你该加油了，但不会自动加油**。
