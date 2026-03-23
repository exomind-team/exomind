/**
 * SSE 监听器
 *
 * 异步 SSE 事件监听器，支持连接管理、事件解析、重连机制
 */

import type { Fact, FactRef, SSEEvent } from "./types.js";
import { MessageFilter } from "./filter.js";
import { parseSSEEvent, getNewFact } from "./event.js";

// ==================== 默认配置 ====================

const DEFAULT_API_URL = "http://localhost:3000";
const DEFAULT_TOPICS = ["agent"];
const DEFAULT_SENDER = "Agent";
const EVENTS_ENDPOINT = "/api/events";
const FACT_ENDPOINT = "/api/fact";

const RETRY_TIME_MAX = 64;

// ==================== 工具函数 ====================

/**
 * 获取 Fact API URL
 */
function getFactApiUrl(apiUrl: string): string {
    return `${apiUrl}${FACT_ENDPOINT}`;
}

/**
 * 获取事件 API URL
 */
function getEventsApiUrl(apiUrl: string, topics: Set<string>): string {
    const topicsArray = Array.from(topics);
    const query = topicsArray.length > 0 ? `?topics=${topicsArray.join(",")}` : "";
    return `${apiUrl}${EVENTS_ENDPOINT}${query}`;
}

/**
 * 延迟函数
 */
