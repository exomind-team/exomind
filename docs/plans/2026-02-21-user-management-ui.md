# 多用户管理界面 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在新 UI 设置页中嵌入符合设计稿的用户管理入口，对齐注册/登录/退出/切换账户核心流程。

**Architecture:** 重构 NewSettingsPage 顶部的 User Card 区域，使其根据登录状态显示不同 UI。已登录时显示用户信息 + 切换账户/登出按钮；未登录时显示登录/注册按钮。点击「切换账户」弹出底部 Sheet（基于 Dialog 改造）。删除旧的内嵌 UserManagePage section，改为开发者模式下的跳转链接。

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Radix UI Dialog, Zustand, lucide-react

---

## 设计决策

### User Card 两种状态

| 状态 | 显示内容 | 操作按钮 |
|------|---------|---------|
| 已登录 | 头像 + 用户名 + 副标题「轻触头像更换」 | 「切换账户」+「登出」 |
| 未登录 | 默认头像 + 「未登录」 | 「登录」+「注册」 |

### 底部 Sheet

- 基于现有 Radix Dialog 改造，CSS 动画实现底部弹出
- 内容：已注册用户列表（点击选择 → 输入密码 → 登录）
- 不新增 npm 依赖

### 旧 UserManagePage 入口

- 从「账号与用户」section 移除内嵌的 `<UserManagePage embedded />`
- 在开发者模式 section 中新增「多用户管理（旧版）」跳转按钮

---

## Task 1: 创建 BottomSheet 组件

**Files:**
- Create: `src/components/ui/bottom-sheet.tsx`

**Step 1: 创建 BottomSheet 组件**

基于 Radix Dialog 封装，底部弹出动画。

```tsx
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const BottomSheet = DialogPrimitive.Root;
const BottomSheetTrigger = DialogPrimitive.Trigger;
const BottomSheetClose = DialogPrimitive.Close;
const BottomSheetPortal = DialogPrimitive.Portal;

const BottomSheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className,
    )}
    {...props}
  />
));
BottomSheetOverlay.displayName = 'BottomSheetOverlay';

const BottomSheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <BottomSheetPortal>
    <BottomSheetOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-white p-6 shadow-lg duration-300',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        'data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
        className,
      )}
      {...props}
    >
      <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-stone-300" />
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-full p-1 text-stone-400 hover:text-stone-600">
        <X className="h-5 w-5" />
        <span className="sr-only">关闭</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </BottomSheetPortal>
));
BottomSheetContent.displayName = 'BottomSheetContent';

const BottomSheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-base font-semibold text-stone-900', className)}
    {...props}
  />
));
BottomSheetTitle.displayName = 'BottomSheetTitle';

export {
  BottomSheet,
  BottomSheetTrigger,
  BottomSheetClose,
  BottomSheetContent,
  BottomSheetTitle,
};
```

**Step 2: 验证 Tailwind 动画类可用**

项目使用 tailwindcss-animate 插件，`slide-in-from-bottom` / `slide-out-to-bottom` 已内置。

**Step 3: Commit**

```bash
git add src/components/ui/bottom-sheet.tsx
git commit -m "feat(ui): add BottomSheet component based on Radix Dialog"
```

---

## Task 2: 创建 UserCard 组件

**Files:**
- Create: `src/ui/new/components/UserCard.tsx`

**Step 1: 创建 UserCard 组件**

从 `useSyncStore` 读取登录状态，根据状态渲染不同 UI。

