#!/usr/bin/env bun

import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

type DocType = 'report' | 'route';

type Options = {
  devlogDir: string;
  dryRun: boolean;
  types: DocType[];
};

type ManifestEntry = Record<string, any> & {
  date?: string;
  time?: string;
  file?: string;
  dataFile?: string;
};

type Manifest = {
  generated?: string;
  repo?: string;
  latest?: {
    file?: string;
    dataFile?: string;
    date?: string;
    time?: string;
  };
  reports?: ManifestEntry[];
  routes?: ManifestEntry[];
};

function parseArgs(): Options {
  const args = process.argv.slice(2);
  let devlogDir = resolve(join(import.meta.dir, '..', '..', '..', 'exomind-devlog'));
  let dryRun = false;
  let types: DocType[] = ['report', 'route'];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--devlog-dir' && args[i + 1]) {
      devlogDir = resolve(args[++i]);
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--type' && args[i + 1]) {
      const next = args[++i];
      if (next === 'report' || next === 'route') types = [next];
      else if (next === 'all') types = ['report', 'route'];
      else throw new Error(`未知类型: ${next}（支持 report / route / all）`);
    }
  }

  return { devlogDir, dryRun, types };
}

function subdirFor(type: DocType): 'reports' | 'routes' {
  return type === 'report' ? 'reports' : 'routes';
}

function listKeyFor(type: DocType): 'reports' | 'routes' {
  return subdirFor(type);
}

function variableNameFor(type: DocType): 'REPORT' | 'ROUTE' {
  return type === 'report' ? 'REPORT' : 'ROUTE';
}

function resolveDaypart(time?: string): string {
  const hour = Number.parseInt(time?.slice(0, 2) ?? '', 10);
  if (!Number.isFinite(hour)) return '开发日志';
  return hour < 6 ? '开发夜报' : hour < 12 ? '开发早报' : hour < 18 ? '开发午报' : '开发晚报';
}

function extractObjectBlock(html: string, variableName: 'REPORT' | 'ROUTE'): string {
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

function parseObjectBlock(block: string, variableName: 'REPORT' | 'ROUTE'): Record<string, any> {
  const objectLiteral = block.replace(new RegExp(`^const\\s+${variableName}\\s*=\\s*`), '');
  const parsed = Function(`"use strict"; return (${objectLiteral});`)();
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${variableName} 解析结果不是对象`);
  }
  return parsed as Record<string, any>;
}

function resolveDateTime(type: DocType, file: string, entry: ManifestEntry) {
  const stem = basename(file, '.html');
  const fullMatch = stem.match(/(\d{4}-\d{2}-\d{2})-(\d{6})$/);
  const dateOnlyMatch = stem.match(/(\d{4}-\d{2}-\d{2})$/);
  const date = entry.date ?? fullMatch?.[1] ?? dateOnlyMatch?.[1] ?? '';
  const time = entry.time ?? fullMatch?.[2] ?? '000000';

  if (!date) throw new Error(`${subdirFor(type)}/${file} 缺少日期信息`);
  if (!/^\d{6}$/.test(time)) throw new Error(`${subdirFor(type)}/${file} 缺少合法 time 信息`);

  return { date, time };
}

function wrapData(type: DocType, file: string, dataFile: string, date: string, time: string, raw: Record<string, any>) {
  const meta = raw.meta && typeof raw.meta === 'object' ? raw.meta : {};

  if (type === 'report') {
    return {
      schema: 'exomind-devlog-report',
      version: '1.0',
      generated: new Date().toISOString(),
      _published: {
        kind: 'report',
        date,
        time,
        file,
        dataFile,
      },
      ...raw,
      meta: {
        ...meta,
        date: meta.date ?? date,
        title: meta.title ?? resolveDaypart(time),
      },
    };
  }

  return {
    schema: 'exomind-devlog-route',
    version: '1.0',
    generated: new Date().toISOString(),
    _published: {
      kind: 'route',
      date,
      time,
      file,
      dataFile,
    },
    ...raw,
    meta: {
      ...meta,
      date: meta.date ?? date,
      title: meta.title ?? '开发航线',
    },
  };
}

function normalizeEntry(type: DocType, entry: ManifestEntry, file: string, dataFile: string, date: string, time: string): ManifestEntry {
  const subdir = subdirFor(type);
  return {
    ...entry,
    date,
    time,
    file,
    dataFile,
    url: entry.url ?? `https://exomind-team.github.io/exomind-devlog/${subdir}/${file}`,
    dataUrl: entry.dataUrl ?? `https://exomind-team.github.io/exomind-devlog/${subdir}/${dataFile}`,
  };
}

