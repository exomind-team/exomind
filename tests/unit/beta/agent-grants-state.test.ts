import { describe, expect, it, vi } from "vitest";
import {
  AgentGrantClientError,
  type AgentGrantIssueCommand,
  type AgentGrantIssueResult,
  type AgentGrantMetadata,
  type AgentGrantsClient,
} from "@/beta/agent-grants-client";
import {
  AgentGrantsController,
  createAgentGrantIssueLedger,
} from "@/beta/agent-grants-state";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const GRANT_ID = "22222222-2222-4222-8222-222222222222";
const AGENT_ID = "33333333-3333-4333-8333-333333333333";
const HANDLE = "44444444-4444-4444-8444-444444444444";

function metadata(
  overrides: Partial<AgentGrantMetadata> = {},
): AgentGrantMetadata {
  return {
    grant_id: GRANT_ID,
    profile_id: PROFILE_ID,
    kind: "observer",
    agent_id: null,
    revoked: false,
    ...overrides,
  };
}

function result(
  overrides: Partial<AgentGrantIssueResult> = {},
): AgentGrantIssueResult {
  return {
    grant: metadata(),
    issuance: "created",
    credential_handle: HANDLE,
    credential_state: "available",
    ...overrides,
  };
}

function fakeClient(
  overrides: Partial<AgentGrantsClient> = {},
): AgentGrantsClient {
  return {
    list: vi.fn(async () => []),
    issue: vi.fn(async () => result()),
    recover: vi.fn(async () => result({ issuance: "recovered" })),
    revoke: vi.fn(async () => ({
      grant: metadata({ revoked: true }),
      credential_material_released: true,
      completion: "confirmed",
    })),
    copyAccessInfo: vi.fn(async () => ({
      credential_handle: HANDLE,
      credential_state: "copied",
      material_retained: true,
    })),
    releaseCredential: vi.fn(async () => ({
      material_released: true,
      credential_state: "unavailable",
    })),
    ...overrides,
  };
}

function controller(client: AgentGrantsClient, profileId = PROFILE_ID) {
  return new AgentGrantsController(client, profileId, {
    createId: () => GRANT_ID,
    ledger: createAgentGrantIssueLedger(),
  });
}

