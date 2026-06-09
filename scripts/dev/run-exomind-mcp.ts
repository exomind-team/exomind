#!/usr/bin/env bun

const env = {
  ...process.env,
  EXOMIND_MCP_USER_ID: process.env.EXOMIND_MCP_USER_ID?.trim() || "v2",
  EXOMIND_MCP_USER_PASSWD: process.env.EXOMIND_MCP_USER_PASSWD?.trim() || "123456",
  EXOMIND_MCP_SYNC_SERVER_URL:
    process.env.EXOMIND_MCP_SYNC_SERVER_URL?.trim() || "http://localhost:6984",
};

const child = Bun.spawn({
  cmd: ["bun", "run", "./packages/mcp/server.ts"],
  cwd: process.cwd(),
  env,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

process.exit(await child.exited);
