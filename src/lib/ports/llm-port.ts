/**
 * LLM Port - 大语言模型接口定义
 */

// 消息格式
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// 请求格式
export interface LLMRequest {
  model: string;                    // 模型名称
  messages: LLMMessage[];           // 消息列表
  maxTokens?: number;               // 最大输出 tokens
  temperature?: number;              // 温度参数
}

// 响应格式
export interface LLMResponse {
  content: string;                   // 生成的文本
  usage: {
    inputTokens: number;             // 输入 tokens
    outputTokens: number;            // 输出 tokens
  };
  model: string;                     // 实际使用的模型
}

// 流式片段
export interface LLMChunk {
  delta: string;                     // 新增内容
  done: boolean;                     // 是否结束
}

/**
 * LLM Port
 * 统一接口，适配器实现可替换（阿里云/OpenAI/本地模型等）
 */
export interface ILLMPort {
  /**
   * 同步调用（适合：一次性生成完整回复）
   */
  complete(request: LLMRequest): Promise<LLMResponse>;

  /**
   * 流式调用（适合：打字机效果逐字显示）
   */
  stream(request: LLMRequest): AsyncIterable<LLMChunk>;
}
