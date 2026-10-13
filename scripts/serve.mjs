// 本地开发静态服务器：npm run dev / npm run serve（服务 dist 产物）。
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const port = Number(process.env.PORT ?? 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://localhost:${port}`);
    let filePath = path.normalize(path.join(dist, decodeURIComponent(url.pathname)));
    if (!filePath.startsWith(dist)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    let fileStat = await stat(filePath).catch(() => null);
    if (fileStat?.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      fileStat = await stat(filePath).catch(() => null);
    }
    if (!fileStat) {
      response.writeHead(404).end('Not found');
      return;
    }
    const content = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Service-Worker-Allowed': '/'
    });
    response.end(content);
  } catch (err) {
    response.writeHead(500).end(String(err));
  }
});

server.listen(port, () => {
  console.log(`HeroXP 本地预览: http://localhost:${port}/ （产物目录 dist/）`);
});
