interface GoalContextMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

interface GoalContextMenuProps {
  x: number;
  y: number;
  items: GoalContextMenuItem[];
  onClose: () => void;
}

export function GoalContextMenu({ x, y, items, onClose }: GoalContextMenuProps) {
  return (
    <div
      data-testid="goal-context-menu"
      className="absolute z-30 min-w-[180px] overflow-hidden rounded-lg border border-[#E7E5E4] bg-white py-1 shadow-lg dark:border-[#292524] dark:bg-[#1C1917]"
      style={{ left: x, top: y }}
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
