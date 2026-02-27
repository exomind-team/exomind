import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CommandPalette } from '@/ui/app/components/CommandPalette';
import type { CommandContext } from '@/lib/types/command-palette';

type PaletteState = {
  open: boolean;
  query: string;
  highlightedIndex: number;
};

const mocks = vi.hoisted(() => {
  const listeners = new Set<(state: PaletteState) => void>();
  const initialState: PaletteState = {
    open: false,
    query: '',
    highlightedIndex: 0,
  };

  let state: PaletteState = { ...initialState };

  const emit = () => {
    for (const listener of listeners) {
      listener(state);
    }
  };

  const paletteService = {
    getState: () => state,
    subscribe: (listener: (next: PaletteState) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    open: (initialQuery = '') => {
      state = {
        open: true,
        query: initialQuery,
        highlightedIndex: 0,
      };
      emit();
    },
    close: () => {
      state = { ...initialState };
      emit();
    },
    toggle: (initialQuery = '') => {
      if (state.open) {
        paletteService.close();
        return;
      }
      paletteService.open(initialQuery);
    },
    setQuery: (query: string) => {
      state = {
        ...state,
        query,
        highlightedIndex: 0,
      };
      emit();
    },
    setHighlightedIndex: (index: number) => {
      state = {
        ...state,
        highlightedIndex: Math.max(-1, Math.trunc(index)),
      };
      emit();
    },
    moveHighlight: (delta: number, itemCount: number) => {
      if (itemCount <= 0) {
        paletteService.setHighlightedIndex(-1);
        return;
      }
      const baseIndex = state.highlightedIndex < 0 ? 0 : state.highlightedIndex;
      const nextIndex = (baseIndex + delta + itemCount) % itemCount;
      paletteService.setHighlightedIndex(nextIndex);
    },
  };

  return {
    paletteService,
    commands: [
      {
        id: 'navigate:now',
        title: '打开当下',
        description: '跳转到当下页面',
        category: 'navigation',
        permissionTier: 'safe',
        aliases: ['now'],
        keywords: ['eventlog'],
        available: true,
        score: 10,
      },
      {
        id: 'navigate:tasks',
        title: '打开任务',
        description: '跳转到任务页面',
        category: 'navigation',
        permissionTier: 'safe',
        aliases: ['tasks'],
        keywords: ['todo'],
        available: true,
        score: 9,
      },
      {
        id: 'navigate:settings',
        title: '打开设置',
        description: '跳转到设置页面',
        category: 'navigation',
        permissionTier: 'safe',
        aliases: ['settings'],
        keywords: ['config'],
        available: true,
        score: 8,
      },
    ],
    execute: vi.fn(async () => ({ ok: true as const })),
  };
});

vi.mock('@/lib/services/command-palette.service', () => ({
  getCommandPaletteService: () => mocks.paletteService,
}));

vi.mock('@/lib/services/command-registry.service', () => ({
  getCommandRegistryService: () => ({
    search: () => mocks.commands,
    execute: mocks.execute,
  }),
}));

describe('command palette scroll sync issue-243（高亮项滚动同步）', () => {
  const context: CommandContext = {
    currentPath: '/tasks',
    platform: 'web',
    developerModeEnabled: true,
    commandPaletteEnabled: true,
    featureFlags: {
      agentPageEnabled: true,
      goalsV2Enabled: false,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.paletteService.close();
    mocks.paletteService.open('');
  });

  it('scrolls highlighted item into view when arrow navigation changes focus（键盘切换高亮时触发滚动）', async () => {
    const scrollIntoViewMock = vi.mocked(Element.prototype.scrollIntoView);
    render(<CommandPalette context={context} />);

    const input = await screen.findByTestId('command-palette-input');
    await waitFor(() => {
      expect(scrollIntoViewMock).toHaveBeenCalled();
      expect(screen.getByTestId('command-palette-item-navigate:now')).toHaveAttribute('data-active', 'true');
    });

    const beforeMoveCalls = scrollIntoViewMock.mock.calls.length;
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    await waitFor(() => {
      expect(screen.getByTestId('command-palette-item-navigate:tasks')).toHaveAttribute('data-active', 'true');
      expect(scrollIntoViewMock.mock.calls.length).toBeGreaterThan(beforeMoveCalls);
    });

    const lastCallOptions = scrollIntoViewMock.mock.calls.at(-1)?.[0] as ScrollIntoViewOptions | undefined;
    expect(lastCallOptions).toMatchObject({
      block: 'nearest',
      inline: 'nearest',
    });
  });
});
