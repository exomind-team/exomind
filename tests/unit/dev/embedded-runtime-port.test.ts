import { describe, expect, it, vi } from 'vitest';
import {
  normalizeReservedPorts,
  resolveEmbeddedRuntimePort,
} from '../../../scripts/dev/embedded-runtime-port';

describe('embedded runtime port resolver（内嵌 Runtime 端口解析）', () => {
  it('normalizes reserved ports and drops invalid values（保留端口去重并过滤非法值）', () => {
    expect(
      normalizeReservedPorts(['43636', 43637, 'bad', 0, 65536, 43636, undefined, null]),
    ).toEqual([43636, 43637]);
  });

  it('skips reserved candidates before probing availability（探测可用性前先跳过保留候选端口）', async () => {
    const isPortAvailable = vi.fn(async (port: number) => port === 1950);

    const resolved = await resolveEmbeddedRuntimePort({
      candidatePorts: [9124, 1950, 1949],
      reservedPorts: [9124, 43636, 43637],
      isPortAvailable,
      findRandomPort: vi.fn(async () => 48200),
    });

    expect(resolved).toBe(1950);
    expect(isPortAvailable).toHaveBeenCalledTimes(1);
    expect(isPortAvailable).toHaveBeenCalledWith(1950);
  });

  it('retries random fallback when OS returns a reserved port（随机回退拿到保留端口时应重试）', async () => {
    const findRandomPort = vi
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(43637)
      .mockResolvedValueOnce(48200);

    const resolved = await resolveEmbeddedRuntimePort({
      candidatePorts: [9124],
      reservedPorts: [43636, 43637],
      isPortAvailable: vi.fn(async () => false),
      findRandomPort,
    });

    expect(resolved).toBe(48200);
    expect(findRandomPort).toHaveBeenCalledTimes(2);
  });
});
