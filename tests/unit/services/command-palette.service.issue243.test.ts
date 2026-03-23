import { describe, expect, it } from 'vitest';
import { CommandPaletteServiceImpl } from '@/lib/services/command-palette.service';

describe('command palette service issue-243（面板状态机）', () => {
  it('opens and closes with query reset（打开关闭并重置查询）', () => {
    const service = new CommandPaletteServiceImpl();

    service.open('set');
    expect(service.getState()).toEqual({
      open: true,
      query: 'set',
      highlightedIndex: 0,
    });

    service.close();
    expect(service.getState()).toEqual({
      open: false,
      query: '',
      highlightedIndex: 0,
    });
  });

  it('moves highlighted index within list range（高亮索引在列表范围内循环）', () => {
    const service = new CommandPaletteServiceImpl();
    service.open();

    service.moveHighlight(1, 3);
    expect(service.getState().highlightedIndex).toBe(1);

    service.moveHighlight(1, 3);
    expect(service.getState().highlightedIndex).toBe(2);

    service.moveHighlight(1, 3);
    expect(service.getState().highlightedIndex).toBe(0);
  });

  it('resets highlight when query changes（查询变更重置高亮）', () => {
    const service = new CommandPaletteServiceImpl();
    service.open();
    service.setHighlightedIndex(2);

    service.setQuery('tasks');
    expect(service.getState().query).toBe('tasks');
    expect(service.getState().highlightedIndex).toBe(0);
  });
});
