"""Test Groq vision first, Gemini fallback, and respect safety refusal."""
import unittest
from unittest.mock import patch
import cloud

class VisualReviewFallbackTests(unittest.TestCase):
 def test_groq_success_skips_other_providers(self):
  with patch.object(cloud,'api',return_value={'ok':True,'provider':'groq','adultPossible':False}) as request:
   got=cloud.request_visual_review({'frames':['a','b']})
  self.assertEqual(got['provider'],'groq')
  self.assertEqual(request.call_count,1)
  self.assertEqual(request.call_args.args[1],'/api/ai-visual-story-groq')
 def test_groq_503_uses_gemini(self):
  with patch.object(cloud,'api',side_effect=[
   RuntimeError('backend_503: groq temporarily unavailable'),
   {'ok':True,'provider':'gemini','confidence':'medium','adultPossible':False}
  ]) as request:
   got=cloud.request_visual_review({'frames':['a','b']})
  self.assertEqual(request.call_count,2)
  self.assertEqual(request.call_args.args[1],'/api/ai-visual-story')
  self.assertFalse(got['adultPossible'])
 def test_moderation_hold_stops_fallback(self):
  with patch.object(cloud,'api',return_value={'ok':False,'adultPossible':True,'error':'content_hold'}) as request:
   got=cloud.request_visual_review({'frames':['a','b']})
  self.assertEqual(request.call_count,1)
  self.assertTrue(got['adultPossible'])
 def test_non_transient_error_stops_fallback(self):
  with patch.object(cloud,'api',return_value={'ok':False,'error':'unsupported_content'}) as request:
   got=cloud.request_visual_review({'frames':['a','b']})
  self.assertEqual(request.call_count,1)
  self.assertIsNone(got)
 def test_both_unavailable_fail_closed(self):
  with patch.object(cloud,'api',side_effect=[RuntimeError('backend_503'),RuntimeError('backend_503')]) as request:
   got=cloud.request_visual_review({'frames':['a','b']})
  self.assertEqual(request.call_count,2)
  self.assertIsNone(got)

if __name__=='__main__':
 unittest.main()
