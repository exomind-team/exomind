#!/usr/bin/env bun

/**
 * publish-devlog-v2.ts — 发布开发日报（数据-渲染分离架构）
 *
 * 新架构：
 * 1. 生成独立的 JSON 数据文件 (reports/YYYY-MM-DD-HHmmss.json)
 * 2. 生成对应的 HTML 加载器 (reports/YYYY-MM-DD-HHmmss.html)
 * 3. 更新 manifest.json 和 latest.json 符号链接
 * 4. 提交推送到 GitHub Pages
 *
 * 用法:
 *   bun run scripts/dev/publish-devlog-v2.ts                    # 发布最新日报
 *   bun run scripts/dev/publish-devlog-v2.ts --report <path>    # 指定日报
 *   bun run scripts/dev/publish-devlog-v2.ts --dry-run          # 预览
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, copyFileSync, readdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

// ── Types ──

type Options = {
  reportPath: string | null;
  devlogDir: string;
  dryRun: boolean;
};

type ReportData = {
  schema: string;
  version: string;
  generated: string;
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
    throw new Error('temp/ 下未找到日报文件');
  }

  return join(tempDir, files[0]);
}

// ── Extract REPORT Object ──

function extractReportObject(html: string): object {
  const startMarker = 'const REPORT = {';
  const startIdx = html.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error('未找到 REPORT 数据对象');
  }

  // Find matching closing brace
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

  if (endIdx === -1) {
    throw new Error('未找到 REPORT 对象的结束位置');
  }

  const dataBlock = html.substring(startIdx, endIdx);
  const objectStr = dataBlock.substring(startMarker.length - 1).trim();

  try {
    return new Function(`return ${objectStr}`)();
  } catch (e) {
    throw new Error(`解析 REPORT 对象失败: ${e}`);
  }
}

// ── Generate JSON Data ──

function generateJsonData(reportObj: any): ReportData {
  return {
    schema: 'exomind-devlog-report',
    version: '1.0',
    generated: new Date().toISOString(),
    ...reportObj,
  };
}

// ── Generate HTML Loader ──

function generateHtmlLoader(jsonFilename: string, reportData: ReportData): string {
  const loaderTemplate = readFileSync(
    join(import.meta.dir, '..', '..', 'skills', 'dev-daily', 'assets', 'report-loader-v2.html'),
    'utf-8'
  );

  // Replace DATA_FILENAME.json with actual filename
  return loaderTemplate.replace(
    /dataFile:\s*'DATA_FILENAME\.json'/,
    `dataFile: '${jsonFilename}'`
  );
}

// ── Parse Manifest Entry ──

function parseManifestEntry(reportData: ReportData, timeStr: string): ManifestEntry {
  const meta = reportData.meta || {};
  const publisher = reportData.publisher || {};
  const weather = reportData.weather || {};
  const metrics = reportData.metrics || [];

  const hour = parseInt(timeStr.substring(0, 2), 10);
  const title = hour < 6 ? '开发夜报' : hour < 12 ? '开发早报' : hour < 18 ? '开发午报' : '开发晚报';

  return {
    date: meta.date || '',
    time: timeStr,
    title,
    file: `${meta.date}-${timeStr}.html`,
    dataFile: `${meta.date}-${timeStr}.json`,
    publisher: publisher.identity
      ? `${publisher.identity}·${publisher.os} [${publisher.model} ${publisher.version}]`
      : undefined,
    weather: weather.level ? {
      level: weather.level,
      emoji: weather.emoji,
      label: weather.label,
    } : undefined,
    metrics: metrics.length ? metrics : undefined,
  };
}

// ── Update Manifest ──

function updateManifest(devlogDir: string, entry: ManifestEntry): any {
  const manifestPath = join(devlogDir, 'manifest.json');
  let manifest: any = { generated: '', repo: 'exomind-team/exomind', reports: [], routes: [] };

  if (existsSync(manifestPath)) {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  }

  // Remove existing entry with same date+time
  manifest.reports = manifest.reports.filter(
    (r: any) => !(r.date === entry.date && r.time === entry.time)
  );

  // Add new entry at the beginning
  manifest.reports.unshift({
    ...entry,
    url: `https://exomind-team.github.io/exomind-devlog/reports/${entry.file}`,
    dataUrl: `https://raw.githubusercontent.com/exomind-team/exomind-devlog/main/reports/${entry.dataFile}`,
  });

  // Update latest pointer
  manifest.latest = {
    report: `reports/${entry.dataFile}`,
    reportHtml: `reports/${entry.file}`,
  };

  manifest.generated = new Date().toISOString();

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  return manifest;
}

// ── Git Helper ──

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
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
    throw new Error(`devlog 仓库不存在: ${opts.devlogDir}`);
  }

  // 3. Extract REPORT object
  console.log('📦 提取 REPORT 对象...');
  const html = readFileSync(reportPath, 'utf-8');
  const reportObj = extractReportObject(html);

  // 4. Generate JSON data
  console.log('🔧 生成 JSON 数据...');
  const jsonData = generateJsonData(reportObj);

  // 5. Derive time from filename
  const fnameMatch = basename(reportPath).match(/(\d{4}-\d{2}-\d{2})-(\d{6})/);
  const timeStr = fnameMatch
    ? fnameMatch[2]
    : new Date().toTimeString().replace(/:/g, '').substring(0, 6);

  const entry = parseManifestEntry(jsonData, timeStr);

  console.log(`📅 日期: ${entry.date} ${timeStr}`);
  console.log(`📰 标题: ${entry.title}`);
  if (entry.publisher) console.log(`👤 发布者: ${entry.publisher}`);
  console.log(`🌤️ 天气: ${entry.weather?.emoji || '?'} ${entry.weather?.label || '?'}`);

  // 6. Generate HTML loader
  console.log('🌐 生成 HTML 加载器...');
  const htmlLoader = generateHtmlLoader(entry.dataFile, jsonData);

  const jsonPath = join(opts.devlogDir, 'reports', entry.dataFile);
  const htmlPath = join(opts.devlogDir, 'reports', entry.file);

  if (opts.dryRun) {
    console.log(`\n[dry-run] 将写入 ${jsonPath}`);
    console.log(`[dry-run] 将写入 ${htmlPath}`);
    console.log('[dry-run] 未执行任何操作');
    return;
  }

  // 7. Write files
  writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2), 'utf-8');
  console.log(`✓ JSON: reports/${entry.dataFile}`);

  writeFileSync(htmlPath, htmlLoader, 'utf-8');
  console.log(`✓ HTML: reports/${entry.file}`);

  // 8. Create latest.json symlink (copy on Windows/Android)
  const latestJsonPath = join(opts.devlogDir, 'reports', 'latest.json');
  copyFileSync(jsonPath, latestJsonPath);
  console.log(`✓ latest.json → ${entry.dataFile}`);

  // 9. Update manifest
  const manifest = updateManifest(opts.devlogDir, entry);
  console.log(`✓ manifest 已更新 (共 ${manifest.reports.length} 份报告)`);

  // 10. Git commit & push
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

  // 11. Output URLs
  const reportUrl = `https://exomind-team.github.io/exomind-devlog/reports/${entry.file}`;
  const dataUrl = `https://raw.githubusercontent.com/exomind-team/exomind-devlog/main/reports/${entry.dataFile}`;
  const latestDataUrl = `https://raw.githubusercontent.com/exomind-team/exomind-devlog/main/reports/latest.json`;

  console.log(`\n📋 发布完成`);
  console.log(`   HTML: ${reportUrl}`);
  console.log(`   JSON: ${dataUrl}`);
  console.log(`   最新: ${latestDataUrl}`);
}

main().catch(e => {
  console.error(`\n❌ 错误: ${e.message}`);
  process.exit(1);
});
