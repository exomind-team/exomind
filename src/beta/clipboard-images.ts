import { invoke, isTauri } from '@tauri-apps/api/core';
import { Image as NativeImage } from '@tauri-apps/api/image';

export interface BetaClipboardContents { files: File[]; text: string }
const MAX_CLIPBOARD_BYTES = 16 * 1024 * 1024;
const MAX_CLIPBOARD_PIXELS = 16 * 1024 * 1024;

/** Snapshot synchronously during the paste event: browsers clear DataTransfer
 * once the event finishes. The caller retains normal text paste if empty. */
export function clipboardImageFiles(data: DataTransfer): File[] {
  const items = Array.from(data.items ?? []);
  const files = items.filter(item => item.kind === 'file' && item.type.startsWith('image/'))
    .map(item => item.getAsFile()).filter((file): file is File => file !== null);
  return files.length ? files : Array.from(data.files ?? []).filter(file => file.type.startsWith('image/'));
}

function clipboardFile(blob: Blob, name?: string): File {
  const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' } as Record<string, string>)[blob.type] ?? 'image';
  return new File([blob], name || `剪贴板-${Date.now()}.${extension}`, { type: blob.type, lastModified: Date.now() });
}

async function nativeImageFile(): Promise<File | null> {
  if (/Android/i.test(navigator.userAgent)) {
    const image = await invoke<{ mediaType: string; dataBase64: string; fileName: string } | null>('plugin:exomind-android-clipboard|read_image');
    if (!image) return null;
    if (!image.mediaType.startsWith('image/') || image.dataBase64.length > Math.ceil(MAX_CLIPBOARD_BYTES / 3) * 4) {
      throw new Error('剪贴板图片超过 16 MiB 或格式无效；请通过附件选择原件');
    }
    const decoded = atob(image.dataBase64);
    if (decoded.length > MAX_CLIPBOARD_BYTES) throw new Error('剪贴板图片超过 16 MiB；请通过附件选择原件');
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; ++index) bytes[index] = decoded.charCodeAt(index);
    return clipboardFile(new Blob([bytes], { type: image.mediaType }), image.fileName);
  }
  // read_image returns a Tauri resource, not PNG bytes. Size is checked before
  // requesting RGBA; the resource and canvas are released on every exit path.
  let image: NativeImage;
  try { image = new NativeImage(await invoke<number>('plugin:clipboard-manager|read_image')); }
  catch { return null; }
  const canvas = document.createElement('canvas');
  try {
    const { width, height } = await image.size();
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > MAX_CLIPBOARD_PIXELS) {
      throw new Error('剪贴板图片尺寸过大；请通过附件选择原件');
    }
    const rgba = await image.rgba();
    if (rgba.length !== width * height * 4) throw new Error('剪贴板图片读取不完整，请重新复制');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前环境无法转换剪贴板图片，请通过附件选择原件');
    const pixels = context.createImageData(width, height); pixels.data.set(rgba); context.putImageData(pixels, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('剪贴板图片转换失败，请重新复制')), 'image/png'));
    if (blob.size > MAX_CLIPBOARD_BYTES) throw new Error('剪贴板图片超过 16 MiB；请通过附件选择原件');
    return clipboardFile(blob);
  } finally { canvas.width = 0; canvas.height = 0; await image.close().catch(() => {}); }
}

/** Reads only on an explicit user action. Images become ordinary draft files;
 * text is returned separately for insertion at the editor's selection. */
export async function readBetaClipboard(): Promise<BetaClipboardContents> {
  if (isTauri()) {
    const file = await nativeImageFile();
    if (file) return { files: [file], text: '' };
    try {
      const text = await invoke<string>('plugin:clipboard-manager|read_text');
      if (text) return { files: [], text };
    } catch { /* Keep platform errors out of the product message. */ }
    throw new Error('剪贴板没有可读取的图片或文字；可在输入框中粘贴，或通过附件选择图片');
  }
  const clipboard = navigator.clipboard;
  if (!clipboard) throw new Error('当前环境无法读取剪贴板，请在输入框中使用系统粘贴');
  if (typeof clipboard.read === 'function') {
    try {
      const items = await clipboard.read(); const files: File[] = []; let text = '';
      for (const item of items) {
        const imageType = item.types.find(type => type.startsWith('image/'));
        if (imageType) files.push(clipboardFile(await item.getType(imageType)));
        else if (item.types.includes('text/plain')) text += await (await item.getType('text/plain')).text();
      }
      if (files.length || text) return { files, text };
    } catch { /* Some WebViews support readText but do not support read. */ }
  }
  try { const text = await clipboard.readText(); if (text) return { files: [], text }; }
  catch { /* System paste remains available without browser read permission. */ }
  throw new Error('剪贴板未能读取；请在输入框中使用系统粘贴，或通过附件选择图片');
}
