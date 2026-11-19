"""Local and optional S3 media vault for Young Class Archive.
Files are stored behind same-origin URLs. Import only material you own or may host.
S3/R2-compatible storage is optional, configured with YC_S3_* variables.
"""
from __future__ import annotations
import hashlib
import hmac
import io
import json
import mimetypes
import os
import re
import shutil
import tempfile
import threading
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

ROOT = Path(os.getenv("YC_MEDIA_DIR", "/tmp/young-class-media"))
ADMIN_TOKEN = os.getenv("YC_ADMIN_TOKEN", "")
LIMIT = 160 * 1024 * 1024
MAX_ZIP_FILES = 1200
MAX_UNPACKED = 450 * 1024 * 1024
EXTENSIONS = {
    ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".png":"image/png",
    ".webp":"image/webp", ".gif":"image/gif", ".mp4":"video/mp4",
    ".mov":"video/quicktime", ".m4v":"video/x-m4v", ".webm":"video/webm",
    ".mp3":"audio/mpeg", ".wav":"audio/wav", ".m4a":"audio/mp4",
    ".ogg":"audio/ogg", ".flac":"audio/flac", ".pdf":"application/pdf",
    ".txt":"text/plain"
}
ALL_KINDS = ("foto","video","audio","documento")
MUTEX = threading.RLock()

def utcnow():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")

def authorized(given):
    return bool(ADMIN_TOKEN) and hmac.compare_digest(given or "", ADMIN_TOKEN)

def safe_name(value):
    value = str(value or "").replace("\\","/").split("/")[-1]
    value = "".join(c for c in value if c.isprintable() and c not in "<>\"'&")
    return (value[:170] or "archivo").strip() or "archivo"

def kind_of(mime):
    if mime.startswith("image/"): return "foto"
    if mime.startswith("video/"): return "video"
    if mime.startswith("audio/"): return "audio"
    return "documento"

def type_ok(filepath, mime):
    with open(filepath, "rb") as handle:
        magic = handle.read(16)
    if mime == "image/jpeg": return magic.startswith(b"\xff\xd8\xff")
    if mime == "image/png": return magic.startswith(b"\x89PNG\r\n\x1a\n")
    if mime == "image/webp": return magic[:4] == b"RIFF" and magic[8:12] == b"WEBP"
    if mime == "image/gif": return magic[:6] in (b"GIF87a", b"GIF89a")
    if mime == "video/mp4" or mime == "video/quicktime" or mime == "video/x-m4v" or mime == "audio/mp4": return b"ftyp" in magic[:12]
    if mime == "video/webm": return magic.startswith(b"\x1a\x45\xdf\xa3")
    if mime == "audio/mpeg": return magic.startswith(b"ID3") or (len(magic)>1 and magic[0] == 0xff and magic[1]&0xe0 == 0xe0)
    if mime == "audio/wav": return magic.startswith(b"RIFF") and magic[8:12] == b"WAVE"
    if mime == "audio/ogg": return magic.startswith(b"OggS")
    if mime == "audio/flac": return magic.startswith(b"fLaC")
    if mime == "application/pdf": return magic.startswith(b"%PDF")
    if mime == "text/plain": return b"\0" not in magic
    return False

