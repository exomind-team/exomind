import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BetaTimeblockEndSoundSetting } from '@/beta/BetaTimeblockEndSoundSetting';
import { getTimerPreferences, updateTimerPreferences } from '@/config/timer-preferences';

afterEach(()=>localStorage.clear());

describe('Beta desktop timeblock sound setting',()=>{
  it('lets the user turn off the in-app sound without changing the system notification setting',async()=>{
    updateTimerPreferences({countdownEndSoundEnabled:true});
    render(<BetaTimeblockEndSoundSetting visible/>);
    const control=screen.getByRole('switch',{name:'本机时间块结束提示音'});
    expect(control).toBeChecked();

    fireEvent.click(control);

    await waitFor(()=>expect(control).not.toBeChecked());
    expect(getTimerPreferences().countdownEndSoundEnabled).toBe(false);
    expect(screen.getByText(/Android 系统通知由系统通知通道独立控制/)).toBeInTheDocument();
  });
  it('does not render a desktop-only setting outside its host',()=>{
    const {container}=render(<BetaTimeblockEndSoundSetting visible={false}/>);
    expect(container).toBeEmptyDOMElement();
  });
});
