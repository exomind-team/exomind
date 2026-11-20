import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BetaOriginalLifecyclePanel } from "../../../src/beta/BetaOriginalLifecyclePanel";
import {
  createOriginalLifecycleClient,
  ORIGINAL_LIFECYCLE_COMMANDS,
  type OriginalLifecycleApplyResult,
  type OriginalLifecycleClient,
  type OriginalLifecycleCommand,
  type OriginalLifecycleStatus,
  type OriginalLifecycleInvoke,
} from "../../../src/beta/original-lifecycle-client";
import {
  OriginalLifecycleOwner,
  originalLifecycleOwnerFor,
} from "../../../src/beta/original-lifecycle-state";

const PROFILE = "11111111-1111-4111-8111-111111111111";
const ORIGINAL = "22222222-2222-4222-8222-222222222222";
const EVENT = "33333333-3333-4333-8333-333333333333";
const OTHER_EVENT = "66666666-6666-4666-8666-666666666666";
const COMMAND = "44444444-4444-4444-8444-444444444444";
const STAGE = "55555555-5555-4555-8555-555555555555";
const FILE_NAME = "meeting-notes.txt";

function capabilityDescriptor(supportsRestoreRetry?: boolean) {
  return {
    schema_version: 1,
    core_schema: 10,
    operations: ["reclaim", "restore", "release_local", "purge_reclaimed"],
    cache_policy: "verified_same_handle",
    supports_reveal: true,
    ...(supportsRestoreRetry === undefined
      ? {}
      : { supports_restore_retry: supportsRestoreRetry }),
  };
}

function lifecycleStatus(
  bytesState: OriginalLifecycleStatus["lifecycle"]["local"]["bytes_state"] =
    "restore_pending",
  profileId = PROFILE,
  latestEventId = EVENT,
): OriginalLifecycleStatus {
  return {
    lifecycle: {
      local: {
        profile_id: profileId,
        original: { original_id: ORIGINAL },
        bytes_state: bytesState,
        generation: 3,
        latest_event_id: latestEventId,
        restore_request_event_id: bytesState === "restore_pending" ? latestEventId : null,
        restore_completion_event_id: null,
        reclaimed_at_ms: null,
        recovery_window_ms: null,
        reclaim_deadline_ms: null,
      },
      remote_sources: [],
    },
    cache_presence: "absent",
  };
}

