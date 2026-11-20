import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import {
  MAX_MAP_BYTES,
  analyzeLinkMap,
  buildCargoArguments,
  buildComparisonReport,
  mapScanDisposition,
  parseTextSectionStats,
  summarizeDependencyGraph,
  validateBuildInvocation,
  validateResolvedVariant,
  validateVariantOutputDirectory
} from "../../../scripts/dev/beta-native-size-probe.mjs";

async function scan(text) {
  const root = mkdtempSync(join(tmpdir(), "exomind-map-test-"));
  try {
    const file = join(root, "synthetic.map");
    writeFileSync(file, text);
    return await analyzeLinkMap(file);
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    rmSync(root, { recursive: true });
  }
}

const sections = " 0001:00000000 00000200H .text CODE\n 0002:00000000 00000200H .rdata DATA\n Publics by Value\n";
const publicRow = (segment, symbol, object) => ` ${segment}:00000010 ${symbol} 0000000140001010 f ${object}\n`;
test('parses the mixed hexadecimal and decimal fields produced by llvm-readobj', () => {
  const output = `Sections [
  Section {
    Name: .text (2E 74 65 78 74 00 00 00)
    VirtualSize: 0x2B8D916
    VirtualAddress: 0x1000
    RawDataSize: 45668864
    PointerToRawData: 0x400
  }
]`;
  assert.deepEqual(parseTextSectionStats(output), {
    virtual_size_bytes: 0x2B8D916,
    virtual_address: 0x1000,
    raw_data_size_bytes: 45668864,
    pointer_to_raw_data: 0x400,
  });
});

const rootId = "path+file:///repo/src-tauri#0.6.0-beta19";
const runtimeId = "path+file:///repo/crates/exomind-runtime#0.3.0";
const rootManifestPath = join(tmpdir(), "synthetic-repo", "src-tauri", "Cargo.toml");

function cargoMetadata(variant, runtimeKind = null) {
  const legacy = variant === "legacy-default";
  const root = {
    id: rootId,
    name: "exomind",
    version: "0.6.0-beta19",
    source: null,
    manifest_path: rootManifestPath,
    features: {
      default: ["custom-protocol", "alpha-legacy-runtime"],
      "custom-protocol": ["tauri/custom-protocol"],
      "alpha-legacy-runtime": ["dep:exomind-runtime"],
      "beta-native-only": []
    },
    dependencies: [{ name: "exomind-runtime", optional: true, kind: null }]
  };
  const runtime = { id: runtimeId, name: "exomind-runtime", version: "0.3.0", source: null };
  const rootNode = {
    id: rootId,
    features: legacy ? ["alpha-legacy-runtime", "custom-protocol"] : ["beta-native-only", "custom-protocol"],
    deps: runtimeKind === null && legacy
      ? [{ pkg: runtimeId, dep_kinds: [{ kind: null, target: null }] }]
      : runtimeKind
        ? [{ pkg: runtimeId, dep_kinds: [{ kind: runtimeKind, target: null }] }]
        : []
  };
  const nodes = [{ id: rootId, ...rootNode }];
  if (rootNode.deps.length) nodes.push({ id: runtimeId, deps: [], features: [] });
  return { packages: [root, runtime], resolve: { root: null, nodes } };
}

function comparisonInput(variant) {
  const legacy = variant === "legacy-default";
  return {
    variant,
    mode: legacy ? "alpha-legacy-runtime" : "beta-native-only",
    source_sha: "a".repeat(40),
    workflow_recipe: { source_commit_sha: "a".repeat(40), recipe_sha256: "recipe-sha" },
    source_native_config: { sha256: "config-sha", identifier: "com.exomind.app.v06.beta", product_name: "ExoMind Beta", version: "0.6.0-beta19" },
    cargo: {
      package: "exomind",
      source_manifest_version: "0.6.0-beta19",
      lockfile_sha256: "lock-sha",
      target: "x86_64-pc-windows-msvc",
      profile: "dev/debug",
      flags: { build_jobs: 1, debug_level: 0, incremental: false, codegen_units: 16, linker_parallelism: 1 },
      dependency_graph: {
        root: { resolved_features: legacy ? ["alpha-legacy-runtime", "custom-protocol"] : ["beta-native-only", "custom-protocol"] },
        exomind_runtime: { normal_edge_from_root: legacy }
      }
    },
    frontend: { command_executed: "bun run build:web", build_count_for_both_variants: 1, dist: { sha256: "frontend-sha", file_count: 4, byte_length: 2048 } },
    toolchain: { rustc_verbose: "rustc stable", cargo_version: "cargo stable", linker_sha256: "linker-sha" },
    pe: {
      byte_length: legacy ? 1000 : 760,
      sha256: legacy ? "legacy-pe-sha" : "beta-pe-sha",
      text_section: { virtual_size_bytes: legacy ? 500 : 350, raw_data_size_bytes: legacy ? 512 : 384 }
    },
    link_map: {
      byte_length: legacy ? 173 * 1024 * 1024 : 90 * 1024 * 1024,
      sha256: legacy ? "legacy-map-sha" : "beta-map-sha",
      runtime_text_contribution: { status: "unclassified", has_exomind_runtime_text_contribution: null }
    }
  };
}

