#!/usr/bin/env bun

/**
 * publish-route.ts — 统一发布开发航线到 exomind-devlog GitHub Pages 仓库
 *
 * 标准产物：
 * - routes/YYYY-MM-DD-HHmmss.json
 * - routes/YYYY-MM-DD-HHmmss.html
 * - routes/latest.json
 * - routes/manifest.json
 *
 * 用法:
 *   bun run route:publish
 *   bun run route:publish --route <path>
 *   bun run route:publish --devlog-dir <path>
 *   bun run route:publish --dry-run
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { readLatestDevlog, renderSourceBlock } from './extract-devlog';

type Options = {
  routePath: string | null;
  devlogDir: string;
  dryRun: boolean;
};

type RouteData = {
  schema: 'exomind-devlog-route';
  version: '1.0';
  generated: string;
  _published: {
    kind: 'route';
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
  status?: { level: string; emoji: string; label: string };
  metrics?: { label: string; value: string; note: string }[];
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
  routes: ManifestEntry[];
};

function parseArgs(): Options {
  const args = process.argv.slice(2);
  let routePath: string | null = null;
  let devlogDir = resolve(join(import.meta.dir, '..', '..', '..', 'exomind-devlog'));
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--route' && args[i + 1]) {
      routePath = resolve(args[++i]);
    } else if (args[i] === '--devlog-dir' && args[i + 1]) {
      devlogDir = resolve(args[++i]);
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    }
  }

  return { routePath, devlogDir, dryRun };
}

function findLatestRoute(): string {
  const tempDir = resolve(join(import.meta.dir, '..', '..', 'temp'));
  if (!existsSync(tempDir)) throw new Error(`temp/ 目录不存在: ${tempDir}`);

  const files = readdirSync(tempDir)
    .filter(file => file.startsWith('exomind-route-') && file.endsWith('.html'))
    .sort()
    .reverse();

  if (!files.length) throw new Error('temp/ 下未找到航线文件 (exomind-route-*.html)');
  return join(tempDir, files[0]);
}

function extractObjectBlock(html: string, variableName: 'ROUTE'): string {
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

function parseObjectBlock(block: string, variableName: 'ROUTE'): Record<string, any> {
  const objectLiteral = block.replace(new RegExp(`^const\\s+${variableName}\\s*=\\s*`), '');
  const parsed = Function(`"use strict"; return (${objectLiteral});`)();
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${variableName} 解析结果不是对象`);
  }
  return parsed as Record<string, any>;
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
  const placeholderPattern = /数据缺失|暂无数据|查询失败|聚类失败|TODO|请填写|placeholder/i;
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

function validateRouteData(route: Record<string, any>) {
  const errors: string[] = [];
  const meta = route.meta ?? {};
  const publisher = route.publisher ?? {};
  const status = route.status ?? {};
  const metrics = Array.isArray(route.metrics) ? route.metrics : [];
  const batches = Array.isArray(route.batches) ? route.batches : [];
  const actions = Array.isArray(route.actions) ? route.actions : [];
  const heatmap = route.heatmap ?? {};
  const insight = typeof route.insight === 'string'
    ? route.insight
    : typeof route.insight?.text === 'string'
      ? route.insight.text
      : '';

  ensureString(meta.date, 'meta.date', errors, 10);
  ensureString(meta.baseline, 'meta.baseline', errors, 7);
  ensureString(publisher.identity, 'publisher.identity', errors, 2);
  ensureString(publisher.os, 'publisher.os', errors, 2);
  ensureString(publisher.model, 'publisher.model', errors, 2);
  ensureString(publisher.version, 'publisher.version', errors, 2);

  ensureString(status.level, 'status.level', errors, 2);
  ensureString(status.emoji, 'status.emoji', errors, 1);
  ensureString(status.label, 'status.label', errors, 2);

  ensureArray(metrics, 'metrics', errors, 3);
  ensureArray(batches, 'batches', errors, 3);
  ensureArray(heatmap.data, 'heatmap.data', errors, 1);
  ensureArray(actions, 'actions', errors, 1);
  ensureString(insight, 'insight', errors, 20);

  batches.forEach((batch, index) => {
    const issues = Array.isArray(batch?.issues) ? batch.issues : [];
    if (issues.length < 3 || issues.length > 12) {
      errors.push(`batches[${index}].issues 数量为 ${issues.length}，必须在 3-12 范围内`);
    }
    if (typeof batch?.track !== 'string' || !batch.track.trim()) {
      errors.push(`batches[${index}].track 缺失`);
    }
  });

  const vagueActions = actions
    .map(item => typeof item === 'string' ? item : item?.text)
    .filter((item): item is string => typeof item === 'string')
    .filter(item => /持续关注|继续观察|保持/i.test(item));
  if (vagueActions.length) {
    errors.push('actions 包含模糊表述，必须指向具体批次或 issue');
  }

  const placeholders: string[] = [];
  collectPlaceholderTexts(route, placeholders);
  if (placeholders.length) {
    errors.push(`发现占位符文本: ${placeholders.slice(0, 3).join(' | ')}`);
  }

  if (errors.length) {
    throw new Error(
      '❌ 发布失败：航线数据不完整或包含占位符。\n' +
      errors.map(error => `   · ${error}`).join('\n')
    );
  }
}

function toRouteJson(route: Record<string, any>, time: string): RouteData {
  const meta = { ...(route.meta ?? {}) };
  const date = meta.date ?? '';
  const fileStem = `${date}-${time}`;

  return {
    schema: 'exomind-devlog-route',
    version: '1.0',
    generated: new Date().toISOString(),
    _published: {
      kind: 'route',
      date,
      time,
      file: `${fileStem}.html`,
      dataFile: `${fileStem}.json`,
    },
    ...route,
    meta,
  };
}

function buildManifestEntry(route: RouteData): ManifestEntry {
  const meta = route.meta ?? {};
  const publisher = route.publisher ?? {};
  const status = route.status ?? {};
  const metrics = Array.isArray(route.metrics) ? route.metrics : [];
  const published = route._published;

  return {
    date: published.date,
    time: published.time,
    title: meta.title || '开发航线',
    file: published.file,
    dataFile: published.dataFile,
    publisher: publisher.identity ? `${publisher.identity}·${publisher.os} [${publisher.model} ${publisher.version}]` : undefined,
    status: status.level ? { level: status.level, emoji: status.emoji, label: status.label } : undefined,
    metrics,
    url: `https://exomind-team.github.io/exomind-devlog/routes/${published.file}`,
    dataUrl: `https://exomind-team.github.io/exomind-devlog/routes/${published.dataFile}`,
  };
}

function generateLoaderHtml(dataFile: string): string {
  const templatePath = join(import.meta.dir, '..', '..', 'skills', 'dev-route', 'assets', 'route-loader.html');
  const template = readFileSync(templatePath, 'utf-8');
  return template.replace(/dataFile:\s*'DATA_FILENAME\.json'/, `dataFile: '${dataFile}'`);
}

function updateManifest(devlogDir: string, entry: ManifestEntry): Manifest {
  const routesDir = join(devlogDir, 'routes');
  if (!existsSync(routesDir)) mkdirSync(routesDir, { recursive: true });

  const manifestPath = join(routesDir, 'manifest.json');
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
    routes: Array.isArray(existing.routes) ? existing.routes : [],
  };

  manifest.routes = manifest.routes.filter(item => item.file !== entry.file && item.dataFile !== entry.dataFile);
  manifest.routes.unshift(entry);
  manifest.routes.sort((left, right) => `${right.date}${right.time}`.localeCompare(`${left.date}${left.time}`));

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
      const result = await readLatestDevlog({ type: 'route', source: 'pages' });
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
  const routePath = options.routePath || findLatestRoute();
  console.log(`📄 航线文件: ${routePath}`);

  if (!existsSync(routePath)) throw new Error(`文件不存在: ${routePath}`);
  if (!existsSync(options.devlogDir)) {
    throw new Error(`devlog 仓库不存在: ${options.devlogDir}\n请先克隆: gh repo clone exomind-team/exomind-devlog ${options.devlogDir}`);
  }

  const html = readFileSync(routePath, 'utf-8');
  const routeBlock = extractObjectBlock(html, 'ROUTE');
  const routeObject = parseObjectBlock(routeBlock, 'ROUTE');
  validateRouteData(routeObject);

  const filenameMatch = basename(routePath).match(/(\d{4}-\d{2}-\d{2})-(\d{6})/);
  const time = filenameMatch ? filenameMatch[2] : new Date().toTimeString().replace(/:/g, '').slice(0, 6);
  const routeJson = toRouteJson(routeObject, time);
  const entry = buildManifestEntry(routeJson);
  const loaderHtml = generateLoaderHtml(entry.dataFile);

  const routesDir = join(options.devlogDir, 'routes');
  const standaloneDir = join(options.devlogDir, 'standalone');
  const jsonPath = join(routesDir, entry.dataFile);
  const htmlPath = join(routesDir, entry.file);
  const latestJsonPath = join(routesDir, 'latest.json');
  const standalonePath = join(standaloneDir, basename(routePath));

  console.log(`📅 日期: ${entry.date} ${entry.time}`);
  console.log(`📰 标题: ${entry.title}`);
  if (entry.publisher) console.log(`👤 发布者: ${entry.publisher}`);
  console.log(`⛅ 状态: ${entry.status?.emoji || '?'} ${entry.status?.label || '?'}`);
  console.log(`📊 指标: ${(entry.metrics || []).map(metric => `${metric.label}=${metric.value}`).join(' · ')}`);
  console.log(`\n🧱 产物模型: routes/${entry.dataFile} + routes/${entry.file} + routes/latest.json + routes/manifest.json`);

  if (options.dryRun) {
    console.log(`\n[dry-run] 将写入 ${jsonPath}`);
    console.log(`[dry-run] 将写入 ${htmlPath}`);
    console.log(`[dry-run] 将刷新 ${latestJsonPath}`);
    console.log('[dry-run] 将更新 routes/manifest.json');
    return;
  }

  if (!existsSync(routesDir)) mkdirSync(routesDir, { recursive: true });
  if (!existsSync(standaloneDir)) mkdirSync(standaloneDir, { recursive: true });

  writeFileSync(jsonPath, JSON.stringify(routeJson, null, 2) + '\n', 'utf-8');
  console.log(`✓ JSON: routes/${entry.dataFile}`);

  writeFileSync(htmlPath, loaderHtml, 'utf-8');
  console.log(`✓ HTML Loader: routes/${entry.file}`);

  copyFileSync(jsonPath, latestJsonPath);
  console.log(`✓ latest.json → ${entry.dataFile}`);

  const manifest = updateManifest(options.devlogDir, entry);
  console.log(`✓ manifest 已更新 (共 ${manifest.routes.length} 份航线)`);

  writeFileSync(standalonePath, html, 'utf-8');
  console.log(`✓ standalone 副本: standalone/${basename(routePath)}`);

  try {
    git(options.devlogDir, 'add', '.');
    git(options.devlogDir, 'commit', '-m', `route: ${entry.date} ${entry.title}`);
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
    console.log(`   归档首页: https://exomind-team.github.io/exomind-devlog/`);
    console.log(`   本期航线: https://exomind-team.github.io/exomind-devlog/routes/${entry.file}`);
    console.log(`   数据文件: https://exomind-team.github.io/exomind-devlog/routes/${entry.dataFile}`);
  }
}

main().catch(error => {
  console.error(`\n❌ 错误: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
