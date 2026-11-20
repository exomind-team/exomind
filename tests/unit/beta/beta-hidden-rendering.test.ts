import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const owned: Element[] = [];
afterEach(() => { for (const element of owned.splice(0)) element.remove(); });
function fixture(display: string, rootHidden = false) {
  const style = document.createElement('style');
  // Production imports index.css (Tailwind utilities) before beta-ui.css.
  style.textContent = `.disclosure-utility { display: ${display}; }\n`
    + readFileSync(resolve('src/beta/beta-ui.css'), 'utf8');
  document.head.append(style);
  const scope = document.createElement('section'); scope.className = 'beta-ui';
  const content = rootHidden ? scope : document.createElement('div');
  content.classList.add('disclosure-utility'); content.setAttribute('hidden', '');
  content.textContent = 'Collapsed actions must take no layout space';
  if (!rootHidden) scope.append(content);
  document.body.append(scope); owned.push(style, scope);
  return content;
}

describe('Beta hidden rendering contract', () => {
  it.each(['flex', 'grid', 'inline-flex', 'block'])('keeps collapsed content out of layout with a %s utility', display => {
    const content = fixture(display);
    expect(getComputedStyle(content).display).toBe('none');
    content.removeAttribute('hidden');
    expect(getComputedStyle(content).display).toBe(display);
    content.setAttribute('hidden', '');
    expect(getComputedStyle(content).display).toBe('none');
  });

  it('also respects hidden on the Beta scope itself', () => {
    const scope = fixture('flex', true);
    expect(getComputedStyle(scope).display).toBe('none');
    scope.removeAttribute('hidden');
    expect(getComputedStyle(scope).display).toBe('flex');
  });
});
