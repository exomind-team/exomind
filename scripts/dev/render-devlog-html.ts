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
  const copy = { ...data };
  delete copy.schema;
  delete copy.version;
  delete copy.generated;
  delete copy._published;
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
  const input = stripPublishedFields(parsed);

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
