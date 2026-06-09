#!/usr/bin/env bun

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertNoEncodingIssuesInDevlogObject, type DevlogHtmlKind } from './devlog-html-gate';

type Options = {
  type: DevlogHtmlKind;
  dataPath: string;
};

function parseArgs(): Options {
  const args = process.argv.slice(2);
  let type: DevlogHtmlKind | null = null;
  let dataPath: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--type' && args[i + 1]) {
      const next = args[++i];
      if (next === 'report' || next === 'route') type = next;
    } else if (args[i] === '--data' && args[i + 1]) {
      dataPath = resolve(args[++i]);
    }
  }

  if (!type) throw new Error('缺少 --type report|route');
  if (!dataPath) throw new Error('缺少 --data <json-file>');
  return { type, dataPath };
}

function stripPublishedFields(data: Record<string, any>) {
  const copy = { ...data };
  delete copy.schema;
  delete copy.version;
  delete copy.generated;
  delete copy._published;
  return copy;
}

function main() {
  const options = parseArgs();
  if (!existsSync(options.dataPath)) throw new Error(`文件不存在: ${options.dataPath}`);

  const raw = readFileSync(options.dataPath, 'utf-8');
  const parsed = JSON.parse(raw) as Record<string, any>;
  const input = stripPublishedFields(parsed);

  assertNoEncodingIssuesInDevlogObject(options.type, input);

  const title = typeof input.meta?.title === 'string' ? input.meta.title : '(no title)';
  console.log(`✓ ${options.type === 'report' ? '日报' : '航线'}数据门禁通过: ${title}`);
  console.log(`  数据文件: ${options.dataPath}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
