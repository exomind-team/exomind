import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { RitualHomePage } from '@/ui/app/pages/RitualHomePage';
import { clearRitualSession } from '@/ui/app/ritual/ritual-session-storage';

describe('RitualHomePage interactions（仪式首页交互）', () => {
  beforeEach(() => {
    clearRitualSession();
  });

  it('lets the user choose a plan and start the day（选择主线后可开始今天）', () => {
    render(<RitualHomePage />);

    fireEvent.click(screen.getAllByRole('button', { name: '选择这条主线' })[0]);
    fireEvent.click(screen.getByRole('button', { name: '开始今天' }));

    expect(screen.getByRole('heading', { name: '今天主线' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '继续今天' })).toBeInTheDocument();
  });
});
