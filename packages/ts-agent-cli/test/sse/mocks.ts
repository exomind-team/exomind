/**
 * SSE 测试 Mock 工具
 *
 * 提供共享的 mock 函数和数据创建工具
 */

import { vi, type Mock } from "vitest";
import type { SSEEvent, Fact } from "../src/sse/types.js";

// ==================== Mock 数据创建 ====================

/**
 * 创建模拟 SSEEvent
 */
export function mockSSEEvent(data: string, type: string = "new_fact"): SSEEvent {
    return { type, data };
}

/**
 * 创建模拟 Fact
 */
export function mockFact(
    id: string,
    content: string = "test content",
    topics: string[] = ["agent"],
    sender: string = "test-sender",
): Fact {
    return {
        id,
        content,
        topics,
        sender,
        source: "test",
        timestamp: Date.now(),
    };
}

/**
 * 创建复杂 Fact（包含 refs 和 fact_content）
 */
export function mockComplexFact(
    id: string,
    content: string = "test content",
    topics: string[] = ["agent"],
    sender: string = "test-sender",
    refs?: { id: string; content: string }[],
    factContent?: Record<string, unknown>,
): Fact {
    return {
        id,
        content,
        topics,
        sender,
        source: "test",
        timestamp: Date.now(),
        refs,
        fact_content: factContent,
    };
}

// ==================== Fetch Mock ====================

/**
 * 创建成功的 fetch mock
 */
export function createSuccessFetch(
    factId: string = "test-fact-id",
    responseData?: Record<string, unknown>,
): void {
    globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => responseData ?? { fact_id: factId },
    });
}

/**
 * 创建失败的 fetch mock
 */
export function createErrorFetch(status: number = 500, errorMessage: string = "Server Error"): void {
    globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status,
    });
}

/**
 * 创建网络错误 fetch mock
 */
export function createNetworkErrorFetch(): void {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network Error"));
}

/**
 * 创建自定义 fetch mock
 */
export function createCustomFetch(mockFn: Mock): void {
    globalThis.fetch = mockFn;
}

/**
 * 重置 fetch mock
 */
export function resetFetch(): void {
    vi.restoreAllMocks();
}

// ==================== ReadableStream Mock ====================

/**
 * 创建模拟 ReadableStream（用于 SSE 事件流）
 */
export function createMockReadableStream(
    chunks: string[],
    encoding: BufferEncoding = "utf-8",
): ReadableStream {
    return new ReadableStream({
        async start(controller) {
            for (const chunk of chunks) {
                controller.enqueue(new TextEncoder().encode(chunk));
            }
            controller.close();
        },
    });
}

/**
 * 创建无限推送的 ReadableStream（用于持续接收 SSE 事件）
 */
export function createInfiniteReadableStream(
    pushCallback: (controller: ReadableStreamDefaultController) => void,
): ReadableStream {
    return new ReadableStream({
        async start(controller) {
            pushCallback(controller);
        },
        async cancel() {
            // 取消时不需要做任何事
        },
    });
}

// ==================== 测试辅助函数 ====================

/**
 * 等待指定时间
 */
export function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 创建 SSE 格式字符串
 */
export function createSSEString(type: string, data: string): string {
    return `event: ${type}\ndata: ${data}\n\n`;
}

/**
 * 创建多个 SSE 事件字符串
 */
export function createSSEMultiString(events: Array<{ type: string; data: string }>): string {
    return events.map((e) => `event: ${e.type}\ndata: ${e.data}\n\n`).join("");
}
