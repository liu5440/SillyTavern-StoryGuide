import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  const files = {
    '/': 'tests/browser/host.html',
    '/dist/index.js': 'dist/index.js',
    '/style.css': 'style.css',
  };
  if (path === '/scripts/user.js' || path === '/scripts/world-info.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(
      path.includes('user')
        ? "export const getCurrentUserHandle = () => 'test-user';"
        : 'export const world_info = {charLore: []};',
    );
    return;
  }
  const file = files[path];
  if (!file) {
    response.writeHead(404).end();
    return;
  }
  response.setHeader(
    'Content-Type',
    path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html',
  );
  response.end(await readFile(resolve(file)));
}).listen(8123, '127.0.0.1');
