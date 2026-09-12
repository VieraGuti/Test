import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 10000);
const password = process.env.DOWNLOAD_PASSWORD || '';
const zipPath = path.join(__dirname, 'dist', 'VieraStrike-ETA-Windows-private.zip');

function unauthorized(res) {
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="VieraStrike Private Build"',
    'Content-Type': 'text/plain; charset=utf-8'
  });
  res.end('Private VieraStrike build');
}

function authorized(req) {
  if (!password) return true;
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const [, pass = ''] = decoded.split(':');
    return pass === password;
  } catch {
    return false;
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(fs.existsSync(zipPath) ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: fs.existsSync(zipPath), build: 'VieraStrike ETA Windows private' }));
    return;
  }

  if (!authorized(req)) return unauthorized(res);

  if (req.url === '/' || req.url === '/download') {
    if (!fs.existsSync(zipPath)) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Build is not ready.');
      return;
    }
    const stat = fs.statSync(zipPath);
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="VieraStrike-ETA-Windows-private.zip"',
      'Content-Length': stat.size,
      'Cache-Control': 'private, no-store'
    });
    fs.createReadStream(zipPath).pipe(res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(port, '0.0.0.0', () => {
  console.log(`VieraStrike private build host listening on ${port}`);
  console.log(`Build present: ${fs.existsSync(zipPath)}`);
});
