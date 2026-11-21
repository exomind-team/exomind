import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BetaOriginalLifecyclePanel } from "../../../src/beta/BetaOriginalLifecyclePanel";
import { OriginalLifecycleClientError } from "../../../src/beta/original-lifecycle-client";
import { originalLifecycleOwnerFor } from "../../../src/beta/original-lifecycle-state";
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
const FILE_NAME = "meeting-notes.txt";

function capabilities(supportsReveal = true): OriginalLifecycleCapabilities {
  return {
    schema_version: 1,
    core_schema: 10,
    operations: [
      "reclaim",
      "restore",
      "release_local",
      "purge_reclaimed",
    ],
    cache_policy: "verified_same_handle",
    supports_reveal: supportsReveal,
    supports_followups: true,
  };
}

function lifecycleStatus(
  bytesState: OriginalLifecycleStatus["lifecycle"]["local"]["bytes_state"] =
    "available",
  cachePresence: OriginalLifecycleStatus["cache_presence"] = "absent",
  latestEventId: string | null = null,
): OriginalLifecycleStatus {
  return {
    lifecycle: {
      local: {
        profile_id: PROFILE,
        original: { original_id: ORIGINAL },
        bytes_state: bytesState,
        generation: 2,
        latest_event_id: latestEventId,
        restore_request_event_id:
          bytesState === "restore_pending" ? latestEventId : null,
        restore_completion_event_id: null,
        reclaimed_at_ms: bytesState === "reclaimed" ? 1_000 : null,
        recovery_window_ms: bytesState === "reclaimed" ? 86_400_000 : null,
        reclaim_deadline_ms: bytesState === "reclaimed" ? Date.now() + 86_400_000 : null,
      },
      remote_sources: [],
    },
    cache_presence: cachePresence,
  };
}

function cleanupResult(
  status: OriginalCacheCleanupResult["status"],
  reason: OriginalCacheCleanupResult["reason"],
  retryable: boolean,
  presence: OriginalCacheCleanupResult["cache_presence"],
): OriginalCacheCleanupResult {
  return { status, reason, retryable, cache_presence: presence };
}

function applyResult(
  command: OriginalLifecycleCommand,
  status: OriginalLifecycleStatus,
  cleanup: OriginalCacheCleanupResult,
): OriginalLifecycleApplyResult {
  return {
    receipt: {
      command_id: command.command_id,
      event_id: command.event_id,
      profile_id: command.profile_id,
      local_seq: 12,
      event_digest: "a".repeat(64),
      durability: "local_committed",
      replayed: false,
    },
    status,
    cache_cleanup: cleanup,
  };
}

