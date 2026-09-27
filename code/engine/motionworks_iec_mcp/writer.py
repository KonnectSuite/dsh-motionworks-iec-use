"""Guarded write operations for MotionWorks IEC projects.

Every mutation in this module obeys the same contract, because the failure mode
it guards against is silent corruption of a project that a user may not notice
until a machine behaves wrongly:

1. **Preflight** -- refuse while MotionWorks IEC is running.  The IDE caches
   project state in memory and rewrites whole files on save, so an external edit
   made underneath it is either discarded or produces an inconsistent project.
2. **Backup** -- copy every file about to change, outside the project tree.
3. **Mutate** -- write through ``cfb.py``, which is atomic (temp file then
   replace) and verifies its own FAT bookkeeping.
4. **Read back** -- re-open the file and confirm the new content is present and
   every sibling stream is byte-identical.
5. **Report** -- tell the caller the project is now dirty and must be rebuilt.

Which stores each operation touches is a deliberate choice, driven by what has
been *verified* rather than assumed:

* **Descriptions** need only the textual ``<POU>V.VB`` stream.  Confirmed by
  inspection: MotionWorks never stores description prose in ``.VGR``.
* **Structured Text bodies** need only the ``<POU>.STB`` stream.  The body does
  not reference the variable grid at all, so no binary grid edit is involved.

Operations that would require rewriting the ``.VGR`` binary grid -- adding or
deleting a variable, or creating and deleting POUs -- are **not implemented
here**.  See docs/tier2-format-notes.md for what remains and why.

Nothing here downloads to a controller or commands motion, and nothing here
touches hardware configuration.
"""

from __future__ import annotations

import re
import shutil
import struct
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from .cfb import CfbError, CompoundFile
from .errors import MotionWorksError
from .variables import DeclarationTable, Variable, parse_declarations

#: Marker text MotionWorks writes before each declaration block, e.g.
#: ``(*Group:Default*)``.
_GROUP_RE = re.compile(r"^\(\*Group\s*:.*?\*\)\s*$", re.IGNORECASE)


class WriteRefused(MotionWorksError):
    """A write was not attempted because a safety precondition failed."""


@dataclass
class WritePlan:
    """What a write intends to change, computed before anything is touched."""

    target: Path
    stream: str
    before: bytes
    after: bytes
    backup: Path | None = None
    notes: list[str] = field(default_factory=list)

    @property
    def changed(self) -> bool:
        return self.before != self.after

    def describe(self) -> str:
        return (
            f"{self.target.name}::{self.stream}  "
            f"{len(self.before)} -> {len(self.after)} bytes"
        )


def require_ide_closed() -> None:
    """Refuse (or close, if configured) while the IDE is running.

    Delegates to :func:`motionworks_iec_mcp.ide.ensure_ide_closed` so the
    close-or-refuse policy has a single implementation.
    """
    from .ide import ensure_ide_closed

    ensure_ide_closed()


def backup_files(paths: list[Path], project_root: Path) -> list[Path]:
    """Copy each file outside the project tree, returning the backup paths."""
    from .snapshot import default_backup_dir

    project_root = Path(project_root)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    destination_root = default_backup_dir(project_root) / stamp
    created: list[Path] = []
    for path in paths:
        if not path.is_file():
            continue
        try:
            relative = path.relative_to(project_root)
        except ValueError:
            relative = Path(path.name)
        target = destination_root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
        created.append(target)
    return created


