/**
 * EventLog 写入器
 * 支持 JSONL 格式的文件写入
 */

import { EventLog } from './format';

// 文件系统接口
export interface FileSystem {
  writeFile: (path: string, data: string) => Promise<void>;
  readFile: (path: string) => Promise<string>;
}

// Writer 配置
export interface WriterConfig {
  path: string;
  fs: FileSystem;
}

/**
 * EventLog 写入器类
 * 用于将事件写入 JSONL 文件
 */
export class EventLogWriter {
  private path: string;
  private fs: FileSystem;
  
  constructor(config: WriterConfig) {
    this.path = config.path;
    this.fs = config.fs;
  }
  
  /**
   * 追加事件到文件
   * 写入 JSONL 格式（每行一个 JSON 对象）
   */
  async append(event: EventLog): Promise<void> {
    const line = JSON.stringify(event) + '\n';
    await this.fs.writeFile(this.path, line);
  }
}

/**
 * 创建 EventLogWriter 实例
 */
export function createWriter(config: WriterConfig): EventLogWriter {
  return new EventLogWriter(config);
}
