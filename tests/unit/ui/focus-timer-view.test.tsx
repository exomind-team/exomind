import { createRef, type ChangeEvent } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FocusTimerView, type FocusTimerViewModel } from '@/ui/app/components/FocusTimerView';

// These factories fail if the extracted presentation brings old runtime or
// preference bootstrap into Beta. Type-only references do not invoke them.
vi.mock('@/lib/services', () => { throw new Error('pure FocusTimerView imported legacy services'); });
vi.mock('@/config/timer-preferences', () => { throw new Error('pure FocusTimerView imported timer preference storage'); });
vi.mock('@/config/focus-bgm-preferences', () => { throw new Error('pure FocusTimerView imported BGM preference storage'); });

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

function actions() {
  return { expand: vi.fn(), collapse: vi.fn(), selectTiming: vi.fn(), editCustom: vi.fn(),
    start: vi.fn(), beginRename: vi.fn(), pauseResume: vi.fn(), end: vi.fn(), openBgm: vi.fn() };
}
function config(): Extract<FocusTimerViewModel, { phase: 'config' }> {
  return { phase: 'config', name: 'synthetic block', mode: 'countdown', minutes: 25,
    custom: { editing: false, draft: '25' } };
}
function running(): Extract<FocusTimerViewModel, { phase: 'running' }> {
  return { phase: 'running', name: { text: 'synthetic running block', draft: 'draft name', editing: false, saving: false },
    clock: { text: '24:30', warning: false, endTimeText: '预计 19:16 结束' }, paused: false,
    feedback: { inProgress: false, dialogOpen: false }, linkedTasks: [] };
}

