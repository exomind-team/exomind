import { getUseMockDataEnabled } from '@/config/mock-data';
import { AgentWebAdapter } from '@/lib/adapters/agent-web-adapter';
import { AgentMockAdapter } from '@/lib/adapters/mock/agent-mock-adapter';
import { TaskMockAdapter } from '@/lib/adapters/mock/task-mock-adapter';
import { TaskRtAdapter } from '@/lib/adapters/task-rt-adapter';
import { EventLogRtAdapter } from '@/lib/adapters/eventlog-rt-adapter';
import { TauriEventLogStorageAdapter } from '@/lib/adapters/tauri-eventlog-storage';
import { VolcanoEngineASRAdapter } from '../adapters/asr/volcano-engine-asr';
import { TauriClipboardAdapter } from '../adapters/clipboard-tauri-adapter';
import { WebClipboardAdapter } from '../adapters/clipboard-web-adapter';
import { WebEventLogStorageAdapter } from '../adapters/web-eventlog-storage';
import { WebStorageAdapter } from '../adapters/web-storage';
import { getEventlogBackendMode } from '@/config/domain-backend-mode';
import type { IAgentPort } from './interfaces/agent.port';
import type { IASRPort } from './interfaces/asr.port';
import type { IClipboardPort } from './interfaces/clipboard.port';
import type { IEventLogPort } from './interfaces/eventlog.port';
import type { IStoragePort } from './interfaces/storage.port';
import type { ITaskPort } from './interfaces/task.port';

export type RuntimeKind = 'web' | 'tauri';

export interface RuntimeBootstrapResult {
  runtime: RuntimeKind;
  asr: IASRPort;
  clipboard: IClipboardPort;
  storage: IStoragePort;
  eventlog: IEventLogPort;
  task: ITaskPort;
  agent: IAgentPort;
}

export interface RuntimeBootstrapOptions {
  runtime?: RuntimeKind;
  globalObject?: unknown;
  useMockData?: boolean;
}

/**
 * Tauri 存储适配器占位实现
 *
 * 当前沿用 WebStorageAdapter 能力，
 * 任务数据已改由 RT SQLite 提供真实数据源。
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
  const clipboard: IClipboardPort = runtime === 'tauri' ? new TauriClipboardAdapter() : new WebClipboardAdapter();
  const useMockData = options.useMockData ?? getUseMockDataEnabled();
  const eventlogBackendMode = runtime === 'tauri' ? getEventlogBackendMode() : 'rt-sqlite';
  const task: ITaskPort = useMockData
    ? new TaskMockAdapter()
    : new TaskRtAdapter();
  const agent: IAgentPort = useMockData ? new AgentMockAdapter() : new AgentWebAdapter();
  const eventlog: IEventLogPort = useMockData
    ? new WebEventLogStorageAdapter()
    : (
      runtime === 'tauri'
        ? (eventlogBackendMode === 'legacy'
          ? new TauriEventLogStorageAdapter()
          : new EventLogRtAdapter())
        : new EventLogRtAdapter()
    );

  if (runtime === 'tauri') {
    return {
      runtime,
      asr,
      clipboard,
      storage: new TauriStorageAdapter(),
      eventlog,
      task,
      agent,
    };
  }

  return {
    runtime,
    asr,
    clipboard,
    storage: new WebStorageAdapter(),
    eventlog,
    task,
    agent,
  };
}