def _apply(
    plan: WritePlan,
    project_root: Path,
    dry_run: bool = False,
    verify_siblings: bool = True,
) -> dict[str, object]:
    """Shared implementation: back up, write, read back, verify."""
    if not plan.changed:
        return {
            "applied": False,
            "reason": "no change required",
            "target": str(plan.target),
            "stream": plan.stream,
        }

    require_ide_closed()

    cfb = CompoundFile(plan.target)
    siblings_before = {
        name: cfb.read_stream(name)
        for name in cfb.stream_names()
        if name != plan.stream
    }

    if dry_run:
        return {
            "applied": False,
            "dry_run": True,
            "target": str(plan.target),
            "stream": plan.stream,
            "before_bytes": len(plan.before),
            "after_bytes": len(plan.after),
            "notes": plan.notes,
        }

    backups = backup_files([plan.target], project_root)

    # Record where each backup came from, explicitly.  Recovering the original
    # path by searching the backup path for the project name is fragile: a name
    # can appear more than once in the path, and the match then lands in the
    # wrong place, so a restore would write to the wrong location.
    backup_pairs = [
        {"original": str(plan.target), "backup": str(created)}
        for created in backups
    ]

    # Build the new container beside the target and verify it there *before*
    # replacing anything.  Verifying after the write is too late: the target has
    # already been corrupted, and the caller is left with a damaged project that
    # only a backup can rescue.  Measured: an ordinary replace_streams corrupts a
    # normal stream that shrinks and then grows back (and one promoted from mini
    # storage), so a verification that cannot prevent the write is not enough.
    import tempfile

    with tempfile.NamedTemporaryFile(
        dir=plan.target.parent, delete=False, suffix=".verify"
    ) as handle:
        scratch = Path(handle.name)
    try:
        cfb.replace_streams({plan.stream: plan.after}, destination=scratch)
        staged = CompoundFile(scratch)
        written = staged.read_stream(plan.stream)
        if written != plan.after:
            raise WriteRefused(
                f"refusing to write {plan.target.name}: the container writer did not "
                f"reproduce {plan.stream!r} ({len(plan.after)} bytes in, "
                f"{len(written)} out). Nothing was written; this is a known defect in "
                f"growth handling, not a problem with your edit."
            )
        # The other streams must survive untouched, checked here too so a sibling
        # cannot be damaged on disk either.
        damaged = [
            name
            for name, payload in siblings_before.items()
            if staged.read_stream(name) != payload
        ]
        if damaged and verify_siblings:
            raise WriteRefused(
                f"refusing to write {plan.target.name}: the edit would have damaged "
                f"unrelated stream(s) {damaged}. Nothing was written."
            )
    finally:
        scratch.unlink(missing_ok=True)

    cfb.replace_streams({plan.stream: plan.after})

    check = CompoundFile(plan.target)
    written = check.read_stream(plan.stream)
    if written != plan.after:
        raise WriteRefused(
            f"read-back verification failed for {plan.stream!r}: wrote "
            f"{len(plan.after)} bytes, read {len(written)}"
        )
    damaged = []
    if verify_siblings:
        damaged = [
            name
            for name, payload in siblings_before.items()
            if check.read_stream(name) != payload
        ]
        if damaged:
            raise WriteRefused(
                f"sibling streams changed unexpectedly: {damaged}. Restore from "
                f"{backups[0].parent if backups else '<no backup>'}"
            )

    return {
        "applied": True,
        "target": str(plan.target),
        "stream": plan.stream,
        "before_bytes": len(plan.before),
        "after_bytes": len(plan.after),
        "siblings_verified": len(siblings_before) if verify_siblings else 0,
        "backups": [str(b) for b in backups],
        "backup_pairs": backup_pairs,
        "notes": plan.notes,
        "next": "Open MotionWorks IEC and run Build -> Rebuild Project, then Make.",
    }


# ---------------------------------------------------------------------------
# Description editing (.VB only)
# ---------------------------------------------------------------------------