describe('shared Alpha FocusTimerView extraction contract', () => {
  it('retains Alpha idle DOM, classes and icon, dispatching expand without inventing state', () => {
    const callbacks = actions();
    render(<FocusTimerView model={{ phase: 'idle' }} actions={callbacks} />);
    expect(screen.getByTestId('new-focus-state-idle')).toHaveClass('h-[104px]', 'max-w-[390px]');
    const button = screen.getByTestId('new-focus-idle-card');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('aria-controls', 'new-focus-config-panel');
    expect(button).toHaveClass('h-[68px]', 'rounded-[24px]', 'backdrop-blur-[24px]');
    expect(button.querySelector('svg.lucide-target')).toHaveAttribute('width', '20');
    expect(screen.getByText('点击开启时间块')).toBeInTheDocument();
    fireEvent.click(button);
    expect(callbacks.expand).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('new-focus-state-config')).not.toBeInTheDocument();
  });

  it('retains the five timing cells, active indicator and start button, controlled by its caller', () => {
    const callbacks = actions(); const model = config();
    const { rerender } = render(<FocusTimerView model={model} actions={callbacks} />);
    expect(screen.getByTestId('new-focus-timer-widget')).toHaveClass('bg-[#FAF7F5]', 'dark:bg-[#0C0A09]');
    expect(screen.getByTestId('new-focus-state-config')).toHaveClass('min-h-[200px]', 'pt-4', 'pb-4');
    const panel = document.getElementById('new-focus-config-panel')!;
    expect(panel).toHaveClass('relative', 'mx-4', 'min-h-[169px]', 'rounded-[24px]', 'px-[18px]');
    expect(screen.getByTestId('new-focus-task-input')).toHaveAttribute('placeholder', '输入时间块名称...');
    expect(screen.getByTestId('new-focus-expected-time-row').querySelector('.grid-cols-5')).toBeInTheDocument();
    expect(screen.getByTestId('new-focus-expected-active-indicator')).toHaveStyle({ transform: 'translateX(200%)' });
    for (const minutes of [15, 25, 45]) expect(screen.getByTestId(`new-focus-expected-${minutes}`)).toHaveTextContent(`${minutes}m`);
    fireEvent.click(screen.getByTestId('new-focus-expected-countup'));
    expect(callbacks.selectTiming).toHaveBeenCalledWith('countup');
    expect(screen.getByTestId('new-focus-expected-active-indicator')).toHaveStyle({ transform: 'translateX(200%)' });
    fireEvent.click(screen.getByTestId('new-focus-expected-45'));
    expect(callbacks.selectTiming).toHaveBeenCalledWith('countdown', 45);
    fireEvent.click(screen.getByTestId('new-focus-expected-custom-trigger'));
    expect(callbacks.editCustom).toHaveBeenCalledTimes(1);
    const start = screen.getByTestId('new-focus-start-button');
    expect(start).toHaveClass('h-10', 'rounded-[12px]', 'bg-[#C75B3A]', 'text-[14px]');
    expect(start.querySelector('svg.lucide-play')).toHaveAttribute('width', '16');
    fireEvent.click(start); expect(callbacks.start).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('new-focus-state-config')).toBeInTheDocument();
    rerender(<FocusTimerView model={{ ...model, mode: 'countup' }} actions={callbacks} />);
    expect(screen.getByTestId('new-focus-expected-active-indicator')).toHaveStyle({ transform: 'translateX(0%)' });
  });

  it('forwards original input/focus/keyboard bindings and refs without a second shortcut handler', () => {
    const callbacks = actions(); const nameRef = createRef<HTMLTextAreaElement>(); const customRef = createRef<HTMLInputElement>();
    const changes: string[] = []; const customChanges: string[] = [];
    const nameKey = vi.fn(); const expectedKey = vi.fn(); const customKey = vi.fn(); const focused = vi.fn(); const blurred = vi.fn();
    const bindings = { configName: { inputRef: nameRef, onChange: (event: ChangeEvent<HTMLTextAreaElement>) => { changes.push(event.target.value); }, onFocus: focused, onBlur: blurred, onKeyDown: nameKey },
      customMinutes: { inputRef: customRef, onChange: (event: ChangeEvent<HTMLInputElement>) => { customChanges.push(event.target.value); }, onKeyDown: customKey }, expectedTimeKeyDown: expectedKey };
    render(<FocusTimerView model={{ ...config(), minutes: 90, custom: { editing: true, draft: '90' } }} actions={callbacks} bindings={bindings} />);
    const name = screen.getByTestId('new-focus-task-input'); const custom = screen.getByTestId('new-focus-expected-custom-input');
    expect(nameRef.current).toBe(name); expect(customRef.current).toBe(custom);
    fireEvent.change(name, { target: { value: 'new local title' } });
    fireEvent.focus(name); fireEvent.blur(name);
    fireEvent.keyDown(name, { key: 'Enter', ctrlKey: true, isComposing: true });
    expect(changes).toEqual(['new local title']); expect(focused).toHaveBeenCalledTimes(1); expect(blurred).toHaveBeenCalledTimes(1);
    expect(nameKey).toHaveBeenCalledTimes(1); expect(callbacks.start).not.toHaveBeenCalled();
    fireEvent.change(custom, { target: { value: '123' } });
    fireEvent.keyDown(custom, { key: 'Escape' });
    expect(customChanges).toEqual(['123']); expect(customKey).toHaveBeenCalledTimes(1);
    // The original parent-row shortcut still receives bubbling key events.
    expect(expectedKey).toHaveBeenCalledTimes(1);
    expect(custom).toHaveAttribute('aria-label', '自定义倒计时分钟（Custom countdown minutes）');
    expect(custom).toHaveClass('h-8', 'px-[6px]', 'text-[12px]', 'focus-visible:ring-0');
  });

  it('renders authoritative clock props and never starts a RAF, timer or ending mutation', () => {
    vi.useFakeTimers();
    const frame = vi.spyOn(globalThis, 'requestAnimationFrame'); const callbacks = actions();
    const model = { ...running(), clock: { text: '+00:13', warning: true, endTimeText: '已超时 13 秒' } };
    render(<FocusTimerView model={model} actions={callbacks} />);
    const clock = screen.getByTestId('new-focus-running-clock');
    expect(clock).toHaveTextContent('+00:13');
    expect(clock).toHaveClass('font-mono', 'text-[40px]', 'tracking-[2px]', 'text-[#C75B3A]');
    expect(screen.getByTestId('new-focus-end-time')).toHaveTextContent('已超时 13 秒');
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(clock).toHaveTextContent('+00:13'); expect(frame).not.toHaveBeenCalled();
    expect(callbacks.end).not.toHaveBeenCalled(); expect(callbacks.pauseResume).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains pause/resume and feedback button semantics without local optimistic transitions', () => {
    const callbacks = actions(); const model = running();
    const { rerender } = render(<FocusTimerView model={model} actions={callbacks} />);
    let pause = screen.getByTestId('new-focus-pause-resume-button');
    expect(pause).toHaveAttribute('aria-label', '暂停（Pause）'); expect(pause).toHaveClass('h-11', 'w-11', 'bg-warning');
    expect(pause.querySelector('svg.lucide-pause')).toHaveAttribute('width', '18');
    fireEvent.click(pause); expect(callbacks.pauseResume).toHaveBeenCalledTimes(1);
    expect(pause).toHaveAttribute('aria-label', '暂停（Pause）');
    rerender(<FocusTimerView model={{ ...model, paused: true }} actions={callbacks} />);
    pause = screen.getByTestId('new-focus-pause-resume-button');
    expect(pause).toHaveAttribute('aria-label', '继续（Resume）'); expect(pause).toHaveClass('bg-[#16A34A]');
    rerender(<FocusTimerView model={{ ...model, paused: true, feedback: { inProgress: true, dialogOpen: false } }} actions={callbacks} />);
    expect(screen.getByTestId('new-focus-pause-resume-button')).toBeDisabled();
    const end = screen.getByTestId('new-focus-end-button');
    expect(end).toHaveAttribute('aria-label', '反馈中（Feedback in progress）'); expect(end).toHaveClass('bg-brand');
    expect(end.querySelector('svg.lucide-notepad-text')).toBeInTheDocument(); expect(end).toBeEnabled();
    fireEvent.click(end); expect(callbacks.end).toHaveBeenCalledTimes(1);
    rerender(<FocusTimerView model={{ ...model, feedback: { inProgress: true, dialogOpen: true } }} actions={callbacks} />);
    expect(screen.getByTestId('new-focus-end-button')).toBeDisabled();
  });

  it('retains running rename controls and forwards commit/cancel bindings without importing a task service', () => {
    const callbacks = actions(); const model = running(); const nameRef = createRef<HTMLInputElement>();
    const change = vi.fn(); const blur = vi.fn(); const key = vi.fn();
    const { rerender } = render(<FocusTimerView model={model} actions={callbacks} />);
    fireEvent.click(screen.getByTestId('new-focus-running-name-display')); expect(callbacks.beginRename).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('new-focus-running-name-input')).not.toBeInTheDocument();
    const editing = { ...model, name: { ...model.name, editing: true } };
    const bindings = { runningName: { inputRef: nameRef, onChange: change, onBlur: blur, onKeyDown: key } };
    rerender(<FocusTimerView model={editing} actions={callbacks} bindings={bindings} />);
    const input = screen.getByTestId('new-focus-running-name-input'); expect(nameRef.current).toBe(input);
    expect(input).toHaveValue('draft name'); expect(input).toHaveClass('h-8', 'text-[20px]', 'shadow-none');
    fireEvent.change(input, { target: { value: 'edited' } }); fireEvent.keyDown(input, { key: 'Enter' }); fireEvent.blur(input);
    expect(change).toHaveBeenCalledTimes(1); expect(key).toHaveBeenCalledTimes(1); expect(blur).toHaveBeenCalledTimes(1);
    rerender(<FocusTimerView model={{ ...editing, name: { ...editing.name, saving: true } }} actions={callbacks} bindings={bindings} />);
    expect(screen.getByTestId('new-focus-running-name-input')).toBeDisabled();
  });

  it('preserves actual overlay chrome, drag attributes, linked-label height and optional slots', () => {
    const callbacks = actions(); const collapse = vi.fn(); const main = vi.fn(); const mounted = vi.fn(); const pressed = vi.fn();
    const model = { ...running(), linkedTasks: [{ id: 'alpha-task-label', title: 'existing Alpha linked label' }] };
    render(<FocusTimerView model={model} actions={callbacks} surface="overlay"
      overlayChrome={{ statusLabel: '专注进行中', onCollapse: collapse, onReturnToMain: main, onSurfaceMount: mounted, onSurfaceMouseDownCapture: pressed, surfacePressed: true }}
      slots={{ dialogs: <div data-testid="controlled-dialog-slot" /> }} />);
    const card = screen.getByTestId('new-focus-running-task-card');
    expect(card).toHaveAttribute('data-overlay-visible-surface', 'true');
    expect(card).toHaveClass('relative', 'w-full', 'min-h-[246px]', 'ring-inset', 'ring-[#FDE4DE]/60');
    expect(screen.getByTestId('new-focus-overlay-drag-handle')).toHaveAttribute('data-tauri-drag-region');
    expect(screen.getByText('专注进行中')).toHaveAttribute('data-tauri-drag-region');
    expect(screen.getByTestId('new-focus-running-linked-task-alpha-task-label')).toHaveTextContent('existing Alpha linked label');
    fireEvent.mouseDown(card); expect(pressed).toHaveBeenCalledTimes(1);
    expect(mounted).toHaveBeenCalledWith(card);
    fireEvent.click(screen.getByRole('button', { name: '收起' })); expect(collapse).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '显示主程序' })); expect(main).toHaveBeenCalledTimes(1);
    const audio = screen.getByTestId('new-focus-bgm-toggle-button'); expect(audio).toHaveClass('h-8', 'w-8');
    fireEvent.click(audio); expect(callbacks.openBgm).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('controlled-dialog-slot').parentElement).toBe(screen.getByTestId('new-focus-timer-widget'));
  });
  it('shows the same running name as noninteractive text when rename is not a supported capability', () => {
    const callbacks=actions();const model=running();
    render(<FocusTimerView model={{...model,name:{...model.name,readOnly:true,editing:true}}} actions={callbacks}/>);
    const name=screen.getByTestId('new-focus-running-name-display');
    expect(name.tagName).toBe('SPAN');expect(name).toHaveTextContent(model.name.text);
    expect(name).toHaveClass('text-[20px]','leading-[1.4]','truncate');
    expect(name).not.toHaveAttribute('title','编辑时间块名称');
    expect(screen.queryByTestId('new-focus-running-name-input')).not.toBeInTheDocument();
    fireEvent.click(name);expect(callbacks.beginRename).not.toHaveBeenCalled();
  });
  it('disables only business actions while leaving next-draft inputs and timing choices usable',()=>{
    const callbacks=actions();const {rerender}=render(<FocusTimerView model={config()} actions={callbacks} actionsDisabled/>);
    expect(screen.getByTestId('new-focus-start-button')).toBeDisabled();expect(screen.getByTestId('new-focus-task-input')).toBeEnabled();
    fireEvent.click(screen.getByTestId('new-focus-start-button'));expect(callbacks.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('new-focus-expected-countup'));expect(callbacks.selectTiming).toHaveBeenCalledWith('countup');
    rerender(<FocusTimerView model={running()} actions={callbacks} actionsDisabled/>);
    expect(screen.getByTestId('new-focus-pause-resume-button')).toBeDisabled();expect(screen.getByTestId('new-focus-end-button')).toBeDisabled();
  });
});