function backfillType(type: DocType, options: Options) {
  const subdir = subdirFor(type);
  const listKey = listKeyFor(type);
  const dir = join(options.devlogDir, subdir);
  const manifestPath = join(dir, 'manifest.json');
  const latestPath = join(dir, 'latest.json');

  if (!existsSync(dir)) throw new Error(`目录不存在: ${dir}`);
  if (!existsSync(manifestPath)) throw new Error(`manifest 不存在: ${manifestPath}`);

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Manifest;
  const entries = Array.isArray(manifest[listKey]) ? manifest[listKey]! : [];
  const entryMap = new Map<string, ManifestEntry>();

  for (const entry of entries) {
    if (entry.file) entryMap.set(entry.file, entry);
  }

  const htmlFiles = readdirSync(dir)
    .filter(file => file.endsWith('.html'))
    .sort();

  let writtenJson = 0;
  let updatedEntries = 0;
  const touchedDataFiles: string[] = [];

  for (const file of htmlFiles) {
    const entry = entryMap.get(file) ?? { file };
    const { date, time } = resolveDateTime(type, file, entry);
    const dataFile = entry.dataFile ?? `${basename(file, '.html')}.json`;
    const htmlPath = join(dir, file);
    const jsonPath = join(dir, dataFile);

    if (!existsSync(jsonPath)) {
      const html = readFileSync(htmlPath, 'utf-8');
      const raw = parseObjectBlock(extractObjectBlock(html, variableNameFor(type)), variableNameFor(type));
      const wrapped = wrapData(type, file, dataFile, date, time, raw);

      if (!options.dryRun) {
        writeFileSync(jsonPath, JSON.stringify(wrapped, null, 2) + '\n', 'utf-8');
      }

      writtenJson++;
      touchedDataFiles.push(dataFile);
    }

    const normalized = normalizeEntry(type, entry, file, dataFile, date, time);
    if (JSON.stringify(entry) !== JSON.stringify(normalized)) {
      updatedEntries++;
    }
    entryMap.set(file, normalized);
  }

  const normalizedEntries = Array.from(entryMap.values())
    .filter(entry => entry.file)
    .sort((left, right) => `${right.date ?? ''}${right.time ?? ''}`.localeCompare(`${left.date ?? ''}${left.time ?? ''}`));

  const latest = normalizedEntries[0];
  if (!latest?.file || !latest.dataFile || !latest.date || !latest.time) {
    throw new Error(`${subdir} manifest 无法确定 latest 条目`);
  }

  const nextManifest: Manifest = {
    ...manifest,
    generated: new Date().toISOString(),
    latest: {
      file: latest.file,
      dataFile: latest.dataFile,
      date: latest.date,
      time: latest.time,
    },
    [listKey]: normalizedEntries,
  };

  if (!options.dryRun) {
    writeFileSync(manifestPath, JSON.stringify(nextManifest, null, 2) + '\n', 'utf-8');
    copyFileSync(join(dir, latest.dataFile), latestPath);
  }

  console.log(`\n[${subdir}] html=${htmlFiles.length} manifest=${normalizedEntries.length} writtenJson=${writtenJson} updatedEntries=${updatedEntries}`);
  if (touchedDataFiles.length) {
    console.log(`[${subdir}] 新补 JSON: ${touchedDataFiles.slice(0, 10).join(', ')}${touchedDataFiles.length > 10 ? ' ...' : ''}`);
  }
  console.log(`[${subdir}] latest -> ${latest.file} / ${latest.dataFile}`);
}

function main() {
  const options = parseArgs();

  if (!existsSync(options.devlogDir)) {
    throw new Error(`devlog 仓库不存在: ${options.devlogDir}`);
  }

  console.log(`devlogDir=${options.devlogDir}`);
  console.log(`dryRun=${options.dryRun ? 'yes' : 'no'}`);
  console.log(`types=${options.types.join(',')}`);

  for (const type of options.types) {
    backfillType(type, options);
  }
}

main();
