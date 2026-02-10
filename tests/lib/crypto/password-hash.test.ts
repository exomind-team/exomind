/**
 * 密码哈希模块单元测试
 */

import { describe, it, expect } from 'vitest';
import {
  generateSalt,
  sha256,
  hashPassword,
  verifyPassword,
} from '@/adapters/crypto-adapter';

describe('generateSalt', () => {
  it('应该生成默认长度的 salt', async () => {
    const salt = generateSalt();
    expect(salt.length).toBe(24);
  });

  it('应该生成指定长度的 salt', async () => {
    const salt8 = generateSalt(8);
    const salt32 = generateSalt(32);
    expect(salt8.length).toBe(12);
    expect(salt32.length).toBe(44);
  });

  it('每次调用应该生成不同的 salt', async () => {
    const salt1 = generateSalt();
    const salt2 = generateSalt();
    expect(salt1).not.toBe(salt2);
  });

  it('应该只包含 Base64 安全字符', async () => {
    const salt = generateSalt();
    expect(salt).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});

describe('sha256', () => {
  it('应该生成 SHA-256 哈希', async () => {
    const hash = await sha256('test');
    expect(hash.length).toBe(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('相同输入应该生成相同哈希', async () => {
    const hash1 = await sha256('hello');
    const hash2 = await sha256('hello');
    expect(hash1).toBe(hash2);
  });

  it('不同输入应该生成不同哈希', async () => {
    const hash1 = await sha256('pass1');
    const hash2 = await sha256('pass2');
    expect(hash1).not.toBe(hash2);
  });

  it('应该正确处理空字符串', async () => {
    const hash = await sha256('');
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('hashPassword', () => {
  it('应该生成 $pbkdf2$ 格式', async () => {
    const hash = await hashPassword('pwd', 'salt');
    expect(hash).toMatch(/^\$pbkdf2\$.+\$.+$/);
  });

  it('相同密码 + 不同 salt 应该生成不同哈希', async () => {
    const hash1 = await hashPassword('pwd', generateSalt());
    const hash2 = await hashPassword('pwd', generateSalt());
    expect(hash1).not.toBe(hash2);
  });
});

describe('verifyPassword', () => {
  it('正确密码应该验证通过', async () => {
    const pwd = 'mypassword';
    const salt = 'testsalt';
    const stored = await hashPassword(pwd, salt);
    expect(await verifyPassword(pwd, stored)).toBe(true);
  });

  it('错误密码应该验证失败', async () => {
    const pwd = 'correct';
    const stored = await hashPassword(pwd, 'salt');
    expect(await verifyPassword('wrong', stored)).toBe(false);
  });

  it('应该拒绝无效格式', async () => {
    expect(await verifyPassword('pwd', 'invalid')).toBe(false);
  });
});

describe('集成测试', () => {
  it('完整注册登录流程', async () => {
    const pwd = 'secure123';
    const salt = generateSalt();
    const stored = await hashPassword(pwd, salt);
    expect(await verifyPassword(pwd, stored)).toBe(true);
    expect(await verifyPassword('wrong', stored)).toBe(false);
  });
});

describe('deriveKeyFromPassword', () => {
  it('应该成功派生密钥', async () => {
    const { deriveKeyFromPassword } = await import('@/adapters/crypto-adapter');
    const key = await deriveKeyFromPassword('test-password');
    expect(key).toBeDefined();
    expect(key.type).toBe('secret');
    expect(key.algorithm.name).toBe('AES-GCM');
    expect(key.usages).toContain('encrypt');
    expect(key.usages).toContain('decrypt');
  });

  it('相同密码应该生成相同密钥', async () => {
    const { deriveKeyFromPassword } = await import('@/adapters/crypto-adapter');
    const key1 = await deriveKeyFromPassword('same-password');
    const key2 = await deriveKeyFromPassword('same-password');

    // 验证两个密钥等效（可以相互加解密）
    const encoder = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = encoder.encode('test');

    const encrypted1 = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key1,
      data
    );

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key2,
      encrypted1
    );

    expect(new TextDecoder().decode(decrypted)).toBe('test');
  });
});

describe('hashPasswordWithSalt', () => {
  it('应该自动生成盐并返回格式化哈希', async () => {
    const { hashPasswordWithSalt } = await import('@/adapters/crypto-adapter');
    const hash = await hashPasswordWithSalt('mypassword');

    expect(hash).toMatch(/^\$pbkdf2\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  });

  it('相同密码应该生成不同哈希（因为盐不同）', async () => {
    const { hashPasswordWithSalt } = await import('@/adapters/crypto-adapter');
    const hash1 = await hashPasswordWithSalt('same-password');
    const hash2 = await hashPasswordWithSalt('same-password');

    expect(hash1).not.toBe(hash2);

    // 但都应该能验证通过
    expect(await verifyPassword('same-password', hash1)).toBe(true);
    expect(await verifyPassword('same-password', hash2)).toBe(true);
  });
});

describe('加密解密', () => {
  it('quickEncrypt 应该加密数据', async () => {
    const { quickEncrypt } = await import('@/adapters/crypto-adapter');
    const ciphertext = await quickEncrypt('secret data', 'password');

    expect(ciphertext).toBeDefined();
    expect(ciphertext.length).toBeGreaterThan(0);
    // Base64 编码应该有 padding
    expect(ciphertext).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('quickDecrypt 应该解密数据', async () => {
    const { quickEncrypt, quickDecrypt } = await import('@/adapters/crypto-adapter');
    const plaintext = '要保密的内容';
    const password = 'my-secret-password';

    const ciphertext = await quickEncrypt(plaintext, password);
    const decrypted = await quickDecrypt(ciphertext, password);

    expect(decrypted).toBe(plaintext);
  });

  it('错误密码应该解密失败', async () => {
    const { quickEncrypt, quickDecrypt } = await import('@/adapters/crypto-adapter');
    const ciphertext = await quickEncrypt('secret', 'correct-password');

    await expect(quickDecrypt(ciphertext, 'wrong-password')).rejects.toThrow();
  });
});

describe('encryptAes256 和 decryptAes256', () => {
  it('应该能加密和解密', async () => {
    const { encryptAes256, decryptAes256 } = await import('@/adapters/crypto-adapter');
    const plaintext = '测试加密数据 123!@#';
    const password = 'test-pwd';

    const ciphertext = await encryptAes256(plaintext, password);
    const decrypted = await decryptAes256(ciphertext, password);

    expect(decrypted).toBe(plaintext);
  });

  it('相同明文+密码应该生成不同密文（因为 IV 不同）', async () => {
    const { encryptAes256 } = await import('@/adapters/crypto-adapter');
    const plaintext = 'same content';
    const password = 'same password';

    const cipher1 = await encryptAes256(plaintext, password);
    const cipher2 = await encryptAes256(plaintext, password);

    expect(cipher1).not.toBe(cipher2);
  });
});

describe('CryptoAdapter 类', () => {
  it('应该能够设置密码和加密', async () => {
    const { CryptoAdapter } = await import('@/adapters/crypto-adapter');
    const adapter = new CryptoAdapter();

    await adapter.setPassword('adapter-password');
    const ciphertext = await adapter.encrypt('adapter secret');

    expect(ciphertext).toBeDefined();
  });

  it('应该能够解密已加密的数据', async () => {
    const { CryptoAdapter } = await import('@/adapters/crypto-adapter');
    const adapter = new CryptoAdapter();

    await adapter.setPassword('adapter-password');
    const ciphertext = await adapter.encrypt('adapter secret');
    const decrypted = await adapter.decrypt(ciphertext);

    expect(decrypted).toBe('adapter secret');
  });

  it('未设置密码时 encrypt 应该抛出错误', async () => {
    const { CryptoAdapter } = await import('@/adapters/crypto-adapter');
    const adapter = new CryptoAdapter();

    await expect(adapter.encrypt('test')).rejects.toThrow('Password not set');
  });

  it('未设置密码时 decrypt 应该抛出错误', async () => {
    const { CryptoAdapter } = await import('@/adapters/crypto-adapter');
    const adapter = new CryptoAdapter();

    await expect(adapter.decrypt('test')).rejects.toThrow('Password not set');
  });

  it('clear 应该清空密钥', async () => {
    const { CryptoAdapter } = await import('@/adapters/crypto-adapter');
    const adapter = new CryptoAdapter();

    await adapter.setPassword('test');
    adapter.clear();

    await expect(adapter.encrypt('test')).rejects.toThrow('Password not set');
  });

  it('实例方法应该正确工作', async () => {
    const { CryptoAdapter } = await import('@/adapters/crypto-adapter');
    const adapter = new CryptoAdapter();

    // 测试 generateSalt
    const salt = adapter.generateSalt(16);
    expect(salt.length).toBe(24);

    // 测试 sha256
    const hash = await adapter.sha256('test');
    expect(hash.length).toBe(64);

    // 测试 hashPassword
    const pwdHash = await adapter.hashPassword('pwd', 'salt');
    expect(pwdHash).toMatch(/^\$pbkdf2\$/);

    // 测试 verifyPassword
    const isValid = await adapter.verifyPassword('pwd', pwdHash);
    expect(isValid).toBe(true);
  });

  it('deriveKeyFromPassword 应该返回密钥', async () => {
    const { CryptoAdapter } = await import('@/adapters/crypto-adapter');
    const adapter = new CryptoAdapter();

    const key = await adapter.deriveKeyFromPassword('test');
    expect(key).toBeDefined();
    expect(key.type).toBe('secret');
  });
});
