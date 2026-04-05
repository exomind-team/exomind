import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type DevlogHtmlKind = 'report' | 'route';

type VariableName = 'REPORT' | 'ROUTE';

type TextIssue = {
  path: string;
  reason: string;
  value: string;
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

  return { html, data };
}
