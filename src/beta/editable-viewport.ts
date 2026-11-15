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
    let top = viewport?.offsetTop ?? 0, left = viewport?.offsetLeft ?? 0;
    const height = viewport?.height ?? view.innerHeight, width = viewport?.width ?? view.innerWidth;
    if(height<=0||width<=0)return;
    let bottom=top+height,right=left+width;
    let verticalScroller:HTMLElement|undefined;
    for(let ancestor=element.parentElement;ancestor;ancestor=ancestor.parentElement){
      const style=view.getComputedStyle(ancestor);const box=ancestor.getBoundingClientRect();
      if(/^(auto|scroll|hidden|clip)$/.test(style.overflowY)&&box.height>0){
        const edge=box.top+ancestor.clientTop;top=Math.max(top,edge);bottom=Math.min(bottom,edge+(ancestor.clientHeight||box.height));
        if(!verticalScroller&&/^(auto|scroll)$/.test(style.overflowY)&&ancestor.scrollHeight>ancestor.clientHeight)verticalScroller=ancestor;
      }
      if(/^(auto|scroll|hidden|clip)$/.test(style.overflowX)&&box.width>0){const edge=box.left+ancestor.clientLeft;left=Math.max(left,edge);right=Math.min(right,edge+(ancestor.clientWidth||box.width));}
    }
    // The Alpha bottom bar occupies real space above the IME. A field can be
    // inside visualViewport yet covered by that bar (the API35 regression).
    // Dialog portals sit above the bar and use their own clipping ancestors.
    if(element.closest('[data-beta-view]')){
      const navigation=doc.querySelector('[data-testid="mobile-bottom-tab"]')?.getBoundingClientRect();
      if(navigation&&navigation.width>0&&navigation.height>0&&navigation.top<bottom&&navigation.bottom>top&&navigation.left<rect.right&&navigation.right>rect.left)bottom=navigation.top;
    }
    if(bottom<=top||right<=left)return;
    const vertical=rect.top<top||rect.bottom>bottom;
    const horizontal=rect.left<left||rect.right>right;
    if(vertical&&verticalScroller){
      // Scroll the actual content owner, rather than panning the whole Shell
      // behind its fixed navigation. Oversized fields align at their start.
      const destination=rect.height>bottom-top?top:top+(bottom-top-rect.height)/2;
      verticalScroller.scrollTop=Math.max(0,Math.min(verticalScroller.scrollHeight-verticalScroller.clientHeight,verticalScroller.scrollTop+rect.top-destination));
    }else if(vertical||horizontal){element.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});}
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
