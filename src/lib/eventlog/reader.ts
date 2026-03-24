/**
 * EventLog Reader
 * 从 .jsonl 文件读取事件日志
 */

import { EventLog } from './format';

// 文件系统接口
export interface FileSystem {
  readFile(path: string, encoding: string): string;
}

// Reader 配置
export interface ReaderOptions {
  path: string;
  fs: FileSystem;
}

// Reader 接口
export interface EventLogReader {
  readAll(): EventLog[];
  readWithLimit(limit: number): EventLog[];
  readWithOffset(offset: number): EventLog[];
  readReverse(): EventLog[];
  readByType(type: string): EventLog[];
}

/**
 * 创建 EventLog Reader
 */
export function createReader(options: ReaderOptions): EventLogReader {
  return {
    readAll: () => {
      const content = options.fs.readFile(options.path, 'utf-8');
      if (!content) return [];
      return parseJsonl(content);
    },
    readWithLimit: (limit: number) => {
      const content = options.fs.readFile(options.path, 'utf-8');
      if (!content) return [];
      return parseJsonl(content).slice(0, limit);
    },
    readWithOffset: (offset: number) => {
      const content = options.fs.readFile(options.path, 'utf-8');
      if (!content) return [];
      return parseJsonl(content).slice(offset);
    },
    readReverse: () => {
      const content = options.fs.readFile(options.path, 'utf-8');
      if (!content) return [];
      return parseJsonl(content).reverse();
    },
    readByType: (type: string) => {
      const content = options.fs.readFile(options.path, 'utf-8');
      if (!content) return [];
      return parseJsonl(content).filter(event => event.type === type);
    },
  };
}

/**
 * 解析 JSONL 格式
 */
function parseJsonl(content: string): EventLog[] {
  return content
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as EventLog);
}
