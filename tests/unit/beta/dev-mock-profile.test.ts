import { describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import type { BetaCommand } from '@/beta/client';
import { createBetaMockProfile } from '@/beta/dev-mock-profile';
import { isBetaMockProfileRequested } from '@/beta/dev-mock-mode';

function ids() {
  let value = 1;
  return () => `10000000-0000-4000-8000-${String(value++).padStart(12, '0')}`;
}

function sha256Hex(bytes: Uint8Array): string {
  return Array.from(sha256(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

describe('Beta in-memory mock profile', () => {
  it('is available only through the explicit development URL flag', () => {
    expect(isBetaMockProfileRequested('?mock=1', true)).toBe(true);
    expect(isBetaMockProfileRequested('?mock=1', false)).toBe(false);
    expect(isBetaMockProfileRequested('?mock=true', true)).toBe(false);
    expect(isBetaMockProfileRequested('', true)).toBe(false);
  });

  it('accepts focused client overrides for feature-specific front-end scenarios', async () => {
    const capture = async (command: BetaCommand) => ({
      command_id: command.command_id, event_id: command.event_id, profile_id: command.profile_id,
      local_seq: 1, event_digest: 'b'.repeat(64), durability: 'local_committed' as const, replayed: false,
    });
    const makeId = ids();
    const mock = createBetaMockProfile({ idFactory: makeId, seedTexts: [], clientOverrides: { capture } });
    const command = { command_id: makeId(), event_id: makeId(), profile_id: mock.profileId, occurred_at_ms: 1, text: 'override', tags: [] };
    await expect(mock.client.capture(command)).resolves.toMatchObject({ event_digest: 'b'.repeat(64) });
    expect((await mock.client.eventsPage(mock.profileId, { limit: 10 })).items).toHaveLength(0);
  });

  it('seeds a synthetic profile and keeps captured events in that instance only', async () => {
    const now = 1_765_000_000_000;
    const makeId = ids();
    const first = createBetaMockProfile({ idFactory: makeId, now: () => now, seedTexts: ['合成起始记录'] });
    const profiles = await first.client.profiles();
    expect(profiles).toEqual([{ profile_id: first.profileId, display_name: '前端测试档案（内存）' }]);
    const status = await first.client.status();
    expect(status.device_id).toBe(first.deviceId);
    expect(status.runtime_id).toBe(first.runtimeId);
    expect(status.capabilities?.originals).toBe(true);
    expect(status.capabilities?.timeblocks).toBe(true);

    const command = {
      command_id: makeId(), event_id: makeId(), profile_id: first.profileId,
      occurred_at_ms: now, text: '焦点回归的合成消息', tags: ['mock'],
    };
    const receipt = await first.client.capture(command);
    expect(receipt.event_id).toBe(command.event_id);
    expect((await first.client.eventsPage(first.profileId, { limit: 10 })).items.map(event => event.text))
      .toEqual(['焦点回归的合成消息', '合成起始记录']);

    const refreshed = createBetaMockProfile({ idFactory: ids(), now: () => now, seedTexts: ['合成起始记录'] });
    expect((await refreshed.client.eventsPage(refreshed.profileId, { limit: 10 })).items.map(event => event.text))
      .toEqual(['合成起始记录']);
  });

  it('runs timeblock commands against an isolated in-memory projection', async () => {
    const makeId = ids();
    const mock = createBetaMockProfile({ idFactory: makeId, now: () => 1_765_000_000_000, seedTexts: [] });
    const timeblocks = mock.client.timeblocks!;
    const before = await timeblocks.snapshot(mock.profileId);
    const blockId = makeId();
    await timeblocks.command({
      command_id: makeId(), event_id: makeId(), profile_id: mock.profileId, expected_revision: before.revision,
      action: { kind: 'start', block_id: blockId, name: '前端测试块', note: '只在内存中', timer: { mode: 'count_up' } },
    });
    const after = await timeblocks.snapshot(mock.profileId);
    expect(after.active).toMatchObject({ block_id: blockId, name: '前端测试块', phase: 'running' });
    const timeline = await mock.client.timelinePage!(mock.profileId, { limit: 10 });
    expect(timeline.items.some(item => item.kind === 'timeblock' && item.record.event_id === after.heads[0])).toBe(true);
  });

  it('stages and verifies file bytes in memory', async () => {
    const makeId = ids();
    const mock = createBetaMockProfile({ idFactory: makeId, now: () => 1_765_000_000_000, seedTexts: [] });
    const bytes = new TextEncoder().encode('synthetic attachment');
    const originalId = makeId();
    const stageId = makeId();
    const begin = {
      stage_id: stageId, original_id: originalId, profile_id: mock.profileId,
      expected_sha256: sha256Hex(bytes), byte_length: bytes.length, file_name: 'mock.txt', media_type: 'text/plain',
    };
    await mock.client.originals!.begin(begin);
    await mock.client.originals!.write(mock.profileId, stageId, 0, bytes);
    const verified = await mock.client.originals!.verify(mock.profileId, stageId);
    expect(verified.state).toBe('verified');
    expect(await mock.client.originals!.readOriginal(mock.profileId, originalId, 0, bytes.length)).toEqual(bytes);
  });
});
