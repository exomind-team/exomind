import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RitualHomePage } from '@/ui/app/pages/RitualHomePage';

describe('RitualHomePage shutdown（仪式首页收工态）', () => {
  it('renders shutdown summary when stage is shutdown_ready（待收工阶段显示收束页）', () => {
    render(<RitualHomePage stage="shutdown_ready" />);

    expect(screen.getByText('收住今天')).toBeInTheDocument();
    expect(screen.getByText('明天第一步')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '正式收工' })).toBeInTheDocument();
  });
});
