"""Groq final MP4 storyboard review is independent from upload state."""
import base64
import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import cloud

class StoryboardTests(unittest.TestCase):
 def make_video(self,path):
  p=path/'final.mp4'
  p.write_bytes(b'video-bytes-for-unit-test'*120)
  return p
 def fake_ffmpeg(self,cmd_args,limit=45):
  output=Path(cmd_args[-1])
  for n in range(2):
   output.with_name(output.name.replace('%02d',f'{n:02d}')).write_bytes(b'jpeg-'*100)
 def test_verified_report_carries_digest_and_consecutive_storyboards(self):
  with tempfile.TemporaryDirectory() as d:
   path=Path(d)
   video=self.make_video(path)
   with patch.object(cloud,'duration',return_value=30),patch.object(cloud,'cmd',side_effect=self.fake_ffmpeg),patch.object(cloud,'api',return_value={'ok':True,'reviewSaved':True,'storyboardCount':2,'confidence':0.88,'uncertainSafety':False}) as call:
    ok=cloud.submit_groq_storyboard({'jobId':'a'*40,'title':'Verified gameplay','creator':'Streamer'},video,'spoken context',path)
   self.assertTrue(ok)
   self.assertEqual(call.call_args.args[:2],('POST','/api/shorts-groq-report'))
   body=call.call_args.kwargs['json']
   self.assertEqual(body['sha256'],hashlib.sha256(video.read_bytes()).hexdigest())
   self.assertEqual(len(body['storyboards']),2)
   self.assertEqual(body['transcript'],'spoken context')
   self.assertEqual(base64.b64decode(body['storyboards'][0]),b'jpeg-'*100)
 def test_short_15_second_video_uses_two_contact_sheets(self):
  with tempfile.TemporaryDirectory() as d:
   path=Path(d)
   video=self.make_video(path)
   with patch.object(cloud,'duration',return_value=15.9),patch.object(cloud,'cmd',side_effect=self.fake_ffmpeg) as encoder,patch.object(cloud,'api',return_value={'ok':True,'reviewSaved':True,'storyboardCount':2,'confidence':0.85,'uncertainSafety':False}) as report:
    self.assertTrue(cloud.submit_groq_storyboard({'jobId':'c'*40},video,'',path))
   self.assertIn('fps=1,scale=180:-2,tile=4x2',encoder.call_args.args[0])
   self.assertEqual(len(report.call_args.kwargs['json']['storyboards']),2)
 def test_provider_failure_does_not_fail_upload(self):
  with tempfile.TemporaryDirectory() as d:
   path=Path(d)
   video=self.make_video(path)
   with patch.object(cloud,'duration',return_value=30),patch.object(cloud,'cmd',side_effect=self.fake_ffmpeg),patch.object(cloud,'api',side_effect=RuntimeError('groq_429')):
    ok=cloud.submit_groq_storyboard({'jobId':'b'*40},video,'',path)
   self.assertFalse(ok)
 def test_long_video_cannot_be_approved_using_incomplete_samples(self):
  with tempfile.TemporaryDirectory() as d:
   path=Path(d)
   video=self.make_video(path)
   with patch.object(cloud,'duration',return_value=70),patch.object(cloud,'api') as api:
    self.assertFalse(cloud.submit_groq_storyboard({'jobId':'b'*40},video,'',path))
    api.assert_not_called()

if __name__=='__main__':
 unittest.main()
