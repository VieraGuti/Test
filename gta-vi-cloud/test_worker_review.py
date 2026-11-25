"""Regression tests: publication review never clobbers active video rendering."""
import unittest
from unittest.mock import patch
import cloud


class PublicationReviewTests(unittest.TestCase):
    def setUp(self):
        self.previous = dict(cloud.state)

    def tearDown(self):
        cloud.state.clear()
        cloud.state.update(self.previous)

    def test_success_preserves_render_worker_state(self):
        cloud.state.update(status='working', error=None)
        with patch.object(cloud, 'api', return_value={
            'action': 'published', 'videoId': 'example', 'reason': 'review_passed'
        }) as api:
            cloud.release_once()
        api.assert_called_once_with('POST', '/api/shorts-release', json={})
        self.assertEqual(cloud.state['status'], 'working')
        self.assertEqual(cloud.state['reviewStatus'], 'published')
        self.assertIsNone(cloud.state['reviewError'])
        self.assertEqual(cloud.state['lastReview']['videoId'], 'example')

    def test_review_error_does_not_fail_rendering(self):
        cloud.state.update(status='working', error=None)
        with patch.object(cloud, 'api', side_effect=RuntimeError('temporary_backend_503')):
            cloud.release_once()
        self.assertEqual(cloud.state['status'], 'working')
        self.assertIsNone(cloud.state['error'])
        self.assertEqual(cloud.state['reviewStatus'], 'review_failed')
        self.assertIn('503', cloud.state['reviewError'])



class FreshPolicyTests(unittest.TestCase):
    def test_fresh_source_requires_authoritative_feed_timestamp_and_language(self):
        now=1795596300
        fresh={'id':'clip','url':'https://clips.twitch.tv/example','createdAt':'2026-11-25T08:00:00Z','language':'es'}
        self.assertEqual(cloud.validate_source({'id':'clip'},[fresh],now),fresh)
        for row in [{**fresh,'createdAt':'2026-11-23T08:00:00Z'},{**fresh,'language':'ja'},{**fresh,'createdAt':None}]:
            with self.assertRaises(RuntimeError):cloud.validate_source({'id':'clip'},[row],now)
        with self.assertRaises(RuntimeError):cloud.validate_source({'id':'missing'},[fresh],now)
    def test_caption_glyphs_and_language(self):
        self.assertEqual(cloud.language_code('Spanish'),'es')
        self.assertEqual(cloud.language_code('en-US'),'en')
        self.assertEqual(cloud.latin_text('¡Qué pasó! 日本語'), '¡Qué pasó!')
        self.assertNotIn('□',cloud.latin_text('□ Hola'))

if __name__ == '__main__':
    unittest.main()