```tsx
import { useState } from 'react';
import { Users, LogOut, LogIn, UserPlus } from 'lucide-react';
import { useSyncStore } from '@/ui/stores/sync-store';
import { SwitchAccountSheet } from './SwitchAccountSheet';

export function UserCard() {
  const { isLoggedIn, currentUser, logout } = useSyncStore();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<'switch' | 'login' | 'register'>('switch');

  const handleLogout = async () => {
    await logout();
  };

  const handleOpenSheet = (mode: 'switch' | 'login' | 'register') => {
    setSheetMode(mode);
    setSheetOpen(true);
  };

  return (
    <>
      <section className="rounded-[20px] border border-white/30 bg-gradient-to-br from-[#E8866F] via-[#D4664A] to-[#C75B3A] p-5 text-white shadow-[0_8px_24px_-4px_rgba(199,91,58,0.3),0_20px_40px_-8px_rgba(199,91,58,0.2),0_3px_8px_rgba(255,255,255,0.3)]">
        <div className="flex items-center gap-3.5">
          {/* 头像 */}
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 border-white/40 bg-white/20 text-2xl font-bold">
            {isLoggedIn && currentUser ? currentUser[0].toUpperCase() : '?'}
          </div>
          {/* 用户信息 */}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xl font-bold">
              {isLoggedIn && currentUser ? currentUser : '未登录'}
            </p>
            <p className="text-[13px] text-white/60">
              {isLoggedIn ? '轻触头像更换' : '登录以启用多设备同步'}
            </p>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="mt-4 flex items-center gap-2">
          {isLoggedIn ? (
            <>
              <button
                type="button"
                onClick={() => handleOpenSheet('switch')}
                className="flex items-center gap-1.5 rounded-[10px] bg-white/20 px-3 py-2 text-[13px] font-medium text-white/80 transition-colors hover:bg-white/30"
              >
                <Users className="h-[15px] w-[15px]" />
                切换账户
              </button>
              <div className="flex-1" />
              <button
                type="button"
                onClick={handleLogout}
                className="flex items-center gap-1.5 rounded-[10px] bg-white/20 px-3 py-2 text-[13px] font-medium text-[#FFD0C8] transition-colors hover:bg-white/30"
              >
                <LogOut className="h-[15px] w-[15px]" />
                登出
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => handleOpenSheet('login')}
                className="flex items-center gap-1.5 rounded-[10px] bg-white/20 px-3 py-2 text-[13px] font-medium text-white/80 transition-colors hover:bg-white/30"
              >
                <LogIn className="h-[15px] w-[15px]" />
                登录
              </button>
              <button
                type="button"
                onClick={() => handleOpenSheet('register')}
                className="flex items-center gap-1.5 rounded-[10px] bg-white/20 px-3 py-2 text-[13px] font-medium text-white/80 transition-colors hover:bg-white/30"
              >
                <UserPlus className="h-[15px] w-[15px]" />
                注册
              </button>
            </>
          )}
        </div>
      </section>

      <SwitchAccountSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        initialMode={sheetMode}
      />
    </>
  );
}
```

**Step 2: Commit**

```bash
git add src/ui/new/components/UserCard.tsx
git commit -m "feat(ui): add UserCard component with login state awareness"
```

---

## Task 3: 创建 SwitchAccountSheet 组件

**Files:**
- Create: `src/ui/new/components/SwitchAccountSheet.tsx`

**Step 1: 创建 SwitchAccountSheet 组件**

底部弹出 Sheet，包含三种模式：切换账户（用户列表）、登录表单、注册表单。

