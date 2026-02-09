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
import { VolcanoEngineASRAdapter } from '../adapters/asr/volcano-engine-asr';

/**
 * Environment 接口
 * 定义向上层（Service/L3）暴露的能力
 */
export interface Environment {
  /** 语音识别能力 */
  asr: IASRPort;
}

/**
 * Environment 实现
 */
export class ExoMindEnvironment implements Environment {
  asr: IASRPort;

  private static instance: ExoMindEnvironment | null = null;

  private constructor() {
    // 初始化各个 Port
    this.asr = new VolcanoEngineASRAdapter();
    console.log('[Environment] ExoMindEnvironment 初始化完成');
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
   * 检查能力是否可用
   */
  capabilities(): Record<string, boolean> {
    return {
      asr: this.asr.isAvailable(),
    };
  }
}
