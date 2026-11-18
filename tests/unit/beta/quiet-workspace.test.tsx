import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BetaApp } from '@/beta/BetaApp';
import { asyncDraftLocks } from './fixtures';
import { P, timeblockClient } from './timeblock-fixtures';
import { memoryIntentJournal } from './timeblock-ui-fixtures';

const locks = Object.getOwnPropertyDescriptor(navigator, 'locks');
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: asyncDraftLocks() });
});
afterEach(() => {
  if (locks) Object.defineProperty(navigator, 'locks', locks);
  else Reflect.deleteProperty(navigator, 'locks');
});

describe('Beta12 feedback: progressive workspace disclosure', () => {
  it('offers a record-only surface without replacing the editor, history or original pane choices', async () => {
    const client = timeblockClient(); client.profiles.mockResolvedValue([{ profile_id: P, display_name: '合成档案' }]);
    const view = render(<BetaApp client={client} intentJournal={memoryIntentJournal()} />);
    const input = await screen.findByRole('textbox', { name: '记录当下' });
    const history = screen.getByLabelText('记录历史');
    await waitFor(() => expect(history).toHaveAttribute('aria-busy', 'false'));
    fireEvent.change(input, { target: { value: '切换布局仍保留输入' } });
    fireEvent.click(screen.getByRole('button', { name: '折叠专注' }));
    fireEvent.click(screen.getByRole('button', { name: '简洁记录' }));
    expect(screen.queryByRole('button', { name: '折叠专注' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '折叠记录' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('记录历史')).toBe(history);
    expect(screen.getByRole('textbox', { name: '记录当下' })).toBe(input);
    expect(input).toHaveValue('切换布局仍保留输入');
    fireEvent.click(screen.getByRole('button', { name: '简洁记录' }));
    expect(screen.getByRole('button', { name: '折叠专注' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: '折叠记录' })).toHaveAttribute('aria-expanded', 'true');
    expect(client.capture).not.toHaveBeenCalled(); expect(client.timeblocks.command).not.toHaveBeenCalled();
    view.unmount();
    await act(async () => {});
  });

  it('keeps the durable save explanation reachable from the input without a footer status row', async () => {
    const client = timeblockClient(); client.profiles.mockResolvedValue([{ profile_id: P, display_name: '合成档案' }]);
    render(<BetaApp client={client} intentJournal={memoryIntentJournal()} />);
    const input = await screen.findByRole('textbox', { name: '记录当下' });
    fireEvent.change(input, { target: { value: '草稿状态按需查看' } });
    await waitFor(() => expect(screen.getByRole('button', { name: '记录保存状态' })).toHaveAttribute('title', '记录草稿已暂存 · 尚未提交'));
    fireEvent.click(screen.getByRole('button', { name: '记录保存状态' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('记录草稿已暂存 · 尚未提交');
    expect(screen.getByRole('dialog')).toHaveTextContent('不代表其他设备已收到');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(input).toHaveValue('草稿状态按需查看');
    expect(client.capture).not.toHaveBeenCalled();
  });
});
