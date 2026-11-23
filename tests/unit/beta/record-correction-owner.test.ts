import { describe, expect, it, vi } from 'vitest';
import { BetaApiError, type BetaClient, type BetaReceipt } from '@/beta/client';
import { BetaDraftController } from '@/beta/drafts';
import type { LocalIntentJournal } from '@/beta/local-intent-journal';
import { NativeIntentJournal } from '@/beta/native-intent-journal';
import { nativeRecordOrganizationClient, type BetaRecordCorrectionCommand } from '@/beta/record-organization-client';
import { BetaRecordCorrectionOwner } from '@/beta/record-correction-owner';
import { fakeClient, memoryStorage } from './fixtures';

const PROFILE = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';
const CORRECTION_EVENT = '33333333-3333-4333-8333-333333333333';
const COMMAND = '44444444-4444-4444-8444-444444444444';
const TARGET_DIGEST = 'a'.repeat(64);
const SERVICE_SCOPE = 'https://synthetic.example/beta/v1';

class SharedMemoryIntentJournal implements LocalIntentJournal {
  readonly values = new Map<string, string>();
  readonly listeners = new Map<string, Set<() => void>>();
  writes = 0;
  failWrites = new Set<number>();

  async read(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async write(key: string, raw: string): Promise<void> {
    await this.compareWrite(key, null, raw);
  }

  async compareWrite(key: string, expectedRaw: string | null, raw: string): Promise<void> {
    this.writes += 1;
    if (this.failWrites.has(this.writes)) {
      throw new BetaApiError('intent_commit_failed', 'synthetic journal failure');
    }
    const actual = this.values.get(key) ?? null;
    if (actual !== expectedRaw) {
      throw new BetaApiError('intent_cache_conflict', 'synthetic compare-and-write conflict');
    }
    this.values.set(key, raw);
    for (const listener of this.listeners.get(key) ?? []) listener();
  }

  subscribe(key: string, changed: () => void): () => void {
    const listeners = this.listeners.get(key) ?? new Set<() => void>();
    listeners.add(changed);
    this.listeners.set(key, listeners);
    return () => {
      listeners.delete(changed);
      if (!listeners.size) this.listeners.delete(key);
    };
  }
}

function receipt(command: Pick<BetaRecordCorrectionCommand, 'command_id' | 'event_id' | 'profile_id'>): BetaReceipt {
  return {
    ...command,
    local_seq: 7,
    event_digest: 'b'.repeat(64),
    durability: 'local_committed',
    replayed: false,
  };
}

function makeClient(options: {
  receipts?: Map<string, BetaReceipt>;
  recordCorrection?: (command: BetaRecordCorrectionCommand) => Promise<BetaReceipt>;
} = {}) {
  const receipts = options.receipts ?? new Map<string, BetaReceipt>();
  const recordCorrection = vi.fn(async (command: BetaRecordCorrectionCommand) => {
    const saved = receipt(command);
    receipts.set(command.command_id, saved);
    return options.recordCorrection ? options.recordCorrection(command) : saved;
  });
  const client = {
    receipt: vi.fn(async (_profileId: string, commandId: string) => receipts.get(commandId) ?? null),
    recordOrganization: { recordCorrection },
  } as unknown as BetaClient;
  return { client, receipts, recordCorrection };
}

function idSequence(...ids: string[]): () => string {
  const pending = [...ids];
  return () => {
    const id = pending.shift();
    if (!id) throw new Error('synthetic ID fixture exhausted');
    return id;
  };
}

function openOwner(
  journal: LocalIntentJournal,
  uuid: () => string = idSequence(COMMAND, CORRECTION_EVENT),
  serviceScope = SERVICE_SCOPE,
) {
  return BetaRecordCorrectionOwner.open({
    deviceId: 'device-a',
    serviceScope,
    journal,
    uuid,
    clock: () => 1_700_000_000_000,
  });
}

describe('Beta record correction recovery owner', () => {
  it('recovers the original command after an accepted RPC loses its receipt and the owner is rebuilt', async () => {
    const journal = new SharedMemoryIntentJournal();
    const facts = new Map<string, BetaRecordCorrectionCommand>();
    const receipts = new Map<string, BetaReceipt>();
    let loseFirstResponse = true;
    const { client, recordCorrection } = makeClient({
      receipts,
      recordCorrection: async command => {
        if (!facts.has(command.command_id)) facts.set(command.command_id, command);
        const saved = receipt(command);
        receipts.set(command.command_id, saved);
        if (loseFirstResponse) {
          loseFirstResponse = false;
          throw new Error('synthetic response loss after commit');
        }
        return saved;
      },
    });

    const firstOwner = await openOwner(journal);
    const first = await firstOwner.submit(client, {
      event_id: TARGET, profile_id: PROFILE, digest: TARGET_DIGEST,
    }, 'fixed correction wording');
    expect(first.status).toBe('pending');
    const originalCommand = first.command;
    firstOwner.close();

    const restoredOwner = await openOwner(journal, () => 'unused');
    await restoredOwner.retry(client, PROFILE, TARGET);

    expect(client.receipt).toHaveBeenCalledWith(PROFILE, originalCommand.command_id);
    expect(recordCorrection).toHaveBeenCalledTimes(1);
    expect(facts.size).toBe(1);
    expect(facts.get(originalCommand.command_id)).toEqual(originalCommand);
    expect(restoredOwner.snapshot().entries).toEqual([]);
    restoredOwner.close();
  });

  it('reconciles a late receipt against the same persisted command after its owner is closed', async () => {
    const journal = new SharedMemoryIntentJournal();
    const receipts = new Map<string, BetaReceipt>();
    let releaseFirst: ((value: BetaReceipt) => void) | undefined;
    let firstCommand: BetaRecordCorrectionCommand | undefined;
    let enteredFirstRpc: (() => void) | undefined;
    const firstRpcStarted = new Promise<void>(resolve => { enteredFirstRpc = resolve; });
    const { client, recordCorrection } = makeClient({
      receipts,
      recordCorrection: command => {
        firstCommand = command;
        enteredFirstRpc?.();
        return new Promise<BetaReceipt>(resolve => { releaseFirst = resolve; });
      },
    });
    const firstOwner = await openOwner(journal);
    const firstSubmission = firstOwner.submit(client, {
      event_id: TARGET, profile_id: PROFILE, digest: TARGET_DIGEST,
    }, 'late but immutable wording');
    await firstRpcStarted;
    if (!firstCommand) throw new Error('the correction RPC must receive the persisted command');
    const originalCommand = firstCommand;
    firstOwner.close();

    const restoredOwner = await openOwner(journal, () => { throw new Error('recovery must reuse the stored command'); });
    expect(restoredOwner.snapshot().entries).toMatchObject([{ status: 'pending', command: originalCommand }]);
    const recovered = await restoredOwner.retry(client, PROFILE, TARGET);
    expect(recovered).toMatchObject({ status: 'accepted', command: originalCommand });

    releaseFirst?.(receipt(originalCommand));
    const late = await firstSubmission;
    expect(late).toMatchObject({ status: 'accepted', command: originalCommand });
    expect(client.receipt).toHaveBeenNthCalledWith(1, PROFILE, originalCommand.command_id);
    expect(client.receipt).toHaveBeenNthCalledWith(2, PROFILE, originalCommand.command_id);
    expect(recordCorrection).toHaveBeenCalledTimes(1);
    expect(recordCorrection).toHaveBeenCalledWith(originalCommand);
    expect(restoredOwner.snapshot().entries).toEqual([]);
    restoredOwner.close();
  });

  it('does not call the correction RPC when the immutable command cannot be persisted', async () => {
    const journal = new SharedMemoryIntentJournal();
    journal.failWrites.add(1);
    const { client, recordCorrection } = makeClient();
    const owner = await openOwner(journal);

    const result = await owner.submit(client, {
      event_id: TARGET, profile_id: PROFILE, digest: TARGET_DIGEST,
    }, 'must stay local');

    expect(result.status).toBe('save_failed');
    expect(recordCorrection).not.toHaveBeenCalled();
    expect(owner.snapshot().entries[0]).toMatchObject({
      status: 'save_failed',
      command: {
        command_id: COMMAND,
        event_id: CORRECTION_EVENT,
        profile_id: PROFILE,
        target_event_id: TARGET,
        target_digest: TARGET_DIGEST,
        occurred_at_ms: 1_700_000_000_000,
        corrected_text: 'must stay local',
      },
    });

    journal.failWrites.clear();
    const retried = await owner.retry(client, PROFILE, TARGET);
    expect(retried.command).toEqual(result.command);
    expect(recordCorrection).toHaveBeenCalledTimes(1);
    owner.close();
  });

  it('keeps correction text literal across Markdown, Unicode, control characters and the UTF-8 byte limit', async () => {
    const journal = new SharedMemoryIntentJournal();
    const owner = await openOwner(journal);
    const correctedText = `> 引用原文\n\n第二段：中文与 emoji 🧪\n\n[来源](https://synthetic.example/reference?id=7&view=full)\n\n\`\`\`json\n{"long":"${'x'.repeat(120_000)}"}\n\`\`\`\n制表符\t与可见控制字符\u0001`;
    expect(new TextEncoder().encode(correctedText).byteLength).toBeLessThanOrEqual(128 * 1024);
    const { client: baseClient } = makeClient();
    const nativeInvocation = vi.fn(async <T>(name: string, args?: Record<string, unknown>): Promise<T> => {
      if (name !== 'beta_record_correction') throw new Error(`unexpected native invocation: ${name}`);
      return receipt(args?.command as BetaRecordCorrectionCommand) as T;
    });
    const client = {
      ...baseClient,
      recordOrganization: nativeRecordOrganizationClient(nativeInvocation),
    } as BetaClient;

    const result = await owner.submit(client, {
      event_id: TARGET, profile_id: PROFILE, digest: TARGET_DIGEST,
    }, correctedText);

    expect(result.status).toBe('accepted');
    expect(nativeInvocation).toHaveBeenCalledTimes(1);
    expect(nativeInvocation).toHaveBeenCalledWith('beta_record_correction', {
      command: expect.objectContaining({ corrected_text: correctedText }),
    });
    owner.close();
  });

  it('refuses to reopen a malformed recovery entry without sending another correction', async () => {
    const journal = new SharedMemoryIntentJournal();
    const { client, recordCorrection } = makeClient({
      recordCorrection: async () => { throw new Error('synthetic response not confirmed'); },
    });
    const owner = await openOwner(journal);
    const pending = await owner.submit(client, {
      event_id: TARGET, profile_id: PROFILE, digest: TARGET_DIGEST,
    }, 'synthetic preserved wording');
    expect(pending.status).toBe('pending');
    owner.close();

    const [key, raw] = [...journal.values.entries()][0];
    const envelope = JSON.parse(raw) as { entries: Array<Record<string, unknown>> };
    envelope.entries[0].status = 'unknown_status';
    journal.values.set(key, JSON.stringify(envelope));

    await expect(openOwner(journal, () => 'unused')).rejects.toMatchObject({ code: 'intent_cache_corrupt' });
    expect(recordCorrection).toHaveBeenCalledTimes(1);
    owner.close();
  });

  it('rejects an over-limit correction before journal mutation or request', async () => {
    const journal = new SharedMemoryIntentJournal();
    const owner = await openOwner(journal);
    const { client, recordCorrection } = makeClient();
    const rawBefore = [...journal.values.entries()];

    await expect(owner.submit(client, {
      event_id: TARGET, profile_id: PROFILE, digest: TARGET_DIGEST,
    }, 'x'.repeat(128 * 1024 + 1))).rejects.toMatchObject({
      code: 'invalid_correction',
      message: '更正内容超过 128 KiB UTF-8 字节上限，请删减后再保存',
    });

    expect([...journal.values.entries()]).toEqual(rawBefore);
    expect(recordCorrection).not.toHaveBeenCalled();
    owner.close();
  });

  it('rejects a malformed UTF-16 surrogate before saving a command', async () => {
    const journal = new SharedMemoryIntentJournal();
    const owner = await openOwner(journal);
    const { client, recordCorrection } = makeClient();

    await expect(owner.submit(client, {
      event_id: TARGET, profile_id: PROFILE, digest: TARGET_DIGEST,
    }, '\ud800')).rejects.toMatchObject({
      code: 'invalid_correction',
      message: '更正内容包含无法传输的 Unicode 字符，请重新输入该字符',
    });
    expect(journal.writes).toBe(0);
    expect(recordCorrection).not.toHaveBeenCalled();
    owner.close();
  });

  it('removes a command after Native explicitly rejects an invalid request', async () => {
    const journal = new SharedMemoryIntentJournal();
    const recordCorrection = vi.fn(async () => { throw new BetaApiError('invalid_request', '请求内容无效'); });
    const client = {
      receipt: vi.fn(async () => null),
      recordOrganization: { recordCorrection },
    } as unknown as BetaClient;
    const owner = await openOwner(journal);

    await expect(owner.submit(client, {
      event_id: TARGET, profile_id: PROFILE, digest: TARGET_DIGEST,
    }, 'synthetic rejected command')).rejects.toMatchObject({ code: 'invalid_request' });

    expect(recordCorrection).toHaveBeenCalledTimes(1);
    expect(owner.snapshot().entries).toEqual([]);
    expect([...journal.values.values()].some(raw => raw.includes(COMMAND))).toBe(false);
    owner.close();
  });

  it('projects the sending stage while the record correction request is awaiting a receipt', async () => {
    const journal = new SharedMemoryIntentJournal();
    let release: ((value: BetaReceipt) => void) | undefined;
    let entered: (() => void) | undefined;
    const requestStarted = new Promise<void>(resolve => { entered = resolve; });
    const { client } = makeClient({
      recordCorrection: command => {
        entered?.();
        return new Promise<BetaReceipt>(resolve => { release = resolve; });
      },
    });
    const owner = await openOwner(journal);
    const submission = owner.submit(client, {
      event_id: TARGET, profile_id: PROFILE, digest: TARGET_DIGEST,
    }, 'request stage text');

    await requestStarted;
    try {
      expect(owner.snapshot().entries).toMatchObject([{ status: 'sending', message: expect.stringContaining('正在发送') }]);
    } finally {
      release?.(receipt({
        command_id: COMMAND, event_id: CORRECTION_EVENT, profile_id: PROFILE, occurred_at_ms: 1_700_000_000_000,
        target_event_id: TARGET, target_digest: TARGET_DIGEST, corrected_text: 'request stage text',
      }));
      await submission;
      owner.close();
    }
  });

  it('keeps a durable accepted result and offers local cleanup after cleanup fails', async () => {
    const journal = new SharedMemoryIntentJournal();
    journal.failWrites.add(3);
    const { client, recordCorrection } = makeClient();
    const owner = await openOwner(journal);

    const result = await owner.submit(client, {
      event_id: TARGET, profile_id: PROFILE, digest: TARGET_DIGEST,
    }, 'accepted correction');

    expect(result.status).toBe('accepted');
    expect(owner.snapshot().entries).toMatchObject([{ status: 'accepted', receipt: { event_id: CORRECTION_EVENT } }]);
    const raw = [...journal.values.values()].find(value => value.includes(COMMAND));
    expect(raw).toContain('"status":"accepted"');

    await owner.retryCleanup(PROFILE, TARGET);
    expect(owner.snapshot().entries).toEqual([]);
    expect(recordCorrection).toHaveBeenCalledTimes(1);
    owner.close();
  });

  it('recovers an accepted receipt after acceptance journal cleanup fails and the owner restarts', async () => {
    const journal = new SharedMemoryIntentJournal();
    journal.failWrites.add(2);
    const { client, recordCorrection } = makeClient();
    const firstOwner = await openOwner(journal);

    const first = await firstOwner.submit(client, {
      event_id: TARGET, profile_id: PROFILE, digest: TARGET_DIGEST,
    }, 'accepted before local acknowledgement');
    const command = first.command;
    expect(first.status).toBe('accepted');
    expect(firstOwner.snapshot().entries).toMatchObject([{ status: 'accepted', command }]);
    firstOwner.close();

    journal.failWrites.clear();
    const restoredOwner = await openOwner(journal, () => { throw new Error('recovery must reuse the stored command'); });
    expect(restoredOwner.snapshot().entries).toMatchObject([{ status: 'pending', command }]);
    const recovered = await restoredOwner.retry(client, PROFILE, TARGET);

    expect(recovered).toMatchObject({ status: 'accepted', command });
    expect(client.receipt).toHaveBeenCalledWith(PROFILE, command.command_id);
    expect(recordCorrection).toHaveBeenCalledTimes(1);
    expect(restoredOwner.snapshot().entries).toEqual([]);
    restoredOwner.close();
  });

  it('does not let a second client replace an unresolved command for the same target', async () => {
    const journal = new SharedMemoryIntentJournal();
    let releaseFirst: ((value: BetaReceipt) => void) | undefined;
    let firstCommand: BetaRecordCorrectionCommand | undefined;
    let enteredFirstRpc: (() => void) | undefined;
    const firstRpcStarted = new Promise<void>(resolve => { enteredFirstRpc = resolve; });
    const { client, recordCorrection } = makeClient({
      recordCorrection: command => {
        firstCommand = command;
        enteredFirstRpc?.();
        return new Promise<BetaReceipt>(resolve => { releaseFirst = resolve; });
      },
    });
    const firstOwner = await openOwner(journal, idSequence(COMMAND, CORRECTION_EVENT));
    const secondOwner = await openOwner(journal, idSequence('55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666'));

    const firstSubmission = firstOwner.submit(client, {
      event_id: TARGET, profile_id: PROFILE, digest: TARGET_DIGEST,
    }, 'first immutable wording');
    await firstRpcStarted;
    await expect(secondOwner.submit(client, {
      event_id: TARGET, profile_id: PROFILE, digest: TARGET_DIGEST,
    }, 'second wording must not replace it')).rejects.toMatchObject({ code: 'correction_pending_conflict' });

    const raw = [...journal.values.values()].find(value => value.includes(COMMAND));
    expect(raw).toContain('first immutable wording');
    expect(raw).not.toContain('second wording must not replace it');
    releaseFirst?.(receipt(firstCommand!));
    await firstSubmission;
    expect(recordCorrection).toHaveBeenCalledTimes(1);
    expect(recordCorrection.mock.calls[0][0].corrected_text).toBe('first immutable wording');
    expect([...journal.values.values()].some(value => value.includes(COMMAND))).toBe(false);
    firstOwner.close();
    secondOwner.close();
  });

  it('keeps separate service and draft scopes for the correction journal', async () => {
    const journal = new SharedMemoryIntentJournal();
    const draftKey = 'exomind:beta:drafts:device-a';
    journal.values.set(draftKey, '{"version":1,"drafts":{"legacy-profile":{"text":"kept"}}}');
    const owner = await openOwner(journal);
    const { client } = makeClient();

    await owner.submit(client, {
      event_id: TARGET, profile_id: PROFILE, digest: TARGET_DIGEST,
    }, 'separate journal');

    expect(journal.values.get(draftKey)).toBe('{"version":1,"drafts":{"legacy-profile":{"text":"kept"}}}');
    expect([...journal.values.keys()].some(key => key.includes('record-corrections'))).toBe(true);
    owner.close();
  });

  it('initializes through the private Native journal namespace without sending a correction', async () => {
    const call = vi.fn(async <T>(_name: string, _args: Record<string, unknown>) => null as T);
    const journal = new NativeIntentJournal(call);
    const owner = await openOwner(journal);

    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][0]).toBe('beta_read_local_intent');
    expect(call.mock.calls[0][1]?.key).toMatch(/^exomind:beta:record-corrections:device-a:[a-f0-9]{64}$/);
    expect(owner.snapshot().entries).toEqual([]);
    owner.close();
  });

