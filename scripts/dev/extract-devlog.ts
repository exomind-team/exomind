#!/usr/bin/env bun

/**
 * extract-devlog.ts — 统一读取开发日报/开发航线，默认走 GitHub Pages 子 manifest
 *
 * 读取顺序（--source auto）：
 *   1. GitHub Pages 子 manifest + data JSON + latest.json 一致性校验
 *   2. 本地 exomind-devlog 发布仓库（仅 JSON fallback）
 *   3. 本地 temp/ HTML（仅 fallback）
 *
 * 用法:
 *   bun run devlog:extract --type report
 *   bun run devlog:extract --type route
 *   bun run devlog:extract --type report --format json
 *   bun run devlog:extract --type report --source pages
 *   bun run devlog:extract --type route --source devlog
 *   bun run devlog:extract --file <path>
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';

export type Format = 'text' | 'json';
export type DocType = 'report' | 'route';
export type SourceMode = 'auto' | 'pages' | 'temp' | 'devlog';

type Options = {
  type: DocType | null;
  format: Format;
  file: string | null;
  source: SourceMode;
};

type Entry = {
  date?: string;
  time?: string;
  file?: string;
  dataFile?: string;
  [key: string]: unknown;
};

type PublishedPointer = {
  kind?: DocType;
  date?: string;
  time?: string;
  file?: string;
  dataFile?: string;
};

export type SourceInfo = {
  requestedSource: SourceMode | 'file';
  resolvedSource: string;
  trust: 'high' | 'medium' | 'low';
  consistency: 'ok' | 'partial';
  guarantee: string;
  manifest?: string;
  data?: string;
  latest?: string;
  filePath?: string;
  fallbackUsed: boolean;
  notes: string[];
};

export type ResolvedDevlog<T = Record<string, any>> = {
  type: DocType;
  data: T;
  source: SourceInfo;
};

type Provider = {
  label: 'pages' | 'devlog';
  manifestRef: string;
  latestRef: string;
  entryRef: (subpath: string) => string;
  readJson: (ref: string) => Promise<any>;
};

const DEVLOG_PAGES_BASE = 'https://exomind-team.github.io/exomind-devlog';
const LOCAL_DEVLOG_DIR = resolve(join(import.meta.dir, '..', '..', '..', 'exomind-devlog'));

class SourceUnavailableError extends Error {}
class SourceConsistencyError extends Error {}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  let type: DocType | null = null;
  let format: Format = 'text';
  let file: string | null = null;
  let source: SourceMode = 'auto';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--type' && args[i + 1]) {
      const next = args[++i];
      if (next === 'report' || next === 'route') type = next;
      else throw new Error(`未知类型: ${next}（支持 report / route）`);
    } else if (args[i] === '--format' && args[i + 1]) {
      const next = args[++i];
      if (next === 'text' || next === 'json') format = next;
      else throw new Error(`未知格式: ${next}（支持 text / json）`);
    } else if (args[i] === '--file' && args[i + 1]) {
      file = resolve(args[++i]);
    } else if (args[i] === '--source' && args[i + 1]) {
      const next = args[++i];
      if (next === 'auto' || next === 'pages' || next === 'temp' || next === 'devlog') source = next;
      else throw new Error(`未知来源: ${next}（支持 auto / pages / temp / devlog）`);
    }
  }

  return { type, format, file, source };
}

function subdirFor(docType: DocType): 'reports' | 'routes' {
  return docType === 'report' ? 'reports' : 'routes';
}

function variableNameFor(docType: DocType): 'REPORT' | 'ROUTE' {
  return docType === 'report' ? 'REPORT' : 'ROUTE';
}

function prefixFor(docType: DocType): string {
  return docType === 'report' ? 'exomind-daily-report-' : 'exomind-route-';
}

function resolveDaypart(time?: string): string {
  const hour = Number.parseInt(time?.slice(0, 2) ?? '', 10);
  if (!Number.isFinite(hour)) return '开发日志';
  return hour < 6 ? '开发夜报' : hour < 12 ? '开发早报' : hour < 18 ? '开发午报' : '开发晚报';
}

function parsePublishedPointer(data: Record<string, any> | null | undefined, fallback?: Partial<PublishedPointer>): PublishedPointer {
  const published = data?._published && typeof data._published === 'object' ? data._published : {};
  const meta = data?.meta && typeof data.meta === 'object' ? data.meta : {};
  return {
    kind: published.kind ?? fallback?.kind,
    date: published.date ?? meta.date ?? fallback?.date,
    time: published.time ?? fallback?.time,
    file: published.file ?? fallback?.file,
    dataFile: published.dataFile ?? fallback?.dataFile,
  };
}

function assertPointerMatch(leftLabel: string, left: Partial<PublishedPointer>, rightLabel: string, right: Partial<PublishedPointer>) {
  const fields: (keyof PublishedPointer)[] = ['kind', 'date', 'time', 'file', 'dataFile'];
  for (const field of fields) {
    if (left[field] && right[field] && left[field] !== right[field]) {
      throw new SourceConsistencyError(`${leftLabel}.${field}=${left[field]} 与 ${rightLabel}.${field}=${right[field]} 不一致`);
    }
  }
}

function extractObjectBlock(html: string, variableName: 'REPORT' | 'ROUTE'): string {
  const startMarker = `const ${variableName} = {`;
  const startIdx = html.indexOf(startMarker);
  if (startIdx === -1) throw new SourceConsistencyError(`未找到 ${startMarker}`);

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

  if (endIdx === -1) throw new SourceConsistencyError(`未找到 ${variableName} 对象的结束位置`);
  return html.substring(startIdx, endIdx);
}

function parseObjectBlock(block: string, variableName: 'REPORT' | 'ROUTE'): Record<string, any> {
  const objectLiteral = block.replace(new RegExp(`^const\\s+${variableName}\\s*=\\s*`), '');
  const parsed = Function(`"use strict"; return (${objectLiteral});`)();
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SourceConsistencyError(`${variableName} 解析结果不是对象`);
  }
  return parsed as Record<string, any>;
}

function detectTypeFromHtml(html: string): DocType {
  if (html.includes('const REPORT = {')) return 'report';
  if (html.includes('const ROUTE = {')) return 'route';
  throw new SourceConsistencyError('无法从 HTML 检测开发日志类型');
}

function detectTypeFromJson(data: Record<string, any>): DocType {
  if (data.schema === 'exomind-devlog-report') return 'report';
  if (data.schema === 'exomind-devlog-route') return 'route';
  if (data.meta && data.weather) return 'report';
  if (data.meta && data.status && Array.isArray(data.batches)) return 'route';
  throw new SourceConsistencyError(`无法从 JSON 检测开发日志类型（schema=${data.schema ?? 'unknown'}）`);
}

function extractLoaderDataFile(html: string): string | null {
  const match = html.match(/dataFile:\s*'([^']+\.json)'/);
  return match ? match[1] : null;
}

async function resolveFromHtml(docType: DocType, html: string, opts: {
  localFilePath?: string;
}): Promise<Record<string, any>> {
  const variableName = variableNameFor(docType);

  if (html.includes(`const ${variableName} = {`)) {
    return parseObjectBlock(extractObjectBlock(html, variableName), variableName);
  }

  const dataFile = extractLoaderDataFile(html);
  if (!dataFile) {
    throw new SourceConsistencyError('HTML 既不含内联数据对象，也没有 dataFile loader 配置');
  }

  if (opts.localFilePath) {
    const jsonPath = join(dirname(opts.localFilePath), dataFile);
    if (!existsSync(jsonPath)) throw new SourceConsistencyError(`HTML loader 指向的 JSON 不存在: ${jsonPath}`);
    return JSON.parse(readFileSync(jsonPath, 'utf-8'));
  }

  throw new SourceConsistencyError('无法解析 loader HTML 对应的 JSON 数据源');
}

function createPagesProvider(docType: DocType): Provider {
  const subdir = subdirFor(docType);
  const base = `${DEVLOG_PAGES_BASE}/${subdir}`;
  return {
    label: 'pages',
    manifestRef: `${base}/manifest.json`,
    latestRef: `${base}/latest.json`,
    entryRef: (subpath: string) => `${base}/${subpath}`,
    async readJson(ref: string) {
      const response = await fetch(ref, {
        headers: { 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        const error = new SourceUnavailableError(`HTTP ${response.status}: ${ref}`);
        throw error;
      }
      return response.json();
    },
  };
}

function createLocalProvider(docType: DocType): Provider {
  const subdir = subdirFor(docType);
  const baseDir = join(LOCAL_DEVLOG_DIR, subdir);
  return {
    label: 'devlog',
    manifestRef: join(baseDir, 'manifest.json'),
    latestRef: join(baseDir, 'latest.json'),
    entryRef: (subpath: string) => join(baseDir, subpath),
    async readJson(ref: string) {
      if (!existsSync(ref)) throw new SourceUnavailableError(`本地文件不存在: ${ref}`);
      return JSON.parse(readFileSync(ref, 'utf-8'));
    },
  };
}

async function resolveFromPublishedProvider(docType: DocType, requestedSource: SourceMode | 'file', provider: Provider): Promise<ResolvedDevlog> {
  const manifest = await provider.readJson(provider.manifestRef);
  const listKey = docType === 'report' ? 'reports' : 'routes';
  const entries = Array.isArray(manifest[listKey]) ? manifest[listKey] as Entry[] : [];
  if (!entries.length) throw new SourceUnavailableError(`${provider.manifestRef} 中没有 ${listKey}`);

  const firstEntry = entries[0];
  const latestEntry = manifest.latest && typeof manifest.latest === 'object' ? manifest.latest as Entry : null;
  const chosenEntry: Entry = latestEntry
    ? {
        ...firstEntry,
        ...latestEntry,
        file: latestEntry.file ?? firstEntry.file,
        dataFile: latestEntry.dataFile ?? firstEntry.dataFile,
        date: latestEntry.date ?? firstEntry.date,
        time: latestEntry.time ?? firstEntry.time,
      }
    : { ...firstEntry };

  if (latestEntry) {
    assertPointerMatch('manifest.latest', latestEntry, `${listKey}[0]`, firstEntry);
  }

  const notes: string[] = [];
  let trust: SourceInfo['trust'] = provider.label === 'pages' ? 'high' : 'medium';
  let consistency: SourceInfo['consistency'] = 'ok';
  const resolvedSource = `${provider.label}-json`;
  const dataRef = chosenEntry.dataFile ? provider.entryRef(chosenEntry.dataFile) : undefined;

  if (!chosenEntry.dataFile) {
    throw new SourceConsistencyError('manifest 条目缺少 dataFile；已发布标准入口必须提供 JSON 数据层');
  }
  let data: Record<string, any>;
  try {
    data = await provider.readJson(provider.entryRef(chosenEntry.dataFile));
  } catch (error) {
    throw new SourceUnavailableError(`标准 JSON 不可用：${error instanceof Error ? error.message : String(error)}`);
  }

  let latestData: Record<string, any> | null = null;
  try {
    latestData = await provider.readJson(provider.latestRef);
  } catch (error) {
    consistency = 'partial';
    trust = provider.label === 'pages' ? 'medium' : 'low';
    notes.push(`latest.json 不可用：${error instanceof Error ? error.message : String(error)}`);
  }

  const entryPointer: Partial<PublishedPointer> = {
    kind: docType,
    date: chosenEntry.date,
    time: chosenEntry.time,
    file: chosenEntry.file,
    dataFile: chosenEntry.dataFile,
  };

  const dataPointer = parsePublishedPointer(data, entryPointer);
  assertPointerMatch('manifest.entry', entryPointer, 'data', dataPointer);
  if (latestData) {
    const latestPointer = parsePublishedPointer(latestData, entryPointer);
    assertPointerMatch('manifest.entry', entryPointer, 'latest', latestPointer);
    assertPointerMatch('data', dataPointer, 'latest', latestPointer);
  } else {
    notes.push('已校验 manifest 与 data；latest.json 缺失，当前为中等可信度');
  }

  return {
    type: docType,
    data,
    source: {
      requestedSource,
      resolvedSource,
      trust,
      consistency,
      guarantee: consistency === 'ok'
        ? 'manifest + data + latest 已一致校验'
        : '仅部分校验通过；请查看 notes 了解缺口',
      manifest: provider.manifestRef,
      data: dataRef,
      latest: provider.latestRef,
      fallbackUsed: resolvedSource !== 'pages-json' && requestedSource === 'auto',
      notes,
    },
  };
}

async function resolveFromTemp(docType: DocType, requestedSource: SourceMode | 'file'): Promise<ResolvedDevlog> {
  const tempDir = resolve(join(import.meta.dir, '..', '..', 'temp'));
  if (!existsSync(tempDir)) throw new SourceUnavailableError(`temp/ 目录不存在: ${tempDir}`);

  const files = readdirSync(tempDir)
    .filter(file => file.startsWith(prefixFor(docType)) && file.endsWith('.html'))
    .sort()
    .reverse();

  if (!files.length) throw new SourceUnavailableError(`temp/ 下未找到 ${prefixFor(docType)}*.html`);

  const filePath = join(tempDir, files[0]);
  const html = readFileSync(filePath, 'utf-8');
  const detectedType = detectTypeFromHtml(html);
  if (detectedType !== docType) throw new SourceConsistencyError(`temp 文件类型不匹配: ${filePath}`);

  const data = await resolveFromHtml(docType, html, { localFilePath: filePath });
  return {
    type: docType,
    data,
    source: {
      requestedSource,
      resolvedSource: 'temp-html',
      trust: 'low',
      consistency: 'partial',
      guarantee: '仅本地 temp 兜底；不保证等于最新已发布状态',
      filePath,
      fallbackUsed: requestedSource === 'auto',
      notes: ['temp/ 可能包含未发布或过期文件，只能作为低可信度 fallback'],
    },
  };
}

async function resolveFromExplicitFile(filePath: string, explicitType: DocType | null, source: SourceMode): Promise<ResolvedDevlog> {
  if (!existsSync(filePath)) throw new Error(`文件不存在: ${filePath}`);

  const extension = extname(filePath).toLowerCase();
  if (extension === '.json') {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    const detectedType = explicitType || detectTypeFromJson(data);
    return {
      type: detectedType,
      data,
      source: {
        requestedSource: 'file',
        resolvedSource: 'explicit-file-json',
        trust: 'medium',
        consistency: 'partial',
        guarantee: '显式文件输入；由调用者负责其新鲜度',
        filePath,
        fallbackUsed: false,
        notes: source === 'auto' ? [] : [`显式文件绕过了 --source=${source} 的自动发现逻辑`],
      },
    };
  }

  const html = readFileSync(filePath, 'utf-8');
  let detectedType: DocType;
  if (explicitType) {
    detectedType = explicitType;
  } else {
    try {
      detectedType = detectTypeFromHtml(html);
    } catch {
      const dataFile = extractLoaderDataFile(html);
      if (!dataFile) throw new SourceConsistencyError('显式 HTML 文件既无内联数据，也无法从 loader 推断类型');
      const jsonPath = join(dirname(filePath), dataFile);
      if (!existsSync(jsonPath)) throw new SourceConsistencyError(`显式 loader HTML 对应的 JSON 不存在: ${jsonPath}`);
      detectedType = detectTypeFromJson(JSON.parse(readFileSync(jsonPath, 'utf-8')));
    }
  }
  const data = await resolveFromHtml(detectedType, html, { localFilePath: filePath });
  return {
    type: detectedType,
    data,
    source: {
      requestedSource: 'file',
      resolvedSource: 'explicit-file-html',
      trust: 'medium',
      consistency: 'partial',
      guarantee: '显式文件输入；由调用者负责其新鲜度',
      filePath,
      fallbackUsed: false,
      notes: source === 'auto' ? [] : [`显式文件绕过了 --source=${source} 的自动发现逻辑`],
    },
  };
}

export async function readLatestDevlog(options: Partial<Options> = {}): Promise<ResolvedDevlog> {
  const source = options.source ?? 'auto';

  if (options.file) {
    return resolveFromExplicitFile(options.file, options.type ?? null, source);
  }

  if (!options.type) {
    throw new Error('请指定 --type report/route 或 --file <path>');
  }

  const docType = options.type;

  if (source === 'pages') {
    return resolveFromPublishedProvider(docType, source, createPagesProvider(docType));
  }

  if (source === 'devlog') {
    return resolveFromPublishedProvider(docType, source, createLocalProvider(docType));
  }

  if (source === 'temp') {
    return resolveFromTemp(docType, source);
  }

  const errors: string[] = [];
  for (const candidate of [
    () => resolveFromPublishedProvider(docType, source, createPagesProvider(docType)),
    () => resolveFromPublishedProvider(docType, source, createLocalProvider(docType)),
    () => resolveFromTemp(docType, source),
  ]) {
    try {
      return await candidate();
    } catch (error) {
      if (error instanceof SourceConsistencyError) throw error;
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new SourceUnavailableError(`所有来源均不可用: ${errors.join(' | ')}`);
}

function formatMetric(metric: any): string {
  if (!metric || typeof metric !== 'object') return '';
  const extras = [metric.delta, metric.note].filter(Boolean).join(', ');
  return extras ? `${metric.label}: ${metric.value} (${extras})` : `${metric.label}: ${metric.value}`;
}

function formatAction(action: any): string {
  if (typeof action === 'string') return action;
  if (typeof action?.text === 'string' && typeof action?.detail === 'string') return `${action.text} — ${action.detail}`;
  return action?.text ?? '';
}

export function renderSourceBlock(source: SourceInfo): string {
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
  if (source.filePath) lines.push(`file: ${source.filePath}`);
  lines.push(`fallbackUsed: ${source.fallbackUsed ? 'yes' : 'no'}`);
  if (source.notes.length) lines.push(`notes: ${source.notes.join(' | ')}`);
  lines.push('[/devlog-source]');
  return lines.join('\n');
}

function renderReportText(data: Record<string, any>, source: SourceInfo): string {
  const meta = data.meta ?? {};
  const published = parsePublishedPointer(data);
  const publisher = data.publisher ?? {};
  const weather = data.weather ?? {};
  const metrics = Array.isArray(data.metrics) ? data.metrics : [];
  const headlines = Array.isArray(data.headlines) ? data.headlines : [];
  const mainlines = Array.isArray(data.mainlines) ? data.mainlines : [];
  const actions = Array.isArray(data.actions)
    ? data.actions
    : Array.isArray(weather.actions)
      ? weather.actions
      : [];
  const insight = typeof data.insight === 'string' ? data.insight : data.insight?.text;
  const title = meta.title || resolveDaypart(published.time);

  const lines: string[] = [renderSourceBlock(source), '', `# ExoMind ${title} ${meta.date ?? ''}`];

  if (publisher.identity) {
    lines.push(`发布者: ${publisher.identity}·${publisher.os} [${publisher.model} ${publisher.version}]`);
  }
  if (weather.emoji || weather.label) lines.push(`天气: ${weather.emoji ?? ''} ${weather.label ?? ''}`.trim());
  if (meta.coverage) lines.push(`覆盖: ${meta.coverage}`);
  if (meta.baseline) lines.push(`基线: ${String(meta.baseline).startsWith('dev@') ? meta.baseline : `dev@${meta.baseline}`}`);
  lines.push('');

  if (metrics.length) {
    lines.push('## 指标');
    metrics.forEach(metric => lines.push(`- ${formatMetric(metric)}`));
    lines.push('');
  }

  if (headlines.length) {
    lines.push('## 头条');
    headlines.forEach((headline, index) => lines.push(`${index + 1}. ${headline.emoji ? `${headline.emoji} ` : ''}${headline.title} — ${headline.body}`));
    lines.push('');
  }

  if (mainlines.length) {
    lines.push('## 主线');
    mainlines.forEach((mainline: any, index: number) => {
      const subtasks = Array.isArray(mainline?.subtasks)
        ? mainline.subtasks
          .map((task: any) => `${task?.done ? '✅' : '○'}${task?.text ?? ''}`)
          .join(' ')
        : '';
      lines.push(`${index + 1}. ${mainline.name} [${mainline.pct ?? '?'}%] ${subtasks}`.trim());
    });
    lines.push('');
  }

  if (Array.isArray(actions) && actions.length) {
    lines.push('## 建议行动');
    actions.map(formatAction).filter(Boolean).forEach((action, index) => lines.push(`${index + 1}. ${action}`));
    lines.push('');
  }

  if (insight) {
    lines.push('## 洞察');
    lines.push(String(insight));
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function renderRouteText(data: Record<string, any>, source: SourceInfo): string {
  const meta = data.meta ?? {};
  const published = parsePublishedPointer(data);
  const publisher = data.publisher ?? {};
  const status = data.status ?? {};
  const metrics = Array.isArray(data.metrics) ? data.metrics : [];
  const batches = Array.isArray(data.batches) ? data.batches : [];
  const actions = Array.isArray(data.actions) ? data.actions : [];
  const insight = typeof data.insight === 'string' ? data.insight : data.insight?.text;

  const lines: string[] = [renderSourceBlock(source), '', `# ExoMind ${meta.title ?? '开发航线'} ${meta.date ?? published.date ?? ''}`];

  if (publisher.identity) {
    lines.push(`发布者: ${publisher.identity}·${publisher.os} [${publisher.model} ${publisher.version}]`);
  }
  if (status.emoji || status.label) lines.push(`航况: ${status.emoji ?? ''} ${status.label ?? ''}`.trim());
  if (status.summary) lines.push(`概要: ${status.summary}`);
  if (meta.baseline) lines.push(`基线: ${String(meta.baseline).startsWith('dev@') ? meta.baseline : `dev@${meta.baseline}`}`);
  lines.push('');

  if (metrics.length) {
    lines.push('## 指标');
    metrics.forEach(metric => lines.push(`- ${formatMetric(metric)}`));
    lines.push('');
  }

  if (batches.length) {
    lines.push('## 批次总览');
    batches.forEach((batch: any) => {
      const issueCount = Array.isArray(batch?.issues) ? batch.issues.length : 0;
      lines.push(`${batch.id}: ${batch.name} [${batch.track}] ${batch.status} ${batch.pct ?? '?'}% (${issueCount} issues, ${batch.priority ?? '?'})`);
      if (Array.isArray(batch?.deps) && batch.deps.length) {
        batch.deps.forEach((dep: any) => lines.push(`  - dep ${dep.id}: ${dep.reason}`));
      }
    });
    lines.push('');
  }

  if (actions.length) {
    lines.push('## 建议航向');
    actions.map(formatAction).filter(Boolean).forEach((action, index) => lines.push(`${index + 1}. ${action}`));
    lines.push('');
  }

  if (insight) {
    lines.push('## 洞察');
    lines.push(String(insight));
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function serializeJson(result: ResolvedDevlog): string {
  return JSON.stringify({
    _devlogSource: result.source,
    ...result.data,
  }, null, 2);
}

async function main() {
  const options = parseArgs();
  const result = await readLatestDevlog(options);

  if (options.format === 'json') {
    console.log(serializeJson(result));
    return;
  }

  const text = result.type === 'report'
    ? renderReportText(result.data, result.source)
    : renderRouteText(result.data, result.source);

  console.log(text);
}

if (import.meta.main) {
  main().catch(error => {
    console.error(`\n❌ 错误: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
