interface SyncChangeDoc {
  _id?: unknown;
}

interface SyncChangePayload {
  direction?: unknown;
  change?: {
    docs?: SyncChangeDoc[];
  };
  docs?: SyncChangeDoc[];
}

export function shouldSkipSyncRefresh(change: unknown): boolean {
  if (!change || typeof change !== 'object') {
    return false;
  }

  const payload = change as SyncChangePayload;

  if (typeof payload.direction === 'string' && payload.direction === 'push') {
    return true;
  }

  const changeDocs = payload.change?.docs;
  const docs = Array.isArray(changeDocs)
    ? changeDocs
    : (Array.isArray(payload.docs) ? payload.docs : []);

  if (docs.length > 0) {
    const checkpointOnly = docs.every((doc) => typeof doc?._id === 'string' && doc._id.startsWith('_local/'));
    if (checkpointOnly) {
      return true;
    }
  }

  return false;
}
