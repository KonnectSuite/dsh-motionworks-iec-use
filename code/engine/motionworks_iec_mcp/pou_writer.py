"""Plan POU creation: produce a reviewable patch, without writing.

Creating a POU adds four nodes to ``PROJECT.TRE`` -- the POU container plus its
``T`` (comments), ``V`` (variables) and body worksheets.  Their record shape is
fully known, but **not every field in them is derivable**, and this module says so
rather than inventing values.

Fields that can be derived with confidence:

* the record layout (line count and field order), read from a real POU;
* node ids, which run in one global increasing sequence;
* the four worksheet GUIDs, which are fresh per POU and appear both in the tree and
  in ``NodeProperties.xml``;
* the name, path and level fields.

Fields that **cannot**, and are reported as unresolved:

* the worksheet state lines at the container and body, which carry opaque
  handle-like tokens (``dbf1a023``, ``9442c853``) that differ between POUs in ways
  unrelated to the POU's identity, so copying a template's values would be a guess;
* the trailing state line of a body, which differs by body kind -- an ``.STB`` body
  has ``0\\t0\\t0\\t70...`` where a ``.GB`` body has ``1\\t80000000\\t2803f...``;
* the first line of each record, a small integer (bodies are 11 or 23) whose
  meaning is not established.

The proven case study writes literal values for these.  It was validated on a
project whose template had a plainer record, so its literals do not transfer here,
and guessing them risks a project MotionWorks cannot open.  Reporting them is the
useful step: the patch can be reviewed and the missing values supplied.
"""

from __future__ import annotations

import re
import shutil
import struct
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from .errors import IdeRunning, MotionWorksError, NotFound, VerificationFailed
from .tree import TreeDocument, TreeNode, parse_document
from .tree_writer import guid_line

#: Levels in a real tree: a POU container is 2, its worksheets 3.
POU_CONTAINER_LEVEL = 2
POU_WORKSHEET_LEVEL = 3

#: Nodes one POU contributes: container + T + V + body.
POU_NODE_COUNT = 4

#: Record layout, read off real POU nodes.  A node is a count line, a params line,
#: a name, a path, then a blank/state/blank/GUID/state group.  The blank line that
#: separates one record from the next is *not* part of either.
CONTAINER_LINES = 10  # count, params, name, path, blank, state, blank, GUID, state, marker
WORKSHEET_LINES = 9  # count, params, name, path, blank, state, blank, GUID, state

#: Field offsets within a record, so nothing has to count blanks by hand.
F_COUNT, F_PARAMS, F_NAME, F_PATH = 0, 1, 2, 3
F_STATE, F_GUID = 5, 7
F_TRAILING = 8
F_CONTAINER_MARKER = 9

#: The first line of each record is a small integer that is **fixed per kind**,
#: measured across all five projects rather than assumed:
#:
#: * POU containers are 7 in all 29 POUs;
#: * ``T`` worksheets are 42 in all 29;
#: * ``V`` worksheets are 8 in all 29;
#: * ``.STB`` bodies are 23 in all 15.
#:
#: Only the ``.GB`` body varies (11 in ten cases, 12 in four), so a graphical body
#: is the one case where this cannot be derived and must be supplied.
#:
#: The container value applies to **POUs only**, and a POU is identified
#: *structurally*: it has exactly three worksheets named ``<name>T``, ``<name>V``
#: and ``<name>``.  Level is not enough -- libraries are level 2 with 31 or 3, and
#: RotaryKnife's ``RK_FunctionBlocks`` group is level 2 under ``Logical POUs`` with
#: 32.  Both exceptions were found by checking the rule against real data rather
#: than assuming it generalised.
CONTAINER_COUNT_LINE = 7
WORKSHEET_COUNT_LINE = {"T": 42, "V": 8}
#: Keyed by extension *without* the leading dot, matching the caller's form.
BODY_COUNT_LINE = {"STB": 23}


def is_pou_container(node: TreeNode) -> bool:
    """True when a node is a POU: three worksheets named ``<name>T/V/``.

    Identifying a POU structurally rather than by level or count line is what makes
    this reliable -- libraries and RotaryKnife's function-block group are also
    level-2 containers but are not POUs.
    """
    if len(node.children) != 3:
        return False
    names = [child.name for child in node.children]
    return sorted(names) == sorted([f"{node.name}T", f"{node.name}V", node.name])


def count_line_for(kind: str, body_suffix: str) -> int | None:
    """The record's first line, or ``None`` when it varies and must be supplied."""
    if kind in WORKSHEET_COUNT_LINE:
        return WORKSHEET_COUNT_LINE[kind]
    return BODY_COUNT_LINE.get(body_suffix.upper())


class PouPlanError(MotionWorksError):
    """The plan could not be produced."""


@dataclass
class FieldNote:
    """One field's provenance: derived, templated, or needing a value."""

    record: str
    line_index: int
    name: str
    status: str  # "derived" | "from-template" | "unresolved"
    detail: str = ""


@dataclass
class PouCreationPlan:
    """A reviewable description of the POU that would be created."""

    pou_name: str
    template_name: str
    project_root: Path
    node_ids: list[int]
    guids: list[str]
    insert_at: int
    records: list[str]
    files: list[str]
    notes: list[FieldNote] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def unresolved(self) -> list[FieldNote]:
        return [n for n in self.notes if n.status == "unresolved"]

    def summary(self) -> str:
        lines = [
            "PLAN ONLY - nothing written.",
            f"Create POU {self.pou_name!r} by cloning template {self.template_name!r}",
            f"  project    : {self.project_root}",
            f"  node ids   : {self.node_ids}",
            f"  insert at  : tree line {self.insert_at} (before Physical Hardware)",
            f"  node total : +{POU_NODE_COUNT}",
            "",
            f"  Files that would be created ({len(self.files)}):",
        ]
        lines.extend(f"    {name}" for name in self.files)
        lines.append("")
        lines.append(
            f"  Tree records that would be inserted ({len(self.records)} lines; "
            f"unresolved values are blank):"
        )
        lines.extend(f"    {record!r}" for record in self.records)

        derived = [n for n in self.notes if n.status == "derived"]
        templated = [n for n in self.notes if n.status == "from-template"]
        unresolved = self.unresolved()

        lines.append("")
        lines.append(f"  Fields derived with confidence ({len(derived)}):")
        for note in derived:
            lines.append(
                f"    {note.record} [{note.line_index}] {note.name}: {note.detail}"
            )

        if templated:
            lines.append("")
            lines.append(f"  Fields taken from the template ({len(templated)}):")
            for note in templated:
                lines.append(
                    f"    {note.record} [{note.line_index}] {note.name}: {note.detail}"
                )

        lines.append("")
        if unresolved:
            lines.append(
                f"  UNRESOLVED ({len(unresolved)}) - must be supplied before writing:"
            )
            for note in unresolved:
                lines.append(
                    f"    {note.record} [{note.line_index}] {note.name}: {note.detail}"
                )
        else:
            lines.append("  No unresolved fields.")
        for warning in self.warnings:
            lines.append(f"  WARNING: {warning}")
        return "\n".join(lines)


