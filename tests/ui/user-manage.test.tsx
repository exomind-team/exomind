/**
 * UserManagePage 静态分析测试
 *
 * 测试用户管理页面的静态导入和组件结构
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('UserManagePage 文件结构', () => {
  const userManagePagePath = path.resolve('src/ui/pages/UserManagePage.tsx');

  it('应该存在 UserManagePage.tsx 文件', () => {
    expect(fs.existsSync(userManagePagePath)).toBe(true);
  });

  it('应该导出 UserManagePage 组件', async () => {
    const { UserManagePage } = await import('@/ui/pages/UserManagePage');
    expect(UserManagePage).toBeDefined();
    expect(typeof UserManagePage).toBe('function');
  });
});

describe('UserManagePage 依赖检查', () => {
  const userManagePagePath = path.resolve('src/ui/pages/UserManagePage.tsx');
  const content = fs.readFileSync(userManagePagePath, 'utf-8');

  it('应该导入 Card 组件', () => {
    expect(content).toContain("from '@/components/ui/card'");
  });

  it('应该导入 Button 组件', () => {
    expect(content).toContain("from '@/components/ui/button'");
  });

  it('应该导入 Input 组件', () => {
    expect(content).toContain("from '@/components/ui/input'");
  });

  it('应该导入 Label 组件', () => {
    expect(content).toContain("from '@/components/ui/label'");
  });

  it('应该导入 Badge 组件', () => {
    expect(content).toContain("from '@/components/ui/badge'");
  });

  it('应该导入 useSyncStore', () => {
    expect(content).toContain("from '@/ui/stores/sync-store'");
  });
});

describe('UserManagePage 路由注册', () => {
  const routesPath = path.resolve('src/routes.tsx');
  const routesContent = fs.readFileSync(routesPath, 'utf-8');

  it('应该导入 UserManagePage', () => {
    expect(routesContent).toContain('UserManagePage');
  });

  it('应该定义 /user-manage 路由', () => {
    expect(routesContent).toContain("path: 'user-manage'");
  });

  it('路由应该使用 UserManagePage 组件', () => {
    expect(routesContent).toContain('<UserManagePage />');
  });
});

describe('UserManagePage 功能完整性', () => {
  const userManagePagePath = path.resolve('src/ui/pages/UserManagePage.tsx');
  const content = fs.readFileSync(userManagePagePath, 'utf-8');

  it('应该包含用户管理标题', () => {
    expect(content).toContain('用户管理');
  });

  it('应该包含当前用户状态 UI', () => {
    expect(content).toContain('当前用户');
  });

  it('应该包含用户注册 UI', () => {
    expect(content).toContain('注册新用户');
  });

  it('应该包含已注册用户列表 UI', () => {
    expect(content).toContain('已注册用户');
  });

  it('应该包含使用说明 UI', () => {
    expect(content).toContain('使用说明');
  });

  it('应该使用 useSyncStore hooks', () => {
    expect(content).toContain('useSyncStore()');
  });

  it('应该使用 useState 管理用户列表', () => {
    expect(content).toContain('useState<UserInfo[]>([])');
  });

  it('应该使用 useState 管理注册表单', () => {
    expect(content).toContain('newUsername');
    expect(content).toContain('newPassword');
    expect(content).toContain('confirmPassword');
  });

  it('应该使用 useEffect 获取用户列表', () => {
    expect(content).toContain('useEffect');
    expect(content).toContain('localStorage');
  });
});

describe('UserManagePage 事件处理器', () => {
  const userManagePagePath = path.resolve('src/ui/pages/UserManagePage.tsx');
  const content = fs.readFileSync(userManagePagePath, 'utf-8');

  it('应该定义 handleRegister 函数', () => {
    expect(content).toContain('handleRegister');
  });

  it('应该定义 handleQuickLogin 函数', () => {
    expect(content).toContain('handleQuickLogin');
  });

  it('应该定义 handleLogout 函数', () => {
    expect(content).toContain('handleLogout');
  });
});

describe('UserManagePage 安全标记', () => {
  const userManagePagePath = path.resolve('src/ui/pages/UserManagePage.tsx');
  const content = fs.readFileSync(userManagePagePath, 'utf-8');

  it('应该标记明文密码问题待后续修复', () => {
    expect(content).toContain('TODO');
    expect(content).toContain('明文密码');
    expect(content).toContain('PBKDF2');
  });

  it('应该使用 type="password" 隐藏密码输入', () => {
    expect(content).toContain('type="password"');
  });
});

describe('UserManagePage UI 改进', () => {
  const userManagePagePath = path.resolve('src/ui/pages/UserManagePage.tsx');
  const content = fs.readFileSync(userManagePagePath, 'utf-8');

  it('应该添加确认密码输入框', () => {
    expect(content).toContain('confirmPassword');
    expect(content).toContain('确认密码');
  });

  it('应该移除 prompt 弹窗改用内联输入', () => {
    expect(content).not.toContain('prompt(');
  });

  it('应该实现 showLoginForm 状态控制登录表单显示', () => {
    expect(content).toContain('showLoginForm');
  });

  it('应该实现 loginUsername 和 loginPassword 状态', () => {
    expect(content).toContain('loginUsername');
    expect(content).toContain('loginPassword');
  });
});
