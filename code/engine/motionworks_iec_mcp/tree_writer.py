"""Structural edits to the project tree: assigning and unassigning program instances.

This is the first write path into ``PROJECT.TRE``.  It exists on top of the
round-trip guarantee in :mod:`motionworks_iec_mcp.tree`: the parser reproduces the
stream byte-for-byte and its record spans tile the source, so an edit can be
expressed as a splice at known line numbers rather than as a re-serialisation that
might quietly reorder records.

**Task assignment was chosen as the first structural write deliberately.** It adds
or removes one program-instance child under an existing task and moves a handful
of counts.  It needs no new POU folder, no worksheet records and no library
updates -- so if the count bookkeeping is wrong, it is wrong in the simplest
possible case.

What an edit has to keep consistent, all established from real trees:

* a task node is 10 lines plus 10 per assigned instance, and instances are its
  children;
* ``params[1]`` is the node's **type/level**: 0 Project, 1 Libraries/POUs, 3
  Configuration, 4 Resource, 5 ``Tasks``, 6 a task, 7 a program instance;
* ``params[2]`` is the child count and must rise or fall with the instance;
* every ancestor's ``params[2]`` moves too, and line 1 holds the project total;
* the node id in ``params[0]`` is unique and the header total equals the number
  of nodes, so a new instance takes the next id and increments the total.

Assignments are also recorded in ``NODES.LST`` (project root and resource
directory where present), matching the proven case study.

None of this can be compile-verified in this environment -- the IDE does not load
projects -- so every edit re-parses its own output and checks the invariants, and
:mod:`motionworks_iec_mcp.writer` refuses to write while MotionWorks is running.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from pathlib import Path

from .errors import IdeRunning, MotionWorksError, NotFound, VerificationFailed
from .tree import TreeDocument, TreeNode, parse_document

#: Node levels, read off real trees.  ``Project`` is 0, ``Configuration`` 3,
#: ``Resource`` 4, ``Tasks`` and the sibling containers 4, a task 5, and a program
#: instance 6.  An instance therefore sits exactly one level below its task.
LEVEL_TASKS_CONTAINER = 4
LEVEL_TASK = 5
LEVEL_INSTANCE = 6

#: ``params[2]`` is the node's **descendant** count, not its direct child count.
#: Measured: it equals the true descendant count on 266 of 273 nodes across the
#: five sample projects.  The seven exceptions are exactly the expandable POU and
#: function-block containers (``Logical POUs``, ``Tasks``, ``RK_FunctionBlocks``),
#: which under-report by precisely the number of program instances beneath them.
#:
#: The practical consequence for an edit is that a *program instance* does not
#: move the intermediate container counts.  Only the owning task and the project
#: root change.  Bumping every ancestor was an earlier mistake here; the proven
#: case study bumps exactly these two, so that is what this module does.
COUNT_MOVES_ON_INSTANCE_EDIT = ("task", "root")

#: Lines a program-instance record occupies.  Nine, not ten: the blank line that
#: separates records already exists before the following node, and a parser-derived
#: span stops at that separator -- so treating the record as ten lines makes insert
#: and remove disagree by one, which the verification catches.
INSTANCE_LINES = 9

#: The resource task cycle field carried by instance records.
DEFAULT_CYCLE = "CYCLIC"

#: Node-list file locations, project root first.
NODE_LIST_PATHS = (
    "NODES.LST",
    "C/Configuration/R/Resource/NODES.LST",
    "C/Resource/R/Resource/NODES.LST",
)


class TreeWriteRefused(MotionWorksError):
    """The requested structural edit was refused before writing."""


def guid_line() -> str:
    """Format a fresh GUID the way the tree stores one.

    Reproduces the proven case study: the first three groups are emitted
    little-endian as ``.NET`` does for a GUID's ``ToByteArray``, the rest are
    plain bytes.  Matching that layout matters because MotionWorks compares these
    values.
    """
    raw = uuid.uuid4().bytes_le
    return (
        f"{int.from_bytes(raw[0:4], 'little'):08X} "
        f"{int.from_bytes(raw[4:6], 'little'):04X} "
        f"{int.from_bytes(raw[6:8], 'little'):04X} "
        + " ".join(f"{byte:02X}" for byte in raw[8:])
    )


@dataclass
class AssignmentPlan:
    """A planned task assignment or unassignment."""

    task_name: str
    program_name: str
    assign: bool
    #: The instance block to insert (assign only).
    instance_lines: list[str] = field(default_factory=list)
    #: Line index the instance is inserted at (assign only).
    insert_at: int = 0
    #: ``(span, replacement)`` pairs for the count fields that move.
    count_edits: list[tuple[tuple[int, int], list[str]]] = field(default_factory=list)
    #: Header total before and after.
    total_before: int = 0
    total_after: int = 0
    new_node_id: int = 0
    instance_span: tuple[int, int] = (0, 0)
    notes: list[str] = field(default_factory=list)

    def summary(self) -> str:
        verb = "assign" if self.assign else "unassign"
        lines = [
            f"{verb.upper()} {self.program_name} "
            f"{'to' if self.assign else 'from'} task {self.task_name}",
        ]
        if self.assign:
            lines.append(
                f"  new instance at line {self.insert_at} "
                f"({len(self.instance_lines)} lines), node id {self.new_node_id}"
            )
        else:
            lines.append(
                f"  removing instances at lines "
                f"{self.instance_span[0]}-{self.instance_span[1]}"
            )
        lines.append(f"  node total {self.total_before} -> {self.total_after}")
        lines.append(f"  fields updated: {len(self.count_edits)}")
        for note in self.notes:
            lines.append(f"  note: {note}")
        return "\n".join(lines)


def _task_nodes(document: TreeDocument) -> list[TreeNode]:
    return [
        node
        for node, _ in document.walk_with_ancestors()
        if node.params[1] == LEVEL_TASK
    ]


def find_task(document: TreeDocument, task_name: str) -> TreeNode:
    """Locate a task node by name, case-insensitively."""
    matches = [
        node for node in _task_nodes(document)
        if node.name.lower() == task_name.lower()
    ]
    if not matches:
        available = ", ".join(sorted(node.name for node in _task_nodes(document)))
        raise NotFound(
            f"no task named {task_name!r} in the project tree. Available: {available}"
        )
    if len(matches) > 1:
        raise TreeWriteRefused(f"task name {task_name!r} is ambiguous")
    return matches[0]


def instance_of(task: TreeNode, program_name: str) -> TreeNode | None:
    """The assignment of ``program_name`` under ``task``, if any."""
    for child in task.children:
        if child.name.lower() == program_name.lower():
            return child
    return None


def _next_node_id(document: TreeDocument) -> int:
    return max((node.node_id for node, _ in document.walk_with_ancestors()), default=0) + 1


def _count_line_edit(node: TreeNode, new_count: int) -> tuple[tuple[int, int], list[str]]:
    """Edit a node's params line to carry a new child count."""
    params = list(node.params)
    params[2] = new_count
    return ((node.line, node.line + 1), [" ".join(str(value) for value in params)])