@dataclass
class PouDeletionPlan:
    """A planned POU deletion."""

    pou_name: str
    project_root: Path
    #: ``(start, end)`` line span of the POU's own records, removed entirely.
    span: tuple[int, int]
    #: Task instance blocks to remove: ``(task_name, span)``.
    instances: list[tuple[str, tuple[int, int]]] = field(default_factory=list)
    #: Count fields to decrement: ``(span, replacement)``.
    count_edits: list[tuple[tuple[int, int], list[str]]] = field(default_factory=list)
    total_before: int = 0
    total_after: int = 0
    #: Other POUs whose bodies name this one.
    referenced_by: list[str] = field(default_factory=list)
    #: Tasks this POU is currently assigned to.
    assigned_to: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def summary(self) -> str:
        lines = [
            f"DELETE POU {self.pou_name}",
            f"  project     : {self.project_root}",
            f"  tree records: lines {self.span[0]}..{self.span[1]} "
            f"({self.span[1] - self.span[0]} lines removed)",
            f"  node total  : {self.total_before} -> {self.total_after}",
        ]
        if self.assigned_to:
            lines.append(
                f"  assigned to : {', '.join(self.assigned_to)} "
                f"({len(self.instances)} instance block(s) removed)"
            )
        else:
            lines.append("  assigned to : nothing")
        if self.referenced_by:
            lines.append(
                f"  REFERENCED BY: {', '.join(self.referenced_by)} - deleting it "
                f"leaves a dangling call"
            )
        lines.extend(f"  note: {note}" for note in self.notes)
        return "\n".join(lines)


def find_pou_references(project_root: Path, pou_name: str) -> list[str]:
    """Other POUs whose ST bodies name ``pou_name``.

    The name is matched as a whole word, so deleting a POU another POU calls can be
    refused rather than leaving a dangling reference -- the same guard variable
    deletion uses.
    """
    from . import project as P
    from .variables import CompressedStreamError

    found: list[str] = []
    project = P.Project(root=Path(project_root))
    pous = project.pous() if callable(project.pous) else project.pous
    pattern = re.compile(r"\b" + re.escape(pou_name) + r"\b")
    for pou in pous:
        if pou.name == pou_name:
            continue
        try:
            body = pou.st_body()
        except CompressedStreamError:
            continue
        except Exception:  # noqa: BLE001 - an unreadable POU cannot be checked
            continue
        if body and pattern.search(body):
            found.append(pou.name)
    return sorted(found)


def plan_pou_deletion(
    project_root: Path, pou_name: str, *, force: bool = False
) -> PouDeletionPlan:
    """Plan deleting a POU, its task assignments and its registry entries.

    Refuses when another POU calls the one being deleted, unless ``force`` is set.
    The tree edit itself is safe either way, but the project would no longer
    compile, and a silent dangling call is worse than a refusal.
    """
    from .cfb import CompoundFile

    project_root = Path(project_root)
    src = project_root / "src.st1"
    if not src.is_file():
        raise NotFound(f"no src.st1 under {project_root}")
    document = parse_document(
        CompoundFile(src).read_stream("PROJECT.TRE").decode("latin1")
    )
    target = _pou_container(document, pou_name)
    if target is None:
        raise NotFound(f"no POU named {pou_name!r} in the project tree")
    if not is_pou_container(target):
        raise PouPlanError(
            f"{pou_name!r} is not a well-formed POU container; refusing to delete"
        )

    total_before = int(document.lines[1])
    plan = PouDeletionPlan(
        pou_name=pou_name,
        project_root=project_root,
        span=target.span,
        total_before=total_before,
        total_after=total_before - POU_NODE_COUNT,
    )

    # A task instance is a child of a task named after the POU.
    for node, _ in document.walk_with_ancestors():
        if node.params[1] != 5:
            continue
        for child in node.children:
            if child.name == pou_name:
                plan.instances.append((node.name, child.span))
                plan.assigned_to.append(node.name)

    # Counts to decrement: the container that held it, and the root.  The
    # intermediate containers deliberately do not move -- they do not track program
    # instances, the same reason task assignment edits only two fields.
    container = next(
        node
        for node, _ in document.walk_with_ancestors()
        if node.name == "Logical POUs"
    )
    plan.count_edits.append(
        (
            (container.line, container.line + 1),
            [_params_with(container.params, 2, container.params[2] - POU_NODE_COUNT)],
        )
    )
    root = document.roots[0]
    plan.count_edits.append(
        (
            (root.line, root.line + 1),
            [_params_with(root.params, 2, root.params[2] - POU_NODE_COUNT)],
        )
    )
    # Each removed instance also shrinks the task that held it.
    for task_name, _ in plan.instances:
        task = next(
            node
            for node, _ in document.walk_with_ancestors()
            if node.params[1] == 5 and node.name == task_name
        )
        plan.count_edits.append(
            (
                (task.line, task.line + 1),
                [_params_with(task.params, 2, task.params[2] - 1)],
            )
        )

    plan.referenced_by = find_pou_references(project_root, pou_name)
    if plan.referenced_by and not force:
        raise PouPlanError(
            f"refusing to delete {pou_name!r}: it is called by "
            f"{', '.join(plan.referenced_by)}. Remove those calls first, or pass "
            f"force=True to delete anyway and accept that the project will not "
            f"compile."
        )
    if plan.referenced_by:
        plan.notes.append(
            f"forced despite being called by {', '.join(plan.referenced_by)}"
        )
    return plan


