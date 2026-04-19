const MIGRATION_COMPLETED_KEY = 'exomind:migrationCompleted';
const MIGRATION_SKIPPED_KEY = 'exomind:migrationSkipped';
const MIGRATION_PENDING_KEY = 'exomind:migrationPending';

function getStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  if (typeof window === 'undefined') return null;
  const localStorageLike = window.localStorage as Partial<Storage> | undefined;
  if (!localStorageLike) return null;
  if (typeof localStorageLike.getItem !== 'function') return null;
  if (typeof localStorageLike.setItem !== 'function') return null;
  if (typeof localStorageLike.removeItem !== 'function') return null;
  return localStorageLike as Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}

export function isMigrationCompleted(): boolean {
  const storage = getStorage();
  if (!storage) return false;
  return storage.getItem(MIGRATION_COMPLETED_KEY) === 'true';
}

export function markMigrationCompleted(): void {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(MIGRATION_COMPLETED_KEY, 'true');
  storage.removeItem(MIGRATION_SKIPPED_KEY);
  storage.removeItem(MIGRATION_PENDING_KEY);
}

export function isMigrationSkipped(): boolean {
  const storage = getStorage();
  if (!storage) return false;
  return storage.getItem(MIGRATION_SKIPPED_KEY) === 'true';
}

export function markMigrationSkipped(): void {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(MIGRATION_SKIPPED_KEY, 'true');
}

export function clearMigrationSkipped(): void {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(MIGRATION_SKIPPED_KEY);
}

export function isMigrationPending(): boolean {
  const storage = getStorage();
  if (!storage) return false;
  return storage.getItem(MIGRATION_PENDING_KEY) === 'true';
}

export function markMigrationPending(): void {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(MIGRATION_PENDING_KEY, 'true');
}

export function clearMigrationFlags(): void {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(MIGRATION_COMPLETED_KEY);
  storage.removeItem(MIGRATION_SKIPPED_KEY);
  storage.removeItem(MIGRATION_PENDING_KEY);
}
