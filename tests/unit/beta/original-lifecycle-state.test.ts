import { describe, expect, it, vi } from "vitest";
import {
  OriginalLifecycleOwner,
  originalLifecycleActions,
  originalLifecycleOwnerFor,
} from "../../../src/beta/original-lifecycle-state";
import type {
  OriginalCacheCleanupResult,
  OriginalLifecycleApplyResult,
  OriginalLifecycleCapabilities,
  OriginalLifecycleClient,
  OriginalLifecycleCommand,
  OriginalLifecycleStatus,
} from "../../../src/beta/original-lifecycle-client";

const PROFILE = "11111111-1111-4111-8111-111111111111";
const ORIGINAL = "22222222-2222-4222-8222-222222222222";
const IDS = [
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
  "66666666-6666-4666-8666-666666666666",
];

function capabilities(
  supportsReveal = true,
): OriginalLifecycleCapabilities {
  return {
    schema_version: 1,
    core_schema: 10,
    operations: [
      "reclaim",
      "restore",
      "release_local",
      "purge_reclaimed",
    ] as OriginalLifecycleCapabilities["operations"],
    cache_policy: "verified_same_handle",
    supports_reveal: supportsReveal,
  };
}

function lifecycleStatus(
  bytesState: OriginalLifecycleStatus["lifecycle"]["local"]["bytes_state"] =
    "available",
  options: {
    generation?: number;
    latestEventId?: string | null;
    deadline?: number | null;
    cachePresence?: OriginalLifecycleStatus["cache_presence"];
    profileId?: string;
  } = {},
): OriginalLifecycleStatus {
  return {
    lifecycle: {
      local: {
        profile_id: options.profileId ?? PROFILE,
        original: { original_id: ORIGINAL },
        bytes_state: bytesState,
        generation: options.generation ?? 2,
        latest_event_id: options.latestEventId ?? null,
        restore_request_event_id: null,
        restore_completion_event_id: null,
        reclaimed_at_ms: bytesState === "reclaimed" ? 1_000 : null,
        recovery_window_ms: bytesState === "reclaimed" ? 5_000 : null,
        reclaim_deadline_ms:
          options.deadline === undefined
            ? bytesState === "reclaimed"
              ? 10_000
              : null
            : options.deadline,
      },
      remote_sources: [],
    },
    cache_presence: options.cachePresence ?? "absent",
  };
}

function cleanup(
  status: OriginalCacheCleanupResult["status"] = "not_applicable",
  retryable = false,
  reason: OriginalCacheCleanupResult["reason"] = null,
  cachePresence: OriginalCacheCleanupResult["cache_presence"] = "unknown",
): OriginalCacheCleanupResult {
  return { status, retryable, reason, cache_presence: cachePresence };
}

function applied(
  command: OriginalLifecycleCommand,
  status: OriginalLifecycleStatus | null,
  cacheCleanup = cleanup(),
): OriginalLifecycleApplyResult {
  return {
    receipt: {
      command_id: command.command_id,
      event_id: command.event_id,
      profile_id: command.profile_id,
      local_seq: 3,
      event_digest: "d".repeat(64),
      durability: "local_committed",
      replayed: false,
    },
    status,
    cache_cleanup: cacheCleanup,
  };
}

function client(
  overrides: Partial<OriginalLifecycleClient> = {},
): OriginalLifecycleClient {
  return {
    capabilities: vi.fn(async () => capabilities()),
    status: vi.fn(async () => lifecycleStatus()),
    apply: vi.fn(async (command) =>
      applied(command, lifecycleStatus("available")),
    ),
    retryCacheCleanup: vi.fn(async () => cleanup("complete", false, null, "absent")),
    revealCache: vi.fn(async () => {}),
    ...overrides,
  };
}

function ownerFor(
  native: OriginalLifecycleClient,
  now: () => number = () => 1_000,
  profileId = PROFILE,
  originalId = ORIGINAL,
): OriginalLifecycleOwner {
  let nextId = 0;
  return new OriginalLifecycleOwner(
    native,
    profileId,
    originalId,
    () => IDS[nextId++] ?? IDS[IDS.length - 1],
    now,
  );
}

