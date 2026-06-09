import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EventMarkdown } from '@/components/Chat/EventMarkdown';

const navigateMock = vi.fn();
const openExternalUrlMock = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('@/lib/utils/open-external', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils/open-external')>();
  return {
    ...actual,
    openExternalUrl: (...args: unknown[]) => openExternalUrlMock(...args),
  };
});

describe('EventMarkdown external links', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    openExternalUrlMock.mockReset();
  });

  it('opens external links outside the app and routes internal links inside SPA（外链外开，内链走 SPA）', () => {
    render(
      <EventMarkdown
        content={[
          '[外链](https://example.com/docs)',
          '[内链](/tasks/123)',
          '[旧引用](http://localhost:1620/eventlog/record?event=evt-1&locate=1)',
          '[危险](javascript:alert(1))',
        ].join('\n\n')}
      />,
    );

    fireEvent.click(screen.getByRole('link', { name: '外链' }));
    expect(openExternalUrlMock).toHaveBeenCalledWith('https://example.com/docs');
    expect(navigateMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('link', { name: '内链' }));
    expect(navigateMock).toHaveBeenNthCalledWith(1, { to: '/tasks/123' });

    fireEvent.click(screen.getByRole('link', { name: '旧引用' }));
    expect(navigateMock).toHaveBeenNthCalledWith(2, { to: '/eventlog/record?event=evt-1&locate=1' });

    expect(screen.queryByRole('link', { name: '危险' })).toBeNull();
    expect(screen.getByText('危险')).toBeInTheDocument();
  });
});