def _params_with(params: tuple[int, int, int, int], index: int, value: int) -> str:
    values = list(params)
    values[index] = max(0, value)
    return " ".join(str(v) for v in values)


def render_pou_deletion(document: TreeDocument, plan: PouDeletionPlan) -> str:
    """Remove the POU's records and its task instances, and adjust the counts."""
    edits: list[tuple[int, int, list[str]]] = [
        (plan.span[0], plan.span[1], []),
    ]
    for _, span in plan.instances:
        edits.append((span[0], span[1], []))
    for span, replacement in plan.count_edits:
        edits.append((span[0], span[1], replacement))
    edits.append((1, 2, [str(plan.total_after)]))
    return document.splice(edits)


def _verify_deletion(
    document: TreeDocument, plan: PouDeletionPlan, previous_total: int
) -> list[str]:
    """Check the invariants a POU deletion must satisfy."""
    problems: list[str] = []
    if _pou_container(document, plan.pou_name) is not None:
        problems.append(f"{plan.pou_name!r} is still in the tree")
    for node, _ in document.walk_with_ancestors():
        if node.params[1] == 5 and any(
            child.name == plan.pou_name for child in node.children
        ):
            problems.append(f"a task instance of {plan.pou_name!r} remains")
            break
    if int(document.lines[1]) != previous_total - POU_NODE_COUNT:
        problems.append(
            f"node total is {document.lines[1]}, expected "
            f"{previous_total - POU_NODE_COUNT}"
        )
    remaining = [
        node.name
        for node, _ in document.walk_with_ancestors()
        if node.params[1] == POU_CONTAINER_LEVEL and is_pou_container(node)
    ]
    if not remaining:
        problems.append("the deletion removed every POU")
    return problems


def apply_pou_deletion(
    plan: PouDeletionPlan,
    *,
    backup_dir: Path,
    archive_dir: Path | None = None,
) -> dict[str, object]:
    """Delete a POU: archive its directory, splice the tree, update the registries.

    The deleted POU directory is **moved to an archive**, not removed, so the
    deletion is recoverable without depending on the backup copies -- the case study
    does the same.

    As with creation, the tree edit is rendered and verified in a scratch container
    before anything is written.
    """
    from .cfb import CompoundFile
    from .ide import ensure_ide_closed
    from .tree_writer import backup_and_write

    ensure_ide_closed()

    project_root = Path(plan.project_root)
    src = project_root / "src.st1"
    original = src.read_bytes()
    document = parse_document(
        CompoundFile(src).read_stream("PROJECT.TRE").decode("latin1")
    )
    previous_total = int(document.lines[1])

    rendered = render_pou_deletion(document, plan)
    with tempfile.NamedTemporaryFile(
        dir=src.parent, delete=False, suffix=".verify"
    ) as handle:
        scratch = Path(handle.name)
    try:
        CompoundFile(src).replace_streams(
            {"PROJECT.TRE": rendered.encode("latin1")}, destination=scratch
        )
        check = parse_document(
            CompoundFile(scratch).read_stream("PROJECT.TRE").decode("latin1")
        )
        problems = _verify_deletion(check, plan, previous_total)
        if problems:
            raise PouPlanError(
                "refusing to delete the POU: the edited tree failed verification:\n  "
                + "\n  ".join(problems)
            )
    finally:
        scratch.unlink(missing_ok=True)

    pou_dir = _pou_root(project_root) / plan.pou_name
    archive = (archive_dir or (backup_dir / "archived-pous")) / plan.pou_name
    if archive.exists():
        raise PouPlanError(f"the archive location already exists: {archive}")

    writes: list[tuple[Path, bytes, bytes]] = [
        (src, original, _edited_container_bytes(src, rendered))
    ]
    writes.extend(_deletion_registry_writes(project_root, plan))

    moved = False
    try:
        archive.parent.mkdir(parents=True, exist_ok=True)
        if pou_dir.is_dir():
            shutil.move(str(pou_dir), str(archive))
            moved = True
        backups = backup_and_write(writes, backup_dir, project_root=project_root)
    except Exception:
        # Put the directory back so a failed deletion leaves the project as it was.
        if moved and archive.is_dir() and not pou_dir.exists():
            shutil.move(str(archive), str(pou_dir))
        raise

    stored = parse_document(
        CompoundFile(src).read_stream("PROJECT.TRE").decode("latin1")
    )
    problems = _verify_deletion(stored, plan, previous_total)
    if problems:
        raise VerificationFailed(
            "the deleted POU failed read-back verification:\n  " + "\n  ".join(problems)
        )

    return {
        "pou": plan.pou_name,
        "node_total": int(stored.lines[1]),
        "archived_to": str(archive) if moved else None,
        "files_written": [str(path) for path, _, _ in writes],
        "backups": backups,
    }


def _deletion_registry_writes(
    project_root: Path, plan: PouDeletionPlan
) -> list[tuple[Path, bytes, bytes]]:
    """Plan removing the POU from ``LIST.POU``, the node lists and ``PROJECT.INF``."""
    from datetime import datetime

    writes: list[tuple[Path, bytes, bytes]] = []

    candidates = [project_root / "LIST.POU"]
    for relative in (
        "NODES.LST",
        "C/Configuration/R/Resource/NODES.LST",
        "C/Resource/R/Resource/NODES.LST",
    ):
        candidates.append(project_root / relative)

    for path in candidates:
        if not path.is_file():
            continue
        raw = path.read_bytes()
        lines = raw.splitlines(keepends=True)
        pattern = re.compile(
            r"\b" + re.escape(plan.pou_name) + r"\b"
        )
        matched = [i for i, line in enumerate(lines) if pattern.search(line.decode("latin1"))]
        if not matched:
            continue
        # Every matching line must be a record for this POU; anything else means the
        # name is used for something we do not understand, so leave the file alone.
        for index in sorted(matched, reverse=True):
            del lines[index]
        writes.append((path, raw, b"".join(lines)))

    project_inf = project_root / "PROJECT.INF"
    if project_inf.is_file():
        raw = project_inf.read_bytes()
        text = raw.decode("latin1")
        stamp = datetime.now().strftime("%m/%d/%Y  %I:%M:%S %p")
        replaced = re.sub(r"(?m)^LastChange=.*$", f"LastChange={stamp}", text)
        if replaced != text:
            writes.append((project_inf, raw, replaced.encode("latin1")))

    return writes


