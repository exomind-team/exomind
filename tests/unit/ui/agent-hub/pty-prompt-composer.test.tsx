import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PtyPromptComposer } from "@/ui/app/components/PtyPromptComposer";

const ptyInputMocks = vi.hoisted(() => ({
  sendPtyWsTextInput: vi.fn(),
}));

vi.mock("@/ui/app/components/pty-input", () => ({
  sendPtyWsTextInput: ptyInputMocks.sendPtyWsTextInput,
}));

describe("PtyPromptComposer（PTY 本地草稿输入器）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ptyInputMocks.sendPtyWsTextInput.mockResolvedValue({
      ok: true,
      status: 204,
    } satisfies Partial<Response>);
  });

  it("sends textarea draft with trailing carriage return and clears local draft（发送时追加回车并清空本地草稿）", async () => {
    render(
      <PtyPromptComposer
        target={{
          rtBaseUrl: "http://127.0.0.1:4317",
          ptyId: "pty-composer-1",
        }}
      />,
    );

    const input = screen.getByTestId("pty-prompt-input");
    fireEvent.change(input, {
      target: {
        value: "hello from local composer",
      },
    });

    fireEvent.keyDown(input, {
      key: "Enter",
      code: "Enter",
    });

    await waitFor(() => {
      expect(ptyInputMocks.sendPtyWsTextInput).toHaveBeenCalledWith(
        {
          rtBaseUrl: "http://127.0.0.1:4317",
          ptyId: "pty-composer-1",
        },
        "hello from local composer\r",
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("pty-prompt-input")).toHaveValue("");
    });
  });

  it("keeps newline editing for Shift+Enter without sending（Shift+Enter 只换行不发送）", () => {
    render(
      <PtyPromptComposer
        target={{
          rtBaseUrl: "http://127.0.0.1:4317",
          ptyId: "pty-composer-2",
        }}
      />,
    );

    const input = screen.getByTestId("pty-prompt-input");
    fireEvent.change(input, {
      target: {
        value: "first line",
      },
    });

    fireEvent.keyDown(input, {
      key: "Enter",
      code: "Enter",
      shiftKey: true,
    });

    expect(ptyInputMocks.sendPtyWsTextInput).not.toHaveBeenCalled();
  });
});
