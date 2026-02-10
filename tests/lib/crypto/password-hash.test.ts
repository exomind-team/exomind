/**
 * 密码哈希模块单元测试
 *
 * 测试 SPEC-302 定义的密码哈希功能：
 * - generateSalt: 生成随机盐
 * - sha256: SHA-256 哈希
 * - hashPassword: PBKDF2-HMAC-SHA256 哈希
 * - verifyPassword: 密码验证
 */

import { describe, it, expect } from 'vitest';
import {
  generateSalt,
  sha256,
  hashPassword,
  verifyPassword,
} from '@/adapters/crypto-adapter';

describe('generateSalt', () => {
  it('应该生成默认长度的 salt（16字节）', async () => {
    const salt = generateSalt();
    // Base64 编码：16字节 → ~24 字符
    expect(salt.length).toBe(24);
  });

  it('应该生成指定长度的 salt', async () => {
    const salt8 = generateSalt(8);
    const salt32 = generateSalt(32);

    // 8字节 Base64 → ~12 字符
    expect(salt8.length).toBe(12);
    // 32字节 Base64 → ~44 字符
    expect(salt32.length).toBe(44);
  });

  it('每次调用应该生成不同的 salt', async () => {
    const salt1 = generateSalt();
    const salt2 = generateSalt();

    expect(salt1).not.toBe(salt2);
  });

  it('应该只包含 Base64 安全字符', async () => {
    const salt = generateSalt();

    // Base64 字符集：字母、数字、+、/、=
    expect(salt).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});

describe('sha256', () => {
  it('应该生成 SHA-256 哈希（64字符十六进制）', async () => {
    const hash = await sha256('test');

    // SHA-256 = 32字节 = 64 十六进制字符
    expect(hash.length).toBe(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('相同输入应该生成相同哈希', async () => {
    const input = 'hello world';
    const hash1 = await sha256(input);
    const hash2 = await sha256(input);

    expect(hash1).toBe(hash2);
  });

  it('不同输入应该生成不同哈希', async () => {
    const hash1 = await sha256('password1');
    const hash2 = await sha256('password2');

    expect(hash1).not.toBe(hash2);
  });

  it('应该正确处理空字符串', async () => {
    const hash = await sha256('');

    // SHA-256(空字符串) 的已知哈希值
    expect(hash).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  it('应该正确处理 Unicode 字符', async () => {
    const hash = await sha256('你好世界');

    expect(hash.length).toBe(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });
});

describe('hashPassword', () => {
  it('应该生成 $pbkdf2$ 格式的哈希字符串', async () => {
    const hash = await hashPassword('mypassword', 'testsalt123');

    expect(hash).toMatch(/^\$pbkdf2\$.+\$.+$/);
  });

  it('相同密码 + 不同 salt 应该生成不同哈希', async () => {
    const password = 'samepassword';
    const salt1 = generateSalt();
    const salt2 = generateSalt();

    const hash1 = await hashPassword(password, salt1);
    const hash2 = await hashPassword(password, salt2);

    expect(hash1).not.toBe(hash2);
  });

  it('相同密码 + 相同 salt 应该生成相同哈希', async () => {
    const password = 'testpassword';
    const salt = 'samesalttest';

    const hash1 = await hashPassword(password, salt);
    const hash2 = await hashPassword(password, salt);

    expect(hash1).toBe(hash2);
  });

  it('应该正确处理特殊字符密码', async () => {
    const password = '!@#$%^&*()_+-=[]{}|;\':",./<>?`~';
    const salt = 'testsalt';

    const hash = await hashPassword(password, salt);

    expect(hash).toMatch(/^\$pbkdf2\$.+\$.+$/);
  });

  it('应该正确处理中文密码', async () => {
    const password = '密码123';
    const salt = 'testsalt';

    const hash = await hashPassword(password, salt);

    expect(hash).toMatch(/^\$pbkdf2\$.+\$.+$/);
  });
});

describe('verifyPassword', () => {
  it('正确密码应该验证通过', async () => {
    const password = 'correctpassword';
    const salt = 'testsalt123';
    const stored = await hashPassword(password, salt);

    const result = await verifyPassword(password, stored);

    expect(result).toBe(true);
  });

  it('错误密码应该验证失败', async () => {
    const correctPassword = 'correctpassword';
    const wrongPassword = 'wrongpassword';
    const salt = 'testsalt123';
    const stored = await hashPassword(correctPassword, salt);

    const result = await verifyPassword(wrongPassword, stored);

    expect(result).toBe(false);
  });

  it('应该处理空密码', async () => {
    const password = '';
    const salt = 'testsalt';
    const stored = await hashPassword(password, salt);

    const validResult = await verifyPassword(password, stored);
    const invalidResult = await verifyPassword('other', stored);

    expect(validResult).toBe(true);
    expect(invalidResult).toBe(false);
  });

  it('应该拒绝无效格式的 stored 字符串', async () => {
    const result = await verifyPassword('password', 'invalidsformat');

    expect(result).toBe(false);
  });

  it('应该拒绝错误算法前缀的 stored 字符串', async () => {
    const result = await verifyPassword('password', '$sha256$testsalt$hash');

    expect(result).toBe(false);
  });

  it('验证已验证过的相同密码应该始终返回 true', async () => {
    const password = 'mypassword';
    const salt = 'testsalt';
    const stored = await hashPassword(password, salt);

    // 多次验证应该都通过
    const result1 = await verifyPassword(password, stored);
    const result2 = await verifyPassword(password, stored);
    const result3 = await verifyPassword(password, stored);

    expect(result1).toBe(true);
    expect(result2).toBe(true);
    expect(result3).toBe(true);
  });
});

describe('密码哈希集成测试', () => {
  it('完整流程：注册 → 验证 → 失败验证', async () => {
    const username = 'testuser';
    const password = 'securePassword123';
    const wrongPassword = 'wrongPassword456';

    // 1. 生成 salt 并哈希密码（注册）
    const salt = generateSalt();
    const storedHash = await hashPassword(password, salt);

    // 2. 验证正确密码（登录）
    const validLogin = await verifyPassword(password, storedHash);
    expect(validLogin).toBe(true);

    // 3. 验证错误密码（应该失败）
    const invalidLogin = await verifyPassword(wrongPassword, storedHash);
    expect(invalidLogin).toBe(false);
  });

  it('相同密码在不同用户间应该产生不同哈希（因为 salt 不同）', async () => {
    const sharedPassword = 'samePassword!@#';

    // 用户 A
    const saltA = generateSalt();
    const hashA = await hashPassword(sharedPassword, saltA);

    // 用户 B
    const saltB = generateSalt();
    const hashB = await hashPassword(sharedPassword, saltB);

    // 哈希值应该不同
    expect(hashA).not.toBe(hashB);

    // 但两个都能验证通过
    expect(await verifyPassword(sharedPassword, hashA)).toBe(true);
    expect(await verifyPassword(sharedPassword, hashB)).toBe(true);
  });
});