const mapPath = join(tmpdir(), "legacy-default", "exomind.map");

test("identifies Runtime public code in a final text segment", async () => {
  const result = await scan(sections + publicRow("0001", "_ZN15exomind_runtime3run", "exomind_runtime.rlib(root.obj)"));
  assert.equal(result.has_exomind_runtime_text_contribution, true);
  assert.equal(result.status, "detected");
});

test("recognizes LLD public rows without MSVC function flags", async () => {
  const result = await scan(sections + " 0001:001ecfa0 _RNv15exomind_runtime4tick 00000001401edfa0 libexomind_lib:source.rcgu.o\n");
  assert.equal(result.status, "detected");
  assert.equal(result.has_exomind_runtime_text_contribution, true);
});

test("a Runtime marker outside text is not proof of executable contribution", async () => {
  const result = await scan(sections + publicRow("0001", "main", "exomind.obj") + publicRow("0002", "exomind_runtime_label", "data.obj"));
  assert.equal(result.has_exomind_runtime_text_contribution, false);
  assert.match(result.interpretation, /does not prove/);
});

test("an unknown layout cannot be reported as elimination", async () => {
  const result = await scan("unknown map layout\n");
  assert.equal(result.status, "unclassified");
  assert.equal(result.has_exomind_runtime_text_contribution, null);
});

test("oversized lines stop classification and do not imply absence", async () => {
  const result = await scan(sections + "x".repeat(1024 * 1024 + 1));
  assert.equal(result.status, "unclassified");
  assert.equal(result.has_exomind_runtime_text_contribution, null);
});

test("keeps the 173 MiB map within the bounded parser and classifies over-budget maps as unknown", () => {
  assert.equal(MAX_MAP_BYTES, 256 * 1024 * 1024);
  assert.equal(mapScanDisposition(173 * 1024 * 1024), "scan");
  assert.equal(mapScanDisposition(MAX_MAP_BYTES), "scan");
  assert.equal(mapScanDisposition(MAX_MAP_BYTES + 1), "unclassified");
});

test("records the default legacy command and resolved Runtime edge", () => {
  const command = { program: "cargo", args: buildCargoArguments("legacy-default", mapPath) };
  const contract = validateBuildInvocation({ variant: "legacy-default", mode: "alpha-legacy-runtime", command, mapPath });
  assert.equal(contract.featurePolicy, "Cargo default features");
  assert.equal(command.args.includes("--no-default-features"), false);
  const graph = summarizeDependencyGraph(cargoMetadata("legacy-default"), rootManifestPath);
  assert.equal(validateResolvedVariant({ variant: "legacy-default", mode: "alpha-legacy-runtime", dependencyGraph: graph }), true);
  assert.equal(graph.exomind_runtime.normal_edge_from_root, true);
  assert.ok(graph.edges.some(edge => edge.from === "exomind@0.6.0-beta19" && edge.to === "exomind-runtime@0.3.0" && edge.dep_kinds[0].kind === "normal"));
});

test("records the explicit Native-only command and excludes a normal Runtime edge", () => {
  const betaMap = join(tmpdir(), "beta-native-only", "exomind.map");
  const command = { program: "cargo", args: buildCargoArguments("beta-native-only", betaMap) };
  const contract = validateBuildInvocation({ variant: "beta-native-only", mode: "beta-native-only", command, mapPath: betaMap });
  assert.equal(contract.runtimeNormalEdge, false);
  const featureArgsAt = command.args.indexOf("--no-default-features");
  assert.deepEqual(command.args.slice(featureArgsAt, featureArgsAt + 3), ["--no-default-features", "--features", "custom-protocol,beta-native-only"]);
  const graph = summarizeDependencyGraph(cargoMetadata("beta-native-only"), rootManifestPath);
  assert.equal(validateResolvedVariant({ variant: "beta-native-only", mode: "beta-native-only", dependencyGraph: graph }), true);
  assert.equal(graph.exomind_runtime.normal_edge_from_root, false);
  assert.equal(graph.edges.some(edge => edge.to.startsWith("exomind-runtime@")), false);
});

