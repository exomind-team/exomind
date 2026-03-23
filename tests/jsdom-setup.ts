import { JSDOM } from 'jsdom';
import { vi } from 'vitest';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost' });

global.document = dom.window.document;
global.window = dom.window;
global.navigator = dom.window.navigator;
global.HTMLElement = dom.window.HTMLElement;
global.HTMLDivElement = dom.window.HTMLDivElement;
global.HTMLButtonElement = dom.window.HTMLButtonElement;
global.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.Text = dom.window.Text;
global.Comment = dom.window.Comment;
global.DocumentFragment = dom.window.DocumentFragment;
global.Event = dom.window.Event;
global.MouseEvent = dom.window.MouseEvent;
global.KeyboardEvent = dom.window.KeyboardEvent;
global.requestAnimationFrame = vi.fn((cb) => cb());
global.cancelAnimationFrame = vi.fn();

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));
