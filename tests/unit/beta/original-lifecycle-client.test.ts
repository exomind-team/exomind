import { describe, expect, it, vi } from "vitest";
import {
  createOriginalLifecycleClient,
  ORIGINAL_LIFECYCLE_COMMANDS,
  type OriginalLifecycleCommand,
  type OriginalLifecycleInvoke,
} from "../../../src/beta/original-lifecycle-client";

const PROFILE = "11111111-1111-4111-8111-111111111111";
const ORIGINAL = "22222222-2222-4222-8222-222222222222";
const COMMAND_ID = "33333333-3333-4333-8333-333333333333";
const EVENT_ID = "44444444-4444-4444-8444-444444444444";

function capabilities(supportsReveal = true, cachePolicy = "verified_same_handle") {
  return {
    schema_version: 1,
    core_schema: 10,
    operations: ["reclaim", "restore", "release_local", "purge_reclaimed"],
    cache_policy: cachePolicy,
    supports_reveal: supportsReveal,
  };
}

function command(): OriginalLifecycleCommand {
  return {
    command_id: COMMAND_ID,
    event_id: EVENT_ID,
    profile_id: PROFILE,
    original_id: ORIGINAL,
    expected_generation: 2,
    occurred_at_ms: 100,
    action: "release_local",
    cleanup_confirmed: true,
    follow_up_device_ids: [],
    responds_to_event_id: null,
  };
}

function status(bytesState = "released", cachePresence = "present") {
  return {
    lifecycle: {
      local: {
        profile_id: PROFILE,
        original: { original_id: ORIGINAL },
        bytes_state: bytesState,
        generation: 3,
        latest_event_id: EVENT_ID,
        restore_request_event_id: null,
        restore_completion_event_id: null,
        reclaimed_at_ms: null,
        recovery_window_ms: null,
        reclaim_deadline_ms: null,
      },
      remote_sources: [],
    },
    cache_presence: cachePresence,
  };
}

function receipt(input: OriginalLifecycleCommand = command()) {
  return {
    command_id: input.command_id,
    event_id: input.event_id,
    profile_id: input.profile_id,
    local_seq: 8,
    event_digest: "c".repeat(64),
    durability: "local_committed",
    replayed: false,
  };
}

function cleanup(
  state = "partial",
  retryable = true,
  reason = "verification_incomplete",
  presence = "unknown",
) {
  return { status: state, retryable, reason, cache_presence: presence };
}

describe("Native original lifecycle client contract", () => {
  it("reads the schema 1 / Core 10 descriptor and preserves mobile reveal denial", async () => {
    const nativeInvoke = vi.fn(async () => capabilities(false, "retained"));
    const client = createOriginalLifecycleClient(
      nativeInvoke as unknown as OriginalLifecycleInvoke,
    );

    await expect(client.capabilities()).resolves.toEqual({
      ...capabilities(false, "retained"),
      supports_restore_retry: false,
    });
    expect(nativeInvoke).toHaveBeenCalledWith(
      ORIGINAL_LIFECYCLE_COMMANDS.capabilities,
      undefined,
    );
  });

  it("does not probe status or mutation commands when an older Native lacks capability registration", async () => {
    const nativeInvoke = vi.fn(async () => {
      throw new Error(
        "Command beta_original_lifecycle_capabilities not found",
      );
    });
    const client = createOriginalLifecycleClient(
      nativeInvoke as unknown as OriginalLifecycleInvoke,
    );

    await expect(client.capabilities()).rejects.toMatchObject({
      code: "native_command_missing",
      kind: "unsupported",
    });
    expect(nativeInvoke).toHaveBeenCalledTimes(1);
    expect(nativeInvoke).toHaveBeenCalledWith(
      "beta_original_lifecycle_capabilities",
      undefined,
    );
  });

  it("rejects capability schema and core versions before exposing operations", async () => {
    const nativeInvoke = vi.fn(async () => ({
      ...capabilities(),
      core_schema: 9,
    }));
    const client = createOriginalLifecycleClient(
      nativeInvoke as unknown as OriginalLifecycleInvoke,
    );

    await expect(client.capabilities()).rejects.toMatchObject({
      code: "unsupported_schema",
      kind: "unsupported",
    });
  });

  it("validates status scope and keeps bytes state separate from cache presence", async () => {
    const nativeInvoke = vi.fn(async () => status("restore_pending", "absent"));
    const client = createOriginalLifecycleClient(
      nativeInvoke as unknown as OriginalLifecycleInvoke,
    );

    await expect(client.status(PROFILE, ORIGINAL)).resolves.toMatchObject({
      lifecycle: { local: { bytes_state: "restore_pending" } },
      cache_presence: "absent",
    });
    expect(nativeInvoke).toHaveBeenCalledWith(
      "beta_original_lifecycle_status",
      { profileId: PROFILE, originalId: ORIGINAL },
    );

    const wrongScope = vi.fn(async () =>
      status("available", "present"),
    );
    const wrongClient = createOriginalLifecycleClient(
      wrongScope as unknown as OriginalLifecycleInvoke,
    );
    await expect(
      wrongClient.status(PROFILE, "55555555-5555-4555-8555-555555555555"),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("returns the Core receipt and Native cache outcome as distinct result fields", async () => {
    const input = command();
    const nativeInvoke = vi.fn(async () => ({
      receipt: receipt(input),
      status: status("released", "unknown"),
      cache_cleanup: cleanup("partial", true, "filesystem_rejected", "unknown"),
    }));
    const client = createOriginalLifecycleClient(
      nativeInvoke as unknown as OriginalLifecycleInvoke,
    );

    await expect(client.apply(input)).resolves.toMatchObject({
      receipt: {
        command_id: COMMAND_ID,
        event_id: EVENT_ID,
        durability: "local_committed",
      },
      cache_cleanup: {
        status: "partial",
        retryable: true,
        reason: "filesystem_rejected",
        cache_presence: "unknown",
      },
      status: {
        lifecycle: { local: { bytes_state: "released" } },
      },
    });
    expect(nativeInvoke).toHaveBeenCalledWith(
      "beta_apply_original_lifecycle",
      { command: input },
    );
  });

  it("keeps Native retained-cache policy and reveal support as explicit capabilities", async () => {
    const nativeInvoke = vi.fn(async () => capabilities(false, "retained"));
    const client = createOriginalLifecycleClient(
      nativeInvoke as unknown as OriginalLifecycleInvoke,
    );

    await expect(client.capabilities()).resolves.toMatchObject({
      cache_policy: "retained",
      supports_reveal: false,
    });
  });
});