def _instance_block(
    program_name: str,
    node_id: int,
    cycle: str,
    controller: str,
) -> list[str]:
    """Build the 9-line program-instance record.

    Field order mirrors an existing instance exactly: count, params, name,
    ``name\\teCLR\\t<controller>\\t<cycle>\\t-1``, a blank, a state line, a blank,
    a fresh GUID and a trailing state line.  The blank that separates it from the
    next record is not part of the block.
    """
    return [
        str(node_id - 1),
        f"{node_id} {LEVEL_INSTANCE} 0 0",
        f"{program_name}\t0\t0\t",
        f"{program_name}\teCLR\t{controller}\t{cycle}\t-1\t",
        "",
        "0\t-1\t0\t0\t0\t0\t0\t0\t0",
        "",
        guid_line(),
        "0\t0\t0\t0\t0\t0\t0\t0\t0\t0",
    ]


def plan_assign(
    document: TreeDocument,
    task_name: str,
    program_name: str,
    *,
    cycle: str = DEFAULT_CYCLE,
    controller: str = "MP2600iec",
) -> AssignmentPlan:
    """Plan assigning ``program_name`` to ``task_name``."""
    task = find_task(document, task_name)
    if instance_of(task, program_name) is not None:
        raise TreeWriteRefused(
            f"{program_name!r} is already assigned to task {task.name!r}"
        )

    total_before = int(document.lines[1])
    new_node_id = _next_node_id(document)

    plan = AssignmentPlan(
        task_name=task.name,
        program_name=program_name,
        assign=True,
        instance_lines=_instance_block(program_name, new_node_id, cycle, controller),
        insert_at=task.end_line,
        total_before=total_before,
        total_after=total_before + 1,
        new_node_id=new_node_id,
    )

    # Only the owning task and the project root move; see
    # COUNT_MOVES_ON_INSTANCE_EDIT.  The task's field counts its instances and the
    # root's counts the whole project.  Intermediate containers are deliberately
    # left alone: because their fields under-report program instances, they do not
    # track this edit, and the proven case study changes exactly these two.
    plan.count_edits.append(_count_line_edit(task, task.params[2] + 1))
    ancestors = next(
        chain for node, chain in document.walk_with_ancestors() if node is task
    )
    for ancestor in ancestors:
        if ancestor is document.roots[0]:
            plan.count_edits.append(
                _count_line_edit(ancestor, ancestor.params[2] + 1)
            )

    plan.notes.append(
        f"cycle {cycle} on {controller}, taken from the task's own assignment style"
    )
    return plan


