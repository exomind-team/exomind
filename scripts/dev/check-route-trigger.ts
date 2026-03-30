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
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ── Types ──

type ManifestEntry = {
  date: string;
  time: string;
  title: string;
  file: string;
  publisher?: string;
  status?: { level: string; emoji: string; label: string };
  metrics?: { label: string; value: string; note: string }[];
};

type Manifest = {
  generated: string;
  repo: string;
  routes: ManifestEntry[];
};

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

// ── Helpers ──

function gh(...args: string[]): string {
  return execFileSync('gh', args, { encoding: 'utf-8' }).trim();
}

function getDevlogDir(): string {
  return resolve(join(import.meta.dir, '..', '..', '..', 'exomind-devlog'));
}

function loadManifest(): Manifest | null {
  const manifestPath = join(getDevlogDir(), 'routes', 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch {
    return null;
  }
}

function loadLatestRouteData(): string | null {
  const manifest = loadManifest();
  if (!manifest || !manifest.routes.length) return null;

  const latest = manifest.routes[0];
  const routePath = join(getDevlogDir(), 'routes', latest.file);
  if (!existsSync(routePath)) return null;

  return readFileSync(routePath, 'utf-8');
}

function extractBatches(html: string): Batch[] {
  // Extract the ROUTE data block and parse batches
  const startMarker = 'const ROUTE = {';
  const startIdx = html.indexOf(startMarker);
  if (startIdx === -1) return [];

  // Find batches array
  const batchesStart = html.indexOf('batches:', startIdx);
  if (batchesStart === -1) return [];

  // Simple extraction: find issue numbers from batches
  const batches: Batch[] = [];
  const batchPattern = /\{\s*id:\s*'([^']*)'\s*,\s*name:\s*'([^']*)'\s*,\s*track:\s*'([^']*)'\s*,\s*status:\s*'([^']*)'/g;
  let match;

  while ((match = batchPattern.exec(html)) !== null) {
    const batchId = match[1];
    const batchName = match[2];
    const track = match[3];
    const status = match[4];

    // Extract issues for this batch
    const batchStart = match.index;
    const issuesStart = html.indexOf('issues:', batchStart);
    if (issuesStart === -1) continue;

    const issuesEnd = html.indexOf('],', issuesStart);
    if (issuesEnd === -1) continue;

    const issuesBlock = html.substring(issuesStart, issuesEnd);
    const issuePattern = /num:\s*(\d+)/g;
    const issues: BatchIssue[] = [];
    let im;
    while ((im = issuePattern.exec(issuesBlock)) !== null) {
      issues.push({ num: parseInt(im[1]), title: '', priority: 'P1', done: false });
    }

    batches.push({ id: batchId, name: batchName, track, status, issues });
  }

  return batches;
}

function getOpenIssueNumbers(): Set<number> {
  try {
    const result = gh(
      'issue', 'list',
      '--repo', 'exomind-team/exomind',
      '--state', 'open',
      '--limit', '500',
      '--json', 'number',
      '--jq', '.[].number'
    );
    return new Set(result.split('\n').filter(Boolean).map(Number));
  } catch {
    console.error('⚠️ 无法获取 open issues，跳过状态检查');
    return new Set();
  }
}

function getRecentIssues(sinceDays: number): { number: number; labels: string[] }[] {
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
    return JSON.parse(result || '[]');
  } catch {
    return [];
  }
}

// ── Main ──

function main() {
  const manifest = loadManifest();
  const reasons: string[] = [];
  let trigger = false;

  // Check 1: 过期检查（上次航线超过 7 天）
  if (!manifest || !manifest.routes.length) {
    trigger = true;
    reasons.push('无历史航线记录');
  } else {
    const latest = manifest.routes[0];
    const latestDate = new Date(latest.date);
    const daysSince = Math.floor((Date.now() - latestDate.getTime()) / 86400_000);

    if (daysSince >= 7) {
      trigger = true;
      reasons.push(`上次航线已过 ${daysSince} 天（阈值 7 天）`);
    }
  }

  // Check 2: 批次完成检查
  const routeHtml = loadLatestRouteData();
  if (routeHtml) {
    const batches = extractBatches(routeHtml);
    const openIssues = getOpenIssueNumbers();

    for (const batch of batches) {
      if (batch.status === 'done') continue; // Already marked done
      if (batch.issues.length === 0) continue;

      const allClosed = batch.issues.every(i => !openIssues.has(i.num));
      if (allClosed) {
        trigger = true;
        reasons.push(`批次 ${batch.id}(${batch.name}) 的 ${batch.issues.length} 个 issue 全部关闭`);
      }
    }
  }

  // Check 3: 单日新增 >5 个同领域 issue
  const recentIssues = getRecentIssues(1);
  if (recentIssues.length > 0) {
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
  console.log(`TRIGGER=${trigger}`);
  console.log(`reason=${reason}`);

  if (trigger) {
    console.log('\n建议重新生成开发航线。');
  } else {
    console.log('\n当前航线仍然有效。');
  }
}

main();
