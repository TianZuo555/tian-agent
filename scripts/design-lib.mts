import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../docs/design/', import.meta.url));
const rootReal = await realpath(root);
const requestedPort = Number(process.env.PORT ?? 4600);
const startPort =
  Number.isInteger(requestedPort) && requestedPort >= 0 ? requestedPort : 4600;

const contentTypes: Record<string, string> = {
  '.bin': 'application/octet-stream',
  '.br': 'application/octet-stream',
  '.css': 'text/css; charset=utf-8',
  '.gz': 'application/gzip',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.zip': 'application/zip',
};

function resolveRequestPath(url: string): string | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  } catch {
    return null;
  }
  if (pathname === '/') pathname = '/base.html';
  const candidate = path.resolve(rootReal, `.${pathname}`);
  const relative = path.relative(rootReal, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return candidate;
}

function send(
  response: ServerResponse,
  status: number,
  text: string,
  type = 'text/plain; charset=utf-8',
): void {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': type,
  });
  response.end(text);
}

const server = createServer(async (request, response) => {
  const filePath = resolveRequestPath(request.url ?? '/');
  if (!filePath) {
    send(response, 400, 'Bad request');
    return;
  }

  try {
    const info = await stat(filePath);
    let target = filePath;
    if (info.isDirectory()) {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (!pathname.endsWith('/')) {
        response.writeHead(301, { Location: `${pathname}/` });
        response.end();
        return;
      }
      target = path.join(filePath, 'index.html');
    }

    const targetReal = await realpath(target);
    const relative = path.relative(rootReal, targetReal);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      send(response, 403, 'Forbidden');
      return;
    }

    const targetInfo = await stat(targetReal);
    if (!targetInfo.isFile()) {
      send(response, 404, 'Not found');
      return;
    }

    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Length': targetInfo.size,
      'Content-Type':
        contentTypes[path.extname(targetReal).toLowerCase()] ??
        'application/octet-stream',
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(targetReal).pipe(response);
  } catch {
    send(response, 404, 'Not found');
  }
});

function listen(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

let port = 0;
for (let offset = 0; offset < 20; offset += 1) {
  try {
    port = await listen(startPort + offset);
    break;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
  }
}
if (port === 0) port = await listen(0);

const url = `http://127.0.0.1:${port}/`;
console.log(`Design library: ${url}`);
console.log('Press Ctrl+C to stop.');

if (process.env.NO_OPEN !== '1') {
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(command, [url], { detached: true, stdio: 'ignore' })
    .on('error', () => {})
    .unref();
}

const shutdown = () => {
  server.close(() => process.exit(0));
  server.closeAllConnections();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
