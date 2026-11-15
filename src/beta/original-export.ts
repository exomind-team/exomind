import { BetaApiError } from './api-error';

export type BetaOriginalExportResult =
  | { cancelled: true; partial_output?: boolean }
  | { cancelled: false; byte_length: number; sha256: string };
export interface BetaOriginalExportsClient {
  save(profileId: string, originalId: string, requestId: string): Promise<BetaOriginalExportResult>;
  cancel(requestId: string): Promise<boolean>;
}
type Call = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
function invalid(): never { throw new BetaApiError('invalid_export_response', '导出结果尚未确认，请检查所选保存位置'); }
export function nativeOriginalExports(call: Call): BetaOriginalExportsClient {
  return {
    async save(profileId, originalId, requestId) {
      const value: unknown = await call('beta_export_original', { profileId, originalId, requestId });
      if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
      const raw = value as Record<string, unknown>;
      if (raw.cancelled === true) {
        if (Object.keys(raw).some(key => key !== 'cancelled' && key !== 'partial_output')
            || raw.partial_output !== undefined && typeof raw.partial_output !== 'boolean') return invalid();
        return { cancelled: true, ...(raw.partial_output === undefined ? {} : { partial_output: raw.partial_output as boolean }) };
      }
      if (raw.cancelled !== false || Object.keys(raw).some(key => !['cancelled','byte_length','sha256'].includes(key))
          || !Number.isSafeInteger(raw.byte_length) || Number(raw.byte_length) < 0
          || typeof raw.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(raw.sha256)) return invalid();
      return { cancelled: false, byte_length: Number(raw.byte_length), sha256: raw.sha256 };
    },
    async cancel(requestId) {
      const value: unknown = await call('beta_cancel_original_export', { requestId });
      if (typeof value !== 'boolean') return invalid();
      return value;
    },
  };
}
