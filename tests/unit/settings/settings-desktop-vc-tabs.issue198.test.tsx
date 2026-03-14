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

  it('uses section-based tabs and removes invalid desktop-only rows（顶部tab与分段一致并移除无效行）', () => {
    render(<SettingsPage />);

    expect(screen.getByRole('button', { name: '外观主题' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '专注设置' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '输入' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '服务' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '数据' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开发者' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '危险区域' })).toBeInTheDocument();
    expect(screen.getByText('导出数据')).toBeInTheDocument();
    expect(screen.getByText('导入数据')).toBeInTheDocument();
    expect(screen.getByText('语音转写后')).toBeInTheDocument();
    expect(screen.getByText('反馈内容')).toBeInTheDocument();

    expect(screen.queryByText('工作模式')).not.toBeInTheDocument();
    expect(screen.queryByText('番茄时长')).not.toBeInTheDocument();
    expect(screen.queryByText('自动休息')).not.toBeInTheDocument();
    expect(screen.queryByText('节律提醒')).not.toBeInTheDocument();
    expect(screen.queryByText('每日总结通知')).not.toBeInTheDocument();
    expect(screen.queryByText('声音提醒')).not.toBeInTheDocument();
    expect(screen.queryByText('系统消息')).not.toBeInTheDocument();
    expect(screen.queryByText('更新日志')).not.toBeInTheDocument();
    expect(screen.getByText('更新')).toBeInTheDocument();
    expect(screen.getByText('法律与支持')).toBeInTheDocument();
    expect(screen.queryByText('隐私政策')).not.toBeInTheDocument();
    expect(screen.queryByText('用户协议')).not.toBeInTheDocument();
    expect(screen.queryByText('开源软件使用声明')).not.toBeInTheDocument();

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
