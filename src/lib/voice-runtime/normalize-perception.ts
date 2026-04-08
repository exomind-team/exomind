import type {
  NormalizedVoicePerception,
  ProviderRawPerception,
} from './types';

interface AsrResultLike {
  text?: string;
  is_interim?: boolean;
  confidence?: number;
}

function readAsrResults(payload: Record<string, unknown>): AsrResultLike[] {
  const results = payload.results;
  if (!Array.isArray(results)) {
    return [];
  }

  return results.filter((item): item is AsrResultLike => {
    if (typeof item !== 'object' || item === null) {
      return false;
    }
    const record = item as Record<string, unknown>;
    return typeof record.text === 'string' && record.text.trim().length > 0;
  });
}

export function normalizeVoiceRuntimePerception(
  rawPerception: ProviderRawPerception,
  traceId: string,
): NormalizedVoicePerception | null {
  if (rawPerception.eventType !== 'ASRResponse') {
    return null;
  }

  const [firstResult] = readAsrResults(rawPerception.payload);
  if (!firstResult?.text?.trim()) {
    return null;
  }

  return {
    traceId,
    provider: 'doubao-o2-realtime',
    transcript: firstResult.text.trim(),
    isFinal: firstResult.is_interim !== true,
    confidence: typeof firstResult.confidence === 'number' ? firstResult.confidence : undefined,
    providerMeta: rawPerception.payload,
  };
}
