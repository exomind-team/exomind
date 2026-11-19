import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const MAX_MAP_BYTES = 128 * 1024 * 1024;
const MAX_MAP_LINE_CHARS = 1024 * 1024;
const MAX_EVIDENCE_ROWS = 32;
const RUNTIME_MARKER = /exomind[-_]runtime/i;

function need(name) {
  const value = process.env[name];
  if (!value) throw new Error("Required environment value is missing: " + name);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runGit(args) {
  const result = spawnSync("git", args, { encoding: "utf8", windowsHide: true, timeout: 10000 });
  if (result.error || result.status !== 0) throw new Error("git " + args.join(" ") + " failed");
  return result.stdout.trim();
}

async function sha256File(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function* boundedMapLines(file) {
  const input = createReadStream(file, { highWaterMark: 64 * 1024 });
  const decoder = new StringDecoder("utf8");
  let pending = "";
  try {
    for await (const chunk of input) {
      const decoded = decoder.write(chunk);
      let start = 0;
      while (start < decoded.length) {
        const newline = decoded.indexOf("\n", start);
        const end = newline < 0 ? decoded.length : newline;
        if (pending.length + end - start > MAX_MAP_LINE_CHARS) {
          yield { oversized: true };
          return;
        }
        pending += decoded.slice(start, end);
        if (newline < 0) break;
        yield { line: pending.replace(/\r$/, "") };
        pending = "";
        start = newline + 1;
      }
    }
    pending += decoder.end();
    if (pending.length > MAX_MAP_LINE_CHARS) yield { oversized: true };
    else if (pending.length) yield { line: pending.replace(/\r$/, "") };
  } finally {
    input.destroy();
  }
}

export async function analyzeLinkMap(file) {
  const stats = statSync(file);
  assert(stats.isFile() && stats.size > 0 && stats.size <= MAX_MAP_BYTES, "Link map must be nonempty and no larger than 128 MiB");
  const textSegments = new Set();
  const evidenceRows = [];
  let publicTableSeen = false;
  let parsedPublicRows = 0;
  let parsedTextPublicRows = 0;
  let unparsedAddressRows = 0;
  let lineNumber = 0;
  let oversizedLine = false;
  const sectionRow = /^\s*([0-9a-f]{4}):[0-9a-f]+\s+[0-9a-f]+H\s+(\.\S+)\s+CODE\s*$/i;
  const publicRow = /^\s*([0-9a-f]{4}):[0-9a-f]+\s+(.+?)\s+[0-9a-f]{8,16}\s+[fi]\s+(.+?)\s*$/i;

  for await (const entry of boundedMapLines(file)) {
    lineNumber += 1;
    if (entry.oversized) {
      oversizedLine = true;
      break;
    }
    const line = entry.line;
    if (/Publics by Value/i.test(line)) {
      publicTableSeen = true;
      continue;
    }
    if (!publicTableSeen) {
      const match = sectionRow.exec(line);
      if (match && /^\.text(?:$|\$)/i.test(match[2])) textSegments.add(match[1].toLowerCase());
      continue;
    }
    const match = publicRow.exec(line);
    if (!match) {
      if (/^\s*[0-9a-f]{4}:/i.test(line)) unparsedAddressRows += 1;
      continue;
    }
    parsedPublicRows += 1;
    const segment = match[1].toLowerCase();
    if (!textSegments.has(segment)) continue;
    parsedTextPublicRows += 1;
    const symbol = match[2];
    const object = match[3];
    if (RUNTIME_MARKER.test(symbol + " " + object) && evidenceRows.length < MAX_EVIDENCE_ROWS) {
      evidenceRows.push({ line: lineNumber, segment, symbol: symbol.slice(0, 300), object: object.slice(0, 500) });
    }
  }

  const recognized = !oversizedLine && publicTableSeen && textSegments.size > 0
    && parsedTextPublicRows > 0 && unparsedAddressRows === 0;
  const detected = evidenceRows.length > 0;
  return {
    status: detected ? "detected" : recognized ? "no-match-in-recognized-final-text-public-rows" : "unclassified",
    has_exomind_runtime_text_contribution: detected ? true : recognized ? false : null,
    final_text_segment_ids: [...textSegments].sort(),
    parsed_public_rows: parsedPublicRows,
    parsed_text_public_rows: parsedTextPublicRows,
    unparsed_address_rows: unparsedAddressRows,
    evidence_rows: evidenceRows,
    interpretation: detected
      ? "The final PE link map has exomind_runtime-named public symbol or object rows in an output .text segment."
      : recognized
        ? "No exomind_runtime marker was found in recognized output .text public rows. This does not prove the Runtime is fully eliminated; retain and review the raw map."
        : "The map layout was not fully recognized by the bounded scanner. Retain and review the raw map."
  };
}
async function main() {
  const repoRoot = process.cwd();
  const expectedSha = need("GITHUB_SHA").toLowerCase();
  const actualSha = runGit(["rev-parse", "HEAD"]).toLowerCase();
  assert(actualSha === expectedSha, "Checked-out source SHA differs from GITHUB_SHA");
  assert(runGit(["status", "--porcelain=v1", "--untracked-files=all"]) === "", "Source checkout is not clean after the build");

  const configPath = join(repoRoot, "src-tauri", "tauri.beta.conf.json");
  const configText = readFileSync(configPath, "utf8");
  const config = JSON.parse(configText);
  assert(config.identifier === "com.exomind.app.v06.beta", "Unexpected current Beta Native identifier");
  assert(config.productName === "ExoMind Beta", "Unexpected current Beta Native product name");
  assert(config.build?.beforeBuildCommand === "bun run build:web", "Current Beta beforeBuildCommand changed");
  assert(/^0\.6\.0-beta[1-9][0-9]*$/.test(config.version), "Current Beta Native config version is invalid");
  assert(config.version === need("PROBE_VERSION"), "Probe version differs from source config");
  assert(process.env.CARGO_BUILD_JOBS === "1", "Cargo build jobs must be exactly one");
  assert(process.env.CARGO_PROFILE_DEV_DEBUG === "0", "Cargo dev debug level must be zero");
  assert(process.env.CARGO_PROFILE_DEV_INCREMENTAL === "false", "Cargo incremental compilation must be disabled");
  assert(process.env.CARGO_PROFILE_DEV_CODEGEN_UNITS === "16", "Cargo codegen units must be exactly 16");
  assert(/rust-lld\.exe$/i.test(need("CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER")), "The Windows Rust toolchain lld linker must be selected");
  const rustflags = need("RUSTFLAGS");
  assert(rustflags.includes("-C linker-flavor=lld-link") && rustflags.includes("-C link-arg=/threads:1") && rustflags.includes("-C link-arg=/DEBUG:NONE"), "Windows lld flags differ from the bounded probe contract");
  assert(need("PROBE_PE_PRODUCT_NAME") === config.productName, "PE product name differs from source config");
  assert(need("PROBE_PE_PRODUCT_VERSION") === config.version, "PE product version differs from source config");
  assert(need("PROBE_PE_FILE_VERSION") === config.version, "PE file version differs from source config");

  const binary = resolve(need("PROBE_BINARY_PATH"));
  const mapPath = resolve(need("PROBE_MAP_PATH"));
  const outputDir = resolve(need("PROBE_OUTPUT_DIR"));
  const outputRelative = relative(repoRoot, outputDir);
  assert(isAbsolute(outputRelative) || outputRelative === ".." || outputRelative.startsWith(".." + sep), "Probe artifacts must stay outside the source checkout");
  const artifactMap = join(outputDir, "exomind.map");
  assert(mapPath.toLowerCase() === artifactMap.toLowerCase(), "Expected the root linker map in the owned evidence directory");
  const existing = readdirSync(outputDir);
  assert(existing.length === 1 && existing[0] === "exomind.map", "Evidence directory must contain only this run's newly generated map");
  assert(statSync(binary).isFile(), "The exact Windows root executable is missing");
  const mapStats = statSync(mapPath);
  assert(mapStats.isFile() && mapStats.size > 0 && mapStats.size <= MAX_MAP_BYTES, "Link map is missing, empty, or exceeds the 128 MiB scan bound");

  const readobj = need("LLVM_READOBJ");
  const binaryArgument = relative(repoRoot, binary).split(sep).join("/");
  const sections = spawnSync(readobj, ["--sections", binaryArgument], {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
    maxBuffer: 16 * 1024 * 1024
  });
  if (sections.error || sections.status !== 0) {
    throw new Error("llvm-readobj --sections failed: " + (sections.error?.message || sections.stderr || "unknown error"));
  }
  assert(/Sections\s*\[/.test(sections.stdout), "llvm-readobj output did not contain a PE section table");

  writeFileSync(join(outputDir, "pe-sections.txt"), sections.stdout, { flag: "wx", encoding: "utf8" });

  const mapAnalysis = await analyzeLinkMap(artifactMap);
  const workflowPath = ".github/workflows/beta-native-size-probe.yml";
  const analyzerPath = "scripts/dev/beta-native-size-probe.mjs";
  const workflowAbs = join(repoRoot, workflowPath);
  const analyzerAbs = join(repoRoot, analyzerPath);
  const workflowSha = await sha256File(workflowAbs);
  const analyzerSha = await sha256File(analyzerAbs);
  const recipeSha = createHash("sha256")
    .update(workflowPath).update("\0").update(readFileSync(workflowAbs))
    .update("\0").update(analyzerPath).update("\0").update(readFileSync(analyzerAbs))
    .digest("hex");
  const cargoLockPath = "Cargo.lock";
  const cargoManifest = readFileSync(join(repoRoot, "src-tauri", "Cargo.toml"), "utf8");
  const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargoManifest)?.[1] || null;
  const mapCommand = "cargo rustc --locked --manifest-path src-tauri/Cargo.toml --package exomind --target x86_64-pc-windows-msvc --bin exomind -- -C link-arg=/MAP:" + need("PROBE_MAP_PATH");

  const report = {
    evidence_kind: "windows-native-link-map-source-probe",
    evidence_label: "source-native-probe",
    candidate_build: false,
    frozen_beta18_candidate: false,
    candidate_request_called: false,
    source_sha: actualSha,
    workflow_recipe: {
      workflow_path: workflowPath,
      analyzer_path: analyzerPath,
      source_commit_sha: actualSha,
      workflow_file_sha256: workflowSha,
      analyzer_file_sha256: analyzerSha,
      recipe_sha256: recipeSha
    },
    source_native_config: {
      path: "src-tauri/tauri.beta.conf.json",
      sha256: await sha256File(configPath),
      identifier: config.identifier,
      product_name: config.productName,
      version: config.version,
      entry: "beta.html",
      before_build_command: config.build.beforeBuildCommand
    },
    cargo: {
      package: "exomind",
      source_manifest_version: cargoVersion,
      lockfile_sha256: await sha256File(join(repoRoot, cargoLockPath)),
      command: mapCommand,
      target: "x86_64-pc-windows-msvc",
      profile: "dev/debug",
      flags: {
        build_jobs: Number(process.env.CARGO_BUILD_JOBS),
        debug_level: Number(process.env.CARGO_PROFILE_DEV_DEBUG),
        incremental: process.env.CARGO_PROFILE_DEV_INCREMENTAL,
        codegen_units: Number(process.env.CARGO_PROFILE_DEV_CODEGEN_UNITS),
        linker: "Rust toolchain rust-lld.exe",
        linker_flavor: "lld-link",
        linker_parallelism: 1,
        linker_debug: "NONE",
        map_argument_scope: "cargo rustc --bin exomind final root binary only",
        rustflags: process.env.RUSTFLAGS
      }
    },
    frontend: {
      before_build_command: config.build.beforeBuildCommand,
      command_executed: "bun run build:web",
      beta_entry_present: true,
      app_launched: false
    },
    pe: {
      file_name: "exomind.exe",
      byte_length: statSync(binary).size,
      sha256: await sha256File(binary),
      product_name: process.env.PROBE_PE_PRODUCT_NAME,
      product_version: process.env.PROBE_PE_PRODUCT_VERSION,
      file_version: process.env.PROBE_PE_FILE_VERSION,
      sections_file: "pe-sections.txt"
    },
    link_map: {
      file: "exomind.map",
      byte_length: mapStats.size,
      sha256: await sha256File(artifactMap),
      runtime_text_contribution: mapAnalysis,
      retained_verbatim: true
    },
    artifact: {
      executable_included: false,
      installer_or_package_created: false,
      signing_or_publishing_performed: false,
      retention_days: 7
    }
  };
  writeFileSync(join(outputDir, "probe-info.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx", encoding: "utf8" });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => {
  process.stderr.write((error instanceof Error ? error.stack || error.message : String(error)) + "\n");
  process.exitCode = 1;
});
