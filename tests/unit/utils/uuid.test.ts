import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUuidV4, ensureCryptoRandomUUID } from '@/lib/utils/uuid';

describe('uuid utils', () => {
  const originalCrypto = globalThis.crypto;

  afterEach(() => {
    vi.stubGlobal('crypto', originalCrypto);
  });

  it('createUuidV4 should generate RFC4122 v4-like id', () => {
    const id = createUuidV4();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('ensureCryptoRandomUUID should polyfill when missing', () => {
    const stubCrypto = {
      getRandomValues: (bytes: Uint8Array) => {
        for (let i = 0; i < bytes.length; i += 1) {
          bytes[i] = (i * 17) & 0xff;
        }
        return bytes;
      },
    };

    vi.stubGlobal('crypto', stubCrypto);
    ensureCryptoRandomUUID();

    expect(typeof (globalThis.crypto as Crypto & { randomUUID?: () => string }).randomUUID).toBe('function');
    const id = (globalThis.crypto as Crypto & { randomUUID?: () => string }).randomUUID?.();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});
