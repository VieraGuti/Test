# GTA VI Viral Engine – AI Shorts generator experiment

Experimental branch only: `gta-vi-ai-shorts-trial`. This is **not enabled in production**.

## Objective

Evaluate the highlight-ranker from
[Anil-matcha/AI-Youtube-Shorts-Generator](https://github.com/Anil-matcha/AI-Youtube-Shorts-Generator)
against GTA VI Twitch/VOD transcripts **before** adding it to the live
Render/Vercel editing or publishing flows.

## What exists

- `adapter.py`: safe highlight preview on already-transcribed audio segments;
  returns candidate titles, scores and exact cut timestamps, no video encoding.
- `test_adapter.py`: checks candidate ranking, overlap suppression, excessive
  clip duration filtering, invalid transcript rejection and multi-chunk time offsets.
- `.github/workflows/ai-shorts-trial.yml`: runs tests using the upstream source
  pinned to commit `8c9ac3103a137e53669aeebfc2af8dbdd810c35a`;
  no secrets and no paid API calls.
- The source remains on GitHub; never copy provider keys to the repository.

## Running the isolated tests

From repository root (Python 3.12, Git required):

```bash
git clone --no-checkout https://github.com/Anil-matcha/AI-Youtube-Shorts-Generator.git gta-vi-cloud/experiments/ai-shorts/upstream
git -C gta-vi-cloud/experiments/ai-shorts/upstream fetch --depth 1 origin 8c9ac3103a137e53669aeebfc2af8dbdd810c35a
git -C gta-vi-cloud/experiments/ai-shorts/upstream checkout --detach FETCH_HEAD
python -m pip install -r gta-vi-cloud/experiments/ai-shorts/upstream/requirements.txt
python -m unittest discover -s gta-vi-cloud/experiments/ai-shorts -p 'test_adapter.py' -v
```

## Intentional limitations

- Does **not** download YouTube or Twitch sources, render a Short, change the live
  website, enable a Render worker, enqueue videos, or publish on YouTube.
- A real video A/B test must first be run on a licensed/authorized source,
  with a transcript produced by the existing `/api/ai-transcribe` step.
- The existing worker already processes short clips with `MAX_CLIP_SECONDS=40`
  by default; this experiment addresses **long-form source selection**.
- For long videos, upstream uses absolute transcript timestamps within local
  chunks, which can yield wrong offsets; adapter rebases them first.
- `llm_fn` must be explicitly supplied; the adapter never automatically falls
  back to MuAPI or a paid provider.
- CI mocks the LLM; it validates selection logic, **not quality or viral results**
  on actual videos. Record selection accuracy, false positives and runtime/cost
  before any real VOD integration. Keep editorial safety and upload approval.

## Proposed next stage after green CI

Connect an **opt-in**, authenticated preview endpoint that reads approved
time-aligned transcripts, reuses our Gemini/Groq backend, and compares candidate
timestamps side-by-side with the current selector. Keep `WORKER_ENABLED`,
`AUTO_PROCESS`, editorial holds and YouTube upload rules unchanged. Reuse FFmpeg
for the final crop rather than installing an additional heavy local crop stack.

## Ejecutado realmente en Render (23 nov 2026)

**Servicio de prueba, sin credenciales, autoDeploy desactivado:** https://gta-vi-ai-shorts-smoke-2026.onrender.com

- 7 tests automáticos pasados durante la compilación: selector/dedupe/offsets + validador editorial.
- Entrada: **vídeo sintético de FFmpeg**, 33 segundos, NO imagen de GTA VI ni de un streamer.
- LLM de prueba simulado: propone y clasifica un fragmento 8.0–20.0s sin llamadas API.
- Se ejecutó la función **original** `shorts_generator.local.clipper.crop_highlights_local` (OpenCV + FFmpeg), que generó el primer MP4 vertical con audio.
- Problema real descubierto: OpenCV 5.1.0 no trae `cv2.CascadeClassifier` usado por el paquete. Solucionado fijando `opencv-python-headless==4.13.0.92`.
- Otra limitación confirmada: el MP4 bruto del original salió a 202x360 MPEG-4 para una fuente sintética de 640x360. Se añadió una exportación final H.264 + AAC 720x1280; **reescalar no recupera detalle que la fuente no tiene**.
- **Resultado confirmado en logs `AI_SHORTS_SMOKE_RESULT`**: `ok=true`, `generated_mp4s=1`, `duration_seconds=12.01`, `resolution=720x1280`, `video_codec=h264`, `audio_codec=aac`, `size_bytes=1042040`.
- Enlace de prueba: https://gta-vi-ai-shorts-smoke-2026.onrender.com/demo/short_final.mp4
- Informe JSON: https://gta-vi-ai-shorts-smoke-2026.onrender.com/report

**Lo que NO demuestra:** que el LLM detecte momentos virales correctamente en clips reales, que el vídeo resultante tenga calidad editorial suficiente, ni que YouTube lo distribuya o monetice. No se ha probado con metraje ajeno ni se ha publicado a YouTube.

## Filtro editorial adicional

`quality_gate.py` y `test_quality_gate.py` revisan títulos de la lista real del usuario. Bloquean títulos colgantes como `Kai Cenat Reacts ... in | GTA VI` y un etiquetado como GTA VI sin verificación del contexto visual. El filtro experimental no modifica todavía la publicación automática existente.

## Integración recomendada

Probar siguiente A/B con un vídeo real cuyo uso esté autorizado: transcripción propia → detección de momentos del upstream → filtro de contexto de GTA VI → nuestro FFmpeg/subtítulos → vídeo privado para revisión → solo publicación aprobada. Para diagnosticar visualizaciones 0, usar las métricas YouTube Studio `Shown in feed` y `Viewed vs swiped away`, no deducir la causa solo por el contador público.
