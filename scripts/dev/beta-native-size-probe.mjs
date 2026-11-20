import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const MAX_MAP_BYTES = 256 * 1024 * 1024;
const MAX_MAP_LINE_CHARS = 1024 * 1024;
const MAX_EVIDENCE_ROWS = 32;
const MAX_METADATA_BYTES = 64 * 1024 * 1024;
const RUNTIME_MARKER = /exomind[-_]runtime/i;
const TARGET = "x86_64-pc-windows-msvc";
const VARIANTS = Object.freeze({
  "legacy-default": Object.freeze({
    mode: "alpha-legacy-runtime",
    featureArgs: Object.freeze([]),
    requiredFeatures: Object.freeze(["custom-protocol", "alpha-legacy-runtime"]),
    forbiddenFeatures: Object.freeze(["beta-native-only"]),
    runtimeNormalEdge: true,
    featurePolicy: "Cargo default features"
  }),
  "beta-native-only": Object.freeze({
    mode: "beta-native-only",
    featureArgs: Object.freeze(["--no-default-features", "--features", "custom-protocol,beta-native-only"]),
    requiredFeatures: Object.freeze(["custom-protocol", "beta-native-only"]),
    forbiddenFeatures: Object.freeze(["alpha-legacy-runtime", "default"]),
    runtimeNormalEdge: false,
    featurePolicy: "explicit custom-protocol,beta-native-only with defaults disabled"
  })
});