function fakeClient(options: {
  initialState?: OriginalLifecycleStatus["lifecycle"]["local"]["bytes_state"];
  cachePresence?: OriginalLifecycleStatus["cache_presence"];
  supportsReveal?: boolean;
  applyStatus?: OriginalLifecycleStatus["lifecycle"]["local"]["bytes_state"];
  cleanup?: OriginalCacheCleanupResult;
  retryCleanup?: OriginalCacheCleanupResult;
  remoteSources?: OriginalLifecycleStatus["lifecycle"]["remote_sources"];
  followups?: Awaited<ReturnType<NonNullable<OriginalLifecycleClient["followups"]>>>;
} = {}): OriginalLifecycleClient {
  const initial = lifecycleStatus(
    options.initialState ?? "available",
    options.cachePresence ?? "absent",
  );
  initial.lifecycle.remote_sources = options.remoteSources ?? [];
  return {
    capabilities: vi.fn(async () => capabilities(options.supportsReveal)),
    status: vi.fn(async () => initial),
    apply: vi.fn(async (command: OriginalLifecycleCommand) => {
      const nextState = options.applyStatus ?? command.action;
      const status = lifecycleStatus(
        nextState as OriginalLifecycleStatus["lifecycle"]["local"]["bytes_state"],
        options.cleanup?.cache_presence ?? "absent",
        command.event_id,
      );
      return applyResult(
        command,
        status,
        options.cleanup ?? cleanupResult("not_applicable", null, false, "absent"),
      );
    }),
    retryCacheCleanup: vi.fn(async () =>
      options.retryCleanup ??
      cleanupResult("complete", null, false, "absent"),
    ),
    revealCache: vi.fn(async () => {}),
    followups: vi.fn(async () => options.followups ?? { items: [], next_after: null }),
  };
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

afterEach(() => cleanup());

describe("Beta original lifecycle panel", () => {
  it("keeps release local by default and sends only explicitly selected follow-up devices", async () => {
    const user = userEvent.setup();
    const first = "77777777-7777-4777-8777-777777777777";
    const second = "88888888-8888-4888-8888-888888888888";
    const native = fakeClient({
      remoteSources: [
        { device_id: first, state: "needs_probe" },
        { device_id: second, state: "needs_probe" },
      ],
      applyStatus: "released",
    });
    renderPanel(native);
    await user.click(screen.getByRole("button", { name: "管理本机副本" }));
    await user.click(await screen.findByRole("button", { name: "释放本机副本" }));

    expect(screen.getByText(/不会自动删除另一台设备/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: `通知设备 77777777 跟进` }));
    await user.click(screen.getByRole("button", { name: "确认释放本机副本" }));

    await waitFor(() => expect(native.apply).toHaveBeenCalledTimes(1));
    expect(vi.mocked(native.apply).mock.calls[0][0].follow_up_device_ids).toEqual([first]);
  });

  it("shows an incoming release request as informational until the local human releases bytes", async () => {
    const user = userEvent.setup();
    const REQUEST = "77777777-7777-4777-8777-777777777777";
    const FROM = "88888888-8888-4888-8888-888888888888";
    const native = fakeClient({
      followups: {
        items: [{
          request: {
            event_id: REQUEST,
            profile_id: PROFILE,
            device_id: FROM,
            author_id: "99999999-9999-4999-8999-999999999999",
            original_id: ORIGINAL,
            action: "release_local",
            generation: 4,
            command_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            occurred_at_ms: 100,
            follow_up_device_ids: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
            responds_to_event_id: null,
            local_seq: 9,
            digest: "c".repeat(64),
          },
          resolution: "manifest_known",
        }],
        next_after: null,
      },
      applyStatus: "released",
    });
    renderPanel(native);
    await user.click(screen.getByRole("button", { name: "管理本机副本" }));

    expect(await screen.findByText(/不会自动删除本机副本/)).toBeVisible();
    expect(native.apply).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "按此请求释放本机副本" }));
    await user.click(screen.getByRole("button", { name: "确认释放本机副本" }));

    await waitFor(() => expect(native.apply).toHaveBeenCalledTimes(1));
    expect(vi.mocked(native.apply).mock.calls[0][0]).toMatchObject({
      action: "release_local",
      responds_to_event_id: REQUEST,
      follow_up_device_ids: [],
    });
  });

  it("refreshes an open lifecycle view after an attachment availability invalidation without issuing another action", async () => {
    const user = userEvent.setup();
    const native = fakeClient({initialState: "restore_pending"});
    const props = {profileId: PROFILE, originalId: ORIGINAL, fileName: FILE_NAME, client: native};
    const view = render(<BetaOriginalLifecyclePanel {...props} revision={0} />);
    await user.click(screen.getByRole("button", {name: "管理本机副本"}));
    await screen.findByText("恢复请求已记录，字节尚未到达");
    vi.mocked(native.status).mockResolvedValue(lifecycleStatus("available"));
    view.rerender(<BetaOriginalLifecyclePanel {...props} revision={1} />);
    await screen.findByText("本机副本可用");
    expect(native.apply).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", {name: "管理本机副本"}));
    const reads = vi.mocked(native.status).mock.calls.length;
    view.rerender(<BetaOriginalLifecyclePanel {...props} revision={2} />);
    expect(native.status).toHaveBeenCalledTimes(reads);
  });

  it("does not query Native for collapsed file cards", () => {
    const native = fakeClient();
    const { container } = renderPanel(native);

    expect(native.capabilities).not.toHaveBeenCalled();
    expect(native.status).not.toHaveBeenCalled();
    expect(container.querySelector("[title]")).toBeNull();
  });

  it("opens through keyboard activation with the same on-demand status read", async () => {
    const native = fakeClient();
    const user = userEvent.setup();
    renderPanel(native);
    const disclosure = screen.getByRole("button", { name: "管理本机副本" });

    disclosure.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(native.capabilities).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(native.status).toHaveBeenCalledTimes(1));
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
  });

  it("opens through touch activation with the same on-demand status read", async () => {
    const native = fakeClient();
    const view = renderPanel(native);
    const control = view.getByRole("button", { name: "管理本机副本" });

    fireEvent.pointerDown(control, { pointerType: "touch" });
    fireEvent.pointerUp(control, { pointerType: "touch" });
    fireEvent.click(control);
    await waitFor(() => expect(native.capabilities).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(native.status).toHaveBeenCalledTimes(1));
    expect(control.getAttribute("aria-expanded")).toBe("true");
  });

  it("reports an old Native as unconnected and does not call status or mutation commands", async () => {
    const native = fakeClient();
    native.capabilities = vi.fn(async () => {
      throw new OriginalLifecycleClientError(
        "当前版本尚不支持原件管理。",
        "native_command_missing",
        "unsupported",
      );
    });
    const user = userEvent.setup();
    renderPanel(native);

    await user.click(screen.getByRole("button", { name: "管理本机副本" }));
    await screen.findByText(
      "当前版本尚不支持原件管理；可更新外心后再试。",
    );

    expect(native.status).not.toHaveBeenCalled();
    expect(native.apply).not.toHaveBeenCalled();
  });

  it("reads only this card after explicit disclosure and shows authoritative bytes/cache state", async () => {
    const native = fakeClient({
      initialState: "reclaimed",
      cachePresence: "present",
      supportsReveal: false,
    });
    const user = userEvent.setup();
    renderPanel(native);

    await user.click(screen.getByRole("button", { name: "管理本机副本" }));
    await waitFor(() => expect(native.capabilities).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(native.status).toHaveBeenCalledTimes(1));
    expect(screen.getByText("已登记回收，处于恢复期")).toBeTruthy();
    expect(screen.getByText("打开用临时副本：存在")).toBeTruthy();
    expect(screen.getByText(/恢复期截止：/)).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: "在文件管理器中定位缓存副本",
      }),
    ).toBeNull();
  });

  it("requires a themed confirmation before local release and keeps receipt/cache claims separate", async () => {
    const native = fakeClient({
      initialState: "available",
      applyStatus: "released",
      cleanup: cleanupResult(
        "partial",
        "verification_incomplete",
        true,
        "unknown",
      ),
    });
    const user = userEvent.setup();
    renderPanel(native);
    await user.click(screen.getByRole("button", { name: "管理本机副本" }));
    await screen.findByText("本机副本可用");

    await user.click(screen.getByRole("button", { name: "释放本机副本" }));
    expect(
      await screen.findByRole("heading", { name: "立即释放本机副本？" }),
    ).toBeTruthy();
    expect(native.apply).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "确认释放本机副本" }),
    );
    await screen.findByText("操作回执已确认");
    expect(screen.getByText("本机操作回执序号：12。")).toBeTruthy();
    expect(
      screen.getByText("打开用临时副本清理只完成一部分"),
    ).toBeTruthy();
    expect(
      screen.getByText("在校验预算内未能确认完整清理"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "此结果仅描述打开用的临时副本；未测量实际腾出的磁盘空间。",
      ),
    ).toBeTruthy();
    expect(native.apply).toHaveBeenCalledTimes(1);
  });

  it("shows a manual cache retry for partial outcomes without resubmitting the Core action", async () => {
    const native = fakeClient({
      initialState: "available",
      applyStatus: "released",
      cleanup: cleanupResult("partial", "filesystem_rejected", true, "unknown"),
      retryCleanup: cleanupResult(
        "recovery_required",
        "modified",
        false,
        "present",
      ),
    });
    const user = userEvent.setup();
    renderPanel(native);
    await user.click(screen.getByRole("button", { name: "管理本机副本" }));
    await screen.findByText("本机副本可用");
    await user.click(screen.getByRole("button", { name: "释放本机副本" }));
    await user.click(
      await screen.findByRole("button", { name: "确认释放本机副本" }),
    );
    await screen.findByText("打开用临时副本清理只完成一部分");

    await user.click(
      screen.getByRole("button", { name: "重试 打开用临时副本清理" }),
    );
    await screen.findByText("打开用临时副本需要人工检查");
    expect(native.apply).toHaveBeenCalledTimes(1);
    expect(native.retryCacheCleanup).toHaveBeenCalledTimes(1);
  });

  it("preserves modified or unsupported cache evidence and gates reveal from capabilities", async () => {
    const native = fakeClient({
      initialState: "available",
      applyStatus: "released",
      supportsReveal: true,
      cleanup: cleanupResult("recovery_required", "modified", false, "present"),
    });
    const user = userEvent.setup();
    renderPanel(native);
    await user.click(screen.getByRole("button", { name: "管理本机副本" }));
    await screen.findByText("本机副本可用");
    await user.click(screen.getByRole("button", { name: "释放本机副本" }));
    await user.click(
      await screen.findByRole("button", { name: "确认释放本机副本" }),
    );

    await screen.findByText("缓存内容已变化，已保留副本");
    expect(
      screen.queryByRole("button", { name: "重试 打开用临时副本清理" }),
    ).toBeNull();
    await user.click(
      screen.getByRole("button", {
        name: "在文件管理器中定位缓存副本",
      }),
    );
    await screen.findByText(
      "已请求在文件管理器中定位此临时副本。",
    );
    expect(native.revealCache).toHaveBeenCalledWith(PROFILE, ORIGINAL);
  });

  it("reports restore_pending as a recorded request while bytes remain unavailable", async () => {
    const native = fakeClient({
      initialState: "released",
      applyStatus: "restore_pending",
    });
    const user = userEvent.setup();
    renderPanel(native);
    await user.click(screen.getByRole("button", { name: "管理本机副本" }));
    await screen.findByText("本机副本已释放");

    await user.click(
      screen.getByRole("button", { name: "请求恢复本机副本" }),
    );
    expect(
      await screen.findByRole("heading", { name: "请求恢复本机副本？" }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "确认恢复请求" }));

    await screen.findByText("恢复请求已记录，字节尚未到达");
    expect(
      screen.getByText(
        "已记录恢复请求；本机状态仍未确认本机字节到达。",
      ),
    ).toBeTruthy();
    expect(native.apply).toHaveBeenCalledTimes(1);
    expect(native.retryCacheCleanup).not.toHaveBeenCalled();
  });

  it("keeps a Native mutation alive after the file row unmounts", async () => {
    const native = fakeClient({ initialState: "available" });
    let submitted: OriginalLifecycleCommand | null = null;
    let resolveApply!: (value: OriginalLifecycleApplyResult) => void;
    const pending = new Promise<OriginalLifecycleApplyResult>((resolve) => {
      resolveApply = resolve;
    });
    native.apply = vi.fn((command) => {
      submitted = command;
      return pending;
    });
    const user = userEvent.setup();
    const view = renderPanel(native);
    await user.click(screen.getByRole("button", { name: "管理本机副本" }));
    await screen.findByText("本机副本可用");
    await user.click(screen.getByRole("button", { name: "进入回收恢复期" }));
    await user.click(
      await screen.findByRole("button", { name: "确认进入恢复期" }),
    );
    await waitFor(() => expect(native.apply).toHaveBeenCalledTimes(1));

    const owner = originalLifecycleOwnerFor(
      native,
      PROFILE,
      ORIGINAL,
      () => "unused-after-owner-exists",
      () => Date.now(),
    );
    view.unmount();
    const command = submitted as OriginalLifecycleCommand;
    resolveApply(
      applyResult(
        command,
        lifecycleStatus("reclaimed", "absent", command.event_id),
        cleanupResult("not_applicable", null, false, "absent"),
      ),
    );
    await pending;
    await waitFor(() =>
      expect(owner.getSnapshot().operation?.phase).toBe("accepted"),
    );
  });

  it("keeps purge unavailable until the explicit deadline and requests no timer-side mutation", async () => {
    const native = fakeClient({
      initialState: "reclaimed",
      applyStatus: "purged",
    });
    const user = userEvent.setup();
    renderPanel(native);
    await user.click(screen.getByRole("button", { name: "管理本机副本" }));
    await screen.findByText("已登记回收，处于恢复期");

    expect(
      screen.queryByRole("button", { name: "恢复期后彻底清理" }),
    ).toBeNull();
    expect(native.apply).not.toHaveBeenCalled();
  });
});
