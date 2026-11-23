"""Regression test: marketing query strings must not break report or preview routes."""
import unittest
from unittest.mock import Mock
from render_demo import Handler, STATE

class RouteTests(unittest.TestCase):
    def test_report_accepts_tracking_params(self):
        fake=Mock()
        fake.path="/report?utm_source=chatgpt.com&utm_medium=referral"
        Handler.do_GET(fake)
        fake.send_json.assert_called_once_with(STATE)

    def test_health_accepts_tracking_params(self):
        fake=Mock()
        fake.path="/health?utm_source=chatgpt.com"
        Handler.do_GET(fake)
        fake.send_json.assert_called_once()
        self.assertEqual(fake.send_json.call_args.args[0]["ok"],True)

    def test_unrecognized_report_like_path_remains_404(self):
        fake=Mock()
        fake.path="/report-fake?utm_source=chatgpt.com"
        Handler.do_GET(fake)
        fake.send_json.assert_called_once_with({"error":"not_found"},404)

if __name__=="__main__":
    unittest.main()
