#!/usr/bin/env bun

/**
 * publish-devlog.ts — 将开发日报发布到 exomind-devlog GitHub Pages 仓库
 *
 * 用法:
 *   bun run devlog:publish                           # 发布 temp/ 下最新的日报
 *   bun run devlog:publish --report <path>           # 指定日报文件
 *   bun run devlog:publish --devlog-dir <path>       # 指定 devlog 仓库路径
 *   bun run devlog:publish --dry-run                 # 预览，不提交推送
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

// ── Types ──

type Options = {
  reportPath: string | null;
  devlogDir: string;
  dryRun: boolean;
};

type ManifestEntry = {
  date: string;
  time: string;    // HHmmss
  title: string;
  file: string;
  publisher?: string;  // 自我身份·所在系统 [名称 版本]
  weather?: { level: string; emoji: string; label: string };
  metrics?: { label: string; value: string; delta: string; trend: string }[];
};

type Manifest = {
  generated: string;
  repo: string;
  reports: ManifestEntry[];
};

// ── Arg Parsing ──

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

// ── Find Latest Report ──

function findLatestReport(): string {
  const tempDir = resolve(join(import.meta.dir, '..', '..', 'temp'));
  if (!existsSync(tempDir)) {
    throw new Error(`temp/ 目录不存在: ${tempDir}`);
  }

  const files = readdirSync(tempDir)
    .filter(f => f.startsWith('exomind-daily-report-') && f.endsWith('.html'))
    .sort()
    .reverse();

  if (!files.length) {
    throw new Error('temp/ 下未找到日报文件 (exomind-daily-report-*.html)');
  }

  return join(tempDir, files[0]);
}

// ── Extract REPORT Data ──

function extractReportData(html: string): string {
  // Find the REPORT object: starts with "const REPORT = {" and ends before the rendering engine comment
  const startMarker = 'const REPORT = {';
  const endMarker = '// ╔══';

  const startIdx = html.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error('未找到 REPORT 数据对象 (const REPORT = {)');
  }

  const endIdx = html.indexOf(endMarker, startIdx);
  if (endIdx === -1) {
    throw new Error('未找到渲染引擎注释边界 (// ╔══)');
  }

  // Extract from "const REPORT = {" to the end of the object ("};" before the comment)
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

// ── Parse REPORT fields for manifest ──

function parseReportFields(dataBlock: string): ManifestEntry {
  // Evaluate the data block to extract fields
  // Using a safe approach: regex extraction of key fields
  const getStr = (key: string): string => {
    const m = dataBlock.match(new RegExp(`${key}:\\s*'([^']*)'`));
    return m ? m[1] : '';
  };

  const date = getStr('date');
  const title = getStr('title');

  if (!date) throw new Error('REPORT.meta.date 为空');

  // Weather
  const weatherLevel = getStr('level');
  const weatherEmoji = getStr('emoji');
  const weatherLabel = getStr('label');

  // Metrics — extract array entries
  const metricsBlock = dataBlock.match(/metrics:\s*\[([\s\S]*?)\],\s*\n\s*\/\//);
  const metrics: ManifestEntry['metrics'] = [];

  if (metricsBlock) {
    const metricPattern = /\{\s*label:\s*'([^']*)',\s*value:\s*'([^']*)',\s*delta:\s*'([^']*)',\s*trend:\s*'([^']*)'/g;
    let m;
    while ((m = metricPattern.exec(metricsBlock[1])) !== null) {
      metrics.push({ label: m[1], value: m[2], delta: m[3], trend: m[4] });
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
    title: title || '开发日志',
    file: '',   // filled by caller with timestamp
    publisher,
    weather: weatherLevel ? { level: weatherLevel, emoji: weatherEmoji, label: weatherLabel } : undefined,
    metrics: metrics.length ? metrics : undefined,
  };
}

// ── Generate Thin HTML ──

function generateThinHtml(entry: ManifestEntry, dataBlock: string): string {
  const date = entry.date;
  const title = entry.title || '开发日志';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ExoMind ${title} · ${date}</title>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Outfit:wght@300;500;700;900&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"><\/script>
<link rel="stylesheet" href="../assets/report-style.css">
</head>
<body>
<div class="container" id="app"></div>
<script>
${dataBlock}
<\/script>
<script src="../assets/report-engine.js"><\/script>
</body>
</html>
`;
}

// ── Update Manifest ──

function updateManifest(devlogDir: string, entry: ManifestEntry): Manifest {
  const manifestPath = join(devlogDir, 'reports', 'manifest.json');
  let manifest: Manifest;

  if (existsSync(manifestPath)) {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } else {
    manifest = { generated: '', repo: 'exomind-team/exomind', reports: [] };
  }

  // Remove existing entry for same file (allow multiple per day)
  manifest.reports = manifest.reports.filter(r => r.file !== entry.file);
  // Add new entry
  manifest.reports.push(entry);
  // Sort by date+time descending (newest first)
  manifest.reports.sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
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

  // 1. Find report
  const reportPath = opts.reportPath || findLatestReport();
  console.log(`📄 报告文件: ${reportPath}`);

  if (!existsSync(reportPath)) {
    throw new Error(`文件不存在: ${reportPath}`);
  }

  // 2. Validate devlog dir
  if (!existsSync(opts.devlogDir)) {
    throw new Error(`devlog 仓库不存在: ${opts.devlogDir}\n请先克隆: gh repo clone exomind-team/exomind-devlog ${opts.devlogDir}`);
  }

  // 3. Read and extract
  const html = readFileSync(reportPath, 'utf-8');
  const dataBlock = extractReportData(html);
  const entry = parseReportFields(dataBlock);

  // Derive time from source filename (YYYY-MM-DD-HHmmss) or use current time
  const fnameMatch = basename(reportPath).match(/(\d{4}-\d{2}-\d{2})-(\d{6})/);
  const timeStr = fnameMatch
    ? fnameMatch[2]
    : new Date().toTimeString().replace(/:/g, '').substring(0, 6);
  entry.time = timeStr;
  entry.file = `${entry.date}-${timeStr}.html`;

  console.log(`📅 日期: ${entry.date} ${timeStr}`);
  console.log(`📰 标题: ${entry.title}`);
  if (entry.publisher) console.log(`👤 发布者: ${entry.publisher}`);
  console.log(`🌤️ 天气: ${entry.weather?.emoji || '?'} ${entry.weather?.label || '?'}`);
  console.log(`📊 指标: ${(entry.metrics || []).map(m => `${m.label}=${m.value}`).join(' · ')}`);

  // 4. Generate thin HTML
  const thinHtml = generateThinHtml(entry, dataBlock);
  const outputPath = join(opts.devlogDir, 'reports', entry.file);

  console.log(`\n📝 生成薄 HTML: reports/${entry.file}`);

  if (opts.dryRun) {
    console.log(`\n[dry-run] 将写入 ${outputPath}`);
    console.log(`[dry-run] 将更新 reports/manifest.json`);
    console.log('[dry-run] 未执行任何操作');
    return;
  }

  // 5. Write files
  writeFileSync(outputPath, thinHtml, 'utf-8');
  console.log(`✓ 已写入: ${outputPath}`);

  // 6. Update manifest
  const manifest = updateManifest(opts.devlogDir, entry);
  console.log(`✓ manifest 已更新 (共 ${manifest.reports.length} 份报告)`);

  // 7. Also copy standalone version
  const standalonePath = join(opts.devlogDir, 'standalone', basename(reportPath));
  writeFileSync(standalonePath, html, 'utf-8');
  console.log(`✓ standalone 副本: standalone/${basename(reportPath)}`);

  // 8. Git commit & push
  try {
    git(opts.devlogDir, 'add', '.');
    git(opts.devlogDir, 'commit', '-m', `report: ${entry.date} ${entry.title}`);
    console.log(`\n✓ 已提交`);

    git(opts.devlogDir, 'push', 'origin', 'main');
    console.log('✓ 已推送到 origin/main');
  } catch (e: any) {
    console.error(`\n⚠️ Git 操作失败: ${e.message}`);
    console.error('文件已写入，请手动提交推送');
    return;
  }

  // 9. Wait for GitHub Pages build
  const reportUrl = `https://exomind-team.github.io/exomind-devlog/reports/${entry.file}`;
  const indexUrl = 'https://exomind-team.github.io/exomind-devlog/';

  const built = await waitForPagesBuild();
  if (built) {
    console.log(`\n📋 发布完成`);
    console.log(`   归档首页: ${indexUrl}`);
    console.log(`   本期日报: ${reportUrl}`);
  }
}

main();
