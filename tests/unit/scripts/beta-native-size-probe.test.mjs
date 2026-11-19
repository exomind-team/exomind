import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { analyzeLinkMap } from "../../../scripts/dev/beta-native-size-probe.mjs";

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
