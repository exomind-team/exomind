import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { errorMessage } from './drafts';
import {
  decodeTextPreview,
  isTextPreviewCandidate,
  MAX_TEXT_PREVIEW_BYTES,
  TEXT_PREVIEW_BUDGET_MESSAGE,
  textPreviewPage,
  textPreviewPageCount,
} from './text-preview';

type TextPreviewState = {
  identity: string;
  sourceScope?: object;
  byteLength: number;
  status: 'idle' | 'loading' | 'ready' | 'error';
  text?: string;
  error?: string;
};

type TextPreviewRequest = { identity: string; sourceScope?: object; byteLength: number };

/** Explicit, read-only text preview. The caller must provide fully verified local bytes. */
export function BetaTextPreview({ identity, sourceScope, visible = true, fileName, mediaType, byteLength, load }: {
  identity: string;
  sourceScope?: object;
  visible?: boolean;
  fileName: string;
  mediaType: string;
  byteLength: number;
  load: () => Promise<Blob>;
}) {
  const loader = useRef(load);
  loader.current = load;
  const trigger = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLPreElement>(null);
  const openedScope = useRef<TextPreviewRequest | null>(null);
  const request = useRef<TextPreviewRequest | null>(null);
  const context = useRef({ identity, sourceScope, visible, byteLength });
  context.current = { identity, sourceScope, visible, byteLength };

  const [open, setOpen] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [state, setState] = useState<TextPreviewState>({ identity, sourceScope, byteLength, status: 'idle' });
  const stateRef = useRef(state);
  stateRef.current = state;

  function owns(requested: TextPreviewRequest): boolean {
    return request.current === requested
      && context.current.visible
      && context.current.identity === requested.identity
      && context.current.sourceScope === requested.sourceScope
      && context.current.byteLength === requested.byteLength;
  }

  function startRead() {
    if (!visible) return;
    const currentState = stateRef.current;
    if (currentState.identity === identity && currentState.sourceScope === sourceScope && currentState.byteLength === byteLength && currentState.status === 'ready') return;
    if (request.current) return;

    if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
      setState({ identity, sourceScope, byteLength, status: 'error', error: '原件大小信息无效；未读取原件' });
      return;
    }
    if (byteLength > MAX_TEXT_PREVIEW_BYTES) {
      setState({ identity, sourceScope, byteLength, status: 'error', error: TEXT_PREVIEW_BUDGET_MESSAGE });
      return;
    }

    const requested = { identity, sourceScope, byteLength };
    request.current = requested;
    setPageIndex(0);
    setState({ identity, sourceScope, byteLength, status: 'loading' });
    const read = loader.current;
    void (async () => {
      try {
        const blob = await read();
        if (!owns(requested)) return;
        const text = await decodeTextPreview(blob, byteLength);
        if (!owns(requested)) return;
        request.current = null;
        setPageIndex(0);
        setState({ identity, sourceScope, byteLength, status: 'ready', text });
      } catch (failure) {
        if (!owns(requested)) return;
        request.current = null;
        setState({ identity, sourceScope, byteLength, status: 'error', error: errorMessage(failure) });
      } finally {
        if (request.current === requested) request.current = null;
      }
    })();
  }

  function changeOpen(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) return;
    request.current = null;
    setPageIndex(0);
    setState({ identity, sourceScope, byteLength, status: 'idle' });
  }

  useEffect(() => {
    setOpen(false);
    openedScope.current = null;
    const currentState = stateRef.current;
    const scopeChanged = currentState.identity !== identity || currentState.sourceScope !== sourceScope || currentState.byteLength !== byteLength;
    if (scopeChanged || !visible) {
      request.current = null;
      setPageIndex(0);
      setState({ identity, sourceScope, byteLength, status: 'idle' });
    }
    return () => { request.current = null; openedScope.current = null; };
  }, [identity, sourceScope, visible, byteLength]);
  useLayoutEffect(() => { if (body.current) body.current.scrollTop = 0; }, [pageIndex]);

  if (!isTextPreviewCandidate(fileName, mediaType)) return null;
  const bound = state.identity === identity && state.sourceScope === sourceScope && state.byteLength === byteLength && visible ? state : null;
  const text = bound?.status === 'ready' ? bound.text ?? '' : '';
  const pageCount = bound?.status === 'ready' ? textPreviewPageCount(text) : 1;
  const page = bound?.status === 'ready' ? textPreviewPage(text, pageIndex) : '';

  return <>
    <Button
      ref={trigger}
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 shrink-0 px-2 text-xs"
      aria-label={`预览文本 ${fileName}`}
      aria-haspopup="dialog"
      aria-expanded={open && visible}
      disabled={!visible}
      onClick={() => {
        openedScope.current = { identity, sourceScope, byteLength };
        setOpen(true);
        startRead();
      }}
    >
      <FileText size={14} aria-hidden="true" />
      预览文本
    </Button>
    <Dialog open={open && visible} onOpenChange={changeOpen}>
      <DialogContent
        className="beta-ui flex max-h-[calc(100dvh-2rem)] min-h-0 w-[calc(100vw-2rem)] max-w-5xl flex-col overflow-hidden border-[#E7E5E4] bg-[#FAF7F5] text-[#292524] dark:border-[#292524] dark:bg-[#0C0A09] dark:text-[#FAFAF9]"
        onCloseAutoFocus={event => {
          event.preventDefault();
          const opened = openedScope.current;
          openedScope.current = null;
          if (visible && opened && context.current.identity === opened.identity && context.current.sourceScope === opened.sourceScope && context.current.byteLength === opened.byteLength) {
            trigger.current?.focus({ preventScroll: true });
          }
        }}
      >
        <DialogHeader className="pr-8 text-left">
          <DialogTitle className="break-all text-base">{fileName}</DialogTitle>
          <DialogDescription>只读预览 · 原件保持不变</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {bound?.status === 'loading' && <p role="status" className="shrink-0 text-sm text-muted">正在读取并校验本机原件…</p>}
          {bound?.status === 'error' && <div className="space-y-3" role="group" aria-label="文本预览失败">
            <p role="alert" className="text-sm text-destructive">{bound.error}</p>
            <Button type="button" variant="outline" size="sm" onClick={startRead}>重试预览</Button>
          </div>}
          {bound?.status === 'ready' && <>
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
              {pageCount > 1 && <p role="status" aria-live="polite" className="text-xs text-muted">分段 {pageIndex + 1} / {pageCount}</p>}
              {pageCount > 1 && <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" aria-label="上一段" disabled={pageIndex === 0} onClick={() => setPageIndex(value => Math.max(0, value - 1))}>上一段</Button>
                <Button type="button" variant="outline" size="sm" aria-label="下一段" disabled={pageIndex >= pageCount - 1} onClick={() => setPageIndex(value => Math.min(pageCount - 1, value + 1))}>下一段</Button>
              </div>}
            </div>
            {text.length === 0
              ? <p role="status" className="rounded-xl border border-[#E7E5E4] bg-[#FCFBFA] px-3 py-4 text-sm text-muted dark:border-[#292524] dark:bg-[#120F0D]">此原件为空。</p>
              : <pre ref={body} data-testid="beta-text-preview-body" aria-label={`文本内容 ${fileName}`} className="beta-ui min-h-0 max-h-[70dvh] w-full min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain rounded-xl border border-[#E7E5E4] bg-[#FCFBFA] p-3 font-mono text-xs leading-5 text-[#292524] whitespace-pre-wrap break-words [overflow-wrap:anywhere] dark:border-[#292524] dark:bg-[#120F0D] dark:text-[#FAFAF9]">{page}</pre>}
          </>}
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
