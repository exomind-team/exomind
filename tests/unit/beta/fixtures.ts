import { vi } from 'vitest';
import type { BetaClient, BetaCommand, BetaReceipt, BetaPage, BetaQuery } from '@/beta/client';

export const saved = (command: BetaCommand): BetaReceipt => ({ command_id: command.command_id, event_id: command.event_id,
  profile_id: command.profile_id, local_seq: 1, event_digest: 'a'.repeat(64), durability: 'local_committed', replayed: false });
export function fakeClient() {
  return {
    status: vi.fn(async () => ({ protocol: 'exomind-beta/1', device_id: 'device-a', runtime_id: 'runtime-a', running: true })),
    profiles: vi.fn(async () => [{ profile_id: 'p', display_name: '我的档案' }, { profile_id: 'q', display_name: '另一档案' }]),
    provisionProfile: vi.fn(async (profile_id: string, display_name: string) => ({ profile_id, display_name })),
    capture: vi.fn(async (command: BetaCommand) => saved(command)),
    eventsPage: vi.fn(async (_profile: string, _query: BetaQuery): Promise<BetaPage> => ({ items: [], next_before: null, highwater: 0 })),
    receipt: vi.fn(async (_profile: string, _command: string) => null as BetaReceipt | null),
  } satisfies BetaClient;
}
export function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** Models grant reservation, callback delivery, and release as distinct turns. */
export function asyncDraftLocks() {
  const held = new Set<string>();
  const request = vi.fn((name: string, _options: { ifAvailable: boolean }, callback: (lock: Lock | null) => Promise<void>) => new Promise<void>((resolve, reject) => {
    queueMicrotask(() => {
      const granted = !held.has(name);
      if (granted) held.add(name);
      setTimeout(() => {
        // Web Locks release ownership after either callback outcome. Recovery
        // opens deliberately reject; retaining that fixture lock would prevent
        // an explicit retry even though the browser has released the real lock.
        const settle = (succeeded: boolean, failure?: unknown) => setTimeout(() => {
          if (granted) held.delete(name);
          if (succeeded) resolve(); else reject(failure);
        }, 0);
        Promise.resolve().then(() => callback(granted ? { name, mode: 'exclusive' } as Lock : null)).then(() => settle(true), failure => settle(false, failure));
      }, 0);
    });
  }));
  return { request };
}
