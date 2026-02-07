import { SyncMessage } from './websocket-client';

export interface Conflict {
  entity: string;
  localChange: SyncMessage;
  remoteChange: SyncMessage;
}

export class ConflictResolution {
  resolve(conflict: Conflict): SyncMessage {
    const localTime = conflict.localChange.timestamp;
    const remoteTime = conflict.remoteChange.timestamp;

    if (localTime > remoteTime) {
      return conflict.localChange;
    } else if (remoteTime > localTime) {
      return conflict.remoteChange;
    } else {
      const localId = conflict.localChange.deviceId;
      const remoteId = conflict.remoteChange.deviceId;
      return localId > remoteId ? conflict.localChange : conflict.remoteChange;
    }
  }
}

export const conflictResolution = new ConflictResolution();
