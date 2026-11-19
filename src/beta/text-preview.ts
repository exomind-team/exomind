/** Preview decode/render allocation has its own budget; downloads keep theirs. */
export const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024;
export const TEXT_PREVIEW_BUDGET_MESSAGE = `文本预览最多读取 ${MAX_TEXT_PREVIEW_BYTES / (1024 * 1024)} MiB；原件保持不变，可继续使用现有原件操作`;
/** Bound one rendered text node while keeping the full verified source pageable. */
export const TEXT_PREVIEW_PAGE_CHARACTERS = 16 * 1024;

const TEXT_EXTENSIONS = new Set([
  'txt', 'text', 'md', 'markdown', 'mdown', 'mkd', 'json', 'jsonc', 'jsonl', 'ndjson', 'log',
  'csv', 'tsv', 'xml', 'yaml', 'yml', 'toml', 'ini', 'conf', 'config', 'properties', 'env',
  'html', 'htm', 'svg', 'css', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'sh', 'bash', 'zsh',
  'bat', 'cmd', 'ps1', 'sql', 'diff', 'patch', 'rst', 'tex', 'py', 'rs', 'go', 'java', 'kt',
  'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'swift', 'rb', 'php', 'pl', 'lua', 'wasm-text',
]);

const TEXT_MEDIA_TYPES = new Set([
  'application/json', 'application/ld+json', 'application/xml', 'application/javascript',
  'application/x-javascript', 'application/x-ndjson', 'application/yaml', 'application/x-yaml',
  'image/svg+xml',
]);
const TEXT_FILE_NAMES = new Set(['readme', 'license', 'license.txt', 'dockerfile', 'makefile', 'procfile', 'changelog', 'authors', 'notice']);

/** Recognizes text by the declared media type or a known source/text extension. */
export function isTextPreviewCandidate(fileName: string, mediaType: string): boolean {
  const normalizedType = mediaType.split(';', 1)[0].trim().toLowerCase();
  if (normalizedType.startsWith('text/') || TEXT_MEDIA_TYPES.has(normalizedType)
    || normalizedType.endsWith('+json') || normalizedType.endsWith('+xml')) return true;

  const pathParts = fileName.split(/[\\/]/);
  const leafName = pathParts[pathParts.length - 1]?.toLowerCase() ?? '';
  if (TEXT_FILE_NAMES.has(leafName)) return true;
  const extension = leafName.includes('.') ? leafName.slice(leafName.lastIndexOf('.') + 1) : '';
  return TEXT_EXTENSIONS.has(extension);
}

/** Decodes only strict UTF-8 text. It never interprets markup or executes content. */
export async function decodeTextPreview(blob: Blob, expectedByteLength = blob.size): Promise<string> {
  if (!Number.isSafeInteger(expectedByteLength) || expectedByteLength < 0 || blob.size !== expectedByteLength) {
    throw new Error('原件读取长度与记录不一致；未显示预览，原件保持不变');
  }
  if (blob.size > MAX_TEXT_PREVIEW_BYTES) {
    throw new Error(TEXT_PREVIEW_BUDGET_MESSAGE);
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength !== expectedByteLength) throw new Error('原件读取不完整；未显示预览，原件保持不变');

  let text: string;
  try {
    // Keep the signature in the decoded string, then remove exactly one leading BOM.
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error('原件不是有效的 UTF-8 文本；未显示预览，原件保持不变');
  }
  if (text.startsWith('\uFEFF')) text = text.slice(1);

  for (const character of text) {
    const point = character.codePointAt(0)!;
    const allowedControl = point === 0x09 || point === 0x0a || point === 0x0c || point === 0x0d || point === 0x1b;
    if (point === 0 || point === 0x7f || point >= 0x80 && point <= 0x9f || point < 0x20 && !allowedControl) {
      throw new Error('原件包含二进制控制字节，不适合作为文本预览；原件保持不变');
    }
  }
  return text;
}

function nextTextPageEnd(text: string, start: number): number {
  const end = Math.min(text.length, start + TEXT_PREVIEW_PAGE_CHARACTERS);
  const splitsSurrogatePair = end < text.length
    && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff
    && text.charCodeAt(end) >= 0xdc00 && text.charCodeAt(end) <= 0xdfff;
  return splitsSurrogatePair ? end + 1 : end;
}

/** Empty text has one readable empty page. Page boundaries never split a surrogate pair. */
export function textPreviewPageCount(text: string): number {
  if (!text.length) return 1;
  let pages = 0;
  for (let start = 0; start < text.length; start = nextTextPageEnd(text, start)) pages++;
  return pages;
}

export function textPreviewPage(text: string, pageIndex: number): string {
  if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) return '';
  if (!text.length) return '';
  let start = 0;
  for (let page = 0; start < text.length; page++) {
    const end = nextTextPageEnd(text, start);
    if (page === pageIndex) return text.slice(start, end);
    start = end;
  }
  return '';
}
