/**
 * SSE 发送器测试
 *
 * 测试消息发送功能：单条发送、批量发送、payload 构建
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    SSESenderAsync,
    sendMessage,
    sendBatchMessages,
} from "@sse/sender.js";
import type { Message } from "@sse/types.js";

describe("SSESenderAsync", () => {
    let sender: SSESenderAsync;

    beforeEach(() => {
        vi.restoreAllMocks();
        sender = new SSESenderAsync({
            apiUrl: "http://localhost:3000",
            sender: "test-agent",
            timeout: 5000,
        });
    });

    describe("构造函数", () => {
        it("应该使用默认配置创建发送器", () => {
            const defaultSender = new SSESenderAsync();

            expect(defaultSender).toBeDefined();
        });

        it("应该正确设置 API URL（移除末尾斜杠）", () => {
            const testSender = new SSESenderAsync({
                apiUrl: "http://localhost:3000/",
            });

            expect((testSender as unknown as { apiUrl: string }).apiUrl).toBe(
                "http://localhost:3000",
            );
        });

        it("应该正确保存自定义配置", () => {
            const customSender = new SSESenderAsync({
                apiUrl: "http://custom:8080",
                sender: "custom-agent",
                timeout: 10000,
            });

            expect(customSender).toBeDefined();
        });
    });

    describe("factApiUrl getter", () => {
        it("应该返回正确的 Fact API URL", () => {
            const url = sender.factApiUrl;

            expect(url).toBe("http://localhost:3000/api/fact");
        });
    });

    describe("send", () => {
        it("应该在发送成功时返回 success: true", async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ fact_id: "new-fact-id" }),
            });

            const message: Message = {
                content: "Test message",
                topics: ["agent"],
                source: "test",
                sender: "test-agent",
            };

            const result = await sender.send(message);

            expect(result.success).toBe(true);
            expect(result.status).toBe(200);
            expect(result.factId).toBe("new-fact-id");
        });

        it("应该在发送失败时返回 success: false", async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 500,
            });

            const message: Message = {
                content: "Test message",
                topics: ["agent"],
                source: "test",
                sender: "test-agent",
            };

            const result = await sender.send(message);

            expect(result.success).toBe(false);
            expect(result.status).toBe(500);
            expect(result.error).toContain("500");
        });

        it("应该在网络错误时返回失败结果", async () => {
            globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network Error"));

            const message: Message = {
                content: "Test message",
                topics: ["agent"],
                source: "test",
                sender: "test-agent",
            };

            const result = await sender.send(message);

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });

        it("应该在响应没有 fact_id 时正确处理", async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({}),
            });

            const message: Message = {
                content: "Test message",
                topics: ["agent"],
                source: "test",
                sender: "test-agent",
            };

            const result = await sender.send(message);

            expect(result.success).toBe(true);
            expect(result.factId).toBeUndefined();
        });

        it("应该在响应不是有效 JSON 时正确处理", async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => {
                    throw new Error("Invalid JSON");
                },
            });

            const message: Message = {
                content: "Test message",
                topics: ["agent"],
                source: "test",
                sender: "test-agent",
            };

            const result = await sender.send(message);

            expect(result.success).toBe(true); // 仍然成功，只是没有 factId
        });

        it("应该正确处理连接错误", async () => {
            globalThis.fetch = vi.fn().mockRejectedValue(
                new Error("ConnectionError: connection refused"),
            );

            const message: Message = {
                content: "Test message",
                topics: ["agent"],
                source: "test",
                sender: "test-agent",
            };

            const result = await sender.send(message);

            expect(result.success).toBe(false);
            expect(result.error).toContain("ConnectionError");
        });

        it("应该正确处理 ECONNREFUSED 错误", async () => {
            globalThis.fetch = vi.fn().mockRejectedValue(
                new Error("ECONNREFUSED: connection refused"),
            );

            const message: Message = {
                content: "Test message",
                topics: ["agent"],
                source: "test",
                sender: "test-agent",
            };

            const result = await sender.send(message);

            expect(result.success).toBe(false);
            expect(result.error).toContain("ECONNREFUSED");
        });
    });

    describe("sendBatch", () => {
        it("应该批量发送多条消息", async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ fact_id: "batch-fact" }),
            });

            const messages: Message[] = [
                {
                    content: "Message 1",
                    topics: ["agent"],
                    source: "test",
                    sender: "test-agent",
                },
                {
                    content: "Message 2",
                    topics: ["agent"],
                    source: "test",
                    sender: "test-agent",
                },
            ];

            const result = await sender.sendBatch(messages);

            expect(result.successCount).toBe(2);
            expect(result.failedCount).toBe(0);
            expect(result.results).toHaveLength(2);
        });

        it("应该统计成功和失败数量", async () => {
            globalThis.fetch = vi.fn().mockImplementation(async () => {
                // 模拟部分失败
                const callCount = vi.mocked(globalThis.fetch).mock.calls.length;
                if (callCount === 2) {
                    return { ok: false, status: 500 };
                }
                return { ok: true, status: 200, json: async () => ({ fact_id: "id" }) };
            });

            const messages: Message[] = [
                {
                    content: "Message 1",
                    topics: ["agent"],
                    source: "test",
                    sender: "test-agent",
                },
                {
                    content: "Message 2 (will fail)",
                    topics: ["agent"],
                    source: "test",
                    sender: "test-agent",
                },
                {
                    content: "Message 3",
                    topics: ["agent"],
                    source: "test",
                    sender: "test-agent",
                },
            ];

            const result = await sender.sendBatch(messages);

            expect(result.successCount).toBe(2);
            expect(result.failedCount).toBe(1);
        });

        it("应该处理空消息数组", async () => {
            const result = await sender.sendBatch([]);

            expect(result.successCount).toBe(0);
            expect(result.failedCount).toBe(0);
            expect(result.results).toHaveLength(0);
        });
    });

    describe("buildPayload", () => {
        it("应该正确构建消息 payload", () => {
            const message: Message = {
                content: "Test content",
                topics: ["agent", "test"],
                source: "test-source",
                sender: "test-sender",
            };

            const payload = (sender as unknown as { buildPayload: (msg: Message) => Record<string, unknown> }).buildPayload(
                message,
            );

            expect(payload.content).toBe("Test content");
            expect(payload.topics).toEqual(["agent", "test"]);
            expect(payload.source).toBe("test-source");
            expect(payload.sender).toBe("test-sender");
        });

        it("应该使用默认 sender 当消息没有 sender 字段", () => {
            const message: Message = {
                content: "Test",
                topics: ["agent"],
                source: "test",
                // sender 未指定
            };

            const payload = (sender as unknown as { buildPayload: (msg: Message) => Record<string, unknown> }).buildPayload(
                message,
            );

            expect(payload.sender).toBe("test-agent"); // 使用发送器的 sender
        });
    });

    describe("sendAndWait", () => {
        it("应该在发送成功时立即返回", async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ fact_id: "quick-fact" }),
            });

            const message: Message = {
                content: "Quick message",
                topics: ["agent"],
                source: "test",
                sender: "test-agent",
            };

            const start = Date.now();
            const result = await sender.sendAndWait(message, 5000);
            const elapsed = Date.now() - start;

            expect(result.success).toBe(true);
            expect(elapsed).toBeLessThan(100); // 应该几乎立即返回
        });

        it("应该在超时前持续重试", async () => {
            let callCount = 0;
            globalThis.fetch = vi.fn().mockImplementation(() => {
                callCount++;
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({ fact_id: `fact-${callCount}` }),
                });
            });

            const message: Message = {
                content: "Retry message",
                topics: ["agent"],
                source: "test",
                sender: "test-agent",
            };

            // 模拟总是返回成功的响应
            const result = await sender.sendAndWait(message, 100);

            expect(result.success).toBe(true);
        }, 10000); // 增加超时时间
    });
});

describe("sendMessage 便捷函数", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("应该使用默认 API URL 发送消息", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ fact_id: "default-fact" }),
        });

        const message: Message = {
            content: "Test",
            topics: ["agent"],
            source: "test",
            sender: "test",
        };

        const result = await sendMessage(message);

        expect(result.success).toBe(true);
        expect(result.factId).toBe("default-fact");
    });

    it("应该支持自定义 API URL", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ fact_id: "custom-fact" }),
        });

        const message: Message = {
            content: "Test",
            topics: ["agent"],
            source: "test",
            sender: "test",
        };

        const result = await sendMessage(message, "http://custom:8080");

        expect(result.success).toBe(true);

        // 验证 fetch 被调用时使用了正确的 URL
        expect(globalThis.fetch).toHaveBeenCalledWith(
            "http://custom:8080/api/fact",
            expect.any(Object),
        );
    });
});

describe("sendBatchMessages 便捷函数", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("应该批量发送消息并返回统计", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ fact_id: "batch" }),
        });

        const messages: Message[] = [
            { content: "1", topics: ["a"], source: "s", sender: "t" },
            { content: "2", topics: ["a"], source: "s", sender: "t" },
        ];

        const result = await sendBatchMessages(messages);

        expect(result.successCount).toBe(2);
        expect(result.failedCount).toBe(0);
    });
});
