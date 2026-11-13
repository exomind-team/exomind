import { useEffect, useState } from 'react';

/** Date omission depends on wall time, including waking across midnight. */
export function useBetaNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function refresh() {
      clearTimeout(timer);
      const current = Date.now(); setNow(current);
      timer = setTimeout(refresh, 60_000 - (current % 60_000));
    }
    function visible() { if (!document.hidden) refresh(); }
    refresh();
    window.addEventListener('focus', refresh); window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', refresh); window.removeEventListener('pageshow', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
  return now;
}
