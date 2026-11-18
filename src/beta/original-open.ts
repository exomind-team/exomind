import { BetaApiError } from './api-error';

export interface BetaOriginalOpener {
  open(profileId: string, originalId: string, requestId: string): Promise<void>;
}
type Call = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
export function nativeOriginalOpener(call: Call): BetaOriginalOpener {
  return {
    async open(profileId, originalId, requestId) {
      const result = await call<unknown>('beta_open_original', { profileId, originalId, requestId });
      if (result !== null && result !== undefined) throw new BetaApiError('invalid_open_result', '系统打开结果尚未确认，请检查系统窗口');
    },
  };
}
