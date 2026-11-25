import { getTimerEndSoundPresetById } from '@/lib/media/timer-end-sounds';
import { getTimerPreferences } from '@/config/timer-preferences';
import type { BetaTimeblockSnapshot } from './timeblocks-types';
import type { BetaTimeblockController } from './timeblocks-controller';

export interface BetaTimeblockEndCue {
  key: string;
  profileId: string;
  blockId: string;
  deadlineId: string | null;
  generation: number | null;
  name: string;
  note: string;
}

type TimeblockSnapshotOwner = Pick<BetaTimeblockController, 'snapshot' | 'subscribe'>;
const seenByOwner = new WeakMap<object, Set<string>>();
const MAX_SEEN_ALERTS = 128;

/** A sound belongs to a running countdown crossing its deadline. A manual end,
 * profile load, repeated snapshot or another block's late result is not a new cue. */
export function resolveBetaTimeblockEndCue(
  previous: BetaTimeblockSnapshot,
  current: BetaTimeblockSnapshot,
): BetaTimeblockEndCue | null {
  if (previous.profile_id !== current.profile_id) return null;
  const before = previous.active;
  const after = current.active;
  if (!before || !after || before.block_id !== after.block_id
    || before.timer.mode !== 'count_down' || after.timer.mode !== 'count_down'
    || before.deadline_reached || !after.deadline_reached) return null;

  const deadlineId = after.deadline?.deadline_id ?? null;
  const generation = after.deadline?.generation ?? null;
  const key = JSON.stringify([current.profile_id, after.block_id, deadlineId, generation]);
  return {
    key,
    profileId: current.profile_id,
    blockId: after.block_id,
    deadlineId,
    generation,
    name: after.name.trim() || '未命名时间块',
    note: after.note,
  };
}

/** One observer lives with the Beta device/profile data owner, not a visible
 * focus pane. The per-owner receipt set also fences a second view of the same
 * controller from playing the same deadline twice. */
export function observeBetaTimeblockEnd(
  owner: TimeblockSnapshotOwner,
  onCue: (cue: BetaTimeblockEndCue) => void,
): () => void {
  let previous = owner.snapshot().remote;
  let initialized = previous !== null;
  let seen = seenByOwner.get(owner as object);
  if (!seen) {
    seen = new Set<string>();
    seenByOwner.set(owner as object, seen);
  }

  const observe = () => {
    const current = owner.snapshot().remote;
    if (!current) return;
    if (!initialized) {
      previous = current;
      initialized = true;
      return;
    }
    if (!previous) {
      previous = current;
      return;
    }
    const cue = resolveBetaTimeblockEndCue(previous, current);
    previous = current;
    if (!cue || seen!.has(cue.key)) return;
    seen!.add(cue.key);
    while (seen!.size > MAX_SEEN_ALERTS) seen!.delete(seen!.values().next().value!);
    onCue(cue);
  };

  const unsubscribe = owner.subscribe(observe);
  observe();
  return unsubscribe;
}

export async function playBetaTimeblockEndSound(): Promise<'disabled' | 'played'> {
  const preferences = getTimerPreferences();
  if (!preferences.countdownEndSoundEnabled) return 'disabled';
  const preset = getTimerEndSoundPresetById(preferences.countdownEndSoundPresetId);
  const audio = new Audio(preset.url);
  audio.loop = false;
  audio.preload = 'auto';
  audio.currentTime = 0;
  await audio.play();
  return 'played';
}
