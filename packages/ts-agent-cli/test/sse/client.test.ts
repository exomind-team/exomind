/**
 * SSE 客户端测试
 *
 * 测试 SSE 客户端功能：集成监听和发送、工厂函数
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
    SSEClientAsync,
    createSSEClient,
    createSSEListener,
    createSSESender,
} from "@sse/client.js";
import type { Fact, Message } from "@sse/types.js";

// Mock fetch
const mockFetch = vi.fn();

describe("SSEClientAsync", () => {
    let client: SSEClientAsync;

    beforeEach(() => {
        vi.restoreAllMocks();
        client = new SSEClientAsync({
            apiUrl: "http://localhost:3000",
            topics: ["agent"],
            sender: "test-agent",
            initialRetryDelay: 0.1,
            maxRetryDelay: 1,
        });
    });

    afterEach(() => {
        client.stop();
    });

    describe("构造函数", () => {
        it("应该使用默认配置创建客户端", () => {
            const defaultClient = new SSEClientAsync();

            expect(defaultClient).toBeDefined();
        });

        it("应该初始化监听器和发送器", () => {
            expect((client as unknown as { listener: unknown }).listener).toBeDefined();
            expect((client as unknown as { senderInstance: unknown }).senderInstance).toBeDefined();
        });
    });

    describe("connected getter", () => {
        it("应该委托给监听器的 connected 属性", () => {
            expect(client.connected).toBe(false);
        });
    });

    describe("send", () => {
        it("应该发送消息并返回结果", async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ fact_id: "client-fact-id" }),
            });
            globalThis.fetch = mockFetch;

            const message: Message = {
                content: "Client message",
                topics: ["agent"],
                source: "test",
                sender: "test-agent",
            };

            const result = await client.send(message);

            expect(result.success).toBe(true);
            expect(result.factId).toBe("client-fact-id");
        });

        it("应该在发送失败时返回错误", async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 500,
            });
            globalThis.fetch = mockFetch;

            const message: Message = {
                content: "Client message",
                topics: ["agent"],
                source: "test",
                sender: "test-agent",
            };

            const result = await client.send(message);

            expect(result.success).toBe(false);
        });
    });

    describe("sendBatch", () => {
        it("应该批量发送消息", async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ fact_id: "batch" }),
            });
            globalThis.fetch = mockFetch;

            const messages: Message[] = [
                { content: "1", topics: ["a"], source: "s", sender: "t" },
                { content: "2", topics: ["a"], source: "s", sender: "t" },
            ];

            const result = await client.sendBatch(messages);

            expect(result.successCount).toBe(2);
            expect(result.failedCount).toBe(0);
        });
    });

    describe("sendAndWait", () => {
        it("应该发送并等待确认", async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ fact_id: "wait-fact" }),
            });
            globalThis.fetch = mockFetch;

            const message: Message = {
                content: "Wait message",
                topics: ["agent"],
                source: "test",
                sender: "test-agent",
            };

            const result = await client.sendAndWait(message, 1000);

            expect(result.success).toBe(true);
            expect(result.factId).toBe("wait-fact");
        });
    });

    describe("stop", () => {
        it("应该停止监听", () => {
            client.stop();

            expect((client as unknown as { isListening: boolean }).isListening).toBe(false);
        });
    });

    describe("close", () => {
        it("应该关闭连接", async () => {
            await client.close();

            expect((client as unknown as { isListening: boolean }).isListening).toBe(false);
        });
    });

    describe("factApiUrl getter", () => {
        it("应该返回正确的 Fact API URL", () => {
            expect(client.factApiUrl).toBe("http://localhost:3000/api/fact");
        });
    });

    describe("updateTopics", () => {
        it("应该更新监听话题", () => {
            client.updateTopics(["new-topic", "another-topic"]);

            expect((client as unknown as { topics: Set<string> }).topics.has("new-topic")).toBe(
                true,
            );
            expect((client as unknown as { topics: Set<string> }).topics.has("another-topic")).toBe(
                true,
            );
        });
    });

    describe("addTopic", () => {
        it("应该添加新话题", () => {
            client.addTopic("additional-topic");

            expect((client as unknown as { topics: Set<string> }).topics.has("additional-topic")).toBe(
                true,
            );
        });
    });

    describe("removeTopic", () => {
        it("应该移除话题", () => {
            client.removeTopic("agent"); // 移除默认话题

            expect((client as unknown as { topics: Set<string> }).topics.has("agent")).toBe(
                false,
            );
        });
    });

    describe("listen", () => {
        it("应该生成 FactRefChain", async () => {
            const mockReader = {
                read: vi.fn()
                    .mockResolvedValueOnce({
                        done: false,
                        value: new TextEncoder().encode(
                            'event: new_fact\ndata: {"id":"client-fact","content":"Client test","topics":["agent"],"sender":"other","source":"test","timestamp":1234567890}\n\n',
                        ),
                    })
                    .mockResolvedValueOnce({ done: true, value: new Uint8Array() }),
            };

            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                body: { getReader: () => mockReader },
            });
            globalThis.fetch = mockFetch;

            const generator = client.listen();
            const results: Array<{ fact: { id: string } }> = [];

            for await (const chain of generator) {
                results.push({ fact: { id: chain.fact.id } });
                client.stop(); // 处理后停止，避免无限循环
            }

            expect(results).toHaveLength(1);
            expect(results[0].fact.id).toBe("client-fact");
        }, 5000); // 5秒超时
    });

    describe("listenWith", () => {
        it("应该使用处理器处理每条消息", async () => {
            const mockReader = {
                read: vi.fn()
                    .mockResolvedValueOnce({
                        done: false,
                        value: new TextEncoder().encode(
                            'event: new_fact\ndata: {"id":"handler-fact","content":"Handled","topics":["agent"],"sender":"other","source":"test","timestamp":1234567890}\n\n',
                        ),
                    })
                    .mockResolvedValueOnce({ done: true, value: new Uint8Array() }),
            };

            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                body: { getReader: () => mockReader },
            });
            globalThis.fetch = mockFetch;

            const handledIds: string[] = [];

            await client.listenWith(async (chain) => {
                handledIds.push(chain.fact.id);
                client.stop(); // 处理后停止
            });

            expect(handledIds).toContain("handler-fact");
        });
    });
});

describe("工厂函数", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    describe("createSSEClient", () => {
        it("应该创建配置好的客户端", () => {
            const client = createSSEClient({
                apiUrl: "http://localhost:3000",
                topics: ["agent", "test"],
                sender: "factory-agent",
            });

            expect(client).toBeDefined();
            expect(client.factApiUrl).toBe("http://localhost:3000/api/fact");
        });
    });

    describe("createSSEListener", () => {
        it("应该创建纯监听器", () => {
            const listener = createSSEListener(
                "http://localhost:3000",
                ["agent"],
                "factory-agent",
            );

            expect(listener).toBeDefined();
            expect((listener as unknown as { connected: boolean }).connected).toBe(false);
        });

        it("应该使用默认发送者", () => {
            const listener = createSSEListener(
                "http://localhost:3000",
                ["agent"],
            );

            expect(listener).toBeDefined();
        });
    });

    describe("createSSESender", () => {
        it("应该创建纯发送器", async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ fact_id: "sender-fact" }),
            });
            globalThis.fetch = mockFetch;

            const sender = createSSESender(
                "http://localhost:3000",
                "factory-agent",
            );

            expect(sender).toBeDefined();

            const result = await sender.send({
                content: "Test",
                topics: ["agent"],
                source: "test",
                sender: "factory-agent",
            });

            expect(result.success).toBe(true);
        });

        it("应该使用默认发送者", async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ fact_id: "default-sender" }),
            });
            globalThis.fetch = mockFetch;

            const sender = createSSESender("http://localhost:3000");

            expect(sender).toBeDefined();

            const result = await sender.send({
                content: "Test",
                topics: ["agent"],
                source: "test",
                sender: "Agent", // 默认发送者
            });

            expect(result.success).toBe(true);
        });
    });
});
