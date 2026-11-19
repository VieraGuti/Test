"""Conservative source-backed title fallback for the Shorts queue.

Never invent gameplay context when transcription or visual AI is unavailable.
Only reuse a descriptive title already supplied with the actual Twitch clip.
Explicit adult themes are held for human review instead of published.
"""
import re

ADULT_TITLE=re.compile(
    r'\b(?:strip\s*club|private\s*dance|horny|gooner|nude|nudity|naked|topless|'
    r'porn|sex(?:ual)?\s+scene|adult\s+club|голая|голый|порно|'
    r'desnud[oa]s?|desnud[oa]s|er[oó]tic[oa]|sexo\s+expl[ií]cito)\b', re.I)
GENERIC=re.compile(
    r'^(?:clip|wtf|what[!?]*|omg|lol|lmao|haha|'
    r'no\s*way|unbelievable|banned|insane|crazy|'
    r'what\s+is\s+this|this\s+is\s+wild|'
    r'what\s+just\s+happened|un\s+momento|'
    r'no\s+puede\s+ser)[!? .]*$', re.I)
SPAM=re.compile(r'(https?://|discord\.gg/|#\w+|subscribe\s+to|t\.me/)', re.I)

def clean(value):
    s=re.sub(r'[\x00-\x1f\x7f-\x9f]+',' ',str(value or ''))
    s=re.sub(r'\s+',' ',s).strip(' .|-')
    return s[:100]

def hold_for_adult_title(job):
    clip=(job.get('clips') or [{}])[0]
    return bool(ADULT_TITLE.search(clean(clip.get('title') or job.get('sourceTitle') or '')))

def title_from_clip_source(job):
    """Returns an explicitly attributed title only when source metadata is descriptive."""
    clip=(job.get('clips') or [{}])[0]
    # Do not use job['title'] because it may already be generated/rewritten by AI.
    source=clean(clip.get('title') or clip.get('sourceTitle') or job.get('sourceTitle'))
    if not source or GENERIC.fullmatch(source) or SPAM.search(source) or ADULT_TITLE.search(source):
        return None
    if len(source)<17 or len(source.split())<4:
        return None
    creator=clean(clip.get('creator') or job.get('creator') or 'Streamer')
    creator=re.sub(r'[^a-zA-Z0-9_\-.\u00c0-\u024f\u0400-\u052f]+','',creator)[:25] or 'Streamer'
    if source.casefold().startswith(creator.casefold()):
        out=source
    else:
        out=creator+': '+source
    return out[:95].rstrip(' |:-')
