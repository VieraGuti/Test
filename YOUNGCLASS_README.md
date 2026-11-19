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