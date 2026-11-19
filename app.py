"""Young Class Archive · public historical archive research dashboard.
Uses only documented public archive APIs; does not log into or scrape Instagram.
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

APP_NAME = 'YOUNG CLASS // ARCHIVE'
HANDLES = [h.strip().lower().lstrip('@') for h in os.getenv('TARGET_HANDLES', 'youngclasstlc').split(',') if re.fullmatch(r'[a-zA-Z0-9_.@]{2,30}', h.strip())]
HANDLES = list(dict.fromkeys(HANDLES)) or ['youngclasstlc']
DATA_FILE = Path(os.getenv('ARCHIVE_DATA_PATH', '/tmp/young-class-archive.json'))
LOCK = threading.Lock()
STATE = {'running': False, 'last_scan': None, 'sources': {}, 'items': [], 'error': None}

# Separately verified contemporary references are NOT recovered deleted media.
EVIDENCE = [
    {'key': 'youtube:2KQbKeLGgoQ', 'type': 'reference', 'platform': 'YouTube', 'title': 'RECORRIDO — YOUNG CLASS (videoclip oficial)', 'url': 'https://www.youtube.com/watch?v=2KQbKeLGgoQ', 'date': '2024-01-04', 'note': 'Descripción pública enlaza al Instagram /youngclasstlc. Es evidencia del alias, no una historia recuperada.'},
    {'key': 'youtube:BlVNGp_g93Q', 'type': 'reference', 'platform': 'YouTube', 'title': 'YOUNG CLASS — MI MILLÓN', 'url': 'https://www.youtube.com/watch?v=BlVNGp_g93Q', 'date': '2024-11-20', 'note': 'Descripción pública menciona /youngclasstlc. Referencia histórica, no copia de una historia.'},
]

def stamp():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')

def fetch_json(url: str):
    """Strict host allowlist, bounded response, timeout and no arbitrary user URL."""
    allowed = {'web.archive.org', 'arquivo.pt', 'archive.org'}
    host = urlparse(url).hostname
    if host not in allowed:
        raise ValueError('Origen no permitido')
    req = Request(url, headers={'User-Agent': 'YoungClassArchive/1.0 (public historical research; respectful API use)', 'Accept': 'application/json'})
    try:
        with urlopen(req, timeout=16) as response:
            body = response.read(2_000_001)
            if len(body) > 2_000_000:
                raise ValueError('Respuesta demasiado grande')
            return json.loads(body)
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, ValueError) as exc:
        raise RuntimeError(str(exc)[:220]) from exc

def sanitize_link(url):
    if not isinstance(url, str):
        return None
    parsed = urlparse(url)
    if parsed.scheme != 'https' or not parsed.hostname:
        return None
    return url[:2000]

def wayback(handle):
    found = []
    # Prefer exact profile and its immediate descendants, never scan unrelated accounts.
    for host in ('instagram.com', 'www.instagram.com'):
        params = {'url': f'{host}/{handle}', 'matchType': 'prefix', 'output': 'json', 'filter': 'statuscode:200', 'collapse': 'urlkey', 'limit': '120', 'fl': 'timestamp,original,statuscode,mimetype'}
        raw = fetch_json('https://web.archive.org/cdx/search/cdx?' + urlencode(params))
        if not isinstance(raw, list):
            raise RuntimeError('CDX devolvió formato inesperado')
        rows = raw[1:] if raw and isinstance(raw[0], list) and 'timestamp' in raw[0] else raw
        for row in rows:
            if not isinstance(row, list) or len(row) < 2 or not re.fullmatch(r'\d{14}', str(row[0])):
                continue
            ts, original = row[0], row[1]
            original_path = urlparse(original).path.rstrip('/').lower()
            if original_path != f'/{handle}' and not original_path.startswith(f'/{handle}/'):
                continue
            link = f'https://web.archive.org/web/{ts}/{original}'
            found.append({'key': f'wayback:{ts}:{original}', 'type': 'snapshot', 'platform': 'Wayback Machine', 'title': f'Captura del perfil @{handle}', 'url': link, 'date': f'{ts[:4]}-{ts[4:6]}-{ts[6:8]}', 'note': f'Página archivada: {original}. Puede contener solo una pantalla de acceso, no necesariamente fotos o historias.'})
    return found

def arquivo(handle):
    params = {'q': f'"{handle}"', 'maxItems': '50'}
    data = fetch_json('https://arquivo.pt/textsearch?' + urlencode(params))
    if not isinstance(data, dict):
        raise RuntimeError('Formato de resultados inesperado')
    rows = data.get('response_items', data.get('responseItems', []))
    results = []
    for hit in rows[:50]:
        if not isinstance(hit, dict):
            continue
        url = sanitize_link(hit.get('linkToArchive') or hit.get('link') or hit.get('url'))
        if not url:
            continue
        title = str(hit.get('title') or 'Mención histórica de Young Class')[:180]
        dt = str(hit.get('tstamp') or hit.get('timestamp') or '')[:10]
        results.append({'key': 'arquivo:' + url, 'type': 'snapshot', 'platform': 'Arquivo.pt', 'title': title, 'url': url, 'date': dt, 'note': 'Resultado de archivo web. Verificar que la página corresponde al artista antes de considerarlo recuperado.'})
    return results

def internet_archive(handle):
    params = [('q', handle), ('fl[]', 'identifier'), ('fl[]', 'title'), ('fl[]', 'year'), ('rows', '40'), ('page', '1'), ('output', 'json')]
    data = fetch_json('https://archive.org/advancedsearch.php?' + urlencode(params))
    docs = data.get('response', {}).get('docs', []) if isinstance(data, dict) else []
    results = []
    for item in docs:
        ident = item.get('identifier')
        if not isinstance(ident, str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,150}', ident):
            continue
        results.append({'key': 'ia:' + ident, 'type': 'media_candidate', 'platform': 'Internet Archive', 'title': str(item.get('title') or ident)[:180], 'url': 'https://archive.org/details/' + ident, 'date': str(item.get('year') or ''), 'note': 'Archivo potencialmente relacionado. Requiere revisión manual para confirmar autoría y contenido.'})
    return results

def run_scan():
    items = {e['key']: dict(e) for e in EVIDENCE}
    status = {}
    for handle in HANDLES:
        for label, fn in [('Wayback', wayback), ('Arquivo.pt', arquivo), ('Internet Archive', internet_archive)]:
            key = f'{label} · @{handle}'
            try:
                records = fn(handle)
                for record in records:
                    items[record['key']] = record
                status[key] = {'status': 'ok', 'count': len(records)}
            except Exception as exc:
                status[key] = {'status': 'error', 'count': 0, 'message': str(exc)[:180]}
            with LOCK:
                STATE['sources'] = dict(status)
                STATE['items'] = list(items.values())
    final = sorted(items.values(), key=lambda i: (i['type'] == 'reference', i.get('date') or ''), reverse=False)
    with LOCK:
        STATE.update({'running': False, 'last_scan': stamp(), 'sources': status, 'items': final, 'error': None})
        snapshot = dict(STATE)
    try:
        DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
        DATA_FILE.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding='utf-8')
    except OSError:
        pass

def start_scan():
    with LOCK:
        if STATE['running']:
            return False
        STATE['running'] = True
        STATE['sources'] = {}
        STATE['items'] = list(EVIDENCE)
    threading.Thread(target=run_scan, daemon=True).start()
    return True

PAGE = r'''<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0d0d12"><title>Young Class — Archivo histórico</title><style>
:root{color-scheme:dark;--bg:#0b0b10;--card:#16161e;--edge:#30303c;--muted:#a1a1af;--accent:#d8ff55;--txt:#f4f3f8}*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse 60% 36% at 88% 0%,#303b16,transparent),var(--bg);color:var(--txt);font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}a{color:inherit}button{font:inherit;cursor:pointer}main{max-width:1130px;margin:0 auto;padding:38px 22px 72px}.eyebrow{font-size:11px;color:var(--accent);letter-spacing:.22em;font-weight:800}.hero{display:flex;align-items:end;justify-content:space-between;gap:26px;margin:12px 0 30px;flex-wrap:wrap}h1{font-size:clamp(36px,7vw,75px);line-height:1.04;letter-spacing:-.06em;margin:0 0 12px;font-weight:850}h1 span{color:var(--accent)}.lede{color:#b9b9c3;font-size:16px;max-width:640px;margin:0}.btn{background:var(--accent);border:0;color:#141611;font-weight:800;border-radius:12px;padding:13px 22px}.btn:disabled{opacity:.55;cursor:wait}.ghost{display:inline-block;border:1px solid #3b3b49;border-radius:12px;padding:10px 14px;text-decoration:none;color:#ddd}.tags{display:flex;gap:9px;flex-wrap:wrap;margin:17px 0 0}.tag{border:1px solid #383941;border-radius:99px;font-size:12px;padding:5px 10px;color:#ccc}.panels{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:28px 0}.panel,.card,.source,.notice{background:rgba(23,23,31,.92);border:1px solid var(--edge);border-radius:16px}.panel{padding:20px}.number{font-size:29px;font-weight:800;letter-spacing:-.045em}.small{font-size:12px;color:var(--muted)}.notice{padding:16px 19px;margin:20px 0;color:#bdbdc7}.notice strong{color:white}.sectionhead{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:34px}h2{font-size:19px;letter-spacing:-.025em}select{background:#24242e;color:white;border:1px solid #41414f;border-radius:10px;padding:10px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px}.card{padding:19px;min-width:0}.card h3{margin:10px 0 8px;line-height:1.35;font-size:16px}.card p{font-size:13px;color:var(--muted);margin:0 0 15px}.card a{display:inline-block;color:var(--accent);font-weight:700;text-decoration:none}.pill{display:inline-block;border-radius:5px;background:#343622;color:#e0fca1;font-weight:750;padding:3px 7px;font-size:10px;text-transform:uppercase;letter-spacing:.06em}.pill.ref{background:#302b3c;color:#d6c3fd}.pill.candidate{background:#3b2d20;color:#ffd19c}.meta{font-size:12px;color:#aaa;margin-top:5px}.sources{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 0}.source{padding:9px 12px;font-size:12px;color:#c2c2cc}.source b{color:#e0ff8d}.source.error{border-color:#6d3b3b;color:#ffbebe}.toolbar{display:flex;gap:9px;flex-wrap:wrap}.empty{padding:24px;border:1px dashed #444451;border-radius:14px;color:var(--muted)}footer{margin-top:40px;color:#888895;font-size:12px}footer a{color:#ccc}@media(max-width:700px){main{padding:24px 15px 50px}.panels{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}.hero{align-items:start}.panel{padding:15px}} </style></head>
<body><main><div class="eyebrow">INVESTIGACIÓN DE ARCHIVOS PÚBLICOS / 2026</div><div class="hero"><div><h1>YOUNG CLASS<span>.</span><br>ARCHIVE</h1><p class="lede">Reconstruimos el rastro digital histórico del artista. Capturas de páginas antiguas, archivos públicos y pistas verificables. Sin inventar historias desaparecidas.</p><div class="tags"><span class="tag">Objetivo: @youngclasstlc</span><span class="tag">Wayback Machine</span><span class="tag">Arquivo.pt</span><span class="tag">Internet Archive</span></div></div><button id="scan" class="btn" onclick="scan()">↻ Buscar archivos</button></div>
<div class="panels"><div class="panel"><div class="small">Páginas históricas</div><div class="number" id="snap">0</div></div><div class="panel"><div class="small">Archivos candidatos</div><div class="number" id="cand">0</div></div><div class="panel"><div class="small">Historias recuperadas</div><div class="number" id="story">0</div></div><div class="panel"><div class="small">Referencias verificadas</div><div class="number" id="refs">0</div></div></div>
<div class="notice"><strong>Importante:</strong> un enlace a un archivo web <em>no equivale</em> a una foto o historia recuperada. Las historias que nadie guardó mientras estaban públicas no se pueden reconstruir. Esta app no solicita contraseñas, no burla controles de acceso ni descarga masivamente material de terceros.</div>
<div class="sectionhead"><h2>Estado de la investigación</h2><span class="small" id="updated">Todavía sin escaneo</span></div><div id="sources" class="sources"></div>
<div class="sectionhead"><h2>Hallazgos y pistas</h2><div class="toolbar"><select id="filter" onchange="render()"><option value="all">Todo el material</option><option value="snapshot">Capturas archivadas</option><option value="media_candidate">Archivos candidatos</option><option value="reference">Referencias oficiales</option></select><a class="ghost" href="/export.json" download>Exportar JSON</a><a class="ghost" href="/export.csv" download>Exportar CSV</a></div></div><div id="items" class="grid"></div>
<div class="sectionhead"><h2>Otras vías de búsqueda</h2></div><div class="grid"><div class="card"><h3>Historias archivadas por terceros</h3><p>Comprobación manual en Instarchiver, respetando sus condiciones. Solo sirve si capturaron el perfil cuando las historias estaban disponibles.</p><a href="https://instarchiver.net/users" target="_blank" rel="noopener noreferrer">Abrir Instarchiver ↗</a></div><div class="card"><h3>Cuenta original del artista</h3><p>Si Young Class recupera su acceso, puede exportar el archivo privado de historias desde Instagram. Esa es la fuente más completa.</p><a href="https://www.instagram.com/youngclasstlc/" target="_blank" rel="noopener noreferrer">Comprobar perfil ↗</a></div><div class="card"><h3>Búsqueda de menciones y copias</h3><p>Localizar material republicado por seguidores, colaboradores y canales antiguos. Verificar siempre la procedencia y los derechos.</p><a href="https://www.google.com/search?q=%22youngclasstlc%22" target="_blank" rel="noopener noreferrer">Buscar menciones ↗</a></div><div class="card"><h3>Archivo histórico manual</h3><p>Buscar versiones del perfil por fecha y abrir las capturas originales. Algunos recuerdos solo mostrarán una pantalla de inicio de sesión.</p><a href="https://web.archive.org/web/*/https://www.instagram.com/youngclasstlc/" target="_blank" rel="noopener noreferrer">Abrir calendario Wayback ↗</a></div></div>
<footer>Herramienta independiente de investigación histórica. Las fuentes pertenecen a sus titulares. No afiliada a Meta, Instagram, YouTube ni Internet Archive. En alojamiento gratuito, los datos locales pueden perderse al reiniciar: exporta los hallazgos.</footer></main><script>
let state={items:[],sources:{},running:false}; const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function render(){let a=state.items||[];document.getElementById('snap').textContent=a.filter(x=>x.type==='snapshot').length;document.getElementById('cand').textContent=a.filter(x=>x.type==='media_candidate').length;document.getElementById('story').textContent=a.filter(x=>x.type==='story').length;document.getElementById('refs').textContent=a.filter(x=>x.type==='reference').length;document.getElementById('updated').textContent=state.running?'Consultando fuentes…':state.last_scan?'Último escaneo: '+new Date(state.last_scan).toLocaleString('es-ES'):'Todavía sin escaneo';let b=document.getElementById('scan');b.disabled=!!state.running;b.textContent=state.running?'Buscando…':'↻ Buscar archivos';document.getElementById('sources').innerHTML=Object.entries(state.sources||{}).map(([n,v])=>`<div class="source ${v.status==='error'?'error':''}" title="${esc(v.message||'')}">${esc(n)} · ${v.status==='error'?'No disponible':`<b>${v.count}</b> hallazgos`}</div>`).join('')||'<span class="small">Pulsa Buscar archivos para consultar las fuentes públicas.</span>';let f=document.getElementById('filter').value;let cards=a.filter(x=>f==='all'||x.type===f);const titles={snapshot:'Captura archivada',media_candidate:'Candidato (sin verificar)',reference:'Referencia oficial',story:'Historia recuperada'};document.getElementById('items').innerHTML=cards.length?cards.map(x=>`<article class="card"><span class="pill ${x.type==='reference'?'ref':x.type==='media_candidate'?'candidate':''}">${esc(titles[x.type]||x.type)}</span><div class="meta">${esc(x.platform)} ${x.date?'· '+esc(x.date):''}</div><h3>${esc(x.title)}</h3><p>${esc(x.note)}</p><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">Ver fuente original ↗</a></article>`).join(''):'<div class="empty">Sin registros en esta categoría. Los archivos públicos pueden no conservar copias de este perfil.</div>'}
async function refresh(){try{let r=await fetch('/api/state',{cache:'no-store'});state=await r.json();render()}catch(e){document.getElementById('updated').textContent='No se ha podido consultar el servidor'}}
async function scan(){try{let r=await fetch('/api/scan',{method:'POST'});if(!r.ok)throw Error();await refresh()}catch(e){alert('No se pudo iniciar el escaneo')}}refresh();setInterval(refresh,4500);
</script></body></html>'''

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print('[HTTP]', fmt % args, flush=True)

    def respond(self, status, content, content_type='application/json; charset=utf-8', filename=None):
        body = content.encode('utf-8') if isinstance(content, str) else content
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'no-store')
        if filename:
            self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/':
            return self.respond(200, PAGE, 'text/html; charset=utf-8')
        if path == '/health':
            return self.respond(200, '{"ok":true}')
        with LOCK:
            snapshot = dict(STATE)
            snapshot['items'] = list(STATE['items'])
        if path in ('/api/state', '/export.json'):
            return self.respond(200, json.dumps(snapshot, ensure_ascii=False, indent=2), filename='young-class-findings.json' if path.startswith('/export') else None)
        if path == '/export.csv':
            out = io.StringIO()
            w = csv.DictWriter(out, fieldnames=['type', 'platform', 'date', 'title', 'url', 'note'])
            w.writeheader()
            for item in snapshot['items']:
                w.writerow({key: item.get(key, '') for key in w.fieldnames})
            return self.respond(200, out.getvalue(), 'text/csv; charset=utf-8', 'young-class-findings.csv')
        return self.respond(404, '{"error":"not_found"}')

    def do_POST(self):
        if self.path.split('?')[0] != '/api/scan':
            return self.respond(404, '{"error":"not_found"}')
        started = start_scan()
        return self.respond(202 if started else 409, json.dumps({'started': started}))

if __name__ == '__main__':
    if DATA_FILE.is_file():
        try:
            saved = json.loads(DATA_FILE.read_text(encoding='utf-8'))
            if isinstance(saved, dict) and isinstance(saved.get('items'), list):
                STATE.update({k: saved[k] for k in ('last_scan','sources','items') if k in saved})
        except (OSError, json.JSONDecodeError):
            pass
    if not STATE['items']:
        STATE['items'] = list(EVIDENCE)
    port = int(os.getenv('PORT', '10000'))
    print(f'Serving {APP_NAME} on 0.0.0.0:{port}', flush=True)
    ThreadingHTTPServer(('0.0.0.0', port), Handler).serve_forever()