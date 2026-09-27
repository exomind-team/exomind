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
import type { IAgentPort } from './interfaces/agent.port';
import type { IClipboardPort } from './interfaces/clipboard.port';
import type { IEventLogPort } from './interfaces/eventlog.port';
import type { IStoragePort } from './interfaces/storage.port';
import type { ITaskPort } from './interfaces/task.port';
import { createRuntimeBootstrap, type RuntimeKind } from './bootstrap';
import { getUseMockDataEnabled } from '@/config/mock-data';
import { log } from '@/lib/logger';

/**
 * Environment 接口
 * 定义向上层（Service/L3）暴露的能力
 */
export interface Environment {
  /** 语音识别能力 */
  asr: IASRPort;
  /** 剪贴板读取能力 */
  clipboard: IClipboardPort;
  /** 存储能力 */
  storage: IStoragePort;
  /** 事件日志能力 */
  eventlog: IEventLogPort;
  /** 任务能力 */
  task: ITaskPort;
  /** Agent Hub 能力 */
  agent: IAgentPort;
  /** 运行时类型 */
  runtime: RuntimeKind;
}

/**
 * Environment 实现
 */
export class ExoMindEnvironment implements Environment {
  asr: IASRPort;
  clipboard: IClipboardPort;
  storage: IStoragePort;
  eventlog: IEventLogPort;
  task: ITaskPort;
  agent: IAgentPort;
  runtime: RuntimeKind;
  private useMockDataEnabled: boolean;

  private static instance: ExoMindEnvironment | null = null;

  private constructor(runtime?: RuntimeKind) {
    const useMockDataEnabled = getUseMockDataEnabled();
    const bootstrap = createRuntimeBootstrap({ runtime, useMockData: useMockDataEnabled });
    this.runtime = bootstrap.runtime;
    this.asr = bootstrap.asr;
    this.clipboard = bootstrap.clipboard;
    this.storage = bootstrap.storage;
    this.eventlog = bootstrap.eventlog;
    this.task = bootstrap.task;
    this.agent = bootstrap.agent;
    this.useMockDataEnabled = useMockDataEnabled;
    log.info(`[Environment] ExoMindEnvironment 初始化完成: ${this.runtime}`);
  }

  // Runtime sync（运行时同步）: 切换 mock-data 开关后，刷新与数据源相关的 adapter。
  private refreshDataAdaptersIfNeeded(): void {
    const nextUseMockDataEnabled = getUseMockDataEnabled();
    if (nextUseMockDataEnabled === this.useMockDataEnabled) {
      return;
    }

    const bootstrap = createRuntimeBootstrap({
      runtime: this.runtime,
      useMockData: nextUseMockDataEnabled,
    });
    this.task = bootstrap.task;
    this.agent = bootstrap.agent;
    this.useMockDataEnabled = nextUseMockDataEnabled;
  }

  /**
   * 获取单例实例
   */
  static getInstance(): ExoMindEnvironment {
    if (!ExoMindEnvironment.instance) {
      ExoMindEnvironment.instance = new ExoMindEnvironment();
    }
    ExoMindEnvironment.instance.refreshDataAdaptersIfNeeded();
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
      clipboard: this.clipboard.isAvailable(),
      storage: true,
      eventlog: true,
      task: true,
      me: true,
      agent: true,
    };
  }
}
