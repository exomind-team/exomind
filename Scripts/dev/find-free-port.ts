/**
 * Find a free TCP port and print it to stdout.
 * Usage: bun Scripts/dev/find-free-port.ts [preferredPort]
 *
 * If preferredPort is available, prints it. Otherwise finds a random free port.
 */
import { createServer } from "net";

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
    server.listen(preferred ?? 0, "127.0.0.1", () => {
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
