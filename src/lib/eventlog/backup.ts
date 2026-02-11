import type { EventData } from '../types/event';

export type ImportStrategy = 'merge' | 'overwrite';

export interface EventLogBackupV1 {
  version: 1;
  exportedAt: string;
  events: EventData[];
}

const BACKUP_VERSION = 1;

function isEventData(value: unknown): value is EventData {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.timestamp === 'number' &&
    Number.isFinite(item.timestamp) &&
    typeof item.content === 'string' &&
    Array.isArray(item.tags) &&
    item.tags.every((tag) => typeof tag === 'string')
  );
}

export function createBackupPayload(events: EventData[]): EventLogBackupV1 {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    events: [...events],
  };
}

export function parseBackupPayload(raw: string): EventLogBackupV1 {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('无效的 JSON 文件');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('备份文件格式不正确');
  }

  const payload = parsed as Record<string, unknown>;

  if (payload.version !== BACKUP_VERSION) {
    throw new Error('不支持的备份版本');
  }

  if (!Array.isArray(payload.events)) {
    throw new Error('备份文件缺少 events 数组');
  }

  if (!payload.events.every(isEventData)) {
    throw new Error('备份文件中的事件数据格式不正确');
  }

  return {
    version: 1,
    exportedAt: typeof payload.exportedAt === 'string' ? payload.exportedAt : new Date().toISOString(),
    events: payload.events,
  };
}

export function mergeEventsById(existing: EventData[], incoming: EventData[]): EventData[] {
  const merged = new Map<string, EventData>();

  for (const event of existing) {
    merged.set(event.id, event);
  }

  for (const event of incoming) {
    merged.set(event.id, event);
  }

  return Array.from(merged.values()).sort((a, b) => b.timestamp - a.timestamp);
}