function need(name) {
  const value = process.env[name];
  if (!value) throw new Error("Required environment value is missing: " + name);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function variantContract(variant) {
  const contract = VARIANTS[variant];
  assert(contract, "Unknown probe variant: " + variant);
  return contract;
}

export function buildCargoArguments(variant, mapPath) {
  const contract = variantContract(variant);
  assert(typeof mapPath === "string" && isAbsolute(mapPath), "Variant map path must be absolute");
  return [
    "rustc", "--locked", "--manifest-path", "src-tauri/Cargo.toml", "--package", "exomind",
    "--target", TARGET, "--bin", "exomind", ...contract.featureArgs,
    "--", "-C", "link-arg=/MAP:" + mapPath
  ];
}

export function buildMetadataArguments(variant) {
  const contract = variantContract(variant);
  return [
    "metadata", "--locked", "--format-version", "1", "--manifest-path", "src-tauri/Cargo.toml",
    "--filter-platform", TARGET, ...contract.featureArgs
  ];
}

export function validateBuildInvocation({ variant, mode, command, mapPath }) {
  const contract = variantContract(variant);
  assert(mode === contract.mode, "Probe mode does not match variant identity");
  const expected = buildCargoArguments(variant, mapPath);
  assert(command?.program === "cargo" && Array.isArray(command.args), "Recorded build command must identify cargo and its argument vector");
  assert(command.args.length === expected.length && command.args.every((value, index) => value === expected[index]), "Recorded Cargo command differs from the exact variant build contract");
  return contract;
}

export function validateVariantOutputDirectory({ variant, outputRoot, outputDir, mapPath, entries }) {
  variantContract(variant);
  const expectedDir = resolve(outputRoot, variant);
  const expectedMap = join(expectedDir, "exomind.map");
  assert(resolve(outputDir).toLowerCase() === expectedDir.toLowerCase(), "Each variant must use its own named evidence directory");
  assert(resolve(mapPath).toLowerCase() === resolve(expectedMap).toLowerCase(), "Each variant map must stay in its own evidence directory");
  assert(Array.isArray(entries) && entries.length === 1 && entries[0] === "exomind.map", "Variant evidence directory must initially contain only its new root-binary map");
}

export function mapScanDisposition(byteLength) {
  assert(Number.isSafeInteger(byteLength) && byteLength >= 0, "Map byte length must be a nonnegative safe integer");
  return byteLength <= MAX_MAP_BYTES ? "scan" : "unclassified";
}

function packageSourceKind(source) {
  if (!source) return "workspace";
  if (source.startsWith("registry+")) return "registry";
  if (source.startsWith("git+")) return "git";
  return "path";
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizeDependencyKinds(kinds) {
  return (kinds || []).map(({ kind, target }) => ({ kind: kind || "normal", target: target || null }))
    .sort((a, b) => compareText(a.kind, b.kind) || compareText(a.target || "", b.target || ""));
}

export function summarizeDependencyGraph(metadata, rootManifestPath) {
  const packageList = metadata.packages || [];
  const packages = new Map(packageList.map(pkg => [pkg.id, pkg]));
  const nodes = metadata.resolve?.nodes;
  assert(Array.isArray(nodes), "Cargo metadata must include a resolved dependency graph");
  const rootPackage = rootManifestPath
    ? packageList.find(pkg => resolve(pkg.manifest_path) === resolve(rootManifestPath))
    : packages.get(metadata.resolve?.root);
  assert(rootPackage, "Cargo metadata does not contain the requested root manifest package");
  const rootId = rootPackage.id;
  const rootNode = nodes.find(node => node.id === rootId);
  assert(rootNode, "Cargo metadata root package is missing from its resolved graph");

  const activePackages = nodes.map(node => packages.get(node.id));
  assert(activePackages.every(Boolean), "Cargo metadata graph references a missing package record");
  const grouped = new Map();
  for (const pkg of activePackages) {
    const key = `${pkg.name}@${pkg.version}`;
    const group = grouped.get(key) || [];
    group.push(pkg);
    grouped.set(key, group);
  }
  const graphKey = new Map();
  for (const [base, group] of grouped) {
    group.sort((a, b) => compareText(packageSourceKind(a.source), packageSourceKind(b.source)) || compareText(a.id, b.id));
    group.forEach((pkg, index) => graphKey.set(pkg.id, group.length === 1 ? base : `${base}#${packageSourceKind(pkg.source)}-${index + 1}`));
  }
  const resolvedById = new Map(nodes.map(node => [node.id, node]));
  const graphNodes = nodes.map(node => {
    const pkg = packages.get(node.id);
    return {
      package: graphKey.get(node.id),
      source_kind: packageSourceKind(pkg.source),
      features: [...(node.features || [])].sort(compareText)
    };
  }).sort((a, b) => compareText(a.package, b.package));
  const graphEdges = [];
  for (const node of nodes) {
    for (const dependency of node.deps || []) {
      assert(graphKey.has(dependency.pkg), "Cargo dependency graph references a package without a resolved node");
      graphEdges.push({
        from: graphKey.get(node.id),
        to: graphKey.get(dependency.pkg),
        dep_kinds: normalizeDependencyKinds(dependency.dep_kinds)
      });
    }
  }
  graphEdges.sort((a, b) => compareText(a.from, b.from) || compareText(a.to, b.to) || compareText(JSON.stringify(a.dep_kinds), JSON.stringify(b.dep_kinds)));

  const runtimePackages = (metadata.packages || []).filter(pkg => pkg.name === "exomind-runtime");
  const runtimeIds = new Set(runtimePackages.map(pkg => pkg.id));
  const runtimeRootEdges = (rootNode.deps || []).filter(dependency => runtimeIds.has(dependency.pkg));
  const runtimeKinds = runtimeRootEdges.flatMap(dependency => normalizeDependencyKinds(dependency.dep_kinds));
  const declaredRuntime = (rootPackage.dependencies || []).find(dependency => dependency.name === "exomind-runtime");
  const declaredFeatures = Object.fromEntries(Object.entries(rootPackage.features || {}).map(([name, values]) => [name, [...values].sort(compareText)]));
  const resolvedFeatures = [...(rootNode.features || [])].sort(compareText);

  return {
    root: {
      package: graphKey.get(rootId),
      name: rootPackage.name,
      version: rootPackage.version,
      declared_features: declaredFeatures,
      resolved_features: resolvedFeatures
    },
    node_count: graphNodes.length,
    edge_count: graphEdges.length,
    nodes: graphNodes,
    edges: graphEdges,
    exomind_runtime: {
      declared_optional: declaredRuntime ? Boolean(declaredRuntime.optional) : null,
      present_in_resolved_graph: runtimePackages.some(pkg => resolvedById.has(pkg.id)),
      normal_edge_from_root: runtimeKinds.some(dependency => dependency.kind === "normal"),
      root_edge_kinds: runtimeKinds
    }
  };
}

export function validateResolvedVariant({ variant, mode, dependencyGraph }) {
  const contract = variantContract(variant);
  assert(mode === contract.mode, "Resolved Cargo mode does not match variant identity");
  const features = new Set(dependencyGraph.root.resolved_features);
  for (const feature of contract.requiredFeatures) assert(features.has(feature), `Resolved ${variant} graph is missing feature ${feature}`);
  for (const feature of contract.forbiddenFeatures) assert(!features.has(feature), `Resolved ${variant} graph unexpectedly enables feature ${feature}`);
  if (variant === "legacy-default") {
    const defaults = new Set(dependencyGraph.root.declared_features.default || []);
    assert(contract.requiredFeatures.every(feature => defaults.has(feature)), "Legacy default feature set no longer identifies the Alpha Runtime baseline");
  }
  assert(dependencyGraph.exomind_runtime.normal_edge_from_root === contract.runtimeNormalEdge,
    variant === "beta-native-only"
      ? "Beta Native-only graph must have no normal exomind-runtime edge"
      : "Legacy default graph must retain its normal exomind-runtime edge");
  return true;
}

export function parseTextSectionStats(output) {
  const blocks = [...output.matchAll(/^\s*Section\s*\{\r?\n([\s\S]*?)^\s*\}/gm)].map(match => match[1]);
  const textBlocks = blocks.filter(block => /^\s*Name:\s*\.text(?:\s|\(|$)/im.test(block));
  assert(textBlocks.length === 1, "PE section table must contain exactly one .text section");
  const block = textBlocks[0];
  const readInteger = field => {
    const match = new RegExp(`^\\s*${field}:\\s*(0x[0-9a-f]+|[0-9]+)\\s*$`, "im").exec(block);
    assert(match, `PE .text section is missing ${field}`);
    const value = Number(match[1]);
    assert(Number.isSafeInteger(value), `PE .text ${field} exceeds the safe integer range`);
    return value;
  };
  return {
    virtual_size_bytes: readInteger("VirtualSize"),
    virtual_address: readInteger("VirtualAddress"),
    raw_data_size_bytes: readInteger("RawDataSize"),
    pointer_to_raw_data: readInteger("PointerToRawData")
  };
}

export async function analyzeLinkMap(file) {
  const stats = statSync(file);
  assert(stats.isFile() && stats.size > 0 && stats.size <= MAX_MAP_BYTES, "Link map must be nonempty and no larger than 256 MiB");
  const textSegments = new Set();
  const evidenceRows = [];
  let publicTableSeen = false;
  let parsedPublicRows = 0;
  let parsedTextPublicRows = 0;
  let unparsedAddressRows = 0;
  let lineNumber = 0;
  let oversizedLine = false;
  const sectionRow = /^\s*([0-9a-f]{4}):[0-9a-f]+\s+[0-9a-f]+H\s+(\.\S+)\s+CODE\s*$/i;
  const publicRow = /^\s*([0-9a-f]{4}):[0-9a-f]+\s+(.+?)\s+[0-9a-f]{8,16}\s+(?:[fi]\s+)*(.+?)\s*$/i;

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

async function sha256File(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function hashDirectory(directory) {
  const files = [];
  const visit = current => {
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) => compareText(a.name, b.name));
    for (const entry of entries) {
      const path = join(current, entry.name);
      assert(!entry.isSymbolicLink(), "Frontend dist must not contain symbolic links");
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
      else throw new Error("Frontend dist contains an unsupported filesystem entry");
    }
  };
  visit(directory);
  assert(files.length > 0, "Frontend dist is empty");
  const hash = createHash("sha256");
  let totalBytes = 0;
  for (const file of files) {
    const bytes = statSync(file).size;
    totalBytes += bytes;
    hash.update(relative(directory, file).split(sep).join("/")).update("\0").update(String(bytes)).update("\0");
    hash.update(await sha256File(file)).update("\n");
  }
  return { sha256: hash.digest("hex"), file_count: files.length, byte_length: totalBytes };
}

function runGit(args) {
  const result = spawnSync("git", args, { encoding: "utf8", windowsHide: true, timeout: 10000 });
  if (result.error || result.status !== 0) throw new Error("git " + args.join(" ") + " failed");
  return result.stdout.trim();
}

function runCaptured(program, args, { timeout = 30000, maxBuffer = 16 * 1024 * 1024 } = {}) {
  const result = spawnSync(program, args, { encoding: "utf8", windowsHide: true, timeout, maxBuffer });
  if (result.error || result.status !== 0) {
    throw new Error(`${program} ${args.join(" ")} failed: ${result.error?.message || result.stderr || "unknown error"}`);
  }
  return result.stdout.trim();
}

function runCargoMetadata(variant) {
  const args = buildMetadataArguments(variant);
  const result = spawnSync("cargo", args, {
    encoding: "utf8", windowsHide: true, timeout: 120000, maxBuffer: MAX_METADATA_BYTES
  });
  if (result.error || result.status !== 0) {
    throw new Error("cargo " + args.join(" ") + " failed: " + (result.error?.message || result.stderr || "unknown error"));
  }
  try {
    return { command: { program: "cargo", args }, metadata: JSON.parse(result.stdout) };
  } catch (error) {
    throw new Error("Cargo metadata did not return valid JSON: " + (error instanceof Error ? error.message : String(error)));
  }
}

function isOutside(root, path) {
  const pathFromRoot = relative(root, path);
  return isAbsolute(pathFromRoot) || pathFromRoot === ".." || pathFromRoot.startsWith(".." + sep);
}

function sharedComparisonIdentity(report) {
  return JSON.stringify({
    source_sha: report.source_sha,
    workflow_recipe: report.workflow_recipe,
    source_native_config: report.source_native_config,
    cargo: {
      package: report.cargo.package,
      source_manifest_version: report.cargo.source_manifest_version,
      lockfile_sha256: report.cargo.lockfile_sha256,
      target: report.cargo.target,
      profile: report.cargo.profile,
      flags: report.cargo.flags
    },
    frontend: report.frontend,
    toolchain: report.toolchain
  });
}

export function buildComparisonReport(legacy, beta) {
  assert(legacy.variant === "legacy-default" && legacy.mode === "alpha-legacy-runtime", "First comparison input must be the legacy default variant");
  assert(beta.variant === "beta-native-only" && beta.mode === "beta-native-only", "Second comparison input must be the Beta Native-only variant");
  assert(legacy.source_sha === beta.source_sha, "A/B comparison requires the same source SHA");
  assert(sharedComparisonIdentity(legacy) === sharedComparisonIdentity(beta), "A/B comparison requires the same recipe, Beta config, lockfile, frontend dist, toolchain, profile and flags");
  assert(legacy.cargo.dependency_graph.exomind_runtime.normal_edge_from_root, "Legacy baseline must retain its normal exomind-runtime edge");
  assert(!beta.cargo.dependency_graph.exomind_runtime.normal_edge_from_root, "Beta Native-only variant must have no normal exomind-runtime edge");
  const peDelta = beta.pe.byte_length - legacy.pe.byte_length;
  return {
    evidence_kind: "windows-native-size-probe-ab-comparison",
    candidate_build: false,
    frozen_beta18_candidate: false,
    source_sha: legacy.source_sha,
    recipe_sha256: legacy.workflow_recipe.recipe_sha256,
    same_source_sha: true,
    same_beta_config: true,
    same_frontend_dist: true,
    same_toolchain_profile_and_flags: true,
    variants: {
      legacy_default: {
        mode: legacy.mode,
        features: legacy.cargo.dependency_graph.root.resolved_features,
        pe_bytes: legacy.pe.byte_length,
        pe_sha256: legacy.pe.sha256,
        text_section: legacy.pe.text_section,
        map_bytes: legacy.link_map.byte_length,
        map_sha256: legacy.link_map.sha256,
        runtime_text_contribution: legacy.link_map.runtime_text_contribution,
        exomind_runtime_normal_edge: legacy.cargo.dependency_graph.exomind_runtime.normal_edge_from_root
      },
      beta_native_only: {
        mode: beta.mode,
        features: beta.cargo.dependency_graph.root.resolved_features,
        pe_bytes: beta.pe.byte_length,
        pe_sha256: beta.pe.sha256,
        text_section: beta.pe.text_section,
        map_bytes: beta.link_map.byte_length,
        map_sha256: beta.link_map.sha256,
        runtime_text_contribution: beta.link_map.runtime_text_contribution,
        exomind_runtime_normal_edge: beta.cargo.dependency_graph.exomind_runtime.normal_edge_from_root
      }
    },
    deltas_beta_minus_legacy: {
      pe_bytes: peDelta,
      pe_percent_of_legacy: Number((peDelta / legacy.pe.byte_length * 100).toFixed(6)),
      text_virtual_size_bytes: beta.pe.text_section.virtual_size_bytes - legacy.pe.text_section.virtual_size_bytes,
      text_raw_data_size_bytes: beta.pe.text_section.raw_data_size_bytes - legacy.pe.text_section.raw_data_size_bytes
    },
    interpretation_boundary: "Same-source Windows x86_64 dev-profile root-PE/link-map evidence only. It does not represent APK size, release builds, runtime behavior, or energy use. Map classification is bounded evidence; retain and inspect both raw maps."
  };
}

async function captureToolchain(linker, readobj) {
  return {
    rustc_verbose: runCaptured("rustc", ["-Vv"]),
    cargo_version: runCaptured("cargo", ["-V"]),
    target: TARGET,
    linker: "Rust toolchain rust-lld.exe",
    linker_version: runCaptured(linker, ["--version"]),
    linker_sha256: await sha256File(linker),
    llvm_readobj_version: runCaptured(readobj, ["--version"]),
    llvm_readobj_sha256: await sha256File(readobj)
  };
}

function captureBuildFlags() {
  assert(process.env.CARGO_BUILD_JOBS === "1", "Cargo build jobs must be exactly one");
  assert(process.env.CARGO_PROFILE_DEV_DEBUG === "0", "Cargo dev debug level must be zero");
  assert(process.env.CARGO_PROFILE_DEV_INCREMENTAL === "false", "Cargo incremental compilation must be disabled");
  assert(process.env.CARGO_PROFILE_DEV_CODEGEN_UNITS === "16", "Cargo codegen units must be exactly 16");
  const linker = need("CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER");
  assert(/rust-lld\.exe$/i.test(linker), "The Windows Rust toolchain lld linker must be selected");
  const rustflags = need("RUSTFLAGS");
  assert(rustflags.includes("-C linker-flavor=lld-link") && rustflags.includes("-C link-arg=/threads:1") && rustflags.includes("-C link-arg=/DEBUG:NONE"), "Windows lld flags differ from the bounded probe contract");
  return {
    build_jobs: 1,
    debug_level: 0,
    incremental: false,
    codegen_units: 16,
    linker: "Rust toolchain rust-lld.exe",
    linker_flavor: "lld-link",
    linker_parallelism: 1,
    linker_debug: "NONE",
    rustflags,
    map_argument_scope: "cargo rustc --bin exomind final root binary only"
  };
}

async function main() {
  const repoRoot = process.cwd();
  const expectedSha = need("GITHUB_SHA").toLowerCase();
  const actualSha = runGit(["rev-parse", "HEAD"]).toLowerCase();
  assert(actualSha === expectedSha && need("SOURCE_SHA").toLowerCase() === actualSha, "Checked-out source SHA differs from the triggering source SHA");
  assert(runGit(["status", "--porcelain=v1", "--untracked-files=all"]) === "", "Source checkout is not clean after the build");

  const variant = need("PROBE_VARIANT");
  const mode = need("PROBE_MODE");
  const outputRoot = resolve(need("PROBE_OUTPUT_ROOT"));
  const outputDir = resolve(need("PROBE_OUTPUT_DIR"));
  const mapPath = resolve(need("PROBE_MAP_PATH"));
  const binary = resolve(need("PROBE_BINARY_PATH"));
  const outputRelative = relative(repoRoot, outputDir);
  assert(isOutside(repoRoot, outputDir) && isOutside(repoRoot, outputRoot), "Probe artifacts must stay outside the source checkout");
  assert(outputRelative, "Probe evidence must be stored outside the source checkout");
  const artifactMap = join(outputDir, "exomind.map");
  const entries = readdirSync(outputDir);
  validateVariantOutputDirectory({ variant, outputRoot, outputDir, mapPath, entries });
  assert(mapPath.toLowerCase() === artifactMap.toLowerCase(), "Expected the root linker map in this variant evidence directory");
  assert(statSync(binary).isFile(), "The exact Windows root executable is missing");
  const mapStats = statSync(mapPath);
  assert(mapStats.isFile() && mapStats.size > 0, "Link map is missing or empty");

  const command = JSON.parse(need("PROBE_BUILD_COMMAND_JSON"));
  const contract = validateBuildInvocation({ variant, mode, command, mapPath });
  const metadataResult = runCargoMetadata(variant);
  const dependencyGraph = summarizeDependencyGraph(metadataResult.metadata, join(repoRoot, "src-tauri", "Cargo.toml"));
  validateResolvedVariant({ variant, mode, dependencyGraph });

  const configPath = join(repoRoot, "src-tauri", "tauri.beta.conf.json");
  const configText = readFileSync(configPath, "utf8");
  const config = JSON.parse(configText);
  const passedConfig = JSON.parse(need("TAURI_CONFIG"));
  assert(JSON.stringify(passedConfig) === JSON.stringify(config), "TAURI_CONFIG differs from the checked-in Beta Native config");
  assert(config.identifier === "com.exomind.app.v06.beta", "Unexpected current Beta Native identifier");
  assert(config.productName === "ExoMind Beta", "Unexpected current Beta Native product name");
  assert(/^0\.6\.0-beta[1-9][0-9]*$/.test(config.version), "Current Beta Native config version is invalid");
  assert(config.version === need("PROBE_VERSION"), "Probe version differs from source config");
  assert(config.build?.beforeBuildCommand === "bun run build:web", "Current Beta beforeBuildCommand changed");
  assert(need("PROBE_PE_PRODUCT_NAME") === config.productName, "PE product name differs from source config");
  assert(need("PROBE_PE_PRODUCT_VERSION") === config.version, "PE product version differs from source config");
  assert(need("PROBE_PE_FILE_VERSION") === config.version, "PE file version differs from source config");

  const frontendEntry = join(repoRoot, "dist", "beta.html");
  assert(statSync(frontendEntry).isFile(), "The single Beta frontend build did not produce dist/beta.html");
  const frontendDist = await hashDirectory(join(repoRoot, "dist"));
  const linker = need("CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER");
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
  const textSection = parseTextSectionStats(sections.stdout);
  writeFileSync(join(outputDir, "pe-sections.txt"), sections.stdout, { flag: "wx", encoding: "utf8" });

  const mapDisposition = mapScanDisposition(mapStats.size);
  const mapAnalysis = mapDisposition === "scan"
    ? await analyzeLinkMap(artifactMap)
    : { status: "unclassified", has_exomind_runtime_text_contribution: null, reason: "map_scan_budget", interpretation: "The raw map is retained; exceeding the 256 MiB scan budget is not evidence of elimination." };
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
  const cargoManifest = readFileSync(join(repoRoot, "src-tauri", "Cargo.toml"), "utf8");
  const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargoManifest)?.[1] || null;
  const mapAnalysisRecord = { ...mapAnalysis, scan_disposition: mapDisposition };
  const flags = captureBuildFlags();
  const report = {
    evidence_kind: "windows-native-link-map-source-probe-variant",
    evidence_label: variant,
    variant,
    mode: contract.mode,
    feature_policy: contract.featurePolicy,
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
      lockfile_sha256: await sha256File(join(repoRoot, "Cargo.lock")),
      command: command,
      metadata_command: metadataResult.command,
      target: TARGET,
      profile: "dev/debug",
      flags,
      dependency_graph: dependencyGraph
    },
    toolchain: await captureToolchain(linker, readobj),
    frontend: {
      before_build_command: config.build.beforeBuildCommand,
      command_executed: "bun run build:web",
      build_count_for_both_variants: 1,
      beta_entry_present: true,
      dist: { path: "dist", ...frontendDist },
      app_launched: false
    },
    pe: {
      file_name: "exomind.exe",
      byte_length: statSync(binary).size,
      sha256: await sha256File(binary),
      product_name: process.env.PROBE_PE_PRODUCT_NAME,
      product_version: process.env.PROBE_PE_PRODUCT_VERSION,
      file_version: process.env.PROBE_PE_FILE_VERSION,
      sections_file: "pe-sections.txt",
      text_section: textSection
    },
    link_map: {
      file: "exomind.map",
      byte_length: mapStats.size,
      sha256: await sha256File(artifactMap),
      runtime_text_contribution: mapAnalysisRecord,
      root_binary_only: true,
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

  if (variant === "beta-native-only") {
    const legacyPath = join(outputRoot, "legacy-default", "probe-info.json");
    assert(existsSync(legacyPath), "The legacy default evidence must be captured before Beta Native-only");
    const legacy = JSON.parse(readFileSync(legacyPath, "utf8"));
    const comparison = buildComparisonReport(legacy, report);
    writeFileSync(join(outputRoot, "comparison.json"), JSON.stringify(comparison, null, 2) + "\n", { flag: "wx", encoding: "utf8" });
  }
  process.stdout.write(`Captured ${variant} PE and root-only map evidence in ${outputDir}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  process.stderr.write((error instanceof Error ? error.stack || error.message : String(error)) + "\n");
  process.exitCode = 1;
});
