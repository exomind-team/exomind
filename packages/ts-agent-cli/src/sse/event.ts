/**
 * SSEEvent 数据类
 *
 * 解析和创建 SSE 事件对象
 */

import type { Fact, SSEEvent, FactContent } from "./types.js";

/**
 * 从 SSE 原始数据解析 SSEEvent
 */
export function parseSSEEvent(raw: string): SSEEvent {
    const event: SSEEvent = {
        type: "message",
        data: "",
    };

    const lines = raw.split("\n");
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("event:")) {
            event.type = trimmed.slice(6).trim();
        } else if (trimmed.startsWith("data:")) {
            event.data = trimmed.slice(5).trim();
        }
    }

    return event;
}

/**
 * 尝试从 JSON 数据创建 Fact
 */
export function tryParseFact(jsonData: string): Fact | null {
    try {
        const parsed = JSON.parse(jsonData);
        if (!isFactData(parsed)) {
            return null;
        }
        return createFact(parsed);
    } catch {
        console.warn(`[SSEEvent] JSON 解析错误: ${jsonData}`);
        return null;
    }
}

/**
 * 判断数据是否为有效的 Fact 结构
 */
function isFactData(data: unknown): data is Record<string, unknown> {
    if (typeof data !== "object" || data === null) {
        return false;
    }

    const record = data as Record<string, unknown>;

    // 检查必需字段
    if (typeof record.id !== "string") {
        return false;
    }
    if (typeof record.content !== "string") {
        return false;
    }

    return true;
}

/**
 * 创建 Fact 对象
 */
function createFact(data: Record<string, unknown>): Fact {
    // 解析 topics
    let topics: string[] = [];
    if (Array.isArray(data.topics)) {
        topics = data.topics.map((t) => String(t));
    } else if (typeof data.topics === "string") {
        topics = (data.topics as string).split(",").map((t) => t.trim());
    }

    // 解析 refs
    const refs = parseRefs(data.refs);

    // 解析 fact_content
    const factContent = parseFactContent(data.fact_content);

    return {
        id: String(data.id),
        sender: String(data.sender ?? ""),
        topics,
        content: String(data.content ?? ""),
        source: String(data.source ?? ""),
        timestamp: typeof data.timestamp === "number" ? data.timestamp : Date.now(),
        refs,
        fact_content: factContent,
    };
}

/**
 * 解析引用链
 */
function parseRefs(refs: unknown): { id: string; content: string }[] | undefined {
    if (!Array.isArray(refs)) {
        return undefined;
    }

    return refs
        .map((ref) => {
            if (typeof ref !== "object" || ref === null) {
                return null;
            }
            const r = ref as Record<string, unknown>;
            if (typeof r.id !== "string" || typeof r.content !== "string") {
                return null;
            }
            return { id: r.id, content: r.content };
        })
        .filter((r): r is { id: string; content: string } => r !== null);
}

/**
 * 解析 Fact 内容
 */
function parseFactContent(content: unknown): FactContent | undefined {
    if (typeof content !== "object" || content === null) {
        return undefined;
    }
    return content as FactContent;
}

/**
 * 从 SSEEvent 获取新的 Fact 数据
 */
export function getNewFact(event: SSEEvent): Fact | null {
    if (event.type !== "new_fact" || !event.data) {
        return null;
    }

    return tryParseFact(event.data);
}

/**
 * SSEEvent 工具类
 */
export class SSEEventHandler {
    /**
     * 解析 SSE 格式字符串为 SSEEvent
     */
    static fromString(raw: string): SSEEvent {
        return parseSSEEvent(raw);
    }

    /**
     * 从 SSEEvent 提取 Fact
     */
    static extractFact(event: SSEEvent): Fact | null {
        return getNewFact(event);
    }

    /**
     * 检查是否为 keep-alive 事件
     */
    static isKeepAlive(event: SSEEvent): boolean {
        return event.type === "keep-alive" || (event.type === "message" && event.data === "");
    }

    /**
     * 检查是否为错误事件
     */
    static isError(event: SSEEvent): boolean {
        return event.type === "error";
    }
}