def _description_pattern(name: str) -> re.Pattern[str]:
    """Match a variable's declaration line, including any trailing description.

    Descriptions are the last thing on the declaration line, which is what makes
    them safely replaceable by text substitution.  The trailing ``(*...*)`` is
    part of the match so that removing a description actually removes it rather
    than leaving the old comment in place.

    The match is deliberately **greedy to the last ``*)`` on the line**.  Real
    projects contain nested-looking comments --
    ``(*SGDV Linear - 1 (* Do Not Modify!! *) *)`` -- and a non-greedy match stops
    at the inner ``*)``, orphaning the outer one and corrupting the line.  The
    reader in :mod:`motionworks_iec_mcp.variables` resolves the same text greedily,
    so the two must agree or a write cannot be read back as it was written.

    The description group is anchored to the end of its line and its body is
    bounded to that line, matching greedily to the **last** ``*)``.  Both details
    are load-bearing, and each was found the hard way:

    * a non-greedy body stops at the first ``*)``, so a nested-looking description
      like ``(*SGDV Linear - 1 (* Do Not Modify!! *) *)`` loses its outer
      delimiter -- but a body that is not bounded to the line matches across lines
      and swallows the declarations that follow;
    * the anchor must tolerate a carriage return.  Declaration text uses CRLF, and
      in multiline mode ``$`` matches *before* the ``\\n``, so the ``\\r`` still
      has to be consumed.  Omitting it makes descriptions undetectable in every
      real project, which is how the first version of this fix regressed.
    """
    return re.compile(
        rf"(?m)^([ \t]*{re.escape(name)}[ \t]*(?:AT[ \t]+\S+[ \t]*)?:[^\r\n;]*;)"
        rf"([ \t]*\(\*(?P<desc>[^\r\n]*)\*\)[ \t\r]*$)?",
        re.IGNORECASE,
    )


def set_variable_description(
    text: str, name: str, description: str | None
) -> tuple[str, list[str]]:
    """Return ``text`` with ``name``'s description set (or removed if None).

    Only ``.VB`` text is involved.  Verified by inspection that MotionWorks does
    not store descriptions in ``.VGR`` at all, so no binary edit is required --
    which is why this is the safest write the server offers.
    """
    notes: list[str] = []
    pattern = _description_pattern(name)
    matches = list(pattern.finditer(text))
    if not matches:
        # Fall back to a looser match that also accepts a line without ';'.
        loose = re.compile(
            rf"(?m)^([ \t]*{re.escape(name)}[ \t]*:[^\r\n]*?)(\r?\n|$)",
            re.IGNORECASE,
        )
        candidates = [m for m in loose.finditer(text) if m.group(1).strip()]
        if not candidates:
            raise WriteRefused(
                f"variable {name!r} was not found in the declaration text"
            )
        match = candidates[0]
        line = match.group(1)
        ending = match.group(2) or ""
        body = _strip_comment(line)
        replacement = body + (f"(*{description}*)" if description else "")
        return text[: match.start()] + replacement + ending + text[match.end():], [
            f"{name}: rewrote a declaration line that had no trailing ';'"
        ]

    if len(matches) > 1:
        notes.append(
            f"{name!r} appears on {len(matches)} lines; only the first was changed"
        )

    match = matches[0]
    body = _strip_comment(match.group(1))
    replacement = body + (f"(*{description}*)" if description else "")
    return text[: match.start()] + replacement + text[match.end():], notes


def _strip_comment(prefix: str) -> str:
    """Remove a trailing ``(*...*)`` and only the whitespace that joined it.

    Greedy, to match :func:`_description_pattern` and the reader: a description can
    contain a nested-looking ``*)``, and stopping at the first one leaves an
    orphaned delimiter behind.

    Blanket ``rstrip()`` is wrong here: a description may legitimately end with a
    space inside the comment -- ``(*SGD7S - 1 (Do Not Modify!!) *)`` does -- and
    stripping it changes content a later write cannot restore.
    """
    without = re.sub(r"\(\*[^\r\n]*\*\)[ \t\r]*$", "", prefix)
    # Drop only the separator space(s) between the declaration and the comment.
    return without.rstrip(" \t")


