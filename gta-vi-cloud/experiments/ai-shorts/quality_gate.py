"""Conservative editorial guard for candidate titles (experiment only).

Use verified, contextual labels to avoid broken GTA VI titles on The Random Reel.
This module is deliberately NOT wired to the publishing API.
"""
from __future__ import annotations

import re
from typing import Dict

GAME = re.compile(r"\b(?:GTA\s*(?:VI|6)|Grand\s+Theft\s+Auto\s*(?:VI|6))\b", re.I)
DANGLING = re.compile(
    r"\b(?:in|en|de|for|with|during|into|on|at|dans|im|sur|no|na|в|на)\s*(?:\|\s*)?"
    r"(?:GTA\s*(?:VI|6)|Grand\s+Theft\s+Auto\s*(?:VI|6))\s*$",
    re.I,
)
BAD_END = re.compile(r"\b(?:in|en|de|for|with|during|into|on|at|dans|im|sur|no|na)\s*$",re.I)
ELLIPSIS = re.compile(r"(?:…|\.\.\.)\s*$")
SPAM = re.compile(r"https?://|#(?:shorts|viral)|\b(?:subscribe|follow me)\b",re.I)

def evaluate_title(title:str, *, game_verified:bool=False) -> Dict:
    """Return editorial reasons; model score never overrides these checks.

    game_verified MUST be passed explicitly from grounded source/visual evidence,
    never guessed from a video title that already contains an AI-inserted label.
    """
    title=re.sub(r"\s+"," ",str(title or "")).strip()
    reasons=[]
    if not 15 <= len(title) <= 95:
        reasons.append("length_out_of_range")
    if DANGLING.search(title) or BAD_END.search(title):
        reasons.append("dangling_preposition")
    if ELLIPSIS.search(title):
        reasons.append("truncated_title")
    if SPAM.search(title):
        reasons.append("promotional_or_generic")
    if GAME.search(title) and not game_verified:
        reasons.append("gta_context_unverified")
    if title.count("|")>1:
        reasons.append("separator_spam")
    return {"ok":not reasons,"reasons":reasons,"title":title,
            "next_step":"manual_review" if reasons else "editorial_review"}

