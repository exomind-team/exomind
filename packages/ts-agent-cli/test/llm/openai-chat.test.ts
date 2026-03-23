/**
 * OpenAI-compatible chat completion client tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { chatCompletion, type ChatCompletionOptions } from "../../src/llm/openai-chat.js";

describe("chatCompletion（OpenAI 兼容 LLM 客户端）", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  function mockFetch(responseContent: string, status = 200) {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: responseContent } }],
        }),
      text: () => Promise.resolve(`{"error":"test error"}`),
    });
  }

  const baseOpts: ChatCompletionOptions = {
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-test-key",
    model: "gpt-4o-mini",
    systemPrompt: "You are a test assistant.",
    userPrompt: "Say hello.",
  };

  it("sends correct request body to /chat/completions", async () => {
    mockFetch("hello");

    await chatCompletion(baseOpts);

    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/chat/completions");

    const body = JSON.parse(init.body);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.messages).toEqual([
      { role: "system", content: "You are a test assistant." },
      { role: "user", content: "Say hello." },
    ]);
  });

  it("sends Authorization Bearer header", async () => {
    mockFetch("hello");

    await chatCompletion(baseOpts);

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers["Authorization"]).toBe("Bearer sk-test-key");
  });

  it("returns the content string from response", async () => {
    mockFetch('{"effective":"good","stuck":"none","improve":"more","avoid":"less"}');

    const result = await chatCompletion(baseOpts);

    expect(result).toBe('{"effective":"good","stuck":"none","improve":"more","avoid":"less"}');
  });

  it("throws on non-OK response", async () => {
    mockFetch("", 401);

    await expect(chatCompletion(baseOpts)).rejects.toThrow("LLM API HTTP 401");
  });

  it("strips trailing /chat/completions from baseUrl to avoid double path", async () => {
    mockFetch("ok");

    await chatCompletion({
      ...baseOpts,
      baseUrl: "https://api.example.com/v1/chat/completions",
    });

    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/chat/completions");
  });

  it("reads env vars as fallback when options omitted", async () => {
    mockFetch("env-result");
    vi.stubEnv("EXOMIND_LLM_BASE_URL", "https://env.example.com/v1");
    vi.stubEnv("EXOMIND_LLM_API_KEY", "sk-env-key");
    vi.stubEnv("EXOMIND_LLM_MODEL", "env-model");

    const result = await chatCompletion({
      systemPrompt: "test",
      userPrompt: "test",
    });

    expect(result).toBe("env-result");
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://env.example.com/v1/chat/completions");
    expect(init.headers["Authorization"]).toBe("Bearer sk-env-key");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("env-model");
  });

  it("throws if no API key is available", async () => {
    vi.stubEnv("EXOMIND_LLM_API_KEY", "");

    await expect(
      chatCompletion({ systemPrompt: "test", userPrompt: "test" }),
    ).rejects.toThrow("EXOMIND_LLM_API_KEY");
  });
});
