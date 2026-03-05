/**
 * SSE 模块 - 主入口
 *
 * 聚合导出所有 SSE 相关的类型和类
 *
 * 用法：
 * ```typescript
 * import {
 *     SSEEvent,
 *     SSEListenerAsync,
 *     SSESenderAsync,
 *     SSEClientAsync,
 *     sendMessage
 * } from "./sse/index.js";
 * ```
 */

// ==================== 类型导出 ====================

// 基础类型
export type {
    SSEEvent,
    SSEEventType,
    MessageFilterConfig,
    APIConfig,
    Fact,
    FactRef,
    FactContent,
    Message,
    HttpRequestConfig,
    HttpResponse,
    ConnectionState,
    ReconnectConfig,
} from "./types.js";

// 消息过滤器
export type { FilterConfig } from "./filter.js";

// 监听器
export type { SSEListenerConfig } from "./listener.js";

// 发送器
export type { SSESenderConfig, SendResult } from "./sender.js";

// 客户端
export type { SSEClientConfig } from "./client.js";

// ==================== 类导出 ====================

// 消息过滤器
export { MessageFilter } from "./filter.js";

// SSE 监听器
export { SSEListener as SSEListenerAsync } from "./listener.js";

// SSE 发送器
export { SSESenderAsync, sendMessage, sendBatchMessages } from "./sender.js";

// SSE 客户端
export {
    SSEClientAsync,
    createSSEClient,
    createSSEListener,
    createSSESender,
} from "./client.js";

// ==================== 便捷函数导出 ====================

// SSE 事件工具
export {
    parseSSEEvent,
    tryParseFact,
    getNewFact,
    SSEEventHandler,
} from "./event.js";

// ==================== 默认配置 ====================

/**
 * 默认配置
 */
export const DEFAULT_CONFIG = {
    /** 默认 API URL */
    API_URL: "http://localhost:3000",
    /** 默认话题 */
    TOPICS: ["agent"],
    /** 默认发送者 */
    SENDER: "Agent",
    /** 事件端点 */
    EVENTS_ENDPOINT: "/api/events",
    /** Fact 端点 */
    FACT_ENDPOINT: "/api/fact",
    /** 初始重试延迟（秒） */
    INITIAL_RETRY_DELAY: 1.0,
    /** 最大重试延迟（秒） */
    MAX_RETRY_DELAY: 64.0,
    /** 请求超时（毫秒） */
    TIMEOUT: 30000,
} as const;

// ==================== SignalPool 导出 ====================

// SignalPool 类型
export type {
    SignalEvent,
    SignalRoute,
    TargetType,
    PublishRequest,
    PublishResponse,
} from "./signal-types.js";

// SignalPool 监听器
export { SignalListener } from "./signal-listener.js";
export type { SignalListenerConfig } from "./signal-listener.js";

// SignalPool 发送器
export { SignalSender } from "./signal-sender.js";
export type { SignalSenderConfig } from "./signal-sender.js";

// SignalPool 客户端
export { SignalClient, createSignalClient } from "./signal-client.js";
export type { SignalClientConfig } from "./signal-client.js";

// ==================== 版本信息 ====================

/**
 * 模块版本
 */
export const VERSION = "1.0.0";
