# Young Class Archive

A no-login, public-archive research dashboard for the historical Instagram identity `@youngclasstlc`.

## What it can recover

- Public Wayback Machine **profile web-page captures** recorded while online (may only show login screens).
- Arquivo.pt archival mentions and page snapshots.
- Internet Archive candidate files (require manual validation).
- Existing official video references as evidence of the artist's username.
- A traceable, exportable catalog showing original source links, timestamps and evidence type.

## What it cannot recover

- Deleted or expired Instagram Stories that no one archived while public.
- Private account archives without the account owner's login/official Instagram export.
- Content behind login, access controls or rate limits.

**IMPORTANT:** an archived *webpage* is not synonymous with a recovered *story*; the dashboard counts recovered stories as 0 unless actual playable story media has been verified and deliberately added. API failures are distinct from zero results.

## Local run

```bash
PORT=10000 python app.py
```

Open http://localhost:10000, then click **Buscar archivos**. The main web page is served without dependencies. `/api/state`, `/export.json`, `/export.csv` and `/health` are provided.

## Render

Use `render.yaml` or create a free Python web service pointed at this repository/branch. Build command: `echo no-build`; start command: `python app.py`; health check: `/health`; set `TARGET_HANDLES=youngclasstlc` (comma-separated if other usernames are verified). Set data storage through `ARCHIVE_DATA_PATH` if a persistent disk is provisioned. On free Render services `/tmp` is ephemeral; export your findings periodically.

## Boundaries

Uses public APIs from web.archive.org, arquivo.pt and archive.org. Does not scrape Instagram, Instarchiver or arbitrary URLs; does not attempt account access or bypass gates. Respect copyright and the artist's wishes before republishing media. No credentials required.

## Biblioteca de archivos y recuperación de Instagram

El panel en / permite importar ficheros propios y ZIP obtenidos de "Exportar tu información" de Meta. Las fotografías, historias y vídeos originales del ZIP se extraen dentro de una biblioteca con previsualizaciones y enlaces de descarga al mismo dominio bajo /media/ID.

- Acceso a importaciones: variable de Render YC_ADMIN_TOKEN. Introducirla solo en el formulario de administrador (no compartir públicamente).
- Descarga ZIP de la biblioteca: /media/all.zip.
- Estado y listado de archivos: /api/media.
- Admite imágenes JPG/PNG/WEBP/GIF, vídeos MP4/MOV/M4V/WEBM y audios MP3/WAV/M4A/OGG/FLAC.
- Se ignoran adjuntos de mensajes privados, contactos y textos de los ZIP de exportación, para evitar publicación accidental de información privada.
- Los ficheros duplicados se deduplican por SHA-256.

IMPORTANTE: el plan Free de Render **no es almacenamiento permanente**. Sin servicio externo se usan archivos de /tmp; se perderán con reinicios/deploys. No subas la única copia. Para persistir, añade almacenamiento S3 compatible, como Cloudflare R2, y define:
YC_S3_BUCKET, YC_S3_ENDPOINT, YC_S3_REGION, YC_S3_ACCESS_KEY, YC_S3_SECRET_KEY.
Además instala boto3 en el entorno de compilación. El contenido seguirá descargándose bajo el mismo dominio de esta web.

La importación no significa recuperar archivos borrados de Instagram: Instaloader solamente sirve con contenido que siga accesible, incluyendo publicaciones, Reels y destacadas. Esta herramienta busca capturas archivadas y cataloga pistas; no puede restaurar historias si no existe una copia en ningún servidor, dispositivo ni archivo.
