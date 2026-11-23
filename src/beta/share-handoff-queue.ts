import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from './drafts';
import type { BetaShareHandoffSummary, BetaShareHandoffsClient } from './share-handoff-client';

export interface BetaShareHandoffQueueSnapshot {
  handoffs: readonly BetaShareHandoffSummary[];
  loading: boolean;
  error: string;
  /** Internal projection scope; prevents a previous profile's rows flashing during a switch. */
  profileId?: string;
}

export function isPendingBetaShareHandoff(handoff: BetaShareHandoffSummary): boolean {
  return handoff.state !== 'acknowledged'
    && (!handoff.profile_match || handoff.state === 'receiving' || handoff.state === 'interrupted' || handoff.state === 'cancelled'
      || handoff.text_state === 'ready' || handoff.text_state === 'receiving' || handoff.text_state === 'interrupted'
      || handoff.items.some(item => item.state !== 'acknowledged' && item.state !== 'cancelled'));
}

export function countPendingBetaShareHandoffs(handoffs: readonly BetaShareHandoffSummary[]): number {
  return handoffs.filter(isPendingBetaShareHandoff).length;
}

export function useBetaShareHandoffQueue(client: BetaShareHandoffsClient | null | undefined, profileId: string, onIncoming?: (handoffId: string) => void): {
  state: BetaShareHandoffQueueSnapshot;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<BetaShareHandoffQueueSnapshot>({ handoffs: [], loading: !!client && !!profileId, error: '', profileId });
  const sequence = useRef(0);
  const onIncomingRef = useRef(onIncoming); onIncomingRef.current = onIncoming;
  const seen = useRef(new Set<string>());
  const seenProfile = useRef(profileId);
  const refresh = useCallback(async () => {
    if (seenProfile.current !== profileId) {
      seenProfile.current = profileId;
      seen.current.clear();
    }
    if (!client) {
      seen.current.clear();
      setState({ handoffs: [], loading: false, error: '', profileId });
      return;
    }
    const current = ++sequence.current;
    setState(previous => ({ ...previous, loading: true, error: '', profileId }));
    try {
      // With no selected profile, Native redacts bound rows. Keep those rows
      // and unbound incoming rows so profile selection can reflect pending work.
      const listed = await client.list(profileId || undefined);
      const handoffs = profileId ? listed : listed.filter(item => item.bound_profile_id === null || !item.profile_match);
      if (current === sequence.current) {
        const pending=handoffs.filter(isPendingBetaShareHandoff);
        const newlyPending=pending.filter(handoff=>!seen.current.has(handoff.handoff_id));
        pending.forEach(handoff=>seen.current.add(handoff.handoff_id));
        if(newlyPending.length)onIncomingRef.current?.(newlyPending[0].handoff_id);
        setState({ handoffs, loading: false, error: '', profileId });
      }
    } catch (failure) {
      if (current === sequence.current) setState(previous => ({ ...previous, loading: false, error: errorMessage(failure), profileId }));
    }
  }, [client, profileId]);

  useEffect(() => {
    if (!client) {
      setState({ handoffs: [], loading: false, error: '', profileId });
      return;
    }
    let active = true;
    let unlisten: (() => void) | undefined;
    const refreshCurrent = () => { if (active) void refresh(); };
    const onVisibility = () => { if (!document.hidden) refreshCurrent(); };
    const onFocus = () => refreshCurrent();
    void refresh();
    void client.onAvailable(handoffId=>{
      if(!active)return;
      const isNew=!seen.current.has(handoffId);
      seen.current.add(handoffId);
      if(isNew)onIncomingRef.current?.(handoffId);
      refreshCurrent();
    }).then(stop => {
      if (active) unlisten = stop;
      else stop();
    }).catch(failure => {
      if (active) setState(previous => ({ ...previous, error: `系统分享提醒未接入：${errorMessage(failure)}` }));
    });
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      ++sequence.current;
      unlisten?.();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, [client, profileId, refresh]);

  const scopedState = state.profileId === profileId
    ? state
    : { handoffs: [], loading: !!client && !!profileId, error: '', profileId };
  return { state: scopedState, refresh };
}
