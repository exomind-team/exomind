#!/usr/bin/env bun

/**
 * generate-report-json.ts — 从 HTML 报告中提取 REPORT 对象并生成独立的 JSON 文件
 *
 * 用法:
 *   bun run scripts/dev/generate-report-json.ts <input.html> [output.json]
 *   bun run scripts/dev/generate-report-json.ts temp/exomind-daily-report-2026-04-01.html
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, basename, dirname, join } from 'node:path';

// ── Extract REPORT Data ──

function extractReportData(html: string): object {
  const startMarker = 'const REPORT = {';
  const endMarker = '};';

  const startIdx = html.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error('未找到 REPORT 数据对象 (const REPORT = {)');
  }

  // Find the matching closing brace
  let braceCount = 0;
  let inString = false;
  let stringChar = '';
  let endIdx = -1;

  for (let i = startIdx + startMarker.length - 1; i < html.length; i++) {
    const char = html[i];
    const prevChar = i > 0 ? html[i - 1] : '';

    // Handle string literals
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

  // Extract the object part (remove "const REPORT = ")
  const objectStr = dataBlock.substring(startMarker.length - 1).trim();

  // Evaluate the object using Function constructor (safer than eval)
  try {
    const reportObj = new Function(`return ${objectStr}`)();
    return reportObj;
  } catch (e) {
    throw new Error(`解析 REPORT 对象失败: ${e}`);
  }
}

// ── Add Schema Metadata ──

function addSchemaMetadata(report: any): object {
  return {
    schema: 'exomind-devlog-report',
    version: '1.0',
    generated: new Date().toISOString(),
    ...report,
  };
}

// ── Main ──

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('用法: bun run generate-report-json.ts <input.html> [output.json]');
    process.exit(1);
  }

  const inputPath = resolve(args[0]);
  const outputPath = args[1]
    ? resolve(args[1])
    : inputPath.replace(/\.html$/, '.json');

  console.log(`读取: ${inputPath}`);
  const html = readFileSync(inputPath, 'utf-8');

  console.log('提取 REPORT 对象...');
  const report = extractReportData(html);

  console.log('添加 schema 元数据...');
  const jsonData = addSchemaMetadata(report);

  console.log(`写入: ${outputPath}`);
  writeFileSync(outputPath, JSON.stringify(jsonData, null, 2), 'utf-8');

  console.log('✓ 完成');
  console.log(`\n数据文件: ${outputPath}`);
  console.log(`文件大小: ${(JSON.stringify(jsonData).length / 1024).toFixed(2)} KB`);
}

main();
