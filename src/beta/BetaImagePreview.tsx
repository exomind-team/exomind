import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { readFileSource, type FileSource } from './file-source-store';
import { ORIGINAL_CHUNK_BYTES } from './original-types';
import { errorMessage } from './drafts';
import type { BetaOriginalShareOutcome } from './original-share';

export const MAX_IMAGE_PREVIEW_BYTES = 16 * 1024 * 1024;
const MAX_IMAGE_PREVIEW_PIXELS = 16 * 1024 * 1024;
// Automatic previews have a smaller budget than explicit full-image reads.
// These are local engineering limits, not a claimed device performance result.
const MAX_INLINE_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_INLINE_IMAGE_PIXELS = 4 * 1024 * 1024;
export function canPreviewImage(mediaType: string): boolean {
  return /^(image\/png|image\/jpeg|image\/gif|image\/webp)$/i.test(mediaType);
}

// Decode only known raster headers, before the browser allocates a pixel
// buffer. SVG/HTML and unsupported containers remain ordinary originals.
function rasterDimensions(bytes: Uint8Array): { type: string; width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, value: string) => offset + value.length <= bytes.length && Array.from(value).every((char, index) => bytes[offset + index] === char.charCodeAt(0));
  if (bytes.length >= 24 && bytes[0] === 137 && ascii(1, 'PNG\r\n\x1a\n') && ascii(12, 'IHDR')) {
    return { type: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length >= 10 && (ascii(0, 'GIF87a') || ascii(0, 'GIF89a'))) {
    return { type: 'image/gif', width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  if (bytes.length >= 30 && ascii(0, 'RIFF') && ascii(8, 'WEBP')) {
    if (ascii(12, 'VP8X')) {
      const uint24 = (offset: number) => bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536;
      return { type: 'image/webp', width: uint24(24) + 1, height: uint24(27) + 1 };
    }
    if (ascii(12, 'VP8 ') && ascii(23, '\x9d\x01\x2a')) return { type: 'image/webp', width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (ascii(12, 'VP8L') && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      return { type: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) return null;
      while (offset < bytes.length && bytes[offset] === 0xff) ++offset;
      if (offset + 3 > bytes.length) return null;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) return null;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) return null;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 8) return null;
        return { type: 'image/jpeg', width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
      }
      offset += length;
    }
  }
  return null;
}

/** Reads only the supplied, scope-checked local source. No network fetch or
 * download/export picker is started by an image preview. */
async function previewBlob(source: FileSource | null, mediaType: string, byteLength: number, current: () => boolean, automatic = false): Promise<Blob> {
  if (!source || source.size !== byteLength) throw new Error('本机没有完整的图片副本，请先获取原件');
  if (byteLength < 1 || byteLength > MAX_IMAGE_PREVIEW_BYTES) throw new Error('预览支持 16 MiB 以内的图片；原件仍可保存或导出');
  const chunks: ArrayBuffer[] = [];
  for (let offset = 0; offset < byteLength; offset += ORIGINAL_CHUNK_BYTES) {
    if (!current()) throw new Error('预览已关闭');
    const bytes = await readFileSource(source, offset, Math.min(ORIGINAL_CHUNK_BYTES, byteLength - offset));
    chunks.push(new Uint8Array(bytes).buffer);
  }
  if (!current()) throw new Error('预览已关闭');
  const blob = new Blob(chunks, { type: mediaType });
  const header = new Uint8Array(await blob.slice(0, Math.min(byteLength, 1024 * 1024)).arrayBuffer());
  const image = rasterDimensions(header);
  if (!image || image.type !== mediaType.toLowerCase()) throw new Error('此图片格式暂不支持预览；原件仍可保存或导出');
  if (!image.width || !image.height || image.width * image.height > MAX_IMAGE_PREVIEW_PIXELS) throw new Error('图片尺寸超出预览范围；原件仍可保存或导出');
  if (automatic && image.width * image.height > MAX_INLINE_IMAGE_PIXELS) throw new Error('图片较大，点按后读取预览；原件保持不变');
  return blob;
}

