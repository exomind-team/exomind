#!/usr/bin/env bun

/**
 * fetch-latest-devlog.ts — 对统一读取器的日报薄包装
 *
 * 用法:
 *   bun scripts/dev/fetch-latest-devlog.ts
 *   bun scripts/dev/fetch-latest-devlog.ts --summary
 *   bun scripts/dev/fetch-latest-devlog.ts --headlines
 *   bun scripts/dev/fetch-latest-devlog.ts --actions
 *   bun scripts/dev/fetch-latest-devlog.ts --full
 *   bun scripts/dev/fetch-latest-devlog.ts --source pages
 */

import { readLatestDevlog, type SourceMode } from './extract-devlog';

type ReportData = Record<string, any>;

function parseArgs() {
  const args = process.argv.slice(2);
  let mode: 'summary' | 'headlines' | 'actions' | 'full' = 'summary';
  let source: SourceMode = 'auto';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--summary') mode = 'summary';
    else if (args[i] === '--headlines') mode = 'headlines';
    else if (args[i] === '--actions') mode = 'actions';
    else if (args[i] === '--full') mode = 'full';
    else if (args[i] === '--source' && args[i + 1]) {
      const next = args[++i];
      if (next === 'auto' || next === 'pages' || next === 'temp' || next === 'devlog') source = next;
      else throw new Error(`未知来源: ${next}（支持 auto / pages / temp / devlog）`);
    } else if (args[i] === '--local') {
      source = 'devlog';
    }
  }

  return { mode, source };
}

function sourcePrelude(source: any): string[] {
  const lines = [
    '[devlog-source]',
    `requested: ${source.requestedSource}`,
    `resolved: ${source.resolvedSource}`,
    `trust: ${source.trust}`,
    `consistency: ${source.consistency}`,
    `guarantee: ${source.guarantee}`,
  ];
  if (source.manifest) lines.push(`manifest: ${source.manifest}`);
  if (source.data) lines.push(`data: ${source.data}`);
  if (source.latest) lines.push(`latest: ${source.latest}`);
  lines.push(`fallbackUsed: ${source.fallbackUsed ? 'yes' : 'no'}`);
  if (source.notes?.length) lines.push(`notes: ${source.notes.join(' | ')}`);
  lines.push('[/devlog-source]', '');
  return lines;
}

function formatSummary(data: ReportData): string {
  const meta = data.meta ?? {};
  const weather = data.weather ?? {};
  const metrics = Array.isArray(data.metrics) ? data.metrics : [];
  const headlines = Array.isArray(data.headlines) ? data.headlines : [];
  const actions = Array.isArray(data.actions)
    ? data.actions
    : Array.isArray(weather.actions)
      ? weather.actions
      : [];

  return [
    `📅 ${meta.date ?? ''} ${meta.title ?? ''}`.trim(),
    `🌤️ ${weather.emoji ?? ''} ${weather.label ?? ''}`.trim(),
    `📊 ${metrics.map(metric => `${metric.label}: ${metric.value}`).join(' | ')}`,
    '',
    '📰 头条:',
    ...headlines.slice(0, 3).map((headline: any) => `  · ${headline.title}`),
    '',
    '🎯 建议行动:',
    ...actions.slice(0, 3).map((action: any) => `  · ${typeof action === 'string' ? action : action?.text ?? ''}`),
  ].join('\n');
}

function formatHeadlines(data: ReportData): string {
  const meta = data.meta ?? {};
  const headlines = Array.isArray(data.headlines) ? data.headlines : [];
  return [
    `📰 ${meta.date ?? ''} ${meta.title ?? ''} — 头条`.trim(),
    '',
    ...headlines.map((headline: any, index: number) => `${index + 1}. ${headline.title}\n   ${headline.body ?? ''}`.trimEnd()),
  ].join('\n');
}

function formatActions(data: ReportData): string {
  const meta = data.meta ?? {};
  const weather = data.weather ?? {};
  const actions = Array.isArray(data.actions)
    ? data.actions
    : Array.isArray(weather.actions)
      ? weather.actions
      : [];

  return [
    `🎯 ${meta.date ?? ''} ${meta.title ?? ''} — 建议行动`.trim(),
    '',
    ...actions.map((action: any, index: number) => `${index + 1}. ${typeof action === 'string' ? action : action?.text ?? ''}`),
  ].join('\n');
}

async function main() {
  const { mode, source } = parseArgs();
  const result = await readLatestDevlog({ type: 'report', source });
  const prelude = sourcePrelude(result.source).join('\n');

  if (mode === 'full') {
    console.log(JSON.stringify({
      _devlogSource: result.source,
      ...result.data,
    }, null, 2));
    return;
  }

  const body = mode === 'headlines'
    ? formatHeadlines(result.data)
    : mode === 'actions'
      ? formatActions(result.data)
      : formatSummary(result.data);

  console.log(`${prelude}${body}`);
}

main().catch(error => {
  console.error(`\n❌ 错误: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
