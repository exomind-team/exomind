/**
 * SSE 消息过滤器测试
 *
 * 测试消息过滤功能：话题绑定、消息过滤、去重
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MessageFilter } from "@sse/filter.js";
import type { SSEEvent } from "@sse/types.js";

// Mock getNewFact 函数
vi.mock("@sse/event.js", async () => {
    const actual = await vi.importActual("@sse/event.js");
    return {
        ...actual,
        getNewFact: vi.fn(),
    };
});

import { getNewFact } from "@sse/event.js";

describe("MessageFilter", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    describe("构造函数", () => {
        it("应该使用默认配置创建过滤器", () => {
            const filter = new MessageFilter();

            expect(filter).toBeDefined();
        });

        it("应该使用自定义配置创建过滤器", () => {
            const filter = new MessageFilter({
                topics: new Set(["agent", "test"]),
                sender: "custom-sender",
            });

            expect(filter).toBeDefined();
        });
    });

    describe("bind", () => {
        it("应该绑定话题", () => {
            const filter = new MessageFilter();
            filter.bind(["topic1", "topic2"]);

            // 通过过滤结果验证话题是否正确绑定
            const mockEvent: SSEEvent = {
                type: "new_fact",
                data: '{"id":"test","content":"test"}',
            };

            vi.mocked(getNewFact).mockReturnValue({
                id: "fact-1",
                content: "Test",
                topics: ["topic1"],
                sender: "other",
                source: "test",
                timestamp: Date.now(),
            });

            const result = filter.filter(mockEvent);

            expect(result).not.toBeNull();
            expect(result!.id).toBe("fact-1");
        });

        it("应该支持覆盖已绑定的话题", () => {
            const filter = new MessageFilter();
            filter.bind(["topic1"]);
            filter.bind(["topic2", "topic3"]);

            const mockEvent: SSEEvent = {
                type: "new_fact",
                data: '{"id":"test","content":"test"}',
            };

            vi.mocked(getNewFact).mockReturnValue({
                id: "fact-1",
                content: "Test",
                topics: ["topic2"],
                sender: "other",
                source: "test",
                timestamp: Date.now(),
            });

            const result = filter.filter(mockEvent);

            expect(result).not.toBeNull();
        });
    });

    describe("filter", () => {
        it("应该过滤非 new_fact 类型的事件", () => {
            const filter = new MessageFilter();
            const event: SSEEvent = {
                type: "error",
                data: "error",
            };

            const result = filter.filter(event);

            expect(result).toBeNull();
        });

        it("应该过滤无法解析的事件", () => {
            const filter = new MessageFilter();
            const event: SSEEvent = {
                type: "new_fact",
                data: "invalid json",
            };

            vi.mocked(getNewFact).mockReturnValue(null);

            const result = filter.filter(event);

            expect(result).toBeNull();
        });

        it("应该过滤已重复的 Fact（去重）", () => {
            const filter = new MessageFilter();
            filter.bind(["agent"]);

            const event1: SSEEvent = {
                type: "new_fact",
                data: '{"id":"fact-1","content":"first"}',
            };

            const event2: SSEEvent = {
                type: "new_fact",
                data: '{"id":"fact-1","content":"duplicate"}',
            };

            vi.mocked(getNewFact).mockReturnValue({
                id: "fact-1",
                content: "Test",
                topics: ["agent"],
                sender: "other",
                source: "test",
                timestamp: Date.now(),
            });

            const result1 = filter.filter(event1);
            const result2 = filter.filter(event2);

            expect(result1).not.toBeNull();
            expect(result2).toBeNull(); // 重复的 Fact 应被过滤
        });

        it("应该过滤不在话题中的 Fact", () => {
            const filter = new MessageFilter();
            filter.bind(["agent"]);

            const event: SSEEvent = {
                type: "new_fact",
                data: '{"id":"fact-1","content":"test"}',
            };

            vi.mocked(getNewFact).mockReturnValue({
                id: "fact-1",
                content: "Test",
                topics: ["other-topic"], // 不在监听话题中
                sender: "other",
                source: "test",
                timestamp: Date.now(),
            });

            const result = filter.filter(event);

            expect(result).toBeNull();
        });

        it("应该过滤自己发送的消息", () => {
            const filter = new MessageFilter();
            filter.bind(["agent"]);
            filter.bind(["agent"]); // sender 默认为 "Agent"

            const event: SSEEvent = {
                type: "new_fact",
                data: '{"id":"fact-1","content":"my message"}',
            };

            vi.mocked(getNewFact).mockReturnValue({
                id: "fact-1",
                content: "Test",
                topics: ["agent"],
                sender: "Agent", // 与过滤器的 sender 相同
                source: "test",
                timestamp: Date.now(),
            });

            const result = filter.filter(event);

            expect(result).toBeNull();
        });

        it("应该接受符合条件的 Fact", () => {
            const filter = new MessageFilter();
            filter.bind(["agent", "test"]);

            const event: SSEEvent = {
                type: "new_fact",
                data: '{"id":"fact-123","content":"valid"}',
            };

            vi.mocked(getNewFact).mockReturnValue({
                id: "fact-123",
                content: "Valid message",
                topics: ["test"], // 在监听话题中
                sender: "other-agent", // 不同的发送者
                source: "test",
                timestamp: Date.now(),
            });

            const result = filter.filter(event);

            expect(result).not.toBeNull();
            expect(result!.id).toBe("fact-123");
        });

        it("应该处理 Fact 的任意话题匹配", () => {
            const filter = new MessageFilter();
            filter.bind(["topic-a", "topic-b"]);

            const event: SSEEvent = {
                type: "new_fact",
                data: '{"id":"fact-1","content":"test"}',
            };

            vi.mocked(getNewFact).mockReturnValue({
                id: "fact-1",
                content: "Test",
                topics: ["topic-b"], // 匹配第二个话题
                sender: "other",
                source: "test",
                timestamp: Date.now(),
            });

            const result = filter.filter(event);

            expect(result).not.toBeNull();
        });

        it("应该处理空话题集合（接受所有话题）", () => {
            const filter = new MessageFilter();
            // 不绑定任何话题

            const event: SSEEvent = {
                type: "new_fact",
                data: '{"id":"fact-1","content":"test"}',
            };

            vi.mocked(getNewFact).mockReturnValue({
                id: "fact-1",
                content: "Test",
                topics: ["any-topic"],
                sender: "other",
                source: "test",
                timestamp: Date.now(),
            });

            const result = filter.filter(event);

            expect(result).not.toBeNull();
        });
    });

    describe("isInAllTopics", () => {
        it("应该验证 Fact 的话题是否都在 filter 话题集合中", () => {
            const filter = new MessageFilter();
            filter.bind(["topic-a", "topic-b"]);

            // Fact 的所有 topics 都在 filter.topics 中
            const fact = {
                id: "fact-1",
                content: "Test",
                topics: ["topic-a"], // 只有 topic-a
                sender: "other",
                source: "test",
                timestamp: Date.now(),
            };

            expect(filter.isInAllTopics(fact)).toBe(true);
        });

        it("应该处理 Fact 有话题不在 filter 集合中的情况", () => {
            const filter = new MessageFilter();
            filter.bind(["topic-a", "topic-b"]);

            // Fact 有 topic-c，不在 filter.topics 中
            const fact = {
                id: "fact-1",
                content: "Test",
                topics: ["topic-a", "topic-c"],
                sender: "other",
                source: "test",
                timestamp: Date.now(),
            };

            // topic-c 不在 filter.topics 中，所以返回 false
            expect(filter.isInAllTopics(fact)).toBe(false);
        });

        it("应该处理空话题集合（返回 true）", () => {
            const filter = new MessageFilter();
            // 不绑定话题

            const fact = {
                id: "fact-1",
                content: "Test",
                topics: ["any"],
                sender: "other",
                source: "test",
                timestamp: Date.now(),
            };

            expect(filter.isInAllTopics(fact)).toBe(true);
        });
    });

    describe("reset", () => {
        it("应该重置已过滤的消息 ID 集合", () => {
            const filter = new MessageFilter();
            filter.bind(["agent"]);

            const event: SSEEvent = {
                type: "new_fact",
                data: '{"id":"fact-1","content":"test"}',
            };

            vi.mocked(getNewFact).mockReturnValue({
                id: "fact-1",
                content: "Test",
                topics: ["agent"],
                sender: "other",
                source: "test",
                timestamp: Date.now(),
            });

            // 第一次过滤
            filter.filter(event);

            // 重置
            filter.reset();

            // 相同的 Fact 应该能再次通过
            const result = filter.filter(event);

            expect(result).not.toBeNull();
        });
    });

    describe("getFilteredCount", () => {
        it("应该返回已过滤的消息数量", () => {
            const filter = new MessageFilter();
            filter.bind(["agent"]);

            expect(filter.getFilteredCount()).toBe(0);

            const event: SSEEvent = {
                type: "new_fact",
                data: '{"id":"fact-1","content":"test"}',
            };

            vi.mocked(getNewFact).mockReturnValue({
                id: "fact-1",
                content: "Test",
                topics: ["agent"],
                sender: "other",
                source: "test",
                timestamp: Date.now(),
            });

            filter.filter(event);

            expect(filter.getFilteredCount()).toBe(1);
        });
    });

    describe("filterBatch", () => {
        it("应该批量过滤事件", () => {
            const filter = new MessageFilter();
            filter.bind(["agent"]);

            const events: SSEEvent[] = [
                { type: "new_fact", data: '{"id":"f1","content":"1"}' },
                { type: "new_fact", data: '{"id":"f2","content":"2"}' },
                { type: "new_fact", data: '{"id":"f3","content":"3"}' },
                { type: "error", data: "error" }, // 非 new_fact 事件
            ];

            vi.mocked(getNewFact).mockImplementation((event: SSEEvent) => {
                if (event.type !== "new_fact") return null;
                const data = JSON.parse(event.data);
                return {
                    id: data.id,
                    content: data.content,
                    topics: ["agent"],
                    sender: "other",
                    source: "test",
                    timestamp: Date.now(),
                };
            });

            const results = filter.filterBatch(events);

            expect(results).toHaveLength(3);
            expect(results[0].id).toBe("f1");
            expect(results[1].id).toBe("f2");
            expect(results[2].id).toBe("f3");
        });
    });

    describe("create 静态工厂方法", () => {
        it("应该创建配置好的过滤器", () => {
            const filter = MessageFilter.create(["agent", "test"], "my-agent");

            const event: SSEEvent = {
                type: "new_fact",
                data: '{"id":"fact-1","content":"test"}',
            };

            vi.mocked(getNewFact).mockReturnValue({
                id: "fact-1",
                content: "Test",
                topics: ["test"],
                sender: "other", // 不是 my-agent
                source: "test",
                timestamp: Date.now(),
            });

            const result = filter.filter(event);

            expect(result).not.toBeNull();
        });
    });
});
