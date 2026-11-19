import { describe, expect, it, vi } from 'vitest';
import { ProfileSwitchGuardGate } from '@/beta/profile-switch-guard';

describe('writer-owned profile switch readiness', () => {
  it('publishes binding changes without executing the writer operation', () => {
    const gate = new ProfileSwitchGuardGate(), changed = vi.fn(), prepare = vi.fn(async () => {});
    gate.subscribe(changed);
    expect(gate.snapshot()).toBeNull();
    const release = gate.bind(prepare);
    expect(gate.current).toBe(prepare);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(prepare).not.toHaveBeenCalled();
    release();
    expect(gate.snapshot()).toBeNull();
    expect(changed).toHaveBeenCalledTimes(2);
  });
  it('preserves a replacement binding when an earlier owner releases the same function', () => {
    const gate = new ProfileSwitchGuardGate(), prepare = async () => {};
    const oldRelease = gate.bind(prepare), replacementRelease = gate.bind(prepare);
    const replacement = gate.snapshot();
    oldRelease();
    expect(gate.snapshot()).toBe(replacement);
    expect(gate.current).toBe(prepare);
    replacementRelease();
    expect(gate.current).toBeNull();
  });
  it('keeps the writer bound when its presentation observer unsubscribes', async () => {
    const gate = new ProfileSwitchGuardGate(), prepare = vi.fn(async () => {}), changed = vi.fn();
    const release = gate.bind(prepare), unsubscribe = gate.subscribe(changed);
    unsubscribe();
    await gate.current?.();
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(gate.snapshot()).not.toBeNull();
    release();
    expect(changed).not.toHaveBeenCalled();
  });
});