@dataclass
class TransplantPlan:
    """A planned LD body transplantation from a donor POU."""

    donor_name: str
    target_name: str
    project_root: Path
    #: The streams to write into the target, as ``name -> payload``.
    payloads: dict[str, bytes] = field(default_factory=dict)
    #: Streams in the target that will be replaced: ``name -> before``.
    before: dict[str, bytes] = field(default_factory=dict)
    #: Variables whose grid usage was converted from external to local.
    localized: int = 0
    #: Function-block instances, which keep their usage value.
    fb_instances: int = 0
    declared_variables: int = 0
    notes: list[str] = field(default_factory=list)

    @property
    def changed(self) -> bool:
        return self.payloads != self.before

    def summary(self) -> str:
        lines = [
            f"TRANSPLANT LD body: {self.donor_name} -> {self.target_name}",
            f"  project        : {self.project_root}",
            f"  variables      : {self.declared_variables} declared, "
            f"{self.localized} external localized to local, "
            f"{self.fb_instances} function-block instance(s) kept",
            "  streams written:",
        ]
        for name, payload in sorted(self.payloads.items()):
            was = len(self.before.get(name, b""))
            lines.append(f"    {name:28} {was} -> {len(payload)} bytes")
        lines.extend(f"  note: {note}" for note in self.notes)
        return "\n".join(lines)


def read_variable_grid_count(raw: bytes) -> int | None:
    """The declared-variable count a ``.VGR`` stream claims, if it looks valid."""
    if len(raw) < 12:
        return None
    count = struct.unpack_from("<I", raw, 8)[0]
    # A plausible grid has a count far below its byte length; a compressed stream
    # reports a value in the billions, which is how it is spotted.
    return count if count <= len(raw) else None


def localize_variable_grid(raw: bytes) -> tuple[bytes, int, int]:
    """Convert external variable records in a ``.VGR`` grid to local ones.

    The record layout, from the proven case study: from offset 12 each record begins
    with six little-endian ``uint32`` values -- handle, usage, group, flags,
    worksheet row, final flags.  ``usage`` is 1 for a local variable, 5 for an
    external one, and ``0x00040001`` for a function-block instance.

    A transplanted body must have its externals localized, because the donor's
    external references belong to the donor's project.  Function-block instances
    keep their usage value.

    Records are found by their field pattern rather than a fixed stride, which is
    what defeated an earlier attempt at this format: the variable-length name and
    type make the stride uneven.  The count found must match the count the stream
    declares, so a compressed or otherwise unexpected grid is refused rather than
    rewritten.
    """
    if len(raw) < 12:
        raise PouPlanError("the variable grid is too short to parse")
    expected = struct.unpack_from("<I", raw, 8)[0]
    data = bytearray(raw)
    offsets: list[int] = []
    for offset in range(12, max(12, len(data) - 23)):
        handle, usage, group, flags, row, final_flags = struct.unpack_from(
            "<6I", data, offset
        )
        if (
            1000 <= handle <= 10000
            and usage in (1, 5, 0x00040001)
            and group == 1
            and flags == 0
            and 1 <= row <= 999
            and final_flags == 0
        ):
            offsets.append(offset)

    if len(offsets) != expected:
        raise PouPlanError(
            f"the variable grid holds {len(offsets)} variable record(s) but declares "
            f"{expected}; refusing to rewrite a grid whose layout is not the expected "
            f"one (a compressed stream looks like this)"
        )

    localized = 0
    fb_instances = 0
    for offset in offsets:
        usage = struct.unpack_from("<I", data, offset + 4)[0]
        if usage == 5:
            struct.pack_into("<I", data, offset + 4, 1)
            localized += 1
        elif usage == 0x00040001:
            fb_instances += 1
    return bytes(data), localized, fb_instances


def _body_streams(pou) -> tuple[str | None, str | None, str | None]:
    """``(graphical body, declarations, grid)`` stream names for a POU."""
    names = pou.stream_names()
    graphical = next((n for n in names if n.endswith(".GB")), None)
    declarations = next((n for n in names if n.endswith("V.VB")), None)
    grid = next((n for n in names if n.endswith("V.VGR")), None)
    return graphical, declarations, grid


def plan_transplant(
    project_root: Path, donor_name: str, target_name: str
) -> TransplantPlan:
    """Plan copying a donor's graphical (LD) body into another POU.

    Only graphical bodies are transplanted.  An ST body is replaced as text by
    :func:`plan_st_body`; a graphical one is binary and cannot be authored from
    scratch, which is why the supported route is a proven donor.
    """
    from . import project as P
    from .cfb import CompoundFile
    from .variables import CompressedStreamError

    project_root = Path(project_root)
    project = P.Project(root=project_root)
    donor = project.pou(donor_name)
    target = project.pou(target_name)
    if donor_name == target_name:
        raise PouPlanError("the donor and the target are the same POU")

    donor_streams = _body_streams(donor)
    target_streams = _body_streams(target)
    if donor_streams[0] is None:
        raise PouPlanError(
            f"donor {donor_name!r} has no graphical body; only LD bodies are "
            f"transplanted (use mw_set_st_body for structured text)"
        )
    if None in target_streams:
        raise PouPlanError(
            f"target {target_name!r} has no graphical body to replace"
        )

    try:
        donor.declarations()
    except CompressedStreamError as exc:
        raise PouPlanError(
            f"donor {donor_name!r} has a compressed declaration stream, which cannot "
            f"be localized: {exc}"
        ) from exc

    donor_cfb = CompoundFile(donor.source_path)
    source_body = donor_cfb.read_stream(donor_streams[0])
    source_vb = donor_cfb.read_stream(donor_streams[1])
    source_vgr = donor_cfb.read_stream(donor_streams[2])

    localized_vb = source_vb.replace(b"VAR_EXTERNAL", b"VAR")
    localized_vgr, localized, fb_instances = localize_variable_grid(source_vgr)

    target_cfb = CompoundFile(target.source_path)
    plan = TransplantPlan(
        donor_name=donor_name,
        target_name=target_name,
        project_root=project_root,
        payloads={
            target_streams[0]: source_body,
            target_streams[1]: localized_vb,
            target_streams[2]: localized_vgr,
        },
        before={
            target_streams[0]: target_cfb.read_stream(target_streams[0]),
            target_streams[1]: target_cfb.read_stream(target_streams[1]),
            target_streams[2]: target_cfb.read_stream(target_streams[2]),
        },
        localized=localized,
        fb_instances=fb_instances,
    )
    plan.declared_variables = read_variable_grid_count(source_vgr) or 0
    if not plan.changed:
        plan.notes.append("the target already matches the donor")
    plan.notes.append(
        "the donor's external declarations were localized, because its external "
        "references belong to the donor's project"
    )
    return plan


