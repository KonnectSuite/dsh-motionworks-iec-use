"""Workspace guard regression tests; temporary files only, no IDE calls."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'code' / 'engine'))
from motionworks_iec_mcp import staging, writer, restore


class WorkspaceBoundary(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='mw-engine-')
        self.root = Path(self.temp.name)
        self.ws = self.root / 'workspace'
        self.stage = self.ws / '.motionworks' / 'stage'
        self.project = self.stage / 'Machine'
        self.project.mkdir(parents=True)
        self.record = {
            'workspace': str(self.ws), 'source': str(self.ws / 'Machine.mwt'),
            'source_directory': str(self.ws / 'Machine'),
            'staged_mwt': str(self.stage / 'Machine.mwt'),
            'staged_directory': str(self.project),
        }
        self.identity = self.stage / 'Machine.identity.json'
        self.identity.write_text(json.dumps(self.record))
        self.env = patch.dict(os.environ, {
            'MOTIONWORKS_MCP_WORKSPACE': str(self.ws),
            'MOTIONWORKS_MCP_STAGE': str(self.stage),
        })
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def test_current_workspace_accepted(self):
        self.assertEqual(staging.assert_proven(self.project), self.project.resolve())

    def test_missing_workspace_refused(self):
        os.environ.pop('MOTIONWORKS_MCP_WORKSPACE')
        with self.assertRaises(staging.StagingRefused):
            staging.assert_proven(self.project)

    def test_other_workspace_refused(self):
        os.environ['MOTIONWORKS_MCP_WORKSPACE'] = str(self.root / 'other')
        os.environ.pop('MOTIONWORKS_MCP_STAGE')
        with self.assertRaises(staging.StagingRefused):
            staging.assert_proven(self.project)

    def test_stage_override_cannot_escape(self):
        os.environ['MOTIONWORKS_MCP_STAGE'] = str(self.root / 'shared-stage')
        with self.assertRaises(staging.StagingRefused):
            staging.staging_root()

    def test_foreign_provenance_refused(self):
        for key in ['workspace', 'source', 'source_directory', 'staged_mwt', 'staged_directory']:
            with self.subTest(key=key):
                self.identity.write_text(json.dumps({**self.record, key: str(self.root / 'outside')}))
                with self.assertRaises(staging.StagingRefused):
                    staging.assert_proven(self.project)

    def test_direct_writers_refuse_foreign_project_before_ide_or_file_access(self):
        with patch.object(writer, 'require_ide_closed') as gate:
            with self.assertRaises(staging.StagingRefused):
                writer._apply(None, self.root / 'outside')
            gate.assert_not_called()
        with self.assertRaises(staging.StagingRefused):
            restore.restore_pou(self.root / 'outside', 'P', dry_run=False)


if __name__ == '__main__':
    unittest.main()
