import { describe, expect, it } from "vitest";

import {
  getLangFromUrl,
  getLocalizedPath,
  isDocsPath,
} from "../../../website/src/i18n";

describe("website i18n base path helpers（官网 i18n 基路径辅助）", () => {
  it("detects language correctly under GitHub Pages base path（在 GitHub Pages 子路径下正确识别语言）", () => {
    const url = new URL("https://exomind-team.github.io/exomind/en/features");

    expect(getLangFromUrl(url, "/exomind/")).toBe("en");
  });

  it("prefixes localized links with GitHub Pages base path（给站内链接补上 GitHub Pages 基路径）", () => {
    expect(getLocalizedPath("/download", "zh", "/exomind/")).toBe(
      "/exomind/download",
    );
    expect(getLocalizedPath("/download", "en", "/exomind/")).toBe(
      "/exomind/en/download",
    );
    expect(getLocalizedPath("/", "zh", "/exomind/")).toBe("/exomind/");
  });

  it("detects docs routes correctly after stripping GitHub Pages base path（剥离 GitHub Pages 基路径后正确识别 docs 路由）", () => {
    expect(isDocsPath("/exomind/docs", "/exomind/")).toBe(true);
    expect(isDocsPath("/exomind/docs/tasks", "/exomind/")).toBe(true);
    expect(isDocsPath("/exomind/en/docs", "/exomind/")).toBe(true);
    expect(isDocsPath("/exomind/features", "/exomind/")).toBe(false);
  });
});
