/**
 * SSE 类型定义测试
 *
 * 验证 SSE 模块的类型定义是否正确
 */

import { describe, it, expect } from "vitest";
import { SSEEventType } from "@sse/types.js";
import type {
    SSEEvent,
    Fact,
    FactRef,
    FactContent,
    Message,
    MessageFilterConfig,
    APIConfig,
    ConnectionState,
    ReconnectConfig,
} from "@sse/types.js";

describe("SSEEventType 枚举", () => {
    it("应该包含 NewFact 类型", () => {
        expect(SSEEventType.NewFact).toBe("new_fact");
    });

    it("应该包含 Error 类型", () => {
        expect(SSEEventType.Error).toBe("error");
    });

    it("应该包含 KeepAlive 类型", () => {
        expect(SSEEventType.KeepAlive).toBe("keep-alive");
    });

    it("应该包含 Message 类型", () => {
        expect(SSEEventType.Message).toBe("message");
    });
});

describe("SSEEvent 接口", () => {
    it("应该可以创建 SSEEvent 对象", () => {
        const event: SSEEvent = {
            type: "new_fact",
            data: '{"id":"test","content":"hello"}',
        };

        expect(event.type).toBe("new_fact");
        expect(event.data).toBe('{"id":"test","content":"hello"}');
    });

    it("应该允许可选的 event 字段", () => {
        const event: SSEEvent = {
            type: "message",
            data: "",
        };

        expect(event.type).toBe("message");
        expect(event.data).toBe("");
    });
});

describe("Fact 接口", () => {
    it("应该可以创建基本的 Fact 对象", () => {
        const fact: Fact = {
            id: "fact-123",
            sender: "agent-1",
            topics: ["agent", "test"],
            content: "Test message",
            source: "test",
            timestamp: 1234567890,
        };

        expect(fact.id).toBe("fact-123");
        expect(fact.sender).toBe("agent-1");
        expect(fact.topics).toEqual(["agent", "test"]);
        expect(fact.content).toBe("Test message");
        expect(fact.source).toBe("test");
        expect(fact.timestamp).toBe(1234567890);
    });

    it("应该支持可选的 refs 字段", () => {
        const fact: Fact = {
            id: "fact-123",
            sender: "agent-1",
            topics: ["agent"],
            content: "Test",
            source: "test",
            timestamp: 1234567890,
            refs: [
                { id: "ref-1", content: "referenced content" },
            ],
        };

        expect(fact.refs).toBeDefined();
        expect(fact.refs).toHaveLength(1);
        expect(fact.refs![0].id).toBe("ref-1");
    });

    it("应该支持可选的 fact_content 字段", () => {
        const fact: Fact = {
            id: "fact-123",
            sender: "agent-1",
            topics: ["agent"],
            content: "Test",
            source: "test",
            timestamp: 1234567890,
            fact_content: {
                key1: "value1",
                key2: 42,
            },
        };

        expect(fact.fact_content).toBeDefined();
        expect(fact.fact_content!.key1).toBe("value1");
        expect(fact.fact_content!.key2).toBe(42);
    });
});

describe("FactRef 接口", () => {
    it("应该可以创建 FactRef 对象", () => {
        const ref: FactRef = {
            id: "ref-123",
            content: "referenced message",
        };

        expect(ref.id).toBe("ref-123");
        expect(ref.content).toBe("referenced message");
    });
});

describe("FactContent 接口", () => {
    it("应该支持任意键值对", () => {
        const content: FactContent = {
            title: "Test Title",
            priority: 1,
            tags: ["a", "b", "c"],
            metadata: {
                created: "2024-01-01",
                author: "test",
            },
        };

        expect(content.title).toBe("Test Title");
        expect(content.priority).toBe(1);
        expect(content.tags).toEqual(["a", "b", "c"]);
        expect(content.metadata).toEqual({ created: "2024-01-01", author: "test" });
    });
});

describe("Message 接口", () => {
    it("应该可以创建 Message 对象", () => {
        const message: Message = {
            content: "Hello world",
            topics: ["agent", "notification"],
            source: "test-sender",
            sender: "my-agent",
        };

        expect(message.content).toBe("Hello world");
        expect(message.topics).toEqual(["agent", "notification"]);
        expect(message.source).toBe("test-sender");
        expect(message.sender).toBe("my-agent");
    });
});

describe("MessageFilterConfig 接口", () => {
    it("应该可以创建 MessageFilterConfig 对象", () => {
        const config: MessageFilterConfig = {
            topics: ["agent", "test"],
            sender: "my-agent",
        };

        expect(config.topics).toEqual(["agent", "test"]);
        expect(config.sender).toBe("my-agent");
    });
});

describe("APIConfig 接口", () => {
    it("应该可以创建 APIConfig 对象", () => {
        const config: APIConfig = {
            url: "http://localhost:3000",
            eventsEndpoint: "/api/events",
            factEndpoint: "/api/fact",
        };

        expect(config.url).toBe("http://localhost:3000");
        expect(config.eventsEndpoint).toBe("/api/events");
        expect(config.factEndpoint).toBe("/api/fact");
    });
});

describe("ConnectionState 接口", () => {
    it("应该可以创建 ConnectionState 对象", () => {
        const state: ConnectionState = {
            isConnected: true,
            currentUrl: "http://localhost:3000/api/events?topics=agent",
            topics: new Set(["agent"]),
        };

        expect(state.isConnected).toBe(true);
        expect(state.currentUrl).toBe("http://localhost:3000/api/events?topics=agent");
        expect(state.topics.has("agent")).toBe(true);
    });
});

describe("ReconnectConfig 接口", () => {
    it("应该可以创建 ReconnectConfig 对象", () => {
        const config: ReconnectConfig = {
            initialDelay: 1,
            maxDelay: 64,
            backoffMultiplier: 2,
        };

        expect(config.initialDelay).toBe(1);
        expect(config.maxDelay).toBe(64);
        expect(config.backoffMultiplier).toBe(2);
    });
});
