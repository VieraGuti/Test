import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import fast_compilations as fast


def sample_spec(codec='hevc',width=1280,height=720,fps='60000/1001'):
 return {
  'video':codec,'audio':'aac','width':width,'height':height,
  'fps':fps,'pix_fmt':'yuv420p','sample_rate':'48000','channels':2
 }


class FastCompilationsTests(unittest.TestCase):
 def test_hevc_stream_copy_supported(self):
  self.assertEqual(fast.format_key(sample_spec('hevc'))[0],'hevc')
  self.assertEqual(fast.format_key(sample_spec('h264'))[0],'h264')
  self.assertEqual(fast.format_key(sample_spec('hevc',fps='60/1'))[4],60)

 def test_incompatible_formats_are_not_mixed(self):
  self.assertNotEqual(fast.format_key(sample_spec('h264')),
                      fast.format_key(sample_spec('hevc')))
  self.assertNotEqual(fast.format_key(sample_spec('hevc',width=1920)),
                      fast.format_key(sample_spec('hevc')))
  self.assertIsNone(fast.format_key(sample_spec('vp9')))
  self.assertIsNone(fast.format_key(sample_spec('hevc',width=2560)))

 def test_majority_wins(self):
  a=sample_spec('hevc',1920,1080)
  b=sample_spec('h264',1280,720)
  key=fast.choose_primary([(a,22),(a,30),(b,80)])
  self.assertEqual(key,fast.format_key(a))

 def test_rejects_invalid_stream(self):
  self.assertIsNone(fast.choose_primary([(sample_spec('vp9'),20)]))
  self.assertIsNone(fast.format_key({}))

 def test_concat_real_mp4_without_reencoding(self):
  if shutil.which('ffmpeg') is None:
   self.skipTest('ffmpeg unavailable')
  with tempfile.TemporaryDirectory(prefix='test-fast-') as folder:
   root=Path(folder)
   source=root/'clip0.mp4'
   command=[
    'ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y',
    '-f','lavfi','-i','color=c=blue:s=640x360:r=30:d=2',
    '-f','lavfi','-i','sine=frequency=400:sample_rate=48000:duration=2',
    '-map','0:v:0','-map','1:a:0','-t','2',
    '-c:v','libx264','-preset','ultrafast','-crf','30','-pix_fmt','yuv420p',
    '-c:a','aac','-ac','2','-ar','48000',str(source)]
   subprocess.run(command,check=True,capture_output=True,timeout=40)
   clips=[]
   for i in range(3):
    path=root/('clip%d.mp4'%i)
    if i:shutil.copyfile(source,path)
    clips.append({'id':'clip-%d'%i,'creator':'Streamer %d'%i,
                  'mediaPath':str(path),'duration':2,'rights':'approved'})
   plan={'id':'en-test','day':'2026-11-19','language':'en','episode':1,
         'title':'Best GTA VI Clips | #1','clips':clips,'clipIds':[c['id'] for c in clips]}
   out=root/'render'
   with patch.object(fast,'MIN_SECONDS',3),patch.object(fast,'TARGET_SECONDS',5),patch.object(fast,'MAX_SECONDS',10):
    meta=fast.render_fast_plan(plan,out)
   self.assertEqual(meta['renderMethod'],'direct_hevc_h264_stream_copy')
   self.assertEqual(len(meta['chapters']),3)
   self.assertGreater(meta['durationSeconds'],5)
   self.assertLess(meta['durationSeconds'],8)
   self.assertTrue(Path(meta['outputFile']).is_file())
   probe=subprocess.run(['ffmpeg','-v','error','-i',meta['outputFile'],
                         '-f','null','-'],capture_output=True,text=True,timeout=30)
   self.assertEqual(probe.returncode,0,probe.stderr[-300:])
   self.assertFalse(meta['copyrightReviewNeeded'])
   self.assertEqual(meta['clipIds'],[c['id'] for c in clips])


if __name__=='__main__':
 unittest.main()
