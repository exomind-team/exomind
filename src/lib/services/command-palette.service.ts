export interface CommandPaletteState {
  open: boolean;
  query: string;
  highlightedIndex: number;
}

type CommandPaletteListener = (state: CommandPaletteState) => void;

const INITIAL_STATE: CommandPaletteState = {
  open: false,
  query: '',
  highlightedIndex: 0,
};

export interface CommandPaletteService {
  getState(): CommandPaletteState;
  subscribe(listener: CommandPaletteListener): () => void;
  open(initialQuery?: string): void;
  close(): void;
  toggle(initialQuery?: string): void;
  setQuery(query: string): void;
  setHighlightedIndex(index: number): void;
  moveHighlight(delta: number, itemCount: number): void;
}

export class CommandPaletteServiceImpl implements CommandPaletteService {
  private state: CommandPaletteState = INITIAL_STATE;
  private listeners = new Set<CommandPaletteListener>();

  getState(): CommandPaletteState {
    return this.state;
  }

  subscribe(listener: CommandPaletteListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  open(initialQuery = ''): void {
    this.setState({
      open: true,
      query: initialQuery,
      highlightedIndex: 0,
    });
  }

  close(): void {
    this.setState(INITIAL_STATE);
  }

  toggle(initialQuery = ''): void {
    if (this.state.open) {
      this.close();
      return;
    }
    this.open(initialQuery);
  }

  setQuery(query: string): void {
    this.setState({
      ...this.state,
      query,
      highlightedIndex: 0,
    });
  }

  setHighlightedIndex(index: number): void {
    const normalizedIndex = Number.isFinite(index)
      ? Math.max(-1, Math.trunc(index))
      : 0;

    this.setState({
      ...this.state,
      highlightedIndex: normalizedIndex,
    });
  }

  moveHighlight(delta: number, itemCount: number): void {
    if (itemCount <= 0) {
      this.setHighlightedIndex(-1);
      return;
    }

    const baseIndex = this.state.highlightedIndex < 0 ? 0 : this.state.highlightedIndex;
    const nextIndex = (baseIndex + delta + itemCount) % itemCount;
    this.setHighlightedIndex(nextIndex);
  }

  private setState(nextState: CommandPaletteState): void {
    this.state = nextState;
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}

let commandPaletteServiceInstance: CommandPaletteService | null = null;

export function getCommandPaletteService(): CommandPaletteService {
  if (!commandPaletteServiceInstance) {
    commandPaletteServiceInstance = new CommandPaletteServiceImpl();
  }
  return commandPaletteServiceInstance;
}
