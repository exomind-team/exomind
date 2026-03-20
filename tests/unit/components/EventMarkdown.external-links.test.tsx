import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EventMarkdown } from '@/components/Chat/EventMarkdown';

const navigateMock = vi.fn();
const openExternalUrlMock = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('@/lib/utils/open-external', () => ({
  openExternalUrl: (...args: unknown[]) => openExternalUrlMock(...args),
  resolveMarkdownLinkTarget: (href: string) => {
    if (href.startsWith('https://')) {
      return { kind: 'external', url: new URL(href) };
    }
    if (href.startsWith('/')) {
      return { kind: 'internal', url: new URL(`https://example.com${href}`) };
    }
    return { kind: 'unsupported', url: null };
  },
}));

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
          '[危险](javascript:alert(1))',
        ].join('\n\n')}
      />,
    );

    fireEvent.click(screen.getByRole('link', { name: '外链' }));
    expect(openExternalUrlMock).toHaveBeenCalledWith('https://example.com/docs');
    expect(navigateMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('link', { name: '内链' }));
    expect(navigateMock).toHaveBeenCalled();

    expect(screen.queryByRole('link', { name: '危险' })).toBeNull();
    expect(screen.getByText('危险')).toBeInTheDocument();
  });
});
