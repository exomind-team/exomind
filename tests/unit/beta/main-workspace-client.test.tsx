import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MainOverlayBridge } from '@/beta/overlay/MainOverlayBridge';
const native=vi.hoisted(()=>({invoke:vi.fn(async(_name:string,_args?:unknown)=>null),unlisten:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>true,invoke:native.invoke}));
vi.mock('@tauri-apps/api/event',()=>({listen:vi.fn(async()=>native.unlisten)}));
beforeEach(()=>{localStorage.clear();native.invoke.mockClear();native.unlisten.mockClear();});
afterEach(()=>vi.restoreAllMocks());

describe('B12-07: Main is an application client, never the overlay state owner',()=>{
  it('changing Main profile or unmounting cannot retarget, publish, execute for, or revoke the overlay',async()=>{
    const view=render(<MainOverlayBridge profileId="P" onCommitted={()=>{}}/>);
    await waitFor(()=>expect(native.invoke).toHaveBeenCalledWith('beta_workspace_preferences',expect.any(Object)));
    view.rerender(<MainOverlayBridge profileId="Q" onCommitted={()=>{}}/>);
    view.unmount();await Promise.resolve();
    expect(native.invoke.mock.calls.every(([name])=>name==='beta_workspace_preferences')).toBe(true);
    expect(native.unlisten).toHaveBeenCalled();
  });
});
