/**
 * Find a free TCP port and print it to stdout.
 * Usage: bun Scripts/dev/find-free-port.ts [preferredPort]
 *
 * If preferredPort is available, prints it. Otherwise finds a random free port.
 *
 * NOTE: There is a small TOCTOU window between this script releasing the port
 * and Vite binding to it. In the Tauri scenario, if another process claims the
 * port in that window, the injected devUrl will be stale. This is extremely
 * unlikely in local dev and mitigated by strictPort when EXOMIND_WEB_PORT is set.
 */
import { createServer } from "net";

const PROBE_HOST = "0.0.0.0";

function findFreePort(preferred?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" && preferred) {
        // preferred port is taken, find a random one
        findFreePort().then(resolve, reject);
      } else {
        reject(err);
      }
    });
    server.listen({ port: preferred ?? 0, host: PROBE_HOST, exclusive: true }, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      server.close(() => resolve(port));
    });
  });
}

const raw = process.argv[2] ? Number.parseInt(process.argv[2], 10) : undefined;
const preferred = raw && raw > 0 && raw <= 65535 ? raw : undefined;
const port = await findFreePort(preferred);
process.stdout.write(String(port));
