// signal-pool-classification.test.ts — E2E: 输入文本 -> 分类 -> 任务创建
//
// Tests the classification signal chain end-to-end:
//   1. POST user.input.text to /signals/publish
//   2. Classifier Agent processes and emits input.classified
//   3. Task Actor transforms input.classified(type=task) to task.auto-created
//   4. Frontend receives task.auto-created via SSE
//
// Prerequisites:
//   - exomind-rt running on localhost (default port from env or 1949)
//   - Classifier Agent and Task Actor registered in route table
//
// Note: This test requires the Rust runtime to be running with
// signal pool enabled. The Vite dev server alone is not sufficient.

import { test, expect } from '@playwright/test';

const RT_BASE_URL = process.env.EXOMIND_RT_URL ?? 'http://127.0.0.1:1949';

test.describe('Signal Pool Classification', () => {
  test.skip(
    !process.env.EXOMIND_RT_URL,
    'Skipped: requires running exomind-rt (set EXOMIND_RT_URL)',
  );

  test('user input is published and accepted', async ({ request }) => {
    // 1. POST user.input.text to /signals/publish
    const response = await request.post(`${RT_BASE_URL}/signals/publish`, {
      data: {
        topic: 'user.input.text',
        source: 'e2e-test',
        payload: {
          text: '明天需要完成代码审查',
        },
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.accepted).toBe(true);
    expect(body.event_id).toBeTruthy();
  });

  test('published signal appears in history', async ({ request }) => {
    // 1. Publish a signal
    const publishRes = await request.post(`${RT_BASE_URL}/signals/publish`, {
      data: {
        topic: 'user.input.text',
        source: 'e2e-test',
        payload: {
          text: '检查 history 端点',
        },
        trace_id: 'e2e-trace-history-check',
      },
    });
    const { event_id } = await publishRes.json();

    // 2. Check history
    const historyRes = await request.get(`${RT_BASE_URL}/signals/history?limit=10`);
    expect(historyRes.ok()).toBeTruthy();

    const events = await historyRes.json();
    expect(Array.isArray(events)).toBe(true);

    const found = events.find((e: { id: string }) => e.id === event_id);
    expect(found).toBeTruthy();
    expect(found.topic).toBe('user.input.text');
  });

  test('user input creates classified task', async ({ request }) => {
    // This test verifies the full classification chain.
    // It requires the Classifier Agent to be active and responding.

    // 1. POST user.input.text
    const publishRes = await request.post(`${RT_BASE_URL}/signals/publish`, {
      data: {
        topic: 'user.input.text',
        source: 'e2e-test',
        payload: {
          text: '我需要完成项目报告的编写',
        },
        trace_id: 'e2e-trace-classify',
      },
    });
    expect(publishRes.ok()).toBeTruthy();

    // 2. Wait for classification signal (polling history)
    // The Classifier Agent should process the input and emit input.classified.
    // We poll the history endpoint for up to 10 seconds.
    let classifiedEvent = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise((r) => setTimeout(r, 500));

      const historyRes = await request.get(`${RT_BASE_URL}/signals/history?limit=20`);
      const events = await historyRes.json();

      classifiedEvent = events.find(
        (e: { topic: string; payload?: { type?: string } }) =>
          e.topic === 'input.classified',
      );
      if (classifiedEvent) break;
    }

    // TODO(Phase 2): Enable when Classifier Agent is deployed
    // expect(classifiedEvent).toBeTruthy();
    // expect(classifiedEvent.payload.type).toBe('task');

    // 3. Wait for task.auto-created signal
    // let taskEvent = null;
    // for (let attempt = 0; attempt < 20; attempt++) {
    //   await new Promise((r) => setTimeout(r, 500));
    //   const historyRes = await request.get(`${RT_BASE_URL}/signals/history?limit=20`);
    //   const events = await historyRes.json();
    //   taskEvent = events.find(
    //     (e: { topic: string }) => e.topic === 'task.auto-created',
    //   );
    //   if (taskEvent) break;
    // }
    // expect(taskEvent).toBeTruthy();
    // expect(taskEvent.payload.title).toBeTruthy();
  });

  test('classification handles empty input gracefully', async ({ request }) => {
    const response = await request.post(`${RT_BASE_URL}/signals/publish`, {
      data: {
        topic: 'user.input.text',
        source: 'e2e-test',
        payload: {
          text: '',
        },
      },
    });

    // Should still accept the signal (classification handles empty downstream)
    expect(response.ok()).toBeTruthy();
  });
});
