import { sha256 } from '@noble/hashes/sha2.js';
import { BetaApiError, type BetaClient } from './client';
import { ORIGINAL_CHUNK_BYTES, type BetaOriginal } from './original-types';

// This basic browser download intentionally has a bounded Blob allocation.
// Uploads are streamed independently; native/disk streaming export is separate.
export const MAX_BASIC_DOWNLOAD_BYTES = 64 * 1024 * 1024;
export async function collectOriginalDownload(client: BetaClient, profileId: string, original: BetaOriginal): Promise<Blob> {
  if (!Number.isSafeInteger(original.byte_length) || original.byte_length < 0 || !/^[a-f0-9]{64}$/.test(original.sha256)) throw new BetaApiError('original_integrity', '原件描述无效，未准备下载');
  if (!client.originals) throw new BetaApiError('unsupported_capability', '当前服务尚未提供原件读取');
  if (original.byte_length > MAX_BASIC_DOWNLOAD_BYTES) throw new BetaApiError('download_too_large', '当前下载入口支持 64 MiB 以内的文件；更大原件的流式导出尚未接入');
  const chunks: ArrayBuffer[] = []; const hash = sha256.create();
  if (original.byte_length === 0) {
    const empty = await client.originals.readOriginal(profileId, original.original_id, 0, 1);
    if (empty.length) throw new BetaApiError('original_integrity', '空原件返回了不匹配字节，未准备下载');
  }
  for (let offset = 0; offset < original.byte_length;) {
    const length = Math.min(ORIGINAL_CHUNK_BYTES, original.byte_length - offset);
    const bytes = await client.originals.readOriginal(profileId, original.original_id, offset, length);
    if (bytes.length !== length) throw new BetaApiError('original_incomplete', '原件读取中断，尚未准备下载，请重试');
    hash.update(bytes); chunks.push(new Uint8Array(bytes).buffer); offset += bytes.length;
  }
  const actual = Array.from(hash.digest(), byte => byte.toString(16).padStart(2, '0')).join('');
  if (actual !== original.sha256) throw new BetaApiError('original_integrity', '原件完整性校验失败，未准备下载；原始记录保持不变');
  return new Blob(chunks, { type: original.media_type || 'application/octet-stream' });
}
