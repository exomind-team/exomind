const IME_SETTLEMENT_MS = 3000;
const INITIAL_CHECK_DELAYS = [0, 80, 180, 350] as const;
type Editable = HTMLTextAreaElement | HTMLInputElement;
interface Settlement {
  element: Editable;
  deadline: number;
  resize?: ResizeObserver;
  layout?: MutationObserver;
}

function editable(element: Element | null): element is Editable {
  return (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement)
    && !element.disabled && !element.readOnly
    && (!(element instanceof HTMLInputElement) || ['text','search','email','url','tel','password','number'].includes(element.type));
}

/** Android may pan/reflow well after its first resize callbacks. Observe only
 * one bounded focus/IME settlement; user scrolling ends it immediately. No
 * polling, permanent scroll following, focus restoration or visual restyling. */
export function keepBetaEditableInViewport(doc: Document = document, view: Window = window): () => void {
  let closed = false;
  let interrupted = false;
  let settlement: Settlement | undefined;
  let pendingCheck: ReturnType<typeof setTimeout> | undefined;
  const viewport = view.visualViewport;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const end = () => {
    settlement?.resize?.disconnect();
    settlement?.layout?.disconnect();
    settlement = undefined;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    pendingCheck = undefined;
  };
  const later = (action: () => void, delay: number) => {
    const timer = setTimeout(() => { timers.delete(timer); action(); }, delay);
    timers.add(timer);
    return timer;
  };
  const current = (active: Settlement): boolean => {
    if (closed || settlement !== active) return false;
    if (doc.hidden || interrupted || view.performance.now() >= active.deadline
      || doc.activeElement !== active.element || !editable(active.element)) {
      end(); return false;
    }
    return true;
  };
  const check = (active: Settlement) => {
    if (!current(active)) return;
    const element = active.element;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const top = viewport?.offsetTop ?? 0, left = viewport?.offsetLeft ?? 0;
    const height = viewport?.height ?? view.innerHeight, width = viewport?.width ?? view.innerWidth;
    if (height > 0 && width > 0 && (rect.top < top || rect.bottom > top + height
      || rect.left < left || rect.right > left + width)) {
      element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    }
  };
  const queueCheck = (active: Settlement) => {
    if (!current(active) || pendingCheck !== undefined) return;
    pendingCheck = later(() => { pendingCheck = undefined; check(active); }, 0);
  };
  const begin = () => {
    end();
    const element = doc.activeElement;
    if (closed || doc.hidden || interrupted || !editable(element)) return;
    const active: Settlement = { element, deadline: view.performance.now() + IME_SETTLEMENT_MS };
    settlement = active;
    if (typeof ResizeObserver !== 'undefined') {
      active.resize = new ResizeObserver(() => queueCheck(active));
      active.resize.observe(element);
    }
    if (typeof MutationObserver !== 'undefined') {
      // A sibling status/config row can move the field without resizing the
      // field itself. The observer lives only as long as this settlement.
      active.layout = new MutationObserver(() => queueCheck(active));
      active.layout.observe(doc.body ?? doc.documentElement, {
        subtree: true, childList: true, characterData: true,
        attributes: true, attributeFilter: ['style','class','hidden'],
      });
    }
    for (const delay of INITIAL_CHECK_DELAYS) later(() => check(active), delay);
    later(() => { if (settlement === active) end(); }, IME_SETTLEMENT_MS);
  };
  const focus = () => { interrupted = false; begin(); };
  const resize = () => {
    // Window and visualViewport may both report the same resize, or report
    // several animation frames. Those callbacks never extend this deadline.
    if (settlement) queueCheck(settlement);
    else if (!interrupted) begin();
  };
  const edit = (event: Event) => {
    // Actual continued editing is a new intent, including IME composition.
    // Background updates and events from a stale field cannot restart it.
    if (event.target !== doc.activeElement || !editable(doc.activeElement)) return;
    interrupted = false; begin();
  };
  const movement = () => { if (settlement) queueCheck(settlement); };
  const userScroll = () => { interrupted = true; end(); };
  const pointer = (event: PointerEvent) => {
    if (event.button !== 0) return;
    if (event.target instanceof Element && editable(event.target)) {
      interrupted = false;
      // Retapping the same editable does not emit focusin, but is a new
      // explicit request to edit. A different field will start on focusin.
      if (event.target === doc.activeElement) begin();
    } else userScroll();
  };
  const hidden = () => { if (doc.hidden) end(); };
  doc.addEventListener('focusin', focus, true);
  doc.addEventListener('focusout', end, true);
  doc.addEventListener('input', edit, true);
  doc.addEventListener('compositionupdate', edit, true);
  doc.addEventListener('compositionend', edit, true);
  doc.addEventListener('wheel', userScroll, {capture:true,passive:true});
  doc.addEventListener('touchmove', userScroll, {capture:true,passive:true});
  doc.addEventListener('pointerdown', pointer, true);
  doc.addEventListener('scroll', movement, true);
  doc.addEventListener('visibilitychange', hidden);
  view.addEventListener('resize', resize);
  view.addEventListener('scroll', movement);
  viewport?.addEventListener('resize', resize);
  viewport?.addEventListener('scroll', movement);
  return () => {
    closed = true; end();
    doc.removeEventListener('focusin', focus, true);
    doc.removeEventListener('focusout', end, true);
    doc.removeEventListener('input', edit, true);
    doc.removeEventListener('compositionupdate', edit, true);
    doc.removeEventListener('compositionend', edit, true);
    doc.removeEventListener('wheel', userScroll, true);
    doc.removeEventListener('touchmove', userScroll, true);
    doc.removeEventListener('pointerdown', pointer, true);
    doc.removeEventListener('scroll', movement, true);
    doc.removeEventListener('visibilitychange', hidden);
    view.removeEventListener('resize', resize);
    view.removeEventListener('scroll', movement);
    viewport?.removeEventListener('resize', resize);
    viewport?.removeEventListener('scroll', movement);
  };
}
