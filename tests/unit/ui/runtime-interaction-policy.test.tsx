import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  resolveUiInteractionPolicy,
  type UiInteractionPolicy,
} from '@/config/runtime-target';
import { RuntimeInteractionPolicyController } from '@/ui/app/components/RuntimeInteractionPolicyController';

afterEach(() => {
  cleanup();
  document.body.classList.remove('exomind-app-like-selection');
});

function buildPolicy(
  overrides: Partial<UiInteractionPolicy>,
): UiInteractionPolicy {
  return {
    runtime: 'tauri',
    isDevBuild: false,
    useAppLikeTextSelection: true,
    suppressDefaultBrowserContextMenu: true,
    ...overrides,
  };
}

describe('runtime interaction policy', () => {
  it('resolves web and tauri policies with explicit runtime inputs', () => {
    expect(
      resolveUiInteractionPolicy({ isTauri: false, isDevBuild: false }),
    ).toEqual({
      runtime: 'web',
      isDevBuild: false,
      useAppLikeTextSelection: false,
      suppressDefaultBrowserContextMenu: false,
    });

    expect(
      resolveUiInteractionPolicy({ isTauri: true, isDevBuild: true }),
    ).toEqual({
      runtime: 'tauri',
      isDevBuild: true,
      useAppLikeTextSelection: true,
      suppressDefaultBrowserContextMenu: false,
    });

    expect(
      resolveUiInteractionPolicy({ isTauri: true, isDevBuild: false }),
    ).toEqual({
      runtime: 'tauri',
      isDevBuild: false,
      useAppLikeTextSelection: true,
      suppressDefaultBrowserContextMenu: true,
    });

    expect(
      resolveUiInteractionPolicy({ isTauri: true, tauriEnvDebug: 'true' }),
    ).toEqual({
      runtime: 'tauri',
      isDevBuild: true,
      useAppLikeTextSelection: true,
      suppressDefaultBrowserContextMenu: false,
    });

    expect(
      resolveUiInteractionPolicy({ isTauri: true, tauriEnvDebug: 'false' }),
    ).toEqual({
      runtime: 'tauri',
      isDevBuild: false,
      useAppLikeTextSelection: true,
      suppressDefaultBrowserContextMenu: true,
    });
  });

  it('adds app-like selection class and suppresses the default browser context menu', () => {
    render(<RuntimeInteractionPolicyController policy={buildPolicy({})} />);

    expect(document.body.classList.contains('exomind-app-like-selection')).toBe(
      true,
    );

    const target = document.createElement('div');
    let targetListenerCalls = 0;
    let targetSawDefaultPrevented = false;
    target.addEventListener('contextmenu', (event) => {
      targetListenerCalls += 1;
      targetSawDefaultPrevented = event.defaultPrevented;
    });
    document.body.appendChild(target);

    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);

    expect(targetListenerCalls).toBe(1);
    expect(targetSawDefaultPrevented).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it('keeps browser default context menu in tauri debug policy and removes class on unmount', () => {
    const view = render(
      <RuntimeInteractionPolicyController
        policy={buildPolicy({
          isDevBuild: true,
          suppressDefaultBrowserContextMenu: false,
        })}
      />,
    );

    expect(document.body.classList.contains('exomind-app-like-selection')).toBe(
      true,
    );

    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);

    view.unmount();
    expect(document.body.classList.contains('exomind-app-like-selection')).toBe(
      false,
    );
  });
});
