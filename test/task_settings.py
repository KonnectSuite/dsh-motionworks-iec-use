import sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'code'/'engine'))
from motionworks_iec_mcp.tasks import parse_task_settings
class Settings(unittest.TestCase):
    def test_empty_field_does_not_consume_next_line(self):
        s=parse_task_settings('TASK Smoke\n(TYPE := CYCLIC,\nWATCHDOG_DISPLAY := \nWATCHDOG_ENABLED := YES\n);')
        self.assertEqual(s.fields,{'TYPE':'CYCLIC','WATCHDOG_DISPLAY':'','WATCHDOG_ENABLED':'YES'})
        self.assertTrue(s.watchdog_enabled)
    def test_duplicates_still_warn(self):
        s=parse_task_settings('TASK Smoke\n(TYPE := CYCLIC,\nTYPE := SYSTEM\n);')
        self.assertEqual(s.type,'CYCLIC')
        self.assertTrue(s.warnings)
if __name__=='__main__':unittest.main()