class Vault:
    def __init__(self):
        ROOT.mkdir(parents=True, exist_ok=True)
        self.endpoint = os.getenv("YC_S3_ENDPOINT", "").strip()
        self.bucket = os.getenv("YC_S3_BUCKET", "").strip()
        self.client = None
        if self.bucket:
            try:
                import boto3
                args = {
                    "aws_access_key_id": os.environ["YC_S3_ACCESS_KEY"],
                    "aws_secret_access_key": os.environ["YC_S3_SECRET_KEY"],
                    "region_name": os.getenv("YC_S3_REGION", "auto"),
                }
                if self.endpoint: args["endpoint_url"] = self.endpoint
                self.client = boto3.client("s3", **args)
            except (ImportError, KeyError) as exc:
                print("[VAULT] S3 not configured: "+str(exc), flush=True)
        self.local_index = ROOT / "catalog.json"
        self._entries = None
    def is_persistent(self):
        return self.client is not None
    def get_entries(self):
        with MUTEX:
            if self._entries is None:
                if self.client:
                    try:
                        obj = self.client.get_object(Bucket=self.bucket, Key="meta/catalog.json")
                        self._entries = json.loads(obj["Body"].read(2_000_000))
                    except self.client.exceptions.NoSuchKey:
                        self._entries = []
                    except Exception as e:
                        if "NoSuchKey" in str(e) or "404" in str(e):
                            self._entries = []
                        else:
                            raise
                else:
                    try: self._entries = json.loads(self.local_index.read_text(encoding="utf-8"))
                    except (FileNotFoundError, ValueError): self._entries = []
            return list(self._entries)
    def save_entries(self, entries):
        raw = json.dumps(entries, ensure_ascii=False, indent=2).encode("utf-8")
        if len(raw)>2_000_000: raise ValueError("Índice demasiado grande")
        if self.client:
            self.client.put_object(Bucket=self.bucket,Key="meta/catalog.json",Body=raw,ContentType="application/json")
        else:
            dst=self.local_index.with_suffix(".tmp")
            dst.write_bytes(raw)
            dst.replace(self.local_index)
        self._entries = entries
    def add_file(self, filepath, filename, category=None, source="Archivo aportado con permiso", album="Importaciones"):
        filename = safe_name(filename)
        ext = Path(filename).suffix.lower()
        mime = EXTENSIONS.get(ext)
        if not mime: raise ValueError("Tipo no admitido: "+ext)
        size = Path(filepath).stat().st_size
        if size < 1 or size > LIMIT: raise ValueError("Archivo vacío o demasiado grande")
        if not type_ok(filepath,mime): raise ValueError("Los bytes no corresponden al formato declarado")
        sha=hashlib.sha256()
        with open(filepath,"rb") as f:
            for block in iter(lambda:f.read(1024*1024),b""): sha.update(block)
        digest=sha.hexdigest()
        obj_key="files/"+digest+ext
        category=category if category in ALL_KINDS else kind_of(mime)
        with MUTEX:
            rows=self.get_entries()
            for row in rows:
                if row["sha256"] == digest: return row,False
            if self.client:
                self.client.upload_file(str(filepath),self.bucket,obj_key,ExtraArgs={"ContentType":mime})
            else:
                dest=ROOT/(digest+ext)
                shutil.copyfile(filepath,dest)
            row={"id":digest+ext,"sha256":digest,"filename":filename,
                 "mime":mime,"kind":category,"size":size,"date":utcnow(),
                 "source":str(source or "Archivo autorizado")[:180], "album":str(album)[:70]}
            rows.insert(0,row)
            self.save_entries(rows)
            return row,True
    def get(self,file_id):
        if not re.fullmatch(r"[a-f0-9]{64}\.[a-z0-9]{2,5}",file_id):return None
        return next((x for x in self.get_entries() if x["id"]==file_id),None)
    def open_file(self,row,range_header=None):
        if self.client:
            args={"Bucket":self.bucket,"Key":"files/"+row["id"]}
            if range_header and re.fullmatch(r"bytes=\d+-\d*",range_header):
                args["Range"]=range_header
            result=self.client.get_object(**args)
            return result["Body"],int(result["ContentLength"]),result.get("ContentRange")
        path=ROOT/row["id"]
        size=path.stat().st_size
        f=open(path,"rb")
        if range_header:
            match=re.fullmatch(r"bytes=(\d+)-(\d*)",range_header)
            if match:
                start=int(match[1]);end=int(match[2]) if match[2] else size-1
                if 0<=start<=end<size:
                    f.seek(start)
                    return f,end-start+1,f"bytes {start}-{end}/{size}"
        return f,size,None
    def import_archive(self,source_zip):
        if not zipfile.is_zipfile(source_zip):raise ValueError("No es un ZIP válido")
        saved=[];rejected=0;unpacked=0
        with zipfile.ZipFile(source_zip) as archive:
            files=archive.infolist()
            if len(files)>MAX_ZIP_FILES:raise ValueError("ZIP con demasiadas entradas")
            for entry in files:
                if entry.is_dir() or entry.flag_bits & 0x1: continue
                normalized=entry.filename.replace("\\","/")
                if normalized.startswith("/") or ".." in normalized.split("/"): rejected+=1;continue
                name=safe_name(normalized)
                ext=Path(name).suffix.lower()
                # Never turn a private Instagram export or direct-message attachment public by accident.
                lower_path=normalized.lower()
                private_parts=('messages/','inbox/','direct/','private/','contacts/','message_requests/','chat/')
                if ext not in EXTENSIONS or ext in ('.txt','.pdf') or any(part in lower_path for part in private_parts):
                    rejected+=1
                    continue
                if entry.file_size<=0 or entry.file_size>LIMIT:rejected+=1;continue
                unpacked+=entry.file_size
                if unpacked>MAX_UNPACKED:raise ValueError("ZIP supera tamaño descomprimido permitido")
                if entry.compress_size and entry.file_size > 150*entry.compress_size:
                    rejected+=1;continue
                with tempfile.NamedTemporaryFile(prefix="yc-extract-",delete=False) as tmp:
                    temp=Path(tmp.name)
                    with archive.open(entry) as fd:
                        shutil.copyfileobj(fd,tmp,length=1024*1024)
                try:
                    lower_path=normalized.lower()
                    album=("Historias Instagram" if "stor" in lower_path or "histori" in lower_path else "Publicaciones Instagram" if "post" in lower_path or "publication" in lower_path else "Reels Instagram" if "reel" in lower_path else "Archivo importado")
                    row,created=self.add_file(temp,name,source="Importación de archivo Instagram/propietario · "+normalized[:100],album=album)
                    if created:saved.append(row)
                except (ValueError,OSError):rejected+=1
                finally:temp.unlink(missing_ok=True)
        return {"imported":len(saved),"rejected":rejected,"items":saved[:25]}
    def create_bulk_zip(self):
        rows=self.get_entries()
        if not rows: raise ValueError("No hay archivos")
        if len(rows)>700 or sum(x["size"] for x in rows)>500*1024*1024:
            raise ValueError("Biblioteca demasiado grande para descarga ZIP; descarga los archivos individualmente")
        tmp=tempfile.NamedTemporaryFile(prefix="yc-bulk-",suffix=".zip",delete=False)
        result=Path(tmp.name)
        tmp.close()
        try:
            with zipfile.ZipFile(result,"w",compression=zipfile.ZIP_STORED,allowZip64=True) as output:
                for x in rows:
                    source,length,_=self.open_file(x)
                    filename=x["id"][:9]+"_"+safe_name(x["filename"])
                    with source, output.open(filename,"w",force_zip64=True) as dst:
                        remaining=length
                        while remaining>0:
                            block=source.read(min(1024*1024,remaining))
                            if not block:raise ValueError("Archivo incompleto")
                            dst.write(block)
                            remaining-=len(block)
            return result
        except Exception:
            result.unlink(missing_ok=True)
            raise

    def import_stream(self,stream,length,filename):
        if not length or length>LIMIT:raise ValueError("El archivo supera el límite de 160 MB")
        with tempfile.NamedTemporaryFile(prefix="yc-upload-",delete=False) as tmp:
            path=Path(tmp.name);remaining=length
            while remaining:
                part=stream.read(min(65536,remaining))
                if not part:raise ValueError("Subida interrumpida")
                tmp.write(part);remaining-=len(part)
        try:
            if filename.lower().endswith(".zip"):return self.import_archive(path)
            row,created=self.add_file(path,filename)
            return {"imported":int(created),"rejected":0,"items":[row]}
        finally:path.unlink(missing_ok=True)

vault=Vault()
