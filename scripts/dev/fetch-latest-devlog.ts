#!/usr/bin/env bun

/**
 * fetch-latest-devlog.ts — 获取最新开发日报数据的辅助脚本
 *
 * 用法:
 *   bun run scripts/dev/fetch-latest-devlog.ts                # 获取最新日报（简要摘要）
 *   bun run scripts/dev/fetch-latest-devlog.ts --full         # 完整 JSON
 *   bun run scripts/dev/fetch-latest-devlog.ts --summary      # 简要摘要
 *   bun run scripts/dev/fetch-latest-devlog.ts --headlines    # 只显示头条
 *   bun run scripts/dev/fetch-latest-devlog.ts --actions      # 只显示建议行动
 *   bun run scripts/dev/fetch-latest-devlog.ts --local        # 强制使用本地数据
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const GITHUB_RAW_URL = 'https://raw.githubusercontent.com/exomind-team/exomind-devlog/main/reports/latest.json';
const LOCAL_PATH = resolve(join(import.meta.dir, '..', '..', '..', 'exomind-devlog', 'reports', 'latest.json'));

type ReportData = {
  schema: string;
  version: string;
  generated: string;
  meta: {
    title: string;
    date: string;
    coverage: string;
    baseline: string;
    repo: string;
  };
  weather: {
    level: string;
    emoji: string;
    label: string;
    ups: string[];
    downs: string[];
    actions: string[];
  };
  metrics: Array<{
    label: string;
    value: string;
    delta: string;
    trend: string;
    note?: string;
  }>;
  headlines: Array<{
    title: string;
    body: string;
  }>;
  [key: string]: any;
};

// ── Fetch Data ──

async function fetchData(useLocal: boolean = false): Promise<ReportData> {
  // 1. Try local first if requested or GitHub fails
  if (useLocal || !process.env.CI) {
    if (existsSync(LOCAL_PATH)) {
      console.error('[Fetch] 使用本地数据:', LOCAL_PATH);
      const data = JSON.parse(readFileSync(LOCAL_PATH, 'utf-8'));
      return data;
    }
  }

  // 2. Fetch from GitHub
  try {
    console.error('[Fetch] 从 GitHub 获取:', GITHUB_RAW_URL);
    const res = await fetch(GITHUB_RAW_URL, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data;
  } catch (e: any) {
    console.error('[Fetch] GitHub 获取失败:', e.message);

    // Fallback to local
    if (existsSync(LOCAL_PATH)) {
      console.error('[Fetch] 降级到本地数据');
      const data = JSON.parse(readFileSync(LOCAL_PATH, 'utf-8'));
      return data;
    }

    throw new Error('无法获取数据（GitHub 失败且本地不存在）');
  }
}

// ── Formatters ──

function formatSummary(data: ReportData): string {
  const lines = [
    `📅 ${data.meta.date} ${data.meta.title}`,
    `🌤️ ${data.weather.emoji} ${data.weather.label}`,
    `📊 ${data.metrics.map(m => `${m.label}: ${m.value} (${m.delta})`).join(' | ')}`,
    '',
    '📰 头条:',
    ...data.headlines.slice(0, 3).map(h => `  · ${h.title}`),
    '',
    '🎯 建议行动:',
    ...data.weather.actions.slice(0, 3).map(a => `  · ${a}`),
  ];
  return lines.join('\n');
}

function formatHeadlines(data: ReportData): string {
  const lines = [
    `📰 ${data.meta.date} ${data.meta.title} — 头条`,
    '',
    ...data.headlines.map((h, i) => `${i + 1}. ${h.title}\n   ${h.body}`),
  ];
  return lines.join('\n');
}

function formatActions(data: ReportData): string {
  const lines = [
    `🎯 ${data.meta.date} ${data.meta.title} — 建议行动`,
    '',
    ...data.weather.actions.map((a, i) => `${i + 1}. ${a}`),
  ];
  return lines.join('\n');
}

// ── Main ──

async function main() {
  const args = process.argv.slice(2);
  const mode = args.find(a => a.startsWith('--'))?.substring(2) || 'summary';
  const useLocal = args.includes('--local');

  try {
    const data = await fetchData(useLocal);

    // Validate schema
    if (data.schema !== 'exomind-devlog-report') {
      throw new Error(`数据格式错误: schema=${data.schema}`);
    }

    // Output based on mode
    switch (mode) {
      case 'full':
        console.log(JSON.stringify(data, null, 2));
        break;
      case 'summary':
        console.log(formatSummary(data));
        break;
      case 'headlines':
        console.log(formatHeadlines(data));
        break;
      case 'actions':
        console.log(formatActions(data));
        break;
      default:
        console.log(formatSummary(data));
    }
  } catch (e: any) {
    console.error(`\n❌ 错误: ${e.message}`);
    process.exit(1);
  }
}

main();
