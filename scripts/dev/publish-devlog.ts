#!/usr/bin/env bun

/**
 * publish-devlog.ts — 统一发布开发日报到 exomind-devlog GitHub Pages 仓库
 *
 * 标准产物：
 * - reports/YYYY-MM-DD-HHmmss.json
 * - reports/YYYY-MM-DD-HHmmss.html
 * - reports/latest.json
 * - reports/manifest.json
 *
 * 用法:
 *   bun run devlog:publish
 *   bun run devlog:publish --report <path>
 *   bun run devlog:publish --devlog-dir <path>
 *   bun run devlog:publish --dry-run
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { loadValidatedDevlogHtmlFile } from './devlog-html-gate';
import { readLatestDevlog, renderSourceBlock } from './extract-devlog';

type Options = {
  reportPath: string | null;
  devlogDir: string;
  dryRun: boolean;
};

type ReportData = {
  schema: 'exomind-devlog-report';
  version: '1.0';
  generated: string;
  _published: {
    kind: 'report';
    date: string;
    time: string;
    file: string;
    dataFile: string;
  };
  [key: string]: any;
};

type ManifestEntry = {
  date: string;
  time: string;
  title: string;
  file: string;
  dataFile: string;
  publisher?: string;
  weather?: { level: string; emoji: string; label: string };
  metrics?: { label: string; value: string; delta: string; trend: string }[];
  url?: string;
  dataUrl?: string;
};

type Manifest = {
  generated: string;
  repo: string;
  latest?: {
    file: string;
    dataFile: string;
    date: string;
    time: string;
  };
  reports: ManifestEntry[];
};

function parseArgs(): Options {
  const args = process.argv.slice(2);
  let reportPath: string | null = null;
  let devlogDir = resolve(join(import.meta.dir, '..', '..', '..', 'exomind-devlog'));
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--report' && args[i + 1]) {
      reportPath = resolve(args[++i]);
    } else if (args[i] === '--devlog-dir' && args[i + 1]) {
      devlogDir = resolve(args[++i]);
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    }
  }

  return { reportPath, devlogDir, dryRun };
}

function findLatestReport(): string {
  const tempDir = resolve(join(import.meta.dir, '..', '..', 'temp'));
  if (!existsSync(tempDir)) throw new Error(`temp/ 目录不存在: ${tempDir}`);

  const files = readdirSync(tempDir)
    .filter(file => file.startsWith('exomind-daily-report-') && file.endsWith('.html'))
    .sort()
    .reverse();

  if (!files.length) throw new Error('temp/ 下未找到日报文件 (exomind-daily-report-*.html)');
  return join(tempDir, files[0]);
}

function extractObjectBlock(html: string, variableName: 'REPORT'): string {
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

  if (endIdx === -1) throw new Error(`未找到 ${variableName} 对象的结束位置`);
  return html.substring(startIdx, endIdx);
}

function parseObjectBlock(block: string, variableName: 'REPORT'): Record<string, any> {
  const objectLiteral = block.replace(new RegExp(`^const\\s+${variableName}\\s*=\\s*`), '');
  const parsed = Function(`"use strict"; return (${objectLiteral});`)();
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${variableName} 解析结果不是对象`);
  }
  return parsed as Record<string, any>;
}

function resolveDaypart(time: string): string {
  const hour = Number.parseInt(time.slice(0, 2), 10);
  if (!Number.isFinite(hour)) return '开发日志';
  return hour < 6 ? '开发夜报' : hour < 12 ? '开发早报' : hour < 18 ? '开发午报' : '开发晚报';
}

function ensureString(value: unknown, field: string, errors: string[], minLength = 1) {
  if (typeof value !== 'string' || value.trim().length < minLength) {
    errors.push(`${field} 为空或过短`);
  }
}

function ensureArray(value: unknown, field: string, errors: string[], minLength = 1) {
  if (!Array.isArray(value) || value.length < minLength) {
    errors.push(`${field} 数组缺失或长度不足`);
  }
}

function collectPlaceholderTexts(value: unknown, hits: string[], path = 'root') {
  const placeholderPattern = /数据缺失|暂无数据|查询失败|TODO|请填写|placeholder/i;
  if (typeof value === 'string') {
    if (placeholderPattern.test(value)) hits.push(`${path}: ${value}`);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectPlaceholderTexts(item, hits, `${path}[${index}]`));
    return;
  }

  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      collectPlaceholderTexts(nested, hits, `${path}.${key}`);
    }
  }
}

function validatePoolHealth(report: Record<string, any>, errors: string[]) {
  const poolHealth = report.poolHealth ?? {};
  const aging = poolHealth.aging ?? {};
  const stalePriority = Array.isArray(poolHealth.stalePriority) ? poolHealth.stalePriority : [];

  if (!Number.isFinite(aging.total) || aging.total <= 0) {
    errors.push('poolHealth.aging.total 必须是大于 0 的实际 open issue 总数');
  }

  if (!Array.isArray(aging.samples) || aging.samples.length < 1) {
    errors.push('poolHealth.aging.samples 为空（必须列出最老的 5-8 个 open issue）');
  }

  if (stalePriority.some((item: any) => !Number.isFinite(item?.num))) {
    errors.push('poolHealth.stalePriority 含非法 issue 编号');
  }
}

function validateInsight(report: Record<string, any>, errors: string[]) {
  const insight = report.insight;

  if (typeof insight === 'string') {
    errors.push(
      'insight 为纯字符串，缺少结构。' +
      '必须为对象格式: { text: string, author: string }。' +
      'render 引擎按 R.insight.text / R.insight.author 读取，plain string 会导致页面崩溃。'
    );
    return;
  }

  if (typeof insight?.text !== 'string' || insight.text.trim().length < 20) {
    errors.push('insight.text 为空或过短（至少 20 字符）');
  }
  if (typeof insight?.author !== 'string' || insight.author.trim().length < 1) {
    errors.push('insight.author 缺失或为空');
  }
}

function validateReportData(report: Record<string, any>) {
  const errors: string[] = [];
  const meta = report.meta ?? {};
  const publisher = report.publisher ?? {};
  const weather = report.weather ?? {};
  const metrics = Array.isArray(report.metrics) ? report.metrics : [];
  const headlines = Array.isArray(report.headlines) ? report.headlines : [];
  const mainlines = Array.isArray(report.mainlines) ? report.mainlines : [];
  const actions = Array.isArray(report.actions)
    ? report.actions
    : Array.isArray(weather.actions)
      ? weather.actions
      : [];
  const truthStillOpen = Array.isArray(report.truth?.stillOpen) ? report.truth.stillOpen : null;

  ensureString(meta.date, 'meta.date', errors, 10);
  ensureString(meta.baseline, 'meta.baseline', errors, 7);
  ensureString(publisher.identity, 'publisher.identity', errors, 2);
  ensureString(publisher.os, 'publisher.os', errors, 2);
  ensureString(publisher.model, 'publisher.model', errors, 2);
  ensureString(publisher.version, 'publisher.version', errors, 2);

  ensureString(weather.level, 'weather.level', errors, 2);
  ensureString(weather.emoji, 'weather.emoji', errors, 1);
  ensureString(weather.label, 'weather.label', errors, 1);

  ensureArray(metrics, 'metrics', errors, 4);
  ensureArray(headlines, 'headlines', errors, 2);
  ensureArray(mainlines, 'mainlines', errors, 3);
  ensureArray(actions, 'actions', errors, 1);

  if (truthStillOpen === null) {
    errors.push('truth.stillOpen 数组缺失');
  }

  if (metrics.some(metric => typeof metric?.value !== 'string' || /^[?-]$/.test(metric.value))) {
    errors.push('metrics 包含占位符值 (? 或 -)');
  }

  if (!headlines.some(item => /\#\d+/.test(`${item?.title ?? ''} ${item?.body ?? ''}`))) {
    errors.push('headlines 缺少具体 Issue/PR 编号 (#123)');
  }

  const vagueActions = actions
    .map(item => typeof item === 'string' ? item : item?.text)
    .filter((item): item is string => typeof item === 'string')
    .filter(item => /持续关注|继续观察|保持/i.test(item));
  if (vagueActions.length > 0) {
    errors.push('actions 包含模糊表述（"持续关注"），必须是具体操作');
  }

  validateInsight(report, errors);
  validatePoolHealth(report, errors);

  const placeholders: string[] = [];
  collectPlaceholderTexts(report, placeholders);
  if (placeholders.length) {
    errors.push(`发现占位符文本: ${placeholders.slice(0, 3).join(' | ')}`);
  }

  if (errors.length) {
    throw new Error(
      '❌ 发布失败：日报数据不完整或包含占位符。\n' +
      errors.map(error => `   · ${error}`).join('\n')
    );
  }
}

function toReportJson(report: Record<string, any>, time: string): ReportData {
  const meta = { ...(report.meta ?? {}) };
  const date = meta.date ?? '';
  const title = resolveDaypart(time);
  const fileStem = `${date}-${time}`;

  return {
    schema: 'exomind-devlog-report',
    version: '1.0',
    generated: new Date().toISOString(),
    _published: {
      kind: 'report',
      date,
      time,
      file: `${fileStem}.html`,
      dataFile: `${fileStem}.json`,
    },
    ...report,
    meta: {
      ...meta,
      title,
    },
  };
}

function buildManifestEntry(report: ReportData): ManifestEntry {
  const meta = report.meta ?? {};
  const publisher = report.publisher ?? {};
  const weather = report.weather ?? {};
  const metrics = Array.isArray(report.metrics) ? report.metrics : [];
  const published = report._published;

  return {
    date: published.date,
    time: published.time,
    title: meta.title || resolveDaypart(published.time),
    file: published.file,
    dataFile: published.dataFile,
    publisher: publisher.identity ? `${publisher.identity}·${publisher.os} [${publisher.model} ${publisher.version}]` : undefined,
    weather: weather.level ? { level: weather.level, emoji: weather.emoji, label: weather.label } : undefined,
    metrics,
    url: `https://exomind-team.github.io/exomind-devlog/reports/${published.file}`,
    dataUrl: `https://exomind-team.github.io/exomind-devlog/reports/${published.dataFile}`,
  };
}

function generateLoaderHtml(dataFile: string): string {
  const templatePath = join(import.meta.dir, '..', '..', 'skills', 'dev-daily', 'assets', 'report-loader.html');
  const template = readFileSync(templatePath, 'utf-8');
  return template.replace(/dataFile:\s*'DATA_FILENAME\.json'/, `dataFile: '${dataFile}'`);
}

function updateManifest(devlogDir: string, entry: ManifestEntry): Manifest {
  const reportsDir = join(devlogDir, 'reports');
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });

  const manifestPath = join(reportsDir, 'manifest.json');
  const existing = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf-8')) as Partial<Manifest>
    : {};

  const manifest: Manifest = {
    generated: new Date().toISOString(),
    repo: existing.repo || 'exomind-team/exomind',
    latest: {
      file: entry.file,
      dataFile: entry.dataFile,
      date: entry.date,
      time: entry.time,
    },
    reports: Array.isArray(existing.reports) ? existing.reports : [],
  };

  manifest.reports = manifest.reports.filter(item => item.file !== entry.file && item.dataFile !== entry.dataFile);
  manifest.reports.unshift(entry);
  manifest.reports.sort((left, right) => `${right.date}${right.time}`.localeCompare(`${left.date}${left.time}`));

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  return manifest;
}

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function gh(...args: string[]) {
  return execFileSync('gh', args, { encoding: 'utf-8' }).trim();
}

async function waitForPagesBuild(maxWaitMs = 120_000, intervalMs = 5_000): Promise<boolean> {
  const startTime = Date.now();
  const pushTime = new Date().toISOString();

  console.log('\n⏳ 等待 GitHub Pages 构建...');

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const result = gh('api', 'repos/exomind-team/exomind-devlog/pages/builds', '--jq', '.[0] | "\\(.status) \\(.created_at)"');
      const [status, createdAt] = result.split(' ');

      if (status === 'built' && createdAt >= pushTime.substring(0, 16)) {
        console.log(`✓ Pages 构建完成 (${createdAt})`);
        return true;
      }

      if (status === 'errored') {
        console.error('✗ Pages 构建失败');
        return false;
      }

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      process.stdout.write(`\r  状态: ${status || 'queued'} (${elapsed}s)`);
    } catch {
      // ignore and retry
    }

    await new Promise(resolvePromise => setTimeout(resolvePromise, intervalMs));
  }

  console.log('\n⚠️ 等待超时，请手动检查 Pages 状态');
  return false;
}

async function verifyPagesPublication(entry: ManifestEntry, maxWaitMs = 120_000, intervalMs = 5_000) {
  const startTime = Date.now();
  let lastError = 'unknown';

  console.log('\n🔍 回读 GitHub Pages 默认入口...');

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const result = await readLatestDevlog({ type: 'report', source: 'pages' });
      const published = result.data?._published ?? {};

      if (
        result.source.resolvedSource !== 'pages-json' ||
        result.source.trust !== 'high' ||
        result.source.consistency !== 'ok'
      ) {
        throw new Error(
          `默认入口未达发布标准: resolved=${result.source.resolvedSource}, trust=${result.source.trust}, consistency=${result.source.consistency}`
        );
      }

      if (
        published.file !== entry.file ||
        published.dataFile !== entry.dataFile ||
        published.date !== entry.date ||
        published.time !== entry.time
      ) {
        throw new Error(
          `Pages 仍指向旧条目: file=${published.file ?? 'unknown'}, dataFile=${published.dataFile ?? 'unknown'}`
        );
      }

      console.log('✓ GitHub Pages 默认入口已更新并通过一致性校验');
      console.log(renderSourceBlock(result.source));
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await new Promise(resolvePromise => setTimeout(resolvePromise, intervalMs));
  }

  throw new Error(`GitHub Pages 默认入口验证失败: ${lastError}`);
}

async function main() {
  const options = parseArgs();
  const reportPath = options.reportPath || findLatestReport();
  console.log(`📄 报告文件: ${reportPath}`);

  if (!existsSync(reportPath)) throw new Error(`文件不存在: ${reportPath}`);
  if (!existsSync(options.devlogDir)) {
    throw new Error(`devlog 仓库不存在: ${options.devlogDir}\n请先克隆: gh repo clone exomind-team/exomind-devlog ${options.devlogDir}`);
  }

  const { html } = loadValidatedDevlogHtmlFile('report', reportPath);
  const reportBlock = extractObjectBlock(html, 'REPORT');
  const reportObject = parseObjectBlock(reportBlock, 'REPORT');
  validateReportData(reportObject);

  const filenameMatch = basename(reportPath).match(/(\d{4}-\d{2}-\d{2})-(\d{6})/);
  const time = filenameMatch ? filenameMatch[2] : new Date().toTimeString().replace(/:/g, '').slice(0, 6);
  const reportJson = toReportJson(reportObject, time);
  const entry = buildManifestEntry(reportJson);
  const loaderHtml = generateLoaderHtml(entry.dataFile);

  const reportsDir = join(options.devlogDir, 'reports');
  const standaloneDir = join(options.devlogDir, 'standalone');
  const jsonPath = join(reportsDir, entry.dataFile);
  const htmlPath = join(reportsDir, entry.file);
  const latestJsonPath = join(reportsDir, 'latest.json');
  const standalonePath = join(standaloneDir, basename(reportPath));

  console.log(`📅 日期: ${entry.date} ${entry.time}`);
  console.log(`📰 标题: ${entry.title}`);
  if (entry.publisher) console.log(`👤 发布者: ${entry.publisher}`);
  console.log(`🌤️ 天气: ${entry.weather?.emoji || '?'} ${entry.weather?.label || '?'}`);
  console.log(`📊 指标: ${(entry.metrics || []).map(metric => `${metric.label}=${metric.value}`).join(' · ')}`);
  console.log(`\n🧱 产物模型: reports/${entry.dataFile} + reports/${entry.file} + reports/latest.json + reports/manifest.json`);

  if (options.dryRun) {
    console.log(`\n[dry-run] 将写入 ${jsonPath}`);
    console.log(`[dry-run] 将写入 ${htmlPath}`);
    console.log(`[dry-run] 将刷新 ${latestJsonPath}`);
    console.log('[dry-run] 将更新 reports/manifest.json');
    return;
  }

  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
  if (!existsSync(standaloneDir)) mkdirSync(standaloneDir, { recursive: true });

  writeFileSync(jsonPath, JSON.stringify(reportJson, null, 2) + '\n', 'utf-8');
  console.log(`✓ JSON: reports/${entry.dataFile}`);

  writeFileSync(htmlPath, loaderHtml, 'utf-8');
  console.log(`✓ HTML Loader: reports/${entry.file}`);

  copyFileSync(jsonPath, latestJsonPath);
  console.log(`✓ latest.json → ${entry.dataFile}`);

  const manifest = updateManifest(options.devlogDir, entry);
  console.log(`✓ manifest 已更新 (共 ${manifest.reports.length} 份报告)`);

  writeFileSync(standalonePath, html, 'utf-8');
  console.log(`✓ standalone 副本: standalone/${basename(reportPath)}`);

  try {
    git(options.devlogDir, 'add', '.');
    git(options.devlogDir, 'commit', '-m', `report: ${entry.date} ${entry.title}`);
    console.log('\n✓ 已提交');
    git(options.devlogDir, 'push', 'origin', 'main');
    console.log('✓ 已推送到 origin/main');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n⚠️ Git 操作失败: ${message}`);
    console.error('文件已写入，请手动提交推送');
    return;
  }

  const built = await waitForPagesBuild();
  if (built) {
    await verifyPagesPublication(entry);
    console.log('\n📋 发布完成');
    console.log('   归档首页: https://exomind-team.github.io/exomind-devlog/');
    console.log(`   本期日报: https://exomind-team.github.io/exomind-devlog/reports/${entry.file}`);
    console.log(`   数据文件: https://exomind-team.github.io/exomind-devlog/reports/${entry.dataFile}`);
  }
}

main().catch(error => {
  console.error(`\n❌ 错误: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
