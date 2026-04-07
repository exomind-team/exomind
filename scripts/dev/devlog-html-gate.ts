import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type DevlogHtmlKind = 'report' | 'route';

type VariableName = 'REPORT' | 'ROUTE';

type TextIssue = {
  path: string;
  reason: string;
  value: string;
};

type SchemaIssue = {
  path: string;
  reason: string;
};

const REPLACEMENT_CHAR = '\uFFFD';

const STRICT_QUESTION_PATHS: Record<DevlogHtmlKind, RegExp[]> = {
  report: [
    /^root\.meta\.(title|coverage)$/,
    /^root\.publisher\.identity$/,
    /^root\.weather\.(emoji|label)$/,
    /^root\.metrics\[\d+\]\.(label|note|delta)$/,
    /^root\.headlines\[\d+\]\.title$/,
    /^root\.mainlines\[\d+\]\.name$/,
    /^root\.actions\[\d+\]\.(text|detail)$/,
  ],
  route: [
    /^root\.meta\.title$/,
    /^root\.publisher\.identity$/,
    /^root\.status\.(emoji|label|summary)$/,
    /^root\.metrics\[\d+\]\.(label|note)$/,
    /^root\.batches\[\d+\]\.name$/,
    /^root\.actions\[\d+\]\.(text|detail)$/,
  ],
};

function variableNameForKind(kind: DevlogHtmlKind): VariableName {
  return kind === 'report' ? 'REPORT' : 'ROUTE';
}

function startsWithReportFilename(kind: DevlogHtmlKind): string {
  return kind === 'report' ? 'exomind-daily-report-' : 'exomind-route-';
}

export function renderMarkerForKind(kind: DevlogHtmlKind) {
  return `<!-- exomind-devlog-rendered: kind=${kind} gate=ok -->`;
}

