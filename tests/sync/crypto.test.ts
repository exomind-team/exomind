/**
 * 加密模块单元测试
 *
 * 测试 AES-256-GCM 加密功能：
 * - PBKDF2 密钥派生
 * - 加密/解密
 * - 跨设备兼容性（相同密码生成相同密钥）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  CryptoAdapter,
  deriveKeyFromPassword,
  encryptAes256,
  decryptAes256,
  quickEncrypt,
  quickDecrypt,
} from '../../src/adapters/crypto-adapter';

describe('CryptoAdapter', () => {
  let crypto: CryptoAdapter;

  beforeEach(() => {
    crypto = new CryptoAdapter();
  });

  afterEach(() => {
    crypto.clear();
  });

  describe('setPassword', () => {
    it('应该正确设置密码并派生密钥', async () => {
      await crypto.setPassword('test-password');

      // 不应该抛出错误
      expect(true).toBe(true);
    });

    it('相同密码应该生成可互换的密钥', async () => {
      await crypto.setPassword('test-password');
      const key1 = await crypto.deriveKeyFromPassword('test-password');

      // 创建新的适配器
      const crypto2 = new CryptoAdapter();
      await crypto2.setPassword('test-password');

      // 验证加密/解密可以互换使用
      const plaintext = 'secret data';
      const encrypted = await crypto.encrypt(plaintext);
      const decrypted = await crypto2.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });
  });

  describe('encrypt/decrypt', () => {
    it('应该正确加密和解密数据', async () => {
      await crypto.setPassword('my-password');
      const plaintext = 'Hello, ExoMind!';

      const encrypted = await crypto.encrypt(plaintext);
      const decrypted = await crypto.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('应该正确加密空字符串', async () => {
      await crypto.setPassword('my-password');
      const plaintext = '';

      const encrypted = await crypto.encrypt(plaintext);
      const decrypted = await crypto.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('应该正确加密中文内容', async () => {
      await crypto.setPassword('my-password');
      const plaintext = '你好，世界！这是 ExoMind。';

      const encrypted = await crypto.encrypt(plaintext);
      const decrypted = await crypto.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('应该正确加密特殊字符', async () => {
      await crypto.setPassword('my-password');
      const plaintext = '!@#$%^&*()_+-=[]{}|;\':",./<>?`~';

      const encrypted = await crypto.encrypt(plaintext);
      const decrypted = await crypto.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('应该正确加密 JSON 对象', async () => {
      await crypto.setPassword('my-password');
      const plaintext = JSON.stringify({
        apiKey: 'sk-xxx',
        settings: { theme: 'dark' },
      });

      const encrypted = await crypto.encrypt(plaintext);
      const decrypted = await crypto.decrypt(encrypted);

      expect(JSON.parse(decrypted)).toEqual({
        apiKey: 'sk-xxx',
        settings: { theme: 'dark' },
      });
    });

    it('每次加密应该生成不同的密文（随机 IV）', async () => {
      await crypto.setPassword('my-password');
      const plaintext = 'same data';

      const encrypted1 = await crypto.encrypt(plaintext);
      const encrypted2 = await crypto.encrypt(plaintext);

      expect(encrypted1).not.toBe(encrypted2);

      // 但解密后应该相同
      const decrypted1 = await crypto.decrypt(encrypted1);
      const decrypted2 = await crypto.decrypt(encrypted2);

      expect(decrypted1).toBe(plaintext);
      expect(decrypted2).toBe(plaintext);
    });

    it('未设置密码时应该抛出错误', async () => {
      await expect(crypto.encrypt('test')).rejects.toThrow(
        'Password not set. Call setPassword() first.'
      );
    });

    it('未设置密码时解密应该抛出错误', async () => {
      await expect(crypto.decrypt('test')).rejects.toThrow(
        'Password not set. Call setPassword() first.'
      );
    });

    it('错误密码应该导致解密失败', async () => {
      await crypto.setPassword('correct-password');
      const plaintext = 'secret data';
      const encrypted = await crypto.encrypt(plaintext);

      const crypto2 = new CryptoAdapter();
      await crypto2.setPassword('wrong-password');

      // AES-GCM 会验证完整性，错误密钥会导致失败
      await expect(crypto2.decrypt(encrypted)).rejects.toThrow();
    });
  });

  describe('deriveKeyFromPassword', () => {
    it('应该派生有效的 CryptoKey', async () => {
      const key = await deriveKeyFromPassword('test-password');

      expect(key).toBeDefined();
      expect(key.algorithm.name).toBe('AES-GCM');
      expect(key.algorithm.length).toBe(256);
    });

    it('相同密码应该生成可互换使用的密钥', async () => {
      const cryptoA = new CryptoAdapter();
      const cryptoB = new CryptoAdapter();

      await cryptoA.setPassword('test-password');
      await cryptoB.setPassword('test-password');

      const plaintext = 'test data';

      // A 加密，B 能解密
      const encrypted = await cryptoA.encrypt(plaintext);
      const decrypted = await cryptoB.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('不同密码应该生成不同的密钥', async () => {
      const cryptoA = new CryptoAdapter();
      const cryptoB = new CryptoAdapter();

      await cryptoA.setPassword('password1');
      await cryptoB.setPassword('password2');

      const plaintext = 'test data';

      // 两者都能正常加密
      const encryptedA = await cryptoA.encrypt(plaintext);
      const encryptedB = await cryptoB.encrypt(plaintext);

      // 但解密会失败（A 的密文用 B 解密）
      await expect(cryptoB.decrypt(encryptedA)).rejects.toThrow();
    });
  });

  describe('clear', () => {
    it('应该清空密钥和密码', async () => {
      await crypto.setPassword('test-password');
      await crypto.encrypt('test'); // 应该成功

      crypto.clear();

      // 再次加密应该失败
      await expect(crypto.encrypt('test')).rejects.toThrow(
        'Password not set. Call setPassword() first.'
      );
    });
  });
});

describe('encryptAes256 / decryptAes256', () => {
  it('应该使用指定密码正确加密和解密', async () => {
    const plaintext = 'This is a secret message';
    const password = 'my-secret-password';

    const encrypted = await encryptAes256(plaintext, password);
    const decrypted = await decryptAes256(encrypted, password);

    expect(decrypted).toBe(plaintext);
  });

  it('应该正确处理长文本', async () => {
    const plaintext = 'A'.repeat(10000);
    const password = 'test-password';

    const encrypted = await encryptAes256(plaintext, password);
    const decrypted = await decryptAes256(encrypted, password);

    expect(decrypted).toBe(plaintext);
    expect(decrypted.length).toBe(10000);
  });

  it('应该正确处理 Unicode 字符', async () => {
    const plaintext = '🌟🚀🎯你好世界🔐💻';
    const password = 'test-password';

    const encrypted = await encryptAes256(plaintext, password);
    const decrypted = await decryptAes256(encrypted, password);

    expect(decrypted).toBe(plaintext);
  });

  it('应该生成有效的 Base64 输出', async () => {
    const plaintext = 'test data';
    const password = 'test-password';

    const encrypted = await encryptAes256(plaintext, password);

    // Base64 字符集
    expect(encrypted).toMatch(/^[A-Za-z0-9+/=]+$/);

    // 解码后应该有足够长度（IV 12字节）
    const decoded = new Uint8Array(
      atob(encrypted).split('').map((c) => c.charCodeAt(0))
    );
    expect(decoded.length).toBeGreaterThan(12);
  });
});

describe('quickEncrypt / quickDecrypt', () => {
  it('应该提供便捷的加密/解密接口', async () => {
    const plaintext = 'Quick encryption test';
    const password = 'quick-password';

    const encrypted = await quickEncrypt(plaintext, password);
    const decrypted = await quickDecrypt(encrypted, password);

    expect(decrypted).toBe(plaintext);
  });

  it('应该支持链式调用模式', async () => {
    const plaintext = 'Chain test';
    const password = 'chain-password';

    // 加密后直接解密
    const decrypted = await quickDecrypt(
      await quickEncrypt(plaintext, password),
      password
    );

    expect(decrypted).toBe(plaintext);
  });
});

describe('跨设备兼容性', () => {
  it('相同密码应该能在不同 CryptoAdapter 实例间解密', async () => {
    const plaintext = 'Cross-device test';
    const password = 'device-password';

    // 设备 A 加密
    const cryptoA = new CryptoAdapter();
    await cryptoA.setPassword(password);
    const encrypted = await cryptoA.encrypt(plaintext);

    // 设备 B 解密
    const cryptoB = new CryptoAdapter();
    await cryptoB.setPassword(password);
    const decrypted = await cryptoB.decrypt(encrypted);

    expect(decrypted).toBe(plaintext);
  });

  it('使用 quickEncrypt/quickDecrypt 应该兼容', async () => {
    const plaintext = 'API Key: sk-xxx';
    const password = 'api-key-password';

    // 设备 A
    const encrypted = await quickEncrypt(plaintext, password);

    // 设备 B
    const decrypted = await quickDecrypt(encrypted, password);

    expect(decrypted).toBe(plaintext);
  });
});
