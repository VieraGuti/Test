"""Grounded creator labels and adaptive Shorts caption placement."""
import subprocess
import tempfile
import unittest
from pathlib import Path

from video_branding import (
    clean_creator,short_positions,short_credit_tags,short_caption_tags,
    ass_timestamp,longform_ass,burn_longform_credits,video_dimensions
)


class BrandingTests(unittest.TestCase):
    def test_sanitizes_creator_without_affecting_language(self):
        self.assertEqual(clean_creator(' {Boss}\\\n СТРИМЕР '),'Boss СТРИМЕР')
        self.assertEqual(clean_creator('  @IlloJuan  '),'IlloJuan')
        self.assertEqual(clean_creator(''),'')

    def test_short_caption_just_below_wide_clip(self):
        p=short_positions(720,1280,1920,1080)
        self.assertGreater(p['caption_y'],p['clip_bottom']+50)
        self.assertLess(p['caption_y'],1020)
        self.assertLess(p['credit_y'],p['clip_bottom'])
        self.assertIn(r'\move',short_credit_tags(p))
        self.assertIn(r'\pos',short_caption_tags(p))

    def test_short_vertical_clip_keeps_text_onscreen(self):
        p=short_positions(720,1280,1080,1920)
        self.assertLess(p['caption_y'],1210)
        self.assertLess(p['credit_y'],1280)
        self.assertGreater(p['clip_bottom'],1000)

    def test_longform_uses_real_chapters(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'credits.ass'
            count=longform_ass(path,[
                {'startSeconds':0,'creator':'StreamerA'},
                {'startSeconds':2,'creator':'Стример Б'},
                {'startSeconds':4,'creator':'{invalid}\n@User'}
            ],6,1280,720)
            data=path.read_text()
            self.assertEqual(count,3)
            self.assertIn('StreamerA',data)
            self.assertIn('Стример Б',data)
            self.assertNotIn('{invalid}',data)
            self.assertIn(r'\move',data)
            self.assertIn(r'\fad',data)

    def test_render_real_ass_in_short_clip(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            src=root/'source.mp4'
            subprocess.run(['ffmpeg','-hide_banner','-v','error','-nostdin','-y',
                '-f','lavfi','-i','testsrc2=size=640x360:rate=30:duration=2',
                '-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=2',
                '-c:v','libx264','-preset','ultrafast','-crf','28',
                '-c:a','aac','-t','2',str(src)],capture_output=True,text=True,
                check=True,timeout=50)
            width,height=video_dimensions(src)
            self.assertEqual((width,height),(640,360))
            result=burn_longform_credits(src,[
                {'startSeconds':0,'creator':'IlloJuan'},
                {'startSeconds':1,'creator':'TheRandomReel'}
            ],2,timeout=90)
            self.assertTrue(result['branded'])
            dest=Path(result['outputFile'])
            self.assertGreater(dest.stat().st_size,5000)
            self.assertEqual(video_dimensions(dest),(640,360))
            checked=subprocess.run(['ffmpeg','-v','error','-i',str(dest),
                '-f','null','-'],capture_output=True,text=True,timeout=30)
            self.assertEqual(checked.returncode,0,checked.stderr)


if __name__=='__main__':
    unittest.main()