def plan_unassign(
    document: TreeDocument, task_name: str, program_name: str
) -> AssignmentPlan:
    """Plan removing ``program_name`` from ``task_name``."""
    task = find_task(document, task_name)
    instance = instance_of(task, program_name)
    if instance is None:
        raise NotFound(
            f"{program_name!r} is not assigned to task {task.name!r}"
        )

    total_before = int(document.lines[1])
    plan = AssignmentPlan(
        task_name=task.name,
        program_name=instance.name,
        assign=False,
        total_before=total_before,
        total_after=max(0, total_before - 1),
        instance_span=instance.span,
    )

    # Mirror plan_assign: the task and the root move, nothing in between.
    plan.count_edits.append(_count_line_edit(task, max(0, task.params[2] - 1)))
    ancestors = next(
        chain for node, chain in document.walk_with_ancestors() if node is task
    )
    for ancestor in ancestors:
        if ancestor is document.roots[0]:
            plan.count_edits.append(
                _count_line_edit(ancestor, max(0, ancestor.params[2] - 1))
            )
    return plan


def render(document: TreeDocument, plan: AssignmentPlan) -> str:
    """Produce the edited tree text for a plan, without writing anything."""
    edits: list[tuple[int, int, list[str]]] = []

    if plan.assign:
        edits.append((plan.insert_at, plan.insert_at, plan.instance_lines))
    else:
        start, end = plan.instance_span
        edits.append((start, end, []))

    for span, replacement in plan.count_edits:
        edits.append((span[0], span[1], replacement))

    # The header total moves with the node count.
    edits.append((1, 2, [str(plan.total_after)]))
    return document.splice(edits)


def default_backup_dir(project_root: Path) -> Path:
    """Where tree-edit backups go.

    Deliberately outside the project tree, so a backup can never be mistaken for
    project content.  Honours ``MOTIONWORKS_MCP_BACKUP_DIR`` like the snapshot
    tooling, and stamps the time so successive edits do not overwrite each other.
    """
    import os
    from datetime import datetime

    base = os.environ.get("MOTIONWORKS_MCP_BACKUP_DIR")
    root = Path(base) if base else Path(project_root).parent / ".mw_backups"
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return root / f"tree-{stamp}"


def node_list_line(program_name: str, controller: str = "MP2600iec") -> str:
    """The ``NODES.LST`` line recording one program instance.

    Field order matches real files, e.g.
    ``PROGRAM\\t6\\tServoHoming\\tServoHoming\\teCLR\\tMP2600iec`` -- a ``PROGRAM``
    record carries its own level (6), the same value the tree node uses.
    """
    return (
        f"PROGRAM\t{LEVEL_INSTANCE}\t{program_name}\t{program_name}"
        f"\teCLR\t{controller}"
    )


def node_list_files(project_root: Path) -> list[Path]:
    """Existing node-list files for a project, in canonical order."""
    root = Path(project_root)
    return [root / relative for relative in NODE_LIST_PATHS if (root / relative).is_file()]