function extractObjectBlock(html: string, variableName: VariableName): string {
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

function parseObjectBlock(block: string, variableName: VariableName): Record<string, any> {
  const objectLiteral = block.replace(new RegExp(`^const\\s+${variableName}\\s*=\\s*`), '');
  const parsed = Function(`"use strict"; return (${objectLiteral});`)();
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${variableName} 解析结果不是对象`);
  }
  return parsed as Record<string, any>;
}

function formatValuePreview(value: string) {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  return singleLine.length <= 120 ? singleLine : `${singleLine.slice(0, 117)}...`;
}

function pathNeedsStrictQuestionCheck(kind: DevlogHtmlKind, path: string) {
  return STRICT_QUESTION_PATHS[kind].some(pattern => pattern.test(path));
}

function collectEncodingIssues(
  kind: DevlogHtmlKind,
  value: unknown,
  issues: TextIssue[],
  path = 'root',
) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return;

    if (trimmed.includes(REPLACEMENT_CHAR)) {
      issues.push({
        path,
        reason: '包含 Unicode replacement char（�），疑似解码失败',
        value: formatValuePreview(trimmed),
      });
    }

    if (/\?{2,}/.test(trimmed)) {
      issues.push({
        path,
        reason: '包含连续 ASCII 问号，疑似编码丢失',
        value: formatValuePreview(trimmed),
      });
    } else if (pathNeedsStrictQuestionCheck(kind, path) && trimmed.includes('?')) {
      issues.push({
        path,
        reason: '在关键用户可见字段中出现 ASCII 问号，疑似编码丢失',
        value: formatValuePreview(trimmed),
      });
    }

    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectEncodingIssues(kind, item, issues, `${path}[${index}]`));
    return;
  }

  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      collectEncodingIssues(kind, nested, issues, `${path}.${key}`);
    }
  }
}

function formatGateError(kind: DevlogHtmlKind, issues: TextIssue[]) {
  const label = kind === 'report' ? '日报' : '航线';
  return [
    `❌ HTML 生成前门禁失败：检测到${label}输入数据存在疑似编码/文本问题。`,
    ...issues.map(issue => `   · ${issue.path}: ${issue.reason} -> "${issue.value}"`),
    '   · 请让 Agent 重读分析原因并重试；不要直接发布当前 HTML。',
  ].join('\n');
}

function formatSchemaError(kind: DevlogHtmlKind, issues: SchemaIssue[]) {
  const label = kind === 'report' ? '日报' : '航线';
  return [
    `❌ HTML 生成前门禁失败：检测到${label}输入数据存在结构性错误（类型不匹配）。`,
    ...issues.map(issue => `   · ${issue.path}: ${issue.reason}`),
    '   · 请让 Agent 重读分析原因并重试；不要直接发布当前 HTML。',
  ].join('\n');
}

function collectArrayFields(value: unknown, hits: string[], path: string) {
  if (Array.isArray(value)) {
    hits.push(path);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      collectArrayFields(nested, hits, `${path}.${key}`);
    }
  }
}

function collectObjectFields(value: unknown, hits: string[], path: string) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    hits.push(path);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      collectObjectFields(nested, hits, `${path}.${key}`);
    }
  }
}

function assertValidDevlogSchema(kind: DevlogHtmlKind, data: Record<string, unknown>) {
  const issues: SchemaIssue[] = [];

  if (kind === 'report') {
    // 必须为数组（.map/.forEach 在 undefined 上调用即崩溃）
    const arrayPaths = [
      'metrics', 'headlines', 'mainlines', 'actions', 'scorecard',
      'prs.open', 'prs.merged',
      'weather.ups', 'weather.downs',
      'truth.closed', 'truth.stillOpen',
    ];
    for (const p of arrayPaths) {
      const parts = p.split('.');
      let v: unknown = data;
      for (const part of parts) v = (v as Record<string, unknown>)?.[part];
      if (!Array.isArray(v)) {
        issues.push({ path: p, reason: `期望数组，实际为 ${Array.isArray(v) ? 'array' : typeof v}` });
      }
    }

    // insight 必须为对象 { text: string, author: string }
    const insight = data.insight as Record<string, unknown> | undefined;
    if (typeof insight === 'string') {
      issues.push({ path: 'insight', reason: '期望对象 { text: string, author: string }，实际为纯字符串（会导致渲染页面白屏）' });
    } else if (typeof insight?.text !== 'string' || insight.text.trim().length < 20) {
      issues.push({ path: 'insight.text', reason: `期望非空字符串（≥20字符），实际为 ${typeof insight?.text === 'string' ? `"${insight.text.slice(0, 20)}..."` : typeof insight?.text}` });
    } else if (typeof insight?.author !== 'string' || !insight.author.trim()) {
      issues.push({ path: 'insight.author', reason: '期望非空字符串，实际为空或缺失' });
    }

    // weather 必须为对象
    const weather = data.weather as Record<string, unknown> | undefined;
    if (!weather || typeof weather !== 'object' || Array.isArray(weather)) {
      issues.push({ path: 'weather', reason: '期望对象 { emoji, label, level, ups[], downs[] }' });
    } else {
      for (const f of ['emoji', 'label', 'level'] as const) {
        if (typeof weather[f] !== 'string' || !weather[f].trim()) {
          issues.push({ path: `weather.${f}`, reason: `期望非空字符串，实际为 ${typeof weather[f] === 'string' ? `"${weather[f]}"` : typeof weather[f]}` });
        }
      }
      for (const f of ['ups', 'downs'] as const) {
        if (!Array.isArray(weather[f])) {
          issues.push({ path: `weather.${f}`, reason: `期望数组，实际为 ${typeof weather[f]}` });
        }
      }
    }

    // meta 必须为对象
    const meta = data.meta as Record<string, unknown> | undefined;
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
      issues.push({ path: 'meta', reason: '期望对象 { date, title }' });
    }

    // publisher 必须为对象（或 undefined 兜底）
    const publisher = data.publisher as Record<string, unknown> | undefined;
    if (publisher !== undefined && (typeof publisher !== 'object' || Array.isArray(publisher))) {
      issues.push({ path: 'publisher', reason: '期望对象 { identity, os, model, version } 或 undefined' });
    }

    // poolHealth（可选但如果存在必须为对象）
    const poolHealth = data.poolHealth as Record<string, unknown> | undefined;
    if (poolHealth !== undefined && (typeof poolHealth !== 'object' || Array.isArray(poolHealth))) {
      issues.push({ path: 'poolHealth', reason: '期望对象或 undefined' });
    }

    // truth 必须为对象
    const truth = data.truth as Record<string, unknown> | undefined;
    if (!truth || typeof truth !== 'object' || Array.isArray(truth)) {
      issues.push({ path: 'truth', reason: '期望对象 { closed[], stillOpen[] }' });
    }

    // scorecard 数组元素必须为对象
    const scorecard = data.scorecard as unknown[];
    if (Array.isArray(scorecard)) {
      scorecard.forEach((item, i) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          issues.push({ path: `scorecard[${i}]`, reason: '期望对象 { text, result, note }' });
        }
      });
    }

    // prs 必须为对象
    const prs = data.prs as Record<string, unknown> | undefined;
    if (!prs || typeof prs !== 'object' || Array.isArray(prs)) {
      issues.push({ path: 'prs', reason: '期望对象 { open[], merged[] }' });
    }

  } else if (kind === 'route') {
    // route 的结构校验（参照 renderRouteText 和渲染引擎）
    const status = data.status as Record<string, unknown> | undefined;
    if (!status || typeof status !== 'object' || Array.isArray(status)) {
      issues.push({ path: 'status', reason: '期望对象 { emoji, label, summary }' });
    }

    const batches = data.batches as unknown[];
    if (!Array.isArray(batches)) {
      issues.push({ path: 'batches', reason: `期望数组，实际为 ${typeof batches}` });
    }

    const actions = data.actions as unknown[];
    if (!Array.isArray(actions)) {
      issues.push({ path: 'actions', reason: `期望数组，实际为 ${typeof actions}` });
    }

    const batchesItems = data.batches as unknown[];
    if (Array.isArray(batchesItems)) {
      batchesItems.forEach((item: unknown, i: number) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          issues.push({ path: `batches[${i}]`, reason: '期望对象 { name, issues[], pct }' });
        }
      });
    }
  }

  if (issues.length) {
    throw new Error(formatSchemaError(kind, issues));
  }
}

export function assertNoEncodingIssuesInDevlogObject(kind: DevlogHtmlKind, data: Record<string, any>) {
  const issues: TextIssue[] = [];
  collectEncodingIssues(kind, data, issues);

  if (issues.length) {
    throw new Error(formatGateError(kind, issues));
  }
}

export function findLatestGeneratedHtmlFile(kind: DevlogHtmlKind) {
  const tempDir = resolve(join(import.meta.dir, '..', '..', 'temp'));
  if (!existsSync(tempDir)) throw new Error(`temp/ 目录不存在: ${tempDir}`);

  const files = readdirSync(tempDir)
    .filter(file => file.startsWith(startsWithReportFilename(kind)) && file.endsWith('.html'))
    .sort()
    .reverse();

  if (!files.length) {
    throw new Error(`temp/ 下未找到${kind === 'report' ? '日报' : '航线'}文件`);
  }

  return join(tempDir, files[0]);
}

export function loadValidatedDevlogHtmlFile(kind: DevlogHtmlKind, filePath: string) {
  if (!existsSync(filePath)) throw new Error(`文件不存在: ${filePath}`);

  const html = readFileSync(filePath, 'utf-8');
  if (!html.includes(renderMarkerForKind(kind))) {
    throw new Error(
      `❌ HTML 发布门禁失败：${filePath} 不是通过官方 render 入口生成的。\n` +
      `   · 请先运行 bun run ${kind === 'report' ? 'devlog:render' : 'route:render'} -- --data <json> --out <html>\n` +
      '   · render 入口会自动执行生成前门禁，并在通过后再产出 HTML。\n' +
      '   · 请让 Agent 重读分析原因并重试；不要直接发布当前 HTML。',
    );
  }
  if (!/<meta\s+charset=["']?UTF-8["']?/i.test(html)) {
    throw new Error(
      `❌ HTML 生成门禁失败：${filePath} 缺少 UTF-8 charset 声明。\n` +
      '   · 请让 Agent 重读分析原因并重试；不要直接发布当前 HTML。',
    );
  }

  const variableName = variableNameForKind(kind);
  const objectBlock = extractObjectBlock(html, variableName);
  const data = parseObjectBlock(objectBlock, variableName);
  assertNoEncodingIssuesInDevlogObject(kind, data);
  assertValidDevlogSchema(kind, data as Record<string, unknown>);

  return { html, data };
}