// A row may become visible alongside other rows. Serialize bounded preview
// reads instead of allocating many image buffers at once on mobile.
let previewQueue: Promise<unknown> = Promise.resolve();
function enqueuePreview<T>(read: () => Promise<T>): Promise<T> {
  const result = previewQueue.then(read); previewQueue = result.catch(() => {}); return result;
}
type PreviewState = { identity: string; scope?: object; status: 'idle' | 'loading' | 'ready' | 'error'; url?: string; blob?: Blob; error?: string };
type FileShareNavigator = Navigator & {
  share?: (data: { title: string; text?: string; files: File[] }) => Promise<void>;
  canShare?: (data?: { files?: File[] }) => boolean;
};

/** Identity includes device/profile and immutable file identity. Inline reads
 * require viewport attention; explicit previews have a separate byte budget. */
export function BetaImagePreview({ identity, fileName, mediaType, byteLength, load, thumbnail = false, inline = false, visible = true, sourceScope, onShare, shareDisabled = false }: {
  identity: string; fileName: string; mediaType: string; byteLength: number;
  load: () => Promise<FileSource | null>; thumbnail?: boolean; inline?: boolean; visible?: boolean; sourceScope?: object;
  /** When provided, the owning original row performs the same Native share action. */
  onShare?: () => Promise<BetaOriginalShareOutcome>;
  shareDisabled?: boolean;
}) {
  const loader = useRef(load); loader.current = load;
  const region = useRef<HTMLDivElement>(null); const trigger = useRef<HTMLButtonElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [open, setOpen] = useState(false); const [revision, setRevision] = useState(0);
  const [state, setState] = useState<PreviewState>({ identity, status: 'idle' });
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState('');
  const [shareNotice, setShareNotice] = useState('');
  useEffect(() => {
    if (!inline || !visible || !region.current || typeof IntersectionObserver === 'undefined') { setNearViewport(false); return; }
    let active = true;
    const observer = new IntersectionObserver(entries => { if (active) setNearViewport(entries.some(entry => entry.isIntersecting)); }, { rootMargin: '120px' });
    observer.observe(region.current); return () => { active = false; observer.disconnect(); };
  }, [inline, visible, identity, sourceScope]);
  const automatic = inline && !open;
  const requested = visible && (open || thumbnail || inline && nearViewport && byteLength <= MAX_INLINE_IMAGE_BYTES);
  const supported = canPreviewImage(mediaType) && byteLength > 0 && byteLength <= MAX_IMAGE_PREVIEW_BYTES;
  useEffect(() => {
    let active = true; let url: string | undefined;
    setState({ identity, scope: sourceScope, status: requested && supported ? 'loading' : 'idle' });
    if (requested && supported) {
      const read = loader.current;
      void enqueuePreview(async () => {
        if (!active) return;
        const blob = await previewBlob(await read(), mediaType, byteLength, () => active, automatic);
        if (!active) return;
        url = URL.createObjectURL(blob); setState({ identity, scope: sourceScope, status: 'ready', url, blob });
      }).catch(failure => { if (active) setState({ identity, scope: sourceScope, status: 'error', error: errorMessage(failure) }); });
    }
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
    // Opening an already decoded inline image reuses its URL. An explicit
    // retry increments revision and may use the larger manual-read budget.
  }, [identity, sourceScope, mediaType, byteLength, requested, supported, revision]);
  useEffect(() => {
    setOpen(false); setShareBusy(false); setShareError(''); setShareNotice('');
  }, [identity, sourceScope, visible]);
  if (!canPreviewImage(mediaType)) return null;
  const bound = state.identity === identity && state.scope === sourceScope && visible ? state : null;
  const imageUrl = bound?.status === 'ready' ? bound.url : undefined;
  const failImage = () => setState(current => current.identity === identity && current.scope === sourceScope && current.url === imageUrl
    ? { identity, scope: sourceScope, status: 'error', error: '图片无法解码；原件保留，可重新预览或导出' } : current);
  async function shareImage() {
    if (!bound?.blob || shareBusy || shareDisabled) return;
    setShareError(''); setShareNotice('');
    setShareBusy(true);
    try {
      if (onShare) {
        const outcome = await onShare();
        setShareNotice(outcome === 'system_chooser_opened'
          ? '已打开系统分享；接收应用尚未确认发送'
          : '分享准备已取消；原件保持不变');
        return;
      }
      const shareApi = navigator as FileShareNavigator;
      const file = new File([bound.blob], fileName, { type: mediaType });
      const payload = { title: fileName, text: '分享外心图片原件', files: [file] };
      if (!shareApi.share) {
        setShareError('当前环境不支持系统分享；可先下载原件，再从下载位置分享到微信或其他应用');
        return;
      }
      if (shareApi.canShare && !shareApi.canShare({ files: [file] })) {
        setShareError('当前系统不接受图片文件分享；可先下载原件后再分享');
        return;
      }
      await shareApi.share(payload);
      if (visible) setShareNotice('已交给系统分享');
    } catch (failure) {
      if ((failure as { name?: string })?.name === 'AbortError') setShareNotice('已取消分享');
      else setShareError(errorMessage(failure));
    } finally {
      setShareBusy(false);
    }
  }
  return <div ref={region} className="space-y-1">
    <Button ref={trigger} type="button" variant="ghost" size={thumbnail ? 'icon' : 'sm'} className={inline ? 'h-auto min-h-28 w-full overflow-hidden rounded-xl border border-input bg-surface p-0' : thumbnail ? 'h-16 w-16 overflow-hidden rounded-xl border border-input bg-surface p-0' : 'h-8 text-xs'}
      aria-label={`预览图片 ${fileName}`} disabled={!supported} onClick={() => { setOpen(true); if (bound?.status !== 'ready') setRevision(value => value + 1); }}>
      {(thumbnail || inline) && imageUrl ? <img src={imageUrl} alt={fileName} className={inline ? 'max-h-72 w-full object-contain' : 'h-full w-full object-cover'} onError={failImage} /> : <><ImageIcon size={16} className={thumbnail ? '' : 'mr-1'} />{!thumbnail && (bound?.status === 'loading' ? '正在准备预览…' : '预览图片')}</>}
    </Button>
    {!supported && <p className="text-xs text-muted">图片超过 16 MiB，暂不生成预览；原件可保存或导出</p>}
    {thumbnail && bound?.status === 'loading' && <p role="status" className="text-xs text-muted">正在准备预览…</p>}
    {thumbnail && bound?.status === 'error' && <p role="alert" className="text-xs text-destructive">{bound.error}</p>}
    {inline && bound?.status === 'error' && <p className="text-xs text-muted">{bound.error}</p>}
    <Dialog open={open && visible} onOpenChange={setOpen}><DialogContent className="max-h-[calc(100dvh-2rem)] max-w-3xl overflow-y-auto" onCloseAutoFocus={event=>{event.preventDefault();if(visible)trigger.current?.focus({preventScroll:true});}}>
      <DialogHeader><DialogTitle className="break-all pr-6 text-base">{fileName}</DialogTitle><DialogDescription>图片预览 · 原件保持不变</DialogDescription></DialogHeader>
      {imageUrl ? <img src={imageUrl} alt={fileName} className="mx-auto max-h-[70dvh] max-w-full object-contain" onError={failImage} />
        : bound?.status === 'error' ? <p role="alert" className="text-sm text-destructive">{bound.error}</p>
          : <p role="status" className="text-sm text-muted">正在读取本机图片…</p>}
      <div className="flex flex-wrap gap-2">
        {imageUrl && <Button type="button" aria-label={`分享图片 ${fileName}`} disabled={shareBusy||shareDisabled} onClick={() => { void shareImage(); }}><Share2 size={14}/>{shareBusy||shareDisabled ? '正在准备分享…' : '分享'}</Button>}
        {bound?.status === 'error' && <Button variant="outline" onClick={() => setRevision(value => value + 1)}>重新预览</Button>}
      </div>
      {shareError && <p role="alert" className="text-sm text-destructive">{shareError}</p>}
      {shareNotice && <p role="status" className="text-sm text-secondary">{shareNotice}</p>}
    </DialogContent></Dialog>
  </div>;
}
