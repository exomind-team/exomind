/**
 * Create UUID v4 with progressive fallback.
 * 生成 UUID v4，按能力逐级回退，兼容缺少 `crypto.randomUUID` 的浏览器。
 */
export function createUuidV4(): string {
  const runtimeCrypto = globalThis.crypto;

  if (runtimeCrypto && typeof runtimeCrypto.randomUUID === 'function') {
    return runtimeCrypto.randomUUID();
  }

  if (runtimeCrypto && typeof runtimeCrypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    runtimeCrypto.getRandomValues(bytes);

    // RFC 4122 v4: version + variant bits.
    // RFC 4122 v4：设置版本号与变体位。
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // Last fallback for legacy runtime; not cryptographically secure.
  // 末级兜底（旧环境），不具备密码学安全性。
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const randomNibble = Math.floor(Math.random() * 16);
    const value = char === 'x' ? randomNibble : (randomNibble & 0x3) | 0x8;
    return value.toString(16);
  });
}

/**
 * Ensure `crypto.randomUUID` exists for runtime compatibility.
 * 为运行时补齐 `crypto.randomUUID`，兼容非安全上下文/旧浏览器。
 */
export function ensureCryptoRandomUUID(): void {
  const runtimeCrypto = globalThis.crypto as (Crypto & { randomUUID?: () => string }) | undefined;
  if (!runtimeCrypto || typeof runtimeCrypto.randomUUID === 'function') {
    return;
  }

  const fallback = () => {
    if (typeof runtimeCrypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      runtimeCrypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    return createUuidV4();
  };

  try {
    runtimeCrypto.randomUUID = fallback as Crypto['randomUUID'];
    return;
  } catch {
    // ignore and retry with defineProperty
  }

  try {
    Object.defineProperty(runtimeCrypto, 'randomUUID', {
      value: fallback,
      configurable: true,
      writable: true,
    });
  } catch {
    // keep silent; callers should still use createUuidV4 when possible
  }
}
