/**
 * 安全测试用例
 *
 * 测试覆盖：
 * 1. XSS 注入防护
 * 2. 密码安全
 * 3. 输入验证
 * 4. 认证安全
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { escapeHtml } from '@/lib/utils/html-sanitize';

// Mock localStorage
const mockLocalStorageData: Record<string, string> = {};

const mockLocalStorage = {
  getItem: vi.fn((key: string) => mockLocalStorageData[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    mockLocalStorageData[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete mockLocalStorageData[key];
  }),
  clear: vi.fn(() => {
    Object.keys(mockLocalStorageData).forEach(key => delete mockLocalStorageData[key]);
  }),
  length: 0,
  key: vi.fn((index: number) => Object.keys(mockLocalStorageData)[index] ?? null),
};

Object.defineProperty(globalThis, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
  configurable: true,
});

// 动态导入被测试模块
let useSyncStore: ReturnType<typeof import('@/ui/stores/sync-store').useSyncStore>;

describe('安全测试', () => {
  beforeEach(async () => {
    Object.keys(mockLocalStorageData).forEach(key => delete mockLocalStorageData[key]);
    vi.clearAllMocks();
    mockLocalStorageData['exomind:users'] = JSON.stringify([]);
    const module = await import('@/ui/stores/sync-store');
    useSyncStore = module.useSyncStore;
  });

  describe('XSS 注入防护', () => {
    it('应该转义 script 标签', () => {
      const malicious = '<script>alert("xss")</script>';
      const escaped = escapeHtml(malicious);
      expect(escaped).not.toContain('<script>');
      expect(escaped).toContain('&lt;script&gt;');
    });

    it('应该转义 HTML 标签', () => {
      const malicious = '<img src=x onerror=alert(1)>';
      const escaped = escapeHtml(malicious);
      expect(escaped).toContain('&lt;img');
      expect(escaped).toContain('&gt;');
    });

    it('应该转义尖括号阻止 HTML 解析', () => {
      const malicious = '<a href="javascript:alert(1)">click</a>';
      const escaped = escapeHtml(malicious);
      expect(escaped).toContain('&lt;a');
      expect(escaped).toContain('&gt;');
    });

    it('应该转义 iframe', () => {
      const malicious = '<iframe src="http://evil.com"></iframe>';
      const escaped = escapeHtml(malicious);
      expect(escaped).not.toContain('<iframe');
      expect(escaped).toContain('&lt;iframe');
    });

    it('应该转义 object 标签', () => {
      const malicious = '<object data="http://evil.com/malware.swf"></object>';
      const escaped = escapeHtml(malicious);
      expect(escaped).not.toContain('<object');
      expect(escaped).toContain('&lt;object');
    });

    it('应该转义 SVG 标签', () => {
      const malicious = '<svg onload="alert(1)"></svg>';
      const escaped = escapeHtml(malicious);
      expect(escaped).toContain('&lt;svg');
      expect(escaped).toContain('&gt;');
    });

    it('应该转义 style 内容中的特殊字符', () => {
      const malicious = '<div style="background:url(javascript:alert(1))">test</div>';
      const escaped = escapeHtml(malicious);
      expect(escaped).toContain('&lt;div');
      expect(escaped).toContain('&gt;');
    });

    it('应该转义引号', () => {
      const malicious = '"test" and \'test\'';
      const escaped = escapeHtml(malicious);
      expect(escaped).toContain('&quot;');
      expect(escaped).toContain('&#39;');
    });

    it('应该处理空字符串', () => {
      expect(escapeHtml('')).toBe('');
    });

    it('应该处理 Unicode 字符', () => {
      const malicious = '<script>alert("你好")</script>';
      const escaped = escapeHtml(malicious);
      expect(escaped).toContain('&lt;script&gt;');
      expect(escaped).toContain('你好'); // Unicode 保持
    });
  });

  describe('密码安全', () => {
    it('应该拒绝过短的密码', async () => {
      const { register } = useSyncStore.getState();
      await expect(register('user', '12345')).rejects.toThrow('密码长度至少6位');
    });

    it('应该拒绝空密码', async () => {
      const { register } = useSyncStore.getState();
      await expect(register('user', '')).rejects.toThrow('用户名和密码不能为空');
    });

    it('应该拒绝空用户名', async () => {
      const { register } = useSyncStore.getState();
      await expect(register('', 'password123')).rejects.toThrow('用户名和密码不能为空');
    });
  });

  describe('输入验证', () => {
    it('应该处理超长输入', () => {
      const longInput = 'a'.repeat(100000);
      const escaped = escapeHtml(longInput);
      expect(escaped.length).toBe(longInput.length);
    });

    it('应该处理包含所有特殊字符的输入', () => {
      const specialChars = '<>"\'\\\n\r\t';
      const escaped = escapeHtml(specialChars);
      expect(escaped).not.toContain('<');
      expect(escaped).not.toContain('>');
      expect(escaped).not.toContain('"');
      expect(escaped).not.toContain("'");
    });

    it('应该处理重复转义字符', () => {
      const input = '&&&&&&';
      const escaped = escapeHtml(input);
      expect(escaped).toBe('&amp;&amp;&amp;&amp;&amp;&amp;');
    });
  });

  describe('认证安全', () => {
    it('应该拒绝不存在的用户', async () => {
      const { login } = useSyncStore.getState();
      await expect(login('nonexistent', 'password123')).rejects.toThrow('用户不存在');
    });

    it('应该拒绝已存在的用户名注册', async () => {
      const { register } = useSyncStore.getState();
      await register('existinguser', 'password123');

      await expect(register('existinguser', 'differentpassword')).rejects.toThrow('用户名已存在');
    });

    it('应该支持多用户注册并隔离数据', async () => {
      const { register } = useSyncStore.getState();
      await register('user1', 'password1');
      await register('user2', 'password2');

      const storedUsers = JSON.parse(mockLocalStorageData['exomind:users']);
      expect(storedUsers.length).toBe(2);
      expect(storedUsers[0].username).not.toBe(storedUsers[1].username);
    });
  });
});
