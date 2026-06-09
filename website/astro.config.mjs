import { defineConfig } from "astro/config";
import tailwindcss from "@astrojs/tailwind";

const githubPagesBasePath = process.env.EXOMIND_WEBSITE_BASE_PATH || "/";

export default defineConfig({
  site: "https://exo-mind.ai",
  base: githubPagesBasePath,
  output: "static",
  integrations: [tailwindcss()],
  i18n: {
    defaultLocale: "zh",
    locales: ["zh", "en"],
    routing: {
      prefixDefaultLocale: false,
    },
  },
});