def _refuse_global_write(pou_name: str | None, action: str) -> None:
    """Refuse a GLOBAL declaration write, because it cannot be done safely.

    ``_declaration_target`` writes a global into the resource's ``Global_Variables.VB``
    text stream and nothing else, but the resource ALSO holds ``Global_Variables.VGR``,
    a binary grid whose header carries the declaration count and whose records carry the
    variables themselves.

    Measured, and this is the whole problem: after a global add the .VB declares 162
    while the grid header still says 161, and the compiler then rejects the ENTIRE
    global table - not just the new variable. The build reports 125
    "No matching global variable found" errors naming globals that were never touched,
    including system tags like PLCMODE_RUN, and every POU in the project fails at once.
    The failing build then drops a task assignment as well, so the project ends up both
    uncompilable and missing a task, which reads exactly like corruption.

    Bumping the grid header count is NOT sufficient either - tested - it takes 125
    errors down to 29 but leaves the project broken, because the count and the records
    have to agree and a new variable needs a real record.

    So the honest behaviour is to refuse, and say why. POU-scoped declarations are
    unaffected: their grid is not consulted the same way (which is what the original
    "the compiler does not require the .VGR grid to be updated" note measured, on POU
    declarations only).
    """
    # Globals ARE writable after all. This function used to refuse them outright, on the
    # reasoning that a global lives in two stores - the Global_Variables.VB text and the
    # Global_Variables.VGR binary grid - and that writing only the text breaks the build.
    #
    # That reasoning was WRONG, and the measurement that disproved it is worth recording
    # because the evidence for it looked strong: a run that added a global AND assigned a
    # POU to a task produced 125 "No matching global variable found" errors, and the same
    # run showed the .VB declaring 162 variables while the grid header still said 161. The
    # mismatch was blamed for the errors.
    #
    # Isolated, a .VB-only global add is FINE:
    #
    #     add a global (text only)   text=162  grid=161  MISMATCH
    #     open the project           text=162  grid=161  MISMATCH
    #     save through the IDE       text=162  grid=161  MISMATCH
    #     BUILD                      is_compiled=true   0 reference problems
    #
    # The grid count never catches up and it does not matter - the compiler takes the
    # declarations from the text. The 125 errors were caused by the TASK ASSIGNMENT, not
    # by the global. So globals are written normally, and the mismatch is reported as a
    # diagnostic by the read path rather than treated as a reason to refuse.
    return None


def _declaration_target(
    project_root: Path, pou_name: str | None
) -> tuple[Path, str, bytes, str]:
    """Resolve ``(source_path, stream_name, current_bytes, text)``.

    ``pou_name`` of None targets the project's global variables.
    """
    from . import project as P

    proj = P.Project(root=project_root)
    if pou_name:
        pou = proj.pou(pou_name)
        source = pou.source_path
        stream = pou.declaration_stream_name()
        if stream is None:
            raise WriteRefused(f"POU {pou_name!r} has no declaration stream")
    else:
        source = proj.resource_source()
        if source is None:
            raise WriteRefused("no resource src.st1 found for global variables")
        candidates = [
            n for n in CompoundFile(source).stream_names() if n.upper().endswith(".VB")
        ]
        if not candidates:
            raise WriteRefused("resource src.st1 has no textual declaration stream")
        stream = candidates[0]

    cfb = CompoundFile(source)
    before = cfb.read_stream(stream)
    return source, stream, before, before.decode("latin1")


def _reference_check(
    project_root: Path,
    variable: str,
    excluding_pou: str | None,
    include_named_pou: str | None = None,
) -> list[str]:
    """POUs whose body references ``variable``.

    ``excluding_pou`` omits a POU entirely; ``include_named_pou`` force-includes
    one.  For a delete the declaring POU's *own* body must be searched, because a
    POU-local variable is most likely used there -- the first version of this
    check excluded it and consequently failed to catch a delete that broke the
    build.
    """
    from . import project as P
    from .declarations import find_referencing_pous

    proj = P.Project(root=project_root)
    bodies: dict[str, str] = {}
    for pou in proj.pous():
        if excluding_pou and pou.name.casefold() == excluding_pou.casefold():
            if not (
                include_named_pou
                and pou.name.casefold() == include_named_pou.casefold()
            ):
                continue
        try:
            body = pou.st_body()
        except Exception:  # noqa: BLE001 - an unreadable POU cannot be checked
            continue
        if body:
            bodies[pou.name] = body
    return find_referencing_pous(variable, bodies)