```tsx
import { useState, useEffect } from 'react';
import { BottomSheet, BottomSheetContent, BottomSheetTitle } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSyncStore } from '@/ui/stores/sync-store';
import { ChevronLeft } from 'lucide-react';

interface UserInfo {
  username: string;
  passwordHash: string;
  createdAt: string;
  lastLogin?: string;
}

interface SwitchAccountSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode: 'switch' | 'login' | 'register';
}

export function SwitchAccountSheet({ open, onOpenChange, initialMode }: SwitchAccountSheetProps) {
  const [mode, setMode] = useState(initialMode);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { login, register, currentUser } = useSyncStore();

  // 同步 initialMode
  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setError('');
      setPassword('');
      setUsername('');
      setRegPassword('');
      setConfirmPassword('');
      setSelectedUser(null);
    }
  }, [open, initialMode]);

  // 加载用户列表
  useEffect(() => {
    if (open) {
      const stored = localStorage.getItem('exomind:users');
      if (stored) {
        setUsers(JSON.parse(stored));
      }
    }
  }, [open]);

  const handleLogin = async (loginUsername: string, loginPassword: string) => {
    setError('');
    setLoading(true);
    try {
      await login(loginUsername, loginPassword);
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    setError('');
    if (regPassword !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    setLoading(true);
    try {
      await register(username, regPassword);
      // 注册成功后自动登录
      await login(username, regPassword);
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const renderSwitchMode = () => (
    <div className="space-y-3">
      <BottomSheetTitle>切换账户</BottomSheetTitle>
      {users.length === 0 ? (
        <p className="py-4 text-center text-sm text-stone-400">暂无已注册用户</p>
      ) : (
        <div className="space-y-2">
          {users.map((user) => (
            <div key={user.username}>
              <button
                type="button"
                onClick={() => setSelectedUser(selectedUser === user.username ? null : user.username)}
                className={`w-full rounded-xl border p-3 text-left transition-colors ${
                  user.username === currentUser
                    ? 'border-[#C75B3A]/30 bg-[#C75B3A]/5'
                    : selectedUser === user.username
                      ? 'border-[#C75B3A]/50 bg-[#FAF7F5]'
                      : 'border-[#F0ECE8] hover:bg-[#FAF7F5]'
                }`}
                disabled={loading}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-stone-800">{user.username}</p>
                    <p className="text-[11px] text-stone-400">
                      注册于 {new Date(user.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  {user.username === currentUser && (
                    <span className="rounded-full bg-[#C75B3A]/10 px-2 py-0.5 text-[11px] font-medium text-[#C75B3A]">
                      当前
                    </span>
                  )}
                </div>
              </button>
              {selectedUser === user.username && user.username !== currentUser && (
                <div className="mt-2 flex items-center gap-2 px-1">
                  <Input
                    type="password"
                    placeholder="输入密码"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                    className="h-9 text-sm"
                  />
                  <Button
                    size="sm"
                    className="h-9 shrink-0 rounded-xl bg-[#C75B3A] text-xs hover:bg-[#B24D2F]"
                    onClick={() => handleLogin(user.username, password)}
                    disabled={loading || !password}
                  >
                    登录
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="border-t border-[#F0ECE8] pt-3">
        <Button
          variant="outline"
          className="w-full rounded-xl text-xs"
          onClick={() => { setMode('register'); setError(''); }}
        >
          注册新账户
        </Button>
      </div>
    </div>
  );

  const renderLoginMode = () => (
    <div className="space-y-3">
      <BottomSheetTitle>登录</BottomSheetTitle>
      <div className="space-y-2">
        <Label htmlFor="login-username" className="text-xs text-stone-500">用户名</Label>
        <Input
          id="login-username"
          placeholder="请输入用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={loading}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="login-password" className="text-xs text-stone-500">密码</Label>
        <Input
          id="login-password"
          type="password"
          placeholder="请输入密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <Button
        className="w-full rounded-xl bg-[#C75B3A] hover:bg-[#B24D2F]"
        onClick={() => handleLogin(username, password)}
        disabled={loading || !username || !password}
      >
        {loading ? '登录中...' : '登录'}
      </Button>
      <button
        type="button"
        className="flex w-full items-center justify-center gap-1 text-xs text-stone-400"
        onClick={() => { setMode('register'); setError(''); }}
      >
        没有账户？去注册
      </button>
    </div>
  );

  const renderRegisterMode = () => (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => { setMode(initialMode === 'register' ? 'login' : 'switch'); setError(''); }}
          className="rounded-lg p-1 text-stone-400 hover:text-stone-600"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <BottomSheetTitle>注册新账户</BottomSheetTitle>
      </div>
      <div className="space-y-2">
        <Label htmlFor="reg-username" className="text-xs text-stone-500">用户名</Label>
        <Input
          id="reg-username"
          placeholder="请输入用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={loading}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="reg-password" className="text-xs text-stone-500">密码</Label>
        <Input
          id="reg-password"
          type="password"
          placeholder="请输入密码（至少6位）"
          value={regPassword}
          onChange={(e) => setRegPassword(e.target.value)}
          disabled={loading}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="reg-confirm" className="text-xs text-stone-500">确认密码</Label>
        <Input
          id="reg-confirm"
          type="password"
          placeholder="请再次输入密码"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          disabled={loading}
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <Button
        className="w-full rounded-xl bg-[#C75B3A] hover:bg-[#B24D2F]"
        onClick={handleRegister}
        disabled={loading || !username || !regPassword || !confirmPassword}
      >
        {loading ? '注册中...' : '注册'}
      </Button>
      <button
        type="button"
        className="flex w-full items-center justify-center gap-1 text-xs text-stone-400"
        onClick={() => { setMode('login'); setError(''); }}
      >
        已有账户？去登录
      </button>
    </div>
  );

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <BottomSheetContent>
        {mode === 'switch' && renderSwitchMode()}
        {mode === 'login' && renderLoginMode()}
        {mode === 'register' && renderRegisterMode()}
      </BottomSheetContent>
    </BottomSheet>
  );
}
```

