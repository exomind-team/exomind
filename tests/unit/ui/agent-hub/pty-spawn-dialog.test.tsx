import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PtySpawnDialog } from "@/ui/app/components/PtySpawnDialog";

async function chooseDialogSelect(
  triggerTestId: string,
  optionName: string,
): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByTestId(triggerTestId));
  await user.click(await screen.findByRole("option", { name: optionName }));
}

async function openCreateMode(): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByTestId("pty-mode-create"));
  await screen.findByTestId("pty-agent-type");
}

async function openResumeMode(): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByTestId("pty-mode-resume"));
  await screen.findByTestId("pty-agent-type");
}

describe("PtySpawnDialog（终端会话启动弹窗）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the form surface constrained inside the dialog viewport（模态内部表单不会横向撑穿对话框）", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <PtySpawnDialog
        open={true}
        onOpenChange={() => {}}
        rtBaseUrl="http://127.0.0.1:1949"
        onSpawned={() => {}}
      />,
    );

    const dialog = await screen.findByRole("dialog");
    const body = screen.getByTestId("pty-spawn-dialog-body");
    expect(screen.getByTestId("pty-mode-route")).toBeInTheDocument();

    await openCreateMode();
    const agentType = screen.getByTestId("pty-agent-type");
    const workdir = screen.getByTestId("pty-session-workdir");
    const submit = screen.getByTestId("pty-spawn-submit");

    expect(dialog.className).toContain("max-w-[520px]");
    expect(dialog.className).toContain("min-w-0");
    expect(dialog.className).toContain("overflow-hidden");
    expect(body.className).toContain("min-w-0");
    expect(body.className).toContain("overflow-y-auto");
    expect(agentType.className).toContain("max-w-full");
    expect(agentType.className).toContain("min-w-0");
    expect(workdir.className).toContain("max-w-full");
    expect(workdir.className).toContain("min-w-0");
    expect(submit.className).toContain("max-w-full");
    expect(submit.className).toContain("min-w-0");
  });

  it("builds codex spawn request with model and reasoning config（Codex 启动携带模型与推理强度）", async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.includes("/pty/sessions?agent_type=claude")) {
        return { ok: true, json: async () => [] } as Response;
      }
      if (input.includes("/pty/sessions?agent_type=codex")) {
        return { ok: true, json: async () => [] } as Response;
      }
      if (input.endsWith("/pty/spawn")) {
        return {
          ok: true,
          json: async () => ({ id: "pty-codex-1", name: "codex-main" }),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${input} ${JSON.stringify(init)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const onSpawned = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <PtySpawnDialog
        open={true}
        onOpenChange={onOpenChange}
        rtBaseUrl="http://127.0.0.1:1949"
        defaultWorkdir="D:/project/exomind"
        onSpawned={onSpawned}
      />,
    );

    await openCreateMode();
    await chooseDialogSelect("pty-agent-type", "Codex");
    fireEvent.change(screen.getByTestId("pty-session-name"), {
      target: { value: "codex-main" },
    });
    fireEvent.change(screen.getByTestId("pty-session-workdir"), {
      target: { value: "D:/project/exomind" },
    });
    fireEvent.change(screen.getByTestId("pty-model"), {
      target: { value: "gpt-5.4" },
    });
    await chooseDialogSelect("pty-reasoning-effort", "xhigh");
    fireEvent.change(screen.getByTestId("pty-extra-args"), {
      target: { value: "--search --full-auto" },
    });
    fireEvent.click(screen.getByTestId("pty-spawn-submit"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:1949/pty/spawn",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            name: "codex-main",
            workdir: "D:/project/exomind",
            command: "codex",
            args: [
              "-m",
              "gpt-5.4",
              "-c",
              'model_reasoning_effort="xhigh"',
              "--search",
              "--full-auto",
            ],
            rows: 24,
            cols: 80,
          }),
        }),
      );
      expect(onSpawned).toHaveBeenCalledWith({
        id: "pty-codex-1",
        name: "codex-main",
      });
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("persists the detected Codex inner session id after spawning with runtime-resolved workdir（新建 Codex 后会用 RT 返回的绝对目录补写 inner_session_id）", async () => {
    let codexHistoryCalls = 0;
    const detectedAt = new Date().toISOString();
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.includes("/pty/sessions?agent_type=claude")) {
        return { ok: true, json: async () => [] } as Response;
      }
      if (input.includes("/pty/sessions?agent_type=codex")) {
        codexHistoryCalls += 1;
        return {
          ok: true,
          json: async () =>
            codexHistoryCalls === 1
              ? []
              : [
                  {
                    agent_type: "codex",
                    session_id: "codex-thread-new",
                    project_path: "H:/A137442/Develop/AGI/exomind",
                    last_modified: detectedAt,
                  },
                ],
        } as Response;
      }
      if (input.endsWith("/pty/spawn")) {
        return {
          ok: true,
          json: async () => ({
            id: "pty-codex-new",
            name: "codex-main",
            workdir: "H:/A137442/Develop/AGI/exomind",
          }),
        } as Response;
      }
      if (
        input.endsWith("/sessions/pty-codex-new") &&
        init?.method === "PATCH"
      ) {
        return {
          ok: true,
          json: async () => ({
            id: "pty-codex-new",
            inner_session_id: "codex-thread-new",
          }),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${input} ${JSON.stringify(init)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <PtySpawnDialog
        open={true}
        onOpenChange={() => {}}
        rtBaseUrl="http://127.0.0.1:1949"
        defaultWorkdir=""
        onSpawned={() => {}}
      />,
    );

    await openCreateMode();
    await chooseDialogSelect("pty-agent-type", "Codex");
    fireEvent.change(screen.getByTestId("pty-session-name"), {
      target: { value: "codex-main" },
    });
    fireEvent.click(screen.getByTestId("pty-spawn-submit"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:1949/sessions/pty-codex-new",
        expect.objectContaining({
          method: "PATCH",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({ inner_session_id: "codex-thread-new" }),
        }),
      );
    });
  });

  it("persists the detected Claude inner session id after spawning（新建 Claude 后也会补写 inner_session_id）", async () => {
    let claudeHistoryCalls = 0;
    const detectedAt = new Date().toISOString();
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.includes("/pty/sessions?agent_type=claude")) {
        claudeHistoryCalls += 1;
        return {
          ok: true,
          json: async () =>
            claudeHistoryCalls === 1
              ? []
              : [
                  {
                    agent_type: "claude",
                    session_id: "claude-thread-new",
                    project_path: "H--A137442-Develop-AGI-exomind",
                    last_modified: detectedAt,
                  },
                ],
        } as Response;
      }
      if (input.endsWith("/pty/spawn")) {
        return {
          ok: true,
          json: async () => ({
            id: "pty-claude-new",
            name: "claude-main",
            workdir: "H:/A137442/Develop/AGI/exomind",
          }),
        } as Response;
      }
      if (
        input.endsWith("/sessions/pty-claude-new") &&
        init?.method === "PATCH"
      ) {
        return {
          ok: true,
          json: async () => ({
            id: "pty-claude-new",
            inner_session_id: "claude-thread-new",
          }),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${input} ${JSON.stringify(init)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <PtySpawnDialog
        open={true}
        onOpenChange={() => {}}
        rtBaseUrl="http://127.0.0.1:1949"
        defaultWorkdir=""
        onSpawned={() => {}}
      />,
    );

    await openCreateMode();
    fireEvent.change(screen.getByTestId("pty-session-name"), {
      target: { value: "claude-main" },
    });
    fireEvent.click(screen.getByTestId("pty-spawn-submit"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:1949/sessions/pty-claude-new",
        expect.objectContaining({
          method: "PATCH",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({ inner_session_id: "claude-thread-new" }),
        }),
      );
    });
  });

  it("resumes codex historical session with agent_type（按 Agent 类型恢复 Codex 历史会话）", async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.includes("/pty/sessions?agent_type=claude")) {
        return { ok: true, json: async () => [] } as Response;
      }
      if (input.includes("/pty/sessions?agent_type=codex")) {
        return {
          ok: true,
          json: async () => [
            {
              agent_type: "codex",
              session_id: "019d0011-aaaa-bbbb-cccc-1234567890ab",
              project_path: "D:/project/exomind",
              last_modified: "2026-03-18T02:20:32.696Z",
            },
          ],
        } as Response;
      }
      if (input.endsWith("/pty/resume")) {
        return {
          ok: true,
          json: async () => ({ id: "pty-codex-2", name: "Codex-019d0011" }),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${input} ${JSON.stringify(init)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const onSpawned = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <PtySpawnDialog
        open={true}
        onOpenChange={onOpenChange}
        rtBaseUrl="http://127.0.0.1:1949"
        defaultWorkdir="D:/project/exomind"
        onSpawned={onSpawned}
      />,
    );

    await openResumeMode();
    await chooseDialogSelect("pty-agent-type", "Codex");

    await waitFor(() => {
      expect(
        screen.getByTestId(
          "pty-history-session-019d0011-aaaa-bbbb-cccc-1234567890ab",
        ),
      ).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("pty-session-name"), {
      target: { value: "resume-codex" },
    });
    expect(screen.queryByTestId("pty-session-workdir")).not.toBeInTheDocument();
    expect(screen.getByTestId("pty-resume-workdir-note")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("pty-model"), {
      target: { value: "gpt-5.4" },
    });
    await chooseDialogSelect("pty-reasoning-effort", "xhigh");
    fireEvent.change(screen.getByTestId("pty-extra-args"), {
      target: { value: "--search --full-auto" },
    });
    fireEvent.click(
      screen.getByTestId(
        "pty-history-session-019d0011-aaaa-bbbb-cccc-1234567890ab",
      ),
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:1949/pty/resume",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            agent_type: "codex",
            session_id: "019d0011-aaaa-bbbb-cccc-1234567890ab",
            name: "resume-codex",
            model: "gpt-5.4",
            reasoning_effort: "xhigh",
            extra_args: ["--search", "--full-auto"],
          }),
        }),
      );
      expect(onSpawned).toHaveBeenCalledWith({
        id: "pty-codex-2",
        name: "Codex-019d0011",
      });
    });
  });

  it("does not render or send workdir when resuming a historical session（恢复历史会话时不应再暴露或发送 workdir）", async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.includes("/pty/sessions?agent_type=claude")) {
        return { ok: true, json: async () => [] } as Response;
      }
      if (input.includes("/pty/sessions?agent_type=codex")) {
        return {
          ok: true,
          json: async () => [
            {
              agent_type: "codex",
              session_id: "019d0011-aaaa-bbbb-cccc-1234567890ab",
              project_path: "E:/other-project",
              display_path: "E:/other-project",
              last_modified: "2026-03-18T02:20:32.696Z",
            },
          ],
        } as Response;
      }
      if (input.endsWith("/pty/resume")) {
        return {
          ok: true,
          json: async () => ({ id: "pty-codex-3", name: "Codex-019d0011" }),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${input} ${JSON.stringify(init)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <PtySpawnDialog
        open={true}
        onOpenChange={() => {}}
        rtBaseUrl="http://127.0.0.1:1949"
        defaultWorkdir="D:/project/exomind"
        onSpawned={() => {}}
      />,
    );

    await openResumeMode();
    await chooseDialogSelect("pty-agent-type", "Codex");

    expect(screen.queryByTestId("pty-session-workdir")).not.toBeInTheDocument();
    expect(screen.getByTestId("pty-resume-workdir-note")).toBeInTheDocument();

    const historyButton = await screen.findByTestId(
      "pty-history-session-019d0011-aaaa-bbbb-cccc-1234567890ab",
    );
    fireEvent.click(historyButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:1949/pty/resume",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            agent_type: "codex",
            session_id: "019d0011-aaaa-bbbb-cccc-1234567890ab",
            reasoning_effort: "xhigh",
          }),
        }),
      );
    });
  });

  it("renders title-first historical cards with path fallback metadata and user previews（历史会话卡片优先显示会话名并保留路径回退元数据）", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input.includes("/pty/sessions?agent_type=claude")) {
        return {
          ok: true,
          json: async () => [
            {
              agent_type: "claude",
              session_id: "claude-thread-display-title-1234567890",
              project_path: "H--A137442-Develop-AGI-exomind",
              display_title: "Pane Tree Recovery",
              display_path: "H:/A137442/Develop/AGI/exomind",
              first_user_message_preview: "Plan pane tree recovery",
              last_user_message_preview:
                "Validate fullscreen empty pane layout",
              last_modified: new Date().toISOString(),
            },
          ],
        } as Response;
      }
      if (input.includes("/pty/sessions?agent_type=codex")) {
        return { ok: true, json: async () => [] } as Response;
      }
      throw new Error(`unexpected fetch: ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <PtySpawnDialog
        open={true}
        onOpenChange={() => {}}
        rtBaseUrl="http://127.0.0.1:1949"
        onSpawned={() => {}}
      />,
    );

    await openResumeMode();
    const historyButton = await screen.findByTestId(
      "pty-history-session-claude-thread-display-title-1234567890",
    );
    expect(historyButton).toHaveTextContent("Pane Tree Recovery");
    expect(historyButton).toHaveTextContent(
      "目录 · H:/A137442/Develop/AGI/exomind",
    );
    expect(historyButton).toHaveTextContent("首句 · Plan pane tree recovery");
    expect(historyButton).toHaveTextContent(
      "末句 · Validate fullscreen empty pane layout",
    );
    expect(historyButton).toHaveTextContent(
      "会话 ID · claude-thread-display-title-1234567890",
    );
    expect(historyButton).not.toHaveTextContent(
      "H--A137442-Develop-AGI-exomind",
    );
  });

  it("truncates long Unicode history previews to 200 characters（历史会话首末句预览限制为 200 Unicode 字符）", async () => {
    const longPreview = "界".repeat(205);
    const expectedPreview = `${"界".repeat(199)}…`;
    const fetchMock = vi.fn(async (input: string) => {
      if (input.includes("/pty/sessions?agent_type=claude")) {
        return {
          ok: true,
          json: async () => [
            {
              agent_type: "claude",
              session_id: "claude-thread-long-preview",
              project_path: "H:/A137442/Develop/AGI/exomind",
              display_title: "Long Preview Session",
              first_user_message_preview: longPreview,
              last_user_message_preview: longPreview,
              last_modified: new Date().toISOString(),
            },
          ],
        } as Response;
      }
      if (input.includes("/pty/sessions?agent_type=codex")) {
        return { ok: true, json: async () => [] } as Response;
      }
      throw new Error(`unexpected fetch: ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <PtySpawnDialog
        open={true}
        onOpenChange={() => {}}
        rtBaseUrl="http://127.0.0.1:1949"
        onSpawned={() => {}}
      />,
    );

    await openResumeMode();
    const historyButton = await screen.findByTestId(
      "pty-history-session-claude-thread-long-preview",
    );
    expect(historyButton).toHaveTextContent(`首句 · ${expectedPreview}`);
    expect(historyButton).toHaveTextContent(`末句 · ${expectedPreview}`);
    expect(historyButton).not.toHaveTextContent(longPreview);
  });

  it("falls back to a shortened session id when Claude project_path is only an encoded slug（Claude 编码 project_path 不应占据标题回退位）", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input.includes("/pty/sessions?agent_type=claude")) {
        return {
          ok: true,
          json: async () => [
            {
              agent_type: "claude",
              session_id: "claude-thread-encoded-only-1234567890",
              project_path: "H--A137442-Develop-AGI-exomind",
              last_modified: new Date().toISOString(),
            },
          ],
        } as Response;
      }
      if (input.includes("/pty/sessions?agent_type=codex")) {
        return { ok: true, json: async () => [] } as Response;
      }
      throw new Error(`unexpected fetch: ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <PtySpawnDialog
        open={true}
        onOpenChange={() => {}}
        rtBaseUrl="http://127.0.0.1:1949"
        onSpawned={() => {}}
      />,
    );

    await openResumeMode();
    const historyButton = await screen.findByTestId(
      "pty-history-session-claude-thread-encoded-only-1234567890",
    );
    expect(historyButton).toHaveTextContent("claude-thread");
    expect(historyButton).toHaveTextContent(
      "会话 ID · claude-thread-encoded-only-1234567890",
    );
    expect(historyButton).not.toHaveTextContent(
      "H--A137442-Develop-AGI-exomind",
    );
  });

  it("uses the first user preview as the primary title fallback before the session id（无 display_title 时优先用首句预览做主标题）", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input.includes("/pty/sessions?agent_type=claude")) {
        return {
          ok: true,
          json: async () => [
            {
              agent_type: "claude",
              session_id: "claude-thread-preview-fallback-1234567890",
              project_path: "H--A137442-Develop-AGI-exomind",
              first_user_message_preview: "Plan pane tree recovery",
              last_user_message_preview:
                "Validate fullscreen empty pane layout",
              last_modified: new Date().toISOString(),
            },
          ],
        } as Response;
      }
      if (input.includes("/pty/sessions?agent_type=codex")) {
        return { ok: true, json: async () => [] } as Response;
      }
      throw new Error(`unexpected fetch: ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <PtySpawnDialog
        open={true}
        onOpenChange={() => {}}
        rtBaseUrl="http://127.0.0.1:1949"
        onSpawned={() => {}}
      />,
    );

    await openResumeMode();
    const historyButton = await screen.findByTestId(
      "pty-history-session-claude-thread-preview-fallback-1234567890",
    );
    const primaryTitle = historyButton.querySelector(".font-medium");
    expect(primaryTitle?.textContent).toBe("Plan pane tree recovery");
    expect(historyButton).toHaveTextContent("首句 · Plan pane tree recovery");
    expect(historyButton).toHaveTextContent(
      "末句 · Validate fullscreen empty pane layout",
    );
    expect(historyButton).toHaveTextContent(
      "会话 ID · claude-thread-preview-fallback-1234567890",
    );
  });

  it("loads both Claude and Codex historical lists when switching agent type（切换 Agent 类型时分别加载 Claude 与 Codex 历史会话）", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input.includes("/pty/sessions?agent_type=claude")) {
        return {
          ok: true,
          json: async () => [
            {
              agent_type: "claude",
              session_id: "claude-history-1",
              project_path: "H--A137442-Develop-AGI-exomind",
              display_title: "Claude Recovery",
              display_path: "H:/A137442/Develop/AGI/exomind",
              first_user_message_preview: "Inspect agent workbench semantics",
              last_modified: "2026-04-05T02:20:32.696Z",
            },
          ],
        } as Response;
      }
      if (input.includes("/pty/sessions?agent_type=codex")) {
        return {
          ok: true,
          json: async () => [
            {
              agent_type: "codex",
              session_id: "codex-history-1",
              project_path: "D:/project/exomind",
              display_title: "Codex Recovery",
              first_user_message_preview: "Investigate pane tree regression",
              last_user_message_preview: "Verify fullscreen empty pane layout",
              last_modified: "2026-04-05T03:20:32.696Z",
            },
          ],
        } as Response;
      }
      throw new Error(`unexpected fetch: ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <PtySpawnDialog
        open={true}
        onOpenChange={() => {}}
        rtBaseUrl="http://127.0.0.1:1949"
        onSpawned={() => {}}
      />,
    );

    await openResumeMode();
    const claudeButton = await screen.findByTestId(
      "pty-history-session-claude-history-1",
    );
    expect(claudeButton).toHaveTextContent("Claude Recovery");
    expect(claudeButton).toHaveTextContent(
      "目录 · H:/A137442/Develop/AGI/exomind",
    );
    expect(claudeButton).toHaveTextContent(
      "首句 · Inspect agent workbench semantics",
    );

    await chooseDialogSelect("pty-agent-type", "Codex");

    const codexButton = await screen.findByTestId(
      "pty-history-session-codex-history-1",
    );
    expect(codexButton).toHaveTextContent("Codex Recovery");
    expect(codexButton).toHaveTextContent("目录 · D:/project/exomind");
    expect(codexButton).toHaveTextContent(
      "首句 · Investigate pane tree regression",
    );
    expect(codexButton).toHaveTextContent(
      "末句 · Verify fullscreen empty pane layout",
    );
    expect(
      screen.queryByTestId("pty-history-session-claude-history-1"),
    ).not.toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:1949/pty/sessions?agent_type=claude",
      expect.objectContaining({ headers: {} }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:1949/pty/sessions?agent_type=codex",
      expect.objectContaining({ headers: {} }),
    );
  });

  it("disables occupied historical sessions and shows the opened-window hint（已占用历史会话显示已打开窗口并禁用）", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input.includes("/pty/sessions?agent_type=claude")) {
        return {
          ok: true,
          json: async () => [
            {
              agent_type: "claude",
              session_id: "claude-thread-open",
              project_path: "H--A137442-Develop-AGI-exomind",
              last_modified: "2026-04-03T02:00:00.000Z",
            },
          ],
        } as Response;
      }
      throw new Error(`unexpected fetch: ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <PtySpawnDialog
        open={true}
        onOpenChange={() => {}}
        rtBaseUrl="http://127.0.0.1:1949"
        onSpawned={() => {}}
        occupiedHistoricalSessionIds={["claude-thread-open"]}
        occupiedHistoricalSessionLabels={{ "claude-thread-open": "Claude 806" }}
      />,
    );

    await openResumeMode();
    const occupiedButton = await screen.findByTestId(
      "pty-history-session-claude-thread-open",
    );
    expect(occupiedButton).toBeDisabled();
    const occupiedHint = screen.getByTestId(
      "pty-history-session-occupied-claude-thread-open",
    );
    expect(occupiedHint).toHaveTextContent("已打开窗口 · Claude 806");
    expect(occupiedHint.className).toContain("break-words");
    expect(occupiedHint.className).not.toContain("shrink-0");

    const fetchCallsBeforeClick = fetchMock.mock.calls.length;
    fireEvent.click(occupiedButton);

    expect(fetchMock.mock.calls.length).toBe(fetchCallsBeforeClick);
  });

  it("supports custom command mode without history list（自定义命令模式不显示历史恢复）", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input.includes("/pty/sessions?agent_type=claude")) {
        return { ok: true, json: async () => [] } as Response;
      }
      if (input.endsWith("/pty/spawn")) {
        return {
          ok: true,
          json: async () => ({ id: "pty-custom-1", name: "my-custom" }),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const onSpawned = vi.fn();

    render(
      <PtySpawnDialog
        open={true}
        onOpenChange={() => {}}
        rtBaseUrl="http://127.0.0.1:1949"
        onSpawned={onSpawned}
      />,
    );

    await openCreateMode();
    await chooseDialogSelect("pty-agent-type", "Custom（自定义）");

    expect(screen.getByTestId("pty-custom-command")).toBeInTheDocument();
    expect(screen.queryByTestId("pty-history-list")).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId("pty-custom-command"), {
      target: { value: "node" },
    });
    fireEvent.change(screen.getByTestId("pty-extra-args"), {
      target: { value: 'server.js --label \"alpha beta\" --watch' },
    });
    fireEvent.click(screen.getByTestId("pty-spawn-submit"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:1949/pty/spawn",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            command: "node",
            args: ["server.js", "--label", "alpha beta", "--watch"],
            rows: 24,
            cols: 80,
          }),
        }),
      );
      expect(onSpawned).toHaveBeenCalledWith({
        id: "pty-custom-1",
        name: "my-custom",
      });
    });
  });
});
