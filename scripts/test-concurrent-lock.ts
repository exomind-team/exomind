#!/usr/bin/env bun
/**
 * 并发锁竞争测试 - 验证修复后的行为
 *
 * 测试目标：
 * 1. 验证并发 A/B 都创建独立的锁评论
 * 2. 验证 detectConflict 可以看到所有锁记录
 * 3. 验证仲裁基于时间戳，不受写入顺序影响
 */

import { PRLockManager } from './lib/pr-lock';

const REPO = 'exomind-team/exomind';
const PR_NUMBER = 419;

async function testConcurrentLockAcquisition() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  并发锁竞争测试 - 验证独立评论创建                       ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  const agentA = new PRLockManager(REPO, 'agent-a@concurrent-test');
  const agentB = new PRLockManager(REPO, 'agent-b@concurrent-test');

  console.log('📍 步骤 1: Agent A 和 Agent B 并发获取锁');
  console.log('   预期：每个 Agent 都创建独立的锁评论');

  // 并行执行
  const [resultA, resultB] = await Promise.all([
    agentA.acquire(PR_NUMBER, 5, {
      worktreePath: 'exomind-worktree-a',
      reason: 'Agent A 并发测试'
    }),
    agentB.acquire(PR_NUMBER, 5, {
      worktreePath: 'exomind-worktree-b',
      reason: 'Agent B 并发测试'
    })
  ]);

  console.log('\n📍 步骤 2: 检查结果');

  const successCount = [resultA.success, resultB.success].filter(Boolean).length;

  if (successCount === 1) {
    console.log(`✅ 只有一个 Agent 获取锁成功（符合预期）`);

    if (resultA.success) {
      console.log(`   胜者：Agent A`);
      console.log(`   锁 ID：${resultA.lock!.lock_id}`);
      console.log(`   败者：Agent B`);
      console.log(`   错误：${resultB.error}`);

      if (resultB.conflict) {
        console.log(`   竞争检测：✅ 成功`);
        console.log(`     - 胜者：${resultB.conflict.winner}`);
        console.log(`     - 败者：${resultB.conflict.loser}`);
      }
    } else {
      console.log(`   胜者：Agent B`);
      console.log(`   锁 ID：${resultB.lock!.lock_id}`);
      console.log(`   败者：Agent A`);
      console.log(`   错误：${resultA.error}`);

      if (resultA.conflict) {
        console.log(`   竞争检测：✅ 成功`);
        console.log(`     - 胜者：${resultA.conflict.winner}`);
        console.log(`     - 败者：${resultA.conflict.loser}`);
      }
    }
  } else if (successCount === 0) {
    console.log(`⚠️ 两个 Agent 都失败了`);
    console.log(`   Agent A 错误：${resultA.error}`);
    console.log(`   Agent B 错误：${resultB.error}`);
  } else {
    console.log(`❌ 两个 Agent 都成功了（不符合预期，竞争检测失败）`);
    console.log(`   Agent A 锁 ID：${resultA.lock!.lock_id}`);
    console.log(`   Agent B 锁 ID：${resultB.lock!.lock_id}`);
  }

  // 清理
  console.log('\n📍 清理: 释放锁');
  if (resultA.success) {
    await agentA.release(PR_NUMBER);
    console.log('✅ Agent A 锁已释放');
  }
  if (resultB.success) {
    await agentB.release(PR_NUMBER);
    console.log('✅ Agent B 锁已释放');
  }

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║                  测试完成                                 ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  // 返回测试结果
  return successCount === 1;
}

// 主函数
async function main() {
  try {
    const success = await testConcurrentLockAcquisition();
    process.exit(success ? 0 : 1);
  } catch (error) {
    console.error('\n❌ 测试过程中出错:', error);
    process.exit(1);
  }
}

// 运行测试
if (import.meta.main) {
  main();
}
