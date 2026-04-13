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
    name: "backticked_repo_doc_path",
    pattern: /`((?:docs\/[^`]+\.(?:md|html)|\.github\/workflows\/[^`]+\.(?:ya?ml)))`/g,
    message: "Found backticked repository doc/workflow path without link.",
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

if (hasError) {
  process.exit(1);
}

console.log("Issue body link hygiene check passed.");
