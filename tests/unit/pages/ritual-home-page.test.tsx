import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RitualHomePage } from '@/ui/app/pages/RitualHomePage';

describe('RitualHomePage', () => {
  it('shows boot card in pre_boot stage（未开机阶段显示开机主卡）', () => {
    render(<RitualHomePage stage="pre_boot" />);

    expect(screen.getByRole('heading', { name: '开始今天' })).toBeInTheDocument();
    expect(screen.getByText('昨天停在哪')).toBeInTheDocument();
    expect(screen.getByText('系统推荐的今天主线')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '选择这条主线' }).length).toBeGreaterThan(0);
  });
});
