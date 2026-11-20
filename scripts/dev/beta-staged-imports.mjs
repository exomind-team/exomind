import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const DEFAULT_MAX_FILES = 4096;
const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_GIT_METADATA_BYTES = 32 * 1024 * 1024;
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.d.ts', '.mts', '.d.mts', '.cts', '.d.cts', '.js', '.jsx', '.mjs', '.cjs'];
const ASSET_EXTENSIONS = [
  '.json', '.css', '.scss', '.sass', '.less', '.svg', '.png', '.jpg', '.jpeg',
  '.webp', '.avif', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.wasm',
  '.txt', '.md', '.xml', '.csv', '.yaml', '.yml', '.webmanifest', '.html', '.mp3', '.wav', '.ogg', '.mp4', '.webm',
];
const DIRECTORY_INDEX_EXTENSIONS = SOURCE_EXTENSIONS;
const UTF8 = new TextDecoder('utf-8', { fatal: true });

function sourceImportError(code, detail) {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  return error;
}

function gitBuffer(repositoryRoot, args, maxBuffer = MAX_GIT_METADATA_BYTES) {
  try {
    return execFileSync('git', ['-C', repositoryRoot, ...args], {
      encoding: null,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1' },
      timeout: 10000,
      maxBuffer,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (error) {
    if (error?.code === 'ENOBUFS' || error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      throw sourceImportError('source_import_budget_exceeded');
    }
    throw sourceImportError('source_import_git_error');
  }
}

function gitText(repositoryRoot, args) {
  return gitBuffer(repositoryRoot, args).toString('utf8').replace(/\r?\n$/u, '');
}

function discoverRepositoryRoot(repository) {
  if (typeof repository !== 'string' || repository.length === 0) {
    throw sourceImportError('source_import_invalid_repository');
  }
  const start = path.resolve(repository);
  return path.resolve(gitText(start, ['rev-parse', '--show-toplevel']));
}

function readHead(repositoryRoot) {
  try {
    return gitText(repositoryRoot, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  } catch {
    // An initialized repository can have an unborn HEAD. In that case the
    // staged diff is measured against the empty tree by Git.
    return null;
  }
}

function readIndexSnapshot(repositoryRoot) {
  return gitBuffer(repositoryRoot, ['ls-files', '--stage', '-z']);
}

function parseIndex(snapshot) {
  const entries = new Map();
  let hasConflicts = false;
  let hasSparseDirectories = false;
  let start = 0;

  while (start < snapshot.length) {
    const end = snapshot.indexOf(0, start);
    if (end < 0) throw sourceImportError('source_import_index_parse_error');
    const record = snapshot.subarray(start, end);
    const tab = record.indexOf(9);
    if (tab < 0) throw sourceImportError('source_import_index_parse_error');

    const header = record.subarray(0, tab).toString('ascii');
    const match = /^(\d{6}) ([0-9a-f]+) ([0-3])$/u.exec(header);
    if (!match) throw sourceImportError('source_import_index_parse_error');
    const file = record.subarray(tab + 1).toString('utf8');
    const [, mode, oid, stageText] = match;
    const stage = Number(stageText);
    if (stage !== 0) {
      hasConflicts = true;
    } else {
      if (mode === '040000') hasSparseDirectories = true;
      entries.set(file, { mode, oid });
    }
    start = end + 1;
  }

  return { entries, hasConflicts, hasSparseDirectories };
}

function stagedSourceRoots(repositoryRoot, head) {
  const args = ['diff', '--cached', '--no-renames', '--diff-filter=AM', '--name-only', '-z'];
  if (head) args.push(head);
  args.push('--');
  return gitBuffer(repositoryRoot, args)
    .toString('utf8')
    .split('\0')
    .filter((file) => file.length > 0 && isSourceFile(file))
    .sort();
}

function isSourceFile(file) {
  return SOURCE_EXTENSIONS.includes(path.posix.extname(file).toLowerCase());
}

function parseModuleSpecifiers(file, sourceText) {
  const extension = path.posix.extname(file).toLowerCase();
  const scriptKind = extension === '.tsx' || extension === '.jsx'
    ? ts.ScriptKind.TSX
    : extension === '.js' || extension === '.mjs' || extension === '.cjs'
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
  if (sourceFile.parseDiagnostics.length > 0) {
    throw sourceImportError('source_import_parse_error', file);
  }

  const specifiers = [];
  // AST module declarations ignore comments, strings, and dynamic import() calls.
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

function localModuleBase(from, originalSpecifier) {
  const specifier = originalSpecifier.split(/[?#]/u, 1)[0];
  if (!specifier) return { local: true, base: null };

  if (specifier.startsWith('@/')) {
    const base = path.posix.normalize(path.posix.join('src', specifier.slice(2)));
    return { local: true, base: base === 'src' || base.startsWith('src/') ? base : null };
  }

  if (/^(?:\.\.?)(?:\/|$)/u.test(specifier)) {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
    if (base === '..' || base.startsWith('../') || base.startsWith('/')) {
      return { local: true, base: null };
    }
    return { local: true, base };
  }

  return { local: false, base: null };
}

function candidatePaths(base) {
  if (!base) return [];
  const candidates = [];
  const seen = new Set();
  const add = (candidate) => {
    if (!seen.has(candidate)) {
      seen.add(candidate);
      candidates.push(candidate);
    }
  };

  add(base);
  const extension = path.posix.extname(base).toLowerCase();
  if (!extension) {
    for (const suffix of [...SOURCE_EXTENSIONS, ...ASSET_EXTENSIONS]) add(`${base}${suffix}`);
  } else if (extension === '.js') {
    add(`${base.slice(0, -extension.length)}.ts`);
    add(`${base.slice(0, -extension.length)}.tsx`);
    add(`${base.slice(0, -extension.length)}.d.ts`);
  } else if (extension === '.jsx') {
    add(`${base.slice(0, -extension.length)}.tsx`);
    add(`${base.slice(0, -extension.length)}.ts`);
  } else if (extension === '.mjs') {
    add(`${base.slice(0, -extension.length)}.mts`);
  } else if (extension === '.cjs') {
    add(`${base.slice(0, -extension.length)}.cts`);
  }

  for (const suffix of DIRECTORY_INDEX_EXTENSIONS) add(path.posix.join(base, `index${suffix}`));
  return candidates;
}

function resolveIndexedTarget(base, entries) {
  for (const candidate of candidatePaths(base)) {
    if (entries.has(candidate)) return candidate;
  }
  return null;
}

function decodeSourceBlob(bytes, from) {
  try {
    return UTF8.decode(bytes);
  } catch {
    throw sourceImportError('source_import_invalid_utf8', from);
  }
}

function scanStagedSourceImports(repositoryRoot, index, head, maxFiles) {
  const roots = stagedSourceRoots(repositoryRoot, head);
  if (roots.length > maxFiles) throw sourceImportError('source_import_budget_exceeded');

  const queue = [...roots];
  const scheduled = new Set(queue);
  const visited = new Set();
  const missing = [];
  const missingKeys = new Set();
  const blobCache = new Map();
  let bytesRead = 0;

  const readSourceBlob = (entry, from) => {
    if (entry.mode === '120000' || entry.mode === '160000') {
      throw sourceImportError('source_import_unsupported_indexed_entry', from);
    }
    let bytes = blobCache.get(entry.oid);
    if (!bytes) {
      const remaining = MAX_SOURCE_BYTES - bytesRead;
      if (remaining <= 0) throw sourceImportError('source_import_budget_exceeded');
      bytes = gitBuffer(repositoryRoot, ['cat-file', 'blob', entry.oid], remaining + 1);
      if (bytes.length > remaining) throw sourceImportError('source_import_budget_exceeded');
      bytesRead += bytes.length;
      blobCache.set(entry.oid, bytes);
    }
    return decodeSourceBlob(bytes, from);
  };

  while (queue.length > 0) {
    const from = queue.shift();
    if (visited.has(from)) continue;
    visited.add(from);
    if (visited.size > maxFiles) throw sourceImportError('source_import_budget_exceeded');

    const sourceEntry = index.entries.get(from);
    if (!sourceEntry) throw sourceImportError('source_import_staged_source_missing_from_index', from);
    const sourceText = readSourceBlob(sourceEntry, from);
    const specifiers = parseModuleSpecifiers(from, sourceText);

    for (const specifier of specifiers) {
      const request = localModuleBase(from, specifier);
      if (!request.local) continue;
      const target = request.base ? resolveIndexedTarget(request.base, index.entries) : null;
      if (!target) {
        const key = `${from}\0${specifier}`;
        if (!missingKeys.has(key)) {
          missingKeys.add(key);
          missing.push({ from, specifier });
        }
      } else if (isSourceFile(target) && !scheduled.has(target)) {
        if (scheduled.size >= maxFiles) throw sourceImportError('source_import_budget_exceeded');
        scheduled.add(target);
        queue.push(target);
      }
    }
  }

  return {
    ok: missing.length === 0,
    checkedFiles: visited.size,
    missing: missing.sort((left, right) => (left.from < right.from ? -1 : left.from > right.from ? 1 : 0) || (left.specifier < right.specifier ? -1 : left.specifier > right.specifier ? 1 : 0)),
  };
}

export function checkStagedSourceImports({ repository, maxFiles = DEFAULT_MAX_FILES } = {}) {
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1) {
    throw sourceImportError('source_import_invalid_options');
  }

  const repositoryRoot = discoverRepositoryRoot(repository);
  const headBefore = readHead(repositoryRoot);
  const indexBefore = readIndexSnapshot(repositoryRoot);
  let result;
  let failure;

  try {
    const index = parseIndex(indexBefore);
    if (index.hasConflicts) throw sourceImportError('source_import_unmerged_index_entries');
    if (index.hasSparseDirectories) throw sourceImportError('source_import_sparse_index_unsupported');
    result = scanStagedSourceImports(repositoryRoot, index, headBefore, maxFiles);
  } catch (error) {
    failure = error;
  }

  let indexAfter;
  let headAfter;
  try {
    indexAfter = readIndexSnapshot(repositoryRoot);
    headAfter = readHead(repositoryRoot);
  } catch {
    throw sourceImportError('source_import_state_unverifiable');
  }
  if (!indexBefore.equals(indexAfter)) throw sourceImportError('source_import_index_changed');
  if (headBefore !== headAfter) throw sourceImportError('source_import_head_changed');
  if (failure) throw failure;
  return result;
}

function runCli() {
  try {
    const result = checkStagedSourceImports({ repository: process.cwd() });
    const scope = result.checkedFiles === 0 ? 'empty' : 'staged-source';
    process.stdout.write(`${JSON.stringify({ ...result, scope })}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    const code = typeof error?.code === 'string' ? error.code : 'source_import_check_failed';
    process.stderr.write(`${JSON.stringify({ ok: false, error: code })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  runCli();
}
