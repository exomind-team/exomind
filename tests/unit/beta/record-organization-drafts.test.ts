import { describe, expect, it, vi } from 'vitest';
import { BetaDraftController } from '@/beta/drafts';
import type { BetaReceipt } from '@/beta/client';
import { deferred, fakeClient, memoryStorage, saved } from './fixtures';

const file = (name: string, content = 'recording') => new File([content], name, { type: 'application/octet-stream' });

describe('record organization draft state', () => {
  it('freezes tags in the submitted command and keeps later text and tags after a late receipt', async () => {
    const client = fakeClient();
    const flight = deferred<BetaReceipt>();
    client.capture.mockReturnValueOnce(flight.promise);
    let id = 0;
    const draft = new BetaDraftController(client, 'device', memoryStorage(), () => `id-${++id}`, () => 10);

    draft.setDraft('p', 'first wording');
    draft.setTags('p', ['  daily  ', 'daily', 'work']);
    const submission = draft.submit('p');
    await vi.waitFor(() => expect(client.capture).toHaveBeenCalledTimes(1));
    const command = client.capture.mock.calls[0][0];
    expect(command.tags).toEqual(['daily', 'work']);

    draft.setDraft('p', 'new wording while receipt is pending');
    draft.setTags('p', ['later']);
    flight.resolve(saved(command));
    await submission;

    expect(draft.snapshot().drafts.p).toMatchObject({
      text: 'new wording while receipt is pending', tags: ['later'],
    });
    draft.dispose();
  });

  it('rejects tags outside Core byte and count bounds without changing the draft', () => {
    const draft = new BetaDraftController(fakeClient(), 'device', memoryStorage());
    draft.setTags('p', ['kept']);
    expect(() => draft.setTags('p', ['x'.repeat(129)])).toThrow(/128 字节/);
    expect(() => draft.setTags('p', Array.from({ length: 65 }, (_, index) => `tag-${index}`))).toThrow(/64 个标签/);
    expect(draft.snapshot().drafts.p.tags).toEqual(['kept']);
    draft.dispose();
  });

});
