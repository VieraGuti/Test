"""Independent historical Instagram recovery index lookups.
All results are *candidates* until the archived image/video bytes have been verified.
Public sources: Arquivo.pt image search + CDX, Common Crawl CDX.
"""
from __future__ import annotations
import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen
from email.utils import parsedate_to_datetime

MAX_RESPONSE = 1_100_000
TIMEOUT = 11
CC_INDEXES = [
    "CC-MAIN-2018-51", "CC-MAIN-2019-51",
    "CC-MAIN-2020-50", "CC-MAIN-2021-43"
]

def request_text(url):
    host=urlparse(url).hostname
    if host not in {"arquivo.pt","index.commoncrawl.org","archive.is"}:
        raise ValueError("Archive host not permitted")
    request=Request(url,headers={"User-Agent":"YoungClassArchive/2.1 (+public historical media research)","Accept":"application/json,text/plain"})
    try:
        with urlopen(request,timeout=TIMEOUT) as response:
            raw=response.read(MAX_RESPONSE+1)
            if len(raw)>MAX_RESPONSE:raise ValueError("Archive response too large")
            return raw.decode("utf-8","replace")
    except HTTPError as exc:
        if exc.code==404:return ""
        raise

def date_from_timestamp(value):
    s=str(value or "")
    if re.match(r"^\d{8}",s):return s[:4]+"-"+s[4:6]+"-"+s[6:8]
    if re.match(r"^\d{4}-\d\d-\d\d",s):return s[:10]
    return ""

def arquivo_cdx(handle):
    results=[]
    for original in (f"https://www.instagram.com/{handle}/", f"https://instagram.com/{handle}/"):
        params={"url": original,"output":"json","limit":"60","collapseTime":"6","filter":"status:200","from":"2016","to":"2025"}
        data=request_text("https://arquivo.pt/wayback/cdx?"+urlencode(params))
        for line in data.splitlines()[:60]:
            try:entry=json.loads(line)
            except ValueError:continue
            if not isinstance(entry,dict):continue
            orig=entry.get("url")
            ts=str(entry.get("timestamp",""))
            if not isinstance(orig,str) or not re.match(r"^\d{8,14}$",ts):continue
            path=urlparse(orig).path.rstrip("/").lower()
            if path != "/"+handle:continue
            link="https://arquivo.pt/noFrame/replay/"+ts+"/"+orig
            results.append({"key":"ptcdx:"+ts+":"+orig,"type":"snapshot","kind":"archivo",
                            "platform":"Arquivo.pt CDX","title":"Captura histórica de Instagram @"+handle,
                            "url":link,"date":date_from_timestamp(ts),
                            "note":"La URL histórica figura en un índice CDX. Revisar la captura: puede ser un inicio de sesión, no una foto recuperada."})
    return results[:80]

def arquivo_images(handle):
    query=urlencode({"q":handle,"maxItems":"40","from":"2016","to":"2025"})
    data=json.loads(request_text("https://arquivo.pt/imagesearch?"+query))
    found=[]
    for it in (data.get("responseItems") or [])[:40]:
        if not isinstance(it,dict):continue
        url=it.get("imgLinkToArchive")
        if not isinstance(url,str) or urlparse(url).scheme not in ("http","https"):
            continue
        # Candidate is relevant only where the historical handle appears in source metadata.
        content=" ".join(str(it.get(key,"")) for key in ("pageURL","pageTitle","imgSrc","imgAlt","imgTitle","imgCaption")).lower()
        if handle not in content:continue
        src=str(it.get("pageURL") or "")
        meta=str(it.get("pageTitle") or "")
        date=date_from_timestamp(it.get("imgTstamp") or it.get("pageTstamp"))
        found.append({"key":"ptimage:"+str(it.get("imgDigest") or url),"type":"media_candidate","kind":"foto",
                      "platform":"Arquivo.pt imágenes","title":"Posible imagen histórica vinculada a @"+handle,
                      "url":url,"date":date,"source_page":src[:1000],"note":"Archivo de imagen referenciado en una página histórica: "+meta[:150]+". Comprobar visualmente identidad, procedencia y derechos antes de incorporarlo a descargas."})
    return found

def commoncrawl_single(handle,index):
    qs=urlencode({"url":"www.instagram.com/"+handle+"/","output":"json","filter":"status:200"})
    content=request_text("https://index.commoncrawl.org/"+index+"-index?"+qs)
    found=[]
    for line in content.splitlines()[:20]:
        try:entry=json.loads(line)
        except ValueError:continue
        if not isinstance(entry,dict):continue
        original=entry.get("url") or ""
        path=urlparse(original).path.rstrip("/").lower()
        if path!="/"+handle:continue
        filename=str(entry.get("filename") or "")
        offset=str(entry.get("offset") or "")
        length=str(entry.get("length") or "")
        if not filename.startswith("crawl-data/") or not offset.isdigit() or not length.isdigit():continue
        record_id=index+":"+offset+":"+filename
        # WARC record is a true historical byte range, but a capture can still be a login wall.
        found.append({"key":"cc:"+record_id,"type":"snapshot","platform":"Common Crawl",
                      "title":"Captura WARC de Instagram @"+handle+" · "+index,
                      "url":"https://data.commoncrawl.org/"+filename,
                      "date":date_from_timestamp(entry.get("timestamp")),
                      "kind":"archivo","warc":{"filename":filename,"offset":offset,"length":length},
                      "note":"Registro WARC con bytes históricos potencialmente recuperables. No equivale a una fotografía hasta inspeccionar el contenido de la respuesta."})
    return found

def archive_today(handle):
    original=f"https://www.instagram.com/{handle}/"
    raw=request_text("https://archive.is/timemap/"+original)
    found=[]
    # TimeMap replies use RFC 7089 Link syntax, not JSON.
    for line in raw.splitlines()[:150]:
        for piece in line.split(", <"):
            if 'rel="memento"' not in piece:continue
            match=re.search(r'<(https?://[^> ]+)>',piece)
            if not match:continue
            url=match.group(1)
            if urlparse(url).hostname not in ("archive.md","archive.ph","archive.is","archive.today"):continue
            date=""
            dm=re.search(r'datetime="([^"]+)"',piece)
            if dm:
                try:date=parsedate_to_datetime(dm.group(1)).date().isoformat()
                except Exception:pass
            found.append({"key":"archivetoday:"+url,
                          "type":"snapshot","kind":"archivo","platform":"Archive.today",
                          "title":"Captura de Instagram @"+handle+" en Archive.today",
                          "url":url,"date":date,
                          "note":"Captura publicada por Archive.today. La página puede ser un inicio de sesión; verificar que contiene fotos o vídeos antes de hablar de recuperación."})
    return found[:50]

def scan_deep_sources(handles):
    outcomes={}
    with ThreadPoolExecutor(max_workers=8) as pool:
        tasks={}
        for handle in handles:
            tasks[pool.submit(archive_today,handle)]="Archive.today · @"+handle
            tasks[pool.submit(arquivo_images,handle)]="Imágenes históricas · @"+handle
            tasks[pool.submit(arquivo_cdx,handle)]="CDX Arquivo.pt · @"+handle
            for ix in CC_INDEXES:
                tasks[pool.submit(commoncrawl_single,handle,ix)]="Common Crawl "+ix+" · @"+handle
        for future in as_completed(tasks):
            key=tasks[future]
            try:
                records=future.result()
                outcomes[key]={"status":"ok","count":len(records),"items":records}
            except Exception as exc:
                outcomes[key]={"status":"error","count":0,"items":[],"message":str(exc)[:150]}
    return outcomes
