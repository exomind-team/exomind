import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { SummaryWorker, ChatCompletionProvider, validateSummary } from '../runtime/summary.mjs';
import { app } from './helpers.mjs';
function block(store) { const id = randomUUID(); store.startBlock({ id, name: '生活记录' }); store.capture({ id: randomUUID(), text: '喝水、散步，不是工作绩效', blockId: id }, () => true); store.endBlock({ id: randomUUID(), blockId: id, feedback: '休息了一会儿' }); return id; }
function output(context) { return { narrative: '记录了喝水和散步，随后结束休息。', evidence: context.sources.map(x => x.id), uncertainties: ['这只是本机已记录的部分。'] }; }
test('缺少模型时保留待配置任务，不编造 AI 总结', async (t) => { const a = await app(t); block(a.store); await a.summaries.tick(); assert.equal(a.store.jobs()[0].state, 'waiting_provider'); assert.equal(a.store.db.prepare("SELECT COUNT(*) AS n FROM operations WHERE kind='summary'").get().n, 0); });
test('结构化输出只引用已读取证据，并事务保存一次', async (t) => { const a = await app(t); block(a.store); const worker = new SummaryWorker(a.store, { generate: async (context) => output(context) }); await worker.tick(); assert.equal(a.store.jobs()[0].state, 'succeeded'); await worker.tick(); assert.equal(a.store.db.prepare("SELECT COUNT(*) AS n FROM operations WHERE kind='summary'").get().n, 1); const op = a.store.operation(a.store.jobs()[0].result_id); assert.equal(op.payload.coverage.attachments, 'metadata_only'); });
test('取消后迟到模型结果不提交', async (t) => { const a = await app(t); block(a.store); let release; const worker = new SummaryWorker(a.store, { generate: context => new Promise(resolve => { release = () => resolve(output(context)); }) }); const run = worker.tick(); const job = a.store.jobs()[0]; worker.cancel(job.id); release(); await run; assert.equal(a.store.jobs()[0].state, 'cancelled'); assert.equal(a.store.db.prepare("SELECT COUNT(*) AS n FROM operations WHERE kind='summary'").get().n, 0); });
test('关闭后迟到结果不提交，任务留待恢复', async (t) => { const a = await app(t); block(a.store); let release; const worker = new SummaryWorker(a.store, { generate: context => new Promise(resolve => { release = () => resolve(output(context)); }) }); const run = worker.tick(); const stop = worker.stop(); release(); await run; await stop; assert.equal(a.store.jobs()[0].state, 'pending'); assert.equal(a.store.jobs()[0].result_id, null); });
test('假引用、空引用和缺少覆盖警告均拒绝', async (t) => { const a = await app(t); block(a.store); const ctx = a.store.context(a.store.jobs()[0]); assert.throws(() => validateSummary({ ...output(ctx), evidence: [randomUUID()] }, ctx), /未读取/); assert.throws(() => validateSummary({ ...output(ctx), evidence: [] }, ctx), /必须关联/); assert.throws(() => validateSummary({ ...output(ctx), uncertainties: [] }, { ...ctx, coverage: { ...ctx.coverage, readStatus: 'partial' } }), /必须明确/); });
test('模型异常留下失败原因，不返回空成功', async (t) => { const a = await app(t); block(a.store); const worker = new SummaryWorker(a.store, { generate: async () => { throw new Error('synthetic_failure'); } }); await worker.tick(); const job = a.store.jobs()[0]; assert.equal(job.state, 'pending'); assert.ok(job.error); assert.equal(job.result_id, null); });
test('进程恢复会废除旧运行身份', async (t) => { const a = await app(t); block(a.store); const old = a.store.claimJob(true), context = a.store.context(old); a.store.recoverJobs(); const newer = a.store.claimJob(true); assert.notEqual(old.run_id, newer.run_id); assert.equal(a.store.finishJob(old, output(context), context.coverage), false); assert.equal(a.store.finishJob(newer, output(context), context.coverage), true); });
test('真实 HTTP 模型适配器连接模拟服务；不当作真实模型能力评测', async (t) => {
    let seen;
    const server = http.createServer(async (req, res) => { const chunks = []; for await (const c of req)
        chunks.push(c); seen = JSON.parse(Buffer.concat(chunks)); const context = JSON.parse(seen.messages[1].content); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output(context)) } }] })); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const a = await app(t);
    block(a.store);
    const provider = new ChatCompletionProvider({ url: `http://127.0.0.1:${server.address().port}/chat/completions`, model: 'fixture', key: 'not-a-real-key' });
    const worker = new SummaryWorker(a.store, provider);
    await worker.tick();
    assert.equal(seen.model, 'fixture');
    assert.equal(a.store.jobs()[0].state, 'succeeded');
});
