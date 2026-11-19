import datetime as dt
import tempfile
import unittest
from pathlib import Path
from daily_compilations import (
 plan_by_language,apply_result,select,MIN_SECONDS,MAX_SECONDS,TARGET_SECONDS,
 copy_compatible,fps_value,
 cleanup_after_confirmed_upload,
)
DAY=dt.date(2026,11,19)
def clip(i,lang,creator='Streamer',score=70,duration=80):
 created=dt.datetime(2026,11,19,3,0,tzinfo=dt.timezone.utc)+dt.timedelta(minutes=i*3)
 return {'id':f'{lang}-{i}','language':lang,'creator':creator,'score':score,'views':1000+i,
   'createdAt':created.isoformat(),'rights':'approved','approvedForCompilation':True,
   'gameVerified':True,'mediaPath':f'/tmp/source-{i}.mp4','duration':duration,
   'title':f'Event number {i} wow'}
def samples(lang,first=0,count=40):
 return [clip(i,lang,creator=f'creator-{i%12}') for i in range(first,first+count)]
class DigestTests(unittest.TestCase):
 def test_language_split_and_duration(self):
  cs=samples('es')+samples('en')+samples('ru')
  plans=plan_by_language(cs,{},DAY,['es','en','ru'])
  self.assertEqual({p['language'] for p in plans},{'es','en','ru'})
  self.assertEqual(len(plans),3)
  self.assertTrue(all(p['episode']==1 for p in plans))
  self.assertTrue(all(MIN_SECONDS<=p['plannedSeconds']<=MAX_SECONDS for p in plans))
  self.assertTrue(all(len(p['clips'])>8 for p in plans))
 def test_minimum_15_minutes_not_created_from_few_clips(self):
  self.assertEqual(plan_by_language(samples('es',count=10),{},DAY,['es']),[])
 def test_maximum_never_exceeds_30_minutes(self):
  cs=samples('es',count=100)
  selected=select(cs,'es',DAY,set())
  duration=sum(x['duration'] for x in selected)
  self.assertGreaterEqual(duration,MIN_SECONDS)
  self.assertLessEqual(duration,MAX_SECONDS)
  self.assertLessEqual(abs(TARGET_SECONDS-duration),80)
 def test_keep_rights_flag_without_blocking_draft(self):
  cs=samples('en')
  cs[-1]['rights']='unverified'  # highest-viewed clip, guaranteed to be considered
  plans=plan_by_language(cs,{},DAY,['en'])
  self.assertEqual(len(plans),1)
  self.assertTrue(any(x['rights']=='unverified' for x in plans[0]['unverifiedSources']))
 def test_reject_mismatched_game(self):
  cs=samples('en')
  cs[0]['gameVerified']=False
  plan=plan_by_language(cs,{},DAY,['en'])[0]
  self.assertNotIn(cs[0]['id'],plan['clipIds'])
 def test_flag_unverified_game_category(self):
  cs=samples('es')
  for c in cs:
   c.pop('gameVerified')
   c['gameCategoryMatched']=True
  self.assertTrue(plan_by_language(cs,{},DAY,['es'])[0]['categoryReviewNeeded'])
 def test_prevent_reused_clips_and_next_episode(self):
  one=samples('en')
  p1=plan_by_language(one,{},DAY,['en'])[0]
  state=apply_result({},p1)
  self.assertEqual(plan_by_language(one,state,DAY,['en']),[])
  two=samples('en',first=50)
  p2=plan_by_language(two,state,DAY+dt.timedelta(days=1),['en'])[0]
  self.assertEqual(p2['episode'],2)
  self.assertTrue(p2['title'].endswith('#2'))
  self.assertTrue(set(p1['clipIds']).isdisjoint(p2['clipIds']))
 def test_repeat_same_moment_avoided(self):
  cs=samples('es',count=40)
  cs[1]['creator']=cs[0]['creator']
  cs[1]['createdAt']=cs[0]['createdAt']
  selected=select(cs,'es',DAY,set())
  self.assertFalse(cs[0]['id'] in {x['id'] for x in selected} and cs[1]['id'] in {x['id'] for x in selected})
 def test_not_delete_before_youtube_verification(self):
  with tempfile.TemporaryDirectory() as d:
   file=Path(d)/'es-2026-11-19.mp4'
   file.write_bytes(b'sample')
   file.with_suffix('.json').write_text('{}')
   meta={'id':'es-2026-11-19','outputFile':str(file)}
   with self.assertRaises(ValueError):cleanup_after_confirmed_upload(meta,'123456789ab',{})
   self.assertTrue(file.exists())
   with self.assertRaises(ValueError):cleanup_after_confirmed_upload(meta,'123456789ab',{'platform':'youtube','id':'WRONG'})
   self.assertTrue(file.exists())
   result=cleanup_after_confirmed_upload(meta,'123456789ab',{'platform':'youtube','id':'123456789ab','uploadStatus':'processed'})
   self.assertTrue(result['deletedMp4'])
   self.assertFalse(file.exists())
   self.assertFalse(file.with_suffix('.json').exists())
 def test_no_double_episode_registration(self):
  p=plan_by_language(samples('ru'),{},DAY,['ru'])[0]
  state=apply_result({},p)
  with self.assertRaises(ValueError):apply_result(state,p)
 def test_native_stream_copy_requires_matching_video_and_audio(self):
  base={'video':'h264','audio':'aac','width':1280,'height':720,'fps':'60/1',
       'pix_fmt':'yuv420p','sample_rate':'48000','channels':2}
  self.assertTrue(copy_compatible(base,dict(base)))
  self.assertFalse(copy_compatible({**base,'width':1920},base))
  self.assertFalse(copy_compatible({**base,'audio':'opus'},base))
  self.assertFalse(copy_compatible({**base,'fps':'30/1'},base))
  self.assertEqual(fps_value(base),60)
  self.assertEqual(fps_value({**base,'fps':'30000/1001'}),30)
if __name__=='__main__':unittest.main()
