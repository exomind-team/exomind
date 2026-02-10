/**
 * Mock PouchDB for Testing
 *
 * Provides mock implementations of PouchDB.Database and PouchDB.replicate()
 * for unit testing PouchSyncAdapter without real database connections.
 */

/**
 * Mock Replication object returned by PouchDB.replicate()
 */
export class MockReplication<T = unknown> {
  private changeCallbacks: ((info: { docs_written?: number }) => void)[] = [];
  private errorCallbacks: ((err: { message?: string }) => void)[] = [];
  private cancelled = false;

  on(event: 'change' | 'error', callback: (info: { docs_written?: number } | { message?: string }) => void): this {
    if (event === 'change') {
      this.changeCallbacks.push(callback as (info: { docs_written?: number }) => void);
    } else if (event === 'error') {
      this.errorCallbacks.push(callback as (err: { message?: string }) => void);
    }
    return this;
  }

  cancel(): void {
    this.cancelled = true;
  }

  // Trigger change event (for testing)
  triggerChange(docsWritten = 0): void {
    if (!this.cancelled) {
      this.changeCallbacks.forEach(cb => cb({ docs_written: docsWritten }));
    }
  }

  // Trigger error event (for testing)
  triggerError(message = 'Mock error'): void {
    if (!this.cancelled) {
      this.errorCallbacks.forEach(cb => cb({ message }));
    }
  }

  isCancelled(): boolean {
    return this.cancelled;
  }
}

/**
 * Mock PouchDB Database
 *
 * Simulates basic PouchDB operations for testing:
 * - put(doc): Insert or update a document
 * - get(id): Retrieve a document
 * - allDocs(opts): Get all documents
 * - close(): Close the database
 * - changes(opts): Listen for changes
 */
export class MockPouchDB {
  private docs: Map<string, unknown> = new Map();
  private changesListeners: Map<string, ((change: { id: string; doc?: unknown }) => void)[]> = new Map();
  public readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Insert or update a document
   */
  async put(doc: { _id: string; _rev?: string; [key: string]: unknown }): Promise<{
    ok: boolean;
    id: string;
    rev: string;
  }> {
    const existing = this.docs.get(doc._id);
    const existingRev = existing ? (existing as { _rev?: string })._rev : undefined;

    // Simple revision generation
    const revNum = existingRev ? parseInt(existingRev.split('-')[0], 10) + 1 : 1;
    const newRev = `${revNum}-${Date.now()}`;

    this.docs.set(doc._id, { ...doc, _rev: newRev });

    // Notify changes listeners
    const listeners = this.changesListeners.get('change') || [];
    listeners.forEach(cb => cb({ id: doc._id, doc }));

    return { ok: true, id: doc._id, rev: newRev };
  }

  /**
   * Get a document by ID
   */
  async get(id: string, _opts?: { rev?: string }): Promise<unknown> {
    const doc = this.docs.get(id);
    if (!doc) {
      const error = new Error('not_found') as Error & { status?: number };
    }
    return doc;
  }

  /**
   * Get all documents
   */
  async allDocs(opts?: {
    include_docs?: boolean;
    conflicts?: boolean;
  }): Promise<{
    rows: Array<{ id: string; doc?: unknown; key: string; value: { rev: string } }>;
  }> {
    const rows = Array.from(this.docs.entries()).map(([id, doc]) => ({
      id,
      key: id,
      value: { rev: (doc as { _rev?: string })._rev || '1-0' },
      ...(opts?.include_docs ? { doc } : {}),
    }));
    return { rows };
  }

  /**
   * Query view (simplified)
   */
  async query(_view: string, _opts?: unknown): Promise<{
    rows: Array<{ id: string; value: unknown; key: unknown }>;
  }> {
    // Simplified implementation
    return { rows: [] };
  }

  /**
   * Close the database
   */
  async close(): Promise<void> {
    this.docs.clear();
    this.changesListeners.clear();
  }

  /**
   * Listen for changes
   */
  changes(opts: { since?: string; live?: boolean; include_docs?: boolean }): {
    on: (event: string, callback: (change: { id: string; doc?: unknown }) => void) => void;
    cancel: () => void;
  } {
    const eventName = 'change';
    const listeners = this.changesListeners.get(eventName) || [];
    listeners.push(() => {}); // Placeholder
    this.changesListeners.set(eventName, listeners);

    return {
      on: (event, callback) => {
        if (event === eventName) {
          const existing = this.changesListeners.get(event) || [];
          this.changesListeners.set(event, [...existing, callback]);
        }
      },
      cancel: () => {
        this.changesListeners.delete(eventName);
      },
    };
  }

  /**
   * Get document count (helper for testing)
   */
  getDocCount(): number {
    return this.docs.size;
  }

  /**
   * Check if document exists (helper for testing)
   */
  hasDoc(id: string): boolean {
    return this.docs.has(id);
  }

  /**
   * Get all documents (helper for testing)
   */
  getAllDocs(): Map<string, unknown> {
    return new Map(this.docs);
  }
}

/**
 * Mock PouchDB.replicate() function
 *
 * Simulates replication between two databases.
 * Returns a MockReplication object that can be used to simulate events.
 */
export function mockReplicate<T = unknown>(
  source: MockPouchDB,
  target: MockPouchDB,
  _opts?: { live?: boolean; retry?: boolean }
): MockReplication<T> {
  const replication = new MockReplication<T>();

  // Simulate async replication
  setTimeout(async () => {
    if (replication.isCancelled()) return;

    try {
      const allDocs = await source.allDocs({ include_docs: true });
      let written = 0;

      for (const row of allDocs.rows) {
        if (row.doc && !replication.isCancelled()) {
          const doc = row.doc as { _id: string };
          await target.put(doc);
          written++;
        }
      }

      // Trigger success change event
      replication.triggerChange(written);
    } catch {
      // Trigger error
      replication.triggerError('Replication failed');
    }
  }, 10);

  return replication;
}

/**
 * Mock pouchdb-adapter-idb
 *
 * Used by the adapter to register IndexedDB adapter.
 * In tests, we use MockPouchDB directly.
 */
export const pouchdbAdapterIdb = {
  idb: true,
};

/**
 * Mock PouchDB class factory
 *
 * Creates MockPouchDB instances for testing.
 */
export function createMockPouchDB(name: string): MockPouchDB {
  return new MockPouchDB(name);
}