function applyResult(
  command: OriginalLifecycleCommand,
): OriginalLifecycleApplyResult {
  return {
    receipt: {
      command_id: command.command_id,
      event_id: command.event_id,
      profile_id: command.profile_id,
      local_seq: 3,
      event_digest: "a".repeat(64),
      durability: "local_committed",
      replayed: false,
    },
    status: lifecycleStatus("available"),
    cache_cleanup: {
      status: "not_applicable",
      retryable: false,
      reason: null,
      cache_presence: "absent",
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fakeClient(options: {
  initialState?: OriginalLifecycleStatus["lifecycle"]["local"]["bytes_state"];
  profileId?: string;
  supportsRestoreRetry?: boolean;
  retryRestore?: (profileId: string, originalId: string) => Promise<unknown>;
  status?: () => Promise<OriginalLifecycleStatus>;
  apply?: (command: OriginalLifecycleCommand) => Promise<OriginalLifecycleApplyResult>;
} = {}) {
  const retryRestore = vi.fn(
    options.retryRestore ?? (async () => null),
  );
  const status = vi.fn(
    options.status ??
      (async () =>
        lifecycleStatus(options.initialState ?? "restore_pending", options.profileId)),
  );
  const apply = vi.fn(
    options.apply ?? (async (command: OriginalLifecycleCommand) => applyResult(command)),
  );
  const client = {
    capabilities: vi.fn(async () => capabilityDescriptor(options.supportsRestoreRetry)),
    status,
    apply,
    retryCacheCleanup: vi.fn(async () => ({
      status: "not_applicable",
      retryable: false,
      reason: null,
      cache_presence: "absent",
    })),
    revealCache: vi.fn(async () => {}),
    retryRestore,
  } as unknown as OriginalLifecycleClient;
  return { client, status, apply, retryRestore };
}

function renderPanel(client: OriginalLifecycleClient) {
  return render(
    <BetaOriginalLifecyclePanel
      profileId={PROFILE}
      originalId={ORIGINAL}
      fileName={FILE_NAME}
      client={client}
    />,
  );
}

function ownerFor(client: OriginalLifecycleClient) {
  let next = 0;
  const ids = [EVENT, COMMAND, STAGE];
  return new OriginalLifecycleOwner(
    client,
    PROFILE,
    ORIGINAL,
    () => ids[next++] ?? STAGE,
    () => 1_000,
  );
}

afterEach(() => cleanup());

describe("original lifecycle restore retry entry", () => {
  it("defaults an old schema-1 descriptor without restore-retry capability to false", async () => {
    const nativeInvoke = vi.fn(async () => capabilityDescriptor());
    const client = createOriginalLifecycleClient(
      nativeInvoke as unknown as OriginalLifecycleInvoke,
    );
    const capabilities = await client.capabilities();

    expect(capabilities).toMatchObject({
      schema_version: 1,
      supports_restore_retry: false,
      operations: ["reclaim", "restore", "release_local", "purge_reclaimed"],
    });
    expect(nativeInvoke).toHaveBeenCalledWith(
      ORIGINAL_LIFECYCLE_COMMANDS.capabilities,
      undefined,
    );
  });

  it("routes the retry through its dedicated Native command and fixed profile/original scope", async () => {
    const retry = {
      stage: {
        stage_id: STAGE,
        profile_id: PROFILE,
        original: {
          original_id: ORIGINAL,
          sha256: "a".repeat(64),
          byte_length: 12,
          file_name: FILE_NAME,
          media_type: "text/plain",
        },
        state: "uploading",
        next_offset: 0,
        generation: 4,
      },
      restore_request_event_id: EVENT,
      restore_command_id: COMMAND,
    };
    const nativeInvoke = vi.fn(async () => retry);
    const client = createOriginalLifecycleClient(
      nativeInvoke as unknown as OriginalLifecycleInvoke,
    );
    const retryRestore = (
      client as unknown as {
        retryRestore(profileId: string, originalId: string): Promise<unknown>;
      }
    ).retryRestore;

    await expect(retryRestore.call(client, PROFILE, ORIGINAL)).resolves.toMatchObject(
      retry,
    );
    expect(nativeInvoke).toHaveBeenCalledWith(
      "beta_retry_original_restore",
      { profileId: PROFILE, originalId: ORIGINAL },
    );
    expect(nativeInvoke).not.toHaveBeenCalledWith(
      "beta_apply_original_lifecycle",
      expect.anything(),
    );
  });

  it("exposes retry only for pending bytes with the advertised Native capability and never calls Core apply", async () => {
    const user = userEvent.setup();
    const native = fakeClient({
      initialState: "restore_pending",
      supportsRestoreRetry: true,
    });
    const currentView = renderPanel(native.client);

    await user.click(screen.getByRole("button", { name: "管理本机副本" }));
    await screen.findByText("恢复请求已记录，字节尚未到达");
    const retryButton = await screen.findByRole("button", { name: "重试恢复" });

    await user.click(retryButton);

    await waitFor(() =>
      expect(native.retryRestore).toHaveBeenCalledWith(PROFILE, ORIGINAL),
    );
    await waitFor(() => expect(native.status).toHaveBeenCalledTimes(2));
    expect(native.apply).not.toHaveBeenCalled();
    expect(screen.getByText(/已请求恢复重试/)).toBeTruthy();
    expect(screen.getByText("恢复请求已记录，字节尚未到达")).toBeTruthy();

    currentView.unmount();

    const legacy = fakeClient({
      initialState: "restore_pending",
      supportsRestoreRetry: false,
    });
    const legacyView = renderPanel(legacy.client);
    await user.click(screen.getByRole("button", { name: "管理本机副本" }));
    await screen.findByText("恢复请求已记录，字节尚未到达");
    expect(
      legacyView.queryByRole("button", { name: "重试恢复" }),
    ).toBeNull();
    legacyView.unmount();

    const available = fakeClient({
      initialState: "available",
      supportsRestoreRetry: true,
    });
    const availableView = renderPanel(available.client);
    await user.click(availableView.getByRole("button", { name: "管理本机副本" }));
    await screen.findByText("本机副本可用");
    expect(
      availableView.queryByRole("button", { name: "重试恢复" }),
    ).toBeNull();
  });

  it("keeps a scoped Native request counted after panel unmount and records its acknowledgement", async () => {
    const pendingRetry = deferred<unknown>();
    const native = fakeClient({
      initialState: "restore_pending",
      supportsRestoreRetry: true,
      retryRestore: vi.fn(() => pendingRetry.promise),
    });
    const user = userEvent.setup();
    const view = renderPanel(native.client);
    await user.click(screen.getByRole("button", { name: "管理本机副本" }));
    await screen.findByText("恢复请求已记录，字节尚未到达");
    await user.click(await screen.findByRole("button", { name: "重试恢复" }));
    await waitFor(() => expect(native.retryRestore).toHaveBeenCalledTimes(1));

    const owner = originalLifecycleOwnerFor(
      native.client,
      PROFILE,
      ORIGINAL,
      () => "unused",
      () => 1_000,
    );
    view.unmount();
    expect(
      originalLifecycleOwnerFor(
        native.client,
        PROFILE,
        ORIGINAL,
        () => "replacement",
        () => 1_000,
      ),
    ).toBe(owner);

    pendingRetry.resolve(null);
    await waitFor(() =>
      expect(owner.getSnapshot().restoreRetryPhase).toBe("requested"),
    );
    expect(native.retryRestore).toHaveBeenCalledWith(PROFILE, ORIGINAL);
    expect(native.apply).not.toHaveBeenCalled();
    expect(owner.getSnapshot().status?.lifecycle.local.bytes_state).toBe(
      "restore_pending",
    );
  });

  it("reports an unknown retry result after one request and blocks retry beside an unresolved Core intent", async () => {
    const native = fakeClient({
      initialState: "restore_pending",
      supportsRestoreRetry: true,
      retryRestore: vi.fn(async () => {
        throw new Error("reply lost");
      }),
    });
    const owner = ownerFor(native.client);
    await owner.open();
    await (owner as unknown as { retryRestore(): Promise<void> }).retryRestore();

    expect(native.retryRestore).toHaveBeenCalledTimes(1);
    expect(native.status).toHaveBeenCalledTimes(2);
    expect(native.apply).not.toHaveBeenCalled();
    expect(owner.getSnapshot().restoreRetryPhase).toBe("unknown");

    const statuses = [
      lifecycleStatus("available", PROFILE, OTHER_EVENT),
      lifecycleStatus("restore_pending", PROFILE, OTHER_EVENT),
    ];
    let statusIndex = 0;
    const unresolved = fakeClient({
      supportsRestoreRetry: true,
      status: async () =>
        statuses[Math.min(statusIndex++, statuses.length - 1)],
      apply: async () => {
        throw new Error("Core reply lost");
      },
    });
    const unresolvedOwner = ownerFor(unresolved.client);
    await unresolvedOwner.open();
    await unresolvedOwner.begin("reclaim");
    expect(unresolvedOwner.getSnapshot().operation?.phase).toBe("unknown");

    await (
      unresolvedOwner as unknown as { retryRestore(): Promise<void> }
    ).retryRestore();
    expect(unresolved.retryRestore).not.toHaveBeenCalled();
  });

  it("does not start restore retry while another Core intent is still submitting", async () => {
    const pendingApply = deferred<OriginalLifecycleApplyResult>();
    const native = fakeClient({
      initialState: "available",
      supportsRestoreRetry: true,
      status: async () => lifecycleStatus("available"),
      apply: () => pendingApply.promise,
    });
    const owner = ownerFor(native.client);
    await owner.open();
    const applying = owner.begin("reclaim");

    await (owner as unknown as { retryRestore(): Promise<void> }).retryRestore();
    expect(native.retryRestore).not.toHaveBeenCalled();

    const command = owner.getSnapshot().operation?.command;
    pendingApply.resolve(applyResult(command as OriginalLifecycleCommand));
    await applying;
  });
});
