#!/usr/bin/env node
// 使い方のページ・検証用アプリをブラウザで開くための、依存なしの小さな静的サーバー。
//   node scripts/serve.js [ポート] [--open]   （既定 8080。npm run docs でも起動できる。--open でブラウザも開く）
// ES Modules はファイルを直接開く（file://）と読み込めないので、このサーバー経由で開く。
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const port = Number(args.find((a) => /^\d+$/.test(a)) ?? process.env.PORT ?? 8080);
const open = args.includes('--open');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.txt': 'text/plain',
  '.md': 'text/markdown; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (path === '/') path = '/docs/';
    if (path.endsWith('/')) path += 'index.html';
    // リポジトリの外のファイルは返さない
    const file = normalize(join(root, path));
    if (file !== root && !file.startsWith(root + sep)) throw Object.assign(new Error('forbidden'), { code: 'EACCES' });
    if ((await stat(file)).isDirectory()) {
      res.writeHead(302, { Location: `${path}/` }).end();
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch (error) {
    const status = error.code === 'EACCES' ? 403 : 404;
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(status === 403 ? '403 Forbidden' : '404 Not Found');
  }
});

server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE' ? `ポート ${port} は使用中です。別のポートを指定してください：node scripts/serve.js 8081` : error.message);
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`nihon-tidy のページを配信しています（終了は Ctrl+C）`);
  console.log(`  使い方      http://127.0.0.1:${port}/docs/usage.html`);
  console.log(`  検証アプリ  http://127.0.0.1:${port}/docs/playground.html`);
  if (open) openBrowser(`http://127.0.0.1:${port}/docs/usage.html`);
});

function openBrowser(url) {
  const [cmd, cmdArgs] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}