def plan_variable_add(
    project_root: Path,
    pou_name: str | None,
    name: str,
    type_name: str,
    section: str = "VAR",
    address: str | None = None,
    initial_value: str | None = None,
    description: str | None = None,
) -> WritePlan:
    """Plan adding a variable declaration.

    Touches only the textual ``.VB`` stream.  For a POU-scoped declaration that is
    sufficient - measured, the compiler does not consult the POU's ``.VGR`` grid for a
    declaration change.  For a GLOBAL it is NOT, which is why that case is refused
    outright; see ``_refuse_global_write``.
    """
    _refuse_global_write(pou_name, 'add')
    from .declarations import add_variable

    source, stream, before, text = _declaration_target(project_root, pou_name)
    updated, notes = add_variable(
        text, name, type_name, section=section, address=address,
        initial_value=initial_value, description=description,
    )
    return WritePlan(
        target=source, stream=stream, before=before,
        after=updated.encode("latin1"), notes=notes,
    )


def plan_variable_edit(
    project_root: Path,
    pou_name: str | None,
    name: str,
    new_name: str | None = None,
    type_name: str | None = None,
    address: str | None = None,
    initial_value: str | None = None,
    description: str | None = None,
    clear_address: bool = False,
    force: bool = False,
) -> WritePlan:
    """Plan editing an existing declaration in place.

    Refuses a type change that contradicts an ``AT`` bit address, because that
    cannot compile.  Observed directly: retyping an I/O-mapped ``BOOL AT
    %IX21488.5`` as ``DINT`` failed the build, while the same change on an
    unaddressed variable compiled cleanly.  Pass ``force=True`` to override.
    """
    _refuse_global_write(pou_name, 'edit')
    from . import project as P
    from .declarations import (
        _find_declaration_line,
        check_address_type,
        edit_variable,
        split_lines,
    )

    source, stream, before, text = _declaration_target(project_root, pou_name)

    # Resolve the effective address so the type/address pairing can be checked.
    lines, _ = split_lines(text)
    index = _find_declaration_line(lines, name)
    probe = "\r\nVAR\r\n" + lines[index] + "\r\nEND_VAR\r\n"
    parsed = parse_declarations(probe)
    current = parsed.variables[0] if parsed.variables else None
    effective_address = (
        None if clear_address else (address if address is not None
                                    else (current.address if current else None))
    )
    effective_type = (
        type_name if type_name is not None
        else (current.type_name if current else "")
    )
    notes_extra: list[str] = []
    warning = check_address_type(effective_address, effective_type)
    if warning:
        if not force:
            raise WriteRefused(
                f"{warning}. Changing the address or using a compatible type "
                f"would work; pass force=True to write it anyway."
            )
        notes_extra.append(f"FORCED despite: {warning}")

    updated, notes = edit_variable(
        text, name, new_name=new_name, type_name=type_name, address=address,
        initial_value=initial_value, description=description,
        clear_address=clear_address,
    )

    # A rename leaves the old name dangling in any body that used it.
    if new_name and new_name != name:
        referencing = _reference_check(project_root, name, pou_name)
        if referencing:
            if not force:
                raise WriteRefused(
                    f"{name!r} is still referenced by {', '.join(referencing)}; "
                    f"renaming it would break those references. Update the code "
                    f"first, or pass force=True."
                )
            notes_extra.append(
                f"FORCED rename while referenced by: {', '.join(referencing)}"
            )

    return WritePlan(
        target=source, stream=stream, before=before,
        after=updated.encode("latin1"), notes=notes + notes_extra,
    )


