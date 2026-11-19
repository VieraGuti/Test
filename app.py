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
from concurrent.futures import ThreadPoolExecutor, as_completed
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse, parse_qs, quote
from yc_media_vault import vault, authorized, LIMIT
from urllib.request import Request, urlopen

APP_NAME = 'YOUNG CLASS // ARCHIVE'
HANDLES = [h.strip().lower().lstrip('@') for h in os.getenv('TARGET_HANDLES', 'youngclasstlc').split(',') if re.fullmatch(r'[a-zA-Z0-9_.@]{2,30}', h.strip())]
HANDLES = list(dict.fromkeys(HANDLES + ['youngclass_', 'youngclasssss'])) or ['youngclasstlc']  # second handle is an unconfirmed historical lead
DATA_FILE = Path(os.getenv('ARCHIVE_DATA_PATH', '/tmp/young-class-archive.json'))
LOCK = threading.Lock()
STATE = {'running': False, 'last_scan': None, 'sources': {}, 'items': [], 'error': None}

# Separately verified contemporary references are NOT recovered deleted media.
EVIDENCE = [
  {
    "key": "youtube:2KQbKeLGgoQ",
    "type": "media_online",
    "kind": "video",
    "platform": "YouTube",
    "title": "RECORRIDO — Young Class (videoclip oficial)",
    "url": "https://www.youtube.com/watch?v=2KQbKeLGgoQ",
    "date": "2024-01-04",
    "note": "Videoclip público localizado. Su descripción vincula @youngclasstlc. No es contenido borrado recuperado."
  },
  {
    "key": "youtube:BlVNGp_g93Q",
    "type": "media_online",
    "kind": "video",
    "platform": "YouTube",
    "title": "MI MILLÓN — Young Class",
    "url": "https://www.youtube.com/watch?v=BlVNGp_g93Q",
    "date": "2024-11-20",
    "note": "Videoclip público conservado. Fuente para contrastar identidades y colaboradores."
  },
  {
    "key": "youtube:p82AhyPZd7Y",
    "type": "media_online",
    "kind": "audio",
    "platform": "YouTube",
    "title": "BADLOBA — Young Class (audio original)",
    "url": "https://www.youtube.com/watch?v=p82AhyPZd7Y",
    "date": "2017-01-14",
    "note": "Audio publicado en 2017. En su descripción figura @YoungClasstlc, Facebook /youngclassss y créditos de Rev Visual Records."
  },
  {
    "key": "youtube:XBeox3rLAlM",
    "type": "media_online",
    "kind": "video",
    "platform": "YouTube",
    "title": "KELOWÁ — Young Class (vídeo oficial de 2017)",
    "url": "https://www.youtube.com/watch?v=XBeox3rLAlM",
    "date": "2017-02-28",
    "note": "Videoclip de 2017 con créditos y antiguo contacto en su descripción. Sigue referenciado públicamente."
  },
  {
    "key": "youtube:sCwIBr7vPCc",
    "type": "media_online",
    "kind": "video",
    "platform": "YouTube",
    "title": "BUSCANDO EL SOBRE (REMIX) — MBS Rolling, Denyerkin, Young Class y El Jincho",
    "url": "https://www.youtube.com/watch?v=sCwIBr7vPCc",
    "date": "2017-11-01",
    "note": "Videoclip de colaboración de 2017; su descripción incluye @YOUNGCLASSSSS, otra pista de usuario histórico, sin confirmar que fuera cuenta de Instagram."
  },
  {
    "key": "youtube:jL5rQkdLT5M",
    "type": "media_online",
    "kind": "video",
    "platform": "YouTube",
    "title": "PA' TRAS — Young Class (2018)",
    "url": "https://www.youtube.com/watch?v=jL5rQkdLT5M",
    "date": "2018-01-19",
    "note": "Videoclip oficial de 2018; su descripción enlaza Instagram @YoungClasstlc y Facebook /youngclassss."
  },
  {
    "key": "soundcloud:blessed-2017",
    "type": "media_online",
    "kind": "audio",
    "platform": "SoundCloud",
    "title": "BLESSED — M El Cobi ft. Young Class (copia de 2017)",
    "url": "https://m.soundcloud.com/alvarotaboada/m-elcobi-blessed-ft-young-class",
    "date": "2017-04-13",
    "note": "Audio publicado por tercero y conservado en SoundCloud. Comprobar permisos y procedencia antes de reutilizar."
  },
  {
    "key": "soundcloud:suerte-2017",
    "type": "media_online",
    "kind": "audio",
    "platform": "SoundCloud",
    "title": "SUERTE — Joyce Santana (mezcla y master: Young Class)",
    "url": "https://m.soundcloud.com/joycesantana/suerte",
    "date": "2017-12-13",
    "note": "Audio con crédito de mezcla y master atribuido a Young Class; colaboración técnica, no tema propio."
  },
  {
    "key": "spotify:dando-2017",
    "type": "media_online",
    "kind": "audio",
    "platform": "Spotify",
    "title": "DANDO LA NOTA — Young Class con WE$T DUBAI",
    "url": "https://open.spotify.com/intl-es/track/57cUcXHGkLj5OPVxm5mpLC",
    "date": "2017-11-24",
    "note": "Grabación de colaboración distribuida en plataformas; figura como lanzamiento original de 2017."
  },
  {
    "key": "spotify:buscando-2017",
    "type": "media_online",
    "kind": "audio",
    "platform": "Spotify",
    "title": "BUSCANDO EL SOBRE (REMIX) — grabación de 2017",
    "url": "https://open.spotify.com/track/7dD1OoGvpbuHDh5vx4ecYK",
    "date": "2017-11-01",
    "note": "Edición de audio disponible con créditos a Young Class junto a MBS Rolling, El Jincho y Denyerkin."
  },
  {
    "key": "audiomack:allmoney",
    "type": "media_online",
    "kind": "audio",
    "platform": "Audiomack",
    "title": "ALL MONEY — Young Class (copia de plataforma)",
    "url": "https://audiomack.com/young-class/song/all-money-5413341",
    "date": "2020-07-18",
    "note": "Grabación que continúa listada en Audiomack, dentro de Grandes Clásicos."
  },
  {
    "key": "apple:kelowa",
    "type": "media_online",
    "kind": "audio",
    "platform": "Apple Music",
    "title": "KELOWÁ — otra edición de la grabación",
    "url": "https://music.apple.com/es/song/1781250678",
    "date": "2020-07-18",
    "note": "Edición distribuida de audio con material histórico reeditado; sirve como copia de contraste."
  },
  {
    "key": "historical:versaalante",
    "type": "historical_reference",
    "kind": "audio",
    "platform": "ElGeneroPlus",
    "title": "ALANTE — Versa La V (prod. Young Class y Misael Relative)",
    "url": "https://elgeneroplus.com/archivos/alante/",
    "date": "2018-10-27",
    "note": "Artículo antiguo enlaza videoclip y MP3; también menciona @youngclass_. Investigar estos enlaces originales y una eventual copia."
  },
  {
    "key": "historical:trap2018",
    "type": "historical_reference",
    "kind": "articulo",
    "platform": "Trap This",
    "title": "Prensa de 2018: Young Class y la etapa NIKE MAFIA",
    "url": "https://darkblog777.wordpress.com/2018/01/31/el-trap-en-espana-mejores-artistas-y-canciones/",
    "date": "2018-01-31",
    "note": "Artículo publicado en enero de 2018 que menciona etapa de 2016, WE$T DUBAI, Badloba, Kelowá y XNXX."
  },
  {
    "key": "historical:carnaval2018",
    "type": "historical_reference",
    "kind": "foto",
    "platform": "Mi Pueblo Fuerteventura",
    "title": "Carnaval de Corralejo de 2018 — cartel/agenda de Young Class",
    "url": "https://mipueblofuerteventura.eu/index.php/noticias-fuerteventura/la-oliva/itemlist/tag/Carnaval%2Bde%2BCarnavales?start=3",
    "date": "2018-03-10",
    "note": "La agenda menciona actuación de Young Class junto a Manuel Turizo. Posible vía hacia carteles y fotografías de actuaciones."
  },
  {
    "key": "historical:album2020",
    "type": "historical_reference",
    "kind": "audio",
    "platform": "Amazon Music",
    "title": "GRANDES CLÁSICOS — catálogo de 17 temas antiguos",
    "url": "https://music.amazon.com/tracks/B0DNTJSGB5",
    "date": "2020-07-18",
    "note": "Catálogo que documenta 17 títulos, entre ellos Camuflaje, One Dream, Blessed, Tokio Drift, All Money, Kelowá, Xnxx y Young Grey. No son 17 descargas recuperadas."
  },
  {
    "key": "historical:beatport",
    "type": "historical_reference",
    "kind": "audio",
    "platform": "Beatport",
    "title": "Discografía y metadatos comerciales antiguos de Young Class",
    "url": "https://www.beatport.com/artist/young-class/665311/tracks",
    "date": "2020-07-18",
    "note": "Listado histórico de pistas y colaboradores; útil para detectar canciones no disponibles en otros catálogos."
  },
  {
    "key": "historical:spotify",
    "type": "historical_reference",
    "kind": "cuenta",
    "platform": "Spotify",
    "title": "Perfil y biografía — NIKE MAFIA / WE$T DUBAI",
    "url": "https://open.spotify.com/intl-fr/artist/0K99SbJ1zxuXvxUyhV2NPj",
    "date": "",
    "note": "Biografía del artista y discografía; documenta su etapa de grupo y lanzamientos antiguos."
  },
  {
    "key": "historical:channel",
    "type": "historical_reference",
    "kind": "cuenta",
    "platform": "YouTube",
    "title": "Canal oficial YOUNG CLASS (@youngclass1998)",
    "url": "https://www.youtube.com/channel/UCEW_1BJjhqNSjphsyCE8I0Q",
    "date": "",
    "note": "Canal oficial actual; tiene entre sus palabras clave NIKE MAFIA. Utilizar para descubrir vídeos originales, listas y enlaces históricos."
  },
  {
    "key": "historical:soundcharts",
    "type": "historical_reference",
    "kind": "articulo",
    "platform": "Soundcharts",
    "title": "Biografía musical histórica de Young Class",
    "url": "https://soundcharts.com/es/artist/11e83feb-17ac-3c90-9838-aa1c026db3d8",
    "date": "",
    "note": "Fuente secundaria que menciona La Nike Mafia y relación con WE$T DUBAI."
  },
  {
    "key": "historical:oldinstagram",
    "type": "historical_reference",
    "kind": "cuenta",
    "platform": "ElGeneroPlus",
    "title": "Pista del usuario @youngclass_ en prensa musical de 2018",
    "url": "https://elgeneroplus.com/archivos/alante/",
    "date": "2018-10-27",
    "note": "El usuario se menciona en un artículo de producción musical. Falta confirmar propiedad exacta y si es perfil anterior."
  }
,
{"key":"historical:instagram-youngclasssss-2021","type":"historical_reference","kind":"cuenta","platform":"YouTube / SocialAuditor","title":"INSTAGRAM @youngclasssss — acreditado en 2021","url":"https://www.youtube.com/watch?v=-SI4Y8HA9-Q","date":"2021-02-03","note":"En la descripción del vídeo 'Purina' de Lean Cap con Young Class se etiqueta explícitamente como Instagram @youngclasssss. Una ficha externa de SocialAuditor conserva estadísticas históricas del mismo alias. Debe comprobarse titularidad y disponibilidad de copias."}
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
        params.update({'from': '2015', 'to': '2025'})
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

# URLs históricas extraídas de descripciones oficiales y publicaciones de 2017-2018.
SNAPSHOT_TARGETS = [["Instagram histórico @youngclasstlc (2017)","https://www.instagram.com/youngclasstlc/","2017"],["Instagram histórico @youngclasstlc (2019)","https://www.instagram.com/youngclasstlc/","2019"],["Alias citado @youngclass_ (2018, titular sin confirmar)","https://www.instagram.com/youngclass_/","2018"],
["Instagram @youngclasssss (2021, acreditado en videoclip)","https://www.instagram.com/youngclasssss/","2021"],["Facebook /youngclassss (2017)","https://www.facebook.com/youngclassss/","2017"],["YouTube oficial Young Class (2017)","https://www.youtube.com/channel/UCEW_1BJjhqNSjphsyCE8I0Q","2017"],["Vídeo BADLOBA (2017)","https://www.youtube.com/watch?v=p82AhyPZd7Y","2017"],["Vídeo KELOWÁ (2017)","https://www.youtube.com/watch?v=XBeox3rLAlM","2017"],["Imagen original ALANTE, 2018","https://elgeneroplus.com/images/subir/images/15406633135utrvjo.jpg","2018"],["Imagen original ALANTE, 2018 (portada lyric)","https://elgeneroplus.com/images/subir/images/1531026190azuiu5d.jpg","2018"],["Artículo original ALANTE, 2018","https://elgeneroplus.com/versa-la-v-alante-official-video/","2018"]]

def archived_exact_target(target):
    title, original, year = target
    url = 'https://archive.org/wayback/available?' + urlencode({'url': original, 'timestamp': year})
    data = fetch_json(url)
    closest = (data.get('archived_snapshots') or {}).get('closest') or {} if isinstance(data, dict) else {}
    link = sanitize_link(closest.get('url'))
    if not closest.get('available') or not link or not urlparse(link).hostname in ('web.archive.org', 'archive.org'):
        return None
    date_raw = str(closest.get('timestamp') or '')
    captured_on = f'{date_raw[:4]}-{date_raw[4:6]}-{date_raw[6:8]}' if len(date_raw) >= 8 else ''
    return {'key': 'exact:' + original + ':' + date_raw, 'type': 'snapshot', 'kind': 'archivo', 'platform': 'Wayback Machine', 'title': title, 'url': link, 'date': captured_on, 'note': 'La API del archivo indica una copia de esta URL histórica. Revisar manualmente si se conservó contenido multimedia y si corresponde al artista; no implica historia de Instagram recuperada.'}

def inspect_exact_targets():
    found = []
    errors = []
    with ThreadPoolExecutor(max_workers=5) as pool:
        tasks = {pool.submit(archived_exact_target, t): t for t in SNAPSHOT_TARGETS}
        for fut in as_completed(tasks):
            try:
                result = fut.result()
                if result is not None:
                    found.append(result)
            except Exception as exc:
                errors.append(str(exc)[:100])
    return found, errors


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
    try:
        snapshots, failures = inspect_exact_targets()
        for record in snapshots:
            items[record['key']] = record
        status['Wayback · enlaces históricos de 2017–2018'] = {'status': 'partial' if failures else 'ok', 'count': len(snapshots), 'message': f'{len(failures)} consultas sin respuesta' if failures else ''}
    except Exception as exc:
        status['Wayback · enlaces históricos de 2017–2018'] = {'status': 'error', 'count': 0, 'message': str(exc)[:180]}
    with LOCK:
        STATE['sources'] = dict(status)
        STATE['items'] = list(items.values())
    final = sorted(items.values(), key=lambda i: (i['type'] not in ('snapshot', 'media_candidate'), i.get('date') or '9999-99-99', i.get('title') or ''))
    with LOCK:
        STATE.update({'running': False, 'last_scan': stamp(), 'sources': status, 'items': final, 'error': None})
        snapshot = dict(STATE)
    print('YOUNGCLASS_SCAN_SUMMARY ' + json.dumps({'last_scan': snapshot['last_scan'], 'total': len(final), 'counts': {t: sum(1 for item in final if item.get('type') == t) for t in ('snapshot','media_candidate','reference','historical_reference','media_online','story')}, 'sources': status, 'sample': [{'title': item['title'], 'url': item['url'], 'type': item['type']} for item in final[:7]]}, ensure_ascii=False), flush=True)
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
:root{color-scheme:dark;--bg:#0b0b10;--card:#16161e;--edge:#30303c;--muted:#a1a1af;--accent:#d8ff55;--txt:#f4f3f8}*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse 60% 36% at 88% 0%,#303b16,transparent),var(--bg);color:var(--txt);font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}a{color:inherit}button{font:inherit;cursor:pointer}main{max-width:1130px;margin:0 auto;padding:38px 22px 72px}.eyebrow{font-size:11px;color:var(--accent);letter-spacing:.22em;font-weight:800}.hero{display:flex;align-items:end;justify-content:space-between;gap:26px;margin:12px 0 30px;flex-wrap:wrap}h1{font-size:clamp(36px,7vw,75px);line-height:1.04;letter-spacing:-.06em;margin:0 0 12px;font-weight:850}h1 span{color:var(--accent)}.lede{color:#b9b9c3;font-size:16px;max-width:640px;margin:0}.btn{background:var(--accent);border:0;color:#141611;font-weight:800;border-radius:12px;padding:13px 22px}.btn:disabled{opacity:.55;cursor:wait}.ghost{display:inline-block;border:1px solid #3b3b49;border-radius:12px;padding:10px 14px;text-decoration:none;color:#ddd}.tags{display:flex;gap:9px;flex-wrap:wrap;margin:17px 0 0}.tag{border:1px solid #383941;border-radius:99px;font-size:12px;padding:5px 10px;color:#ccc}.panels{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:28px 0}.panel,.card,.source,.notice{background:rgba(23,23,31,.92);border:1px solid var(--edge);border-radius:16px}.panel{padding:20px}.number{font-size:29px;font-weight:800;letter-spacing:-.045em}.small{font-size:12px;color:var(--muted)}.notice{padding:16px 19px;margin:20px 0;color:#bdbdc7}.notice strong{color:white}.sectionhead{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:34px}h2{font-size:19px;letter-spacing:-.025em}select{background:#24242e;color:white;border:1px solid #41414f;border-radius:10px;padding:10px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px}.card{padding:19px;min-width:0}.card h3{margin:10px 0 8px;line-height:1.35;font-size:16px}.card p{font-size:13px;color:var(--muted);margin:0 0 15px}.card a{display:inline-block;color:var(--accent);font-weight:700;text-decoration:none}.pill{display:inline-block;border-radius:5px;background:#343622;color:#e0fca1;font-weight:750;padding:3px 7px;font-size:10px;text-transform:uppercase;letter-spacing:.06em}.pill.ref{background:#302b3c;color:#d6c3fd}.pill.candidate{background:#3b2d20;color:#ffd19c}.meta{font-size:12px;color:#aaa;margin-top:5px}.sources{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 0}.source{padding:9px 12px;font-size:12px;color:#c2c2cc}.source b{color:#e0ff8d}.source.error{border-color:#6d3b3b;color:#ffbebe}.toolbar{display:flex;gap:9px;flex-wrap:wrap}.empty{padding:24px;border:1px dashed #444451;border-radius:14px;color:var(--muted)}footer{margin-top:40px;color:#888895;font-size:12px}footer a{color:#ccc}.library-media{width:100%;height:190px;object-fit:contain;background:#0d0d13;border:1px solid #282832;border-radius:12px;margin:0 0 12px}.library-item .meta{margin-top:0}.library-item .filename{overflow-wrap:anywhere}.vault-tools{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.vault-note{font-size:12px;color:#aeb0ba}.vault-header{margin:34px 0 8px}.import-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.import-row input{background:#25252f;color:#eee;border:1px solid #42424f;border-radius:10px;padding:11px;min-width:0}.import-row input[type=file]{max-width:100%;width:330px}.state-dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--accent);margin-right:8px}.dl{display:inline-block;background:#d8ff55;color:#12150c!important;border-radius:9px;padding:8px 12px;text-decoration:none!important;font-size:13px;margin-top:5px}.vault-info{padding:15px 17px;margin:12px 0;border:1px solid #3b3d46;border-radius:12px;color:#c4c4cf}.vault-info.warn{border-color:#715539;color:#ffe1b2}.library-error{color:#ff9d9d;font-size:13px}.vault-grid .card{position:relative}.vault-grid .card video{max-height:230px}.vault-grid .card audio{width:100%;margin:8px 0 10px}@media(max-width:700px){main{padding:24px 15px 50px}.panels{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}.hero{align-items:start}.panel{padding:15px}} </style></head>
<body><main><div class="eyebrow">INVESTIGACIÓN DE ARCHIVOS PÚBLICOS / 2026</div><div class="hero"><div><h1>YOUNG CLASS<span>.</span><br>ARCHIVE</h1><p class="lede">Reconstruimos el rastro digital histórico del artista. Capturas de páginas antiguas, archivos públicos y pistas verificables. Sin inventar historias desaparecidas.</p><div class="tags"><span class="tag">@youngclasstlc</span><span class="tag">@youngclasssss · 2021</span><span class="tag">@youngclass_ · pista sin confirmar</span><span class="tag">NIKE MAFIA · 2016–2018</span><span class="tag">Wayback Machine</span><span class="tag">Arquivo.pt</span><span class="tag">Internet Archive</span></div></div><button id="scan" class="btn" onclick="scan()">↻ Buscar archivos</button></div>
<div class="panels"><div class="panel"><div class="small">Páginas históricas</div><div class="number" id="snap">0</div></div><div class="panel"><div class="small">Audio y vídeo localizado</div><div class="number" id="cand">0</div></div><div class="panel"><div class="small">Historias recuperadas</div><div class="number" id="story">0</div></div><div class="panel"><div class="small">Referencias y pistas</div><div class="number" id="refs">0</div></div></div>
<div class="notice"><strong>Importante:</strong> un enlace a un archivo web <em>no equivale</em> a una foto o historia recuperada. Las historias que nadie guardó mientras estaban públicas no se pueden reconstruir. Esta app no solicita contraseñas, no burla controles de acceso ni descarga masivamente material de terceros.</div>
<div class="sectionhead"><h2>Estado de la investigación</h2><span class="small" id="updated">Todavía sin escaneo</span></div><div id="sources" class="sources"></div>
<div class="sectionhead vault-header"><h2>Biblioteca recuperada · descarga directa</h2><div class="vault-tools"><select id="vault-filter" onchange="renderVault()"><option value="all">Todos los archivos</option><option value="foto">Fotos</option><option value="video">Vídeos</option><option value="audio">Audios</option><option value="documento">Documentos</option></select><span class="small" id="vault-count">Comprobando archivos…</span><a class="ghost" href="/media/all.zip" download="young-class-archivos.zip" id="vault-bulk">Descargar todo ZIP</a></div></div>
<p class="lede">Aquí aparecen exclusivamente archivos que el servidor conserva de verdad. Puedes reproducirlos y descargarlos aquí mismo, sin salir de Young Class Archive. Las pistas de investigación quedan en una sección separada.</p>
<div id="vault-storage" class="vault-info">Comprobando almacenamiento…</div>
<div id="vault-items" class="grid vault-grid"><div class="empty">Cargando biblioteca…</div></div>
<details class="card" style="margin-top:16px"><summary style="cursor:pointer;font-weight:750">Importar fotos, vídeos, audios o exportación ZIP de Instagram (administrador)</summary>
<p style="margin:12px 0">Sube solo archivos propios o que tengas permiso de almacenar y compartir. Un ZIP de Instagram se descomprime y clasifica automáticamente. Máximo 160 MB por subida y 450 MB descomprimidos.</p>
<div class="import-row"><input type="password" id="vault-admin" placeholder="Clave de administrador" autocomplete="off" aria-label="Clave de administrador"><input type="file" id="vault-upload" accept=".zip,.jpg,.jpeg,.png,.webp,.gif,.mp4,.mov,.m4v,.webm,.mp3,.wav,.m4a,.ogg,.flac,.pdf,.txt" multiple><button class="btn" id="vault-upload-btn" type="button" onclick="vaultUpload()">Importar archivos</button></div>
<div id="vault-upload-status" class="small" style="margin:12px 0">La clave solo se envía al servidor para autorizar la importación; no se guarda en el navegador.</div>
</details>
<div class="sectionhead"><h2>Hallazgos y pistas</h2><div class="toolbar"><select id="filter" onchange="render()"><option value="all">Todo el material</option><option value="snapshot">Capturas archivadas</option><option value="media_online">Vídeos y audios localizados</option><option value="historical_reference">Pistas históricas</option><option value="media_candidate">Otros archivos candidatos</option><option value="reference">Referencias oficiales</option></select><a class="ghost" href="/export.json" download>Exportar JSON</a><a class="ghost" href="/export.csv" download>Exportar CSV</a></div></div><div id="items" class="grid"></div>
<div class="sectionhead"><h2>Otras vías de búsqueda</h2></div><div class="grid"><div class="card"><h3>Historias archivadas por terceros</h3><p>Comprobación manual en Instarchiver, respetando sus condiciones. Solo sirve si capturaron el perfil cuando las historias estaban disponibles.</p><a href="https://instarchiver.net/users" target="_blank" rel="noopener noreferrer">Abrir Instarchiver ↗</a></div><div class="card"><h3>Cuenta original del artista</h3><p>Si Young Class recupera su acceso, puede exportar el archivo privado de historias desde Instagram. Esa es la fuente más completa.</p><a href="https://www.instagram.com/youngclasstlc/" target="_blank" rel="noopener noreferrer">Comprobar perfil ↗</a></div><div class="card"><h3>Búsqueda de menciones y copias</h3><p>Localizar material republicado por seguidores, colaboradores y canales antiguos. Verificar siempre la procedencia y los derechos.</p><a href="https://www.google.com/search?q=%22youngclasstlc%22" target="_blank" rel="noopener noreferrer">Buscar menciones ↗</a></div><div class="card"><h3>Archivo histórico manual</h3><p>Buscar versiones del perfil por fecha y abrir las capturas originales. Algunos recuerdos solo mostrarán una pantalla de inicio de sesión.</p><a href="https://web.archive.org/web/*/https://www.instagram.com/youngclasstlc/" target="_blank" rel="noopener noreferrer">Abrir calendario Wayback ↗</a></div></div>
<footer>Herramienta independiente de investigación histórica. Las fuentes pertenecen a sus titulares. No afiliada a Meta, Instagram, YouTube ni Internet Archive. En alojamiento gratuito, los datos locales pueden perderse al reiniciar: exporta los hallazgos.</footer></main><script>
let state={items:[],sources:{},running:false}; const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function render(){let a=state.items||[];document.getElementById('snap').textContent=a.filter(x=>x.type==='snapshot').length;document.getElementById('cand').textContent=a.filter(x=>x.type==='media_online').length;document.getElementById('story').textContent=a.filter(x=>x.type==='story').length;document.getElementById('refs').textContent=a.filter(x=>x.type==='reference'||x.type==='historical_reference').length;document.getElementById('updated').textContent=state.running?'Consultando fuentes…':state.last_scan?'Último escaneo: '+new Date(state.last_scan).toLocaleString('es-ES'):'Todavía sin escaneo';let b=document.getElementById('scan');b.disabled=!!state.running;b.textContent=state.running?'Buscando…':'↻ Buscar archivos';document.getElementById('sources').innerHTML=Object.entries(state.sources||{}).map(([n,v])=>`<div class="source ${v.status==='error'?'error':''}" title="${esc(v.message||'')}">${esc(n)} · ${v.status==='error'?'No disponible':`<b>${v.count}</b> hallazgos`}</div>`).join('')||'<span class="small">Pulsa Buscar archivos para consultar las fuentes públicas.</span>';let f=document.getElementById('filter').value;let cards=a.filter(x=>f==='all'||x.type===f);const titles={snapshot:'Captura archivada',media_candidate:'Candidato (sin verificar)',media_online:'Audio/vídeo público localizado',historical_reference:'Pista histórica',reference:'Referencia oficial',story:'Historia recuperada'};document.getElementById('items').innerHTML=cards.length?cards.map(x=>`<article class="card"><span class="pill ${x.type==='reference'||x.type==='historical_reference'?'ref':x.type==='media_candidate'?'candidate':''}">${esc(titles[x.type]||x.type)}</span><div class="meta">${esc(x.platform)} ${x.date?'· '+esc(x.date):''}</div><h3>${esc(x.title)}</h3><p>${esc(x.note)}</p><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">Ver fuente original ↗</a></article>`).join(''):'<div class="empty">Sin registros en esta categoría. Los archivos públicos pueden no conservar copias de este perfil.</div>'}
async function refresh(){try{let r=await fetch('/api/state',{cache:'no-store'});state=await r.json();render()}catch(e){document.getElementById('updated').textContent='No se ha podido consultar el servidor'}}
async function scan(){try{let r=await fetch('/api/scan',{method:'POST'});if(!r.ok)throw Error();await refresh()}catch(e){alert('No se pudo iniciar el escaneo')}}refresh();setInterval(refresh,4500);
let vaultData={items:[],persistent:false,uploads_enabled:false};
function renderVault(){
 const filter=document.getElementById('vault-filter').value;
 const items=(vaultData.items||[]).filter(x=>filter==='all'||x.kind===filter);
 document.getElementById('vault-count').textContent=(vaultData.items||[]).length+' archivos descargables';
 const storage=document.getElementById('vault-storage');
 if(!vaultData.persistent){
  storage.className='vault-info warn';
  storage.textContent='Almacenamiento temporal: Render Free puede borrar los archivos al reiniciar o desplegar. No importes un archivo único hasta configurar almacenamiento persistente. Guarda una copia externa.';
 } else {
  storage.className='vault-info';
  storage.textContent='Almacenamiento persistente activo. Los archivos se sirven desde esta web.';
 }
 const el=document.getElementById('vault-items');
 el.innerHTML=items.length?items.map(x=>{
   const url='/media/'+encodeURIComponent(x.id),preview=url+'?preview=1';
   let media='';
   if(x.kind==='foto')media='<img class="library-media" loading="lazy" src="'+preview+'" alt="'+esc(x.filename)+'">';
   if(x.kind==='video')media='<video class="library-media" controls preload="metadata" playsinline src="'+preview+'"></video>';
   if(x.kind==='audio')media='<audio controls preload="none" src="'+preview+'"></audio>';
   return '<article class="card library-item">'+media+'<div class="meta">'+esc(x.album||x.kind.toUpperCase())+' · '+(x.size/(1024*1024)).toFixed(2)+' MB · '+esc(x.date||'')+'</div><h3 class="filename">'+esc(x.filename)+'</h3><p>'+esc(x.source||'Archivo autorizado')+'</p><a class="dl" href="'+url+'" download="'+esc(x.filename)+'">↓ Descargar archivo</a></article>'
 }).join(''):'<div class="empty">Aún no hay archivos guardados en el servidor. Puedes importar una exportación ZIP de Instagram, fotos, vídeos y audios con permiso del artista. Los enlaces externos de la sección de investigación no cuentan como recuperaciones.</div>';
}
async function loadVault(){
 try{const resp=await fetch('/api/media',{cache:'no-store'});if(!resp.ok)throw Error('HTTP '+resp.status);vaultData=await resp.json();renderVault()}
 catch(e){document.getElementById('vault-items').innerHTML='<div class="empty">No se pudo consultar la biblioteca: '+esc(e.message)+'</div>'}
}
async function vaultUpload(){
 const key=document.getElementById('vault-admin').value;
 const input=document.getElementById('vault-upload'),files=Array.from(input.files||[]);
 const status=document.getElementById('vault-upload-status'),button=document.getElementById('vault-upload-btn');
 if(!key){status.textContent='Introduce la clave de administrador.';return}
 if(!files.length){status.textContent='Selecciona uno o varios archivos, o un ZIP de exportación.';return}
 button.disabled=true;
 let imported=0,failed=0;
 try{
  for(let i=0;i<files.length;i++){
   const file=files[i];
   status.textContent='Importando '+(i+1)+' de '+files.length+': '+file.name;
   try{
    if(file.size>160*1024*1024)throw Error('Máximo 160 MB por archivo');
    const response=await fetch('/api/media/upload?filename='+encodeURIComponent(file.name),{method:'POST',headers:{'X-Archive-Admin':key,'Content-Type':'application/octet-stream'},body:file});
    const res=await response.json();
    if(!response.ok)throw Error(res.error||'No se pudo subir');
    imported+=res.imported||0;
   }catch(error){failed++;status.textContent='Error al importar '+file.name+': '+error.message}
  }
  status.textContent='Importación terminada: '+imported+' archivos nuevos, '+failed+' subidas fallidas. '+(!vaultData.persistent?'Recuerda: el almacenamiento actual no es persistente.':'');
  input.value='';await loadVault()
 }finally{button.disabled=false}
}
loadVault();

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

    def do_HEAD(self):
        if self.path.split('?')[0] in ('/','/health','/api/state'):
            self.send_response(200)
            self.send_header('Content-Length','0')
            self.end_headers()
        else:
            self.send_response(404)
            self.send_header('Content-Length','0')
            self.end_headers()

    def serve_media(self, file_id, preview=False):
        row = vault.get(file_id)
        if not row:
            return self.respond(404, '{"error":"archivo_no_encontrado"}')
        try:
            stream, length, content_range = vault.open_file(row,self.headers.get('Range'))
            self.send_response(206 if content_range else 200)
            self.send_header('Content-Type',row['mime'])
            self.send_header('Content-Length',str(length))
            self.send_header('Accept-Ranges','bytes')
            self.send_header('X-Content-Type-Options','nosniff')
            self.send_header('Cache-Control','private, max-age=600')
            disposition = 'inline' if preview else 'attachment'
            self.send_header('Content-Disposition', disposition + "; filename*=UTF-8''" + quote(row['filename']))
            if content_range: self.send_header('Content-Range',content_range)
            self.end_headers()
            remaining = length
            try:
                with stream:
                    while remaining > 0:
                        data = stream.read(min(65536,remaining))
                        if not data:break
                        self.wfile.write(data)
                        remaining -= len(data)
            except (BrokenPipeError,ConnectionResetError):
                pass
        except (OSError,ValueError,Exception) as exc:
            print('[VAULT] Delivery failed: '+str(exc)[:200], flush=True)
            if not self.wfile.closed:
                try: self.close_connection = True
                except Exception: pass

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/':
            return self.respond(200, PAGE, 'text/html; charset=utf-8')
        if path == '/health':
            return self.respond(200, '{"ok":true}')
        if path == '/media/all.zip':
            try:
                path_to_zip=vault.create_bulk_zip()
                try:
                    with path_to_zip.open('rb') as z:
                        self.send_response(200)
                        self.send_header('Content-Type','application/zip')
                        self.send_header('Content-Disposition','attachment; filename="young-class-archivos.zip"')
                        self.send_header('Content-Length',str(path_to_zip.stat().st_size))
                        self.send_header('Cache-Control','no-store')
                        self.end_headers()
                        while True:
                            block=z.read(1024*1024)
                            if not block:break
                            self.wfile.write(block)
                finally:
                    path_to_zip.unlink(missing_ok=True)
                return
            except (ValueError,OSError,Exception) as exc:
                return self.respond(400,json.dumps({'error':str(exc)[:170]},ensure_ascii=False))
        if path == '/api/media':
            try:
                return self.respond(200, json.dumps({'items':vault.get_entries(),'count':len(vault.get_entries()),'persistent':vault.is_persistent(),'uploads_enabled':bool(os.getenv('YC_ADMIN_TOKEN'))}, ensure_ascii=False))
            except Exception as exc:
                return self.respond(503,json.dumps({'error':'vault_unavailable','detail':str(exc)[:150]}))
        if path.startswith('/media/'):
            ident = path.removeprefix('/media/')
            query = parse_qs(urlparse(self.path).query)
            return self.serve_media(ident,preview=query.get('preview',['0'])[0]=='1')

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
        path = self.path.split('?')[0]
        if path == '/api/media/upload':
            if not authorized(self.headers.get('X-Archive-Admin','')):
                return self.respond(403, '{"error":"admin_key_required"}')
            try:
                q=parse_qs(urlparse(self.path).query)
                name=(q.get('filename') or ['archivo'])[0]
                length=int(self.headers.get('Content-Length','0'))
                if length < 1 or length > LIMIT:
                    return self.respond(413,'{"error":"max_160mb"}')
                result=vault.import_stream(self.rfile,length,name)
                print(f"[VAULT] Imported {result['imported']} file(s), rejected {result['rejected']} from {name}",flush=True)
                return self.respond(201,json.dumps(result,ensure_ascii=False))
            except (ValueError,OSError,Exception) as exc:
                print("[VAULT] Import error "+str(exc)[:160],flush=True)
                return self.respond(400,json.dumps({'error':str(exc)[:190]},ensure_ascii=False))
        if path != '/api/scan':
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
    if os.getenv('AUTO_SCAN_ON_BOOT', '1') == '1' and not STATE['last_scan']:
        print('Starting initial public archives scan', flush=True)
        start_scan()
    ThreadingHTTPServer(('0.0.0.0', port), Handler).serve_forever()