#!/usr/bin/env bun

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildAppendedBody,
  parseCommentId,
  parseGithubRef,
  parseRepoFromRemoteUrl,
  readBodyInput,
  resolveMode,
  type RefType,
} from './github-comment-lib';

type CliMode = 'create' | 'append' | 'replace';

type Options = {
  repo?: string;
  type?: RefType;
  number?: string;
  comment?: string;
  mode?: CliMode;
  file?: string;
  body?: string;
  ref?: string;
  'dry-run'?: boolean;
  help?: boolean;
};

function fail(message: string): never {
  console.error(`[gh-comment] ${message}`);
  process.exit(1);
}

function runCommand(bin: string, args: string[]): string {
  return execFileSync(bin, args, { encoding: 'utf8' }).trim();
}

function runGh(args: string[]): string {
  return runCommand('gh', args);
}

function printHelp(): void {
  const help = `
Usage:
  bun Scripts/dev/github-comment.ts [options]

Options:
  --repo <owner/repo>             GitHub repo. Optional; auto-detected from origin when omitted.
  --type <issue|pr>               Target type. Default: issue
  --number <id>                   Issue/PR number
  --comment <locator>             Comment locator: #issuecomment-123 | issuecomment-123 | URL | 123
  --mode <create|append|replace>  Operation mode. Default: create (no --comment), append (with --comment)
  --file <path>                   Markdown text file path
  --body <text>                   Markdown text inline
  --ref <github url>              Full issue/pr URL. Can include #issuecomment-xxx
  --dry-run                       Print resolved operation without changing GitHub
  --help                          Show help

Examples:
  bun Scripts/dev/github-comment.ts --type issue --number 93 --file docs/report.md
  bun Scripts/dev/github-comment.ts --type pr --number 89 --comment '#issuecomment-3883010944' --mode replace --file docs/update.md
  bun Scripts/dev/github-comment.ts --ref https://github.com/exomind-team/exomind/issues/93#issuecomment-3883010944 --file docs/add.md --mode append
`;
  console.log(help.trim());
}

function parseArgs(argv: string[]): Options {
  const options: Options = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${token}`);
    }

    const key = token.slice(2) as keyof Options;
    if (key === 'help' || key === 'dry-run') {
      options[key] = true;
      continue;
    }

    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }

    options[key] = value as never;
    i += 1;
  }

  return options;
}

function ensureRepo(explicitRepo: string | undefined): string {
  if (explicitRepo) {
    return explicitRepo;
  }

  try {
    const fromGh = runGh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
    if (fromGh) {
      return fromGh;
    }
  } catch {
    // fallback to git remote below
  }

  const remoteUrl = runCommand('git', ['config', '--get', 'remote.origin.url']);
  return parseRepoFromRemoteUrl(remoteUrl);
}

function writeTempBodyFile(content: string): { tempDir: string; bodyPath: string } {
  const tempDir = mkdtempSync(join(tmpdir(), 'gh-comment-'));
  const bodyPath = join(tempDir, 'body.md');
  writeFileSync(bodyPath, content, { encoding: 'utf8' });
  return { tempDir, bodyPath };
}

function createComment(repo: string, number: number, body: string): string {
  const { tempDir, bodyPath } = writeTempBodyFile(body);
  try {
    return runGh([
      'api',
      `repos/${repo}/issues/${number}/comments`,
      '-X',
      'POST',
      '-F',
      `body=@${bodyPath}`,
      '--jq',
      '.html_url',
    ]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function replaceComment(repo: string, commentId: string, body: string): string {
  const { tempDir, bodyPath } = writeTempBodyFile(body);
  try {
    return runGh([
      'api',
      `repos/${repo}/issues/comments/${commentId}`,
      '-X',
      'PATCH',
      '-F',
      `body=@${bodyPath}`,
      '--jq',
      '.html_url',
    ]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function fetchCommentBody(repo: string, commentId: string): string {
  return runGh(['api', `repos/${repo}/issues/comments/${commentId}`, '--jq', '.body']);
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const fromRef = options.ref ? parseGithubRef(options.ref) : undefined;
  const repo = ensureRepo(options.repo ?? fromRef?.repo);
  const type = (options.type ?? fromRef?.type ?? 'issue').toLowerCase() as RefType;
  const number = Number.parseInt(options.number ?? `${fromRef?.number ?? ''}`, 10);

  if (type !== 'issue' && type !== 'pr') {
    throw new Error(`Invalid --type value: ${type}. Expected issue|pr.`);
  }
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error('Issue/PR number is required and must be positive.');
  }

  const commentId = options.comment
    ? parseCommentId(options.comment)
    : (fromRef?.commentId ? parseCommentId(fromRef.commentId) : undefined);

  const mode = resolveMode(options.mode, commentId);
  const incomingBody = readBodyInput(options.file, options.body);

  if ((mode === 'append' || mode === 'replace') && !commentId) {
    throw new Error(`Mode ${mode} requires --comment or --ref with #issuecomment-...`);
  }
  if (!incomingBody.trim()) {
    throw new Error('Input body is empty.');
  }

  if (options['dry-run']) {
    console.log(JSON.stringify({
      repo,
      type,
      number,
      mode,
      commentId: commentId ?? null,
      bodyPreview: incomingBody.slice(0, 160),
    }, null, 2));
    return;
  }

  if (mode === 'create') {
    console.log(createComment(repo, number, incomingBody));
    return;
  }

  if (mode === 'replace') {
    console.log(replaceComment(repo, commentId!, incomingBody));
    return;
  }

  const existing = fetchCommentBody(repo, commentId!);
  const merged = buildAppendedBody(existing, incomingBody);
  console.log(replaceComment(repo, commentId!, merged));
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  fail(message);
}
