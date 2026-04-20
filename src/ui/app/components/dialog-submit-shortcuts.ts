import type { KeyboardEvent } from 'react';

function isPrimaryModifierEnter(event: KeyboardEvent<HTMLElement>): boolean {
  return (
    !event.nativeEvent.isComposing
    && (event.ctrlKey || event.metaKey)
    && !event.altKey
    && event.key === 'Enter'
  );
}

export function runActionOnPrimaryModifierEnter<T extends HTMLElement>(
  event: KeyboardEvent<T>,
  action: () => void,
): boolean {
  if (!isPrimaryModifierEnter(event)) {
    return false;
  }

  event.preventDefault();
  action();
  return true;
}

export function requestSubmitOnPrimaryModifierEnter<T extends HTMLElement>(
  event: KeyboardEvent<T>,
): boolean {
  if (!isPrimaryModifierEnter(event)) {
    return false;
  }

  event.preventDefault();
  const form = event.currentTarget.closest('form');
  form?.requestSubmit();
  return true;
}
