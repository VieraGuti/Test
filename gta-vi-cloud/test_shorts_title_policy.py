import unittest
from shorts_title_policy import title_from_clip_source,hold_for_adult_title

class Titles(unittest.TestCase):
 def test_descriptive_existing_clip(self):
  title=title_from_clip_source({'creator':'xQc','clips':[{'title':'xQc gets into a high-speed police chase on his first run'}]})
  self.assertIn('police chase',title)
 def test_generic_title_does_not_publish(self):
  self.assertIsNone(title_from_clip_source({'creator':'Zoil','clips':[{'title':'WHAT?!'}]}))
 def test_no_ai_invention(self):
  self.assertIsNone(title_from_clip_source({'title':'AI GENERATED EPIC TITLE','clips':[{'title':'wtf'}]}))
 def test_adult_source_held(self):
  clip={'clips':[{'title':'ohnePixel tries out the strip club private dance'}]}
  self.assertTrue(hold_for_adult_title(clip))
  self.assertIsNone(title_from_clip_source(clip))
 def test_creator_sanitized(self):
  title=title_from_clip_source({'creator':'Streamer🟢','clips':[{'title':'An unexpected police chase starts after an accident'}]})
  self.assertTrue(title.startswith('Streamer:'))
if __name__=='__main__':unittest.main()
