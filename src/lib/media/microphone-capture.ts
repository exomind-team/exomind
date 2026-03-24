export const PREFERRED_AUDIO_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
] as const;

export const DEFAULT_RECORDING_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
};

export type CreateMediaRecorder = (
  stream: MediaStream,
  options?: MediaRecorderOptions
) => MediaRecorder;

export type CreateCompatibleMediaRecorderOptions = {
  createRecorder?: CreateMediaRecorder;
  isTypeSupported?: (mimeType: string) => boolean;
};

function getErrorName(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'object' && 'name' in error) {
    return String((error as { name?: unknown }).name ?? '');
  }
  return '';
}

function isConstraintCompatibilityError(error: unknown): boolean {
  const name = getErrorName(error);
  return name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError' || name === 'TypeError';
}

function getDefaultMediaRecorderFactory(): CreateMediaRecorder {
  return (stream, options) => {
    if (typeof MediaRecorder === 'undefined') {
      throw new Error('MediaRecorder is not available in this runtime');
    }

    return options ? new MediaRecorder(stream, options) : new MediaRecorder(stream);
  };
}

function resolveTypeSupportChecker(
  isTypeSupported?: (mimeType: string) => boolean
): ((mimeType: string) => boolean) | null {
  if (isTypeSupported) {
    return isTypeSupported;
  }

  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return null;
  }

  return (mimeType) => MediaRecorder.isTypeSupported(mimeType);
}

export function pickSupportedAudioMimeType(
  isTypeSupported?: (mimeType: string) => boolean
): string | null {
  const checker = resolveTypeSupportChecker(isTypeSupported);
  if (!checker) {
    return null;
  }

  for (const mimeType of PREFERRED_AUDIO_MIME_TYPES) {
    if (checker(mimeType)) {
      return mimeType;
    }
  }

  return null;
}

export function createCompatibleMediaRecorder(
  stream: MediaStream,
  options: CreateCompatibleMediaRecorderOptions = {}
): { recorder: MediaRecorder; mimeType: string | null } {
  const createRecorder = options.createRecorder ?? getDefaultMediaRecorderFactory();
  const preferredMimeType = pickSupportedAudioMimeType(options.isTypeSupported);

  if (preferredMimeType) {
    try {
      const recorder = createRecorder(stream, { mimeType: preferredMimeType });
      return {
        recorder,
        mimeType: recorder.mimeType || preferredMimeType,
      };
    } catch {
      // Some Android WebView runtimes report support but still fail on constructor options.
      // （部分 Android WebView 声称支持但构造时仍会失败，故回退默认构造）
    }
  }

  const recorder = createRecorder(stream);
  return {
    recorder,
    mimeType: recorder.mimeType || preferredMimeType,
  };
}

export async function getUserMediaWithConstraintFallback(
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>,
  preferredConstraints: MediaStreamConstraints = { audio: DEFAULT_RECORDING_AUDIO_CONSTRAINTS }
): Promise<MediaStream> {
  try {
    return await getUserMedia(preferredConstraints);
  } catch (error) {
    const isBasicAudioRequest =
      preferredConstraints.audio === true &&
      (preferredConstraints.video === undefined || preferredConstraints.video === false);

    if (isBasicAudioRequest || !isConstraintCompatibilityError(error)) {
      throw error;
    }

    // Retry with minimal constraints for compatibility on Android WebView.
    // （回退到最小约束，兼容部分 Android WebView）
    return getUserMedia({ audio: true });
  }
}
