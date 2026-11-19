import datetime as dt
import tempfile
import unittest
from pathlib import Path
from daily_compilations import plan_by_language, apply_result, select, TITLE_TEMPLATES

DAY=dt.date(2026,11,19)
def clip(i,lang,creator='Streamer',score=70):
 return {'id':f'{lang}-{i}','language':lang,'creator':creator,'score':score,'views':1000+i,
   'createdAt':'2026-11-19T05:00:00Z','rights':'approved','approvedForCompilation':True,
   'gameVerified':True,'mediaPath':f'/tmp/source-{i}.mp4','duration':25}
class DigestsTest(unittest.TestCase):
 def test_language_split_titles(self):
  cs=[clip(i,'es') for i in range(4)]+[clip(i,'en') for i in range(4)]+[clip(i,'ru') for i in range(4)]
  ps=plan_by_language(cs,{},DAY,['es','en','ru'])
  self.assertEqual({p['language'] for p in ps},{'es','en','ru'})
  self.assertEqual(len(ps),3)
  self.assertTrue(all(p['episode']==1 for p in ps))
  self.assertIn('Mejores clips',ps[0]['title'])
 def test_preserve_unverified_rights_in_private_draft(self):
  cs=[clip(i,'en') for i in range(3)]
  cs[0]['rights']='unverified';cs[0]['approvedForCompilation']=None
  plans=plan_by_language(cs,{},DAY,['en'])
  self.assertEqual(len(plans),1)
  self.assertEqual(plans[0]['unverifiedSources'][0]['id'],'en-0')
 def test_reject_mismatched_game(self):
  cs=[clip(i,'en') for i in range(3)]
  cs[1]['gameVerified']=False
  self.assertEqual(plan_by_language(cs,{},DAY,['en']),[])
 def test_category_match_creates_review_flag(self):
  cs=[clip(i,'es') for i in range(3)]
  for c in cs:
   c.pop('gameVerified');c['gameCategoryMatched']=True
  plans=plan_by_language(cs,{},DAY,['es'])
  self.assertTrue(plans[0]['categoryReviewNeeded'])
 def test_skip_same_day_and_avoid_reused_clips(self):
  cs=[clip(i,'es',creator=str(i)) for i in range(8)]
  p=plan_by_language(cs,{},DAY,['es'])[0]
  new_state=apply_result({},p)
  self.assertEqual(plan_by_language(cs,new_state,DAY,['es']),[])
  nxt=plan_by_language(cs,new_state,DAY+dt.timedelta(days=1),['es'])
  self.assertEqual(nxt,[])
 def test_episodes_increment_when_new_clips_exist(self):
  cs=[clip(i,'en',creator=str(i)) for i in range(4)]
  p=plan_by_language(cs,{},DAY,['en'])[0]
  state=apply_result({},p)
  others=[clip(i+10,'en',creator=str(i)) for i in range(4)]
  ps=plan_by_language(others,state,DAY+dt.timedelta(days=1),['en'])
  self.assertEqual(ps[0]['episode'],2)
  self.assertTrue(ps[0]['title'].endswith('#2'))
 def test_creator_cap(self):
  cs=[clip(i,'es',creator='one') for i in range(12)]
  self.assertEqual(len(select(cs,'es',DAY,set())),3)
 def test_duplicate_episode(self):
  p=plan_by_language([clip(i,'ru') for i in range(4)],{},DAY,['ru'])[0]
  state=apply_result({},p)
  with self.assertRaises(ValueError):apply_result(state,p)
if __name__=='__main__':unittest.main()
