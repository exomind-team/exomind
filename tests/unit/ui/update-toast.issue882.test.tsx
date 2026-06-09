import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UpdateToast } from '@/ui/components/UpdateToast';
import type { UpdateInfo } from '@/lib/services/update.service';

const toastState = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  dismissToastMock: vi.fn(),
  store: {
    updateAvailable: {
      hasUpdate: true,
      currentVersion: '0.3.9',
      latestVersion: '0.4.0',
      downloadUrl: 'https://github.com/exomind-team/exomind/releases/download/v0.4.0/ExoMind-0.4.0-windows-x64-setup.exe',
    } as UpdateInfo | null,
    toastDismissed: false,
    dismissToast: vi.fn(),
  },
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => toastState.navigateMock,
}));

vi.mock('@/ui/stores/update-store', () => ({
  useUpdateStore: (selector: (state: typeof toastState.store) => unknown) => selector(toastState.store),
}));

describe('UpdateToast issue #882', () => {
  beforeEach(() => {
    toastState.navigateMock.mockReset();
    toastState.dismissToastMock.mockReset();
    toastState.store.updateAvailable = {
      hasUpdate: true,
      currentVersion: '0.3.9',
      latestVersion: '0.4.0',
      downloadUrl: 'https://github.com/exomind-team/exomind/releases/download/v0.4.0/ExoMind-0.4.0-windows-x64-setup.exe',
    };
    toastState.store.toastDismissed = false;
    toastState.store.dismissToast = toastState.dismissToastMock;
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('navigates to the real update page when opening details（查看详情跳到真实 /update 页面）', async () => {
    render(<UpdateToast />);

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '查看详情' }));

    expect(toastState.navigateMock).toHaveBeenCalledWith({ to: '/update' });
    expect(toastState.dismissToastMock).toHaveBeenCalledTimes(1);
  });

  it('stays hidden after the toast was dismissed（已关闭的 Toast 不应重新显示）', () => {
    toastState.store.toastDismissed = true;

    render(<UpdateToast />);

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps UpdateToast mounted in both desktop and mobile shell branches（桌面与移动壳层都保留 Toast 挂载）', () => {
    const source = fs.readFileSync(path.resolve('src/routes.tsx'), 'utf-8').replace(/\r\n/g, '\n');
    const desktopBranchStart = source.indexOf("if (selectedShell === 'desktop')");
    const mobileBranchStart = source.indexOf('\n  return (\n    <>\n      <MobileShell', desktopBranchStart);
    const rootErrorStart = source.indexOf('\n}\n\nfunction RootRouteError', mobileBranchStart);
    const desktopBlock = source.slice(desktopBranchStart, mobileBranchStart);
    const mobileBlock = source.slice(mobileBranchStart, rootErrorStart);

    expect(desktopBranchStart).toBeGreaterThanOrEqual(0);
    expect(mobileBranchStart).toBeGreaterThanOrEqual(0);
    expect(rootErrorStart).toBeGreaterThanOrEqual(0);
    expect(desktopBlock).toContain('<UpdateToast />');
    expect(mobileBlock).toContain('<UpdateToast />');
  });
});