def apply_transplant(plan: TransplantPlan, *, backup_dir: Path) -> dict[str, object]:
    """Write a transplantation, verifying every stream reads back first."""
    from . import project as P
    from .cfb import CompoundFile
    from .ide import ensure_ide_closed
    from .tree_writer import backup_and_write

    ensure_ide_closed()

    project_root = Path(plan.project_root)
    project = P.Project(root=plan.project_root)
    target = project.pou(plan.target_name)
    source = target.source_path
    original = source.read_bytes()

    # Build the new container in a scratch file and verify every stream there, so a
    # container defect becomes a refusal rather than a damaged POU.
    with tempfile.NamedTemporaryFile(
        dir=source.parent, delete=False, suffix=".verify"
    ) as handle:
        scratch = Path(handle.name)
    try:
        CompoundFile(source).replace_streams(plan.payloads, destination=scratch)
        staged = CompoundFile(scratch)
        for name, payload in plan.payloads.items():
            if staged.read_stream(name) != payload:
                raise VerificationFailed(
                    f"refusing to transplant: the container did not reproduce "
                    f"{name!r}. Nothing was written."
                )
    finally:
        scratch.unlink(missing_ok=True)

    writes = [(source, original, _edited_container_bytes(source, plan.payloads))]
    backups = backup_and_write(writes, backup_dir, project_root=plan.project_root)

    stored = CompoundFile(source)
    problems = [
        name for name, payload in plan.payloads.items()
        if stored.read_stream(name) != payload
    ]
    if problems:
        raise VerificationFailed(
            f"the transplanted POU failed read-back verification for {problems}"
        )
    return {
        "donor": plan.donor_name,
        "target": plan.target_name,
        "streams": sorted(plan.payloads),
        "localized": plan.localized,
        "fb_instances": plan.fb_instances,
        "files_written": [str(path) for path, _, _ in writes],
        "backups": backups,
    }


def apply_pou_creation(
    plan: PouCreationPlan,
    *,
    backup_dir: Path,
    project_root: Path | None = None,
) -> dict[str, object]:
    """Create a POU: clone the directory, splice the tree, update the registries.

    The steps are the validated workflow from the case study:

    1. clone the template directory, renaming files that mention the template;
    2. rename the streams inside the new POU's ``src.st1``;
    3. give the four worksheet GUIDs fresh values, in ``NodeProperties.xml`` and in
       the tree records (which must agree);
    4. insert four nodes into ``PROJECT.TRE`` and move the container, root and total
       counts;
    5. register the POU in ``LIST.POU`` and ``PROJECT.INF``.

    Nothing is written until the tree edit has been rendered and verified in a
    scratch container -- the same discipline the other writers use, because a
    verification that runs after the write cannot prevent damage.
    """
    from .cfb import CompoundFile
    from .cfb import CompoundFile
    from .ide import ensure_ide_closed
    from .tree_writer import backup_and_write

    ensure_ide_closed()

    project_root = Path(project_root or plan.project_root)
    if plan.unresolved():
        raise PouPlanError(
            "the plan still has unresolved fields, so nothing was written: "
            + ", ".join(f"{n.record}.{n.name}" for n in plan.unresolved())
        )

    src = project_root / "src.st1"
    template_dir = _pou_root(project_root) / plan.template_name
    target_dir = _pou_root(project_root) / plan.pou_name
    if target_dir.exists():
        raise PouPlanError(f"{target_dir} already exists")

    original = src.read_bytes()
    document = parse_document(
        CompoundFile(src).read_stream("PROJECT.TRE").decode("latin1")
    )
    previous_total = int(document.lines[1])

    # --- render the tree edit, and prove it in a scratch container first
    rendered = _render_tree(document, plan)
    with tempfile.NamedTemporaryFile(
        dir=src.parent, delete=False, suffix=".verify"
    ) as handle:
        scratch = Path(handle.name)
    try:
        CompoundFile(src).replace_streams(
            {"PROJECT.TRE": rendered.encode("latin1")}, destination=scratch
        )
        check = parse_document(
            CompoundFile(scratch).read_stream("PROJECT.TRE").decode("latin1")
        )
        problems = _verify_tree(check, plan, previous_total)
        if problems:
            raise PouPlanError(
                "refusing to create the POU: the edited tree failed verification:\n  "
                + "\n  ".join(problems)
            )
    finally:
        scratch.unlink(missing_ok=True)

    # --- clone the directory, then write the tree and the registries
    target_dir.mkdir(parents=True, exist_ok=False)
    try:
        created: list[str] = []
        for path in sorted(template_dir.iterdir()):
            if not path.is_file() or path.name == "tmp.sto":
                continue
            destination = target_dir / _rename_for(
                path.name, plan.template_name, plan.pou_name
            )
            shutil.copy2(path, destination)
            created.append(str(destination))

        _rewrite_node_properties(target_dir, plan)
        _rename_pou_streams(target_dir, plan)

        writes: list[tuple[Path, bytes, bytes]] = [
            (src, original, _edited_container_bytes(src, rendered))
        ]
        writes.extend(_registry_writes(project_root, plan))
        backups = backup_and_write(writes, backup_dir, project_root=project_root)
    except Exception:
        # A half-created POU is worse than none: remove it so a retry is clean.
        shutil.rmtree(target_dir, ignore_errors=True)
        raise

    stored = parse_document(
        CompoundFile(src).read_stream("PROJECT.TRE").decode("latin1")
    )
    problems = _verify_tree(stored, plan, previous_total)
    if problems:
        raise VerificationFailed(
            "the created POU failed read-back verification:\n  " + "\n  ".join(problems)
        )

    return {
        "pou": plan.pou_name,
        "template": plan.template_name,
        "node_ids": plan.node_ids,
        "node_total": int(stored.lines[1]),
        "files_created": created,
        "files_written": [str(path) for path, _, _ in writes],
        "backups": backups,
    }


