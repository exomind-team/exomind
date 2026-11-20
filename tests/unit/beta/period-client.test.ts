import { describe, expect, it, vi } from 'vitest';
import type { BetaStatus } from '@/beta/client';
import { webTimeblockFeatures } from '@/beta/timeblocks-client';

const page = { items: [], highwater: 42, next_before: null };
const status: BetaStatus = {
  protocol: 'exomind-beta/1',
  device_id: '11111111-1111-4111-8111-111111111111',
  runtime_id: '22222222-2222-4222-8222-222222222222',
  running: true,
  capabilities: { timeblocks: true, typed_timeline: true, timeline_period: true },
};

function client() {
  const identity = vi.fn(async () => status);
  const json = vi.fn(
    async (_profileId: string, _path: string, _method: string, _body?: unknown): Promise<unknown> => page,
  );
  return { features: webTimeblockFeatures({ identity, json }), identity, json };
}

describe('bounded period timeline client', () => {
  it('sends the local-time half-open window and combined search/tag to the period endpoint', async () => {
    const { features, json } = client();
    const query = {
      from_ms: 1_770_000_000_000,
      to_ms: 1_770_086_400_000,
      limit: 100,
      search: "中文%_'",
      tag: 'focus',
    };

    await features.timelinePeriodPage('profile-a', query);

    expect(json).toHaveBeenCalledTimes(1);
    const [profileId, path, method] = json.mock.calls[0]!;
    expect(profileId).toBe('profile-a');
    expect(method).toBe('GET');
    const [pathname, encoded] = path.split('?');
    expect(pathname).toBe('/profiles/profile-a/timeline/period');
    expect(Object.fromEntries(new URLSearchParams(encoded))).toEqual({
      from_ms: String(query.from_ms),
      to_ms: String(query.to_ms),
      limit: '100',
      q: query.search,
      tag: query.tag,
    });
    expect(json.mock.calls.some(([, requestPath]) => requestPath.includes('/timeblocks/intervals'))).toBe(false);
  });

  it('pins before/through and keeps filters on older period pages', async () => {
    const { features, json } = client();
    const query = {
      from_ms: 1_770_000_000_000,
      to_ms: 1_770_086_400_000,
      before: 19,
      through: 42,
      limit: 100,
      search: 'needle',
      tag: 'focus',
    };

    await features.timelinePeriodPage('profile-a', query);

    const [, path] = json.mock.calls[0]!;
    const params = new URLSearchParams(path.split('?')[1]);
    expect(params.get('before')).toBe('19');
    expect(params.get('through')).toBe('42');
    expect(params.get('q')).toBe('needle');
    expect(params.get('tag')).toBe('focus');
    expect(params.get('from_ms')).toBe(String(query.from_ms));
    expect(params.get('to_ms')).toBe(String(query.to_ms));
  });

  it('leaves the existing unbounded compatibility timeline URL unchanged', async () => {
    const { features, json } = client();

    await features.timelinePage('profile-a', { limit: 100, search: 'needle' });

    expect(json.mock.calls[0]?.[1]).toBe('/profiles/profile-a/timeline?limit=100&q=needle');
  });
});
