import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { Tooltip } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

afterEach(cleanup);

it('keeps the trigger in its layout and replaces its browser title', () => {
  const view = render(<Tooltip content="说明"><Button title="说明">操作</Button></Tooltip>);
  const trigger = screen.getByRole('button', { name: '操作' });
  expect(view.container.firstElementChild).toBe(trigger);
  expect(trigger).not.toHaveAttribute('title');
  expect(screen.queryByRole('tooltip')).toBeNull();
});

it('shows a themed description on keyboard focus and dismisses it without losing focus', async () => {
  const user = userEvent.setup();
  const action = vi.fn();
  render(<Tooltip content="查看运行状态"><Button onClick={action}>状态</Button></Tooltip>);
  const trigger = screen.getByRole('button', { name: '状态' });
  await user.tab();
  const description = await screen.findByRole('tooltip');
  expect(description).toHaveTextContent('查看运行状态');
  expect(trigger).toHaveAttribute('aria-describedby', description.id);
  expect(trigger).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('tooltip')).toBeNull();
  expect(trigger).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(action).toHaveBeenCalledOnce();
});

it('removes its portalled description when the owning view unmounts', async () => {
  const user = userEvent.setup();
  const view = render(<Tooltip content="完整文件名"><button>文件</button></Tooltip>);
  await user.tab();
  await screen.findByRole('tooltip');
  view.unmount();
  expect(screen.queryByRole('tooltip')).toBeNull();
});

it('preserves an outer dialog trigger and its focus reference', async () => {
  const user = userEvent.setup();
  render(<Dialog><DialogTrigger asChild><Tooltip content="查看说明"><Button>打开说明</Button></Tooltip></DialogTrigger>
    <DialogContent><DialogHeader><DialogTitle>说明内容</DialogTitle><DialogDescription>合成说明。</DialogDescription></DialogHeader></DialogContent>
  </Dialog>);
  const trigger = screen.getByRole('button', { name: '打开说明' });
  await user.click(trigger);
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(trigger).toHaveFocus();
});
