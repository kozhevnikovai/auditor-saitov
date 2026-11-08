import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".txt": "text/plain", ".xml": "application/xml" };

export function serve(dir: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer(async (req, res) => {
    const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
    const file = join(dir, path === "/" ? "index.html" : path);
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "content-length": body.length });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      res.end("<html><head><title>404</title></head><body>Нет такой страницы</body></html>");
    }
  });
  return new Promise((ok) =>
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      ok({ url: `http://127.0.0.1:${addr.port}`, close: () => new Promise((c) => server.close(() => c())) });
    }),
  );
}
