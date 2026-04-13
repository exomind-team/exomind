#!/usr/bin/env bun
/**
 * check-issue-newlines.ts
 *
 * 检测 GitHub issue 正文和评论是否存在换行符问题。
 *
 * 问题本质：
 *   MCP API 返回 body 时把真正的 newline 转义显示为字面上的 `\n`。
 *   如果 GitHub 存储层存的是字面 `\n` 文本（而非真正的换行），
 *   渲染出来就会把所有内容挤在同一行。
 *
 * 核心检测：
 *   获取 raw body 文本后，如果内容量大（>200字符）但真换行极少（<3），
 *   说明换行被存成了字符串而非真正的 newline → 判定为有问题。
 *
 * 用法：
 *   bun run scripts/check-issue-newlines.ts [--owner ORG] [--repo REPO] [--json] [--verbose] [issue-numbers...]
 *
 *   - 不带 issue 数字：扫描全库 open issues
 *   - 带数字：只检查指定 issue
 *   - --json / --verbose：见上方
 */

import { execSync } from "child_process";

// --- CLI 参数解析 ---

interface Args {
  owner: string;
  repo: string;
  json: boolean;
  verbose: boolean;
  issueNumbers: number[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    owner: "exomind-team",
    repo: "exomind",
    json: false,
    verbose: false,
    issueNumbers: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--owner" && argv[i + 1]) {
      args.owner = argv[++i];
    } else if (arg === "--repo" && argv[i + 1]) {
      args.repo = argv[++i];
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--verbose") {
      args.verbose = true;
    } else if (/^\d+$/.test(arg)) {
      args.issueNumbers.push(parseInt(arg, 10));
    }
  }

  return args;
}

// --- gh CLI 封装 ---

function gh(cmd: string): string {
  return execSync(cmd, { encoding: "utf-8", shell: true });
}

// --- 核心检测逻辑 ---

interface Problem {
  issueNumber: number;
  issueTitle: string;
  type: "body" | `comment:${number}:${string}`;
  charCount: number;
  newlineCount: number;
}

function checkContent(
  content: string,
  type: "body" | `comment:${number}:${string}`,
): Problem | null {
  const charCount = content.length;
  const newlineCount = (content.match(/\n/g) ?? []).length;

  // 核心检测：内容量大但几乎无真正换行
  if (charCount > 200 && newlineCount < 3) {
    return { issueNumber: 0, issueTitle: "", type, charCount, newlineCount };
  }

  return null;
}

// --- 获取 issue 列表 ---

async function listOpenIssues(owner: string, repo: string): Promise<number[]> {
  const output = gh(
    `gh api repos/${owner}/${repo}/issues --jq "[.[] | select(.state == \\"open\\") | .number] | .[:300]"`,
  );
  try {
    return JSON.parse(output) as number[];
  } catch {
    return [];
  }
}

// --- 主逻辑 ---

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let issueNumbers: number[];
  if (args.issueNumbers.length > 0) {
    issueNumbers = args.issueNumbers;
  } else {
    console.error("[check-issue-newlines] 未指定 issue，扫描全库 open issues...");
    issueNumbers = await listOpenIssues(args.owner, args.repo);
  }

  const results: Problem[] = [];
  let okCount = 0;

  for (const num of issueNumbers) {
    // 获取 issue 元信息和正文
    let issueTitle = "";
    let body = "";

    try {
      const infoRaw = gh(
        `gh api repos/${args.owner}/${args.repo}/issues/${num} --jq "{title: .title, body: .body}"`,
      );
      const info = JSON.parse(infoRaw) as { title: string; body: string };
      issueTitle = info.title;
      body = info.body ?? "";
    } catch {
      continue;
    }

    const bodyProblem = checkContent(body, "body");
    if (bodyProblem) {
      bodyProblem.issueNumber = num;
      bodyProblem.issueTitle = issueTitle;
      results.push(bodyProblem);
    } else {
      if (args.verbose) {
        console.log(`#${num}: OK`);
      }
      okCount++;
    }

    // 检查评论
    let comments: { id: number; user: { login: string }; body: string }[] = [];
    try {
      const cRaw = gh(`gh api repos/${args.owner}/${args.repo}/issues/${num}/comments`);
      comments = JSON.parse(cRaw) as typeof comments;
    } catch {
      // ignore
    }

    for (const c of comments) {
      if (!c.body) continue;
      const cp = checkContent(c.body, `comment:${c.id}:${c.user.login}`);
      if (cp) {
        cp.issueNumber = num;
        cp.issueTitle = issueTitle;
        results.push(cp);
      }
    }
  }

  // --- 输出 ---
  if (args.json) {
    console.log(
      JSON.stringify(
        {
          checked: issueNumbers.length,
          okCount,
          problemCount: results.length,
          results: results.map((r) => ({
            issue: r.issueNumber,
            title: r.issueTitle,
            type: r.type,
            charCount: r.charCount,
            newlineCount: r.newlineCount,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (results.length === 0) {
    console.error(
      `\n[OK] 已检查 ${issueNumbers.length} 个 issues（正文 + 评论），未发现换行符问题。`,
    );
    return;
  }

  console.error(
    `\n[FAIL] 检查了 ${issueNumbers.length} 个 issues，发现 ${results.length} 个问题：\n`,
  );

  for (const r of results) {
    console.error(`## #${r.issueNumber}: ${r.issueTitle}`);
    console.error(`   类型: ${r.type}`);
    console.error(
      `   字符数=${r.charCount}, 真换行数=${r.newlineCount}`,
    );
    console.error(
      `   说明: 正文有 ${r.charCount} 个字符但只有 ${r.newlineCount} 个真正换行。`,
    );
    console.error(
      `   这通常是因为写入时传了字面 \\n 而非真正的换行，导致渲染时全挤在一行。`,
    );
    console.error();
  }

  process.exit(1);
}

main();
