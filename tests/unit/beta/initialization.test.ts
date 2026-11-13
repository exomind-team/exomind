import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeBetaUuid } from '@/beta/initialization';

afterEach(() => vi.unstubAllGlobals());
describe('Beta identity initialization', () => {
  it('fails explicitly when the runtime has no cryptographic UUID capability', () => {
    const unavailable = {}; vi.stubGlobal('crypto', unavailable);
    expect(() => initializeBetaUuid()).toThrow('随机');
    expect(unavailable).not.toHaveProperty('randomUUID');
  });
});
