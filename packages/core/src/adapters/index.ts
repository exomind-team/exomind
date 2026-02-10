/**
 * Adapters - 导出
 */
export { WebStorageAdapter } from './web-storage';
export { PouchSyncAdapter, createPouchSyncAdapter } from './pouch-sync';
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
} from './crypto-adapter';

// ASR Adapters (stub implementations - pending full migration)
export {
  MossASRAdapter,
  VolcanoHTTPASRAdapter,
  VolcanoEngineASRAdapter,
} from './asr';
