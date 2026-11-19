import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from thumbnail_engine import (_seconds,pick_diverse,Sample,
                              generate_thumbnails,WIDTH,HEIGHT)


class ThumbnailEngineTests(unittest.TestCase):
    def test_spread_across_video(self):
        seconds=_seconds(120,[
            {"startSeconds":0},{"startSeconds":30},
            {"startSeconds":60},{"startSeconds":90},
        ])
        self.assertGreaterEqual(len(seconds),14)
        self.assertTrue(all(0<t<120 for t in seconds))
        self.assertGreater(max(seconds)-min(seconds),90)

    def test_avoid_adjacent_lookalikes(self):
        samples=[Sample(12,90,Path('a')),Sample(12.5,89,Path('b')),
                 Sample(75,86,Path('c')),Sample(32,70,Path('d'))]
        result=pick_diverse(samples,2,120)
        self.assertEqual([x.second for x in result],[12,75])

    def test_english_and_russian_real_frames(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            for lang in ('en','ru'):
                video=root/f'{lang}-2026-11-19.mp4'
                subprocess.run([
                    'ffmpeg','-hide_banner','-loglevel','error','-nostdin','-y',
                    '-f','lavfi','-i','testsrc2=size=640x360:rate=12:duration=11',
                    '-f','lavfi','-i','sine=frequency=430:sample_rate=48000:duration=11',
                    '-c:v','libx264','-preset','ultrafast','-crf','27',
                    '-c:a','aac','-shortest',str(video)],check=True,timeout=50,capture_output=True)
                meta={'language':lang,'episode':1,
                      'title':'GTA VI moments',
                      'durationSeconds':11,'chapters':[{'startSeconds':0},{'startSeconds':5}]}
                result=generate_thumbnails(video,meta)
                self.assertEqual(result['status'],'ready')
                self.assertEqual(len(result['variants']),2)
                self.assertEqual(result['aiImageCostUsd'],0)
                self.assertLess(Path(result['thumbnailFile']).stat().st_size,2*1024*1024)
                for candidate in result['variants']:
                    with Image.open(candidate['file']) as im:
                        self.assertEqual(im.size,(WIDTH,HEIGHT))
                        self.assertEqual(im.format,'JPEG')
                second=generate_thumbnails(video,meta)
                self.assertEqual(result['generatedAt'],second['generatedAt'])


class ThumbnailUploadTests(unittest.TestCase):
    def test_uploader_does_not_repeat_success(self):
        from upload_compilation_from_drive import upload_or_repair_thumbnail
        with tempfile.TemporaryDirectory() as d:
            movie=Path(d)/'en-2026-11-19.mp4'
            movie.write_bytes(b'valid-enough-for-mock')
            thumb=movie.with_suffix('.thumbnail.jpg')
            thumb.write_bytes(b'\xff\xd8'+b'a'*15000)
            meta={'language':'en','episode':1}
            fake_manifest={'thumbnailFile':str(thumb),'selectedSourceSeconds':10}
            fake_reply=mock.MagicMock()
            fake_reply.__enter__.return_value.read.return_value=json.dumps({'items':[{'default':{}}]}).encode()
            with mock.patch('thumbnail_engine.generate_thumbnails',return_value=fake_manifest),\
                 mock.patch('upload_compilation_from_drive.call_bridge',return_value={'channelId':'UCCv7FqhV_k0asn-Ho8HiP5w','accessToken':'test-token'}),\
                 mock.patch('upload_compilation_from_drive.youtube_request',return_value=fake_reply) as request:
                one=upload_or_repair_thumbnail(movie,meta,'ZZpWyTVe5-A')
                two=upload_or_repair_thumbnail(movie,meta,'ZZpWyTVe5-A')
                self.assertEqual(one['status'],'uploaded')
                self.assertEqual(two['status'],'uploaded')
                self.assertEqual(request.call_count,1)
                self.assertIn('youtube/v3/thumbnails/set',request.call_args.args[0])


if __name__=='__main__':
    unittest.main(verbosity=2)
