/**
 * Adapters - 导出
 */
export { WebStorageAdapter } from './web-storage.js';
export { PouchSyncAdapter, createPouchSyncAdapter } from './pouch-sync.js';
export {
  deriveKeyFromPassword,
  generateSalt,
  encryptAes256,
  decryptAes256,
  sha256,
  quickEncrypt,
  quickDecrypt,
  hashPasswordWithSalt,
  verifyPassword,
} from './crypto-adapter.js';

// ASR Adapters (stub implementations - pending full migration)
export {
  MossASRAdapter,
  VolcanoHTTPASRAdapter,
  VolcanoEngineASRAdapter,
} from './asr/index.js';
