/**
 * SSE 发送器
 *
 * 异步消息发送器，支持单条和批量发送
 */

import type { Message } from "./types.js";

// ==================== 默认配置 ====================

const DEFAULT_API_URL = "http://localhost:3000";
const FACT_ENDPOINT = "/api/fact";

// ==================== 工具函数 ====================

/**
 * 延迟函数
 */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ==================== 发送器配置 ====================

/**
 * 发送器配置
 */
export interface SSESenderConfig {
    /** API URL */
    apiUrl: string;
    /** 发送者标识 */
    sender: string;
    /** 请求超时（毫秒） */
    timeout: number;
}

// ==================== 发送结果 ====================

/**
 * 发送结果
 */
export interface SendResult {
    /** 是否成功 */
    success: boolean;
    /** HTTP 状态码 */
    status?: number;
    /** Fact ID（如果创建成功） */
    factId?: string;
    /** 错误信息 */
    error?: string;
}

// ==================== SSE 发送器 ====================

/**
 * 异步消息发送器
 *
 * 职责：
 * - 接收 Message 对象
 * - 发送到 ExoBuffer 的 /api/fact 端点
 * - 返回发送结果
 *
 * 用法：
 * ```typescript
 * const sender = new SSESenderAsync({ apiUrl: "http://localhost:3000" });
 * const result = await sender.send(message);
 * console.log(result.success); // true 或 false
 * ```
 */
export class SSESenderAsync {
    /** API URL */
    protected apiUrl: string;

    /** 发送者标识 */
    protected sender: string;

    /** 请求超时 */
    protected timeout: number;

    constructor(config?: Partial<SSESenderConfig>) {
        this.apiUrl = (config?.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, "");
        this.sender = config?.sender ?? "Agent";
        this.timeout = config?.timeout ?? 30000;
    }

    /**
     * 获取 Fact API URL
     */
    get factApiUrl(): string {
        return `${this.apiUrl}${FACT_ENDPOINT}`;
    }

    /**
     * 发送单条消息
     */
    async send(message: Message): Promise<SendResult> {
        try {
            // 构建 payload
            const payload = this.buildPayload(message);

            // 序列化为 JSON
            const body = JSON.stringify(payload);

            // 发送请求
            const response = await fetch(this.factApiUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body,
            });

            // 处理响应
            if (response.ok) {
                let factId: string | undefined;

                try {
                    const responseData = await response.json();
                    factId = typeof responseData.fact_id === "string" ? responseData.fact_id : undefined;
                } catch {
                    // 响应不是有效的 JSON
                }

                if (factId) {
                    console.log(`[SSESender] 发送成功，fact_id: ${factId}`);
                } else {
                    console.log(`[SSESender] 发送成功`);
                }

                return {
                    success: true,
                    status: response.status,
                    factId,
                };
            } else {
                console.warn(`[SSESender] 发送失败，HTTP ${response.status}`);
                return {
                    success: false,
                    status: response.status,
                    error: `HTTP ${response.status}`,
                };
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);

            if (errorMessage.includes("ConnectionError") || errorMessage.includes("ECONNREFUSED") || errorMessage.includes("fetch")) {
                console.warn(`[SSESender] 连接失败: ${errorMessage}`);
                return {
                    success: false,
                    error: `连接失败: ${errorMessage}`,
                };
            }

            console.error(`[SSESender] 发送错误: ${errorMessage}`);
            return {
                success: false,
                error: errorMessage,
            };
        }
    }

    /**
     * 批量发送消息
     */
    async sendBatch(messages: Message[]): Promise<{
        /** 成功数量 */
        successCount: number;
        /** 失败数量 */
        failedCount: number;
        /** 结果列表 */
        results: SendResult[];
    }> {
        const results: SendResult[] = [];
        let successCount = 0;

        for (const message of messages) {
            const result = await this.send(message);
            results.push(result);

            if (result.success) {
                successCount++;
            }
        }

        return {
            successCount,
            failedCount: messages.length - successCount,
            results,
        };
    }

    /**
     * 构建消息负载
     */
    protected buildPayload(message: Message): Record<string, unknown> {
        return {
            content: message.content,
            topics: message.topics,
            source: message.source,
            sender: message.sender ?? this.sender,
        };
    }

    /**
     * 发送并等待结果
     */
    async sendAndWait(message: Message, maxWaitMs: number = 5000): Promise<SendResult> {
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitMs) {
            const result = await this.send(message);

            if (result.success) {
                return result;
            }

            // 短暂延迟后重试
            await sleep(100);
        }

        return {
            success: false,
            error: "等待超时",
        };
    }
}

/**
 * 便捷函数：发送单条消息
 *
 * 用法：
 * ```typescript
 * import { sendMessage } from "./sender.js";
 *
 * const result = await sendMessage({
 *     content: "Hello",
 *     topics: ["agent"],
 *     source: "test",
 *     sender: "my-agent"
 * });
 * ```
 */
export async function sendMessage(
    message: Message,
    apiUrl: string = DEFAULT_API_URL
): Promise<SendResult> {
    const sender = new SSESenderAsync({ apiUrl });
    return sender.send(message);
}

/**
 * 批量发送消息便捷函数
 */
export async function sendBatchMessages(
    messages: Message[],
    apiUrl: string = DEFAULT_API_URL
): Promise<{
    successCount: number;
    failedCount: number;
}> {
    const sender = new SSESenderAsync({ apiUrl });
    const result = await sender.sendBatch(messages);
    return {
        successCount: result.successCount,
        failedCount: result.failedCount,
    };
}
