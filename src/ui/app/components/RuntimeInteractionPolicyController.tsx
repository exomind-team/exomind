import { useEffect } from 'react';
import type { UiInteractionPolicy } from '@/config/runtime-target';
import { resolveUiInteractionPolicy } from '@/config/runtime-target';

const APP_LIKE_SELECTION_CLASS = 'exomind-app-like-selection';

export function RuntimeInteractionPolicyController({
  policy = resolveUiInteractionPolicy(),
}: {
  policy?: UiInteractionPolicy;
}) {
  const {
    useAppLikeTextSelection,
    suppressDefaultBrowserContextMenu,
  } = policy;

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.body.classList.toggle(
      APP_LIKE_SELECTION_CLASS,
      useAppLikeTextSelection,
    );

    if (!suppressDefaultBrowserContextMenu) {
      return () => {
        document.body.classList.remove(APP_LIKE_SELECTION_CLASS);
      };
    }

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    document.addEventListener('contextmenu', handleContextMenu);

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.body.classList.remove(APP_LIKE_SELECTION_CLASS);
    };
  }, [suppressDefaultBrowserContextMenu, useAppLikeTextSelection]);

  return null;
}
