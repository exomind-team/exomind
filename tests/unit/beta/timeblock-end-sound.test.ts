import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BetaTimeblockSnapshot } from '@/beta/timeblocks-types';
import { observeBetaTimeblockEnd, playBetaTimeblockEndSound, resolveBetaTimeblockEndCue } from '@/beta/timeblock-end-sound';
import { getTimerPreferences, updateTimerPreferences } from '@/config/timer-preferences';

const audioDescriptor=Object.getOwnPropertyDescriptor(globalThis,'Audio');
afterEach(()=>{if(audioDescriptor)Object.defineProperty(globalThis,'Audio',audioDescriptor);else Reflect.deleteProperty(globalThis,'Audio');localStorage.clear();});

function snapshot(active: BetaTimeblockSnapshot['active'], revision: number): BetaTimeblockSnapshot {
  return {
    profile_id: 'profile-a', revision: String(revision), heads: [], active, pending_feedback: [],
    clock: { server_now_ms: revision, epoch_changed: false, wall_clock_moved_back: false },
  };
}

function countdown(overrides: Partial<NonNullable<BetaTimeblockSnapshot['active']>> = {}): NonNullable<BetaTimeblockSnapshot['active']> {
  return {
    block_id: 'block-a', name: '专注工作', note: '完成设计稿', timer: { mode: 'count_down', duration_ms: 60_000, end_mode: 'soft' },
    phase: 'running', work_ms: 60_000, deadline_reached: false,
    deadline: { deadline_id: 'deadline-a', generation: 2, owner_device_id: 'device-a', owner_generation: 3,
      due_at_ms: 60_000, remaining_ms: 0, end_mode: 'soft', eligible: true },
    ...overrides,
  };
}

describe('Beta timeblock end sound ownership', () => {
  it('creates a cue only when the same countdown crosses its deadline', () => {
    const before = snapshot(countdown(), 1);
    const due = snapshot(countdown({ deadline_reached: true, phase: 'completed' }), 2);
    expect(resolveBetaTimeblockEndCue(before, due)).toMatchObject({
      profileId: 'profile-a', blockId: 'block-a', deadlineId: 'deadline-a', generation: 2,
      name: '专注工作', note: '完成设计稿',
    });
    expect(resolveBetaTimeblockEndCue(snapshot(null, 0), due)).toBeNull();
    expect(resolveBetaTimeblockEndCue(before, snapshot(countdown({ phase: 'completed' }), 2))).toBeNull();
    expect(resolveBetaTimeblockEndCue(before, snapshot(countdown({ block_id: 'block-b', deadline_reached: true }), 2))).toBeNull();
  });

  it('uses an initial completed snapshot only as baseline and alerts once across repeated views', () => {
    let state = snapshot(countdown(), 1);
    const listeners = new Set<() => void>();
    const owner = {
      snapshot: () => ({ remote: state }),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    } as never;
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = observeBetaTimeblockEnd(owner, first);
    const stopSecond = observeBetaTimeblockEnd(owner, second);

    state = snapshot(countdown({ deadline_reached: true, phase: 'completed' }), 2);
    listeners.forEach(listener => listener());
    listeners.forEach(listener => listener());

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    stopFirst(); stopSecond();
  });

  it('does not replay a deadline that was already reached when the client opened', () => {
    let state = snapshot(countdown({ deadline_reached: true, phase: 'completed' }), 1);
    const listeners = new Set<() => void>();
    const owner = {
      snapshot: () => ({ remote: state }),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    } as never;
    const onCue = vi.fn();
    observeBetaTimeblockEnd(owner, onCue);
    state = snapshot(countdown({ deadline_reached: true, phase: 'completed' }), 2);
    listeners.forEach(listener => listener());
    expect(onCue).not.toHaveBeenCalled();
  });

  it('uses the configured in-app sound and honors its independent off switch',async()=>{
    const instances:Array<{url:string;play:ReturnType<typeof vi.fn>}>=[];
    class MockAudio{
      loop=false;preload='';currentTime=0;play=vi.fn(async()=>{});
      constructor(url:string){instances.push({url,play:this.play});}
    }
    Object.defineProperty(globalThis,'Audio',{configurable:true,value:MockAudio});
    updateTimerPreferences({countdownEndSoundEnabled:true});
    await expect(playBetaTimeblockEndSound()).resolves.toBe('played');
    expect(instances).toHaveLength(1);
    expect(instances[0].url.length).toBeGreaterThan(0);
    expect(instances[0].play).toHaveBeenCalledTimes(1);

    updateTimerPreferences({countdownEndSoundEnabled:false});
    await expect(playBetaTimeblockEndSound()).resolves.toBe('disabled');
    expect(instances).toHaveLength(1);
    expect(getTimerPreferences().countdownEndSoundEnabled).toBe(false);
  });
});
