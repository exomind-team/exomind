import { useEffect, useState } from 'react';

/** UI observation only. Native deadlines, durable transfers and draft owners
 * have independent lifetimes and must not be stopped by view visibility. */
export function useBetaViewActive(enabled: boolean): boolean {
  const [foreground, setForeground] = useState(() => !document.hidden);
  useEffect(() => {
    if (!enabled) return;
    const changed = () => setForeground(!document.hidden);
    changed(); document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, [enabled]);
  return enabled && foreground;
}
