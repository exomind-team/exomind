export const DEFAULT_VOICE_OVERLAY_TEXT_LIMIT = 100;

export function trimToLatestCharacters(
  text: string,
  maxCharacters: number = DEFAULT_VOICE_OVERLAY_TEXT_LIMIT,
): string {
  const normalized = text.trim();
  if (!normalized || maxCharacters <= 0) {
    return '';
  }

  const characters = Array.from(normalized);
  if (characters.length <= maxCharacters) {
    return normalized;
  }

  return characters.slice(characters.length - maxCharacters).join('');
}