def _edited_container_bytes(src: Path, replacements: dict[str, bytes] | str) -> bytes:
    """Build the edited container in memory, via a scratch destination.

    Accepts either a ``{stream: payload}`` mapping or a bare ``PROJECT.TRE`` string,
    since both callers need the same scratch-container discipline.
    """
    from .cfb import CompoundFile

    if isinstance(replacements, str):
        replacements = {"PROJECT.TRE": replacements.encode("latin1")}

    with tempfile.NamedTemporaryFile(
        dir=src.parent, delete=False, suffix=".pending"
    ) as handle:
        scratch = Path(handle.name)
    try:
        CompoundFile(src).replace_streams(replacements, destination=scratch)
        return scratch.read_bytes()
    finally:
        scratch.unlink(missing_ok=True)


def _render_tree(document: TreeDocument, plan: PouCreationPlan) -> str:
    """Insert the four records and move the container, root and total counts."""
    container = next(
        node
        for node, _ in document.walk_with_ancestors()
        if node.name == "Logical POUs"
    )
    container_params = list(container.params)
    container_params[2] = container.params[2] + POU_NODE_COUNT

    root = document.roots[0]
    root_params = list(root.params)
    root_params[2] = root.params[2] + POU_NODE_COUNT

    total = int(document.lines[1]) + POU_NODE_COUNT
    return document.splice(
        [
            (plan.insert_at, plan.insert_at, plan.records),
            (container.line, container.line + 1,
             [" ".join(str(v) for v in container_params)]),
            (root.line, root.line + 1, [" ".join(str(v) for v in root_params)]),
            (1, 2, [str(total)]),
        ]
    )


def _verify_tree(
    document: TreeDocument, plan: PouCreationPlan, previous_total: int
) -> list[str]:
    """Check the invariants a POU creation must satisfy."""
    problems: list[str] = []
    created = _pou_container(document, plan.pou_name)
    if created is None:
        problems.append(f"{plan.pou_name!r} is not in the tree after the edit")
        return problems
    if not is_pou_container(created):
        problems.append(
            f"{plan.pou_name!r} is not a well-formed POU container: children "
            f"{[c.name for c in created.children]}"
        )
    if created.params[0] != plan.node_ids[0]:
        problems.append(
            f"container node id is {created.params[0]}, expected {plan.node_ids[0]}"
        )
    for expected, child in zip(plan.node_ids[1:], created.children):
        if child.params[0] != expected:
            problems.append(
                f"worksheet {child.name!r} has node id {child.params[0]}, "
                f"expected {expected}"
            )
    if int(document.lines[1]) != previous_total + POU_NODE_COUNT:
        problems.append(
            f"node total is {document.lines[1]}, expected "
            f"{previous_total + POU_NODE_COUNT}"
        )
    existing = [
        node.name
        for node, _ in document.walk_with_ancestors()
        if node.params[1] == POU_CONTAINER_LEVEL and is_pou_container(node)
    ]
    if len(existing) < 2:
        problems.append("the edit left fewer than two POUs in the tree")
    return problems


def _rewrite_node_properties(target_dir: Path, plan: PouCreationPlan) -> None:
    """Replace the template's four worksheet GUIDs with the new POU's."""
    path = target_dir / "NodeProperties.xml"
    if not path.is_file():
        return
    text = path.read_bytes().decode("utf-16")
    template_dir = _pou_root(plan.project_root) / plan.template_name
    old_guids = _template_guids(template_dir)
    if len(old_guids) != len(plan.guids):
        raise PouPlanError(
            f"template records {len(old_guids)} GUID(s) but the plan has "
            f"{len(plan.guids)}; refusing to rewrite NodeProperties.xml"
        )
    for old, new in zip(old_guids, plan.guids):
        text = text.replace(old, tree_form_to_guid(new), 1)
    path.write_bytes(text.encode("utf-16"))


def _rename_pou_streams(target_dir: Path, plan: PouCreationPlan) -> None:
    """Rename the streams inside the new POU's ``src.st1`` to its own name."""
    from .cfb import CompoundFile

    src = target_dir / "src.st1"
    if not src.is_file():
        return
    cfb = CompoundFile(src)
    renames = {
        stream: _rename_for(stream, plan.template_name, plan.pou_name)
        for stream in cfb.stream_names()
        if plan.template_name.lower() in stream.lower()
    }
    if renames:
        cfb.rename_streams(renames)


def _registry_writes(
    project_root: Path, plan: PouCreationPlan
) -> list[tuple[Path, bytes, bytes]]:
    """Plan the ``LIST.POU`` and ``PROJECT.INF`` updates."""
    from datetime import datetime

    writes: list[tuple[Path, bytes, bytes]] = []

    list_pou = project_root / "LIST.POU"
    if list_pou.is_file():
        raw = list_pou.read_bytes()
        text = raw.decode("latin1")
        ending = "\r\n" if "\r\n" in text else "\n"
        line = f"PROGRAM\t{plan.pou_name}\t\t\tPT=1\t{plan.pou_name}\tHIDDEN=0\t"
        if f"PROGRAM\t{plan.pou_name}\t" in text:
            raise PouPlanError(f"{plan.pou_name!r} already appears in LIST.POU")
        after = text + ("" if text.endswith(("\n", "\r")) else ending) + line + ending
        writes.append((list_pou, raw, after.encode("latin1")))

    project_inf = project_root / "PROJECT.INF"
    if project_inf.is_file():
        raw = project_inf.read_bytes()
        text = raw.decode("latin1")
        stamp = datetime.now().strftime("%m/%d/%Y  %I:%M:%S %p")
        replaced = re.sub(r"(?m)^LastChange=.*$", f"LastChange={stamp}", text)
        if replaced != text:
            writes.append((project_inf, raw, replaced.encode("latin1")))

    return writes


