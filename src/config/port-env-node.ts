export const DEFAULT_NODE_PORTS = {
  web: 1420,
  hmr: 1421,
} as const;

type EnvMap = Record<string, string | undefined>;

export function parsePort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;

  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return fallback;
  }

  return port;
}

export function resolveDevPorts(env: EnvMap): { web: number; hmr: number } {
  const web = parsePort(env.EXOMIND_WEB_PORT, DEFAULT_NODE_PORTS.web);
  const fallbackHmr = web < 65535 ? web + 1 : DEFAULT_NODE_PORTS.hmr;
  const hmr = parsePort(env.EXOMIND_HMR_PORT, fallbackHmr);

  return { web, hmr };
}
