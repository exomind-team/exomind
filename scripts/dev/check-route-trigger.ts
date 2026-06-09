#!/usr/bin/env bun

/**
 * check-route-trigger.ts — 检查是否需要重新生成开发航线
 *
 * 触发条件:
 *   1. 某批次的 issue 全部关闭 → 触发（批次完成）
 *   2. 单日新增 >5 个同领域 issue → 触发（需重新聚类）
 *   3. 上次航线超过 7 天 → 触发（过期）
 *
 * 用法:
 *   bun run route:check
 *
 * 输出:
 *   TRIGGER=true  reason=<原因>
 *   TRIGGER=false reason=<原因>
 */

import { execFileSync } from 'node:child_process';
import { readLatestDevlog, renderSourceBlock } from './extract-devlog';

// ── Types ──

type BatchIssue = {
  num: number;
  title: string;
  priority: string;
  done: boolean;
};

type Batch = {
  id: string;
  name: string;
  track: string;
  status: string;
  issues: BatchIssue[];
};

type QueryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

// ── Helpers ──

function gh(...args: string[]): string {
  return execFileSync('gh', args, { encoding: 'utf-8' }).trim();
}

function getOpenIssueNumbers(): QueryResult<Set<number>> {
  try {
    const result = gh(
      'issue', 'list',
      '--repo', 'exomind-team/exomind',
      '--state', 'open',
      '--limit', '500',
      '--json', 'number',
      '--jq', '.[].number'
    );
    return { ok: true, value: new Set(result.split('\n').filter(Boolean).map(Number)) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function getRecentIssues(sinceDays: number): QueryResult<{ number: number; labels: string[] }[]> {
  try {
    const since = new Date(Date.now() - sinceDays * 86400_000).toISOString().split('T')[0];
    const result = gh(
      'issue', 'list',
      '--repo', 'exomind-team/exomind',
      '--state', 'all',
      '--limit', '200',
      '--json', 'number,labels,createdAt',
      '--jq', `[.[] | select(.createdAt >= "${since}") | {number, labels: [.labels[].name]}]`
    );
    return { ok: true, value: JSON.parse(result || '[]') };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ── Main ──

async function main() {
  const reasons: string[] = [];
  const checkNotes: string[] = [];
  let checkTrust: 'high' | 'partial' = 'high';
  let trigger = false;
  let latestRouteDate: string | null = null;
  let batches: Batch[] = [];
  let sourceBlock = [
    '[devlog-source]',
    'requested: auto',
    'resolved: unavailable',
    'trust: low',
    'consistency: partial',
    'guarantee: 最新航线读取失败，无法确认主链来源',
    'fallbackUsed: no',
    '[/devlog-source]',
  ].join('\n');

  try {
    const latestRoute = await readLatestDevlog({ type: 'route', source: 'auto' });
    sourceBlock = renderSourceBlock(latestRoute.source);
    latestRouteDate = latestRoute.data?._published?.date ?? latestRoute.data?.meta?.date ?? null;
    batches = Array.isArray(latestRoute.data?.batches) ? latestRoute.data.batches : [];
    if (
      latestRoute.source.resolvedSource !== 'pages-json' ||
      latestRoute.source.trust !== 'high' ||
      latestRoute.source.consistency !== 'ok'
    ) {
      checkTrust = 'partial';
      checkNotes.push('最新航线读取未命中高可信 GitHub Pages JSON 主链，请勿视为最新线上权威结果');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sourceBlock = [
      '[devlog-source]',
      'requested: auto',
      'resolved: unavailable',
      'trust: low',
      'consistency: partial',
      'guarantee: 最新航线读取失败，无法确认主链来源',
      'fallbackUsed: no',
      `notes: ${message}`,
      '[/devlog-source]',
    ].join('\n');
    checkTrust = 'partial';
    checkNotes.push(`最新航线读取失败: ${message}`);
    reasons.push(`读取最新航线失败: ${message}`);
    trigger = true;
  }

  // Check 1: 过期检查（上次航线超过 7 天）
  if (!latestRouteDate) {
    trigger = true;
    reasons.push('无历史航线记录');
  } else {
    const latestDate = new Date(latestRouteDate);
    const daysSince = Math.floor((Date.now() - latestDate.getTime()) / 86400_000);

    if (daysSince >= 7) {
      trigger = true;
      reasons.push(`上次航线已过 ${daysSince} 天（阈值 7 天）`);
    }
  }

  // Check 2: 批次完成检查
  if (batches.length) {
    const openIssuesResult = getOpenIssueNumbers();

    if (!openIssuesResult.ok) {
      checkTrust = 'partial';
      checkNotes.push(`GitHub open issue 查询失败：${openIssuesResult.error}`);
    } else {
      const openIssues = openIssuesResult.value;
      for (const batch of batches) {
        if (batch.status === 'done') continue;
        if (batch.issues.length === 0) continue;

        const allClosed = batch.issues.every(issue => !openIssues.has(issue.num));
        if (allClosed) {
          trigger = true;
          reasons.push(`批次 ${batch.id}(${batch.name}) 的 ${batch.issues.length} 个 issue 全部关闭`);
        }
      }
    }
  }

  // Check 3: 单日新增 >5 个同领域 issue
  const recentIssuesResult = getRecentIssues(1);
  if (!recentIssuesResult.ok) {
    checkTrust = 'partial';
    checkNotes.push(`GitHub 近期 issue 查询失败：${recentIssuesResult.error}`);
  } else if (recentIssuesResult.value.length > 0) {
    const recentIssues = recentIssuesResult.value;
    // Group by label (domain)
    const labelCounts = new Map<string, number>();
    for (const issue of recentIssues) {
      for (const label of issue.labels) {
        labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
      }
    }
    for (const [label, count] of labelCounts) {
      if (count > 5) {
        trigger = true;
        reasons.push(`单日新增 ${count} 个 "${label}" 领域 issue（阈值 5）`);
      }
    }
  }

  // Output
  const reason = reasons.length ? reasons.join('; ') : '未触发任何条件';
  console.log(sourceBlock);
  console.log(`checkTrust=${checkTrust}`);
  console.log(`checkNotes=${checkNotes.length ? checkNotes.join('; ') : 'none'}`);
  console.log(`TRIGGER=${trigger}`);
  console.log(`reason=${reason}`);

  if (trigger) {
    console.log('\n建议重新生成开发航线。');
  } else {
    console.log('\n当前航线仍然有效。');
  }
}

main().catch(error => {
  console.error(`\n❌ 错误: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
