import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AgentGrantIssueCommand,
  AgentGrantMetadata,
  AgentGrantsClient,
} from "@/beta/agent-grants-client";
import { BetaAgentGrantsEntry, BetaAgentGrantsPanel } from "@/beta/BetaAgentGrantsPanel";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const GRANT_ID = "22222222-2222-4222-8222-222222222222";
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

function client(overrides: Partial<AgentGrantsClient> = {}): AgentGrantsClient {
  return {
    list: vi.fn(async () => []),
    issue: vi.fn(async (command: AgentGrantIssueCommand) => ({
      grant: metadata({
        grant_id: command.grant_id,
        kind: command.kind,
        agent_id: command.agent_id,
      }),
      issuance: "created",
      credential_handle: HANDLE,
      credential_state: "available",
    })),
    recover: vi.fn(async () => ({
      grant: metadata(),
      issuance: "recovered",
      credential_handle: null,
      credential_state: "unavailable",
    })),
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

afterEach(() => cleanup());

describe("Beta Agent grants panel", () => {
  it("stays usable when StrictMode replays the grants observer effect", async () => {
    const user = userEvent.setup();
    const native = client();
    render(
      <StrictMode>
        <BetaAgentGrantsPanel
          client={native}
          profileId={PROFILE_ID}
          profileName="晨间档案"
          visible
        />
      </StrictMode>,
    );

    const create = await screen.findByRole("button", {
      name: "新建 Agent 授权",
    });
    await waitFor(() => expect(create).toBeEnabled());
    await user.click(create);
    expect(
      screen.getByRole("button", { name: "确认并签发" }),
    ).toBeInTheDocument();
  });

  it("clears copy material only after a separate explicit confirmation without revoking the grant", async () => {
    const user = userEvent.setup();
    const native = client();
    render(<BetaAgentGrantsPanel client={native} profileId={PROFILE_ID} profileName="晨间档案" visible />);
    await waitFor(() => expect(native.list).toHaveBeenCalled());
    await user.click(screen.getByRole("button", {name: "新建 Agent 授权"}));
    await user.click(screen.getByRole("button", {name: "确认并签发"}));
    await screen.findByRole("button", {name: "复制接入信息"});
    await user.click(screen.getByRole("button", {name: "查看授权 ID 详情"}));
    await user.click(screen.getByRole("button", {name: "清除本机接入材料"}));
    expect(native.releaseCredential).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent("Agent 仍可继续访问");
    await user.click(screen.getByRole("button", {name: "确认清除本机材料"}));
    await waitFor(() => expect(native.releaseCredential).toHaveBeenCalledWith(PROFILE_ID, HANDLE));
    expect(native.revoke).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", {name: "复制接入信息"})).not.toBeInTheDocument();
    expect(screen.getByText("有效")).toBeInTheDocument();
  });

  it("keeps the next profile's new authorization dialog when the previous issuance finishes late", async () => {
    const user = userEvent.setup();
    let finish!: (result: Awaited<ReturnType<AgentGrantsClient['issue']>>) => void;
    const native = client({issue: vi.fn(() => new Promise(resolve => { finish = resolve; }))});
    const props = {client: native, profileId: PROFILE_ID, profileName: "晨间档案", visible: true};
    const view = render(<BetaAgentGrantsPanel {...props} />);
    await waitFor(() => expect(native.list).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", {name: "新建 Agent 授权"}));
    await user.click(screen.getByRole("button", {name: "确认并签发"}));
    await waitFor(() => expect(native.issue).toHaveBeenCalledTimes(1));
    const command = vi.mocked(native.issue).mock.calls[0][0];
    view.rerender(<BetaAgentGrantsPanel {...props} profileId="33333333-3333-4333-8333-333333333333" profileName="晚间档案" />);
    await waitFor(() => expect(native.list).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("button", {name: "新建 Agent 授权"}));
    await act(async () => { finish({grant: metadata({grant_id: command.grant_id}), issuance: "created", credential_handle: HANDLE, credential_state: "available"}); });
    expect(screen.getByRole("dialog", {name: "确认签发 Agent 授权"})).toHaveTextContent("晚间档案");
    expect(native.revoke).not.toHaveBeenCalled();
  });

  it("opens on demand, retains Native material on close, and stays closed after profile or route changes", async () => {
    const user = userEvent.setup();
    const native = client();
    const props = { client: native, profileId: PROFILE_ID, profileName: "晨间档案", visible: true };
    const view = render(<BetaAgentGrantsEntry {...props} />);
    expect(native.list).not.toHaveBeenCalled();
    const entry = screen.getByRole("button", { name: "管理 Agent 授权" });
    await user.click(entry);
    await waitFor(() => expect(native.list).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "新建 Agent 授权" }));
    await user.click(screen.getByRole("button", { name: "确认并签发" }));
    await screen.findByRole("button", { name: /复制接入信息/ });
    await user.click(screen.getByRole("button", { name: "关闭 Agent 授权" }));
    expect(native.releaseCredential).not.toHaveBeenCalled();
    expect(native.revoke).not.toHaveBeenCalled();
    await waitFor(() => expect(entry).toHaveFocus());
    await user.click(entry);
    await waitFor(() => expect(native.list).toHaveBeenCalledTimes(2));
    view.rerender(<BetaAgentGrantsEntry {...props} profileId="33333333-3333-4333-8333-333333333333" />);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    view.rerender(<BetaAgentGrantsEntry {...props} visible={false} />);
    view.rerender(<BetaAgentGrantsEntry {...props} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(native.list).toHaveBeenCalledTimes(2);
  });

  it("allows a separate explicit authorization while an existing Agent keeps its unavailable local material", async () => {
    const user = userEvent.setup();
    const native = client({ list: vi.fn(async () => [metadata()]) });
    const { container } = render(<BetaAgentGrantsPanel client={native} profileId={PROFILE_ID} profileName="晨间档案" visible />);
    await user.click(await screen.findByRole("button", { name: "查证凭据" }));
    await screen.findByText("本机凭据材料不可得；授权元数据已保留。");
    const create = screen.getByRole("button", { name: "新建 Agent 授权" });
    expect(create).toBeEnabled();
    expect(container.querySelector('[title]')).toBeNull();
    await user.click(create);
    await user.click(screen.getByRole("button", { name: "确认并签发" }));
    await waitFor(() => expect(native.issue).toHaveBeenCalledTimes(1));
    expect(vi.mocked(native.issue).mock.calls[0][0].grant_id).not.toBe(GRANT_ID);
    expect(native.revoke).not.toHaveBeenCalled();
  });

  it("states the device/profile scope and stays honest when Native is unavailable", () => {
    render(
      <BetaAgentGrantsPanel
        client={null}
        profileId={PROFILE_ID}
        profileName="晨间档案"
        visible
      />,
    );

    expect(screen.getByText(/此设备当前档案/)).toBeInTheDocument();
    expect(screen.getByText(/Agent 授权，不是设备邀请/)).toBeInTheDocument();
    expect(
      screen.getByText(/当前环境无法使用本机 Agent 授权管理/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /新建/ }),
    ).not.toBeInTheDocument();
  });

  it("asks for a profile selection and does not authorize another profile implicitly", async () => {
    const native = client();
    render(
      <BetaAgentGrantsPanel
        client={native}
        profileId={null}
        profileName={null}
        visible
      />,
    );

    expect(screen.getByText(/请在设置上方选择档案/)).toBeInTheDocument();
    expect(native.list).not.toHaveBeenCalled();
    expect(native.issue).not.toHaveBeenCalled();
  });

  it("defaults to observer and confirms the current profile and exact role before issuing", async () => {
    const user = userEvent.setup();
    const native = client();
    render(
      <BetaAgentGrantsPanel
        client={native}
        profileId={PROFILE_ID}
        profileName="晨间档案"
        visible
      />,
    );
    await waitFor(() => expect(native.list).toHaveBeenCalledWith(PROFILE_ID));
    expect(
      screen.getByText(
        /只读本档案的记录、时间块、回顾与已提交原件/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/追加外部 Agent 生成的回顾/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "新建 Agent 授权" }));

    const dialog = screen.getByRole("dialog");
    expect(withinText(dialog, "晨间档案")).toBe(true);
    expect(withinText(dialog, "只读观察者")).toBe(true);
    const roleSelect = screen.getByRole("combobox", { name: "授权角色" });
    await user.click(roleSelect);
    expect(await screen.findAllByRole("option")).toHaveLength(3);
    expect(
      screen.getByRole("option", { name: "只读观察者" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Agent说明与原件暂存" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "外部摘要提交" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /human/i }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "只读观察者" }));
    expect(
      screen.getByRole("button", { name: "确认并签发" }),
    ).toBeInTheDocument();
  });

  it("generates and freezes AgentId for a writing role without asking for a UUID", async () => {
    const user = userEvent.setup();
    const native = client();
    render(
      <BetaAgentGrantsPanel
        client={native}
        profileId={PROFILE_ID}
        profileName="晨间档案"
        visible
      />,
    );
    await waitFor(() => expect(native.list).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "新建 Agent 授权" }));
    await user.click(screen.getByRole("combobox", { name: "授权角色" }));
    await user.click(
      await screen.findByRole("option", { name: "Agent说明与原件暂存" }),
    );

    expect(screen.getByText(/Agent ID由本机生成/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Agent ID/)).not.toBeInTheDocument();
    const agentIdSummary = screen.getByText("查看 Agent ID");
    await user.click(agentIdSummary);
    const displayedAgentId =
      agentIdSummary.parentElement?.querySelector("code")?.textContent;
    expect(displayedAgentId).toMatch(/^[0-9a-f-]{36}$/i);
    await user.click(screen.getByRole("button", { name: "确认并签发" }));

    await waitFor(() => expect(native.issue).toHaveBeenCalledTimes(1));
    const command = vi.mocked(native.issue).mock.calls[0][0];
    expect(command).toMatchObject({
      profile_id: PROFILE_ID,
      kind: "agent_note",
    });
    expect(command.grant_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(command.agent_id).toBe(displayedAgentId);
  });

  it("keeps opaque handles out of DOM and uses only the Native copy command", async () => {
    const user = userEvent.setup();
    const native = client({
      list: vi.fn(async () => [metadata()]),
      recover: vi.fn(async () => ({
        grant: metadata(),
        issuance: "recovered",
        credential_handle: HANDLE,
        credential_state: "available",
      })),
    });
    const { container } = render(
      <BetaAgentGrantsPanel
        client={native}
        profileId={PROFILE_ID}
        profileName="晨间档案"
        visible
      />,
    );
    await waitFor(() => expect(native.list).toHaveBeenCalled());
    const disclosure = screen.getByRole("button", {
      name: /接入用途与可达范围/,
    });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    await user.click(disclosure);
    expect(screen.getByText(/其他设备不能直接访问/)).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /查证凭据/ }));
    await user.click(await screen.findByRole("button", { name: /复制接入信息/ }));

    expect(native.copyAccessInfo).toHaveBeenCalledWith(
      PROFILE_ID,
      GRANT_ID,
      HANDLE,
    );
    expect(container.innerHTML).not.toContain(HANDLE);
    expect(container.innerHTML).not.toContain("deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
    expect(screen.getByRole("status")).toHaveTextContent(/已复制/);
  });

  it("uses semantic keyboard/touch buttons and an explicit revoke confirmation", async () => {
    const user = userEvent.setup();
    const native = client({ list: vi.fn(async () => [metadata()]) });
    render(
      <BetaAgentGrantsPanel
        client={native}
        profileId={PROFILE_ID}
        profileName="晨间档案"
        visible
      />,
    );
    await waitFor(() => expect(native.list).toHaveBeenCalled());

    const refresh = screen.getByRole("button", { name: "刷新授权列表" });
    refresh.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(native.list).toHaveBeenCalledTimes(2));
    expect(refresh.tagName).toBe("BUTTON");
    expect(refresh).toHaveAttribute("type", "button");

    const revoke = await screen.findByRole("button", { name: /撤销此授权/ });
    fireEvent.pointerDown(revoke, { pointerType: "touch" });
    fireEvent.pointerUp(revoke, { pointerType: "touch" });
    fireEvent.click(revoke);
    expect(screen.getByRole("dialog")).toHaveTextContent("晨间档案");
    expect(screen.getByRole("dialog")).toHaveTextContent(GRANT_ID);
    expect(screen.getByRole("dialog")).toHaveTextContent(
      /已接受的操作和回执不会回滚/,
    );
    expect(native.revoke).not.toHaveBeenCalled();
    await act(async () => {
      await user.click(screen.getByRole("button", { name: "确认撤销此授权" }));
    });
    expect(native.revoke).toHaveBeenCalledWith(PROFILE_ID, GRANT_ID);
  });
});

function withinText(element: HTMLElement, text: string): boolean {
  return element.textContent?.includes(text) ?? false;
}