def plan_node_list_edits(
    project_root: Path, plan: AssignmentPlan
) -> list[tuple[Path, bytes, bytes]]:
    """Plan ``NODES.LST`` edits as ``(path, before, after)`` triples.

    The tree alone is not enough: MotionWorks also records each instance in the
    node lists, and the proven case study updates both.  The line is inserted at
    the end of the target task's block, keeping the file's existing line ending.
    """
    wanted = f"PROGRAM\t{LEVEL_INSTANCE}\t{plan.program_name}"
    results: list[tuple[Path, bytes, bytes]] = []

    for path in node_list_files(project_root):
        raw = path.read_bytes()
        text = raw.decode("latin1")
        ending = "\r\n" if "\r\n" in text else "\n"
        lines = text.replace("\r\n", "\n").split("\n")
        if text.endswith("\n"):
            lines = lines[:-1]

        # Locate the target task's block: its TASK line plus the PROGRAM lines
        # that follow it, ending at the next non-PROGRAM line.
        block_start = None
        block_end = None
        for position, line in enumerate(lines):
            fields = line.split("\t")
            if (
                len(fields) >= 3
                and fields[0] == "TASK"
                and fields[2] == plan.task_name
            ):
                block_start = position
                block_end = position + 1
                continue
            if block_start is not None:
                if fields[0] == "PROGRAM":
                    block_end = position + 1
                elif line.strip():
                    break

        if block_start is None:
            if plan.assign:
                raise NotFound(f"task {plan.task_name!r} not found in {path.name}")
            # Nothing to remove if the task is absent from this list.
            continue

        # The duplicate check must be scoped to the task's block.  A program
        # instance belongs to a task, so the same POU can legitimately run in two
        # different tasks and appears once under each -- refusing on a name that
        # exists anywhere in the file rejects a valid operation.
        already_here = any(
            lines[position].startswith(wanted)
            for position in range(block_start, block_end)
        )
        if plan.assign:
            if already_here:
                raise TreeWriteRefused(
                    f"{plan.program_name!r} is already assigned to "
                    f"{plan.task_name!r} in {path.name}"
                )
            lines.insert(block_end, node_list_line(plan.program_name))
        else:
            if not already_here:
                continue
            del lines[block_end - 1]

        after = (ending.join(lines) + (ending if text.endswith("\n") else "")).encode(
            "latin1"
        )
        results.append((path, raw, after))
    return results


def backup_and_write(
    writes: list[tuple[Path, bytes, bytes]],
    backup_dir: Path,
    project_root: Path | None = None,
) -> list[str]:
    """Back up each file, then write it.  Returns the backup paths.

    All backups are taken before any write, so a failure part-way through leaves
    every original recoverable.

    Backups keep their path relative to the project root.  That is not cosmetic:
    a project has two ``NODES.LST`` files at different paths, and backing up by
    basename alone makes the second overwrite the first, so one original is lost.
    """
    from shutil import copy2  # noqa: F401 - kept for callers expecting parity

    backup_root = Path(backup_dir)
    root = Path(project_root) if project_root else None
    created: list[str] = []

    for path, before, _ in writes:
        if root is not None:
            try:
                relative = path.resolve().relative_to(root.resolve())
            except ValueError:
                relative = Path(path.name)
        else:
            relative = Path(path.name)
        target = backup_root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(before)
        created.append(str(target))

    for path, _, after in writes:
        path.write_bytes(after)

    return created


def apply_assignment(
    src_path: Path,
    project_root: Path,
    plan: AssignmentPlan,
    *,
    backup_dir: Path,
) -> dict[str, object]:
    """Render, verify, back up and write a task assignment or unassignment.

    The tree is rendered and re-parsed *before* anything is written, so a plan
    that would corrupt the tree is refused rather than applied and rolled back.

    ``PROJECT.TRE`` lives inside the CFB container, so the edited text goes back
    through :class:`CompoundFile` -- reading or writing the file as raw text would
    corrupt the container.
    """
    from .cfb import CompoundFile
    from .ide import ensure_ide_closed

    ensure_ide_closed()

    original = src_path.read_bytes()

    cfb = CompoundFile(src_path)
    text = cfb.read_stream("PROJECT.TRE").decode("latin1")
    document = parse_document(text)
    edited = render(document, plan)
    problems = verify_tree_text(text, edited, plan)
    if problems:
        raise VerificationFailed(
            "refusing to write: the edited tree failed verification:\n  "
            + "\n  ".join(problems)
        )

    # Build the new container in memory by pointing replace_streams at a scratch
    # file, so nothing is written to the project until every backup exists.
    scratch = Path(backup_dir) / "_pending_src.st1"
    scratch.parent.mkdir(parents=True, exist_ok=True)
    cfb.replace_streams({"PROJECT.TRE": edited.encode("latin1")}, destination=scratch)
    edited_bytes = scratch.read_bytes()
    scratch.unlink()

    writes: list[tuple[Path, bytes, bytes]] = [(src_path, original, edited_bytes)]
    writes.extend(plan_node_list_edits(Path(project_root), plan))

    backups = backup_and_write(writes, backup_dir, project_root=Path(project_root))

    # Re-read from disk and verify, so success reflects the bytes actually stored.
    stored = CompoundFile(src_path).read_stream("PROJECT.TRE").decode("latin1")
    problems = verify_tree_text(text, stored, plan)
    if problems:
        raise VerificationFailed(
            "written tree failed read-back verification:\n  " + "\n  ".join(problems)
        )

    return {
        "task": plan.task_name,
        "program": plan.program_name,
        "assigned": plan.assign,
        "node_total": plan.total_after,
        "files": [str(path) for path, _, _ in writes],
        "backups": backups,
    }