def plan_variable_delete(
    project_root: Path,
    pou_name: str | None,
    name: str,
    force: bool = False,
) -> WritePlan:
    """Plan removing a declaration.

    Refuses while any POU body still references the variable, because that
    produces a dangling reference and a failed build.  Observed directly:
    deleting a referenced POU-local variable failed to compile, while deleting
    an unreferenced global variable compiled cleanly.  Pass ``force=True`` to
    override.
    """
    _refuse_global_write(pou_name, 'delete')
    from .declarations import delete_variable

    source, stream, before, text = _declaration_target(project_root, pou_name)

    referencing = _reference_check(
        project_root, name, excluding_pou=None, include_named_pou=pou_name
    )
    notes: list[str] = []
    if referencing:
        if not force:
            raise WriteRefused(
                f"{name!r} is still referenced by {', '.join(referencing)}. "
                f"Deleting it would leave a dangling reference and the build "
                f"would fail. Remove those uses first, or pass force=True."
            )
        notes.append(f"FORCED delete while referenced by: {', '.join(referencing)}")

    updated, transform_notes = delete_variable(text, name)
    return WritePlan(
        target=source, stream=stream, before=before,
        after=updated.encode("latin1"), notes=notes + transform_notes,
    )


def apply_declaration(plan: WritePlan, project_root: Path, dry_run: bool = False) -> dict[str, object]:
    """Apply a declaration plan (add, edit or delete)."""
    return _apply(plan, project_root, dry_run=dry_run)


def plan_variable_description(
    project_root: Path,
    pou_name: str | None,
    variable: str,
    description: str | None,
) -> WritePlan:
    """Build the plan for a description change without writing anything.

    ``pou_name`` of None targets the project's global variables.
    """
    from . import project as P

    proj = P.Project(root=project_root)
    if pou_name:
        pou = proj.pou(pou_name)
        source = pou.source_path
        stream = pou.declaration_stream_name()
        if stream is None:
            raise WriteRefused(f"POU {pou_name!r} has no declaration stream")
    else:
        source = proj.resource_source()
        if source is None:
            raise WriteRefused("no resource src.st1 found for global variables")
        cfb_names = CompoundFile(source).stream_names()
        candidates = [n for n in cfb_names if n.upper().endswith(".VB")]
        if not candidates:
            raise WriteRefused("resource src.st1 has no textual declaration stream")
        stream = candidates[0]

    cfb = CompoundFile(source)
    before = cfb.read_stream(stream)
    text = before.decode("latin1")
    updated, notes = set_variable_description(text, variable, description)
    return WritePlan(
        target=source,
        stream=stream,
        before=before,
        after=updated.encode("latin1"),
        notes=notes,
    )


def apply_plan(plan: WritePlan, project_root: Path, dry_run: bool = False) -> dict[str, object]:
    """Back up, write, and verify a plan.  Returns a result summary."""
    return _apply(plan, project_root, dry_run=dry_run)


# ---------------------------------------------------------------------------
# Structured Text body replacement (.STB only)
# ---------------------------------------------------------------------------


