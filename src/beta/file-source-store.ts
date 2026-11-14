import { sha256 } from '@noble/hashes/sha2.js';
import { BetaApiError } from './client';
import { ORIGINAL_CHUNK_BYTES } from './original-types';

/** Browser-local byte copies. put resolves on transaction completion, not on
 * request success. Metadata/commands are stored separately in the draft cache. */
export interface FileSourceStore {
  put(key: string, source: Blob): Promise<void>;
  resume?(key: string): Promise<void>;
  get(key: string): Promise<FileSource | null>;
  remove(key: string, expected?: FileSource): Promise<void>;
  close?(): void;
}
export interface RangeFileSource { readonly size: number; readonly sha256?: string; read(offset: number, length: number): Promise<Uint8Array> }
export type FileSource = Blob | RangeFileSource;
export async function readFileSource(source: FileSource, offset: number, length: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > ORIGINAL_CHUNK_BYTES || !Number.isSafeInteger(offset + length) || offset + length > source.size) throw new BetaApiError('source_incomplete', '原件范围无效，尚未发送');
  const bytes = 'read' in source ? await source.read(offset, length) : new Uint8Array(await source.slice(offset, offset + length).arrayBuffer());
  if (bytes.length !== length) throw new BetaApiError('source_incomplete', '本机原件范围未完整读取，尚未发送');
  return bytes;
}

export function sourceKey(deviceId: string, profileId: string, id: string): string {
  return JSON.stringify([deviceId, profileId, id]);
}

export async function hashFileSource(source: FileSource, cancelled: () => boolean = () => false): Promise<string> {
  if (!Number.isSafeInteger(source.size) || source.size < 0) throw new BetaApiError('source_incomplete', '原件长度无效，尚未发送');
  const hash = sha256.create();
  for (let offset = 0; offset < source.size; offset += ORIGINAL_CHUNK_BYTES) {
    if (cancelled()) throw new BetaApiError('inactive_session', '当前记录窗口已关闭，原件仍保留在暂存中');
    const end = Math.min(source.size, offset + ORIGINAL_CHUNK_BYTES);
    const bytes = await readFileSource(source, offset, end - offset);
    if (bytes.length !== end - offset) throw new BetaApiError('source_incomplete', '本机原件副本未完整读取，请重新选择');
    hash.update(bytes);
  }
  if (cancelled()) throw new BetaApiError('inactive_session', '当前记录窗口已关闭，原件仍保留在暂存中');
  const digest = Array.from(hash.digest(), byte => byte.toString(16).padStart(2, '0')).join('');
  if ('sha256' in source && source.sha256 !== undefined && source.sha256 !== digest) throw new BetaApiError('source_corrupt', '本机原件与已确认校验不同，旧副本已保留，尚未发送');
  return digest;
}

export class IndexedDbFileSourceStore implements FileSourceStore {
  private database: Promise<IDBDatabase> | undefined;
  private closed = false;
  private open(): Promise<IDBDatabase> {
    if (this.closed) return Promise.reject(new BetaApiError('inactive_session', '原件暂存窗口已关闭'));
    if (!this.database) {
      this.database = new Promise((resolve, reject) => {
        if (!globalThis.indexedDB) { reject(new BetaApiError('source_store_unavailable', '当前环境不支持原件持久暂存，请保留源文件')); return; }
        const request = indexedDB.open('exomind-beta-file-sources', 1);
        request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('sources')) request.result.createObjectStore('sources'); };
        request.onerror = () => reject(new BetaApiError('source_store_unavailable', '无法打开原件暂存库，请保留源文件后重试'));
        request.onblocked = () => reject(new BetaApiError('source_store_unavailable', '另一窗口正在更新原件暂存库，请关闭后重试'));
        request.onsuccess = () => {
          const database = request.result;
          database.onversionchange = () => { database.close(); this.database = undefined; };
          if (this.closed) { database.close(); reject(new BetaApiError('inactive_session', '原件暂存窗口已关闭')); }
          else resolve(database);
        };
      });
      void this.database.catch(() => { this.database = undefined; });
    }
    return this.database;
  }

  private async transaction<T>(write: boolean, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      let result: T;
      let transaction: IDBTransaction;
      try {
        transaction = write ? database.transaction('sources', 'readwrite', { durability: 'strict' }) : database.transaction('sources', 'readonly');
        const request = action(transaction.objectStore('sources'));
        request.onsuccess = () => { result = request.result; };
      } catch {
        reject(new BetaApiError('source_store_unavailable', '原件未能复制到本机暂存，请保留源文件后重试')); return;
      }
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(new BetaApiError('source_store_failed', '原件暂存失败，可能空间不足或权限受限；本次文件尚未就绪'));
      transaction.onabort = () => reject(new BetaApiError('source_store_failed', '原件暂存未完成，原选择已保留，请重新选择或移除'));
    });
  }
  async put(key: string, source: Blob): Promise<void> { await this.transaction(true, store => store.put(source.slice(), key)); }
  async get(key: string): Promise<Blob | null> {
    const value: unknown = await this.transaction(false, store => store.get(key));
    if (value === undefined) return null;
    if (!(value instanceof Blob)) throw new BetaApiError('source_corrupt', '原件暂存内容无法识别，请重新选择');
    return value;
  }
  async remove(key: string): Promise<void> { await this.transaction(true, store => store.delete(key)); }
  close(): void { this.closed = true; void this.database?.then(database => database.close()).catch(() => {}); }
}
