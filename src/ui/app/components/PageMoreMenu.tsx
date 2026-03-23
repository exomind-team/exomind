import { useEffect, useRef, useState } from 'react';
import { EllipsisVertical } from 'lucide-react';
import { getCommandPaletteService } from '@/lib/services/command-palette.service';
import { getDeveloperModeEnabled, subscribeDeveloperModeChanges } from '@/config/developer-mode';
import { getCommandPaletteEnabled, subscribeCommandPaletteEnabledChanges } from '@/config/command-palette-enabled';
import { getNowWorkbenchOverlayService } from '@/services/now-workbench-overlay.service';

interface PageMoreMenuProps {
  buttonClassName?: string;
  menuClassName?: string;
}

export function PageMoreMenu({ buttonClassName, menuClassName }: PageMoreMenuProps) {
  const [open, setOpen] = useState(false);
  const [developerModeEnabled, setDeveloperModeEnabled] = useState(() => getDeveloperModeEnabled());
  const [commandPaletteEnabled, setCommandPaletteEnabled] = useState(() => getCommandPaletteEnabled());
  const rootRef = useRef<HTMLDivElement | null>(null);
  const commandPaletteActive = developerModeEnabled && commandPaletteEnabled;

  useEffect(() => {
    return subscribeDeveloperModeChanges(setDeveloperModeEnabled);
  }, []);

  useEffect(() => {
    return subscribeCommandPaletteEnabledChanges(setCommandPaletteEnabled);
  }, []);

  useEffect(() => {
    if (!open) return;

    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener('mousedown', handleDocumentClick);
    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
    };
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        aria-label="更多菜单"
        onClick={() => setOpen((prev) => !prev)}
        className={buttonClassName
          ?? 'flex h-9 w-9 items-center justify-center rounded-full bg-[#F5F0ED] text-[#1C1917] dark:bg-[#292524] dark:text-[#FAFAF9]'}
      >
        <EllipsisVertical size={18} />
      </button>

      {open ? (
        <div
          role="menu"
          data-testid="page-more-menu"
          className={menuClassName
            ?? 'absolute right-0 top-11 z-30 min-w-[160px] rounded-2xl border border-[#E7E5E4] bg-white p-1.5 shadow-[0_16px_34px_-20px_rgba(0,0,0,0.45)] dark:border-[#292524] dark:bg-[#1C1917]'}
        >
          <button
            type="button"
            role="menuitem"
            data-testid="page-more-menu-open-now-workbench-overlay"
            onClick={() => {
              void getNowWorkbenchOverlayService().reopenFromMainWindow();
              setOpen(false);
            }}
            className="w-full rounded-xl px-3 py-2 text-left text-sm text-[#1C1917] hover:bg-[#F5F0ED] dark:text-[#FAFAF9] dark:hover:bg-[#292524]"
          >
            显示悬浮工作台
          </button>
          {commandPaletteActive ? (
            <button
              type="button"
              role="menuitem"
              data-testid="page-more-menu-open-command-palette"
              onClick={() => {
                getCommandPaletteService().open();
                setOpen(false);
              }}
              className="w-full rounded-xl px-3 py-2 text-left text-sm text-[#1C1917] hover:bg-[#F5F0ED] dark:text-[#FAFAF9] dark:hover:bg-[#292524]"
            >
              命令面板
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            disabled
            className="w-full rounded-xl px-3 py-2 text-left text-sm text-[#A8A29E] dark:text-[#78716C]"
          >
            待开发
          </button>
        </div>
      ) : null}
    </div>
  );
}
