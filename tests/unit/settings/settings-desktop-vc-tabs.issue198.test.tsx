import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '../components/settings/setup-settings-mocks';
import { SettingsPage } from '@/ui/app/pages/SettingsPage';

const scrollIntoViewMock = vi.fn();

describe('issue-198 settings desktop VC tabs（设置页桌面VC标签与跳转）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('min-width: 768px'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoViewMock,
    });
  });

  it('uses section tabs and surfaces grouped voice settings（顶部tab与分组化语音设置一致）', () => {
    render(<SettingsPage />);

    expect(screen.getByRole('button', { name: '外观主题' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '专注设置' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '输入' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '语音' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '服务' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '数据' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开发者' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '危险区域' })).toBeInTheDocument();

    expect(screen.getAllByText('快捷语音输入').length).toBeGreaterThan(0);
    expect(screen.getAllByText('常驻语音助手').length).toBeGreaterThan(0);
    expect(screen.getByText('语音转写后')).toBeInTheDocument();
    expect(screen.queryByText('快捷语音引擎')).not.toBeInTheDocument();

    const tabs = screen.getAllByRole('button');
    const developerIndex = tabs.findIndex((button) => button.textContent === '开发者');
    const dangerIndex = tabs.findIndex((button) => button.textContent === '危险区域');
    expect(dangerIndex).toBeGreaterThan(developerIndex);
  });

  it('clicking tabs should jump to sections（点击顶部tab触发分段跳转）', () => {
    render(<SettingsPage />);

    const developerTab = screen.getByRole('button', { name: '开发者' });
    fireEvent.click(developerTab);

    expect(developerTab).toHaveAttribute('aria-pressed', 'true');
    expect(scrollIntoViewMock).toHaveBeenCalled();
    expect(scrollIntoViewMock).toHaveBeenLastCalledWith({ behavior: 'smooth', block: 'start' });
  });
});
