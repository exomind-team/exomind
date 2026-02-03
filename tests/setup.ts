import { vi, expect, describe, it, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';

// 扩展 vitest 的 expect
vi.waitFor;
