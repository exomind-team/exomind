import { useLayoutEffect, useRef, useState } from 'react';

interface GoalContextMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

interface GoalContextMenuProps {
  x: number;
  y: number;
  pageWidth: number;
  pageHeight: number;
  items: GoalContextMenuItem[];
  onClose: () => void;
}

const CONTEXT_MENU_MARGIN = 8;
const CONTEXT_MENU_MIN_WIDTH = 180;

export function GoalContextMenu({ x, y, pageWidth, pageHeight, items, onClose }: GoalContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    const menuWidth = Math.max(CONTEXT_MENU_MIN_WIDTH, menu?.offsetWidth ?? 0);
    const menuHeight = Math.max(0, menu?.offsetHeight ?? 0);
    const maxLeft = Math.max(CONTEXT_MENU_MARGIN, pageWidth - menuWidth - CONTEXT_MENU_MARGIN);
    const maxTop = Math.max(CONTEXT_MENU_MARGIN, pageHeight - menuHeight - CONTEXT_MENU_MARGIN);
    setPosition({
      left: Math.max(CONTEXT_MENU_MARGIN, Math.min(x, maxLeft)),
      top: Math.max(CONTEXT_MENU_MARGIN, Math.min(y, maxTop)),
    });
  }, [pageHeight, pageWidth, x, y, items.length]);

  return (
    <div
      ref={menuRef}
      data-testid="goal-context-menu"
      className="absolute z-30 min-w-[180px] overflow-hidden rounded-lg border border-[#E7E5E4] bg-white py-1 shadow-lg dark:border-[#292524] dark:bg-[#1C1917]"
      style={{ left: position.left, top: position.top }}
    >
      {items.map((item) => (
        <button
          key={item.key}
          data-testid={`goal-context-item-${item.key}`}
          type="button"
          onClick={() => {
            item.onSelect();
            onClose();
          }}
          className={`block w-full px-4 py-1.5 text-left text-xs ${item.danger ? 'text-[#C75B3A] hover:bg-[#FFF7ED] dark:text-[#FDBA74] dark:hover:bg-[#292524]' : 'text-[#1C1917] hover:bg-[#FAF7F5] dark:text-[#FAFAF9] dark:hover:bg-[#292524]'}`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
