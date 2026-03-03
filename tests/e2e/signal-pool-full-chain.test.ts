// signal-pool-full-chain.test.ts — E2E: 完整一天场景
//
// Tests the complete signal chain for a typical day scenario:
//   1. User inputs multiple text entries throughout the day
//   2. Classifier categorizes each input
//   3. Task Actor creates tasks from classified items
//   4. EventLog Actor records all user inputs
//   5. At day end, session.end triggers Reviewer Agent
//   6. Reviewer produces a four-line review summary
//
// This is the highest-level E2E test, exercising the full SignalPool pipeline.
//
// Prerequisites:
//   - exomind-rt running with all actors/agents registered
//   - Route table configured with innate routes

import { test, expect } from '@playwright/test';

const RT_BASE_URL = process.env.EXOMIND_RT_URL ?? 'http://127.0.0.1:1949';

test.describe('Signal Pool Full Chain', () => {
  test.skip(
    !process.env.EXOMIND_RT_URL,
    'Skipped: requires running exomind-rt (set EXOMIND_RT_URL)',
  );

  test('complete day scenario', async ({ request }) => {
    const traceId = `e2e-fullchain-${Date.now()}`;

    // ── Step 1: Input multiple text entries ──

    const inputs = [
      '上午开始架构设计工作',
      '完成了 SignalPool 的类型定义',
      '下午和团队讨论了 Actor 模型方案',
      '编写了集成测试骨架',
      '修复了一个 SSE 超时 bug',
    ];

    const publishedIds: string[] = [];

    for (const text of inputs) {
      const res = await request.post(`${RT_BASE_URL}/signals/publish`, {
        data: {
          topic: 'user.input.text',
          source: 'e2e-test',
          payload: { text },
          trace_id: traceId,
        },
      });

      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.accepted).toBe(true);
      publishedIds.push(body.event_id);
    }

    expect(publishedIds.length).toBe(inputs.length);

    // ── Step 2: Verify all inputs are in history ──

    const historyRes = await request.get(`${RT_BASE_URL}/signals/history?limit=50`);
    expect(historyRes.ok()).toBeTruthy();
    const history = await historyRes.json();

    for (const id of publishedIds) {
      const found = history.find((e: { id: string }) => e.id === id);
      expect(found).toBeTruthy();
    }

    // ── Step 3: Verify classification and task creation ──
    // TODO(Phase 2): When Classifier Agent is active:
    //   - Wait for input.classified signals
    //   - Verify type field (task/knowledge/chat)
    //   - Wait for task.auto-created signals for task-type classifications

    // ── Step 4: Verify eventlog recording ──
    // TODO(Phase 2): When EventLog Actor is active:
    //   - Wait for eventlog.appended signals
    //   - Verify each user.input.text produces an eventlog.appended
    //   - Verify text and ts fields match

    // ── Step 5: Send session.end and verify review ──

    const sessionEndRes = await request.post(`${RT_BASE_URL}/signals/publish`, {
      data: {
        topic: 'session.end',
        source: 'e2e-test',
        payload: {
          events: inputs.map((text, i) => ({
            text,
            ts: 1700000000000 + i * 3600000,
          })),
        },
        trace_id: traceId,
      },
    });
    expect(sessionEndRes.ok()).toBeTruthy();

    // TODO(Phase 2): When Reviewer Agent is active:
    //   - Wait for review.completed signal
    //   - Verify all four fields: effective, stuck, improve, avoid
    //   - Verify review reflects the day's events
  });

  test('route table contains innate routes', async ({ request }) => {
    const res = await request.get(`${RT_BASE_URL}/signal-routes`);
    expect(res.ok()).toBeTruthy();

    const routes = await res.json();
    expect(Array.isArray(routes)).toBe(true);

    // Verify key innate routes exist
    const topics = routes.map((r: { topic: string }) => r.topic);

    // These should be configured in config/signal-routes.default.json
    // At minimum, we expect routes for the core signal topics
    expect(topics.length).toBeGreaterThan(0);
  });

  test('SSE stream receives published events', async ({ request }) => {
    // This test verifies the SSE streaming endpoint works.
    // We publish an event and verify it appears via the stream.

    // Publish a unique event
    const uniqueId = `e2e-sse-${Date.now()}`;
    const publishRes = await request.post(`${RT_BASE_URL}/signals/publish`, {
      data: {
        topic: 'user.input.text',
        source: 'e2e-test',
        payload: { text: 'SSE stream test' },
        trace_id: uniqueId,
      },
    });
    expect(publishRes.ok()).toBeTruthy();

    // Verify via history (SSE streaming is hard to test in Playwright request API)
    const historyRes = await request.get(`${RT_BASE_URL}/signals/history?limit=5`);
    const events = await historyRes.json();

    const found = events.find(
      (e: { trace_id?: string }) => e.trace_id === uniqueId,
    );
    expect(found).toBeTruthy();
    expect(found.topic).toBe('user.input.text');
  });

  test('multiple concurrent inputs do not interfere', async ({ request }) => {
    // Publish multiple signals concurrently
    const promises = Array.from({ length: 5 }, (_, i) =>
      request.post(`${RT_BASE_URL}/signals/publish`, {
        data: {
          topic: 'user.input.text',
          source: 'e2e-test',
          payload: { text: `并发输入 ${i}` },
          trace_id: `e2e-concurrent-${Date.now()}-${i}`,
        },
      }),
    );

    const responses = await Promise.all(promises);

    // All should succeed
    for (const res of responses) {
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.accepted).toBe(true);
    }

    // All should be unique event IDs
    const bodies = await Promise.all(responses.map((r) => r.json()));
    const ids = bodies.map((b: { event_id: string }) => b.event_id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(5);
  });
});
