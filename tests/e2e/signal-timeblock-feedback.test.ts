// signal-timeblock-feedback.test.ts — E2E: timeblock.completed → review.completed
//
// Tests the timeblock feedback signal chain:
//   1. POST timeblock.completed to /signals/publish
//   2. Verify signal is accepted by RT
//   3. POST review.completed (simulating agent response)
//   4. Verify review.completed arrives via SSE/history
//
// Prerequisites:
//   - exomind-rt running on localhost (set EXOMIND_RT_URL)

import { test, expect, type APIRequestContext } from '@playwright/test';

// Standalone exomind-rt default is 1949（外部独立 Runtime 默认 1949）.
// Note: Embedded Tauri runtime is pinned to 4077（内嵌 Runtime 固定 4077）.
const RT_BASE_URL = process.env.EXOMIND_RT_URL ?? 'http://127.0.0.1:1949';

async function waitForReviewCompleted(
  request: APIRequestContext,
  traceId: string,
  maxAttempts = 90,
  intervalMs = 2000,
) {
  for (let i = 0; i < maxAttempts; i++) {
    const response = await request.get(`${RT_BASE_URL}/signals/history?limit=200`);
    if (!response.ok()) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      continue;
    }

    const events = await response.json();
    const match = (events as Array<{ topic: string; trace_id?: string }>).find(
      (event) => event.topic === 'review.completed' && event.trace_id === traceId,
    );

    if (match) {
      return match as {
        topic: string;
        trace_id?: string;
        payload?: Record<string, unknown>;
      };
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return null;
}

test.describe('Signal Pool: Timeblock Feedback', () => {
  test.skip(
    !process.env.EXOMIND_RT_URL,
    'Skipped: requires running exomind-rt (set EXOMIND_RT_URL)',
  );

  test('timeblock.completed signal is published and accepted', async ({ request }) => {
    const response = await request.post(`${RT_BASE_URL}/signals/publish`, {
      data: {
        topic: 'timeblock.completed',
        source: 'e2e-test',
        payload: {
          block: {
            id: 'e2e-block-1',
            name: '测试时间块',
            startTime: Date.now() - 30 * 60 * 1000,
            endTime: Date.now(),
          },
          feedbackReport: '## 测试时间块\n\n- 总共时长：30:00\n- 实际工作：28:00',
          recentEvents: [
            { text: '开始编写测试', ts: Date.now() - 25 * 60 * 1000 },
            { text: '完成单元测试', ts: Date.now() - 10 * 60 * 1000 },
          ],
        },
        trace_id: 'e2e-trace-timeblock-1',
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.accepted).toBe(true);
    expect(body.event_id).toBeTruthy();
  });

  test('review.completed (timeblock) signal is published and accepted', async ({ request }) => {
    const response = await request.post(`${RT_BASE_URL}/signals/publish`, {
      data: {
        topic: 'review.completed',
        source: 'agent:reviewer',
        payload: {
          effective: '完成了所有测试用例',
          stuck: '没有遇到卡点',
          suggestion: '可以使用 TDD 方法提前写测试',
          review_type: 'timeblock',
          block_name: '测试时间块',
        },
        trace_id: 'e2e-trace-timeblock-review-1',
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.accepted).toBe(true);
    expect(body.event_id).toBeTruthy();
  });

  test('timeblock.completed with empty feedback is accepted', async ({ request }) => {
    const response = await request.post(`${RT_BASE_URL}/signals/publish`, {
      data: {
        topic: 'timeblock.completed',
        source: 'e2e-test',
        payload: {
          block: {
            id: 'e2e-block-2',
            name: '无反馈时间块',
            startTime: Date.now() - 10 * 60 * 1000,
            endTime: Date.now(),
          },
          feedbackReport: '## 无反馈时间块\n\n- 反馈状态：未填写',
          recentEvents: [],
        },
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.accepted).toBe(true);
  });

  test('signal history includes timeblock signals', async ({ request }) => {
    // First publish a timeblock.completed signal
    await request.post(`${RT_BASE_URL}/signals/publish`, {
      data: {
        topic: 'timeblock.completed',
        source: 'e2e-test',
        payload: {
          block: {
            id: 'e2e-block-history',
            name: '历史查询测试',
            startTime: Date.now() - 5 * 60 * 1000,
            endTime: Date.now(),
          },
          feedbackReport: '测试',
          recentEvents: [],
        },
        trace_id: 'e2e-trace-history',
      },
    });

    // Verify it appears in history
    const historyRes = await request.get(`${RT_BASE_URL}/signals/history?limit=10`);
    expect(historyRes.ok()).toBeTruthy();
    const events = await historyRes.json();
    const timeblockEvent = (events as Array<{ topic: string; trace_id?: string }>).find(
      (e) => e.topic === 'timeblock.completed' && e.trace_id === 'e2e-trace-history',
    );
    expect(timeblockEvent).toBeTruthy();
  });

  test('timeblock.completed triggers reviewer and emits review.completed（真实链路）', async ({ request }) => {
    test.setTimeout(180_000);

    const traceId = `e2e-trace-timeblock-live-${Date.now()}`;
    const publishResponse = await request.post(`${RT_BASE_URL}/signals/publish`, {
      data: {
        topic: 'timeblock.completed',
        source: 'e2e-test',
        trace_id: traceId,
        payload: {
          block: {
            id: 'e2e-block-live',
            name: 'M4 信号链路自动验证',
            startTime: Date.now() - 25 * 60 * 1000,
            endTime: Date.now(),
          },
          feedbackReport: '完成 RT 内嵌 + Agent Hub + Signal 链路联调。',
          recentEvents: [
            { text: 'RT 健康检查通过', ts: Date.now() - 20 * 60 * 1000 },
            { text: 'Agent Hub 路由拓扑展示正确', ts: Date.now() - 10 * 60 * 1000 },
            { text: '准备触发 reviewer 生成反馈', ts: Date.now() - 2 * 60 * 1000 },
          ],
        },
      },
    });

    expect(publishResponse.ok()).toBeTruthy();
    const publishBody = await publishResponse.json();
    expect(publishBody.accepted).toBe(true);

    const reviewEvent = await waitForReviewCompleted(request, traceId);
    expect(reviewEvent).toBeTruthy();
    expect(reviewEvent?.trace_id).toBe(traceId);
    expect(reviewEvent?.payload).toBeTruthy();
    expect(reviewEvent?.payload?.review_type).toBe('timeblock');
    expect(reviewEvent?.payload?.block_name).toBe('M4 信号链路自动验证');
    expect(typeof reviewEvent?.payload?.effective).toBe('string');
    expect(typeof reviewEvent?.payload?.stuck).toBe('string');
    expect(typeof reviewEvent?.payload?.suggestion).toBe('string');
  });
});