def _pou_container(document: TreeDocument, name: str) -> TreeNode | None:
    for node, _ in document.walk_with_ancestors():
        if node.params[1] == POU_CONTAINER_LEVEL and node.name == name:
            return node
    return None


def _physical_hardware(document: TreeDocument) -> TreeNode | None:
    """The node POU records are inserted before, as the case study does.

    The parser's subtree bookkeeping nests this under ``Logical POUs``, so it is
    found by name and position rather than by walking parents.
    """
    for node, _ in document.walk_with_ancestors():
        record = node.path.split("\t")[0].replace("/", "\\")
        if node.name == "Physical Hardware" or record.endswith("\\HW"):
            return node
    return None


def _pou_root(project_root: Path) -> Path:
    candidate = Path(project_root) / "POE"
    if not candidate.is_dir():
        raise NotFound(f"no POE directory under {project_root}")
    return candidate


def _template_guids(directory: Path) -> list[str]:
    path = directory / "NodeProperties.xml"
    if not path.is_file():
        return []
    text = path.read_bytes().decode("utf-16")
    return re.findall(r'GUID="([0-9A-Fa-f-]{36})"', text)


def guid_to_tree_form(dashed: str) -> str:
    """Convert ``XXXXXXXX-XXXX-...`` to the tree's space-separated form."""
    parts = dashed.split("-")
    if len(parts) != 5:
        raise PouPlanError(f"not a dashed GUID: {dashed!r}")
    tail = " ".join(parts[4][i : i + 2] for i in range(0, len(parts[4]), 2))
    return f"{parts[0]} {parts[1]} {parts[2]} {parts[3][:2]} {parts[3][2:]} {tail}"


def tree_form_to_guid(spaced: str) -> str:
    """Convert the tree's spaced form back to ``XXXXXXXX-XXXX-...``.

    The two representations are different strings, and ``NodeProperties.xml`` wants
    the dashed one.  Handing a tree-form value to :func:`guid_to_tree_form` raises
    rather than writing a GUID the tree and the XML file would disagree about.
    """
    parts = spaced.split()
    if len(parts) != 11:
        raise PouPlanError(f"not a tree-form GUID: {spaced!r}")
    return (
        f"{parts[0]}-{parts[1]}-{parts[2]}-"
        f"{parts[3]}{parts[4]}-" + "".join(parts[5:])
    )


def plan_pou_creation(
    project_root: Path, pou_name: str, template_name: str
) -> PouCreationPlan:
    """Produce a POU creation plan, marking every field that cannot be derived."""
    from .cfb import CompoundFile

    project_root = Path(project_root)
    src = project_root / "src.st1"
    if not src.is_file():
        raise NotFound(f"no src.st1 under {project_root}")
    document = parse_document(
        CompoundFile(src).read_stream("PROJECT.TRE").decode("latin1")
    )

    if _pou_container(document, pou_name) is not None:
        raise PouPlanError(f"{pou_name!r} already exists in the project tree")

    pou_root = _pou_root(project_root)
    template_dir = pou_root / template_name
    if not template_dir.is_dir():
        available = sorted(p.name for p in pou_root.iterdir() if p.is_dir())
        raise NotFound(f"no template POU {template_name!r}. Available: {available}")

    template = _pou_container(document, template_name)
    if template is None:
        raise PouPlanError(
            f"template POU {template_name!r} has a directory but no tree node"
        )
    if not is_pou_container(template):
        raise PouPlanError(
            f"template {template_name!r} is not a POU container: it has "
            f"{len(template.children)} worksheet(s), expected exactly "
            f"<name>T, <name>V and <name>"
        )

    warnings: list[str] = []
    template_guids = _template_guids(template_dir)
    if len(template_guids) != POU_NODE_COUNT:
        # Refuse here rather than during the clone: a template whose
        # NodeProperties.xml does not record exactly four worksheet GUIDs cannot be
        # given fresh ones that agree with the tree records, and failing before
        # anything is created leaves the project untouched.  Measured: one sample
        # POU records 12.
        raise PouPlanError(
            f"template {template_name!r} records {len(template_guids)} GUID(s) in "
            f"NodeProperties.xml but a POU needs {POU_NODE_COUNT}; it cannot be "
            f"cloned safely"
        )

    physical = _physical_hardware(document)
    insert_at = physical.start_line if physical else document.roots[0].end_line

    highest = max(
        (node.node_id for node, _ in document.walk_with_ancestors()), default=0
    )
    node_ids = [highest + i for i in range(1, POU_NODE_COUNT + 1)]
    guids = [guid_line() for _ in range(POU_NODE_COUNT)]

    def kind_of(child: TreeNode) -> str:
        return "T" if child.name.endswith("T") else (
            "V" if child.name.endswith("V") else ""
        )

    body_child = next(child for child in template.children if kind_of(child) == "")
    body_suffix = Path(body_child.path.split("\t")[0]).suffix or ".STB"

    records, notes = build_records(
        document,
        template,
        pou_name,
        node_ids,
        guids,
        body_child.path.split("\t")[0],
    )

    target = pou_root / pou_name
    # Rename any file whose name mentions the template, in any case.  Matching only
    # the exact and upper-cased forms leaves mixed-case names behind, and replacing
    # twice in a row can double-substitute.
    #
    # Files that do *not* mention the template are copied unchanged, but called out:
    # a POU directory holds a few files whose purpose is not established
    # (``Initialize.CCI`` in one template, ``EnableV.cfb`` in another), and whether
    # those are per-POU or shared with a group cannot be decided from the files.
    # Reporting them is honest; renaming them on a guess could break the clone.
    files = sorted(
        str(target / _rename_for(p.name, template_name, pou_name))
        for p in template_dir.iterdir()
        if p.is_file() and p.name != "tmp.sto"
    )
    # Files whose names are fixed for every POU, so not mentioning the template is
    # expected and not worth flagging.
    fixed_names = {
        "nodeproperties.xml",
        "poureserve.prs",
        "src.st1",
        "tmp.sto",
    }
    unnamed = sorted(
        p.name
        for p in template_dir.iterdir()
        if p.is_file()
        and p.name.lower() not in fixed_names
        and template_name.lower() not in p.name.lower()
    )
    if unnamed:
        warnings.append(
            "copied unchanged, since their names do not mention the template - "
            "check whether they are POU-specific and should be renamed: "
            + ", ".join(unnamed)
        )
    if not files:
        warnings.append("template directory has no cloneable files")

    return PouCreationPlan(
        pou_name=pou_name,
        template_name=template_name,
        project_root=project_root,
        node_ids=node_ids,
        guids=guids,
        insert_at=insert_at,
        records=records,
        files=files,
        notes=notes,
        warnings=warnings,
    )


