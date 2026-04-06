export type TiledLayout = '1x1' | '1x2' | '2x2' | '2x4';

export const TILED_LAYOUT_MAX_PANES: Record<TiledLayout, number> = {
  '1x1': 1,
  '1x2': 2,
  '2x2': 4,
  '2x4': 8,
};

export const VALID_TILED_LAYOUTS = new Set<TiledLayout>(['1x1', '1x2', '2x2', '2x4']);
