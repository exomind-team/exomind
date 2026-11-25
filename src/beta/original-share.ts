import { BetaApiError } from './api-error';

export type BetaOriginalShareOutcome = 'system_chooser_opened' | 'cancelled';

export interface BetaOriginalSharer {
  /** Resolve only after Native has verified the original and opened Android's share chooser. */
  share(profileId: string, originalId: string, requestId: string): Promise<BetaOriginalShareOutcome>;
  /** Cancel the exact request while Native is still preparing the verified copy. */
  cancel(requestId: string): Promise<boolean>;
}

type Call = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export function nativeOriginalSharer(call: Call, cancelCall: Call = call): BetaOriginalSharer {
  return {
    async share(profileId, originalId, requestId) {
      const outcome = await call<unknown>('beta_share_original', { profileId, originalId, requestId });
      if (outcome === 'system_chooser_opened' || outcome === 'cancelled') return outcome;
      throw new BetaApiError('invalid_share_result', '系统分享结果无法确认；原件保持不变，请检查系统界面');
    },
    async cancel(requestId) {
      const accepted = await cancelCall<unknown>('beta_cancel_original_share', { requestId });
      if (typeof accepted !== 'boolean') {
        throw new BetaApiError('invalid_share_cancel_result', '分享取消状态无法确认；原件保持不变，请检查系统界面');
      }
      return accepted;
    },
  };
}
