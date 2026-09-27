#!/usr/bin/env bun

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  assertNoEncodingIssuesInDevlogObject,
  renderMarkerForKind,
  type DevlogHtmlKind,
} from './devlog-html-gate';

type Options = {
  type: DevlogHtmlKind;
  dataPath: string;
  outPath: string;
};

function normalizeMetricTrend(trend: unknown) {
  if (typeof trend !== 'string') return 'neutral';

  const normalized = trend.trim().toLowerCase();
  if (normalized === 'flat') return 'neutral';
  return ['up', 'down', 'neutral'].includes(normalized) ? normalized : 'neutral';
}

function normalizeScoreResult(result: unknown) {
  if (typeof result !== 'string') return 'partial';

  const normalized = result.trim().toLowerCase();
  if (['pass', 'hit', 'done'].includes(normalized)) return 'pass';
  if (['fail', 'miss'].includes(normalized)) return 'fail';
  return 'partial';
}

function normalizePrStatus(status: unknown) {
  if (typeof status !== 'string') return 'open';

  const normalized = status.trim().toLowerCase();
  return ['open', 'review', 'docs', 'locked', 'merged'].includes(normalized) ? normalized : 'open';
}

function normalizePriority(priority: unknown) {
  return typeof priority === 'string' && priority.trim() ? priority : 'P2';
}

