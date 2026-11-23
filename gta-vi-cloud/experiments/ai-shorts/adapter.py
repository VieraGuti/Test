"""Experimental adapter for Anil-matcha/AI-Youtube-Shorts-Generator.

Reads time-aligned transcripts, ranks viral candidates and returns timestamps.
NO downloading, rendering, uploads, background jobs or API usage by itself.
An injected llm_fn is required in the experiment so live keys cannot be spent
accidentally. This file is not imported by the production worker.
"""
from __future__ import annotations

import math
from typing import Callable, Dict, Optional

from shorts_generator import highlights as upstream


def _validate_transcript(data: Dict) -> Dict:
    if not isinstance(data, dict):
        raise ValueError("transcript_must_be_object")
    try:
        duration = float(data.get("duration", 0))
    except (ValueError, TypeError):
        raise ValueError("invalid_duration") from None
    if not math.isfinite(duration) or duration <= 0 or duration > 21600:
        raise ValueError("invalid_duration")
    segments = data.get("segments")
    if not isinstance(segments, list) or not segments or len(segments) > 15000:
        raise ValueError("invalid_segments")
    cleaned = []
    for s in segments:
        if not isinstance(s, dict):
            continue
        try:
            start, end = float(s["start"]), float(s["end"])
        except (KeyError, TypeError, ValueError):
            continue
        text = str(s.get("text") or "").strip()[:500]
        if all(map(math.isfinite, (start, end))) and 0 <= start < end <= duration and text:
            cleaned.append({"start": start, "end": end, "text": text})
    cleaned.sort(key=lambda s: (s["start"], s["end"]))
    if not cleaned:
        raise ValueError("no_valid_segments")
    return {"duration": duration, "segments": cleaned}


def preview_highlights(transcript: Dict, llm_fn: Callable[[str], str], num_clips: int = 3,
                       max_clip_seconds: int = 70) -> Dict:
    """Pure preview; never creates a video or publishes anything.

    Fixes upstream's long-video timestamp offset issue by rebasing each chunk's
    transcript timestamps BEFORE asking the model for local clip coordinates.
    """
    if not callable(llm_fn):
        raise ValueError("llm_callable_required")
    if not isinstance(num_clips, int) or not 1 <= num_clips <= 8:
        raise ValueError("invalid_num_clips")
    clean = _validate_transcript(transcript)
    duration = clean["duration"]
    if duration < upstream.LONG_VIDEO_THRESHOLD:
        raw = upstream.get_highlights(clean, num_clips=num_clips, llm_fn=llm_fn)["highlights"]
    else:
        info = upstream.detect_content_type(clean, llm_fn=llm_fn)
        raw = []
        for chunk in upstream.chunk_transcript(clean):
            offset = float(chunk["_offset"])
            local_chunk = dict(chunk)
            local_chunk["segments"] = [
                {**s, "start": max(0.0, s["start"] - offset),
                 "end": min(float(chunk["duration"]), s["end"] - offset)}
                for s in chunk["segments"]
                if offset <= s["start"] < s["end"] <= offset + float(chunk["duration"])
            ]
            if not local_chunk["segments"]:
                continue
            local_text = upstream.build_transcript_text(local_chunk)
            found = upstream.call_highlight_api(
                local_text, info, float(chunk["duration"]), num_clips,
                is_chunk=True, llm_fn=llm_fn,
            )["highlights"]
            for item in found:
                converted = dict(item)
                converted["start_time"] += offset
                converted["end_time"] += offset
                raw.append(converted)
        raw = upstream.dedupe_highlights(raw)

    filtered = [
        c for c in raw
        if 10 <= float(c["end_time"]) - float(c["start_time"]) <= max_clip_seconds
        and 0 <= float(c["start_time"]) < float(c["end_time"]) <= duration
    ]
    filtered.sort(key=lambda c: c["score"], reverse=True)
    return {"mode": "dry_run", "source_duration": duration,
            "highlights": filtered[:num_clips],
            "rejected_count": len(raw) - len(filtered),
            "generated_mp4s": 0, "uploaded_videos": 0}
