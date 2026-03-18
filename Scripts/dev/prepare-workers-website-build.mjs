import { spawnSync } from "node:child_process";

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!process.env.WORKERS_CI) {
  process.exit(0);
}

// Workers CI 云端构建: generate website/dist before wrangler deploy / versions upload.
const bunCommand = process.platform === "win32" ? "bun.exe" : "bun";

run(bunCommand, ["install", "--cwd", "website", "--frozen-lockfile"]);
run(bunCommand, ["run", "--cwd", "website", "build"]);