**Step 2: Commit**

```bash
git add src/ui/new/components/SwitchAccountSheet.tsx
git commit -m "feat(ui): add SwitchAccountSheet with login/register/switch modes"
```

---

## Task 4: 重构 NewSettingsPage

**Files:**
- Modify: `src/ui/new/pages/NewSettingsPage.tsx`

**Step 1: 替换 User Card section**

将现有的硬编码 User Card（224-239行）替换为新的 `<UserCard />` 组件。

**Step 2: 删除「账号与用户」section**

删除 349-359 行的 `<UserManagePage embedded />` 内嵌 section。

**Step 3: 在开发者模式中添加旧版用户管理入口**

在开发者模式的按钮列表中新增「多用户管理（旧版）」按钮，点击跳转到 `/user-manage`。

**Step 4: 清理无用 import**

移除 `UserManagePage` 和 `Users` 的 import。

**具体改动：**

1. 添加 import：
```tsx
import { UserCard } from '@/ui/new/components/UserCard';
```

2. 移除 import：
```tsx
// 删除这行
import { UserManagePage } from '@/ui/pages/UserManagePage';
// 从 lucide-react import 中移除 Users
```

3. 替换 User Card section（224-239行）为：
```tsx
<UserCard />
```

4. 删除「账号与用户」section（349-359行整个 section）

5. 在开发者模式按钮区域（381-387行）新增：
```tsx
<Button
  type="button"
  variant="outline"
  className="h-8 rounded-xl text-xs"
  onClick={() => { window.location.pathname = '/user-manage'; }}
>
  多用户管理（旧版）
</Button>
```

**Step 5: Commit**

```bash
git add src/ui/new/pages/NewSettingsPage.tsx
git commit -m "refactor(settings): replace embedded UserManagePage with UserCard component"
```

---

## Task 5: 构建验证

**Step 1: 运行类型检查**

```bash
bun run build
```

Expected: 构建成功，无类型错误。

**Step 2: 修复任何构建错误**

如有错误，逐一修复。

**Step 3: Commit（如有修复）**

```bash
git add -A
git commit -m "fix: resolve build errors from user management UI refactor"
```

---

## Task 6: 单元测试

**Files:**
- Create: `src/ui/new/components/__tests__/UserCard.test.tsx`

**Step 1: 编写 UserCard 测试**

测试两种状态（已登录/未登录）的渲染和交互。

**Step 2: 运行测试**

```bash
bun test src/ui/new/components/__tests__/UserCard.test.tsx
```

**Step 3: Commit**

```bash
git add src/ui/new/components/__tests__/UserCard.test.tsx
git commit -m "test: add UserCard component tests"
```

---

## 文件变更总结

| 操作 | 文件路径 |
|------|---------|
| Create | `src/components/ui/bottom-sheet.tsx` |
| Create | `src/ui/new/components/UserCard.tsx` |
| Create | `src/ui/new/components/SwitchAccountSheet.tsx` |
| Modify | `src/ui/new/pages/NewSettingsPage.tsx` |
| Create | `src/ui/new/components/__tests__/UserCard.test.tsx` |
