import { useEffect, useMemo, useRef, useState } from 'react';
import { Command, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getCommandPaletteService } from '@/lib/services/command-palette.service';
import { getCommandRegistryService } from '@/lib/services/command-registry.service';
import type { CommandCandidate, CommandContext } from '@/lib/types/command-palette';

interface CommandPaletteProps {
  context: CommandContext;
}

export function CommandPalette({ context }: CommandPaletteProps) {
  const paletteService = useMemo(() => getCommandPaletteService(), []);
  const commandRegistry = useMemo(() => getCommandRegistryService(), []);
  const [paletteState, setPaletteState] = useState(() => paletteService.getState());
  const [errorMessage, setErrorMessage] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return paletteService.subscribe(setPaletteState);
  }, [paletteService]);

  const commands = useMemo(() => {
    return commandRegistry.search(paletteState.query, context);
  }, [commandRegistry, context, paletteState.query]);

  useEffect(() => {
    if (!paletteState.open) {
      setErrorMessage('');
      return;
    }

    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [paletteState.open]);

  useEffect(() => {
    if (!paletteState.open) {
      return;
    }

    if (commands.length === 0 && paletteState.highlightedIndex !== -1) {
      paletteService.setHighlightedIndex(-1);
      return;
    }

    if (commands.length > 0 && (paletteState.highlightedIndex < 0 || paletteState.highlightedIndex >= commands.length)) {
      paletteService.setHighlightedIndex(0);
    }
  }, [commands.length, paletteService, paletteState.highlightedIndex, paletteState.open]);

  useEffect(() => {
    if (!paletteState.open || paletteState.highlightedIndex < 0 || commands.length === 0) {
      return;
    }

    const activeItem = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    activeItem?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });
  }, [commands, paletteState.highlightedIndex, paletteState.open]);

  const highlighted = paletteState.highlightedIndex >= 0
    ? commands[paletteState.highlightedIndex] ?? null
    : null;

  const executeCommand = async (command: CommandCandidate | null) => {
    if (!command || !command.available) {
      return;
    }

    const result = await commandRegistry.execute(command.id, undefined, context);
    if (result.ok) {
      setErrorMessage('');
      paletteService.close();
      return;
    }

    setErrorMessage(result.message);
  };

  if (!paletteState.open) {
    return null;
  }

  return (
    <div
      data-testid="command-palette-overlay"
      className="absolute inset-0 z-50 flex items-start justify-center bg-black/35 px-4 pt-16"
      onClick={() => paletteService.close()}
    >
      <section
        className="w-full max-w-[360px] overflow-hidden rounded-2xl border border-[#E7E5E4] bg-[#FAF7F5] shadow-[0_20px_50px_-24px_rgba(0,0,0,0.45)] dark:border-[#292524] dark:bg-[#0C0A09]"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[#E7E5E4] px-3 py-2 dark:border-[#292524]">
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-[#44403C] dark:text-[#E7E5E4]">
            <Command size={14} />
            命令面板
          </div>
          <button
            type="button"
            aria-label="关闭命令面板"
            onClick={() => paletteService.close()}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[#78716C] transition-colors hover:bg-[#EDECE9] dark:text-[#A8A29E] dark:hover:bg-[#292524]"
          >
            <X size={14} />
          </button>
        </header>

        <div className="border-b border-[#E7E5E4] px-3 py-2 dark:border-[#292524]">
          <label className="flex items-center gap-2 rounded-xl border border-[#E7E5E4] bg-white px-3 py-2 dark:border-[#292524] dark:bg-[#1C1917]">
            <Search size={14} className="text-[#A8A29E]" />
            <input
              ref={inputRef}
              type="text"
              value={paletteState.query}
              data-testid="command-palette-input"
              placeholder="输入命令，如：设置 / tasks / 目标"
              className="w-full bg-transparent text-sm text-[#1C1917] outline-none placeholder:text-[#A8A29E] dark:text-[#FAFAF9]"
              onChange={(event) => {
                paletteService.setQuery(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  paletteService.close();
                  return;
                }

                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  paletteService.moveHighlight(1, commands.length);
                  return;
                }

                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  paletteService.moveHighlight(-1, commands.length);
                  return;
                }

                if (event.key === 'Enter') {
                  event.preventDefault();
                  void executeCommand(highlighted);
                }
              }}
            />
          </label>
        </div>

        <div
          ref={listRef}
          className="max-h-[320px] overflow-y-auto p-2"
          data-testid="command-palette-list"
        >
          {commands.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#D6D3D1] px-3 py-4 text-center text-xs text-[#A8A29E] dark:border-[#3A3432] dark:text-[#B8B1AC]">
              未找到匹配命令
            </div>
          ) : (
            <ul className="space-y-1">
              {commands.map((command, index) => {
                const active = index === paletteState.highlightedIndex;

                return (
                  <li key={command.id}>
                    <button
                      type="button"
                      data-active={active ? 'true' : undefined}
                      data-testid={`command-palette-item-${command.id}`}
                      disabled={!command.available}
                      onClick={() => {
                        void executeCommand(command);
                      }}
                      className={cn(
                        'w-full rounded-xl border px-3 py-2 text-left transition-colors',
                        active
                          ? 'border-[#F2C2B2] bg-[#FFF7F2] dark:border-[#6D3C30] dark:bg-[#2A1A14]'
                          : 'border-transparent bg-transparent',
                        command.available
                          ? 'text-[#1C1917] hover:bg-[#F5F0ED] dark:text-[#FAFAF9] dark:hover:bg-[#1C1917]'
                          : 'cursor-not-allowed text-[#A8A29E] dark:text-[#78716C]'
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{command.title}</span>
                        <span className="text-[10px] uppercase tracking-wide text-[#A8A29E]">
                          {command.category}
                        </span>
                      </div>
                      {command.description ? (
                        <p className="mt-0.5 text-xs text-[#A8A29E] dark:text-[#78716C]">{command.description}</p>
                      ) : null}
                      {!command.available && command.reason ? (
                        <p className="mt-1 text-xs text-[#DC2626] dark:text-[#FCA5A5]">{command.reason}</p>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {errorMessage ? (
          <footer className="border-t border-[#E7E5E4] px-3 py-2 text-xs text-[#DC2626] dark:border-[#292524] dark:text-[#FCA5A5]">
            {errorMessage}
          </footer>
        ) : null}
      </section>
    </div>
  );
}
