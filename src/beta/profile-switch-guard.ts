export type ProfileSwitchGuard = () => Promise<void>;
type Binding = Readonly<{ prepare: ProfileSwitchGuard }>;

/** Writer-owned readiness shared with presentation. Removing an observer never
 * unbinds the writer; only the owner of the current binding can release it. */
export class ProfileSwitchGuardGate {
  private binding: Binding | null = null;
  private readonly listeners = new Set<() => void>();

  get current(): ProfileSwitchGuard | null { return this.binding?.prepare ?? null; }
  snapshot = (): Binding | null => this.binding;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  bind(prepare: ProfileSwitchGuard): () => void {
    const binding = Object.freeze({ prepare });
    this.binding = binding;
    this.notify();
    return () => {
      if (this.binding !== binding) return;
      this.binding = null;
      this.notify();
    };
  }
  private notify(): void { for (const listener of this.listeners) listener(); }
}
