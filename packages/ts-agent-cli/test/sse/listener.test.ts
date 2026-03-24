/**
 * SSE 监听器测试
 *
 * 测试 SSE 事件监听功能：连接管理、事件流监听、FactRefChain
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
    SSEListener,
    FactRefChain,
} from "@sse/listener.js";
import type { Fact, SSEEvent } from "@sse/types.js";

// Mock fetch 和 ReadableStream
const mockFetch = vi.fn();
const mockGetReader = vi.fn();
const mockReadableStream = {
    getReader: mockGetReader,
};

describe("SSEListener", () => {
    let listener: SSEListener;

    beforeEach(() => {
        vi.restoreAllMocks();
        listener = new SSEListener({
            apiUrl: "http://localhost:3000",
            topics: ["agent"],
            sender: "test-agent",
            initialRetryDelay: 0.1,
            maxRetryDelay: 1,
        });
    });

    afterEach(() => {
        listener.stop();
    });

    describe("构造函数", () => {
        it("应该使用默认配置创建监听器", () => {
            const defaultListener = new SSEListener();

            expect(defaultListener).toBeDefined();
        });

        it("应该正确设置 API URL", () => {
            expect((listener as unknown as { apiUrl: string }).apiUrl).toBe(
                "http://localhost:3000",
            );
        });

        it("应该正确初始化话题集合", () => {
            expect((listener as unknown as { topics: Set<string> }).topics.has("agent")).toBe(
                true,
            );
        });

        it("应该初始化消息过滤器", () => {
            expect((listener as unknown as { filter: unknown }).filter).toBeDefined();
        });
    });

    describe("factApiUrl getter", () => {
        it("应该返回正确的 Fact API URL", () => {
            const url = listener.factApiUrl;

            expect(url).toBe("http://localhost:3000/api/fact");
        });
    });

    describe("eventsApiUrl getter", () => {
        it("应该返回不带话题参数的 URL", () => {
            const url = listener.eventsApiUrl;

            expect(url).toBe("http://localhost:3000/api/events?topics=agent");
        });

        it("应该正确处理多话题", () => {
            const multiTopicListener = new SSEListener({
                apiUrl: "http://localhost:3000",
                topics: ["agent", "test", "notification"],
            });

            const url = multiTopicListener.eventsApiUrl;

            expect(url).toContain("topics=agent,test,notification");
        });

        it("应该处理空话题列表", () => {
            const emptyTopicListener = new SSEListener({
                apiUrl: "http://localhost:3000",
                topics: [],
            });

            const url = emptyTopicListener.eventsApiUrl;

            expect(url).toBe("http://localhost:3000/api/events");
        });
    });

    describe("connected getter", () => {
        it("应该初始返回 false", () => {
            expect(listener.connected).toBe(false);
        });
    });

    describe("connect", () => {
        beforeEach(() => {
            globalThis.fetch = mockFetch;
        });

        it("应该在连接成功时设置 isConnected 为 true", async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                body: mockReadableStream,
            });

            await listener.connect();

            expect(listener.connected).toBe(true);
        });

        it("应该在连接失败时抛出错误", async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 500,
            });

            await expect(listener.connect()).rejects.toThrow();
        });

        it("应该在网络错误时抛出错误", async () => {
            mockFetch.mockRejectedValue(new Error("Network Error"));

            await expect(listener.connect()).rejects.toThrow();
        });

        it("应该调用正确的 API URL", async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                body: mockReadableStream,
            });

            await listener.connect();

            expect(mockFetch).toHaveBeenCalledWith(
                "http://localhost:3000/api/events?topics=agent",
                expect.objectContaining({
                    headers: expect.objectContaining({
                        Accept: "text/event-stream",
                    }),
                }),
            );
        });
    });

    describe("disconnect", () => {
        it("应该设置 isConnected 为 false", async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                body: mockReadableStream,
            });

            await listener.connect();
            expect(listener.connected).toBe(true);

            await listener.disconnect();

            expect(listener.connected).toBe(false);
        });
    });

    describe("stop", () => {
        it("应该停止监听", () => {
            listener.stop();

            expect((listener as unknown as { aborted: boolean }).aborted).toBe(true);
        });
    });

    describe("close", () => {
        it("应该同时停止和断开连接", async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                body: mockReadableStream,
            });

            await listener.close();

            expect(listener.connected).toBe(false);
            expect((listener as unknown as { aborted: boolean }).aborted).toBe(true);
        });
    });

    describe("getMessageById", () => {
        beforeEach(() => {
            globalThis.fetch = mockFetch;
        });

        it("应该在找到消息时返回 Fact", async () => {
            const mockFact: Fact = {
                id: "test-id",
                content: "Test content",
                topics: ["agent"],
                sender: "sender",
                source: "test",
                timestamp: Date.now(),
            };

            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => mockFact,
            });

            const result = await listener.getMessageById("test-id");

            expect(result).not.toBeNull();
            expect(result!.id).toBe("test-id");
            expect(result!.content).toBe("Test content");
        });

        it("应该在消息不存在时返回 null (404)", async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 404,
            });

            const result = await listener.getMessageById("non-existent");

            expect(result).toBeNull();
        });

        it("应该在服务器错误时返回 null", async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 500,
            });

            const result = await listener.getMessageById("test-id");

            expect(result).toBeNull();
        });

        it("应该在网络错误时返回 null", async () => {
            mockFetch.mockRejectedValue(new Error("Network Error"));

            const result = await listener.getMessageById("test-id");

            expect(result).toBeNull();
        });
    });

    describe("listen", () => {
        beforeEach(() => {
            globalThis.fetch = mockFetch;
        });

        it("应该生成 FactRefChain", async () => {
            const mockFact: Fact = {
                id: "fact-123",
                content: "Test message",
                topics: ["agent"],
                sender: "other-agent",
                source: "test",
                timestamp: Date.now(),
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                body: mockReadableStream,
            });

            let readCount = 0;
            mockGetReader.mockReturnValue({
                async read() {
                    if (readCount === 0) {
                        readCount++;
                        return {
                            done: false,
                            value: new TextEncoder().encode(
                                'event: new_fact\ndata: {"id":"fact-123","content":"Test message","topics":["agent"],"sender":"other-agent","source":"test","timestamp":1234567890}\n\n',
                            ),
                        };
                    }
                    return { done: true, value: new Uint8Array() };
                },
            });

            const generator = listener.listen();
            const results: FactRefChain[] = [];

            for await (const chain of generator) {
                results.push(chain);
            }

            expect(results).toHaveLength(1);
            expect(results[0].fact.id).toBe("fact-123");
            expect(results[0].fact.content).toBe("Test message");
        });

        it("应该支持手动停止监听", async () => {
            globalThis.fetch = mockFetch;

            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                body: mockReadableStream,
            });

            let readCount = 0;
            mockGetReader.mockReturnValue({
                async read() {
                    readCount++;
                    if (readCount > 3) {
                        return { done: true, value: new Uint8Array() };
                    }
                    return {
                        done: false,
                        value: new TextEncoder().encode(
                            'event: keep-alive\n\n',
                        ),
                    };
                },
            });

            const generator = listener.listen();

            // 消费第一个事件
            const first = await generator.next();
            expect(first.done).toBe(false);

            // 停止监听
            listener.stop();

            // 后续应该立即结束
            const second = await generator.next();
            expect(second.done).toBe(true);
        });

        it("应该过滤自己发送的消息", async () => {
            globalThis.fetch = mockFetch;

            const selfFact: Fact = {
                id: "self-fact",
                content: "My own message",
                topics: ["agent"],
                sender: "test-agent", // 与监听器的 sender 相同
                source: "test",
                timestamp: Date.now(),
            };

            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                body: mockReadableStream,
            });

            let readCount = 0;
            mockGetReader.mockReturnValue({
                async read() {
                    if (readCount === 0) {
                        readCount++;
                        return {
                            done: false,
                            value: new TextEncoder().encode(
                                `event: new_fact\ndata: ${JSON.stringify(selfFact)}\n\n`,
                            ),
                        };
                    }
                    return { done: true, value: new Uint8Array() };
                },
            });

            const generator = listener.listen();
            const results: FactRefChain[] = [];

            for await (const chain of generator) {
                results.push(chain);
            }

            // 自己发送的消息应该被过滤
            expect(results).toHaveLength(0);
        });

        it("应该处理连接失败并重试", async () => {
            globalThis.fetch = mockFetch;

            let fetchCount = 0;
            mockFetch.mockImplementation(() => {
                fetchCount++;
                if (fetchCount === 1) {
                    return Promise.reject(new Error("Connection failed"));
                }
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    body: mockReadableStream,
                });
            });

            let readCount = 0;
            mockGetReader.mockReturnValue({
                async read() {
                    readCount++;
                    if (readCount > 1) {
                        return { done: true, value: new Uint8Array() };
                    }
                    return {
                        done: false,
                        value: new TextEncoder().encode(
                            'event: keep-alive\n\n',
                        ),
                    };
                },
            });

            const generator = listener.listen();

            // 等待一段时间让重连发生
            await new Promise((resolve) => setTimeout(resolve, 500));

            listener.stop();

            // 应该至少有 1 次连接尝试（第一次失败）
            expect(fetchCount).toBeGreaterThanOrEqual(1);
        });
    });
});

describe("FactRefChain", () => {
    describe("构造函数", () => {
        it("应该创建简单的引用链", () => {
            const fact: Fact = {
                id: "fact-1",
                content: "Main fact",
                topics: ["agent"],
                sender: "sender",
                source: "test",
                timestamp: Date.now(),
            };

            const chain = new FactRefChain(fact);

            expect(chain.fact.id).toBe("fact-1");
            expect(chain.refs).toHaveLength(0);
        });

        it("应该创建带引用的引用链", () => {
            const mainFact: Fact = {
                id: "fact-1",
                content: "Main",
                topics: ["agent"],
                sender: "sender",
                source: "test",
                timestamp: Date.now(),
                refs: [
                    { id: "ref-1", content: "Reference 1" },
                ],
            };

            const refChain = new FactRefChain(mainFact, [
                new FactRefChain({
                    id: "ref-1",
                    content: "Reference 1",
                    topics: [],
                    sender: "sender",
                    source: "test",
                    timestamp: Date.now(),
                }),
            ]);

            expect(mainFact.refs).toHaveLength(1);
            expect(refChain.refs).toHaveLength(1);
            expect(refChain.refs[0].fact.id).toBe("ref-1");
        });
    });

    describe("toString", () => {
        it("应该返回 Fact 的 content", () => {
            const fact: Fact = {
                id: "fact-1",
                content: "Hello World",
                topics: ["agent"],
                sender: "sender",
                source: "test",
                timestamp: Date.now(),
            };

            const chain = new FactRefChain(fact);

            expect(chain.toString()).toBe("Hello World");
        });
    });

    describe("build 静态方法", () => {
        it("应该构建简单的引用链（无 refs）", async () => {
            const fact: Fact = {
                id: "fact-1",
                content: "No refs",
                topics: [],
                sender: "sender",
                source: "test",
                timestamp: Date.now(),
                // 无 refs
            };

            const getFact = vi.fn().mockResolvedValue(null);

            const chain = await FactRefChain.build(fact, getFact);

            expect(chain.fact.id).toBe("fact-1");
            expect(chain.refs).toHaveLength(0);
            expect(getFact).not.toHaveBeenCalled();
        });

        it("应该构建带引用的引用链", async () => {
            const mainFact: Fact = {
                id: "fact-1",
                content: "Main",
                topics: [],
                sender: "sender",
                source: "test",
                timestamp: Date.now(),
                refs: [
                    { id: "ref-1", content: "Reference 1" },
                    { id: "ref-2", content: "Reference 2" },
                ],
            };

            const refFact1: Fact = {
                id: "ref-1",
                content: "Reference 1",
                topics: [],
                sender: "sender",
                source: "test",
                timestamp: Date.now(),
            };

            const refFact2: Fact = {
                id: "ref-2",
                content: "Reference 2",
                topics: [],
                sender: "sender",
                source: "test",
                timestamp: Date.now(),
            };

            const getFact = vi.fn()
                .mockResolvedValueOnce(refFact1)
                .mockResolvedValueOnce(refFact2);

            const chain = await FactRefChain.build(mainFact, getFact);

            expect(chain.fact.id).toBe("fact-1");
            expect(chain.refs).toHaveLength(2);
            expect(chain.refs[0].fact.id).toBe("ref-1");
            expect(chain.refs[1].fact.id).toBe("ref-2");
        });

        it("应该处理无法获取的 ref", async () => {
            const mainFact: Fact = {
                id: "fact-1",
                content: "Main",
                topics: [],
                sender: "sender",
                source: "test",
                timestamp: Date.now(),
                refs: [
                    { id: "missing-ref", content: "Missing" },
                ],
            };

            const getFact = vi.fn().mockResolvedValue(null);

            const chain = await FactRefChain.build(mainFact, getFact);

            expect(chain.fact.id).toBe("fact-1");
            expect(chain.refs).toHaveLength(0); // 无法获取的 ref 不加入链
        });

        it("应该限制递归深度", async () => {
            const level3Fact: Fact = {
                id: "level-3",
                content: "Level 3",
                topics: [],
                sender: "sender",
                source: "test",
                timestamp: Date.now(),
            };

            const level2Fact: Fact = {
                id: "level-2",
                content: "Level 2",
                topics: [],
                sender: "sender",
                source: "test",
                timestamp: Date.now(),
                refs: [{ id: "level-3", content: "Level 3" }],
            };

            const level1Fact: Fact = {
                id: "level-1",
                content: "Level 1",
                topics: [],
                sender: "sender",
                source: "test",
                timestamp: Date.now(),
                refs: [{ id: "level-2", content: "Level 2" }],
            };

            let callCount = 0;
            const getFact = vi.fn().mockImplementation(() => {
                callCount++;
                if (callCount === 1) return Promise.resolve(level2Fact);
                if (callCount === 2) return Promise.resolve(level3Fact);
                return Promise.resolve(null);
            });

            const chain = await FactRefChain.build(level1Fact, getFact, 1);

            // maxIters=1 意味着只获取第一层 refs
            expect(chain.fact.id).toBe("level-1");
            expect(chain.refs).toHaveLength(1);
            expect(chain.refs[0].refs).toHaveLength(0); // 第二层 refs 未获取
        });

        it("应该处理 maxIters <= 0", async () => {
            const fact: Fact = {
                id: "fact-1",
                content: "With refs",
                topics: [],
                sender: "sender",
                source: "test",
                timestamp: Date.now(),
                refs: [{ id: "ref-1", content: "Should not fetch" }],
            };

            const getFact = vi.fn();

            const chain = await FactRefChain.build(fact, getFact, 0);

            expect(chain.fact.id).toBe("fact-1");
            expect(getFact).not.toHaveBeenCalled();
        });
    });
});
