"""Assigned-POU deletion counts: no customer source required."""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'code' / 'engine'))
from motionworks_iec_mcp import pou_writer as writer
from motionworks_iec_mcp.tree import TreeNode


def node(name, identifier, level, count, line):
    return TreeNode(identifier, count, (identifier, level, count, 0), name, '', line,
                    start_line=line - 1, end_line=line + 8)


class DeletionCounts(unittest.TestCase):
    def plan(self, assignments):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root/'src.st1').write_bytes(b'mock')
            project = node('Project', 0, 0, 30, 3)
            logical = node('Logical POUs', 1, 1, 8, 15)
            gone = node('Gone', 2, 2, 3, 26)
            hardware = node('Physical Hardware', 6, 1, 10, 70)
            config = node('Configuration', 7, 2, 9, 80)
            resource = node('Resource', 8, 3, 8, 90)
            tasks = node('Tasks', 9, 4, 7, 100)
            task = node('SlowTsk', 10, 5, assignments, 110)
            task.children = [node('Gone', 11+i, 6, 0, 120+10*i) for i in range(assignments)]
            document = Mock()
            document.lines = [''] * 180
            document.lines[1] = '31'
            document.roots = [project]
            document.walk_with_ancestors.return_value = [
                (project, []), (logical, [project]), (gone, [project, logical]),
                (hardware, [project, logical]),
                (config, [project, logical, hardware]),
                (resource, [project, logical, hardware, config]),
                (tasks, [project, logical, hardware, config, resource]),
                (task, [project, logical, hardware, config, resource, tasks]),
            ]
            with patch.object(writer, 'parse_document', return_value=document), \
                 patch('motionworks_iec_mcp.cfb.CompoundFile'), \
                 patch.object(writer, '_pou_container', return_value=gone), \
                 patch.object(writer, 'is_pou_container', return_value=True), \
                 patch.object(writer, 'find_pou_references', return_value=[]):
                plan = writer.plan_pou_deletion(root, 'Gone')
            return plan, {span[0]: replacement[0] for span, replacement in plan.count_edits}

    def test_unassigned_removes_exactly_four_nodes(self):
        plan, edits = self.plan(0)
        self.assertEqual(plan.total_after, 27)
        self.assertEqual(edits[3], '0 0 26 0')
        self.assertNotIn(70, edits)

    def test_assigned_removes_instance_and_all_physical_counts(self):
        plan, edits = self.plan(1)
        self.assertEqual(plan.total_after, 26)
        self.assertEqual(edits[3], '0 0 25 0')
        self.assertEqual(edits[15], '1 1 4 0')
        for line, expected in [(70, 9), (80, 8), (90, 7), (100, 6), (110, 0)]:
            self.assertEqual(int(edits[line].split()[2]), expected)

    def test_multiple_instances_aggregate_each_count_once(self):
        plan, edits = self.plan(2)
        self.assertEqual(plan.total_after, 25)
        self.assertEqual(edits[70], '6 1 8 0')
        self.assertEqual(edits[110], '10 5 0 0')
        self.assertEqual(len(plan.count_edits), 7)


if __name__ == '__main__': unittest.main()
