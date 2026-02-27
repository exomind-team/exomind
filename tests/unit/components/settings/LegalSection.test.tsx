import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LegalSection } from '@/ui/new/components/LegalSection';

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
});
