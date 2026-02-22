/**
 * SSE 客户端
 *
 * 集成监听和发送功能的 SSE 客户端
 */

import type { Message } from "./types.js";
import { SSEListener, FactRefChain } from "./listener.js";
import type { SendResult } from "./sender.js";
import { SSESenderAsync } from "./sender.js";

// ==================== 默认配置 ====================

const DEFAULT_API_URL = "http://localhost:3000";
const DEFAULT_TOPICS = ["agent"];
const DEFAULT_SENDER = "Agent";

// ==================== 客户端配置 ====================

/**
 * SSE 客户端配置
 */
export interface SSEClientConfig {
    /** API URL */
    apiUrl: string;
    /** 要监听的话题 */
    topics: string[];
    /** 发送者标识 */
    sender: string;
    /** 初始重试延迟（秒） */
    initialRetryDelay: number;
    /** 最大重试延迟（秒） */
    maxRetryDelay: number;
    /** 请求超时（毫秒） */
    timeout: number;
}

// ==================== SSE 客户端 ====================

/**
 * 异步 SSE 客户端（集大成者）
 *
 * 职责：
 * - 监听 ExoBuffer 的 SSE 事件流
 * - 发送消息到 ExoBuffer
 *
 * 继承自：
 * - SSEListenerAsync: 监听功能
 * - SSESenderAsync: 发送功能
 *
 * 用法：
 * ```typescript
 * const client = new SSEClientAsync({
 *     apiUrl: "http://localhost:3000",
 *     topics: ["agent"],
 *     sender: "my-agent"
 * });
 *
 * for await (const chain of client.listen()) {
 *     console.log("收到消息:", chain.fact.content);
 *     await client.send(responseMessage);
 * }
 * ```
 */
export class SSEClientAsync {
    /** API URL */
    protected apiUrl: string;

    /** 要监听的话题 */
    protected topics: Set<string>;

    /** 发送者标识 */
    protected sender: string;

    /** 监听器实例 */
    protected listener: SSEListener;

    /** 发送器实例 */
    protected senderInstance: SSESenderAsync;

    /** 连接状态 */
    protected isListening: boolean = false;

    constructor(config?: Partial<SSEClientConfig>) {
        this.apiUrl = config?.apiUrl ?? DEFAULT_API_URL;
        this.topics = new Set(config?.topics ?? DEFAULT_TOPICS);
        this.sender = config?.sender ?? DEFAULT_SENDER;

        // 初始化监听器
        this.listener = new SSEListener({
            apiUrl: this.apiUrl,
            topics: Array.from(this.topics),
            sender: this.sender,
            initialRetryDelay: config?.initialRetryDelay,
            maxRetryDelay: config?.maxRetryDelay,
        });

        // 初始化发送器
        this.senderInstance = new SSESenderAsync({
            apiUrl: this.apiUrl,
            sender: this.sender,
            timeout: config?.timeout,
        });
    }

    /**
     * 是否已连接
     */
    get connected(): boolean {
        return this.listener.connected;
    }

    /**
     * 监听消息流
     */
    async *listen(): AsyncGenerator<FactRefChain, void, void> {
        this.isListening = true;

        try {
            yield* this.listener.listen();
        } finally {
            this.isListening = false;
        }
    }

    /**
     * 监听并处理消息（便捷方法）
     *
     * @param handler 处理每条消息的回调函数
     */
    async listenWith(
        handler: (chain: FactRefChain) => Promise<void> | void,
    ): Promise<void> {
        for await (const chain of this.listen()) {
            await handler(chain);
        }
    }

    /**
     * 发送单条消息
     */
    async send(message: Message): Promise<SendResult> {
        return this.senderInstance.send(message);
    }

    /**
     * 批量发送消息
     */
    async sendBatch(messages: Message[]): Promise<{
        successCount: number;
        failedCount: number;
    }> {
        return this.senderInstance.sendBatch(messages);
    }

    /**
     * 发送消息并等待确认
     */
    async sendAndWait(
        message: Message,
        maxWaitMs: number = 5000,
    ): Promise<SendResult> {
        return this.senderInstance.sendAndWait(message, maxWaitMs);
    }

    /**
     * 停止监听
     */
    stop(): void {
        this.listener.stop();
        this.isListening = false;
    }

    /**
     * 关闭连接
     */
    async close(): Promise<void> {
        this.stop();
        await this.listener.close();
    }

    /**
     * 获取 Fact API URL
     */
    get factApiUrl(): string {
        return this.senderInstance.factApiUrl;
    }

    /**
     * 更新监听话题
     */
    updateTopics(topics: string[]): void {
        this.topics = new Set(topics);
        // 注意：需要在下次连接时生效
    }

    /**
     * 添加监听话题
     */
    addTopic(topic: string): void {
        this.topics.add(topic);
    }

    /**
     * 移除监听话题
     */
    removeTopic(topic: string): void {
        this.topics.delete(topic);
    }
}

// ==================== 工厂函数 ====================

/**
 * 创建 SSE 客户端（工厂函数）
 */
export function createSSEClient(
    config?: Partial<SSEClientConfig>,
): SSEClientAsync {
    return new SSEClientAsync(config);
}

/**
 * 创建纯监听器
 */
export function createSSEListener(
    apiUrl: string,
    topics: string[],
    sender: string = DEFAULT_SENDER,
): SSEListener {
    return new SSEListener({
        apiUrl,
        topics,
        sender,
    });
}

/**
 * 创建纯发送器
 */
export function createSSESender(
    apiUrl: string,
    sender: string = DEFAULT_SENDER,
): SSESenderAsync {
    return new SSESenderAsync({
        apiUrl,
        sender,
    });
}
