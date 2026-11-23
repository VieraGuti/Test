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
