/**
 * Environment - 共享物理世界
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

import type { IASRPort } from './interfaces/asr.port';
import type { IEventLogPort } from './interfaces/eventlog.port';
import type { IMePort } from './interfaces/me.port';
import type { IStoragePort } from './interfaces/storage.port';
import type { ITaskPort } from './interfaces/task.port';
import { createRuntimeBootstrap, type RuntimeKind } from './bootstrap';

/**
 * Environment 接口
 * 定义向上层（Service/L3）暴露的能力
 */
export interface Environment {
  /** 语音识别能力 */
  asr: IASRPort;
  /** 存储能力 */
  storage: IStoragePort;
  /** 事件日志能力 */
  eventlog: IEventLogPort;
  /** 任务能力 */
  task: ITaskPort;
  /** Me 页面能力 */
  me: IMePort;
  /** 运行时类型 */
  runtime: RuntimeKind;
}

/**
 * Environment 实现
 */
export class ExoMindEnvironment implements Environment {
  asr: IASRPort;
  storage: IStoragePort;
  eventlog: IEventLogPort;
  task: ITaskPort;
  me: IMePort;
  runtime: RuntimeKind;

  private static instance: ExoMindEnvironment | null = null;

  private constructor(runtime?: RuntimeKind) {
    const bootstrap = createRuntimeBootstrap({ runtime });
    this.runtime = bootstrap.runtime;
    this.asr = bootstrap.asr;
    this.storage = bootstrap.storage;
    this.eventlog = bootstrap.eventlog;
    this.task = bootstrap.task;
    this.me = bootstrap.me;
    console.log(`[Environment] ExoMindEnvironment 初始化完成: ${this.runtime}`);
  }

  /**
   * 获取单例实例
   */
  static getInstance(): ExoMindEnvironment {
    if (!ExoMindEnvironment.instance) {
      ExoMindEnvironment.instance = new ExoMindEnvironment();
    }
    return ExoMindEnvironment.instance;
  }

  /**
   * 测试辅助：清理单例
   */
  static resetForTests(): void {
    ExoMindEnvironment.instance = null;
  }

  /**
   * 检查能力是否可用
   */
  capabilities(): Record<string, boolean> {
    return {
      asr: this.asr.isAvailable(),
      storage: true,
      eventlog: true,
      task: true,
      me: true,
    };
  }
}
