import { useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriWindow } from '@/config/runtime-target';

export function useTauriFullscreenShortcut(): void {
  const togglingRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !isTauriWindow()) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== 'F11') return;

      event.preventDefault();

      if (togglingRef.current) {
        return;
      }

      togglingRef.current = true;

      void (async () => {
        try {
          const currentWindow = getCurrentWindow();
          const fullscreen = await currentWindow.isFullscreen();
          await currentWindow.setFullscreen(!fullscreen);
        } catch {
          // Ignore fullscreen toggle failures to avoid breaking unrelated keyboard flows.
        } finally {
          togglingRef.current = false;
        }
      })();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);
}