function normalizeTruthItems(items: unknown, group: 'closed' | 'stillOpen') {
  if (!Array.isArray(items)) return [];

  return items
    .filter((item): item is Record<string, any> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .filter(item => Number.isFinite(item.num) && typeof item.title === 'string' && item.title.trim())
    .map(item => {
      const gh = typeof item.gh === 'string' && item.gh.trim()
        ? item.gh.trim().toUpperCase()
        : group === 'closed' || typeof item.closedAt === 'string'
          ? 'CLOSED'
          : 'OPEN';
      const code = typeof item.code === 'string' && item.code.trim()
        ? item.code.trim().toUpperCase()
        : group === 'closed'
          ? 'FIXED'
          : 'NONE';

      return {
        ...item,
        gh,
        code,
        mismatch: Boolean(item.mismatch),
      };
    });
}

function normalizeStaleItems(items: unknown) {
  if (!Array.isArray(items)) return [];

  return items
    .filter((item): item is Record<string, any> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .filter(item => Number.isFinite(item.num) && typeof item.title === 'string' && item.title.trim())
    .map(item => ({
      ...item,
      priority: normalizePriority(item.priority),
      staleDays: Number.isFinite(item.staleDays)
        ? item.staleDays
        : Number.isFinite(item.ageDays)
          ? item.ageDays
          : 0,
    }));
}

function normalizeAgingSamples(samples: unknown) {
  if (!Array.isArray(samples)) return [];

  return samples
    .filter((item): item is Record<string, any> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .filter(item => Number.isFinite(item.num) && typeof item.title === 'string' && item.title.trim())
    .map(item => ({
      ...item,
      priority: normalizePriority(item.priority),
      ageDays: Number.isFinite(item.ageDays)
        ? item.ageDays
        : Number.isFinite(item.staleDays)
          ? item.staleDays
          : 0,
    }));
}

function normalizePoolHealth(poolHealth: unknown) {
  if (!poolHealth || typeof poolHealth !== 'object' || Array.isArray(poolHealth)) {
    return undefined;
  }

  const raw = poolHealth as Record<string, any>;
  const agingRaw = raw.aging && typeof raw.aging === 'object' && !Array.isArray(raw.aging)
    ? raw.aging
    : {};
  const total = Number.isFinite(agingRaw.total) ? agingRaw.total : 0;
  const pct = Number.isFinite(agingRaw.pct) ? agingRaw.pct : 0;
  const oldCount = Number.isFinite(agingRaw.oldCount)
    ? agingRaw.oldCount
    : total > 0 && pct > 0
      ? Math.round(total * pct / 100)
      : 0;

  return {
    prIssueMismatch: Array.isArray(raw.prIssueMismatch) ? raw.prIssueMismatch : [],
    staleHighPriority: normalizeStaleItems(raw.staleHighPriority ?? raw.stalePriority),
    noPriority: {
      current: Number.isFinite(raw.noPriority?.current) ? raw.noPriority.current : 0,
      previous: Number.isFinite(raw.noPriority?.previous) ? raw.noPriority.previous : 0,
    },
    aging: {
      oldCount,
      total,
      pct,
      samples: normalizeAgingSamples(agingRaw.samples),
    },
  };
}

function normalizeReportData(data: Record<string, any>) {
  const copy = structuredClone(data);

  copy.meta = {
    ...(copy.meta ?? {}),
    title: typeof copy.meta?.title === 'string' && copy.meta.title.trim() ? copy.meta.title : '开发日志',
    coverage: typeof copy.meta?.coverage === 'string' ? copy.meta.coverage : '',
    repo: typeof copy.meta?.repo === 'string' && copy.meta.repo.trim() ? copy.meta.repo : 'exomind-team/exomind',
  };

  copy.metrics = Array.isArray(copy.metrics)
    ? copy.metrics.map((metric: Record<string, any>) => ({
        ...metric,
        trend: normalizeMetricTrend(metric?.trend),
        tooltip: typeof metric?.tooltip === 'string'
          ? metric.tooltip
          : typeof metric?.note === 'string'
            ? metric.note
            : '',
      }))
    : [];

  copy.headlines = Array.isArray(copy.headlines)
    ? copy.headlines.map((headline: Record<string, any>) => ({
        ...headline,
        emoji: typeof headline?.emoji === 'string' && headline.emoji.trim() ? headline.emoji : '-',
      }))
    : [];

  copy.mainlines = Array.isArray(copy.mainlines)
    ? copy.mainlines.map((mainline: Record<string, any>) => {
        const progress = Number.isFinite(mainline?.progress)
          ? mainline.progress
          : Number.isFinite(mainline?.pct)
            ? mainline.pct
            : 0;
        return {
          ...mainline,
          progress,
          pct: progress,
          subtasks: Array.isArray(mainline?.subtasks)
            ? mainline.subtasks.map((subtask: any) => typeof subtask === 'string' ? { text: subtask, done: false } : subtask)
            : [],
        };
      })
    : [];

  copy.actions = Array.isArray(copy.actions)
    ? copy.actions.map((action: any) => typeof action === 'string' ? { text: action, detail: '' } : action)
    : Array.isArray(copy.weather?.actions)
      ? copy.weather.actions.map((action: any) => typeof action === 'string' ? { text: action, detail: '' } : action)
      : [];

  copy.scorecard = Array.isArray(copy.scorecard)
    ? copy.scorecard.map((item: Record<string, any>) => ({
        ...item,
        text: typeof item?.text === 'string' ? item.text : typeof item?.label === 'string' ? item.label : '',
        note: typeof item?.note === 'string' ? item.note : typeof item?.detail === 'string' ? item.detail : '',
        result: normalizeScoreResult(item?.result),
      }))
    : [];

  const prs = copy.prs && typeof copy.prs === 'object' && !Array.isArray(copy.prs) ? copy.prs : {};
  copy.prs = {
    open: Array.isArray(prs.open)
      ? prs.open.map((pr: Record<string, any>) => ({
          ...pr,
          status: normalizePrStatus(pr?.status),
        }))
      : [],
    merged: Array.isArray(prs.merged) ? prs.merged : [],
  };

  const truth = copy.truth && typeof copy.truth === 'object' && !Array.isArray(copy.truth) ? copy.truth : {};
  copy.truth = {
    closed: normalizeTruthItems(truth.closed, 'closed'),
    stillOpen: normalizeTruthItems(truth.stillOpen, 'stillOpen'),
  };

  copy.poolHealth = normalizePoolHealth(copy.poolHealth);

  if (typeof copy.insight === 'string') {
    copy.insight = {
      text: copy.insight,
      author: copy.publisher?.identity ?? 'ExoMind',
    };
  } else if (!copy.insight || typeof copy.insight !== 'object' || Array.isArray(copy.insight)) {
    copy.insight = {
      text: '',
      author: copy.publisher?.identity ?? 'ExoMind',
    };
  } else if (typeof copy.insight.author !== 'string' || !copy.insight.author.trim()) {
    copy.insight = {
      ...copy.insight,
      author: copy.publisher?.identity ?? 'ExoMind',
    };
  }

  return copy;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  let type: DevlogHtmlKind | null = null;
  let dataPath: string | null = null;
  let outPath: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--type' && args[i + 1]) {
      const next = args[++i];
      if (next === 'report' || next === 'route') type = next;
    } else if (args[i] === '--data' && args[i + 1]) {
      dataPath = resolve(args[++i]);
    } else if (args[i] === '--out' && args[i + 1]) {
      outPath = resolve(args[++i]);
    }
  }

  if (!type) throw new Error('缺少 --type report|route');
  if (!dataPath) throw new Error('缺少 --data <json-file>');
  if (!outPath) throw new Error('缺少 --out <html-file>');

  return { type, dataPath, outPath };
}

function stripPublishedFields(data: Record<string, any>) {
  const copy = structuredClone(data);
  delete copy.schema;
  delete copy.version;
  delete copy.generated;
  delete copy._published;

  // meta.date 由系统自动生成，禁止 Agent 自行填写
  // 允许 ±1 小时容差：允许"早报"在 23:xx 生成次日 00:xx 的数据
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const canonicalDate = `${year}-${month}-${day}`;

  const existing = copy.meta?.date ?? '';
  if (existing) {
    const match = existing.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      const [/* */, y, m, d] = match;
      const repDate = new Date(`${y}-${m}-${d}T00:00:00+08:00`);
      const diffHours = (repDate.getTime() - now.getTime()) / (1000 * 60 * 60);
      if (diffHours > 1) {
        throw new Error(
          `❌ 数据时间门禁失败：Agent 填写的日期 ${existing} 超出当前时间 ${diffHours.toFixed(1)} 小时。\n` +
          `   meta.date 由系统自动生成，Agent 不得自行填写。\n` +
          `   系统自动注入日期: ${canonicalDate}`,
        );
      }
    }
  }

  if (!copy.meta) copy.meta = {};
  copy.meta.date = canonicalDate;

  return copy;
}

