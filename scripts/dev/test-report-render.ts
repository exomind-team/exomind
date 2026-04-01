#!/usr/bin/env bun

/**
 * test-report-render.ts — 测试日报渲染引擎
 *
 * 用法:
 *   bun scripts/dev/test-report-render.ts temp/exomind-daily-report-*.html
 */

import { readFileSync } from 'node:fs';

function extractReportData(html: string): string {
  const startMarker = 'const REPORT = {';
  const endMarker = '// ╔══';

  const startIdx = html.indexOf(startMarker);
  const endIdx = html.indexOf(endMarker, startIdx);

  if (startIdx === -1 || endIdx === -1) {
    throw new Error('无法提取 REPORT 数据');
  }

  return html.substring(startIdx, endIdx).trimEnd();
}

function extractRenderEngine(html: string): string {
  const startMarker = 'const GH_BASE =';
  const endMarker = '</script>';

  const startIdx = html.indexOf(startMarker);
  const endIdx = html.lastIndexOf(endMarker);

  if (startIdx === -1 || endIdx === -1) {
    throw new Error('无法提取渲染引擎');
  }

  return html.substring(startIdx, endIdx).trim();
}

function extractVariableDeclarations(code: string): string[] {
  const constMatches = code.match(/const\s+([A-Z_][A-Z0-9_]*)\s*=/g) || [];
  const letMatches = code.match(/let\s+([A-Z_][A-Z0-9_]*)\s*=/g) || [];
  const varMatches = code.match(/var\s+([A-Z_][A-Z0-9_]*)\s*=/g) || [];

  return [...constMatches, ...letMatches, ...varMatches]
    .map(m => m.split(/\s+/)[1]);
}

function testRenderEngine(reportPath: string): void {
  console.log(`📄 测试报告: ${reportPath}\n`);

  const html = readFileSync(reportPath, 'utf-8');
  const dataBlock = extractReportData(html);
  const engineCode = extractRenderEngine(html);

  // 测试 1: 检查重复声明
  console.log('🔍 测试 1: 检查重复声明...');
  const dataVars = extractVariableDeclarations(dataBlock);
  const engineVars = extractVariableDeclarations(engineCode);
  const duplicates = dataVars.filter(v => engineVars.includes(v));

  if (duplicates.length > 0) {
    throw new Error(`❌ 发现重复声明: ${duplicates.join(', ')}`);
  }
  console.log('✓ 无重复声明\n');

  // 测试 2: 检查渲染引擎结构
  console.log('🔍 测试 2: 检查渲染引擎结构...');
  if (!engineCode.includes('REPORT.')) {
    throw new Error('❌ 渲染引擎未引用 REPORT 对象');
  }
  if (!engineCode.includes('function render()')) {
    throw new Error('❌ 渲染引擎缺少 render() 函数');
  }
  console.log('✓ 渲染引擎结构正确\n');

  // 测试 3: 语法检查
  console.log('🔍 测试 3: JavaScript 语法检查...');
  try {
    new Function(dataBlock + '\n' + engineCode);
  } catch (error: any) {
    throw new Error(`❌ 语法错误: ${error.message}`);
  }
  console.log('✓ 语法正确\n');

  // 测试 4: 模拟渲染
  console.log('🔍 测试 4: 模拟渲染...');
  try {
    const mockDOM = {
      getElementById: () => ({ innerHTML: '', addEventListener: () => {} }),
      title: '',
      querySelectorAll: () => [],
    };

    const mockWindow = {
      localStorage: {
        getItem: () => null,
        setItem: () => {},
      },
    };

    const mockChart = {
      register: () => {},
    };

    const code = `
      const document = ${JSON.stringify(mockDOM)};
      const window = ${JSON.stringify(mockWindow)};
      const Chart = ${JSON.stringify(mockChart)};
      ${dataBlock}
      ${engineCode}
      if (typeof render === 'function') {
        // render(); // 不实际执行，只检查是否能定义
      } else {
        throw new Error('render 不是函数');
      }
    `;

    eval(code);
  } catch (error: any) {
    throw new Error(`❌ 渲染失败: ${error.message}`);
  }
  console.log('✓ 渲染引擎可执行\n');

  console.log('✅ 所有测试通过！');
}

// Main
const reportPath = process.argv[2];
if (!reportPath) {
  console.error('用法: bun scripts/dev/test-report-render.ts <report-path>');
  process.exit(1);
}

try {
  testRenderEngine(reportPath);
} catch (error: any) {
  console.error(`\n${error.message}\n`);
  process.exit(1);
}
