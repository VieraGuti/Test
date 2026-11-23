"""No-secret/no-upload smoke tests against upstream generator's real selector."""
import json
import re
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "upstream"))
sys.path.insert(0, str(HERE))

from adapter import preview_highlights


class PreviewTests(unittest.TestCase):
    def test_short_video_ranks_and_deduplicates(self):
        transcript = {"duration": 300, "segments": [
            {"start": 10, "end": 30, "text": "¡No puede ser, se ha caído!"},
            {"start": 165, "end": 185, "text": "La reacción fue increíble"},
        ]}
        def fake_llm(prompt):
            if "Choose one: podcast" in prompt:
                return '{"content_type":"commentary","density":"medium"}'
            return json.dumps({"highlights": [
                {"title":"Reacción real","start_time":10,"end_time":40,"score":94,
                 "hook_sentence":"¡No puede ser!","virality_reason":"Sorpresa genuina"},
                {"title":"Duplicado","start_time":12,"end_time":38,"score":70,
                 "hook_sentence":"Se cayó","virality_reason":"Solapado"},
                {"title":"Muy largo","start_time":75,"end_time":175,"score":90,
                 "hook_sentence":"Demasiado","virality_reason":"Largo"},
                {"title":"Segundo","start_time":165,"end_time":205,"score":89,
                 "hook_sentence":"Qué locura","virality_reason":"Reacción"},
                {"title":"Inválido","start_time":-10,"end_time":5,"score":99}
            ]})
        result = preview_highlights(transcript, fake_llm, num_clips=3)
        self.assertEqual(result["mode"], "dry_run")
        self.assertEqual([h["title"] for h in result["highlights"]],
                         ["Reacción real", "Segundo"])
        self.assertEqual(result["rejected_count"], 1)
        self.assertEqual(result["uploaded_videos"], 0)

    def test_long_video_uses_relative_timestamps(self):
        transcript = {"duration": 3100, "segments": [
            {"start":15,"end":35,"text":"Primera reacción GTA VI"},
            {"start":1230,"end":1250,"text":"Discusión durante el directo"},
            {"start":2370,"end":2390,"text":"Fail inesperado"},
        ]}
        prompts = []
        def fake_llm(prompt):
            if "Choose one: podcast" in prompt:
                return '{"content_type":"commentary","density":"high"}'
            prompts.append(prompt)
            marks = re.findall(r"\[(\d+(?:\.\d+)?)s\]", prompt)
            self.assertTrue(marks, "Expected timestamped transcript")
            start = float(marks[0])
            self.assertLess(start, 1200, "Chunk timestamps must be local, not absolute")
            return json.dumps({"highlights":[{
                "title":"Directo", "start_time":start, "end_time":start+30,
                "score":90, "hook_sentence":"Reacción real",
                "virality_reason":"Momento inesperado"
            }]})
        result = preview_highlights(transcript, fake_llm, num_clips=3)
        self.assertEqual(len(prompts), 3)
        self.assertEqual(
            [round(h["start_time"]) for h in result["highlights"]],
            [15,1230,2370])
        self.assertEqual(result["uploaded_videos"], 0)

    def test_rejects_invalid_transcripts_without_llm_calls(self):
        calls = []
        def fake_llm(prompt):
            calls.append(prompt)
            return "{}"
        for invalid in [
            {"duration":0,"segments":[]},
            {"duration":90,"segments":[{"start":-1,"end":3,"text":"mal"}]},
            {"duration":float("inf"),"segments":[]},
        ]:
            with self.assertRaises(ValueError):
                preview_highlights(invalid, fake_llm)
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