test("rejects a wrong variant mode, a changed feature command, or a Beta normal Runtime edge", () => {
  const betaMap = join(tmpdir(), "beta-native-only", "exomind.map");
  const command = { program: "cargo", args: buildCargoArguments("beta-native-only", betaMap) };
  assert.throws(() => validateBuildInvocation({ variant: "beta-native-only", mode: "alpha-legacy-runtime", command, mapPath: betaMap }), /mode/);
  const wrongCommand = { program: "cargo", args: command.args.filter(argument => argument !== "--no-default-features") };
  assert.throws(() => validateBuildInvocation({ variant: "beta-native-only", mode: "beta-native-only", command: wrongCommand, mapPath: betaMap }), /exact variant build contract/);
  const graph = summarizeDependencyGraph(cargoMetadata("beta-native-only", "normal"), rootManifestPath);
  assert.throws(() => validateResolvedVariant({ variant: "beta-native-only", mode: "beta-native-only", dependencyGraph: graph }), /no normal exomind-runtime edge/);
  assert.throws(() => validateBuildInvocation({ variant: "alpha-default", mode: "alpha-legacy-runtime", command, mapPath: betaMap }), /Unknown probe variant/);
});

test("requires separate clean map directories for each variant", () => {
  const root = mkdtempSync(join(tmpdir(), "exomind-ab-output-"));
  try {
    const variantDir = join(root, "legacy-default");
    mkdirSync(variantDir);
    validateVariantOutputDirectory({ variant: "legacy-default", outputRoot: root, outputDir: variantDir, mapPath: join(variantDir, "exomind.map"), entries: ["exomind.map"] });
    assert.throws(() => validateVariantOutputDirectory({ variant: "legacy-default", outputRoot: root, outputDir: root, mapPath: join(root, "exomind.map"), entries: ["exomind.map"] }), /own named evidence directory/);
    assert.throws(() => validateVariantOutputDirectory({ variant: "legacy-default", outputRoot: root, outputDir: variantDir, mapPath: join(variantDir, "exomind.map"), entries: ["exomind.map", "old.map"] }), /initially contain only/);
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    rmSync(root, { recursive: true });
  }
});

test("extracts PE .text virtual and raw section sizes", () => {
  const output = `Sections [\n  Section {\n    Number: 1\n    Name: .text (2E 74 65 78 74 00 00 00)\n    VirtualSize: 0x1234\n    VirtualAddress: 0x1000\n    RawDataSize: 0x1400\n    PointerToRawData: 0x400\n  }\n  Section {\n    Number: 2\n    Name: .rdata (2E 72 64 61 74 61 00 00)\n    VirtualSize: 0x50\n    VirtualAddress: 0x3000\n    RawDataSize: 0x200\n    PointerToRawData: 0x1800\n  }\n]\n`;
  assert.deepEqual(parseTextSectionStats(output), {
    virtual_size_bytes: 0x1234,
    virtual_address: 0x1000,
    raw_data_size_bytes: 0x1400,
    pointer_to_raw_data: 0x400
  });
});

test("compares PE and .text deltas only for matching source, recipe and shared build identity", () => {
  const comparison = buildComparisonReport(comparisonInput("legacy-default"), comparisonInput("beta-native-only"));
  assert.equal(comparison.same_source_sha, true);
  assert.equal(comparison.deltas_beta_minus_legacy.pe_bytes, -240);
  assert.equal(comparison.deltas_beta_minus_legacy.pe_percent_of_legacy, -24);
  assert.equal(comparison.deltas_beta_minus_legacy.text_virtual_size_bytes, -150);
  assert.match(comparison.interpretation_boundary, /does not represent APK size/);

  const wrongSource = comparisonInput("beta-native-only");
  wrongSource.source_sha = "f".repeat(40);
  assert.throws(() => buildComparisonReport(comparisonInput("legacy-default"), wrongSource), /same source SHA/);
  const wrongFrontend = comparisonInput("beta-native-only");
  wrongFrontend.frontend.dist.sha256 = "different-frontend";
  assert.throws(() => buildComparisonReport(comparisonInput("legacy-default"), wrongFrontend), /same recipe, Beta config, lockfile, frontend dist, toolchain, profile and flags/);
});
