import { describe, expect, it, vi } from 'vitest';
import { bootstrapBeforeRender } from '@/bootstrap-before-render';

describe('bootstrapBeforeRender（启动引导后渲染）', () => {
  it('still renders when bootstrap fails（bootstrap 失败时仍继续渲染）', async () => {
    const bootstrap = vi.fn().mockRejectedValue(new Error('runtime bootstrap failed'));
    const render = vi.fn();
    const reportError = vi.fn();

    await bootstrapBeforeRender(bootstrap, render, reportError);

    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('renders without reporting when bootstrap succeeds（bootstrap 成功时直接渲染）', async () => {
    const bootstrap = vi.fn().mockResolvedValue(undefined);
    const render = vi.fn();
    const reportError = vi.fn();

    await bootstrapBeforeRender(bootstrap, render, reportError);

    expect(reportError).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledTimes(1);
  });
});