describe("Agent grant lifecycle state", () => {
  it("uses one stable grant ID for recovery and reissue after recovery confirms no grant", async () => {
    const client = fakeClient({
      issue: vi.fn(async () => {
        throw new AgentGrantClientError(
          "grant_issue_unconfirmed",
          "签发回执未确认",
          "uncertain",
        );
      }),
      recover: vi.fn(async () => {
        throw new AgentGrantClientError(
          "grant_not_found",
          "未找到授权",
          "not_found",
        );
      }),
    });
    const state = controller(client);

    await state.issue("agent_note", AGENT_ID);
    const pending = state.getState().pendingIssue;
    expect(pending?.phase).toBe("not_issued");
    expect(pending?.command).toEqual({
      grant_id: GRANT_ID,
      profile_id: PROFILE_ID,
      kind: "agent_note",
      agent_id: AGENT_ID,
    });
    expect(client.recover).toHaveBeenCalledWith(PROFILE_ID, GRANT_ID);

    vi.mocked(client.issue).mockResolvedValueOnce(
      result({ grant: metadata({ kind: "agent_note", agent_id: AGENT_ID }) }),
    );
    await state.retryUnissuedIssue();

    expect(client.issue).toHaveBeenNthCalledWith(1, {
      grant_id: GRANT_ID,
      profile_id: PROFILE_ID,
      kind: "agent_note",
      agent_id: AGENT_ID,
    });
    expect(client.issue).toHaveBeenNthCalledWith(2, {
      grant_id: GRANT_ID,
      profile_id: PROFILE_ID,
      kind: "agent_note",
      agent_id: AGENT_ID,
    });
    expect(state.getState().pendingIssue).toBeNull();
  });

  it("retains an uncertain issue identity after recover also remains uncertain and blocks a fresh issue", async () => {
    const client = fakeClient({
      issue: vi.fn(async () => {
        throw new AgentGrantClientError(
          "native_unavailable",
          "签发结果未确认",
          "uncertain",
        );
      }),
      recover: vi.fn(async () => {
        throw new AgentGrantClientError(
          "native_unavailable",
          "授权状态未确认",
          "uncertain",
        );
      }),
    });
    const ledger = createAgentGrantIssueLedger();
    const state = new AgentGrantsController(client, PROFILE_ID, {
      createId: () => GRANT_ID,
      ledger,
    });

    await state.issue("observer", null);
    expect(state.getState().pendingIssue?.phase).toBe("uncertain");
    expect(ledger.get(PROFILE_ID)?.command.grant_id).toBe(GRANT_ID);
    await state.issue("summary_producer", AGENT_ID);

    expect(client.issue).toHaveBeenCalledTimes(1);
    expect(ledger.get(PROFILE_ID)?.command.kind).toBe("observer");
  });

  it("keeps metadata when recovery reports unavailable and never silently issues a replacement", async () => {
    const existing = metadata({ kind: "agent_note", agent_id: AGENT_ID });
    const client = fakeClient({
      list: vi.fn(async () => [existing]),
      recover: vi.fn(async () =>
        result({
          grant: existing,
          issuance: "existing",
          credential_handle: null,
          credential_state: "unavailable",
        }),
      ),
    });
    const state = controller(client);
    await state.refresh();
    await state.recoverGrant(GRANT_ID);

    expect(state.getState().grants[0]).toMatchObject({
      metadata: existing,
      credentialState: "unavailable",
      credentialHandle: null,
    });
    expect(client.issue).not.toHaveBeenCalled();
    expect(client.revoke).not.toHaveBeenCalled();
  });

  it("keeps conflicting metadata without treating a read response as permission to clear Native material", async () => {
    const conflictingGrant = metadata({
      kind: "agent_note",
      agent_id: AGENT_ID,
    });
    const client = fakeClient({
      issue: vi.fn(async () => {
        throw new AgentGrantClientError(
          "grant_id_conflict",
          "此 grant ID 已绑定其他档案或角色，请先查证授权列表。",
          "uncertain",
        );
      }),
      recover: vi.fn(async () =>
        result({
          grant: conflictingGrant,
          issuance: "existing",
          credential_handle: HANDLE,
          credential_state: "available",
        }),
      ),
    });
    const state = controller(client);
    await state.issue("observer", null);

    expect(state.getState().grants[0]).toMatchObject({
      metadata: conflictingGrant,
      credentialState: "unavailable",
      credentialHandle: null,
    });
    expect(state.getState().pendingIssue).toBeNull();
    expect(state.getState().notice).toContain("原请求未按所选角色签发");
    expect(client.releaseCredential).not.toHaveBeenCalled();
    expect(client.issue).toHaveBeenCalledTimes(1);
  });

  it("retries a failed copy with the same opaque handle", async () => {
    const client = fakeClient({
      issue: vi.fn(async () => result()),
      copyAccessInfo: vi
        .fn()
        .mockRejectedValueOnce(
          new AgentGrantClientError(
            "copy_failed",
            "复制未确认，可重试",
            "uncertain",
          ),
        )
        .mockResolvedValueOnce({
          credential_handle: HANDLE,
          credential_state: "copied",
          material_retained: true,
        }),
    });
    const state = controller(client);
    await state.issue("observer", null);

    await state.copyAccessInfo(GRANT_ID);
    expect(state.getState().grants[0]?.credentialHandle).toBe(HANDLE);
    await state.copyAccessInfo(GRANT_ID);

    expect(client.copyAccessInfo).toHaveBeenNthCalledWith(
      1,
      PROFILE_ID,
      GRANT_ID,
      HANDLE,
    );
    expect(client.copyAccessInfo).toHaveBeenNthCalledWith(
      2,
      PROFILE_ID,
      GRANT_ID,
      HANDLE,
    );
    expect(state.getState().grants[0]?.credentialState).toBe("copied");
  });

  it("closes only observation while Native retains the credential for later recovery", async () => {
    const client = fakeClient();
    const state = controller(client);
    await state.issue("observer", null);
    await state.close();

    expect(client.releaseCredential).not.toHaveBeenCalled();
    expect(client.revoke).not.toHaveBeenCalled();
    expect(state.getState().grants[0]?.credentialHandle).toBeNull();
    vi.mocked(client.list).mockResolvedValue([metadata()]);
    const reopened = controller(client);
    await reopened.refresh();
    await reopened.recoverGrant(GRANT_ID);
    await reopened.copyAccessInfo(GRANT_ID);
    expect(client.copyAccessInfo).toHaveBeenCalledWith(PROFILE_ID, GRANT_ID, HANDLE);
    expect(client.releaseCredential).not.toHaveBeenCalled();
    await reopened.close();
  });

  it("retains the observation and authorization when explicit material clearing is unconfirmed", async () => {
    const client = fakeClient({releaseCredential: vi.fn(async () => { throw new AgentGrantClientError("native_unavailable", "本机材料清除未确认", "uncertain"); })});
    const state = controller(client);
    await state.issue("observer", null);
    await state.releaseCredentialMaterial(GRANT_ID);
    expect(state.getState().grants[0]).toMatchObject({credentialHandle: HANDLE, metadata: {revoked: false}});
    expect(state.getState().grants[0]?.message).toContain("未确认");
    expect(client.revoke).not.toHaveBeenCalled();
    await state.close();
    expect(client.releaseCredential).toHaveBeenCalledTimes(1);
  });

  it("marks a revoked grant and explains that accepted work is not rolled back", async () => {
    const active = metadata();
    const revoked = metadata({ revoked: true });
    const client = fakeClient({
      list: vi.fn(async () => [active]),
      revoke: vi.fn(async () => ({
        grant: revoked,
        credential_material_released: true,
        completion: "confirmed",
      })),
    });
    const state = controller(client);
    await state.refresh();
    await state.revokeGrant(GRANT_ID);

    expect(state.getState().grants[0]?.metadata.revoked).toBe(true);
    expect(state.getState().notice).toContain("已接受");
    expect(client.revoke).toHaveBeenCalledWith(PROFILE_ID, GRANT_ID);
  });

  it("keeps a late successful issue in Native after the view closes without committing it into that view", async () => {
    let resolveIssue!: (value: AgentGrantIssueResult) => void;
    const client = fakeClient({
      issue: vi.fn(
        () =>
          new Promise<AgentGrantIssueResult>((resolve) => {
            resolveIssue = resolve;
          }),
      ),
    });
    const state = controller(client);
    const issuing = state.issue("observer", null);
    await state.close();
    resolveIssue(result());
    await issuing;

    expect(client.releaseCredential).not.toHaveBeenCalled();
    expect(client.revoke).not.toHaveBeenCalled();
    expect(state.getState().grants).toEqual([]);
  });

  it("clears a reopened observer issue when the old issuance succeeds before its late list", async () => {
    let finishIssue!: (value: AgentGrantIssueResult) => void;
    let finishList!: (items: AgentGrantMetadata[]) => void;
    let signalIssueStarted!: () => void;
    let signalListStarted!: () => void;
    const issueStarted = new Promise<void>((resolve) => {
      signalIssueStarted = resolve;
    });
    const listStarted = new Promise<void>((resolve) => {
      signalListStarted = resolve;
    });
    let issueCalls = 0;
    let listCalls = 0;
    const client = fakeClient({
      list: vi.fn(() => {
        listCalls += 1;
        if (listCalls === 1) {
          signalListStarted();
          return new Promise<AgentGrantMetadata[]>((resolve) => {
            finishList = resolve;
          });
        }
        return Promise.resolve([]);
      }),
      issue: vi.fn((command: AgentGrantIssueCommand): Promise<AgentGrantIssueResult> => {
        issueCalls += 1;
        if (issueCalls === 1) {
          signalIssueStarted();
          return new Promise<AgentGrantIssueResult>((resolve) => {
            finishIssue = resolve;
          });
        }
        return Promise.resolve(
          result({
            grant: metadata({
              grant_id: command.grant_id,
              kind: command.kind,
              agent_id: command.agent_id,
            }),
          }),
        );
      }),
    });
    const ledger = createAgentGrantIssueLedger();
    const old = new AgentGrantsController(client, PROFILE_ID, {
      createId: () => GRANT_ID,
      ledger,
    });
    const issuing = old.issue("observer", null);
    await issueStarted;
    await old.close();
    expect(ledger.get(PROFILE_ID)?.phase).toBe("issuing");

    const reopened = new AgentGrantsController(client, PROFILE_ID, {
      createId: () => "55555555-5555-4555-8555-555555555555",
      ledger,
    });
    const listing = reopened.refresh();
    await listStarted;

    finishIssue(result());
    await issuing;
    expect(ledger.get(PROFILE_ID)).toBeNull();

    finishList([metadata()]);
    await listing;
    expect(reopened.getState().pendingIssue).toBeNull();
    expect(reopened.getState().grants.map((row) => row.metadata.grant_id)).toContain(
      GRANT_ID,
    );
    await reopened.close();
  });

  it("confirms a late grant ID without clearing a different pending grant", () => {
    const ledger = createAgentGrantIssueLedger();
    const nextGrantId = "55555555-5555-4555-8555-555555555555";
    ledger.begin({
      command: {
        grant_id: GRANT_ID,
        profile_id: PROFILE_ID,
        kind: "observer",
        agent_id: null,
      },
      phase: "issuing",
      message: null,
    });
    ledger.begin({
      command: {
        grant_id: nextGrantId,
        profile_id: PROFILE_ID,
        kind: "observer",
        agent_id: null,
      },
      phase: "issuing",
      message: null,
    });

    ledger.confirm(PROFILE_ID, GRANT_ID, metadata());

    expect(ledger.get(PROFILE_ID)).toMatchObject({
      command: { grant_id: nextGrantId },
      phase: "issuing",
    });
  });

  it("keeps a revoked grant revoked after a closed issue succeeds late", async () => {
    let finishIssue!: (value: AgentGrantIssueResult) => void;
    let signalIssueStarted!: () => void;
    const issueStarted = new Promise<void>((resolve) => {
      signalIssueStarted = resolve;
    });
    const native = fakeClient({
      issue: vi.fn(
        () =>
          new Promise<AgentGrantIssueResult>((resolve) => {
            signalIssueStarted();
            finishIssue = resolve;
          }),
      ),
    });
    const ledger = createAgentGrantIssueLedger();
    const old = new AgentGrantsController(native, PROFILE_ID, {
      createId: () => GRANT_ID,
      ledger,
    });
    const issuing = old.issue("observer", null);
    await issueStarted;
    await old.close();

    const reopened = new AgentGrantsController(native, PROFILE_ID, { ledger });
    await reopened.refresh();
    expect(reopened.getState().grants[0]?.metadata.revoked).toBe(false);

    await reopened.revokeGrant(GRANT_ID);
    expect(reopened.getState().grants[0]?.metadata.revoked).toBe(true);

    finishIssue(result());
    await issuing;

    expect(reopened.getState().grants[0]?.metadata.revoked).toBe(true);
    await reopened.close();
  });

  it("keeps a grant revoked when an older list response arrives after revoke", async () => {
    let finishStaleList!: (items: AgentGrantMetadata[]) => void;
    let signalStaleListStarted!: () => void;
    const staleListStarted = new Promise<void>((resolve) => {
      signalStaleListStarted = resolve;
    });
    let listCalls = 0;
    const native = fakeClient({
      list: vi.fn(() => {
        listCalls += 1;
        if (listCalls === 1) return Promise.resolve([metadata()]);
        signalStaleListStarted();
        return new Promise<AgentGrantMetadata[]>((resolve) => {
          finishStaleList = resolve;
        });
      }),
    });
    const state = controller(native);
    await state.refresh();

    const staleList = state.refresh();
    await staleListStarted;
    await state.revokeGrant(GRANT_ID);
    expect(state.getState().grants[0]?.metadata.revoked).toBe(true);

    finishStaleList([metadata()]);
    await staleList;

    expect(state.getState().grants[0]?.metadata.revoked).toBe(true);
    await state.close();
  });
  it("does not let an older recovery timeout overwrite a newer not-issued result", async () => {
    let rejectOldRecovery!: (reason: unknown) => void;
    let signalOldRecoveryStarted!: () => void;
    const oldRecoveryStarted = new Promise<void>((resolve) => {
      signalOldRecoveryStarted = resolve;
    });
    let recoverCalls = 0;
    const client = fakeClient({
      issue: vi.fn(async () => {
        throw new AgentGrantClientError(
          "grant_issue_unconfirmed",
          "签发回执未确认",
          "uncertain",
        );
      }),
      recover: vi.fn(() => {
        recoverCalls += 1;
        if (recoverCalls === 1) {
          signalOldRecoveryStarted();
          return new Promise<AgentGrantIssueResult>((_resolve, reject) => {
            rejectOldRecovery = reject;
          });
        }
        return Promise.reject(
          new AgentGrantClientError("grant_not_found", "未找到授权", "not_found"),
        );
      }),
    });
    const ledger = createAgentGrantIssueLedger();
    const old = new AgentGrantsController(client, PROFILE_ID, {
      createId: () => GRANT_ID,
      ledger,
    });
    const issuing = old.issue("observer", null);
    await oldRecoveryStarted;
    await old.close();

    const reopened = new AgentGrantsController(client, PROFILE_ID, { ledger });
    await reopened.refresh();
    expect(ledger.get(PROFILE_ID)?.phase).toBe("not_issued");

    rejectOldRecovery(
      new AgentGrantClientError(
        "native_unavailable",
        "旧查证超时",
        "uncertain",
      ),
    );
    await issuing;

    expect(ledger.get(PROFILE_ID)?.phase).toBe("not_issued");
    expect(reopened.getState().pendingIssue?.phase).toBe("not_issued");
    await reopened.close();
  });

  it("does not restore an old uncertain issue after a reopened view has already confirmed it", async () => {
    let rejectIssue!: (error: unknown) => void;
    const client = fakeClient({issue: vi.fn(() => new Promise((_resolve, reject) => { rejectIssue = reject; }))});
    const ledger = createAgentGrantIssueLedger();
    const old = new AgentGrantsController(client, PROFILE_ID, {createId: () => GRANT_ID, ledger});
    const issuing = old.issue("observer", null);
    await old.close();
    const next = new AgentGrantsController(client, PROFILE_ID, {ledger});
    await next.refresh();
    expect(ledger.get(PROFILE_ID)).toBeNull();
    rejectIssue(new AgentGrantClientError("native_unavailable", "迟到的未知回执", "uncertain"));
    await issuing;
    expect(ledger.get(PROFILE_ID)).toBeNull();
    expect(next.getState().pendingIssue).toBeNull();
    await next.close();
  });

  it("keeps late failures tied to their original profile and does not place profile P results into Q", async () => {
    let rejectIssue!: (reason: unknown) => void;
    const profileP = fakeClient({
      issue: vi.fn(
        () =>
          new Promise<AgentGrantIssueResult>((_resolve, reject) => {
            rejectIssue = reject;
          }),
      ),
    });
    const ledgerP = createAgentGrantIssueLedger();
    const stateP = new AgentGrantsController(profileP, PROFILE_ID, {
      createId: () => GRANT_ID,
      ledger: ledgerP,
    });
    const issuing = stateP.issue("observer", null);
    await stateP.close();
    rejectIssue(
      new AgentGrantClientError(
        "native_unavailable",
        "签发结果未确认",
        "uncertain",
      ),
    );
    await issuing;
    expect(ledgerP.get(PROFILE_ID)?.phase).toBe("uncertain");
    expect(ledgerP.get(PROFILE_ID)?.command).toEqual({
      grant_id: GRANT_ID,
      profile_id: PROFILE_ID,
      kind: "observer",
      agent_id: null,
    });

    const reopenedP = new AgentGrantsController(profileP, PROFILE_ID, {
      createId: () => "55555555-5555-4555-8555-555555555555",
      ledger: ledgerP,
    });
    await reopenedP.refresh();
    expect(profileP.recover).toHaveBeenCalledWith(PROFILE_ID, GRANT_ID);
    expect(ledgerP.get(PROFILE_ID)).toBeNull();
    expect(reopenedP.getState().grants[0]?.metadata.grant_id).toBe(GRANT_ID);

    const profileQ = "55555555-5555-4555-8555-555555555555";
    const stateQ = controller(fakeClient(), profileQ);
    await stateQ.refresh();
    expect(stateQ.getState().profileId).toBe(profileQ);
    expect(stateQ.getState().grants).toEqual([]);
    await reopenedP.close();
  });

  it("keeps snapshots free of raw credential fields and arbitrary Native error text", async () => {
    const client = fakeClient({
      issue: vi.fn(async () => result()),
      copyAccessInfo: vi.fn(async () => {
        throw new AgentGrantClientError(
          "copy_failed",
          "复制未确认，可重试",
          "uncertain",
        );
      }),
    });
    const state = controller(client);
    await state.issue("observer", null);
    await state.copyAccessInfo(GRANT_ID);

    const serialized = JSON.stringify(state.getState());
    expect(serialized).toContain(HANDLE);
    expect(serialized).not.toMatch(/"(?:token|bearer|rawCredential)"\s*:/i);
    expect(serialized).not.toContain("unexpected native detail");
  });
});