function busyError(): Error {
  return Object.assign(new Error("same original is busy"), {
    code: "original_busy",
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("Original lifecycle operation owner", () => {
  it("does not query capabilities or status until the management panel opens", () => {
    const native = client();
    ownerFor(native);

    expect(native.capabilities).not.toHaveBeenCalled();
    expect(native.status).not.toHaveBeenCalled();
  });

  it("allows purge only at or after the authoritative reclaim deadline", async () => {
    let now = 9_999;
    const native = client({
      status: vi.fn(async () =>
        lifecycleStatus("reclaimed", { deadline: 10_000 }),
      ),
    });
    const owner = ownerFor(native, () => now);
    await owner.open();

    expect(
      originalLifecycleActions(
        owner.getSnapshot().status,
        owner.getSnapshot().capabilities,
        now,
      ),
    ).not.toContain("purge_reclaimed");
    await owner.begin("purge_reclaimed");
    expect(native.apply).not.toHaveBeenCalled();

    now = 10_000;
    expect(
      originalLifecycleActions(
        owner.getSnapshot().status,
        owner.getSnapshot().capabilities,
        now,
      ),
    ).toContain("purge_reclaimed");
  });

  it("treats reclaim restore as immediately available and released restore as pending", async () => {
    const reclaimed = client({
      status: vi.fn(async () => lifecycleStatus("reclaimed")),
      apply: vi.fn(async (command) =>
        applied(command, lifecycleStatus("available", { generation: 3 })),
      ),
    });
    const reclaimedOwner = ownerFor(reclaimed);
    await reclaimedOwner.open();
    await reclaimedOwner.begin("restore");
    expect(reclaimedOwner.getSnapshot().status?.lifecycle.local.bytes_state).toBe(
      "available",
    );

    const released = client({
      status: vi.fn(async () => lifecycleStatus("released")),
      apply: vi.fn(async (command) =>
        applied(
          command,
          lifecycleStatus("restore_pending", {
            generation: 3,
            latestEventId: command.event_id,
          }),
        ),
      ),
    });
    const releasedOwner = ownerFor(released);
    await releasedOwner.open();
    await releasedOwner.begin("restore");
    expect(releasedOwner.getSnapshot().status?.lifecycle.local.bytes_state).toBe(
      "restore_pending",
    );
    expect(released.apply).toHaveBeenCalledTimes(1);
    expect(released.status).toHaveBeenCalledTimes(1);
  });

  it("keeps the 操作回执 and partial Native cache result separate and retries cache only", async () => {
    const native = client({
      status: vi.fn(async () => lifecycleStatus("available")),
      apply: vi.fn(async (command) =>
        applied(
          command,
          lifecycleStatus("released", {
            generation: 3,
            latestEventId: command.event_id,
            cachePresence: "unknown",
          }),
          cleanup("partial", true, "verification_incomplete", "unknown"),
        ),
      ),
      retryCacheCleanup: vi.fn(async () =>
        cleanup("complete", false, null, "absent"),
      ),
    });
    const owner = ownerFor(native);
    await owner.open();
    await owner.begin("release_local");

    const accepted = owner.getSnapshot();
    expect(accepted.operation?.phase).toBe("accepted");
    expect(accepted.operation?.receipt?.durability).toBe("local_committed");
    expect(accepted.cacheResult?.result).toMatchObject({
      status: "partial",
      retryable: true,
      reason: "verification_incomplete",
    });

    await owner.retryCacheCleanup();
    expect(native.apply).toHaveBeenCalledTimes(1);
    expect(native.retryCacheCleanup).toHaveBeenCalledTimes(1);
    expect(owner.getSnapshot().operation?.receipt?.local_seq).toBe(3);
    expect(owner.getSnapshot().cacheResult?.result).toMatchObject({
      status: "complete",
      cache_presence: "absent",
    });
  });

  it("retains partial cache evidence while the original row is unmounted", async () => {
    const native = client({
      apply: vi.fn(async (command) =>
        applied(
          command,
          lifecycleStatus("released", {
            generation: 3,
            latestEventId: command.event_id,
          }),
          cleanup("partial", true, "filesystem_rejected", "unknown"),
        ),
      ),
    });
    const owner = originalLifecycleOwnerFor(
      native,
      PROFILE,
      ORIGINAL,
      () => IDS[0],
      () => 1_000,
    );
    const stopObserving = owner.subscribe(() => {});
    await owner.open();
    await owner.begin("release_local");
    stopObserving();

    const reopened = originalLifecycleOwnerFor(
      native,
      PROFILE,
      ORIGINAL,
      () => IDS[1],
      () => 1_000,
    );
    expect(reopened).toBe(owner);
    expect(reopened.getSnapshot().cacheResult?.result).toMatchObject({
      status: "partial",
      reason: "filesystem_rejected",
    });
  });

  it("preserves the exact command draft when Native reports same-key busy", async () => {
    const native = client({
      apply: vi
        .fn()
        .mockRejectedValueOnce(busyError())
        .mockImplementation(async (command) =>
          applied(
            command,
            lifecycleStatus("released", {
              generation: 3,
              latestEventId: command.event_id,
            }),
          ),
        ),
    });
    const owner = ownerFor(native);
    await owner.open();
    await owner.begin("release_local");

    const draft = owner.getSnapshot().operation?.command;
    expect(owner.getSnapshot().operation?.phase).toBe("not_issued");
    expect(draft).toMatchObject({
      action: "release_local",
      cleanup_confirmed: true,
      expected_generation: 2,
    });

    await owner.retrySameCommand();
    expect(native.apply).toHaveBeenCalledTimes(2);
    expect(native.apply).toHaveBeenNthCalledWith(2, draft);
    expect(owner.getSnapshot().operation?.phase).toBe("accepted");
  });

  it("retries only Native cache cleanup after status proves an unknown release event", async () => {
    let attempted: OriginalLifecycleCommand | null = null;
    let statusCalls = 0;
    const native = client({
      status: vi.fn(async () => {
        statusCalls += 1;
        if (statusCalls === 1) return lifecycleStatus("available");
        return lifecycleStatus("released", {
          generation: 3,
          latestEventId: attempted?.event_id ?? null,
          cachePresence: "unknown",
        });
      }),
      apply: vi.fn(async (command) => {
        attempted = command;
        throw new Error("reply lost");
      }),
      retryCacheCleanup: vi.fn(async () =>
        cleanup("partial", true, "filesystem_rejected", "unknown"),
      ),
    });
    const owner = ownerFor(native);
    await owner.open();
    await owner.begin("release_local");

    expect(owner.getSnapshot().operation).toMatchObject({
      phase: "accepted_by_status",
      receipt: null,
    });
    expect(owner.getSnapshot().cacheResult).toBeNull();

    await owner.retryCacheCleanup();
    expect(native.apply).toHaveBeenCalledTimes(1);
    expect(native.retryCacheCleanup).toHaveBeenCalledTimes(1);
    expect(owner.getSnapshot().cacheResult).toMatchObject({
      action: "release_local",
      result: {
        status: "partial",
        reason: "filesystem_rejected",
        retryable: true,
      },
    });
  });

  it("queries authoritative status after an unknown result and does not auto-resend", async () => {
    const native = client({
      status: vi
        .fn()
        .mockResolvedValueOnce(lifecycleStatus("available"))
        .mockResolvedValueOnce(lifecycleStatus("available")),
      apply: vi.fn(async () => {
        throw new Error("reply lost");
      }),
    });
    const owner = ownerFor(native);
    await owner.open();
    await owner.begin("reclaim");

    expect(native.apply).toHaveBeenCalledTimes(1);
    expect(native.status).toHaveBeenCalledTimes(2);
    expect(owner.getSnapshot().operation).toMatchObject({
      phase: "unknown",
      reconciled: true,
    });
  });

  it("confirms an unknown command from latest_event_id without inventing a receipt", async () => {
    let attempted: OriginalLifecycleCommand | null = null;
    let statusCalls = 0;
    const native = client({
      status: vi.fn(async () => {
        statusCalls += 1;
        if (statusCalls === 1) return lifecycleStatus("available");
        return lifecycleStatus("reclaimed", {
          generation: 3,
          latestEventId: attempted?.event_id ?? null,
        });
      }),
      apply: vi.fn(async (command) => {
        attempted = command;
        throw new Error("reply lost");
      }),
    });
    const owner = ownerFor(native);
    await owner.open();
    await owner.begin("reclaim");

    expect(owner.getSnapshot().operation).toMatchObject({
      phase: "accepted_by_status",
      receipt: null,
    });
    expect(native.apply).toHaveBeenCalledTimes(1);
  });

  it("replays the fixed IDs and payload only after status reconciliation and explicit user action", async () => {
    const native = client({
      status: vi
        .fn()
        .mockResolvedValueOnce(lifecycleStatus("available"))
        .mockResolvedValueOnce(lifecycleStatus("available")),
      apply: vi
        .fn()
        .mockRejectedValueOnce(new Error("reply lost"))
        .mockImplementation(async (command) =>
          applied(
            command,
            lifecycleStatus("reclaimed", {
              generation: 3,
              latestEventId: command.event_id,
            }),
          ),
        ),
    });
    const owner = ownerFor(native);
    await owner.open();
    await owner.begin("reclaim");
    const draft = owner.getSnapshot().operation?.command;

    await owner.retrySameCommand();
    expect(native.apply).toHaveBeenCalledTimes(2);
    expect(native.apply).toHaveBeenNthCalledWith(2, draft);
    expect(owner.getSnapshot().operation?.phase).toBe("accepted");
  });

  it("keeps a late result in its original profile scope", async () => {
    const pendingA = deferred<OriginalLifecycleStatus>();
    const native = client({
      status: vi.fn(async (profileId) =>
        profileId === PROFILE
          ? pendingA.promise
          : lifecycleStatus("available", { profileId }),
      ),
    });
    const ownerA = ownerFor(native, () => 1_000, PROFILE, ORIGINAL);
    const profileB = "77777777-7777-4777-8777-777777777777";
    const ownerB = ownerFor(native, () => 1_000, profileB, ORIGINAL);

    const openingA = ownerA.open();
    await Promise.resolve();
    await Promise.resolve();
    await ownerB.open();
    pendingA.resolve(lifecycleStatus("purged"));
    await openingA;

    expect(ownerB.getSnapshot().status?.lifecycle.local.profile_id).toBe(
      profileB,
    );
    expect(ownerB.getSnapshot().status?.lifecycle.local.bytes_state).toBe(
      "available",
    );
  });

  it("does not cancel a Native operation when the panel observer unsubscribes", async () => {
    const pending = deferred<OriginalLifecycleApplyResult>();
    const native = client({
      apply: vi.fn((command) => pending.promise),
    });
    const owner = ownerFor(native);
    await owner.open();
    const stopObserving = owner.subscribe(() => {});
    const operation = owner.begin("reclaim");
    const fixedCommand = owner.getSnapshot().operation?.command;
    stopObserving();

    pending.resolve(
      applied(
        fixedCommand as OriginalLifecycleCommand,
        lifecycleStatus("reclaimed", {
          generation: 3,
          latestEventId: fixedCommand?.event_id ?? null,
        }),
      ),
    );
    await operation;

    expect(native.apply).toHaveBeenCalledTimes(1);
    expect(owner.getSnapshot().operation?.phase).toBe("accepted");
  });

  it("requires both Native reveal capability and confirmed cache presence", async () => {
    const unsupported = client({
      capabilities: vi.fn(async () => capabilities(false)),
      status: vi.fn(async () =>
        lifecycleStatus("released", { cachePresence: "present" }),
      ),
    });
    const unsupportedOwner = ownerFor(unsupported);
    await unsupportedOwner.open();
    await unsupportedOwner.revealCache();
    expect(unsupported.revealCache).not.toHaveBeenCalled();

    const supported = client({
      capabilities: vi.fn(async () => capabilities(true)),
      status: vi.fn(async () =>
        lifecycleStatus("released", { cachePresence: "present" }),
      ),
    });
    const supportedOwner = ownerFor(supported);
    await supportedOwner.open();
    await supportedOwner.revealCache();
    expect(supported.revealCache).toHaveBeenCalledWith(PROFILE, ORIGINAL);
  });

  it("retains non-retryable modified and unsupported cache outcomes", async () => {
    for (const reason of ["modified", "unsupported"] as const) {
      const native = client({
        apply: vi.fn(async (command) =>
          applied(
            command,
            lifecycleStatus("released", {
              generation: 3,
              latestEventId: command.event_id,
            }),
            cleanup("recovery_required", false, reason, "present"),
          ),
        ),
      });
      const owner = ownerFor(native);
      await owner.open();
      await owner.begin("release_local");

      expect(owner.getSnapshot().cacheResult?.result).toMatchObject({
        status: "recovery_required",
        retryable: false,
        reason,
        cache_presence: "present",
      });
      await owner.retryCacheCleanup();
      expect(native.retryCacheCleanup).not.toHaveBeenCalled();
    }
  });
});
