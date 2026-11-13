import { BetaApiError } from './api-error';
import { ORIGINAL_CHUNK_BYTES, type BetaBeginStage, type BetaOriginal, type BetaOriginalClient, type BetaStage } from './original-types';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BetaApiError('invalid_stage', '文件暂存响应无效');
  return value as Record<string, unknown>;
}
export function validateOriginal(value: unknown): BetaOriginal {
  const item = object(value);
  if (typeof item.original_id !== 'string' || !item.original_id || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256)
    || !Number.isSafeInteger(item.byte_length) || Number(item.byte_length) < 0 || typeof item.file_name !== 'string' || typeof item.media_type !== 'string') {
    throw new BetaApiError('invalid_stage', '文件描述无效');
  }
  return item as unknown as BetaOriginal;
}
export function validateStage(value: unknown, profileId: string, stageId: string, expected?: BetaBeginStage): BetaStage {
  const item = object(value); const original = validateOriginal(item.original);
  if (item.profile_id !== profileId || item.stage_id !== stageId || !['uploading','frozen','verified','hash_mismatch'].includes(String(item.state))
    || !Number.isSafeInteger(item.next_offset) || Number(item.next_offset) < 0 || Number(item.next_offset) > original.byte_length
    || !Number.isSafeInteger(item.generation) || Number(item.generation) <= 0
    || (item.state !== 'uploading' && item.next_offset !== original.byte_length)
    || (expected && (original.original_id !== expected.original_id || original.sha256 !== expected.expected_sha256 || original.byte_length !== expected.byte_length || original.file_name !== expected.file_name || original.media_type !== expected.media_type))) {
    throw new BetaApiError('invalid_stage', '文件暂存与本次档案或内容不一致');
  }
  return item as unknown as BetaStage;
}
function range(offset: number, length: number): void {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0 || length > ORIGINAL_CHUNK_BYTES) throw new BetaApiError('invalid_original_range', '文件读取范围无效');
}
function chunk(offset: number, bytes: Uint8Array): void {
  if (!Number.isSafeInteger(offset) || offset < 0 || !bytes.length || bytes.length > ORIGINAL_CHUNK_BYTES) throw new BetaApiError('invalid_chunk', '文件分块大小或位置无效');
}
function nativeBytes(value: unknown, offset: number, length: number, originalId?: string): Uint8Array {
  const item = object(value); const original = validateOriginal(item.original);
  if (item.offset !== offset || !Array.isArray(item.bytes) || offset > original.byte_length
    || item.bytes.length !== Math.min(length, original.byte_length-offset)
    || (originalId && original.original_id !== originalId)
    || !item.bytes.every(byte=>Number.isInteger(byte)&&byte>=0&&byte<=255)) throw new BetaApiError('invalid_original_range', '文件分块回读不一致');
  return Uint8Array.from(item.bytes);
}

type NativeCall = <T>(name: string, args?: Record<string, unknown>) => Promise<T>;
export function nativeOriginalClient(call: NativeCall): BetaOriginalClient {
  return {
    async begin(command) { return validateStage(await call('beta_begin_stage',{command}),command.profile_id,command.stage_id,command); },
    async status(profileId,stageId) { return validateStage(await call('beta_stage_status',{profileId,stageId}),profileId,stageId); },
    async write(profileId,stageId,offset,bytes) { chunk(offset,bytes); return validateStage(await call('beta_write_stage_chunk',{profileId,stageId,offset,bytes:Array.from(bytes)}),profileId,stageId); },
    async verify(profileId,stageId) { return validateStage(await call('beta_verify_stage',{profileId,stageId}),profileId,stageId); },
    async readStage(profileId,stageId,offset,length) { range(offset,length); return nativeBytes(await call('beta_read_stage_range',{profileId,stageId,offset,length}),offset,length); },
    async readOriginal(profileId,originalId,offset,length) { range(offset,length); return nativeBytes(await call('beta_read_original_range',{profileId,originalId,offset,length}),offset,length,originalId); },
  };
}

export interface OriginalWebIO {
  json(profileId: string, path: string, method: string, body?: unknown): Promise<unknown>;
  binary(profileId: string, path: string, method: string, body?: Uint8Array, responseLimit?: number): Promise<unknown>;
}
export function webOriginalClient(io: OriginalWebIO): BetaOriginalClient {
  const base = (profileId: string,stageId: string) => `/profiles/${encodeURIComponent(profileId)}/stages/${encodeURIComponent(stageId)}`;
  return {
    async begin(command) {
      const {stage_id,profile_id,...metadata}=command;
      return validateStage(await io.json(profile_id,base(profile_id,stage_id),'PUT',metadata),profile_id,stage_id,command);
    },
    async status(profileId,stageId) { return validateStage(await io.json(profileId,base(profileId,stageId),'GET'),profileId,stageId); },
    async write(profileId,stageId,offset,bytes) { chunk(offset,bytes); return validateStage(await io.binary(profileId,`${base(profileId,stageId)}/chunks?offset=${offset}`,'PUT',bytes),profileId,stageId); },
    async verify(profileId,stageId) { return validateStage(await io.json(profileId,`${base(profileId,stageId)}/verify`,'POST'),profileId,stageId); },
    async readStage(profileId,stageId,offset,length) { range(offset,length); return await io.binary(profileId,`${base(profileId,stageId)}/bytes?offset=${offset}&length=${length}`,'GET',undefined,length) as Uint8Array; },
    async readOriginal(profileId,originalId,offset,length) { range(offset,length); return await io.binary(profileId,`/profiles/${encodeURIComponent(profileId)}/originals/${encodeURIComponent(originalId)}/bytes?offset=${offset}&length=${length}`,'GET',undefined,length) as Uint8Array; },
  };
}

export async function boundedOriginalBody(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.headers.get('Content-Type')?.startsWith('application/octet-stream')) throw new BetaApiError('invalid_original_range','文件读取响应类型无效');
  const declared=response.headers.get('Content-Length');
  if (declared!==null && (!/^\d+$/.test(declared)||Number(declared)>limit)) throw new BetaApiError('invalid_original_range','文件读取超出请求范围');
  if (!response.body) return new Uint8Array();
  const reader=response.body.getReader(); const parts: Uint8Array[]=[]; let total=0;
  try {
    for (;;) {
      const result=await reader.read(); if(result.done) break;
      total+=result.value.byteLength;
      if(total>limit) {await reader.cancel();throw new BetaApiError('invalid_original_range','文件读取超出请求范围');}
      parts.push(result.value);
    }
  } finally {reader.releaseLock();}
  const bytes=new Uint8Array(total); let offset=0;
  for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  return bytes;
}
