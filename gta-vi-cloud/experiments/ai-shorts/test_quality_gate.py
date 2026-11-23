import unittest
from quality_gate import evaluate_title

class QualityGateTests(unittest.TestCase):
    def test_dangling_titles_from_real_queue(self):
        for title in (
            "KaiCenat: Kai Cenat Reacts to Dice Roll in | GTA VI",
            "drupy876: Push, Ping, Ping Strategy for | GTA VI",
            "Rubius reacciona a la locura de | GTA VI",
            "ohnePixel: Lost in | GTA VI",
        ):
            with self.subTest(title=title):
                result=evaluate_title(title,game_verified=True)
                self.assertFalse(result["ok"])
                self.assertIn("dangling_preposition",result["reasons"])
    def test_unverified_game_cannot_be_injected(self):
        res=evaluate_title("xQc's Coffee Mishap During Stream | GTA VI")
        self.assertFalse(res["ok"])
        self.assertIn("gta_context_unverified",res["reasons"])
    def test_source_verified_specific_title_can_pass(self):
        result=evaluate_title("Rubius escapa de una persecución policial en GTA VI",game_verified=True)
        self.assertTrue(result["ok"])
    def test_truncated_title_does_not_pass(self):
        self.assertFalse(evaluate_title("IShowSpeed Reacts: Don’t stop the rain...")["ok"])

if __name__=="__main__":
    unittest.main()
