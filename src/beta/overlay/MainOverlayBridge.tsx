import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Button } from '@/components/ui/button';
import { nativeOverlayWindow } from './native-port';
import { useBetaInputSendMode } from '../input-preferences';
import { useBetaOverlayEnabled, useBetaTheme } from '../preferences';

/** Main is a Native workspace client: it updates application preferences and
 * observes commits. It never selects the overlay's profile implicitly,
 * publishes business snapshots, executes overlay
 * tickets, lends controllers, or revokes the workspace when its view leaves. */
export function MainOverlayBridge({ profileId, onCommitted }: { profileId: string; onCommitted: () => void }) {
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const enabled = useBetaOverlayEnabled(), theme = useBetaTheme(), inputSendMode = useBetaInputSendMode();
  const [systemDark,setSystemDark]=useState(()=>typeof matchMedia==='function'&&matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(()=>{if(typeof matchMedia!=='function')return;const media=matchMedia('(prefers-color-scheme: dark)'),changed=()=>setSystemDark(media.matches);media.addEventListener('change',changed);return()=>media.removeEventListener('change',changed);},[]);
  const resolvedTheme=theme==='system'?(systemDark?'dark':'light'):theme;
  const previous = useRef<Promise<void> | null>(null), notify = useRef(onCommitted); notify.current = onCommitted;
  const desktop = isTauri() && !/Android|iPhone|iPad/i.test(navigator.userAgent);
  useEffect(() => {
    if (!desktop) return;
    let active = true; const prior = previous.current;
    const binding = (async () => {
      if (prior) await prior.catch(() => {}); if (!active) return;
      await invoke('beta_workspace_preferences', { theme: resolvedTheme, inputSendMode });
      if (active && enabled) await nativeOverlayWindow({ kind: 'show' });
      if (active) setError('');
    })();
    previous.current = binding;
    void binding.catch(failure => { if (active) setError(failure instanceof Error ? failure.message : '本机工作区暂未确认'); });
    return () => { active = false; };
  }, [desktop, resolvedTheme, inputSendMode, enabled, attempt]);
  useEffect(() => {
    if (!desktop) return; let active = true, unlisten: (() => void) | undefined;
    void listen<{ profile_id: string }>('beta-workspace-committed', event => { if (active && event.payload?.profile_id === profileId) notify.current(); })
      .then(remove => { if (active) unlisten = remove; else remove(); }).catch(failure=>{if(active)setError(failure instanceof Error?failure.message:'本机工作区订阅尚未确认');});
    return () => { active = false; unlisten?.(); };
  }, [desktop, profileId]);
  if (!desktop || !error) return null;
  return <div className="flex flex-wrap items-center gap-2 px-3 py-1 text-xs text-secondary"><span role="alert" className="text-destructive">{error}</span><Button size="sm" variant="outline" onClick={() => setAttempt(value => value + 1)}>重试本机工作区</Button></div>;
}
