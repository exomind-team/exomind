/**
 * Environment - ExoMind 运行环境
 *
 * ┌─────────────────────────────────────────┐
 * │  L2 Environment                         │
 * │  ─────────────────────────────────     │
 * │  - 持有 Port 实例（能力）               │
 * │  - 管理资源池                           │
 * │  - 消息缓冲                            │
 * │  - 独占资源管理                         │
 * └─────────────────────────────────────────┘
 */

import type { IASRPort } from '../interfaces/asr.port.js';
import type { IStoragePort } from '../interfaces/storage.port.js';
import type { EventData, TimeBlockData, ActiveBlockData, TimerConfig } from '@exomind/shared';

// ============== Environment 接口 ==============
export interface Environment {
  asr: IASRPort;
  storage: IStoragePort;
}

// ============== Environment 实现 ==============
export class ExoMindEnvironment implements Environment {
  asr: IASRPort;
  storage: IStoragePort;

  private static instance: ExoMindEnvironment | null = null;

  private constructor(asrAdapter: IASRPort, storageAdapter: IStoragePort) {
    this.asr = asrAdapter;
    this.storage = storageAdapter;
    console.log('[Environment] ExoMindEnvironment 初始化完成');
  }

  static create(asrAdapter: IASRPort, storageAdapter: IStoragePort): ExoMindEnvironment {
    if (!ExoMindEnvironment.instance) {
      ExoMindEnvironment.instance = new ExoMindEnvironment(asrAdapter, storageAdapter);
    }
    return ExoMindEnvironment.instance;
  }

  static getInstance(): ExoMindEnvironment {
    if (!ExoMindEnvironment.instance) {
      throw new Error('Environment not initialized. Call create() first.');
    }
    return ExoMindEnvironment.instance;
  }

  capabilities(): Record<string, boolean> {
    return {
      asr: this.asr.isAvailable(),
      storage: true,
    };
  }
}

// ============== 存储键常量 ==============
export const STORAGE_KEYS = {
  TIME_BLOCKS: 'time_blocks',
  ACTIVE_BLOCK: 'active_block',
  EVENTS: 'events',
} as const;
