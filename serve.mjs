import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd(), port = Number(process.env.PORT || 8080);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
http.createServer(async (request, response) => {
  try {
    let pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); if (pathname.endsWith('/')) pathname += 'index.html';
    const filename = path.resolve(root, '.' + pathname);
    if (!filename.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    const contents = await readFile(filename); response.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }).end(contents);
  } catch { response.writeHead(404).end('Not found'); }
}).listen(port, '0.0.0.0', () => process.stdout.write(`词屿预览：http://localhost:${port}\n`));
