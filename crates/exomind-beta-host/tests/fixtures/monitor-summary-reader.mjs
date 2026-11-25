// Receives only this test's synthetic, scoped handoff over stdin. No tokens in argv/logs.
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const override = process.env.EXOMIND_BETA_MONITOR_SDK_PATH;
if (override !== undefined) assert.ok(isAbsolute(override), 'explicit installed SDK path must be absolute');
const adapterPath = override ?? join(homedir(), '.claude', 'skills', 'exomind-monitor', 'scripts', 'beta-monitor-adapter.mjs');
const { createBetaMonitorAdapter } = await import(pathToFileURL(adapterPath).href);

const chunks = [];
let size = 0;
for await (const chunk of process.stdin) {
  size += chunk.length;
  assert.ok(size <= 65536, 'bounded synthetic fixture input');
  chunks.push(chunk);
}
const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const states = new Map();
const stateStore = {
  async load(key) { return states.get(key) ?? null; },
  async save(key, value) { states.set(key, structuredClone(value)); },
};
const requests = [];
const create = () => createBetaMonitorAdapter({
  handoff: input.handoff, target: input.target, stateStore,
  fetchImpl: async (url, options) => {
    requests.push({ path: new URL(url).pathname, method: options.method });
    return fetch(url, options);
  },
});
let monitor = create();
const deadline = setTimeout(() => { process.exitCode = 1; void monitor.stop(); }, 20000);
try {
  await monitor.connect();
  const legacy = await monitor.readHistory({ maxPages: 1 });
  assert.equal(legacy.coverage, undefined);
  assert.equal(requests.some(request => request.path.endsWith('/timeline')), false);
  const summaries = new Map();
  const agentSummaries = new Map();
  let through;
  let complete = false;
  let reads = 0;
  while (!complete && reads < 20) {
    const result = await monitor.readHistory({ maxPages: 1, includeSummaryFeeds: true });
    through ??= result.through;
    assert.equal(result.through, through);
    for (const [feed, collected] of [[result.feeds.summaries, summaries], [result.feeds.agentSummaries, agentSummaries]]) {
      assert.equal(feed.available, true);
      assert.equal(feed.through, through);
      for (const item of feed.records) collected.set(item.record.event_id, item);
    }
    complete = result.coverage.full_history_complete;
    reads++;
    // Real adapter reconstruction exercises persisted continuation after a partial page.
    if (reads === 1) {
      assert.equal(complete, false);
      await monitor.stop();
      monitor = create();
      await monitor.connect();
    }
  }
  assert.equal(complete, true);
  assert.deepEqual([...summaries.keys()], [input.summary.record.event_id]);
  assert.deepEqual([...agentSummaries.keys()], [input.agentSummary.record.event_id]);
  assert.deepEqual(summaries.get(input.summary.record.event_id), input.summary);
  assert.deepEqual(agentSummaries.get(input.agentSummary.record.event_id), input.agentSummary);
  assert.equal(requests.filter(request => request.method !== 'GET').every(request => request.path.endsWith('/access/check')), true);
  process.stdout.write(JSON.stringify({ complete, reads, summaries: summaries.size, agentSummaries: agentSummaries.size }) + '\n');
} catch (error) {
  // Assertions can contain fixture bodies, so keep subprocess failure output bounded and anonymous.
  process.stderr.write('monitor_summary_http_failed: ' + (error.code ?? error.name) + '\n');
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await monitor.stop();
}
