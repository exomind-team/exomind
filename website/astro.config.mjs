import { defineConfig } from 'astro/config';
import tailwindcss from '@astrojs/tailwind';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  site: 'https://exo-mind.ai',
  output: 'server',
  adapter: cloudflare({
    platformProxy: {
      enabled: true,
    },
  }),
  integrations: [tailwindcss()],
  i18n: {
    defaultLocale: 'zh',
    locales: ['zh', 'en'],
    routing: {
      prefixDefaultLocale: false,
    },
  },
});
