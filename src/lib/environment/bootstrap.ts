import { VolcanoEngineASRAdapter } from '../adapters/asr/volcano-engine-asr';
import { WebEventLogStorageAdapter } from '../adapters/web-eventlog-storage';
import { WebStorageAdapter } from '../adapters/web-storage';
import type { IASRPort } from './interfaces/asr.port';
import type { IEventLogPort } from './interfaces/eventlog.port';
import type { IStoragePort } from './interfaces/storage.port';

export type RuntimeKind = 'web' | 'tauri';

export interface RuntimeBootstrapResult {
  runtime: RuntimeKind;
  asr: IASRPort;
  storage: IStoragePort;
  eventlog: IEventLogPort;
}

export interface RuntimeBootstrapOptions {
  runtime?: RuntimeKind;
  globalObject?: unknown;
}

/**
 * Tauri 存储适配器占位实现
 *
 * 当前沿用 WebStorageAdapter 能力，
 * 后续 Task 将替换为真正的 Tauri 存储实现。
 */
export class TauriStorageAdapter extends WebStorageAdapter {}

/**
 * 运行时检测：优先检测 Tauri 注入标记
 */
export function detectRuntime(globalObject: unknown = globalThis): RuntimeKind {
  const runtime = globalObject as {
    __TAURI__?: unknown;
    window?: { __TAURI__?: unknown };
  };

  if (runtime?.__TAURI__ !== undefined || runtime?.window?.__TAURI__ !== undefined) {
    return 'tauri';
  }

  return 'web';
}

export function createRuntimeBootstrap(options: RuntimeBootstrapOptions = {}): RuntimeBootstrapResult {
  const runtime = options.runtime ?? detectRuntime(options.globalObject);
  const asr = new VolcanoEngineASRAdapter();

  if (runtime === 'tauri') {
    return {
      runtime,
      asr,
      storage: new TauriStorageAdapter(),
      // 临时统一到 PouchDB，避免 Tauri 原生 EventLog 与 UI 读取源分裂（#144）
      eventlog: new WebEventLogStorageAdapter(),
    };
  }

  return {
    runtime,
    asr,
    storage: new WebStorageAdapter(),
    eventlog: new WebEventLogStorageAdapter(),
  };
}
