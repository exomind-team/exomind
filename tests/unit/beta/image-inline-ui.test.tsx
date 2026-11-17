import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BetaImagePreview } from '@/beta/BetaImagePreview';
import { deferred } from './fixtures';

let intersection: IntersectionObserverCallback;
const source = () => new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1kAAAAASUVORK5CYII='), char => char.charCodeAt(0))]);
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersection = callback; }
    observe() {} disconnect() {} unobserve() {}
  });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local-fixture');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const intersect = (visible: boolean) => act(() => intersection([{ isIntersecting: visible } as IntersectionObserverEntry], {} as IntersectionObserver));

describe('saved image inline preview lifecycle', () => {
  it('reads only visible local images and releases their URL when the pane is hidden', async () => {
    const blob = source(), load = vi.fn(async () => blob);
    const props = { identity: 'device:profile:original:hash', fileName: '图片.png', mediaType: 'image/png', byteLength: blob.size, load, inline: true };
    const view = render(<BetaImagePreview {...props} visible />);
    expect(load).not.toHaveBeenCalled();
    intersect(true);
    expect(await screen.findByAltText('图片.png')).toBeVisible();
    expect(load).toHaveBeenCalledTimes(1);
    view.rerender(<BetaImagePreview {...props} visible={false} />);
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-fixture'));
    expect(screen.queryByAltText('图片.png')).not.toBeInTheDocument();
  });

  it('does not publish a late image after its device/client scope has changed', async () => {
    const blob = source(), first = deferred<Blob | null>();
    const old = vi.fn(() => first.promise), next = vi.fn(async () => null);
    const props = { identity: 'profile:original:hash', fileName: '图片.png', mediaType: 'image/png', byteLength: blob.size, inline: true };
    const view = render(<BetaImagePreview {...props} load={old} sourceScope={{}} />);
    intersect(true); await waitFor(() => expect(old).toHaveBeenCalledOnce());
    view.rerender(<BetaImagePreview {...props} load={next} sourceScope={{}} visible={false} />);
    await act(async () => { first.resolve(blob); await first.promise; });
    expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(next).not.toHaveBeenCalled();
  });
});