def plan_st_body(
    project_root: Path,
    pou_name: str,
    body: str,
    run_lint: bool = True,
) -> WritePlan:
    """Build the plan for replacing a POU's Structured Text body.

    Only the ``.STB`` stream changes.  The body does not reference the variable
    grid, so this needs no binary grid edit and no project-tree edit.

    Refuses graphical POUs (their logic is proprietary binary), compressed
    declaration streams, and -- when ``run_lint`` is set -- a body whose new
    variables would be undeclared.
    """
    from . import project as P
    from .stlint import lint

    proj = P.Project(root=project_root)
    pou = proj.pou(pou_name)

    found = pou.body_stream()
    if found is None:
        raise WriteRefused(f"POU {pou_name!r} has no body stream")
    stream, language = found
    if language != "ST":
        raise WriteRefused(
            f"POU {pou_name!r} is {language} (graphical). Its body is proprietary "
            f"binary and is not replaced as text; transplanting a proven body is "
            f"the supported route."
        )

    # A POU whose declarations cannot be read cannot be safely checked.
    table = pou.declarations()
    if table.warnings and not table.variables and table.source_stream is None:
        raise WriteRefused(
            f"declarations for {pou_name!r} are unreadable, so the new body "
            f"cannot be validated: {'; '.join(table.warnings)}"
        )

    notes: list[str] = []
    # Read the current body first, so the new one can follow its conventions.
    cfb = CompoundFile(pou.source_path)
    before = cfb.read_stream(stream)

    normalised = body.replace("\r\n", "\n").replace("\r", "\n")
    normalised = normalised.replace("\n", "\r\n")
    # An empty body stays empty.  Appending a CRLF to it would turn a no-op into a
    # two-byte write, so replacing an empty body with itself would change the file
    # -- which a stress matrix caught, since some POUs legitimately have a zero-byte
    # body stream.
    #
    # A trailing newline is only added when the body would otherwise have none *and*
    # the existing stream ends with one.  `st_body()` reports the body without a
    # final newline even when the stored stream has one, so consulting the stream is
    # what keeps a same-body write a true no-op instead of growing the file by two
    # bytes every time.
    stream_ends_with_newline = before.endswith(b"\n")
    if (
        normalised
        and not normalised.endswith("\r\n")
        and stream_ends_with_newline
    ):
        normalised += "\r\n"
        notes.append("added a trailing CRLF to the body")

    if run_lint:
        declared = {v.name for v in table.variables}
        locals_only = {v.name for v in table.variables if not v.is_external}
        fb_types = {v.name for v in table.variables if v.is_fb_instance}
        result = lint(
            normalised,
            declared=declared,
            known_symbols=P.known_symbol_names(proj),
            fb_instance_types=fb_types,
            local_vars=locals_only,
        )
        errors = [f for f in result.findings if f.severity == "error"]
        if errors:
            detail = "\n  ".join(f.message for f in errors[:8])
            raise WriteRefused(
                f"the new body has lint errors and was not written:\n  {detail}\n"
                f"Pass run_lint=False to override, but expect the build to fail."
            )
        warnings = [f for f in result.findings if f.severity == "warning"]
        if warnings:
            notes.append(f"{len(warnings)} lint warning(s) present")

    after = normalised.encode("latin1")

    # A guard used to refuse growing a mini stream past the cutoff, because the
    # container writer corrupted that promotion.  The container defect is fixed and
    # verified (a stream promoted from 809 to 18016 bytes reads back exactly, and so
    # does the restore), so the restriction is gone: twelve ST POUs across the
    # sample projects keep their body as a mini stream, and refusing would have
    # blocked a large body edit on every one of them.
    return WritePlan(
        target=pou.source_path,
        stream=stream,
        before=before,
        after=after,
        notes=notes,
    )


def plan_st_body_from_file(
    project_root: Path,
    pou_name: str,
    body_path: Path,
    run_lint: bool = True,
) -> WritePlan:
    """Plan an ST body replacement taking the new body from a file.

    Preferred over passing the body inline for anything sizeable: real ST bodies
    run to tens of kilobytes (the largest in the sample projects is 30,405
    characters), which is awkward and error-prone to move through a JSON tool
    argument.
    """
    body_path = Path(body_path)
    if not body_path.is_file():
        raise WriteRefused(f"body file not found: {body_path}")
    try:
        text = body_path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        text = body_path.read_text(encoding="latin1")
    plan = plan_st_body(project_root, pou_name, text, run_lint=run_lint)
    plan.notes.append(f"body read from {body_path}")
    return plan


def apply_st_body(plan: WritePlan, project_root: Path, dry_run: bool = False) -> dict[str, object]:
    """Apply a Structured Text body plan."""
    return _apply(plan, project_root, dry_run=dry_run)
