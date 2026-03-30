#!/usr/bin/env bun

import { execFileSync } from 'node:child_process';

type RawIssueComment = {
  id: number;
  body: string;
  html_url: string;
  issue_url: string;
  created_at: string;
  user?: { login?: string };
};

type ParsedArgs = {
  repo?: string;
  author: string;
  responder?: string;
  once: boolean;
  watch: boolean;
  intervalSeconds: number;
  maxRepliesPerRun: number;
  dryRun: boolean;
};

type Candidate = {
  issueNumber: number;
  comment: RawIssueComment;
  reason: string;
};

const DEFAULT_AUTHOR = 'Hailaylin';
const DEFAULT_INTERVAL_SECONDS = 180;
const DEFAULT_MAX_REPLIES = 30;
const FIXED_REPLY = '小Codex你是否有很多问号';

function runCommand(bin: string, args: string[]): string {
  return execFileSync(bin, args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 256,
  }).trim();
}

function runGh(args: string[]): string {
  return runCommand('gh', args);
}

function parseIssueNumber(issueUrl: string): number | null {
  const match = issueUrl.match(/\/issues\/(\d+)$/);
  if (!match) return null;
  const num = Number.parseInt(match[1], 10);
  return Number.isInteger(num) && num > 0 ? num : null;
}

function normalizeBody(body: string): string {
  return body.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function quoted(body: string): string {
  const normalized = normalizeBody(body).trimEnd();
  return normalized
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function buildReplyBody(original: string): string {
  return `${quoted(original)}\n\n${FIXED_REPLY}`;
}

function isQuestionMarkNoise(body: string): boolean {
  const text = normalizeBody(body).trim();
  if (!text) return false;

  const run = /[?？]{5,}/.test(text);
  if (!run) return false;

  const total = text.length;
  const qCount = (text.match(/[?？]/g) || []).length;
  const readable = (text.match(/[\p{Script=Han}A-Za-z0-9]/gu) || []).length;
  const ratio = total > 0 ? readable / total : 0;

  return qCount >= 5 && ratio < 0.65;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    repo: undefined,
    author: DEFAULT_AUTHOR,
    responder: undefined,
    once: true,
    watch: false,
    intervalSeconds: DEFAULT_INTERVAL_SECONDS,
    maxRepliesPerRun: DEFAULT_MAX_REPLIES,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case '--repo':
        out.repo = argv[++i];
        break;
      case '--author':
        out.author = argv[++i] || DEFAULT_AUTHOR;
        break;
      case '--responder':
        out.responder = argv[++i];
        break;
      case '--once':
        out.once = true;
        out.watch = false;
        break;
      case '--watch':
        out.watch = true;
        out.once = false;
        break;
      case '--interval-seconds': {
        const raw = argv[++i];
        const value = Number.parseInt(raw || '', 10);
        if (!Number.isInteger(value) || value <= 0) {
          throw new Error(`invalid --interval-seconds: ${raw}`);
        }
        out.intervalSeconds = value;
        break;
      }
      case '--max-replies': {
        const raw = argv[++i];
        const value = Number.parseInt(raw || '', 10);
        if (!Number.isInteger(value) || value <= 0) {
          throw new Error(`invalid --max-replies: ${raw}`);
        }
        out.maxRepliesPerRun = value;
        break;
      }
      case '--dry-run':
        out.dryRun = true;
        break;
      case '--help':
        printHelp();
        process.exit(0);
      default:
        throw new Error(`unknown argument: ${token}`);
    }
  }

  return out;
}

function printHelp(): void {
  console.log(`
Usage:
  bun scripts/dev/gh-auto-reply-qmark.ts [options]

Options:
  --repo <owner/repo>         GitHub repo (default: current repo)
  --author <login>            Source comment author (default: ${DEFAULT_AUTHOR})
  --responder <login>         Reply account (default: gh auth user)
  --once                      Run one sweep then exit (default)
  --watch                     Keep monitoring in loop
  --interval-seconds <n>      Watch interval seconds (default: ${DEFAULT_INTERVAL_SECONDS})
  --max-replies <n>           Max replies per sweep (default: ${DEFAULT_MAX_REPLIES})
  --dry-run                   Show candidates only, do not post
  --help                      Show this help
`.trim());
}

