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
