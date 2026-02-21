import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SettingsPage } from '@/components/Settings/SettingsPage';
import { NewSettingsPage } from '@/ui/new/pages/NewSettingsPage';

describe('UI transition entry/exit（新旧 UI 双向切换）', () => {
  it('renders old-ui entry in legacy settings（旧设置页有切换到新 UI 入口）', () => {
    render(<SettingsPage />);

    expect(screen.getByRole('button', { name: '切换到新 UI' })).toBeInTheDocument();
  });

  it('clicking old-ui entry sets uiMode=new（点击旧入口后切到新 UI）', () => {
    render(<SettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: '切换到新 UI' }));

    expect(window.localStorage.getItem('exomind:uiMode')).toBe('new');
  });

  it('renders back-to-old entry in new settings（新设置页有返回旧 UI 入口）', () => {
    render(<NewSettingsPage />);

    expect(screen.getByRole('button', { name: '返回旧 UI' })).toBeInTheDocument();
  });

  it('clicking back entry sets uiMode=old（点击返回入口后切回旧 UI）', () => {
    window.localStorage.setItem('exomind:uiMode', 'new');
    render(<NewSettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: '返回旧 UI' }));

    expect(window.localStorage.getItem('exomind:uiMode')).toBe('old');
  });
});

