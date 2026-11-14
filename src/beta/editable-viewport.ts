/** Recheck the current editable after native IME/layout resize, without
 * following normal user scrolling or retaining an old field's focus. */
export function keepBetaEditableInViewport(doc: Document = document, view: Window = window): () => void {
  let closed = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const check = () => {
    if (closed) return;
    const element = doc.activeElement;
    if (!(element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement)
      || element.disabled || element.readOnly
      || element instanceof HTMLInputElement && !['text','search','email','url','tel','password','number'].includes(element.type)) return;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const viewport = view.visualViewport;
    const top = viewport?.offsetTop ?? 0, left = viewport?.offsetLeft ?? 0;
    const height = viewport?.height ?? view.innerHeight, width = viewport?.width ?? view.innerWidth;
    if (height > 0 && width > 0 && (rect.top < top || rect.bottom > top + height
      || rect.left < left || rect.right > left + width)) {
      element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    }
  };
  const schedule = () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const delay of [0, 80, 180, 350]) {
      const timer = setTimeout(() => { timers.delete(timer); check(); }, delay);
      timers.add(timer);
    }
  };
  doc.addEventListener('focusin', schedule);
  view.addEventListener('resize', schedule);
  view.visualViewport?.addEventListener('resize', schedule);
  return () => {
    closed = true;
    doc.removeEventListener('focusin', schedule);
    view.removeEventListener('resize', schedule);
    view.visualViewport?.removeEventListener('resize', schedule);
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  };
}
