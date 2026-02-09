import { vi } from 'vitest';
import '@testing-library/jest-dom';

// Mock scrollIntoView (jsdom 不支持)
Element.prototype.scrollIntoView = vi.fn();
