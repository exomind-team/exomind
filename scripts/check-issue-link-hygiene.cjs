#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const file = process.argv[2];

if (!file) {
  console.error("Usage: node scripts/check-issue-link-hygiene.cjs <body-file>");
  process.exit(2);
}

const bodyPath = path.resolve(process.cwd(), file);

if (!fs.existsSync(bodyPath)) {
  console.error(`File not found: ${bodyPath}`);
  process.exit(2);
}

const text = fs.readFileSync(bodyPath, "utf8");
const repoPathPrefixes = [
  "src",
  "scripts",
  "crates",
  "docs",
  "tests",
  "website",
  "src-tauri",
  "server",
  "apps",
  "packages",
  "lib",
  "\\.github/workflows",
];
const repoPathPattern =
  `(?:${repoPathPrefixes.join("|")})\\/` +
  String.raw`[^\s\])` +
  "`" +
  String.raw`]+?\.[A-Za-z0-9._-]+`;

const checks = [
  {
    name: "bare_url",
    pattern: /(?<!\]\()https?:\/\/[^\s)<>]+/g,
    message: "Found bare URL outside Markdown link target.",
  },
  {
    name: "url_as_link_text",
    pattern: /\[(https?:\/\/[^\]]+)\]\(\1\)/g,
    message: "Found URL used directly as Markdown link text.",
  },
  {
    name: "absolute_windows_path",
    pattern: /\b[A-Za-z]:[\\/][^\s`)\]]+/g,
    message: "Found local absolute path.",
  },
  {
    name: "backticked_repo_path",
    pattern: new RegExp(String.raw`\`(${repoPathPattern})\``, "g"),
    message: "Found backticked repository path without link.",
  },
];

let hasError = false;

for (const check of checks) {
  const matches = [...text.matchAll(check.pattern)];
  if (matches.length === 0) continue;
  hasError = true;
  console.error(`\n[${check.name}] ${check.message}`);
  for (const match of matches.slice(0, 10)) {
    console.error(`- ${match[0]}`);
  }
  if (matches.length > 10) {
    console.error(`- ... and ${matches.length - 10} more`);
  }
}

const plainRepoPathMatches = [];
for (const line of text.split(/\r?\n/)) {
  const sanitized = line
    .replace(/\[[^\]]+\]\([^)]+\)/g, "")
    .replace(/`[^`]+`/g, "");
  const regex = new RegExp(
    String.raw`(?:^|[\s:：-])(${repoPathPattern})(?=$|[\s,.;:：)])`,
    "g",
  );
  for (const match of sanitized.matchAll(regex)) {
    if (match[1]) {
      plainRepoPathMatches.push(match[1]);
    }
  }
}

if (plainRepoPathMatches.length > 0) {
  hasError = true;
  console.error(
    "\n[plain_repo_path] Found repository path written as plain text instead of Markdown link.",
  );
  for (const match of plainRepoPathMatches.slice(0, 10)) {
    console.error(`- ${match}`);
  }
  if (plainRepoPathMatches.length > 10) {
    console.error(`- ... and ${plainRepoPathMatches.length - 10} more`);
  }
}

if (hasError) {
  process.exit(1);
}

console.log("Issue body link hygiene check passed.");
