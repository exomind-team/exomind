import { useCallback, useState } from 'react';

export interface ContextMenuState {
  kind: 'goal' | 'edge' | 'me';
  id: string;
  x: number;
  y: number;
}

export function useContextMenu() {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const openContextMenu = useCallback((next: ContextMenuState) => {
    setContextMenu(next);
  }, []);

  return {
    contextMenu,
    openContextMenu,
    closeContextMenu,
  };
}
