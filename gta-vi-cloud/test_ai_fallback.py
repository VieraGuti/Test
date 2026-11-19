"""AI provider failover tests. Never bypass a moderation refusal."""
import unittest
from unittest.mock import patch
import cloud


class VisualReviewFallbackTests(unittest.TestCase):
 def test_primary_success_skips_fallback(self):
  with patch.object(cloud,'api',return_value={'ok':True,'provider':'gemini','adultPossible':False}) as request:
   got=cloud.request_visual_review({'frames':['abc','xyz']})
  self.assertEqual(got['provider'],'gemini')
  self.assertEqual(request.call_count,1)

 def test_gemini_503_uses_openrouter(self):
  with patch.object(cloud,'api',side_effect=[
   RuntimeError('backend_503: gemini_503_UNAVAILABLE'),
   {'ok':True,'provider':'openrouter','confidence':'medium','adultPossible':True}
  ]) as request:
   got=cloud.request_visual_review({'frames':['abc','xyz']})
  self.assertEqual(request.call_count,2)
  self.assertEqual(request.call_args.args[1],'/api/ai-visual-story-fallback')
  self.assertTrue(got['adultPossible'])

 def test_moderation_refusal_does_not_failover(self):
  with patch.object(cloud,'api',return_value={'ok':False,'adultPossible':True,'error':'content_hold'}) as request:
   got=cloud.request_visual_review({'frames':['abc','xyz']})
  self.assertEqual(request.call_count,1)
  self.assertTrue(got['adultPossible'])

 def test_non_provider_error_does_not_failover(self):
  with patch.object(cloud,'api',return_value={'ok':False,'error':'unsupported_gameplay_content'}) as request:
   got=cloud.request_visual_review({'frames':['abc','xyz']})
  self.assertEqual(request.call_count,1)
  self.assertIsNone(got)

 def test_both_providers_down_fail_closed(self):
  with patch.object(cloud,'api',side_effect=[RuntimeError('backend_503'),RuntimeError('backend_503')]) as request:
   got=cloud.request_visual_review({'frames':['abc','xyz']})
  self.assertEqual(request.call_count,2)
  self.assertIsNone(got)


if __name__=='__main__':
 unittest.main()
