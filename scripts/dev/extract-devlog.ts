#!/usr/bin/env bun

/**
 * extract-devlog.ts — 从 devlog HTML 中提取 REPORT/ROUTE 数据，生成 Agent 友好的文本或 JSON
 *
 * 用法:
 *   bun scripts/dev/extract-devlog.ts --type report                # 最新日报，文本格式
 *   bun scripts/dev/extract-devlog.ts --type route                 # 最新航线，文本格式
 *   bun scripts/dev/extract-devlog.ts --type report --format json  # JSON 格式
 *   bun scripts/dev/extract-devlog.ts --file <path>                # 指定文件（自动检测类型）
 *   bun scripts/dev/extract-devlog.ts --type report --source devlog # 从 devlog 仓库读取
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

// ── Types ──

type Format = 'text' | 'json';
type DocType = 'report' | 'route';

type Options = {
  type: DocType | null;
  format: Format;
  file: string | null;
  source: 'temp' | 'devlog';
};

// ── Arg Parsing ──

function parseArgs(): Options {
  const args = process.argv.slice(2);
  let type: DocType | null = null;
  let format: Format = 'text';
  let file: string | null = null;
  let source: 'temp' | 'devlog' = 'temp';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--type' && args[i + 1]) {
      const t = args[++i];
      if (t === 'report' || t === 'route') type = t;
      else throw new Error(`未知类型: ${t}（支持 report / route）`);
    } else if (args[i] === '--format' && args[i + 1]) {
      const f = args[++i];
      if (f === 'text' || f === 'json') format = f;
      else throw new Error(`未知格式: ${f}（支持 text / json）`);
    } else if (args[i] === '--file' && args[i + 1]) {
      file = resolve(args[++i]);
    } else if (args[i] === '--source' && args[i + 1]) {
      const s = args[++i];
      if (s === 'temp' || s === 'devlog') source = s;
    }
  }

  return { type, format, file, source };
}

// ── File Discovery ──

function findLatestFile(docType: DocType, source: 'temp' | 'devlog'): string {
  if (source === 'devlog') {
    const devlogDir = resolve(join(import.meta.dir, '..', '..', '..', 'exomind-devlog'));
    const subdir = docType === 'report' ? 'reports' : 'routes';
    const dir = join(devlogDir, subdir);
    if (!existsSync(dir)) throw new Error(`devlog 目录不存在: ${dir}`);
    const files = readdirSync(dir).filter(f => f.endsWith('.html')).sort().reverse();
    if (!files.length) throw new Error(`${dir} 下无 HTML 文件`);
    return join(dir, files[0]);
  }

  const tempDir = resolve(join(import.meta.dir, '..', '..', 'temp'));
  if (!existsSync(tempDir)) throw new Error(`temp/ 目录不存在: ${tempDir}`);

  const prefix = docType === 'report' ? 'exomind-daily-report-' : 'exomind-route-';
  const files = readdirSync(tempDir)
    .filter(f => f.startsWith(prefix) && f.endsWith('.html'))
    .sort()
    .reverse();

  if (!files.length) throw new Error(`temp/ 下未找到 ${prefix}*.html`);
  return join(tempDir, files[0]);
}

function detectType(html: string): DocType {
  if (html.includes('const REPORT = {')) return 'report';
  if (html.includes('const ROUTE = {')) return 'route';
  throw new Error('无法检测文件类型：未找到 REPORT 或 ROUTE 数据对象');
}

// ── Data Extraction (reuse patterns from publish-devlog.ts / publish-route.ts) ──

function extractDataBlock(html: string, docType: DocType): string {
  const startMarker = docType === 'report' ? 'const REPORT = {' : 'const ROUTE = {';
  const endMarkers = ['// ╔══', '// ═══', '</script>'];

  const startIdx = html.indexOf(startMarker);
  if (startIdx === -1) throw new Error(`未找到 ${startMarker}`);

  let endIdx = -1;
  for (const marker of endMarkers) {
    const idx = html.indexOf(marker, startIdx + startMarker.length);
    if (idx !== -1 && (endIdx === -1 || idx < endIdx)) endIdx = idx;
  }
  if (endIdx === -1) throw new Error('未找到数据对象结束边界');

  let data = html.substring(startIdx, endIdx).trimEnd();
  if (!data.endsWith('};')) {
    const lastSemicolon = data.lastIndexOf('};');
    if (lastSemicolon !== -1) data = data.substring(0, lastSemicolon + 2);
  }
  return data;
}

function getStr(dataBlock: string, key: string): string {
  const m = dataBlock.match(new RegExp(`${key}:\\s*'([^']*)'`));
  return m ? m[1] : '';
}

function resolveDaypart(hour: number): string {
  return hour < 6 ? '开发夜报' : hour < 12 ? '开发早报' : hour < 18 ? '开发午报' : '开发晚报';
}

function getStrArray(dataBlock: string, key: string): string[] {
  const m = dataBlock.match(new RegExp(`${key}:\\s*\\[([\\s\\S]*?)\\]`));
  if (!m) return [];
  const items: string[] = [];
  const pattern = /'([^']*)'/g;
  let match;
  while ((match = pattern.exec(m[1])) !== null) items.push(match[1]);
  return items;
}

// ── Report Text Generation ──

function reportToText(dataBlock: string, timeHint?: string): string {
  const lines: string[] = [];

  // Meta
  let title = getStr(dataBlock, 'title');
  const date = getStr(dataBlock, 'date');
  const coverage = getStr(dataBlock, 'coverage');
  const baseline = getStr(dataBlock, 'baseline');

  // Auto-resolve daypart from HHmmss time (passed via second arg or extracted from coverage)
  // Priority: explicit timeHint > 6-digit time pattern in coverage > skip
  const coverageHourMatch = coverage.match(/(\d{2}):(\d{2})(?:\s*~|$)/);
  const hourStr = timeHint?.substring(0, 2) || (coverageHourMatch ? coverageHourMatch[1] : '');
  if (hourStr) {
    const hour = parseInt(hourStr, 10);
    if (!isNaN(hour)) title = resolveDaypart(hour);
  }

  // Publisher
  const pubIdentity = getStr(dataBlock, 'identity');
  const pubOs = getStr(dataBlock, 'os');
  const pubModel = getStr(dataBlock, 'model');
  const pubVersion = getStr(dataBlock, 'version');
  const publisher = pubIdentity ? `${pubIdentity}·${pubOs} [${pubModel} ${pubVersion}]` : '';

  // Weather
  const weatherEmoji = getStr(dataBlock, 'emoji');
  const weatherLabel = getStr(dataBlock, 'label');

  lines.push(`# ExoMind ${title} ${date}`);
  if (publisher) lines.push(`发布者: ${publisher}`);
  lines.push(`天气: ${weatherEmoji} ${weatherLabel}`);
  if (coverage) lines.push(`覆盖: ${coverage}`);
  if (baseline) lines.push(`基线: ${baseline.startsWith('dev@') ? baseline : `dev@${baseline}`}`);
  lines.push('');

  // Metrics
  const metricsBlock = dataBlock.match(/metrics:\s*\[([\s\S]*?)\],\s*\n/);
  if (metricsBlock) {
    lines.push('## 指标');
    const metricPattern = /\{\s*label:\s*'([^']*)',\s*value:\s*'([^']*)',\s*delta:\s*'([^']*)',\s*trend:\s*'([^']*)'/g;
    let m;
    while ((m = metricPattern.exec(metricsBlock[1])) !== null) {
      const arrow = m[4] === 'up' ? '↑' : m[4] === 'down' ? '↓' : '→';
      lines.push(`- ${m[1]}: ${m[2]} (${m[3]}, ${arrow})`);
    }
    lines.push('');
  }

  // Headlines
  const headlinesBlock = dataBlock.match(/headlines:\s*\[([\s\S]*?)\],\s*\n/);
  if (headlinesBlock) {
    lines.push('## 头条');
    const headlinePattern = /\{\s*emoji:\s*'([^']*)',\s*title:\s*'([^']*)',\s*(?:color:\s*'[^']*',\s*)?body:\s*'([^']*)'/g;
    let m;
    let idx = 1;
    while ((m = headlinePattern.exec(headlinesBlock[1])) !== null) {
      lines.push(`${idx++}. ${m[1]} ${m[2]} — ${m[3]}`);
    }
    lines.push('');
  }

  // Mainlines
  const mainlinesBlock = dataBlock.match(/mainlines:\s*\[([\s\S]*?)\],\s*\n\s*\/\//);
  if (mainlinesBlock) {
    lines.push('## 主线');
    const mainlinePattern = /\{\s*name:\s*'([^']*)'[^}]*?pct:\s*(\d+)[^}]*?subtasks:\s*\[([\s\S]*?)\]\s*\}/g;
    let m;
    let idx = 1;
    while ((m = mainlinePattern.exec(mainlinesBlock[1])) !== null) {
      const subtasks = m[3];
      const taskItems: string[] = [];
      const taskPattern = /\{\s*text:\s*'([^']*)',\s*done:\s*(true|false)/g;
      let t;
      while ((t = taskPattern.exec(subtasks)) !== null) {
        taskItems.push(`${t[2] === 'true' ? '✅' : '○'}${t[1]}`);
      }
      lines.push(`${idx++}. ${m[1]} [${m[2]}%] ${taskItems.join(' ')}`);
    }
    lines.push('');
  }

  // PR Board
  const prsBlock = dataBlock.match(/prs:\s*\{([\s\S]*?)\},\s*\n/);
  if (prsBlock) {
    lines.push('## PR 看板');
    const openPrs: string[] = [];
    const prPattern = /\{\s*num:\s*(\d+),\s*title:\s*'([^']*)',\s*status:\s*'([^']*)'/g;
    let m;
    while ((m = prPattern.exec(prsBlock[1])) !== null) {
      openPrs.push(`#${m[1]} ${m[3]}`);
    }
    if (openPrs.length) lines.push(`Open: ${openPrs.join(' | ')}`);
    else lines.push('Open: (无)');
    lines.push('');
  }

  // Pool Health (战场清点)
  const poolBlock = dataBlock.match(/poolHealth:\s*\{([\s\S]*?)\n  \},/);
  if (poolBlock) {
    lines.push('## 战场清点');
    // PR→Issue 断裂
    const mismatchPattern = /\{\s*pr:\s*(\d+),\s*issue:\s*(\d+)/g;
    let pm;
    const mismatches: string[] = [];
    while ((pm = mismatchPattern.exec(poolBlock[1])) !== null) {
      mismatches.push(`PR #${pm[1]} 已合并 → #${pm[2]} 仍 OPEN`);
    }
    if (mismatches.length > 0) {
      lines.push(`⚑ 战果未清: ${mismatches.length} 条`);
      mismatches.forEach(m => lines.push(`  ${m}`));
    }
    // P0/P1 停滞
    const stalePattern = /\{\s*num:\s*(\d+),\s*title:\s*'([^']*)',\s*priority:\s*'([^']*)',\s*staleDays:\s*(\d+)/g;
    let sm;
    const stales: string[] = [];
    while ((sm = stalePattern.exec(poolBlock[1])) !== null) {
      stales.push(`#${sm[1]} ${sm[3]} ${sm[4]}d ${sm[2]}`);
    }
    if (stales.length > 0) {
      lines.push(`⏳ 僵持线:`);
      stales.forEach(s => lines.push(`  ${s}`));
    }
    // 无优先级
    const npMatch = poolBlock[1].match(/noPriority:\s*\{\s*current:\s*(\d+),\s*previous:\s*(\d+)/);
    if (npMatch) {
      lines.push(`🏷 未编入: ${npMatch[1]} (上期 ${npMatch[2]})`);
    }
    // 陈年阵地
    const ageMatch = poolBlock[1].match(/aging:\s*\{\s*oldCount:\s*(\d+),\s*total:\s*(\d+),\s*pct:\s*(\d+)/);
    if (ageMatch) {
      lines.push(`📦 陈年阵地: ${ageMatch[3]}% >30d (${ageMatch[1]}/${ageMatch[2]})`);
    }
    lines.push('');
  }

  // Actions
  const actionsBlock = dataBlock.match(/actions:\s*\[([\s\S]*?)\],\s*\n/);
  if (actionsBlock) {
    lines.push('## 建议行动');
    const actionPattern = /\{\s*text:\s*'([^']*)'/g;
    let m;
    let idx = 1;
    while ((m = actionPattern.exec(actionsBlock[1])) !== null) {
      lines.push(`${idx++}. ${m[1]}`);
    }
    lines.push('');
  }

  // Insight
  const insightBlock = dataBlock.match(/insight:\s*\{([\s\S]*?)\}/);
  if (insightBlock) {
    const insightText = insightBlock[1].match(/text:\s*'([^']*)'/);
    if (insightText) {
      lines.push('## 洞察');
      lines.push(insightText[1]);
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ── Route Text Generation ──

function routeToText(dataBlock: string): string {
  const lines: string[] = [];

  // Meta
  const title = getStr(dataBlock, 'title');
  const date = getStr(dataBlock, 'date');
  const baseline = getStr(dataBlock, 'baseline');

  // Publisher
  const pubIdentity = getStr(dataBlock, 'identity');
  const pubOs = getStr(dataBlock, 'os');
  const pubModel = getStr(dataBlock, 'model');
  const pubVersion = getStr(dataBlock, 'version');
  const publisher = pubIdentity ? `${pubIdentity}·${pubOs} [${pubModel} ${pubVersion}]` : '';

  // Status
  const statusEmoji = getStr(dataBlock, 'emoji');
  const statusLabel = getStr(dataBlock, 'label');
  const statusSummary = getStr(dataBlock, 'summary');

  lines.push(`# ExoMind ${title} ${date}`);
  if (publisher) lines.push(`发布者: ${publisher}`);
  lines.push(`航况: ${statusEmoji} ${statusLabel}`);
  if (statusSummary) lines.push(`概要: ${statusSummary}`);
  if (baseline) lines.push(`基线: ${baseline.startsWith('dev@') ? baseline : `dev@${baseline}`}`);
  lines.push('');

  // Metrics
  const metricsBlock = dataBlock.match(/metrics:\s*\[([\s\S]*?)\],\s*\n\s*tracks/);
  if (metricsBlock) {
    lines.push('## 指标');
    const metricPattern = /\{\s*label:\s*'([^']*)',\s*value:\s*'([^']*)',\s*note:\s*'([^']*)'/g;
    let m;
    while ((m = metricPattern.exec(metricsBlock[1])) !== null) {
      lines.push(`- ${m[1]}: ${m[2]} (${m[3]})`);
    }
    lines.push('');
  }

  // Batches
  const batchesBlock = dataBlock.match(/batches:\s*\[([\s\S]*?)\],\s*\n\s*heatmap/);
  if (batchesBlock) {
    lines.push('## 批次总览');
    const batchPattern = /\{\s*id:\s*'([^']*)',\s*name:\s*'([^']*)',\s*track:\s*'([^']*)',\s*status:\s*'([^']*)',\s*priority:\s*'([^']*)',\s*pct:\s*(\d+)/g;
    const deps: string[] = [];
    let m;
    while ((m = batchPattern.exec(batchesBlock[1])) !== null) {
      // Count issues in this batch
      const batchStart = batchesBlock[1].indexOf(`id: '${m[1]}'`);
      const nextBatchIdx = batchesBlock[1].indexOf(`id: '`, batchStart + 5);
      const batchSlice = nextBatchIdx === -1
        ? batchesBlock[1].substring(batchStart)
        : batchesBlock[1].substring(batchStart, nextBatchIdx);
      const issueCount = (batchSlice.match(/num:\s*\d+/g) || []).length;

      let statusStr = m[4];
      // Extract deps
      const depsMatch = batchSlice.match(/deps:\s*\[([\s\S]*?)\]/);
      if (depsMatch && depsMatch[1].trim()) {
        const depPattern = /id:\s*'([^']*)',\s*reason:\s*'([^']*)'/g;
        let d;
        while ((d = depPattern.exec(depsMatch[1])) !== null) {
          statusStr = `blocked-by-${d[1]}`;
          deps.push(`${m[1]} blocked by ${d[1]} (${d[2]})`);
        }
      }

      lines.push(`${m[1]}: ${m[2]} [${m[3]}] ${statusStr} ${m[6]}% (${issueCount} issues, ${m[5]})`);
    }
    lines.push('');

    // Dependency chain
    if (deps.length) {
      lines.push('## 依赖链');
      deps.forEach(d => lines.push(`- ${d}`));
      lines.push('');
    }
  }

  // Actions
  const actionsBlock = dataBlock.match(/actions:\s*\[([\s\S]*?)\],\s*\n/);
  if (actionsBlock) {
    lines.push('## 建议航向');
    const actionPattern = /\{\s*text:\s*'([^']*)'/g;
    let m;
    let idx = 1;
    while ((m = actionPattern.exec(actionsBlock[1])) !== null) {
      lines.push(`${idx++}. ${m[1]}`);
    }
    lines.push('');
  }

  // Insight
  const insightBlock = dataBlock.match(/insight:\s*\{([\s\S]*?)\}/);
  if (insightBlock) {
    const insightText = insightBlock[1].match(/text:\s*'([^']*)'/);
    if (insightText) {
      lines.push('## 洞察');
      lines.push(insightText[1]);
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ── JSON Output ──

function dataBlockToJson(dataBlock: string): string {
  // Strip "const REPORT = " or "const ROUTE = " prefix and trailing ";"
  let obj = dataBlock.replace(/^const\s+\w+\s*=\s*/, '').replace(/;\s*$/, '');
  // Convert JS object literal to JSON:
  // 1. Replace single quotes with double quotes
  obj = obj.replace(/'/g, '"');
  // 2. Remove trailing commas before } or ]
  obj = obj.replace(/,\s*([}\]])/g, '$1');
  // 3. Quote unquoted keys
  obj = obj.replace(/(\s)(\w+):\s/g, '$1"$2": ');
  // 4. Remove JS comments
  obj = obj.replace(/\/\/[^\n]*/g, '');

  try {
    const parsed = JSON.parse(obj);
    return JSON.stringify(parsed, null, 2);
  } catch {
    // Fallback: return the raw data block as-is
    return dataBlock;
  }
}

// ── Main ──

function main() {
  const opts = parseArgs();

  // Resolve file
  let filePath: string;
  let docType: DocType;

  if (opts.file) {
    filePath = opts.file;
    if (!existsSync(filePath)) throw new Error(`文件不存在: ${filePath}`);
    const html = readFileSync(filePath, 'utf-8');
    docType = opts.type || detectType(html);
  } else if (opts.type) {
    docType = opts.type;
    filePath = findLatestFile(docType, opts.source);
  } else {
    throw new Error('请指定 --type report/route 或 --file <path>');
  }

  const html = readFileSync(filePath, 'utf-8');
  const dataBlock = extractDataBlock(html, docType);

  // Extract time hint from filename (HHmmss portion)
  const fnameTimeMatch = basename(filePath).match(/(\d{4}-\d{2}-\d{2})-(\d{6})/);
  const timeHint = fnameTimeMatch ? fnameTimeMatch[2] : undefined;

  if (opts.format === 'json') {
    console.log(dataBlockToJson(dataBlock));
  } else {
    const text = docType === 'report' ? reportToText(dataBlock, timeHint) : routeToText(dataBlock);
    console.log(text);
  }
}

main();
