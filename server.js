const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const UPSTREAM_COMMIT = '1ffc8ca70f71273a53fe4ec029611ca6c2a52089';
const UPSTREAM = `https://raw.githubusercontent.com/Alhysson/cs-mobile-3d/${UPSTREAM_COMMIT}`;
const SFX_COMMIT = '29a6bdfd01ad175c389cbd0bac80c30f926ff96b';
const SFX_BASE = `https://raw.githubusercontent.com/euuuuuuan/fatal-funnel-public/${SFX_COMMIT}/apps/game/public/sfx`;

const localFiles = {
  '/vs/custom.js': ['vs/custom.js', 'application/javascript; charset=utf-8'],
  '/vs/custom.css': ['vs/custom.css', 'text/css; charset=utf-8'],
};
const sfx = new Set(['rifle_762.mp3', 'rifle_556.mp3', 'pistol_9mm.mp3', 'suppressed.mp3']);
const cache = new Map();

function contentType(url) {
  const ext = path.extname(url.split('?')[0]).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.wav': 'audio/wav'
  })[ext] || 'application/octet-stream';
}

async function fetchCached(url) {
  if (cache.has(url)) return cache.get(url);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  const buf = Buffer.from(await r.arrayBuffer());
  cache.set(url, buf);
  return buf;
}

function customizeHtml(html) {
  return html
    .replace(/<html lang="pt-BR">/i, '<html lang="es">')
    .replace(/<title>[^<]*<\/title>/i, '<title>VieraStrike — FPS táctico móvil</title>')
    .replace(/<meta name="description"[^>]*>/i, '<meta name="description" content="VieraStrike — FPS táctico 3D para móvil y PC.">')
    .replace(/SALA BRASIL CS/g, 'VIERASTRIKE ESP')
    .replace(/CS-BR-DUST2/g, 'VS-DUST2')
    .replace(/CS-BR-TDM/g, 'VS-TDM')
    .replace('</head>', '  <link rel="stylesheet" href="/vs/custom.css">\n</head>')
    .replace('</body>', '  <script src="/vs/custom.js"></script>\n</body>');
}

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (localFiles[urlPath]) {
      const [file, type] = localFiles[urlPath];
      const body = fs.readFileSync(path.join(__dirname, file));
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      return res.end(body);
    }

    if (urlPath.startsWith('/vs-sfx/')) {
      const name = path.basename(urlPath);
      if (!sfx.has(name)) { res.writeHead(404); return res.end('Not found'); }
      const body = await fetchCached(`${SFX_BASE}/${name}`);
      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*'
      });
      return res.end(body);
    }

    const upstreamPath = urlPath === '/' ? '/index.html' : urlPath;
    if (upstreamPath.includes('..')) { res.writeHead(400); return res.end('Bad request'); }
    let body = await fetchCached(`${UPSTREAM}${upstreamPath}`);
    let type = contentType(upstreamPath);

    if (upstreamPath === '/index.html') {
      body = Buffer.from(customizeHtml(body.toString('utf8')), 'utf8');
      type = 'text/html; charset=utf-8';
    }

    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': upstreamPath === '/index.html' ? 'no-cache' : 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(body);
  } catch (err) {
    console.error(err);
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('No se pudo cargar el recurso del juego.');
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`VieraStrike CS Mobile test listening on ${PORT}`));
