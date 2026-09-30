"""Offline ST and synchronized declaration/grid writers.

Plans preserve native control markers, worksheet trailers and untouched streams.
The request dispatcher wraps mutations in full-project snapshot transactions.
Read-back validation is separate from IDE Rebuild/Make acceptance.
"""

from __future__ import annotations

import re
import shutil
import struct
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from .cfb import CfbError, CompoundFile
from .errors import MotionWorksError, NotFound, UnsupportedFormat
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
    # Additional streams in the SAME container that must change with this one. A POU
    # declaration lives in two stores - the .VB text and the .VGR grid - and the compiler
    # resolves variables from the grid, so writing only the text leaves a declaration that
    # reads back but cannot be used. They are carried here so both are written and verified
    # in one operation rather than two.
    extra_streams: dict[str, bytes] = field(default_factory=dict)
    sidecars: dict[Path, tuple[bytes | None, bytes]] = field(default_factory=dict)

    @property
    def changed(self) -> bool:
        return self.before != self.after or bool(self.extra_streams) or bool(self.sidecars)

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
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
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
    from .staging import assert_proven, assert_staged
    assert_proven(project_root)
    assert_staged(plan.target)
    for path, (before, after) in plan.sidecars.items():
        assert_staged(path)
        if path.parent.resolve() != plan.target.parent.resolve():
            raise WriteRefused("Sidecar must belong to the edited container directory")
        if (path.read_bytes() if path.exists() else None) != before:
            raise WriteRefused("Sidecar changed after planning")
    if not plan.changed:
        return {
            "applied": False,
            "reason": "no change required",
            "target": str(plan.target),
            "stream": plan.stream,
        }

    if not dry_run:
        require_ide_closed()

    cfb = CompoundFile(plan.target)
    if cfb.read_stream(plan.stream) != plan.before:
        raise WriteRefused("The source changed after planning; read and plan again")
    siblings_before = {
        name: cfb.read_stream(name)
        for name in cfb.stream_names()
        if name != plan.stream and name not in plan.extra_streams
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

    backups = backup_files([plan.target, *plan.sidecars], project_root)

    # Record where each backup came from, explicitly.  Recovering the original
    # path by searching the backup path for the project name is fragile: a name
    # can appear more than once in the path, and the match then lands in the
    # wrong place, so a restore would write to the wrong location.
    backup_pairs = [
        {"original": str(original), "backup": str(created)}
        for original, created in zip([p for p in [plan.target, *plan.sidecars] if p.is_file()], backups)
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
        writes = {plan.stream: plan.after}
        writes.update(plan.extra_streams)
        cfb.replace_streams(writes, destination=scratch)
        staged = CompoundFile(scratch)
        written = staged.read_stream(plan.stream)
        if written != plan.after:
            raise WriteRefused(
                f"refusing to write {plan.target.name}: the container writer did not "
                f"reproduce {plan.stream!r} ({len(plan.after)} bytes in, "
                f"{len(written)} out). Nothing was written; this is a known defect in "
                f"growth handling, not a problem with your edit."
            )
        for extra_name, extra_payload in plan.extra_streams.items():
            if staged.read_stream(extra_name) != extra_payload:
                raise WriteRefused(f"Paired stream failed pre-commit verification: {extra_name}")
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

    # The REAL write must carry the extra streams too. The scratch verification above
    # already did, which is exactly what made this hard to see: the plan was right, the
    # dry run was right, the verification was right, and only the commit wrote one stream -
    # so a declaration landed in the .VB and never in the .VGR, and the tool reported
    # success while the variable stayed unusable.
    commit = {plan.stream: plan.after}
    commit.update(plan.extra_streams)
    cfb.replace_streams(commit)
    for path, (_, after) in plan.sidecars.items():
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
            handle.write(after)
            pending = Path(handle.name)
        try:
            pending.replace(path)
        finally:
            pending.unlink(missing_ok=True)
        if path.read_bytes() != after:
            raise WriteRefused(f"Sidecar read-back failed: {path}")

    check = CompoundFile(plan.target)
    for name, payload in commit.items():
        if check.read_stream(name) != payload:
            raise WriteRefused(f"Read-back verification failed for {name}")
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


from .variable_edit import add as plan_variable_add, edit as plan_variable_edit, delete as plan_variable_delete


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
    from .stlint import Finding, lint, check_assignment_types

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

    native_prefix = re.match(rb'^(?:\(\*[^*]*[\x00-\x08\x0b-\x1f][\s\S]*?\*\)(?:\r\n|\n)*)+', before)
    if native_prefix and not normalised.encode("latin1").startswith(native_prefix.group(0)):
        normalised = native_prefix.group(0).decode("latin1") + normalised
        notes.append("Preserved native leading MotionWorks control markers")

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
            project_globals=P.global_names(proj),
        )
        errors = [f for f in result.findings if f.severity == "error"]

        # A type error does not merely fail a build. Measured: assigning a UINT to a BOOL makes
        # the builder DESTROY the POU - .VB to 0 bytes and the grid to 79,432,063 bytes - while
        # a type-correct body with a different fault stalls harmlessly and leaves it intact. So
        # a type error is refused here, alongside the undeclared-symbol errors above, and the
        # body never reaches the compiler. Built as its own list and extended, so it cannot
        # depend on the order these lines run in.
        _types = {}
        for _v in table.variables:
            _n = getattr(_v, 'name', None)
            _t = getattr(_v, 'type_name', None)
            if _n and _t:
                _types[_n] = _t
        errors.extend(
            Finding(
                severity='error',
                code='type-mismatch',
                message=(
                    f"line {_line}: assigning a {_got.upper()} to '{_target}', which is "
                    f"{_want} - a type error makes the build DESTROY this POU rather than "
                    f"report it, so the body is refused"
                ),
                line=_line,
                hint='Convert the value explicitly, or declare a variable of the right type.',
            )
            for _line, _target, _want, _got in check_assignment_types(normalised, _types)
        )

        # ── a real compiler, when the machine has one ────────────────────────────────
        #
        # The checks above are hand-written and catch what they were written for. This asks an actual
        # IEC 61131-3 compiler, which knows considerably more - and it fails soft, because a missing
        # tool must never stop a write that would otherwise be fine.
        if run_lint:
            try:
                from . import iec as _iec

                _diagnostics = _iec.validate_pou(pou_name, table, normalised)
                if _diagnostics is None:
                    notes.append("not checked by an IEC compiler (none available)")
                else:
                    notes.append(_iec.summary(_diagnostics))
                    for _d in _diagnostics:
                        errors.append(Finding(
                            severity="error",
                            code=_d.code,
                            message=f"IEC compiler: {_d.as_text()}",
                            line=_d.line,
                            hint="Fix the statement; a real compiler rejected it before it was written.",
                        ))
            except Exception as _exc:  # a broken compiler must never block a write
                notes.append(f"IEC compiler check skipped: {type(_exc).__name__}")

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