function sleep(seconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

/**
 * 从 API 响应创建 Fact
 */
function createFactFromApi(data: Record<string, unknown>): Fact {
    return {
        id: String(data.id ?? ""),
        sender: String(data.sender ?? ""),
        topics: Array.isArray(data.topics) ? data.topics.map(String) : [],
        content: String(data.content ?? ""),
        source: String(data.source ?? ""),
        timestamp: typeof data.timestamp === "number" ? data.timestamp : Date.now(),
        refs: undefined,
        fact_content: undefined,
    };
}

// ==================== SSE 监听器 ====================

/**
 * SSE 监听器配置
 */
export interface SSEListenerConfig {
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
}

/**
 * 异步 SSE 事件监听器
 *
 * 职责：
 * - 监听 ExoBuffer 的 SSE 事件流
 * - 过滤消息（去重、话题过滤）
 * - 解析 Fact 对象
 * - 自动重连机制
 */
export class SSEListener {
    /** API URL */
    protected apiUrl: string;

    /** 要监听的话题 */
    protected topics: Set<string>;

    /** 发送者标识 */
    protected sender: string;

    /** 消息过滤器 */
    protected filter: MessageFilter;

    /** 连接状态 */
    protected isConnected: boolean = false;

    /** 当前连接的实际 URL */
    protected currentUrl: string = "";

    /** 内部状态 */
    protected aborted: boolean = false;

    /** 重试延迟 */
    protected retryDelay: number;

    /** 最大重试延迟 */
    protected maxRetryDelay: number;

    constructor(config?: Partial<SSEListenerConfig>) {
        this.apiUrl = config?.apiUrl ?? DEFAULT_API_URL;
        this.topics = new Set(config?.topics ?? DEFAULT_TOPICS);
        this.sender = config?.sender ?? DEFAULT_SENDER;
        this.filter = MessageFilter.create(Array.from(this.topics), this.sender);
        this.retryDelay = config?.initialRetryDelay ?? 1.0;
        this.maxRetryDelay = config?.maxRetryDelay ?? RETRY_TIME_MAX;
    }

    /**
     * 获取 Fact API URL
     */
    get factApiUrl(): string {
        return getFactApiUrl(this.apiUrl);
    }

    /**
     * 获取事件 API URL
     */
    get eventsApiUrl(): string {
        return getEventsApiUrl(this.apiUrl, this.topics);
    }

    /**
     * 是否已连接
     */
    get connected(): boolean {
        return this.isConnected;
    }

    /**
     * 监听消息流
     */
    async *listen(): AsyncGenerator<FactRefChain, void, void> {
        this.aborted = false;
        this.retryDelay = 1.0;

        while (!this.aborted) {
            try {
                await this.connect();
                this.retryDelay = 1.0;

                for await (const event of this.events()) {
                    if (this.aborted) {
                        break;
                    }

                    const fact = this.filter.filter(event);
                    if (fact) {
                        const chain = FactRefChain.build(
                            fact,
                            this.getMessageById.bind(this),
                        );
                        yield chain;
                    }
                }
            } catch (error) {
                if (this.aborted) {
                    break;
                }

                const errorMessage =
                    error instanceof Error ? error.message : String(error);
                console.error(`[SSEListener] 连接错误: ${errorMessage}`);

                // 指数退避重连
                await sleep(this.retryDelay);
                this.retryDelay = Math.min(
                    this.retryDelay * 2,
                    this.maxRetryDelay,
                );
                console.log(`[SSEListener] ${this.retryDelay}s 后重试...`);
            } finally {
                await this.disconnect();
            }
        }
    }

    /**
     * 连接 SSE 端点
     */
    async connect(): Promise<void> {
        try {
            const response = await fetch(this.eventsApiUrl, {
                headers: {
                    Accept: "text/event-stream",
                    Connection: "keep-alive",
                },
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            this.isConnected = true;
            this.currentUrl = this.eventsApiUrl;
            console.log(
                `[SSEListener] 已连接到 ${this.currentUrl}，监听话题: ${Array.from(this.topics)}`,
            );
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : String(error);
            console.error(
                `[SSEListener] 连接 ${this.currentUrl} 失败: ${errorMessage}`,
            );
            throw error;
        }
    }

    /**
     * 断开连接
     */
    async disconnect(): Promise<void> {
        this.isConnected = false;
    }

    /**
     * 停止监听
     */
    stop(): void {
        this.aborted = true;
    }

    /**
     * 关闭连接并停止
     */
    async close(): Promise<void> {
        this.stop();
        await this.disconnect();
    }

    /**
     * 异步事件流解析器
     */
    private async *events(): AsyncGenerator<SSEEvent, void, void> {
        if (!this.isConnected) {
            return;
        }

        // 使用 fetch API 获取 SSE 流
        const response = await fetch(this.eventsApiUrl, {
            headers: {
                Accept: "text/event-stream",
                Connection: "keep-alive",
            },
        });

        if (!response.body) {
            throw new Error("SSE 流为空");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const buffer: string[] = [];

        while (true) {
            const { done, value } = await reader.read();

            if (done) {
                // 处理最后一条消息
                if (buffer.length > 0) {
                    const event = parseSSEEvent(buffer.join("\n"));
                    if (event.data) {
                        yield event;
                    }
                }
                break;
            }

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n");

            for (const line of lines) {
                if (line === "") {
                    // 空行表示一条消息结束
                    if (buffer.length > 0) {
                        const event = parseSSEEvent(buffer.join("\n"));
                        if (event.data) {
                            yield event;
                        }
                        buffer.length = 0;
                    }
                } else {
                    buffer.push(line);
                }
            }
        }
    }

    /**
     * 根据 ID 获取消息
     */
    async getMessageById(factId: string): Promise<Fact | null> {
        const url = `${this.factApiUrl}/${factId}`;

        try {
            const response = await fetch(url);

            if (response.status === 404) {
                return null;
            }

            if (!response.ok) {
                console.warn(
                    `[SSEListener] 获取消息失败: HTTP ${response.status}`,
                );
                return null;
            }

            const data = await response.json();
            return createFactFromApi(data as Record<string, unknown>);
        } catch (error) {
            console.warn(`[SSEListener] 获取消息失败: ${error}`);
            return null;
        }
    }
}

// ==================== FactRefChain ====================

/**
 * Fact 引用链
 */
export class FactRefChain {
    /** Fact */
    fact: Fact;

    /** 引用的 Fact */
    refs: FactRefChain[];

    constructor(fact: Fact, refs: FactRefChain[] = []) {
        this.fact = fact;
        this.refs = refs;
    }

    /**
     * 构建引用链
     */
    static async build(
        fact: Fact,
        getFactFromId: (factId: string) => Promise<Fact | null>,
        maxIters: number = 1,
    ): Promise<FactRefChain> {
        if (maxIters <= 0 || !fact.refs || fact.refs.length === 0) {
            return new FactRefChain(fact);
        }

        const refChains: FactRefChain[] = [];

        for (const ref of fact.refs) {
            const refFact = await getFactFromId(ref.id);
            if (refFact) {
                const chain = await FactRefChain.build(
                    refFact,
                    getFactFromId,
                    maxIters - 1,
                );
                refChains.push(chain);
            }
        }

        return new FactRefChain(fact, refChains);
    }

    /**
     * 转换为字符串
     */
    toString(): string {
        return this.fact.content;
    }
}

// ==================== ConnectionError ====================

class ConnectionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ConnectionError";
    }
}
