export const MAX_MEDIA_PREVIEW_BYTES = 16 * 1024 * 1024;

export type MediaPreviewFormat = {
  kind: 'audio' | 'video';
  mimeType: string;
};

export type MediaPreviewPlan =
  | { kind: 'supported'; format: MediaPreviewFormat }
  | { kind: 'unsupported-format'; message: string }
  | { kind: 'unsupported-browser'; format: MediaPreviewFormat; message: string }
  | { kind: 'invalid-size'; message: string }
  | { kind: 'empty'; message: string }
  | { kind: 'too-large'; message: string };

const PLAYLIST_EXTENSIONS = new Set(['asx', 'm3u', 'm3u8', 'mpcpl', 'pls', 'wpl', 'xspf']);
const PLAYLIST_MEDIA_TYPES = new Set([
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'application/pls+xml',
  'application/xspf+xml',
  'audio/mpegurl',
  'audio/x-mpegurl',
  'video/x-ms-asf',
]);

const MIME_FORMATS: Record<string, MediaPreviewFormat> = {
  'audio/wav': { kind: 'audio', mimeType: 'audio/wav' },
  'audio/wave': { kind: 'audio', mimeType: 'audio/wav' },
  'audio/x-wav': { kind: 'audio', mimeType: 'audio/wav' },
  'audio/vnd.wave': { kind: 'audio', mimeType: 'audio/wav' },
  'audio/mpeg': { kind: 'audio', mimeType: 'audio/mpeg' },
  'audio/mp3': { kind: 'audio', mimeType: 'audio/mpeg' },
  'audio/ogg': { kind: 'audio', mimeType: 'audio/ogg' },
  'audio/webm': { kind: 'audio', mimeType: 'audio/webm' },
  'video/webm': { kind: 'video', mimeType: 'video/webm' },
  'audio/mp4': { kind: 'audio', mimeType: 'audio/mp4' },
  'video/mp4': { kind: 'video', mimeType: 'video/mp4' },
  'video/ogg': { kind: 'video', mimeType: 'video/ogg' },
};

const EXTENSION_FORMATS: Record<string, readonly string[]> = {
  wav: ['audio/wav'],
  wave: ['audio/wav'],
  mp3: ['audio/mpeg'],
  mpga: ['audio/mpeg'],
  ogg: ['audio/ogg', 'video/ogg'],
  oga: ['audio/ogg'],
  opus: ['audio/ogg'],
  ogv: ['video/ogg'],
  webm: ['audio/webm', 'video/webm'],
  mp4: ['audio/mp4', 'video/mp4'],
  m4a: ['audio/mp4'],
  m4v: ['video/mp4'],
};

function fileExtension(fileName: string): string {
  const leaf = fileName.split(/[\\/]/).pop() ?? '';
  const separator = leaf.lastIndexOf('.');
  return separator <= 0 ? '' : leaf.slice(separator + 1).toLowerCase();
}

function mediaTypeEssence(mediaType: string): string {
  return mediaType.split(';', 1)[0].trim().toLowerCase();
}

/** Returns only local, self-contained media formats. Playlist containers are excluded. */
export function resolveMediaPreviewFormat(fileName: string, mediaType: string): MediaPreviewFormat | null {
  const extension = fileExtension(fileName);
  const declaredType = mediaTypeEssence(mediaType);

  if (PLAYLIST_EXTENSIONS.has(extension) || PLAYLIST_MEDIA_TYPES.has(declaredType)) return null;

  const declaredFormat = Object.prototype.hasOwnProperty.call(MIME_FORMATS, declaredType) ? MIME_FORMATS[declaredType] : undefined;
  const extensionFormats = Object.prototype.hasOwnProperty.call(EXTENSION_FORMATS, extension) ? EXTENSION_FORMATS[extension] : undefined;
  if (declaredFormat) {
    if (extension && (!extensionFormats || !extensionFormats.includes(declaredFormat.mimeType))) return null;
    return declaredFormat;
  }

  return null;
}

export function evaluateMediaPreview({ fileName, mediaType, byteLength, canPlayType }: {
  fileName: string;
  mediaType: string;
  byteLength: number;
  canPlayType: (mimeType: string) => string;
}): MediaPreviewPlan {
  const format = resolveMediaPreviewFormat(fileName, mediaType);
  if (!format) return { kind: 'unsupported-format', message: '此格式暂不支持音视频预览' };
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    return { kind: 'invalid-size', message: '原件大小信息无效；未读取原件' };
  }
  if (byteLength === 0) return { kind: 'empty', message: '此原件为空，无法预览' };
  if (byteLength > MAX_MEDIA_PREVIEW_BYTES) {
    return { kind: 'too-large', message: '音视频预览最多读取 16 MiB' };
  }

  let capability = '';
  try {
    const codecParameter = mediaType.split(';').slice(1).map(parameter => parameter.trim())
      .find(parameter => /^codecs\s*=/i.test(parameter));
    const probeType = codecParameter ? `${format.mimeType}; ${codecParameter}` : format.mimeType;
    capability = canPlayType(probeType);
  } catch {
    // Capability probes are advisory; a failed browser probe is an unsupported result.
  }
  const capabilityResult = capability.trim().toLowerCase();
  if (capabilityResult !== 'maybe' && capabilityResult !== 'probably') {
    return { kind: 'unsupported-browser', format, message: '此浏览器暂不支持该媒体格式' };
  }

  return { kind: 'supported', format };
}

export function formatMediaTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '--:--';
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainder = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}