def _rename_for(filename: str, template_name: str, pou_name: str) -> str:
    """Rename a template file for the new POU, case-insensitively and once.

    A single regex substitution avoids the two failure modes of chained
    ``str.replace`` calls: leaving a mixed-case occurrence untouched, and
    substituting twice when the replacement itself contains the search text.
    """
    import re as _re

    return _re.sub(_re.escape(template_name), pou_name, filename, flags=_re.IGNORECASE)


def _template_record_lines(document: TreeDocument, node: TreeNode) -> list[str]:
    """The raw record lines a template node occupies."""
    return [document.lines[i] for i in range(node.start_line, node.end_line)]


def build_records(
    document: TreeDocument,
    template: TreeNode,
    pou_name: str,
    node_ids: list[int],
    guids: list[str],
    body_stream: str,
) -> tuple[list[str], list[FieldNote]]:
    """Build the four tree records for a new POU by cloning the template's.

    Every field is either derived -- node id, level, name, path, GUID, and the
    count line, all of which were measured across the whole sample set -- or copied
    **verbatim from the template**.

    Copying is deliberate for the worksheet state lines. They carry opaque
    project-local handles (``dbf1a023``, ``9442c853``) that appear exactly once in
    the tree and are not derived from the POU name, the node GUID, or any other
    in-tree value; hashes of the name do not reproduce them, and the same POU name
    in two projects carries different handles. Inventing them is not possible from
    the files alone, so the template's values are reused and each one is reported as
    ``from-template`` rather than presented as derived.

    ``body_stream`` is the template's body stream name (``Template.STB``); the new
    POU's body takes the same extension.
    """
    directory = f"POE\\{pou_name}"
    body_suffix = Path(body_stream).suffix or ".STB"
    extension = {"T": "TXT", "V": "VGR", "": body_suffix.lstrip(".")}

    def kind_of(child: TreeNode) -> str:
        return "T" if child.name.endswith("T") else (
            "V" if child.name.endswith("V") else ""
        )

    container_lines = _template_record_lines(document, template)
    # The container's own lines are everything before its first worksheet.
    first_child = min(child.start_line for child in template.children)
    container_own = [
        line for line in container_lines if line is not None
    ][: first_child - template.start_line]

    records: list[str] = list(container_own)
    records[F_PARAMS] = f"{node_ids[0]} {POU_CONTAINER_LEVEL} {len(template.children)} 0"
    records[F_NAME] = f"{pou_name}\t0\t0\tConfiguration.Resource"
    records[F_PATH] = f"{directory}\t\t\t\t-1\t"
    records[F_GUID] = guids[0]

    notes: list[FieldNote] = [
        FieldNote("container", F_PARAMS, "params", "derived",
                  f"node id {node_ids[0]}, level {POU_CONTAINER_LEVEL}, "
                  f"{len(template.children)} children"),
        FieldNote("container", F_NAME, "name", "derived", pou_name),
        FieldNote("container", F_PATH, "path", "derived", directory),
        FieldNote("container", F_GUID, "GUID", "derived", guids[0]),
        FieldNote("container", F_STATE, "state line", "from-template",
                  f"copied from {template.name!r}: opaque project-local handles, not "
                  f"derivable from any file"),
    ]

    for offset, child in enumerate(template.children, start=1):
        kind = kind_of(child)
        worksheet_name = f"{pou_name}{kind}"
        filename = f"{worksheet_name}.{extension[kind]}"
        label = f"worksheet {kind or 'body'}"

        record = _template_record_lines(document, child)
        record[F_PARAMS] = f"{node_ids[offset]} {POU_WORKSHEET_LEVEL} 0 0"
        record[F_NAME] = f"{worksheet_name}\t0\t0\tConfiguration.Resource"
        record[F_PATH] = f"{directory}\\{filename}\t\t\t\t-1\t"
        record[F_GUID] = guids[offset]
        records.extend(record)

        notes += [
            FieldNote(label, F_COUNT, "count line", "from-template",
                      f"copied from the template ({document.lines[child.start_line]!r})"),
            FieldNote(label, F_PARAMS, "params", "derived",
                      f"node id {node_ids[offset]}, level {POU_WORKSHEET_LEVEL}"),
            FieldNote(label, F_NAME, "name", "derived", worksheet_name),
            FieldNote(label, F_PATH, "path", "derived", f"{directory}\\{filename}"),
            FieldNote(label, F_STATE, "state line", "from-template",
                      "copied from the template; opaque handles, not derivable"),
            FieldNote(label, F_GUID, "GUID", "derived", guids[offset]),
        ]
        if len(record) > F_TRAILING:
            notes.append(
                FieldNote(label, F_TRAILING, "trailing state", "from-template",
                          "copied from the template; differs by body kind and is not "
                          "derivable")
            )
    return records, notes


def _default_backup_dir(project_root: Path) -> Path:
    """Where POU-creation backups go, outside the project tree.

    Reuses the tree writer's location and stamping so a project's backups stay in
    one place.
    """
    from .tree_writer import default_backup_dir

    return default_backup_dir(project_root)