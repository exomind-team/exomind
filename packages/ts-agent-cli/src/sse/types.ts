/**
 * SSE 模块基础类型定义
 *
 * 定义 SSE 事件、消息过滤配置、API 配置等核心类型
 */

/**
 * SSE 事件类型
 */
export enum SSEEventType {
    NewFact = "new_fact",
    Error = "error",
    KeepAlive = "keep-alive",
    Message = "message",
}

/**
 * SSE 事件数据结构
 */
export interface SSEEvent {
    /** 事件类型 */
    type: string;
    /** 事件数据 */
    data: string;
}

/**
 * 消息过滤器配置
 */
export interface MessageFilterConfig {
    /** 要监听的话题列表 */
    topics: string[];
    /** 发送者标识，用于过滤自己发送的消息 */
    sender: string;
}

/**
 * API 配置
 */
export interface APIConfig {
    /** API 基础 URL */
    url: string;
    /** 事件端点 */
    eventsEndpoint: string;
    /** Fact 端点 */
    factEndpoint: string;
}

/**
 * 简化的消息类型定义（保持与 messenger 兼容，后续复刻 messenger）
 */
export interface FactContent {
    [key: string]: unknown;
}

/**
 * Fact 引用链
 */
export interface FactRef {
    /** Fact ID */
    id: string;
    /** 引用内容 */
    content: string;
}

/**
 * Fact 数据结构
 */
export interface Fact {
    /** Fact 唯一标识 */
    id: string;
    /** 发送者 */
    sender: string;
    /** 话题列表 */
    topics: string[];
    /** 消息内容 */
    content: string;
    /** 来源 */
    source: string;
    /** 时间戳 */
    timestamp: number;
    /** 引用链 */
    refs?: FactRef[];
    /** Fact 内容（扩展字段） */
    fact_content?: FactContent;
}

/**
 * 消息负载结构
 */
export interface Message {
    /** 消息内容 */
    content: string;
    /** 话题列表 */
    topics: string[];
    /** 来源 */
    source: string;
    /** 发送者 */
    sender: string;
}

/**
 * HTTP 请求配置
 */
export interface HttpRequestConfig {
    /** 请求方法 */
    method: "GET" | "POST" | "PUT" | "DELETE";
    /** 请求 URL */
    url: string;
    /** 请求头 */
    headers?: Record<string, string>;
    /** 请求体 */
    body?: Uint8Array;
    /** 超时时间（毫秒） */
    timeout?: number;
}

/**
 * HTTP 响应结构
 */
export interface HttpResponse {
    /** 状态码 */
    status: number;
    /** 响应头 */
    headers: Record<string, string>;
    /** 响应体 */
    body: Uint8Array;
}

/**
 * 连接状态
 */
export interface ConnectionState {
    /** 是否已连接 */
    isConnected: boolean;
    /** 当前 URL */
    currentUrl: string;
    /** 监听的话题 */
    topics: string[];
}

/**
 * 重连配置
 */
export interface ReconnectConfig {
    /** 初始重试时间（秒） */
    initialDelay: number;
    /** 最大重试时间（秒） */
    maxDelay: number;
    /** 重试时间乘数 */
    backoffMultiplier: number;
}