function templatePathForKind(kind: DevlogHtmlKind) {
  return kind === 'report'
    ? join(import.meta.dir, '..', '..', 'skills', 'dev-daily', 'assets', 'report-template.html')
    : join(import.meta.dir, '..', '..', 'skills', 'dev-route', 'assets', 'route-template.html');
}

function replaceObjectLiteral(html: string, variableName: 'REPORT' | 'ROUTE', objectValue: Record<string, any>) {
  const startMarker = `const ${variableName} = {`;
  const startIdx = html.indexOf(startMarker);
  if (startIdx === -1) throw new Error(`未找到 ${startMarker}`);

  let braceCount = 0;
  let inString = false;
  let stringChar = '';
  let endIdx = -1;

  for (let i = startIdx + startMarker.length - 1; i < html.length; i++) {
    const char = html[i];
    const prevChar = i > 0 ? html[i - 1] : '';

    if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
      }
    }

    if (!inString) {
      if (char === '{') braceCount++;
      if (char === '}') braceCount--;
      if (braceCount === 0 && char === '}') {
        endIdx = i + 1;
        break;
      }
    }
  }

  if (endIdx === -1) throw new Error(`未找到 ${variableName} 对象结束位置`);
  const replacement = `const ${variableName} = ${JSON.stringify(objectValue, null, 2)}`;
  return html.slice(0, startIdx) + replacement + html.slice(endIdx);
}

function injectRenderMarker(html: string, kind: DevlogHtmlKind) {
  const marker = renderMarkerForKind(kind);
  if (html.includes(marker)) return html;

  if (html.startsWith('<!DOCTYPE html>')) {
    return html.replace('<!DOCTYPE html>', `<!DOCTYPE html>\n${marker}`);
  }

  return `${marker}\n${html}`;
}

function main() {
  const options = parseArgs();
  if (!existsSync(options.dataPath)) throw new Error(`数据文件不存在: ${options.dataPath}`);

  const templatePath = templatePathForKind(options.type);
  if (!existsSync(templatePath)) throw new Error(`模板不存在: ${templatePath}`);

  const rawData = readFileSync(options.dataPath, 'utf-8');
  const parsed = JSON.parse(rawData) as Record<string, any>;
  const input = normalizeReportData(stripPublishedFields(parsed));

  // Gate before any HTML is generated so encoding issues are stopped at the earliest stage.
  assertNoEncodingIssuesInDevlogObject(options.type, input);

  const template = readFileSync(templatePath, 'utf-8');
  const variableName = options.type === 'report' ? 'REPORT' : 'ROUTE';
  const rendered = injectRenderMarker(
    replaceObjectLiteral(template, variableName, input),
    options.type,
  );
  writeFileSync(options.outPath, rendered, 'utf-8');

  console.log(`✓ 已生成${options.type === 'report' ? '日报' : '航线'} HTML`);
  console.log(`  模板: ${basename(templatePath)}`);
  console.log(`  数据: ${options.dataPath}`);
  console.log(`  输出: ${options.outPath}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
