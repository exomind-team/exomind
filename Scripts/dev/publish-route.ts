#!/usr/bin/env bun

/**
 * publish-route.ts — 将开发航线发布到 exomind-devlog GitHub Pages 仓库
 *
 * 用法:
 *   bun run route:publish                           # 发布 temp/ 下最新的航线
 *   bun run route:publish --route <path>            # 指定航线文件
 *   bun run route:publish --devlog-dir <path>       # 指定 devlog 仓库路径
 *   bun run route:publish --dry-run                 # 预览，不提交推送
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

// ── Types ──

type Options = {
  routePath: string | null;
  devlogDir: string;
  dryRun: boolean;
};

type ManifestEntry = {
  date: string;
  time: string;    // HHmmss
  title: string;
  file: string;
  publisher?: string;  // 自我身份·所在系统 [名称 版本]
  status?: { level: string; emoji: string; label: string };
  metrics?: { label: string; value: string; note: string }[];
};

type Manifest = {
  generated: string;
  repo: string;
  routes: ManifestEntry[];
};

// ── Arg Parsing ──

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

// ── Find Latest Route ──

function findLatestRoute(): string {
  const tempDir = resolve(join(import.meta.dir, '..', '..', 'temp'));
  if (!existsSync(tempDir)) {
    throw new Error(`temp/ 目录不存在: ${tempDir}`);
  }

  const files = readdirSync(tempDir)
    .filter(f => f.startsWith('exomind-route-') && f.endsWith('.html'))
    .sort()
    .reverse();

  if (!files.length) {
    throw new Error('temp/ 下未找到航线文件 (exomind-route-*.html)');
  }

  return join(tempDir, files[0]);
}

// ── Extract ROUTE Data ──

function extractRouteData(html: string): string {
  // Find the ROUTE object: starts with "const ROUTE = {" and ends before the rendering engine comment
  const startMarker = 'const ROUTE = {';
  const endMarker = '// ═══';

  const startIdx = html.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error('未找到 ROUTE 数据对象 (const ROUTE = {)');
  }

  const endIdx = html.indexOf(endMarker, startIdx);
  if (endIdx === -1) {
    throw new Error('未找到渲染引擎注释边界 (// ═══)');
  }

  // Extract from "const ROUTE = {" to the end of the object ("};" before the comment)
  let data = html.substring(startIdx, endIdx).trimEnd();

  // Remove trailing whitespace/newlines and ensure it ends with };
  if (!data.endsWith('};')) {
    const lastSemicolon = data.lastIndexOf('};');
    if (lastSemicolon !== -1) {
      data = data.substring(0, lastSemicolon + 2);
    }
  }

  return data;
}

// ── Parse ROUTE fields for manifest ──

function parseRouteFields(dataBlock: string): ManifestEntry {
  // Using a safe approach: regex extraction of key fields
  const getStr = (key: string): string => {
    const m = dataBlock.match(new RegExp(`${key}:\\s*'([^']*)'`));
    return m ? m[1] : '';
  };

  const date = getStr('date');
  const title = getStr('title');

  if (!date) throw new Error('ROUTE.meta.date 为空');

  // Status
  const statusLevel = getStr('level');
  const statusEmoji = getStr('emoji');
  const statusLabel = getStr('label');

  // Metrics — extract array entries (航线 metrics 用 note 而非 delta/trend)
  const metricsBlock = dataBlock.match(/metrics:\s*\[([\s\S]*?)\],\s*\n\s*(?:tracks|\/\/)/);
  const metrics: ManifestEntry['metrics'] = [];

  if (metricsBlock) {
    const metricPattern = /\{\s*label:\s*'([^']*)',\s*value:\s*'([^']*)',\s*note:\s*'([^']*)'/g;
    let m;
    while ((m = metricPattern.exec(metricsBlock[1])) !== null) {
      metrics.push({ label: m[1], value: m[2], note: m[3] });
    }
  }

  // Publisher
  const pubIdentity = getStr('identity');
  const pubOs = getStr('os');
  const pubModel = getStr('model');
  const pubVersion = getStr('version');
  const publisher = pubIdentity
    ? `${pubIdentity}·${pubOs} [${pubModel} ${pubVersion}]`
    : undefined;

  return {
    date,
    time: '',   // filled by caller with timestamp
    title: title || '开发航线',
    file: '',   // filled by caller with timestamp
    publisher,
    status: statusLevel ? { level: statusLevel, emoji: statusEmoji, label: statusLabel } : undefined,
    metrics: metrics.length ? metrics : undefined,
  };
}

// ── Generate Thin HTML ──

function generateThinHtml(entry: ManifestEntry, dataBlock: string): string {
  const date = entry.date;
  const title = entry.title || '开发航线';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ExoMind ${title} · ${date}</title>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Outfit:wght@300;500;700;900&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/dagre@0.8.5/dist/dagre.min.js"><\/script>
<link rel="stylesheet" href="../assets/route-style.css">
</head>
<body>
<div class="container" id="app"></div>
<script>
${dataBlock}
<\/script>
<script src="../assets/route-engine.js"><\/script>
</body>
</html>
`;
}

// ── Update Manifest ──

function updateManifest(devlogDir: string, entry: ManifestEntry): Manifest {
  const routesDir = join(devlogDir, 'routes');
  if (!existsSync(routesDir)) {
    mkdirSync(routesDir, { recursive: true });
  }

  const manifestPath = join(routesDir, 'manifest.json');
  let manifest: Manifest;

  if (existsSync(manifestPath)) {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } else {
    manifest = { generated: '', repo: 'exomind-team/exomind', routes: [] };
  }

  // Remove existing entry for same file (allow multiple per day)
  manifest.routes = manifest.routes.filter(r => r.file !== entry.file);
  // Add new entry
  manifest.routes.push(entry);
  // Sort by date+time descending (newest first)
  manifest.routes.sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
  // Update timestamp
  manifest.generated = new Date().toISOString();

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  return manifest;
}

// ── Git Operations ──

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

// ── GitHub Pages Build Monitor ──

function gh(...args: string[]): string {
  return execFileSync('gh', args, { encoding: 'utf-8' }).trim();
}

async function waitForPagesBuild(maxWaitMs = 120_000, intervalMs = 5_000): Promise<boolean> {
  const startTime = Date.now();
  const pushTime = new Date().toISOString();

  console.log('\n⏳ 等待 GitHub Pages 构建...');

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const result = gh(
        'api', 'repos/exomind-team/exomind-devlog/pages/builds',
        '--jq', '.[0] | "\\(.status) \\(.created_at)"'
      );
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
      // API call failed, retry
    }

    await new Promise(r => setTimeout(r, intervalMs));
  }

  console.log('\n⚠️ 等待超时，请手动检查 Pages 状态');
  return false;
}

// ── Main ──

async function main() {
  const opts = parseArgs();

  // 1. Find route
  const routePath = opts.routePath || findLatestRoute();
  console.log(`📄 航线文件: ${routePath}`);

  if (!existsSync(routePath)) {
    throw new Error(`文件不存在: ${routePath}`);
  }

  // 2. Validate devlog dir
  if (!existsSync(opts.devlogDir)) {
    throw new Error(`devlog 仓库不存在: ${opts.devlogDir}\n请先克隆: gh repo clone exomind-team/exomind-devlog ${opts.devlogDir}`);
  }

  // 3. Ensure routes/ directory exists
  const routesDir = join(opts.devlogDir, 'routes');
  if (!existsSync(routesDir)) {
    mkdirSync(routesDir, { recursive: true });
  }

  // 4. Read and extract
  const html = readFileSync(routePath, 'utf-8');
  const dataBlock = extractRouteData(html);
  const entry = parseRouteFields(dataBlock);

  // Derive time from source filename (YYYY-MM-DD-HHmmss) or use current time
  const fnameMatch = basename(routePath).match(/(\d{4}-\d{2}-\d{2})-(\d{6})/);
  const timeStr = fnameMatch
    ? fnameMatch[2]
    : new Date().toTimeString().replace(/:/g, '').substring(0, 6);
  entry.time = timeStr;
  entry.file = `${entry.date}-${timeStr}.html`;

  console.log(`📅 日期: ${entry.date} ${timeStr}`);
  console.log(`📰 标题: ${entry.title}`);
  if (entry.publisher) console.log(`👤 发布者: ${entry.publisher}`);
  console.log(`⛅ 状态: ${entry.status?.emoji || '?'} ${entry.status?.label || '?'}`);
  console.log(`📊 指标: ${(entry.metrics || []).map(m => `${m.label}=${m.value}`).join(' · ')}`);

  // 5. Generate thin HTML
  const thinHtml = generateThinHtml(entry, dataBlock);
  const outputPath = join(routesDir, entry.file);

  console.log(`\n📝 生成薄 HTML: routes/${entry.file}`);

  if (opts.dryRun) {
    console.log(`\n[dry-run] 将写入 ${outputPath}`);
    console.log(`[dry-run] 将更新 routes/manifest.json`);
    console.log('[dry-run] 未执行任何操作');
    return;
  }

  // 6. Write files
  writeFileSync(outputPath, thinHtml, 'utf-8');
  console.log(`✓ 已写入: ${outputPath}`);

  // 7. Update manifest
  const manifest = updateManifest(opts.devlogDir, entry);
  console.log(`✓ manifest 已更新 (共 ${manifest.routes.length} 份航线)`);

  // 8. Also copy standalone version
  const standaloneDir = join(opts.devlogDir, 'standalone');
  if (!existsSync(standaloneDir)) {
    mkdirSync(standaloneDir, { recursive: true });
  }
  const standalonePath = join(standaloneDir, basename(routePath));
  writeFileSync(standalonePath, html, 'utf-8');
  console.log(`✓ standalone 副本: standalone/${basename(routePath)}`);

  // 9. Git commit & push
  try {
    git(opts.devlogDir, 'add', '.');
    git(opts.devlogDir, 'commit', '-m', `route: ${entry.date} ${entry.title}`);
    console.log(`\n✓ 已提交`);

    git(opts.devlogDir, 'push', 'origin', 'main');
    console.log('✓ 已推送到 origin/main');
  } catch (e: any) {
    console.error(`\n⚠️ Git 操作失败: ${e.message}`);
    console.error('文件已写入，请手动提交推送');
    return;
  }

  // 10. Wait for GitHub Pages build
  const routeUrl = `https://exomind-team.github.io/exomind-devlog/routes/${entry.file}`;
  const indexUrl = 'https://exomind-team.github.io/exomind-devlog/';

  const built = await waitForPagesBuild();
  if (built) {
    console.log(`\n📋 发布完成`);
    console.log(`   归档首页: ${indexUrl}`);
    console.log(`   本期航线: ${routeUrl}`);
  }
}

main();