  it('does not restore a pending command into a different service scope', async () => {
    const journal = new SharedMemoryIntentJournal();
    const { client } = makeClient({ recordCorrection: async () => { throw new Error('synthetic response loss'); } });
    const first = await openOwner(journal);
    await first.submit(client, { event_id: TARGET, profile_id: PROFILE, digest: TARGET_DIGEST }, 'service A command');
    const otherService = await openOwner(journal, () => 'unused', 'https://other.synthetic.example/beta/v1');

    expect(otherService.snapshot().entries).toEqual([]);
    expect(journal.values.size).toBe(1);
    first.close();
    otherService.close();
  });

  it('fences and removes an explicitly cancelled unsubmitted command without an RPC', async () => {
    const journal = new SharedMemoryIntentJournal();
    journal.failWrites.add(1);
    const { client, recordCorrection } = makeClient();
    const owner = await openOwner(journal);
    const result = await owner.submit(client, {
      event_id: TARGET, profile_id: PROFILE, digest: TARGET_DIGEST,
    }, 'cancel before submission');
    expect(result.status).toBe('save_failed');

    journal.failWrites.clear();
    await expect(owner.cancelUnsubmitted(PROFILE, TARGET)).resolves.toBe(true);
    expect(recordCorrection).not.toHaveBeenCalled();
    expect(owner.snapshot().entries).toEqual([]);
    expect([...journal.values.values()].some(raw => raw.includes('cancel before submission'))).toBe(false);
    owner.close();
  });

  it('keeps a legacy draft without tags readable beside the correction journal', async () => {
    const journal = new SharedMemoryIntentJournal();
    const draftKey = 'exomind:beta:drafts:device-a';
    journal.values.set(draftKey, JSON.stringify({
      version: 1,
      drafts: { [PROFILE]: { text: 'legacy wording', revision: 0 } },
      pending: [],
      confirmed: [],
    }));
    const correctionOwner = await openOwner(journal);
    const client = fakeClient();
    const draftOwner = await BetaDraftController.open(client, 'device-a', { journal, legacy: memoryStorage() });

    expect(draftOwner.snapshot().drafts[PROFILE]).toMatchObject({ text: 'legacy wording' });
    expect(journal.values.get(draftKey)).toContain('legacy wording');
    await draftOwner.submit(PROFILE);
    expect(client.capture).toHaveBeenCalledWith(expect.objectContaining({ text:'legacy wording', tags:[] }));
    await draftOwner.close();
    correctionOwner.close();
  });
});
