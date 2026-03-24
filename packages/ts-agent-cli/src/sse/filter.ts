/**
 * 消息过滤器
 *
 * 实现消息去重和话题过滤功能
 */

import type { Fact, SSEEvent } from "./types.js";
import { getNewFact } from "./event.js";

/**
 * 消息过滤器配置
 */
export interface FilterConfig {
    /** 要监听的话题集合 */
    topics: Set<string>;
    /** 已看到的 Fact ID 集合 */
    seenIds: Set<string>;
    /** 发送者标识，用于过滤自己发送的消息 */
    sender: string;
}

/**
 * 消息过滤器
 *
 * 职责：
 * - 消息去重（基于 Fact ID）
 * - 话题过滤
 * - 发送者过滤
 */
export class MessageFilter {
    /** 要监听的话题集合 */
    private topics: Set<string>;

    /** 已看到的 Fact ID 集合（用于去重） */
    private seenIds: Set<string>;

    /** 发送者标识 */
    private sender: string;

    constructor(config?: Partial<FilterConfig>) {
        this.topics = config?.topics ?? new Set();
        this.seenIds = config?.seenIds ?? new Set();
        this.sender = config?.sender ?? "Agent";
    }

    /**
     * 绑定话题
     */
    bind(topics: Iterable<string>): this {
        this.topics = new Set(topics);
        return this;
    }

    /**
     * 过滤消息
     */
    filter(event: SSEEvent): Fact | null {
        // 只处理 new_fact 类型的事件
        if (event.type !== "new_fact") {
            return null;
        }

        // 解析 Fact
        const fact = getNewFact(event);
        if (!fact) {
            return null;
        }

        // 去重检查
        if (this.seenIds.has(fact.id)) {
            return null;
        }
        this.seenIds.add(fact.id);

        // 话题过滤
        if (!this.isInTopics(fact)) {
            return null;
        }

        // 发送者过滤（可选）
        if (fact.sender === this.sender) {
            return null;
        }

        return fact;
    }

    /**
     * 检查 Fact 是否在指定话题中
     */
    private isInTopics(fact: Fact): boolean {
        if (this.topics.size === 0) {
            return true;
        }

        // 检查 Fact 的 topics 是否与任一监听话题匹配
        return fact.topics.some((topic) => this.topics.has(topic));
    }

    /**
     * 检查 Fact 是否在所有指定话题中
     */
    isInAllTopics(fact: Fact): boolean {
        if (this.topics.size === 0) {
            return true;
        }

        return fact.topics.every((topic) => this.topics.has(topic));
    }

    /**
     * 重置过滤器状态
     */
    reset(): void {
        this.seenIds.clear();
    }

    /**
     * 获取已过滤的消息数量
     */
    getFilteredCount(): number {
        return this.seenIds.size;
    }

    /**
     * 批量过滤消息
     */
    filterBatch(events: SSEEvent[]): Fact[] {
        return events.map((event) => this.filter(event)).filter((f): f is Fact => f !== null);
    }

    /**
     * 创建新的过滤器实例（工厂方法）
     */
    static create(topics: string[], sender: string = "Agent"): MessageFilter {
        return new MessageFilter({
            topics: new Set(topics),
            sender,
        });
    }
}
