/**
 * SSE 事件解析测试
 *
 * 测试 SSE 事件解析和 Fact 提取功能
 */

import { describe, it, expect } from "vitest";
import {
    parseSSEEvent,
    tryParseFact,
    getNewFact,
    SSEEventHandler,
} from "@sse/event.js";
import type { SSEEvent } from "@sse/types.js";

describe("parseSSEEvent", () => {
    it("应该解析包含 event 和 data 的 SSE 格式", () => {
        const raw = 'event: new_fact\ndata: {"id":"test","content":"hello"}\n\n';
        const event = parseSSEEvent(raw);

        expect(event.type).toBe("new_fact");
        expect(event.data).toBe('{"id":"test","content":"hello"}');
    });

    it("应该处理只有 data 没有 event 的情况", () => {
        const raw = 'data: {"id":"test"}\n\n';
        const event = parseSSEEvent(raw);

        expect(event.type).toBe("message"); // 默认类型
        expect(event.data).toBe('{"id":"test"}');
    });

    it("应该处理只有 event 没有 data 的情况", () => {
        const raw = "event: ping\n\n";
        const event = parseSSEEvent(raw);

        expect(event.type).toBe("ping");
        expect(event.data).toBe("");
    });

    it("应该处理空的 SSE 数据", () => {
        const raw = "";
        const event = parseSSEEvent(raw);

        expect(event.type).toBe("message");
        expect(event.data).toBe("");
    });

    it("应该处理多行数据", () => {
        const raw = `event: message
data: line1
data: line2
data: line3

`;
        const event = parseSSEEvent(raw);

        expect(event.type).toBe("message");
        // 解析器会取最后一行的值，因为多行 data 会被覆盖
        expect(event.data).toBe("line3");
    });

    it("应该正确处理空白字符", () => {
        const raw = '  event:  new_fact  \n  data:  {"id":"test"}  \n  ';
        const event = parseSSEEvent(raw);

        expect(event.type).toBe("new_fact");
        expect(event.data).toBe('{"id":"test"}');
    });
});

describe("tryParseFact", () => {
    it("应该正确解析有效的 JSON Fact", () => {
        const json = JSON.stringify({
            id: "fact-123",
            content: "Test message",
            topics: ["agent", "test"],
            sender: "test-sender",
            source: "test",
            timestamp: 1234567890,
        });

        const fact = tryParseFact(json);

        expect(fact).not.toBeNull();
        expect(fact!.id).toBe("fact-123");
        expect(fact!.content).toBe("Test message");
        expect(fact!.topics).toEqual(["agent", "test"]);
        expect(fact!.sender).toBe("test-sender");
        expect(fact!.source).toBe("test");
        expect(fact!.timestamp).toBe(1234567890);
    });

    it("应该处理 topics 为逗号分隔字符串的情况", () => {
        const json = JSON.stringify({
            id: "fact-123",
            content: "Test",
            topics: "agent,test, notification",
            sender: "test",
            source: "test",
        });

        const fact = tryParseFact(json);

        expect(fact).not.toBeNull();
        expect(fact!.topics).toEqual(["agent", "test", "notification"]);
    });

    it("应该处理缺少可选字段的情况", () => {
        const json = JSON.stringify({
            id: "fact-123",
            content: "Test",
        });

        const fact = tryParseFact(json);

        expect(fact).not.toBeNull();
        expect(fact!.id).toBe("fact-123");
        expect(fact!.content).toBe("Test");
        expect(fact!.sender).toBe("");
        expect(fact!.topics).toEqual([]);
    });

    it("应该处理无效的 JSON", () => {
        const json = "not valid json";

        const fact = tryParseFact(json);

        expect(fact).toBeNull();
    });

    it("应该处理缺少必需字段的 JSON", () => {
        const json = JSON.stringify({
            content: "Test without id",
        });

        const fact = tryParseFact(json);

        expect(fact).toBeNull();
    });

    it("应该处理包含 refs 的 Fact", () => {
        const json = JSON.stringify({
            id: "fact-123",
            content: "Test",
            refs: [
                { id: "ref-1", content: "ref content 1" },
                { id: "ref-2", content: "ref content 2" },
            ],
        });

        const fact = tryParseFact(json);

        expect(fact).not.toBeNull();
        expect(fact!.refs).toHaveLength(2);
        expect(fact!.refs![0].id).toBe("ref-1");
        expect(fact!.refs![1].id).toBe("ref-2");
    });

    it("应该过滤掉无效的 refs", () => {
        const json = JSON.stringify({
            id: "fact-123",
            content: "Test",
            refs: [
                { id: "valid-ref", content: "valid" },
                { notId: "invalid" }, // 缺少 id 或 content
                { id: "also-valid", content: "also valid" },
            ],
        });

        const fact = tryParseFact(json);

        expect(fact).not.toBeNull();
        expect(fact!.refs).toHaveLength(2);
    });

    it("应该处理包含 fact_content 的 Fact", () => {
        const json = JSON.stringify({
            id: "fact-123",
            content: "Test",
            fact_content: {
                key1: "value1",
                key2: 42,
            },
        });

        const fact = tryParseFact(json);

        expect(fact).not.toBeNull();
        expect(fact!.fact_content).toBeDefined();
        expect(fact!.fact_content!.key1).toBe("value1");
        expect(fact!.fact_content!.key2).toBe(42);
    });
});