function ensureRepo(explicitRepo?: string): string {
  if (explicitRepo) return explicitRepo;
  return runGh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
}

function currentUserLogin(): string {
  return runGh(['api', 'user', '--jq', '.login']);
}

function fetchAllIssueComments(repo: string): RawIssueComment[] {
  const raw = runGh(['api', `repos/${repo}/issues/comments`, '--paginate', '--slurp']);
  const pages = JSON.parse(raw) as RawIssueComment[][];
  return pages.flat();
}

function groupByIssue(comments: RawIssueComment[]): Map<number, RawIssueComment[]> {
  const map = new Map<number, RawIssueComment[]>();
  for (const comment of comments) {
    const issueNumber = parseIssueNumber(comment.issue_url);
    if (!issueNumber) continue;
    const list = map.get(issueNumber) ?? [];
    list.push(comment);
    map.set(issueNumber, list);
  }

  for (const list of map.values()) {
    list.sort((left, right) => {
      const t = new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
      if (t !== 0) return t;
      return left.id - right.id;
    });
  }

  return map;
}

function findCandidates(
  grouped: Map<number, RawIssueComment[]>,
  author: string,
  responder: string,
): Candidate[] {
  const candidates: Candidate[] = [];

  for (const [issueNumber, comments] of grouped.entries()) {
    for (let i = 0; i < comments.length; i += 1) {
      const comment = comments[i];
      const login = comment.user?.login ?? '';
      if (login !== author) continue;
      if (!isQuestionMarkNoise(comment.body)) continue;

      const later = comments.slice(i + 1);
      const hasAnyNonAuthorReply = later.some((next) => (next.user?.login ?? '') !== author);
      if (hasAnyNonAuthorReply) continue;

      // Skip if author clarified with a non-noise comment later
      const authorClarified = later.some((next) => {
        const nextLogin = next.user?.login ?? '';
        return nextLogin === author && !isQuestionMarkNoise(next.body);
      });
      if (authorClarified) continue;

      const alreadyTemplated = later.some((next) => {
        const body = normalizeBody(next.body);
        const nextLogin = next.user?.login ?? '';
        return nextLogin === responder && body.includes(FIXED_REPLY);
      });
      if (alreadyTemplated) continue;

      candidates.push({
        issueNumber,
        comment,
        reason: 'question-mark-noise + no non-author reply after it',
      });
    }
  }

  candidates.sort((left, right) => {
    const t = new Date(right.comment.created_at).getTime() - new Date(left.comment.created_at).getTime();
    if (t !== 0) return t;
    return right.comment.id - left.comment.id;
  });

  return candidates;
}

function postReply(repo: string, issueNumber: number, body: string): string {
  return runGh([
    'api',
    `repos/${repo}/issues/${issueNumber}/comments`,
    '-X',
    'POST',
    '-f',
    `body=${body}`,
    '--jq',
    '.html_url',
  ]);
}

function runSweep(options: ParsedArgs, repo: string, responder: string): void {
  const allComments = fetchAllIssueComments(repo);
  const grouped = groupByIssue(allComments);
  const candidates = findCandidates(grouped, options.author, responder).slice(0, options.maxRepliesPerRun);

  console.log(
    `[qmark-reply] repo=${repo} author=${options.author} responder=${responder} candidates=${candidates.length} dryRun=${options.dryRun}`,
  );

  for (const candidate of candidates) {
    const replyBody = buildReplyBody(candidate.comment.body);
    if (options.dryRun) {
      console.log(
        `[qmark-reply][dry-run] issue=#${candidate.issueNumber} src=${candidate.comment.html_url} reason=${candidate.reason}`,
      );
      continue;
    }

    const url = postReply(repo, candidate.issueNumber, replyBody);
    console.log(`[qmark-reply][posted] issue=#${candidate.issueNumber} src=${candidate.comment.html_url} new=${url}`);
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const repo = ensureRepo(options.repo);
  const responder = options.responder ?? currentUserLogin();

  if (options.once) {
    runSweep(options, repo, responder);
    return;
  }

  console.log(`[qmark-reply] watch mode on, interval=${options.intervalSeconds}s`);
  while (true) {
    try {
      runSweep(options, repo, responder);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[qmark-reply][error] ${message}`);
    }
    await sleep(options.intervalSeconds * 1000);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[qmark-reply] fatal: ${message}`);
  process.exit(1);
});
