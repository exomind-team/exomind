type Editable = HTMLInputElement | HTMLTextAreaElement;
interface FieldSizing {
  field: Editable;
  minimum: number;
  beforeMax: string;
  beforeMin: string;
  maxPriority: string;
  minPriority: string;
  ownedMax?: string;
  ownedMin?: string;
}
function editable(element: Element | null): element is Editable {
  return (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement)
    && !element.disabled && !element.readOnly
    && (!(element instanceof HTMLInputElement) || ['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(element.type));
}

/** Native adjustResize can shrink both innerHeight and visualViewport to 97px.
 * Use the space an active editor actually needs, not their height difference.
 * Only the Beta caller switches the existing Alpha Shell's fullscreen mode;
 * no native inset, system-bar or shared Alpha component style is modified. */
export function observeBetaCompactEditing(workspace: HTMLElement, changed: (compact: boolean) => void, doc: Document = document, view: Window = window): () => void {
  let closed = false;
  let queued = false;
  let compact = false;
  let navigationHeight = 60;
  let sizing: FieldSizing | undefined;
  let fieldResize: ResizeObserver | undefined;
  const viewport = view.visualViewport;
  const restore = () => {
    fieldResize?.disconnect(); fieldResize = undefined;
    if (!sizing) return;
    const { field } = sizing;
    // Restore only properties this observer still owns. Other field updates
    // (including Alpha's content-height resizing) retain their own values.
    if (sizing.ownedMax !== undefined && field.style.getPropertyValue('max-height') === sizing.ownedMax) {
      if (sizing.beforeMax) field.style.setProperty('max-height', sizing.beforeMax, sizing.maxPriority);
      else field.style.removeProperty('max-height');
    }
    if (sizing.ownedMin !== undefined && field.style.getPropertyValue('min-height') === sizing.ownedMin) {
      if (sizing.beforeMin) field.style.setProperty('min-height', sizing.beforeMin, sizing.minPriority);
      else field.style.removeProperty('min-height');
    }
    sizing = undefined;
  };
  const setCompact = (next: boolean) => { if (next !== compact) { compact = next; changed(next); } };
  const update = () => {
    if (closed) return;
    const field = doc.activeElement;
    if (doc.hidden || !editable(field) || !workspace.contains(field)) { restore(); setCompact(false); return; }
    if (sizing?.field !== field) {
      restore();
      sizing = { field, minimum: parseFloat(view.getComputedStyle(field).minHeight) || 0,
        beforeMax: field.style.getPropertyValue('max-height'), beforeMin: field.style.getPropertyValue('min-height'),
        maxPriority: field.style.getPropertyPriority('max-height'), minPriority: field.style.getPropertyPriority('min-height') };
      if (typeof ResizeObserver !== 'undefined') { fieldResize = new ResizeObserver(queue); fieldResize.observe(field); }
    }
    const main = workspace.closest('main');
    const bar = main?.parentElement?.querySelector('[data-testid="mobile-bottom-tab"]')?.getBoundingClientRect();
    if (bar && bar.height > 0) navigationHeight = bar.height;
    const frame = main?.parentElement?.getBoundingClientRect();
    const top = Math.max(viewport?.offsetTop ?? 0, main?.getBoundingClientRect().top ?? 0, frame?.height ? frame.top : 0);
    const viewportBottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? view.innerHeight);
    const bottom = frame?.height ? Math.min(viewportBottom, frame.bottom) : viewportBottom;
    const height = Math.max(0, bottom - top);
    const rect = field.getBoundingClientRect();
    if (!rect.height || !height) { restore(); setCompact(false); return; }
    // Budget the bar even after it is hidden; measuring only the expanded
    // main would toggle the mode back and forth on every layout callback.
    const needed = Math.max(rect.height, sizing?.minimum ?? 0) + 8;
    const next = height - navigationHeight < needed;
    setCompact(next);
    if (!next) { restore(); return; }
    const limit = Math.max(1, Math.floor(height - 8));
    if (sizing && (rect.height > limit || sizing.ownedMax !== undefined)) {
      sizing.ownedMax = `${limit}px`; sizing.ownedMin = `${Math.min(sizing.minimum, limit)}px`;
      if (field.style.getPropertyValue('max-height') !== sizing.ownedMax) field.style.setProperty('max-height', sizing.ownedMax);
      if (field.style.getPropertyValue('min-height') !== sizing.ownedMin) field.style.setProperty('min-height', sizing.ownedMin);
    }
  };
  function queue() {
    if (closed || queued) return;
    queued = true;
    // React's input handler may resize the Alpha textarea after capture-phase
    // input dispatch. Measure once after that handler has applied its height.
    queueMicrotask(() => { queued = false; update(); });
  }
  doc.addEventListener('focusin', queue, true);
  doc.addEventListener('focusout', queue, true);
  doc.addEventListener('input', queue, true);
  doc.addEventListener('visibilitychange', queue);
  view.addEventListener('resize', queue);
  viewport?.addEventListener('resize', queue);
  viewport?.addEventListener('scroll', queue);
  queue();
  return () => {
    closed = true; restore();
    doc.removeEventListener('focusin', queue, true);
    doc.removeEventListener('focusout', queue, true);
    doc.removeEventListener('input', queue, true);
    doc.removeEventListener('visibilitychange', queue);
    view.removeEventListener('resize', queue);
    viewport?.removeEventListener('resize', queue);
    viewport?.removeEventListener('scroll', queue);
  };
}