describe("getNewFact", () => {
    it("应该从 new_fact 类型事件提取 Fact", () => {
        const event: SSEEvent = {
            type: "new_fact",
            data: JSON.stringify({
                id: "fact-123",
                content: "Test",
            }),
        };

        const fact = getNewFact(event);

        expect(fact).not.toBeNull();
        expect(fact!.id).toBe("fact-123");
        expect(fact!.content).toBe("Test");
    });

    it("应该对非 new_fact 类型事件返回 null", () => {
        const event: SSEEvent = {
            type: "error",
            data: "error message",
        };

        const fact = getNewFact(event);

        expect(fact).toBeNull();
    });

    it("应该对空数据返回 null", () => {
        const event: SSEEvent = {
            type: "new_fact",
            data: "",
        };

        const fact = getNewFact(event);

        expect(fact).toBeNull();
    });

    it("应该对无效 JSON 数据返回 null", () => {
        const event: SSEEvent = {
            type: "new_fact",
            data: "not valid json",
        };

        const fact = getNewFact(event);

        expect(fact).toBeNull();
    });
});

describe("SSEEventHandler", () => {
    describe("fromString", () => {
        it("应该正确解析 SSE 格式字符串", () => {
            const raw = 'event: new_fact\ndata: {"id":"test"}\n\n';
            const event = SSEEventHandler.fromString(raw);

            expect(event.type).toBe("new_fact");
            expect(event.data).toBe('{"id":"test"}');
        });
    });

    describe("extractFact", () => {
        it("应该从事件中提取 Fact", () => {
            const event: SSEEvent = {
                type: "new_fact",
                data: JSON.stringify({
                    id: "fact-456",
                    content: "Extracted fact",
                }),
            };

            const fact = SSEEventHandler.extractFact(event);

            expect(fact).not.toBeNull();
            expect(fact!.id).toBe("fact-456");
            expect(fact!.content).toBe("Extracted fact");
        });

        it("应该对非 new_fact 事件返回 null", () => {
            const event: SSEEvent = {
                type: "keep-alive",
                data: "",
            };

            const fact = SSEEventHandler.extractFact(event);

            expect(fact).toBeNull();
        });
    });

    describe("isKeepAlive", () => {
        it("应该正确识别 keep-alive 类型", () => {
            const event: SSEEvent = {
                type: "keep-alive",
                data: "",
            };

            expect(SSEEventHandler.isKeepAlive(event)).toBe(true);
        });

        it("应该正确识别空消息", () => {
            const event: SSEEvent = {
                type: "message",
                data: "",
            };

            expect(SSEEventHandler.isKeepAlive(event)).toBe(true);
        });

        it("应该对非 keep-alive 消息返回 false", () => {
            const event: SSEEvent = {
                type: "new_fact",
                data: '{"id":"test"}',
            };

            expect(SSEEventHandler.isKeepAlive(event)).toBe(false);
        });

        it("应该对有数据的 message 类型返回 false", () => {
            const event: SSEEvent = {
                type: "message",
                data: "some data",
            };

            expect(SSEEventHandler.isKeepAlive(event)).toBe(false);
        });
    });

    describe("isError", () => {
        it("应该正确识别 error 类型", () => {
            const event: SSEEvent = {
                type: "error",
                data: "error message",
            };

            expect(SSEEventHandler.isError(event)).toBe(true);
        });

        it("应该对非 error 类型返回 false", () => {
            const event: SSEEvent = {
                type: "new_fact",
                data: '{"id":"test"}',
            };

            expect(SSEEventHandler.isError(event)).toBe(false);
        });
    });
});
