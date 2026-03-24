import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LegalSection } from '@/ui/app/components/LegalSection';

describe('LegalSection（法律与支持组件）', () => {
  it('renders only legal items（仅渲染法务三项）', () => {
    render(<LegalSection onComingSoon={() => {}} />);

    expect(screen.getByText('隐私政策')).toBeInTheDocument();
    expect(screen.getByText('用户协议')).toBeInTheDocument();
    expect(screen.getByText('开源软件使用声明')).toBeInTheDocument();
    expect(screen.queryByText('官网')).not.toBeInTheDocument();
    expect(screen.queryByText('赞助开发者')).not.toBeInTheDocument();
    expect(screen.queryByText('帮助中心')).not.toBeInTheDocument();
    expect(screen.queryByText('反馈建议')).not.toBeInTheDocument();
  });

  it('clicking 隐私政策 calls onComingSoon', async () => {
    const fn = vi.fn();
    render(<LegalSection onComingSoon={fn} />);
    await userEvent.click(screen.getByText('隐私政策'));
    expect(fn).toHaveBeenCalledOnce();
  });

  it('clicking 用户协议 calls onComingSoon', async () => {
    const fn = vi.fn();
    render(<LegalSection onComingSoon={fn} />);
    await userEvent.click(screen.getByText('用户协议'));
    expect(fn).toHaveBeenCalledOnce();
  });

  it('clicking 开源软件使用声明 calls onComingSoon', async () => {
    const fn = vi.fn();
    render(<LegalSection onComingSoon={fn} />);
    await userEvent.click(screen.getByText('开源软件使用声明'));
    expect(fn).toHaveBeenCalledOnce();
  });
});