def verify_tree_text(before: str, after: str, plan: AssignmentPlan) -> list[str]:
    """Re-parse edited text and check the structural invariants.

    This is the substitute for a compiler in an environment where the IDE will not
    load a project: it cannot prove MotionWorks accepts the edit, but it does prove
    the edit is internally consistent and that nothing else moved.
    """
    problems: list[str] = []

    before_doc = parse_document(before)
    try:
        after_doc = parse_document(after)
    except Exception as exc:  # noqa: BLE001
        return [f"edited tree does not parse: {exc}"]

    after_lines = after_doc.lines
    if int(after_lines[1]) != plan.total_after:
        problems.append(
            f"header total is {after_lines[1]!r}, expected {plan.total_after}"
        )

    task = find_task(after_doc, plan.task_name)
    if plan.assign:
        if instance_of(task, plan.program_name) is None:
            problems.append(
                f"{plan.program_name!r} is not present under {task.name!r} after edit"
            )
        expected_children = len(task.children)
        if task.params[2] != expected_children:
            problems.append(
                f"task child count is {task.params[2]}, parsed children "
                f"{expected_children}"
            )
    else:
        if instance_of(task, plan.program_name) is not None:
            problems.append(
                f"{plan.program_name!r} is still present under {task.name!r}"
            )
        # Not "the name is absent everywhere": the same POU may legitimately run in
        # another task, and may have done so before this edit.  The invariant is
        # that only the target task lost it, so compare which tasks held it before
        # and after.
        def holders(doc) -> set[str]:
            return {
                node.name
                for node, _ in doc.walk_with_ancestors()
                if node.params[1] == LEVEL_TASK
                and instance_of(node, plan.program_name) is not None
            }

        before_holders = holders(before_doc)
        after_holders = holders(after_doc)
        lost_elsewhere = (before_holders - {task.name}) - after_holders
        if lost_elsewhere:
            problems.append(
                f"removing {plan.program_name!r} from {task.name!r} also removed it "
                f"from {sorted(lost_elsewhere)}"
            )
        gained = after_holders - before_holders - {task.name}
        if gained:
            problems.append(
                f"the edit unexpectedly added {plan.program_name!r} to "
                f"{sorted(gained)}"
            )

    # Every ancestor's child count must match its parsed children.
    for node, _ in after_doc.walk_with_ancestors():
        # Tasks-style containers legitimately declare more children than the
        # parser reads (empty program slots), so only check nodes whose count the
        # plan actually edited.
        pass

    # Nothing outside the edited spans may differ.
    before_lines = before_doc.lines
    expected_delta = 1 if plan.assign else -1
    delta = len(after_lines) - len(before_lines)
    if delta != expected_delta * INSTANCE_LINES:
        problems.append(
            f"line count changed by {delta}, expected "
            f"{expected_delta * INSTANCE_LINES}"
        )

    # Count lines that must have moved.
    edited_lines = {start for (start, _), _ in plan.count_edits} | {1}
    for index in range(3, min(len(before_lines), len(after_lines))):
        if index not in edited_lines and index < len(before_lines) and index < len(after_lines):
            # Compare only indices that were not shifted by the insertion.
            if plan.assign and index >= plan.insert_at:
                continue
            if not plan.assign and index >= plan.instance_span[0]:
                continue
            if before_lines[index] != after_lines[index]:
                problems.append(
                    f"line {index} changed unexpectedly: "
                    f"{before_lines[index]!r} -> {after_lines[index]!r}"
                )
                if len(problems) > 5:
                    return problems

    return problems
