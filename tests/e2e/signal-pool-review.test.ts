// signal-pool-review.test.ts — E2E: session.end -> 复盘生成
//
// Tests the review signal chain end-to-end:
//   1. POST session.end to /signals/publish (with events payload)
//   2. Reviewer Agent processes events and generates review
//   3. Reviewer Agent emits review.completed signal
//   4. Frontend receives review.completed via SSE
//
// The review.completed payload contains four fields:
//   { effective, stuck, improve, avoid }
//
// Prerequisites:
//   - exomind-rt running on localhost
//   - Reviewer Agent registered in route table for session.end topic

import { test, expect } from '@playwright/test';

const RT_BASE_URL = process.env.EXOMIND_RT_URL ?? 'http://127.0.0.1:1949';

test.describe('Signal Pool Review', () => {
  test.skip(
    !process.env.EXOMIND_RT_URL,
    'Skipped: requires running exomind-rt (set EXOMIND_RT_URL)',
  );

  test('session.end signal is published and accepted', async ({ request }) => {
    const response = await request.post(`${RT_BASE_URL}/signals/publish`, {
      data: {
        topic: 'session.end',
        source: 'e2e-test',
        payload: {
          events: [
            { text: '完成了架构设计文档', ts: 1700000000000 },
            { text: '编写了测试骨架', ts: 1700000001000 },
            { text: '审查了 PR 代码', ts: 1700000002000 },
          ],
        },
        trace_id: 'e2e-trace-review',
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.accepted).toBe(true);
    expect(body.event_id).toBeTruthy();
  });

  test('session end triggers review', async ({ request }) => {
    // 1. POST session.end with events payload
    const publishRes = await request.post(`${RT_BASE_URL}/signals/publish`, {
      data: {
        topic: 'session.end',
        source: 'e2e-test',
        payload: {
          events: [
            { text: '上午：完成了 SignalPool Phase 1 架构设计', ts: 1700000000000 },
            { text: '下午：编写了 Rust 集成测试', ts: 1700000003000 },
            { text: '下午：遇到了 SSE 连接超时问题', ts: 1700000005000 },
            { text: '晚上：修复了超时问题，通过全部测试', ts: 1700000008000 },
          ],
        },
        trace_id: 'e2e-trace-review-full',
      },
    });
    expect(publishRes.ok()).toBeTruthy();

    // 2. Wait for review.completed signal (polling history)
    // The Reviewer Agent should process the session events and emit review.completed.
    // let reviewEvent = null;
    // for (let attempt = 0; attempt < 30; attempt++) {
    //   await new Promise((r) => setTimeout(r, 500));
    //   const historyRes = await request.get(`${RT_BASE_URL}/signals/history?limit=20`);
    //   const events = await historyRes.json();
    //   reviewEvent = events.find(
    //     (e: { topic: string }) => e.topic === 'review.completed',
    //   );
    //   if (reviewEvent) break;
    // }

    // TODO(Phase 2): Enable when Reviewer Agent is deployed
    // 3. Verify review content has all four fields
    // expect(reviewEvent).toBeTruthy();
    // expect(reviewEvent.payload.effective).toBeTruthy();
    // expect(reviewEvent.payload.stuck).toBeTruthy();
    // expect(reviewEvent.payload.improve).toBeTruthy();
    // expect(reviewEvent.payload.avoid).toBeTruthy();
  });

  test('session.end with empty events is handled gracefully', async ({ request }) => {
    const response = await request.post(`${RT_BASE_URL}/signals/publish`, {
      data: {
        topic: 'session.end',
        source: 'e2e-test',
        payload: {
          events: [],
        },
      },
    });

    // Signal pool should accept even empty events
    expect(response.ok()).toBeTruthy();
  });

  test('session.end with single event produces review', async ({ request }) => {
    const response = await request.post(`${RT_BASE_URL}/signals/publish`, {
      data: {
        topic: 'session.end',
        source: 'e2e-test',
        payload: {
          events: [
            { text: '今天只做了一件事：读代码', ts: 1700000000000 },
          ],
        },
      },
    });

    expect(response.ok()).toBeTruthy();

    // TODO(Phase 2): Verify review.completed is still generated for minimal input
  });
});
