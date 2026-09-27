"""FastMCP tool surface for offline Yaskawa MotionWorks IEC 3 Pro projects.

Run over stdio::

    motionworks-iec-mcp

Tier 1 tools (``mw_*``) are read-only and safe to call while MotionWorks IEC is
open.  They are the majority of this module on purpose: an agent that can read
the project accurately needs far less help writing to it.

Design rules that all tools follow:

* Return readable text, not raw JSON dumps.  The caller is a language model;
  a compact labelled report is more useful than a serialised object.
* Never guess.  When something is unsupported (MotionWorks' compressed stream
  container), say so explicitly and name the affected POUs.
* Resolve ``project`` leniently: full path, ``.mwt`` file, or a bare name.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from mcp.server.fastmcp import FastMCP

from . import project as P
from .errors import MotionWorksError, NotFound, ProjectNotFound, UnsupportedFormat
from .variables import Variable

INSTRUCTIONS = """\
Read and (in later tiers) safely edit offline Yaskawa MotionWorks IEC 3 Pro
projects on disk.

The project on disk is an expanded directory (containing POE/, C/, src.st1)
beside a small .mwt wrapper file.  POU sources are OLE/CFB compound files: each
POU stores its variables as text in <POU>V.VB and its body in <POU>.STB
(Structured Text) or <POU>.GB (graphical ladder/FBD).

Critical workflow rules:
1. These tools never build.  After any edit you MUST open MotionWorks IEC and
   run Build -> Rebuild Project, then Make.  Rebuild is required because tmp.sto
   caches are stale after external edits.
2. Never trust tmp.sto.  It is build output, not source.
3. Do not download to a controller or command motion.
4. Read mw_get_symbol before referencing any symbol, so you do not invent names.
5. Graphical LD/FBD bodies cannot be authored byte-by-byte.  Copy a working
   body from a donor POU of the same language instead.
"""

#: log_level is raised to WARNING so the SDK does not emit an INFO line to
#: stderr for every request.  MCP uses stdout for the protocol, but noisy stderr
#: still clutters agent logs and can be mistaken for a problem.
mcp = FastMCP("motionworks-iec", instructions=INSTRUCTIONS, log_level="WARNING")

#: Search root used when a tool is given a bare project name.  Overridable so a
#: user with projects elsewhere does not need to pass full paths everywhere.
SEARCH_ROOT_ENV = "MOTIONWORKS_MCP_ROOT"
DEFAULT_SEARCH_ROOT = "Yaskawa"


def _search_root() -> Path:
    configured = os.environ.get(SEARCH_ROOT_ENV)
    if configured:
        return Path(configured)
    return Path(DEFAULT_SEARCH_ROOT)


def _project(project: str | None) -> P.Project:
    """Resolve a project argument, falling back to a sensible default.

    Resolution order: explicit argument, then an ancestor of the current
    working directory that looks like a project, then the only discovered
    project.  This keeps the common case (one project, agent opened in it) free
    of ceremony while still refusing to guess when several are present.
    """
    if project:
        return P.resolve(project, _search_root())

    # Walk up from cwd looking for a project root.
    cwd = Path.cwd().resolve()
    for candidate in (cwd, *cwd.parents):
        if P.looks_like_project(candidate):
            return P.Project(root=candidate)

    found = P.discover(_search_root())
    if len(found) == 1:
        return P.Project(root=found[0])
    if not found:
        raise ProjectNotFound(
            f"No project given and none discovered under {_search_root()}. "
            f"Pass the project path, or set {SEARCH_ROOT_ENV}."
        )
    listing = "\n  ".join(str(p) for p in found)
    raise ProjectNotFound(
        f"No project given and {len(found)} were discovered; pass one of:\n  {listing}"
    )


def _fail(exc: Exception) -> str:
    """Render an error as an actionable message instead of a stack trace."""
    if isinstance(exc, MotionWorksError):
        return f"ERROR: {exc}"
    return f"ERROR ({type(exc).__name__}): {exc}"


def _format_variables(variables: list[Variable], indent: str = "  ") -> list[str]:
    """Render declarations grouped by block, with a classification per line."""
    lines: list[str] = []
    section = None
    for variable in variables:
        if variable.section != section:
            section = variable.section
            lines.append(f"{indent}[{section}]")
        flags = []
        if variable.is_external:
            flags.append("external")
        elif variable.is_fb_instance:
            flags.append("fb-instance")
        suffix = f"   ({', '.join(flags)})" if flags else ""
        lines.append(f"{indent}{variable.format_line()}{suffix}")
    return lines


def _format_library(entry: str) -> str:
    """Render one ``@LIBRARY.LST`` line as ``[KIND] name (path)``.

    The list is semicolon-separated as ``kind;path;name;version``.  For ``USER``
    entries MotionWorks writes the literal ``LIST`` as the name, so the real
    library name has to come from the final path component.
    """
    parts = entry.split(";")
    kind = parts[0].strip() if parts else "?"
    path = parts[1].strip() if len(parts) > 1 else ""
    name = parts[2].strip() if len(parts) > 2 else ""
    if not name or name.upper() == "LIST":
        # Derive from the directory name, which is the library's real identity.
        name = Path(path).name or name or entry
    return f"[{kind}] {name}" + (f"   ({path})" if path else "")


# ---------------------------------------------------------------------------
# Tier 1 - discovery
# ---------------------------------------------------------------------------


@mcp.tool()
def mw_list_projects(search_root: str | None = None) -> str:
    """List every expanded MotionWorks IEC project found on disk.

    Call this first when you do not know the project path.  Returns each
    project's name, full path, POU count by language, and last-change stamp.

    Args:
        search_root: Directory to search. Defaults to the configured root.
    """
    root = Path(search_root) if search_root else _search_root()
    try:
        projects = P.describe_all(root)
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)
    if not projects:
        return (
            f"No expanded MotionWorks projects found under {root}.\n"
            f"A project directory must contain a POE subdirectory. "
            f"Set {SEARCH_ROOT_ENV} if your projects live elsewhere."
        )
    lines = [f"{len(projects)} project(s) under {root}:"]
    for entry in projects:
        langs = ", ".join(f"{k}:{v}" for k, v in sorted(entry["languages"].items()))
        lines.append(f"\n{entry['name']}")
        lines.append(f"  path        : {entry['root']}")
        lines.append(f"  POUs        : {entry['pou_count']} ({langs})")
        lines.append(f"  last change : {entry['last_change']}")
    return "\n".join(lines)


@mcp.tool()
def mw_project_summary(project: str | None = None) -> str:
    """Report structure for one project: POUs, tasks, libraries, and files.

    Use this to orient yourself before reading or editing: it shows the task
    assignments and library references that constrain what code can legally do.

    Args:
        project: Project path, .mwt file, or bare project name.
    """
    try:
        proj = _project(project)
        info = proj.inventory()
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)

    lines = [
        f"Project      : {info['name']}",
        f"Root         : {info['root']}",
        f"MWT wrapper  : {info['mwt']}",
        f"Last change  : {info['last_change']}",
        f"Resource src : {info['resource_source']}",
        f"POUs         : {info['pou_count']} "
        f"({', '.join(f'{k}:{v}' for k, v in sorted(info['languages'].items()))})",
    ]

    tasks: dict[str, list[str]] = info["tasks"]  # type: ignore[assignment]
    lines.append(f"\nTasks ({len(tasks)}):")
    if tasks:
        for task, programs in tasks.items():
            assigned = ", ".join(programs) if programs else "<none>"
            lines.append(f"  {task:12} <- {assigned}")
    else:
        lines.append("  <none recorded in NODES.LST>")

    libraries: list[str] = info["libraries"]  # type: ignore[assignment]
    lines.append(f"\nLibraries ({len(libraries)}):")
    for entry in libraries:
        lines.append(f"  {_format_library(entry)}")

    streams: dict[str, int] = info["tree_streams"]  # type: ignore[assignment]
    if streams:
        lines.append(f"\nProject src.st1 streams: {streams}")

    lines.append("\nPOUs:")
    for pou in proj.pous():
        streams_n = len(pou.stream_names())
        lines.append(
            f"  {pou.name:24} {pou.language() or '?':3} "
            f"{streams_n} streams  {pou.directory}"
        )
    return "\n".join(lines)


@mcp.tool()
def mw_list_pous(project: str | None = None) -> str:
    """List the POUs in a project with language and body stream information.

    Args:
        project: Project path, .mwt file, or bare project name.
    """
    try:
        proj = _project(project)
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)

    assignments = proj.task_assignments()
    owner: dict[str, list[str]] = {}
    for task, programs in assignments.items():
        for program in programs:
            owner.setdefault(program.casefold(), []).append(task)

    lines = [f"POUs in {proj.name} ({len(proj.pous())}):"]
    for pou in proj.pous():
        body = pou.body_stream()
        tasks = owner.get(pou.name.casefold(), [])
        lines.append(f"\n{pou.name}")
        lines.append(f"  language : {body[1] if body else '?'}")
        lines.append(f"  body     : {body[0] if body else '<none found>'}")
        lines.append(f"  tasks    : {', '.join(tasks) if tasks else '<unassigned>'}")
        try:
            table = pou.declarations()
            lines.append(f"  variables: {len(table)}")
        except UnsupportedFormat as exc:
            lines.append(f"  variables: UNREADABLE - {exc}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Tier 1 - variables
# ---------------------------------------------------------------------------


@mcp.tool()
def mw_get_variables(
    pou: str | None = None,
    project: str | None = None,
) -> str:
    """Read variable declarations for one POU, or the project's globals.

    Omit ``pou`` to read ``VAR_GLOBAL`` declarations from the resource.  Each
    variable is reported with its block (VAR / VAR_EXTERNAL), address, type,
    default value, description, and a classification:

    * ``external``    - declared VAR_EXTERNAL: owned by another POU or globally
    * ``fb-instance`` - a function-block instance (stateful, needs .CLK etc.)
    * otherwise       - a local value owned by this POU

    Args:
        pou: POU name. Omit for global variables.
        project: Project path, .mwt file, or bare project name.
    """
    try:
        proj = _project(project)
        if pou:
            table = proj.pou(pou).declarations()
            title = f"Variables of POU {proj.pou(pou).name} in {proj.name}"
        else:
            table = proj.global_variables()
            title = f"Global variables of {proj.name}"
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)

    lines = [f"{title} ({len(table)} variables)"]
    if table.source_stream:
        lines.append(f"Source stream: {table.source_stream}")
    for note in table.warnings:
        lines.append(f"WARNING: {note}")
    lines.append("")
    lines.extend(_format_variables(table.variables))
    if not table.variables:
        lines.append("  <no variables>")
    return "\n".join(lines)


@mcp.tool()
def mw_find_symbol(symbol: str, project: str | None = None) -> str:
    """Find every declaration of a symbol across the whole project.

    Use this before referencing any symbol so you do not invent a name that does
    not exist, and to discover which POU owns a symbol you need.

    Args:
        symbol: Exact symbol name (case-insensitive).
        project: Project path, .mwt file, or bare project name.
    """
    try:
        proj = _project(project)
        found = P.find_symbol(proj, symbol)
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)

    if not found:
        index = P.symbol_index(proj)
        close = [n for n in index if symbol.casefold() in n.casefold()][:15]
        lines = [f"Symbol {symbol!r} is NOT declared anywhere in {proj.name}."]
        if close:
            lines.append("Names containing that text:")
            lines.extend(f"  {n}" for n in close)
        else:
            lines.append(
                "It may come from a library (see mw_project_summary for the "
                "library list) or from device I/O configuration."
            )
        return "\n".join(lines)

    lines = [f"{symbol!r} declared {len(found)} time(s) in {proj.name}:"]
    for variable in found:
        lines.append(f"  [{variable.section}] {variable.format_line()}")
    if len(found) > 1:
        lines.append(
            "\nNOTE: multiple declarations exist. MotionWorks requires the "
            "owner to hold a real VAR and every other POU to use VAR_EXTERNAL."
        )
    return "\n".join(lines)


@mcp.tool()
def mw_symbol_index(project: str | None = None, limit: int = 400) -> str:
    """List every declared symbol and where it is declared.

    This is a compact cross-reference.  It does not include which lines of code
    use a symbol, only where each symbol is declared.

    Args:
        project: Project path, .mwt file, or bare project name.
        limit: Maximum symbols to list.
    """
    try:
        proj = _project(project)
        index = P.symbol_index(proj)
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)

    lines = [f"{len(index)} declared symbols in {proj.name}:"]
    for name in sorted(index, key=str.casefold):
        where = ", ".join(index[name])
        lines.append(f"  {name:34} {where}")
        if len(lines) > limit:
            lines.append(f"  ... truncated at {limit} lines")
            break
    return "\n".join(lines)


@mcp.tool()
def mw_library_usage(project: str | None = None, limit: int = 60) -> str:
    """Show which function-block and data types the project actually uses.

    Use this to find which library a block comes from, and to pick a donor POU
    that already instantiates a block correctly.

    Args:
        project: Project path, .mwt file, or bare project name.
        limit: Maximum type entries to list.
    """
    try:
        proj = _project(project)
        usage = P.library_usage(proj)
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)

    lines = [f"Declared types in {proj.name} ({len(usage)} distinct):"]
    for name, count in list(usage.items())[:limit]:
        lines.append(f"  {count:3} x {name}")
    if len(usage) > limit:
        lines.append(f"  ... {len(usage) - limit} more")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Tier 1 - code bodies
# ---------------------------------------------------------------------------


@mcp.tool()
def mw_get_st_body(pou: str, project: str | None = None) -> str:
    """Read the Structured Text body of a POU.

    Returns an error for graphical (LD/FBD) POUs, whose bodies are proprietary
    binary and are not text; use mw_pou_streams to inspect those instead.

    Args:
        pou: POU name.
        project: Project path, .mwt file, or bare project name.
    """
    try:
        proj = _project(project)
        info = proj.pou(pou)
        language = info.language()
        if language is None:
            return f"ERROR: POU {pou!r} has no recognisable body stream."
        if language != "ST":
            return (
                f"POU {info.name!r} is {language} (graphical), not Structured Text.\n"
                f"Its body is the binary stream {info.body_stream()[0]!r} and cannot "
                f"be read or edited as text. Use mw_pou_streams to inspect its "
                f"structure, and copy a known-good body from a donor POU rather "
                f"than authoring LD bytes."
            )
        body = info.st_body()
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)

    header = (
        f"--- ST body of {info.name} in {proj.name} "
        f"({len(body or '')} bytes) ---"
    )
    return f"{header}\n{body or ''}"


@mcp.tool()
def mw_pou_streams(pou: str, project: str | None = None) -> str:
    """List the CFB streams inside a POU's src.st1 and their byte sizes.

    Useful for graphical POUs, where the .GB body stream size tells you how much
    logic is in there, and for confirming which streams an edit will touch.

    Args:
        pou: POU name.
        project: Project path, .mwt file, or bare project name.
    """
    try:
        proj = _project(project)
        info = proj.pou(pou)
        source = info.source()
        summary = source.summary()
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)

    body = info.body_stream()
    lines = [
        f"Streams in {info.name}/src.st1 ({info.source_path}):",
    ]
    for name, size in summary.items():
        role = ""
        upper = name.upper()
        if upper.endswith("T.TXT"):
            role = "worksheet comments"
        elif upper.endswith("V.VGR"):
            role = "binary variable grid"
        elif upper.endswith("V.VB"):
            role = "text variable declarations"
        elif upper.endswith(".STB"):
            role = "Structured Text body"
        elif upper.endswith(".GB"):
            role = "graphical LD/FBD body"
        elif upper.endswith(".SN"):
            role = "compression digest sidecar"
        lines.append(f"  {name:34} {size:>8} bytes  {role}")
    lines.append(f"\nLanguage: {body[1] if body else '?'}")
    return "\n".join(lines)


@mcp.tool()
def mw_get_pou_comments(pou: str, project: str | None = None) -> str:
    """Read the worksheet comment stream (``<POU>T.TXT``) of a POU.

    MotionWorks stores free-text worksheet notes here, separate from the body.

    Args:
        pou: POU name.
        project: Project path, .mwt file, or bare project name.
    """
    try:
        proj = _project(project)
        info = proj.pou(pou)
        name = info.comment_stream_name()
        if name is None:
            return f"POU {info.name!r} has no T.TXT comment stream."
        raw = info.source().read_stream(name)
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)
    return f"--- comments of {info.name} ({len(raw)} bytes) ---\n{raw.decode('latin1')}"


# ---------------------------------------------------------------------------
# Tier 1 - integrity
# ---------------------------------------------------------------------------


@mcp.tool()
def mw_snapshot(
    output: str | None = None,
    project: str | None = None,
    include_generated: bool = True,
) -> str:
    """Hash every file in a project and write a JSON manifest.

    Take a snapshot BEFORE any change so you can prove exactly what was touched
    afterwards with mw_diff_snapshot.  This matters because MotionWorks rewrites
    unrelated state on save.

    Args:
        output: Manifest path. Defaults to <project>/.motionworks-snapshot.json.
        project: Project path, .mwt file, or bare project name.
        include_generated: Include tmp.sto build caches and .sn sidecars.
    """
    try:
        from .snapshot import make_manifest, write_manifest

        proj = _project(project)
        target = Path(output) if output else proj.root / ".motionworks-snapshot.json"
        manifest = make_manifest(
            proj.root, exclude=target, include_generated=include_generated
        )
        write_manifest(manifest, target)
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)

    files: dict[str, str] = manifest["files"]  # type: ignore[assignment]
    return (
        f"Snapshot of {proj.name} written.\n"
        f"  manifest : {target}\n"
        f"  files    : {len(files)}\n"
        f"  created  : {manifest['created']}\n"
        f"Use mw_diff_snapshot with this manifest to see what changed."
    )


@mcp.tool()
def mw_diff_snapshot(manifest: str, project: str | None = None) -> str:
    """Report files added, changed, or removed since a snapshot was taken.

    Args:
        manifest: Path to a manifest written by mw_snapshot.
        project: Optional project root override; defaults to the manifest's base.
    """
    try:
        from .snapshot import diff_manifest, load_manifest

        data = load_manifest(Path(manifest))
        base = Path(project) if project else None
        result = diff_manifest(data, base)
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)

    total = sum(len(v) for v in result.values())
    if not total:
        return (
            f"No differences: the tree matches the snapshot exactly "
            f"({len(data['files'])} files, taken {data['created']})."
        )
    lines = [f"{total} difference(s) since snapshot taken {data['created']}:"]
    for kind in ("changed", "added", "missing"):
        entries = result[kind]
        if entries:
            lines.append(f"\n{kind.upper()} ({len(entries)}):")
            lines.extend(f"  {name}" for name in entries[:60])
            if len(entries) > 60:
                lines.append(f"  ... and {len(entries) - 60} more")
    return "\n".join(lines)


@mcp.tool()
def mw_check_project_open(project: str | None = None) -> str:
    """Check whether MotionWorks IEC is running, which blocks safe editing.

    Read-only tools work either way.  Any Tier 2 write will refuse while the IDE
    is open, because the IDE caches project state and would overwrite or
    contradict an external edit.

    If it is running, call `mw_close_motionworks` to close it and proceed, or pass
    `close_ide=True` to a write tool to have it close the IDE itself.

    Args:
        project: Unused; accepted so callers can always pass the project.
    """
    try:
        from . import ide

        procs = ide.motionworks_running()
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)
    if procs:
        listing = "\n".join(
            f"  pid {pid}  {name}"
            + ("  (main)" if name.casefold() in ide.MAIN_PROCESSES else "  (helper)")
            for pid, name in procs
        )
        return (
            f"MotionWorks IEC IS RUNNING ({len(procs)} process(es)):\n{listing}\n\n"
            f"Close the IDE before any edit, or call mw_close_motionworks. "
            f"Read-only tools are still safe."
        )
    return "MotionWorks IEC is not running. Editing is safe from the IDE's point of view."


@mcp.tool()
def mw_unsupported_streams(project: str | None = None) -> str:
    """List streams this server cannot read, and why.

    MotionWorks compresses some large POU sources into a proprietary container
    (magic ``cadac758``) that is not a standard codec.  Affected POUs cannot be
    read or edited safely by this server.  Check this before promising changes.

    Args:
        project: Project path, .mwt file, or bare project name.
    """
    try:
        proj = _project(project)
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)

    blocked: list[tuple[str, str]] = []
    for pou in proj.pous():
        name = pou.declaration_stream_name()
        if name is None:
            continue
        try:
            pou.declarations()
        except UnsupportedFormat as exc:
            blocked.append((pou.name, str(exc)))
        except Exception as exc:  # noqa: BLE001
            blocked.append((pou.name, f"{type(exc).__name__}: {exc}"))

    try:
        proj.global_variables()
    except UnsupportedFormat as exc:
        blocked.append(("<global variables>", str(exc)))

    if not blocked:
        return f"All readable: no unsupported streams found in {proj.name}."

    lines = [
        f"{len(blocked)} unreadable stream group(s) in {proj.name}:",
        "",
    ]
    for name, why in blocked:
        lines.append(f"{name}")
        lines.append(f"  {why}")
        lines.append("")
    lines.append(
        "Do not attempt to edit variables for these POUs. Their bodies can still "
        "be inspected with mw_pou_streams."
    )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Tier 1 - static analysis
# ---------------------------------------------------------------------------


def _lint_report(result: object, title: str) -> str:
    """Render a LintResult as a readable report."""
    errors = result.errors  # type: ignore[attr-defined]
    warnings = result.warnings  # type: ignore[attr-defined]
    findings = result.findings  # type: ignore[attr-defined]

    if not findings:
        return f"{title}: clean (no findings)."

    lines = [f"{title}: {len(errors)} error(s), {len(warnings)} warning(s)"]
    for finding in findings:
        lines.append("")
        lines.append(finding.format())
    return "\n".join(lines)


@mcp.tool()
def mw_lint_st(pou: str, project: str | None = None) -> str:
    """Statically check the Structured Text body of one POU.

    Catches the mistakes that matter when editing ST offline, while staying
    quiet about anything it cannot resolve (library blocks, struct members,
    function-block pin names).  Checks:

    * ``undefined-assignment-target`` (error) - assigning to a name that is
      declared nowhere. This is the "invented variable" mistake.
    * ``unused-local`` (warning) - a ``VAR`` local never used in the body.
    * ``unassigned-fb-output`` (warning) - a function block is called but none
      of its outputs is read, so the result is discarded.
    * ``unterminated-statement`` (warning) - a statement missing its ``;``.

    Run this after any edit and before handing the project back to rebuild.

    Args:
        pou: POU name.
        project: Project path, .mwt file, or bare project name.
    """
    try:
        from .stlint import lint_pou

        proj = _project(project)
        info = proj.pou(pou)
        known = P.known_symbol_names(proj)
        result = lint_pou(info, known_symbols=known)
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)
    return _lint_report(result, f"Lint of {info.name} in {proj.name}")


@mcp.tool()
def mw_lint_project(project: str | None = None, errors_only: bool = False) -> str:
    """Lint every Structured Text POU in a project.

    Use this to find problems introduced by a set of edits, or to assess an
    unfamiliar project.  Graphical (LD/FBD) POUs are skipped because their logic
    is not text.

    Args:
        project: Project path, .mwt file, or bare project name.
        errors_only: Show only errors, hiding warnings.
    """
    try:
        from .stlint import lint_pou

        proj = _project(project)
        known = P.known_symbol_names(proj)
        blocks: list[str] = []
        total_e = total_w = linted = skipped = 0
        for pou in proj.pous():
            if pou.language() != "ST":
                skipped += 1
                continue
            linted += 1
            result = lint_pou(pou, known_symbols=known)
            total_e += len(result.errors)
            total_w += len(result.warnings)
            if errors_only and not result.errors:
                continue
            if result.findings:
                blocks.append(_lint_report(result, pou.name))
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)

    header = (
        f"Lint of {proj.name}: {linted} ST POU(s) checked, "
        f"{skipped} graphical skipped\n"
        f"TOTAL: {total_e} error(s), {total_w} warning(s)"
    )
    if not blocks:
        return header + (
            "\n\nAll linted POUs are clean."
            if not errors_only or total_e == 0
            else "\n\nNo errors (warnings hidden)."
        )
    return header + "\n\n" + "\n\n".join(blocks)


@mcp.tool()
def mw_set_variable_description(
    variable: str,
    description: str = "",
    pou: str | None = None,
    project: str | None = None,
    dry_run: bool = True,
) -> str:
    """Set or clear one variable's description comment.

    This is the only write the server currently offers, chosen because it needs
    **no binary edit at all**: MotionWorks stores descriptions only in the
    textual ``.VB`` declaration stream and never in the ``.VGR`` binary grid.
    (Verified: description text from real projects appears in ``.VB`` and is
    absent from ``.VGR`` in both latin-1 and UTF-16.)  That makes it the safest
    possible mutation, and the ``.VGR`` stream is confirmed byte-identical
    afterwards.

    Safety behaviour, always enforced:

    * refused while MotionWorks IEC is running -- the IDE holds project state in
      memory and would overwrite or contradict the change;
    * every file is backed up outside the project tree first;
    * the result is read back and every sibling stream is verified unchanged.

    Args:
        variable: Exact variable name.
        description: New description text. Empty string removes the description.
        pou: POU name. Omit to edit the project's global variables.
        project: Project path, .mwt file, or bare project name.
        dry_run: Default True, which only reports what would change. Set to
            False to actually write.
    """
    try:
        from .writer import WriteRefused, apply_plan, plan_variable_description

        proj = _project(project)
        plan = plan_variable_description(
            proj.root, pou, variable, description or None
        )
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)

    where = f"POU {pou}" if pou else "global variables"
    if not plan.changed:
        return (
            f"No change needed: {variable!r} in {where} of {proj.name} already "
            f"has that description state."
        )

    if dry_run:
        return "\n".join(
            [
                f"DRY RUN - nothing written.",
                f"  project : {proj.name}",
                f"  target  : {where}",
                f"  stream  : {plan.stream}",
                f"  size    : {len(plan.before)} -> {len(plan.after)} bytes",
                f"  variable: {variable}",
                f"  new text: {description!r}" if description else "  new text: <removed>",
                *[f"  note    : {n}" for n in plan.notes],
                "",
                "Call again with dry_run=False to apply.",
            ]
        )

    try:
        result = apply_plan(plan, proj.root)
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)

    lines = [
        f"WROTE description for {variable!r} in {where} of {proj.name}.",
        f"  stream           : {result['stream']}",
        f"  size             : {result['before_bytes']} -> {result['after_bytes']} bytes",
        f"  sibling streams  : {result['siblings_verified']} verified unchanged",
    ]
    for backup in result.get("backups", []):
        lines.append(f"  backup           : {backup}")
    for note in result.get("notes", []):
        lines.append(f"  note             : {note}")
    lines.append("")
    lines.append(
        "NEXT: open MotionWorks IEC and run Build -> Rebuild Project, then Make. "
        "The .VGR grid was not modified and does not need to be."
    )
    return "\n".join(lines)


@mcp.tool()
def mw_set_st_body(
    pou: str,
    body: str = "",
    body_file: str = "",
    project: str | None = None,
    run_lint: bool = True,
    dry_run: bool = True,
) -> str:
    """Replace a POU's Structured Text body.

    Only the ``.STB`` stream changes.  A body does not reference the variable
    grid, so this needs no binary grid edit and no project-tree edit -- that is
    why it is one of the two writes the server offers.  The ``.VGR`` grid and
    ``.VB`` declarations are verified byte-identical afterwards.

    Provide the new body either inline with ``body`` or, for anything sizeable,
    with ``body_file`` pointing at a file (real bodies reach tens of kilobytes,
    which is awkward to move through a JSON argument).

    Refused, always:

    * while MotionWorks IEC is running;
    * for graphical (LD/FBD) POUs, whose bodies are proprietary binary --
      transplant a proven body instead;
    * when the new body fails lint, unless ``run_lint=False`` overrides it.

    Args:
        pou: POU name.
        body: New Structured Text, inline. Ignored if body_file is given.
        body_file: Path to a file holding the new body.
        project: Project path, .mwt file, or bare project name.
        run_lint: Refuse the write if the new body has lint errors.
        dry_run: Default True, which only reports what would change.
    """
    try:
        from .writer import apply_st_body, plan_st_body, plan_st_body_from_file

        proj = _project(project)
        if body_file:
            plan = plan_st_body_from_file(proj.root, pou, Path(body_file), run_lint)
        else:
            if not body.strip():
                return (
                    "ERROR: no body supplied. Pass `body` inline, or `body_file` "
                    "with a path to the new body."
                )
            plan = plan_st_body(proj.root, pou, body, run_lint)
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)

    if not plan.changed:
        return f"No change needed: {pou} in {proj.name} already has that body."

    if dry_run:
        return "\n".join(
            [
                "DRY RUN - nothing written.",
                f"  project : {proj.name}",
                f"  POU     : {pou}",
                f"  stream  : {plan.stream}",
                f"  size    : {len(plan.before)} -> {len(plan.after)} bytes",
                *[f"  note    : {n}" for n in plan.notes],
                "",
                "Call again with dry_run=False to apply.",
            ]
        )

    try:
        result = apply_st_body(plan, proj.root)
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)

    lines = [
        f"WROTE Structured Text body of {pou} in {proj.name}.",
        f"  stream          : {result['stream']}",
        f"  size            : {result['before_bytes']} -> {result['after_bytes']} bytes",
        f"  sibling streams : {result['siblings_verified']} verified unchanged",
    ]
    for backup in result.get("backups", []):
        lines.append(f"  backup          : {backup}")
    for note in result.get("notes", []):
        lines.append(f"  note            : {note}")
    lines.append("")
    lines.append(
        "NEXT: open MotionWorks IEC and run Build -> Rebuild Project, then Make. "
        "The .VGR grid and .VB declarations were not modified."
    )
    return "\n".join(lines)


@mcp.tool()
def mw_add_variable(
    name: str,
    type_name: str,
    section: str = "VAR",
    address: str = "",
    initial_value: str = "",
    description: str = "",
    pou: str = "",
    project: str | None = None,
    verify: bool = False,
    dry_run: bool = True,
) -> str:
    """Add a variable declaration to a POU, or to the project's globals.

    Touches only the textual ``.VB`` declaration stream.  Verified by compiling:
    the `.VGR` binary grid does not gate compilation, so a declaration added this
    way builds successfully with the grid left byte-identical.

    Args:
        name: New variable name.
        type_name: IEC type, e.g. BOOL, INT, LREAL, MC_Power.
        section: VAR (default), VAR_GLOBAL, VAR_EXTERNAL, VAR_INPUT, ...
        address: Optional AT address, e.g. %MW1.100.
        initial_value: Optional initial value, e.g. 0 or TRUE.
        description: Optional description comment.
        pou: POU name. Omit to edit the project's global variables.
        project: Project path, .mwt file, or bare project name.
        verify: Drive a real build afterwards and revert automatically if the
            project stops compiling. Slower, needs MotionWorks.
        dry_run: Default True, which only reports what would change.
    """
    return _declaration_write(
        "add", project=project, pou=pou or None, dry_run=dry_run, verify=verify,
        kwargs={
            "name": name, "type_name": type_name, "section": section,
            "address": address or None, "initial_value": initial_value or None,
            "description": description or None,
        },
    )


@mcp.tool()
def mw_edit_variable(
    name: str,
    new_name: str = "",
    type_name: str = "",
    description: str = "",
    address: str = "",
    initial_value: str = "",
    pou: str = "",
    project: str | None = None,
    force: bool = False,
    verify: bool = False,
    dry_run: bool = True,
) -> str:
    """Change a variable's type, name, address, initial value or description.

    Only the fields you supply are changed.  Verified by compiling for an
    unaddressed variable; a type change **is refused** when it contradicts an
    ``AT`` bit address, because that cannot compile (measured: retyping an
    I/O-mapped ``BOOL AT %IX...`` as ``DINT`` failed the build).

    Args:
        name: Existing variable name.
        new_name: Rename to this. Any body still using the old name is checked.
        type_name: New type.
        description: New description. Pass "-" to clear it.
        address: New AT address.
        initial_value: New initial value.
        pou: POU name. Omit for the project's globals.
        project: Project path, .mwt file, or bare project name.
        force: Write even if a safety check objects.
        verify: Drive a real build afterwards and revert automatically if the
            project stops compiling. Slower, needs MotionWorks.
        dry_run: Default True, which only reports what would change.
    """
    kwargs: dict[str, object] = {"name": name}
    if new_name:
        kwargs["new_name"] = new_name
    if type_name:
        kwargs["type_name"] = type_name
    if address:
        kwargs["address"] = address
    if initial_value:
        kwargs["initial_value"] = initial_value
    if description == "-":
        kwargs["description"] = ""
    elif description:
        kwargs["description"] = description
    return _declaration_write(
        "edit", project=project, pou=pou or None, dry_run=dry_run,
        kwargs=kwargs, force=force, verify=verify,
    )


@mcp.tool()
def mw_delete_variable(
    name: str,
    pou: str = "",
    project: str | None = None,
    force: bool = False,
    verify: bool = False,
    dry_run: bool = True,
) -> str:
    """Delete a variable declaration.

    CAUTION - this is the least reliable write the server offers.  Measured
    results are mixed: deleting an unreferenced global variable compiled, but
    deleting a POU-local variable that was verified *not* referenced by its body
    still failed the build.  The cause is not understood, so a delete cannot be
    predicted to succeed.

    It is refused while any POU body still references the variable, but that
    check does not catch every failure.  **Pass verify=True** to have the build
    driven and the change reverted automatically if it does not compile -- that
    is the recommended way to use this tool.

    Args:
        name: Variable to delete.
        pou: POU name. Omit for the project's globals.
        project: Project path, .mwt file, or bare project name.
        force: Write even if the reference check objects.
        verify: Drive a real build afterwards and revert automatically if the
            project stops compiling. Strongly recommended for delete.
        dry_run: Default True, which only reports what would change.
    """
    return _declaration_write(
        "delete", project=project, pou=pou or None, dry_run=dry_run,
        kwargs={"name": name}, force=force, verify=verify,
    )


def _declaration_write(
    operation: str,
    project: str | None,
    pou: str | None,
    dry_run: bool,
    kwargs: dict[str, object],
    force: bool = False,
    verify: bool = False,
) -> str:
    """Shared body for the variable add/edit/delete tools."""
    try:
        from . import writer

        proj = _project(project)
        planners = {
            "add": writer.plan_variable_add,
            "edit": writer.plan_variable_edit,
            "delete": writer.plan_variable_delete,
        }
        planner = planners[operation]
        if force:
            kwargs = {**kwargs, "force": True}
        plan = planner(proj.root, pou, **kwargs)
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)

    where = f"POU {pou}" if pou else "global variables"
    if not plan.changed:
        return f"No change: {operation} on {where} of {proj.name} would do nothing."

    if dry_run:
        return "\n".join(
            [
                "DRY RUN - nothing written.",
                f"  project : {proj.name}",
                f"  target  : {where}",
                f"  stream  : {plan.stream}",
                f"  size    : {len(plan.before)} -> {len(plan.after)} bytes",
                *[f"  note    : {n}" for n in plan.notes],
                "",
                "Call again with dry_run=False to apply.",
            ]
        )

    # With verify=True, use compile-then-revert: apply, build, and restore the
    # backup automatically if the project no longer compiles.
    if verify:
        try:
            from . import build as build_module

            outcome = build_module.apply_and_verify(plan, proj.root)
        except Exception as exc:  # noqa: BLE001
            return _fail(exc)
        lines = [f"WROTE {operation} on {where} in {proj.name} (with verification)."]
        written = outcome.written
        lines.append(f"  stream  : {written.get('stream')}")
        lines.append(
            f"  size    : {written.get('before_bytes')} -> {written.get('after_bytes')} bytes"
        )
        for backup in written.get("backups", []):  # type: ignore[union-attr]
            lines.append(f"  backup  : {backup}")
        lines.append("")
        if outcome.build is None:
            lines.append("VERIFICATION NOT RUN:")
        elif outcome.build.ok:
            lines.append(
                f"VERIFIED: the project still compiles "
                f"({outcome.build.dlls} POU DLLs produced)."
            )
        else:
            lines.append("VERIFICATION FAILED:")
        lines.append(f"  build   : {outcome.build.summary() if outcome.build else 'n/a'}")
        if outcome.reverted:
            lines.append("  REVERTED: the backup was restored, so the project is")
            lines.append("            unchanged. Nothing needs rebuilding.")
        elif outcome.build is not None and outcome.build.ide_would_not_load:
            lines.append(
                "  The IDE did not load the project, so no compile was attempted."
            )
            lines.append(
                "  That is an environment problem, not a compile failure, so the"
            )
            lines.append("  write was LEFT IN PLACE. Rebuild in MotionWorks to confirm.")
        for note in outcome.notes:
            lines.append(f"  note    : {note}")
        return "\n".join(lines)

    try:
        result = writer.apply_declaration(plan, proj.root)
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)

    lines = [
        f"WROTE {operation} on {where} in {proj.name}.",
        f"  stream          : {result['stream']}",
        f"  size            : {result['before_bytes']} -> {result['after_bytes']} bytes",
        f"  sibling streams : {result['siblings_verified']} verified unchanged",
    ]
    for backup in result.get("backups", []):
        lines.append(f"  backup          : {backup}")
    for note in result.get("notes", []):
        lines.append(f"  note            : {note}")
    lines.append("")
    lines.append(
        "NEXT: open MotionWorks IEC and run Build -> Rebuild Project, then Make. "
        "If IsCompiled is false afterwards, restore the backup above. "
        "Pass verify=True instead to have the build driven automatically."
    )
    return "\n".join(lines)


@mcp.tool()
def mw_build_project(project: str | None = None, timeout: int = 600) -> str:
    """Build and rebuild a project through MotionWorks' own compiler.

    Drives the IDE over COM so a change can be checked without doing it by hand.
    Requires MotionWorks to be installed and able to open the project.

    Note it operates on the project where it lies; use it on a copy unless you
    intend to change the real project's build output.

    Args:
        project: Project path, .mwt file, or bare project name.
        timeout: Seconds to allow for the build.
    """
    try:
        from . import build as build_module

        available, reason = build_module.build_available()
        if not available:
            return (
                f"BUILD UNAVAILABLE: {reason}\n"
                f"Read-only tools all still work; only build verification needs "
                f"MotionWorks."
            )
        proj = _project(project)
        mwt = proj.mwt_path
        if mwt is None:
            return (
                f"ERROR: no .mwt wrapper beside {proj.root}. MotionWorks needs it "
                f"to open the project."
            )
        result = build_module.run_build(mwt, timeout=timeout)
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)

    lines = [f"Build of {proj.name}: {'OK' if result.ok else 'NOT OK'}"]
    lines.append(f"  {result.summary()}")
    if result.ide_would_not_load:
        lines.append("")
        lines.append(
            "The IDE never loaded the project, so no compile happened. This is an "
            "environment problem, not a code problem -- typically a startup or "
            "licensing prompt in the MotionWorks window. Open the project by hand "
            "once to clear it."
        )
    return "\n".join(lines)


@mcp.tool()
def mw_build_status() -> str:
    """Report whether the automatic build can be used, and what it needs.

    Call this before relying on `verify=True` or `mw_build_project`, so a missing
    or blocked IDE is diagnosed up front instead of surfacing as a confusing
    failure.
    """
    try:
        from . import build as build_module

        available, reason = build_module.build_available()
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)

    lines = [
        f"Automatic build available : {'YES' if available else 'NO'}",
        f"  reason                  : {reason}",
        f"  32-bit PowerShell       : {build_module.POWERSHELL_32}",
        f"  build helper            : {build_module._HELPER}",
    ]
    if available:
        lines.append("")
        lines.append(
            "This means the tooling is present. It does NOT mean a build will "
            "succeed: the build drives the IDE over COM, so MotionWorks must be "
            "able to open the project. If a build reports 'project did not load', "
            "look for a startup or licensing prompt in the MotionWorks window -- "
            "that condition makes every automation call fail, including on "
            "unmodified projects."
        )
    else:
        lines.append("")
        lines.append(
            "Writes still work; they simply will not be verified by compiling, so "
            "rebuild in MotionWorks by hand afterwards."
        )
    return "\n".join(lines)


@mcp.tool()
def mw_list_tasks(project: str | None = None) -> str:
    """List the project's tasks with cycle time, priority, watchdog and programs.

    This is context that motion code cannot be judged without: a block that needs
    longer than its task's cycle time will trip the watchdog, and the priority
    decides what it competes with. Cycle times come from the task `.SET` files and
    program assignments from the node list.

    Args:
        project: Project path, .mwt file, or bare project name.
    """
    try:
        from .tasks import read_tasks

        proj = _project(project)
        settings = read_tasks(proj.root)
        assignments = proj.task_assignments()
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)

    if not settings:
        return (
            f"No task configuration found for {proj.name}. Expected <Task>.SET "
            f"files beside the resource src.st1."
        )

    lines = [f"Tasks in {proj.name} ({len(settings)}), fastest first:"]
    for task in settings:
        programs = assignments.get(task.name, [])
        lines.append("")
        lines.append(f"{task.name}")
        lines.append(f"  {task.summary()}")
        if programs:
            for program in programs:
                lines.append(f"  runs: {program}")
        else:
            lines.append("  runs: <no program instances assigned>")
        for warning in task.warnings:
            lines.append(f"  WARNING: {warning}")

    unassigned = sorted(set(assignments) - {t.name for t in settings})
    if unassigned:
        lines.append("")
        lines.append(
            f"Note: node list mentions task(s) with no .SET file: "
            f"{', '.join(unassigned)}"
        )
    return "\n".join(lines)


@mcp.tool()
def mw_assign_task(
    program: str,
    task: str,
    project: str | None = None,
    unassign: bool = False,
    dry_run: bool = True,
) -> str:
    """Assign or unassign a POU's program instance to/from a task.

    This is a structural edit to the project tree, so it rewrites `PROJECT.TRE`
    inside the root `src.st1` and records the instance in the project's
    `NODES.LST` files. MotionWorks must be closed; the write is refused otherwise.

    Every edit is verified before it is written: the edited tree is re-parsed and
    checked (node counts, the header total, the instance's presence or absence),
    every file is backed up first, and the result is read back and re-checked.

    Unlike the variable writes, this edit is **not compile-verified** -- the build
    path needs a working IDE, which is currently unavailable in this environment.
    Correctness here rests on the structural checks and on the byte-exact
    round-trip of the parser.

    Args:
        program: Program instance name, normally the POU name (e.g. "StraightCut").
        task: Task name, e.g. "SlowTsk" or "FastTsk".
        project: Project path, .mwt file, or bare project name.
        unassign: Remove the assignment instead of adding it.
        dry_run: Report the plan without writing. Defaults to True.
    """
    try:
        from . import tree as tree_module
        from . import tree_writer as writer
        from .cfb import CompoundFile

        proj = _project(project)
        src = proj.root / "src.st1"
        text = CompoundFile(src).read_stream("PROJECT.TRE").decode("latin1")
        document = tree_module.parse_document(text)
        planned = (
            writer.plan_unassign(document, task, program)
            if unassign
            else writer.plan_assign(document, task, program)
        )
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)

    header = [f"Project: {proj.name}", planned.summary(), ""]
    if dry_run:
        header.append("DRY RUN - nothing written.")
        header.append("Call again with dry_run=False to apply.")
        return "\n".join(header)

    try:
        result = writer.apply_assignment(
            src,
            proj.root,
            planned,
            backup_dir=writer.default_backup_dir(proj.root),
        )
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)

    header.append(f"WRITTEN. Node total is now {result['node_total']}.")
    header.append("Files: " + ", ".join(Path(f).name for f in result["files"]))
    header.append("Backups: " + ", ".join(result["backups"]))
    header.append(
        "Open MotionWorks IEC and rebuild to confirm; this edit was structurally "
        "verified but not compile-verified."
    )
    return "\n".join(header)


@mcp.tool()
def mw_plan_pou_creation(
    pou_name: str,
    template_pou: str,
    project: str | None = None,
) -> str:
    """Plan creating an ST POU: show the patch, and what is still unknown.

    **This writes nothing.** It is safe to run against a real project.

    Creating a POU adds four nodes to the project tree (the POU plus its comments,
    variables and body worksheets), clones a template POU directory, and updates
    the view list, `LIST.POU` and `PROJECT.INF`. The record layout, node ids and
    GUIDs are derived; several worksheet fields are not, because their values in
    real projects are opaque handles that differ between POUs for reasons the file
    format does not reveal.

    Rather than guess those and risk producing a project MotionWorks cannot open,
    this reports them precisely so they can be supplied. Nothing is written until
    they are.

    Args:
        pou_name: Name of the POU to create.
        template_pou: An existing POU in the same project to clone. The template
            decides the body kind, so clone an ST POU for an ST POU.
        project: Project path, .mwt file, or bare project name.
    """
    try:
        from .pou_writer import plan_pou_creation

        proj = _project(project)
        plan = plan_pou_creation(proj.root, pou_name, template_pou)
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)

    lines = [f"Project: {proj.name}", plan.summary()]
    unresolved = plan.unresolved()
    lines.append("")
    if unresolved:
        lines.append(
            f"NOT WRITABLE YET: {len(unresolved)} field(s) need values that cannot "
            f"be derived from the files. Nothing was written."
        )
    else:
        lines.append(
            "All fields resolved. Note that POU creation is not yet wired to a "
            "write path; this tool only plans."
        )
    return "\n".join(lines)


@mcp.tool()
def mw_create_pou(
    pou_name: str,
    template_pou: str,
    project: str | None = None,
    dry_run: bool = True,
) -> str:
    """Create an ST POU by cloning an existing one.

    This is the largest structural edit the server performs. It clones the template
    POU's directory, renames the files and streams that carry the template's name,
    gives the new POU fresh worksheet GUIDs, inserts four nodes into the project
    tree, and records the POU in `LIST.POU` and `PROJECT.INF`. MotionWorks must be
    closed; the write is refused otherwise.

    Every part of the tree edit is verified in a scratch container *before* anything
    is written, the whole POU directory is removed if any step fails, and the result
    is read back and re-checked.

    The template decides the body kind: clone an ST POU for an ST POU. Worksheet
    state lines are copied from the template, because their values are opaque
    project-local handles that cannot be derived from the files.

    Args:
        pou_name: Name for the new POU.
        template_pou: An existing POU in the same project to clone.
        project: Project path, .mwt file, or bare project name.
        dry_run: Report the plan without writing. Defaults to True.
    """
    try:
        from . import pou_writer as writer

        proj = _project(project)
        plan = writer.plan_pou_creation(proj.root, pou_name, template_pou)
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)

    lines = [f"Project: {proj.name}", plan.summary(), ""]
    if dry_run:
        lines.append("DRY RUN - nothing written.")
        lines.append("Call again with dry_run=False to create the POU.")
        return "\n".join(lines)

    try:
        result = writer.apply_pou_creation(
            plan, backup_dir=writer._default_backup_dir(proj.root)
        )
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)

    lines.append(
        f"CREATED {result['pou']!r} from {result['template']!r}; node total is now "
        f"{result['node_total']}."
    )
    lines.append(f"Files created: {len(result['files_created'])}")
    lines.append("Backups: " + ", ".join(result["backups"]))
    lines.append(
        "Open MotionWorks IEC and rebuild to confirm; this edit was structurally "
        "verified but not compile-verified."
    )
    return "\n".join(lines)


@mcp.tool()
def mw_delete_pou(
    pou_name: str,
    project: str | None = None,
    force: bool = False,
    dry_run: bool = True,
) -> str:
    """Delete a POU from the project.

    Removes the POU's four tree nodes, its task assignment if it has one, and its
    entries in `LIST.POU`, the node lists and `PROJECT.INF`. The POU's directory is
    **moved to an archive** rather than deleted, so the operation is recoverable
    independently of the file backups. MotionWorks must be closed; the write is
    refused otherwise.

    **The reference guard matters here.** If another POU's body calls the one being
    deleted, this is refused: the tree edit would succeed, but the project would no
    longer compile, and a dangling call is worse than a refusal. Pass `force=True`
    only if you have already removed the calls, or accept a broken build.

    Everything is verified in a scratch container before anything is written, and if
    a later step fails the POU directory is moved back.

    Args:
        pou_name: The POU to delete.
        project: Project path, .mwt file, or bare project name.
        force: Delete even when other POUs call it. Defaults to False.
        dry_run: Report the plan without writing. Defaults to True.
    """
    try:
        from . import pou_writer as writer

        proj = _project(project)
        plan = writer.plan_pou_deletion(proj.root, pou_name, force=force)
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)

    lines = [f"Project: {proj.name}", plan.summary(), ""]
    if dry_run:
        lines.append("DRY RUN - nothing written.")
        lines.append("Call again with dry_run=False to delete the POU.")
        return "\n".join(lines)

    try:
        result = writer.apply_pou_deletion(
            plan, backup_dir=writer._default_backup_dir(proj.root)
        )
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)

    lines.append(
        f"DELETED {pou_name!r}; node total is now {result['node_total']}."
    )
    if result.get("archived_to"):
        lines.append(f"Archived to: {result['archived_to']}")
    lines.append("Backups: " + ", ".join(result["backups"]))
    lines.append(
        "Open MotionWorks IEC and rebuild to confirm; this edit was structurally "
        "verified but not compile-verified."
    )
    return "\n".join(lines)


@mcp.tool()
def mw_transplant_ld_body(
    donor_pou: str,
    target_pou: str,
    project: str | None = None,
    dry_run: bool = True,
) -> str:
    """Copy a graphical (LD) body from a donor POU into another POU.

    Authoring ladder logic from scratch is out of scope -- the body is proprietary
    binary -- so the supported route is a **proven donor**. This copies the donor's
    graphical body, its declarations and its variable grid into the target, which
    must already be a graphical POU (create one by cloning an LD POU first).

    The donor's external declarations are **localized** on the way: `VAR_EXTERNAL`
    becomes `VAR` in the declarations, and the matching grid records change usage
    from external to local. That is necessary because the donor's external
    references belong to the donor's project, not the target's.

    MotionWorks must be closed. Every stream is verified in a scratch container
    before anything is written, and read back afterwards.

    Args:
        donor_pou: The POU whose body is copied. Must be graphical (LD).
        target_pou: The POU to write into. Must already be graphical.
        project: Project path, .mwt file, or bare project name.
        dry_run: Report the plan without writing. Defaults to True.
    """
    try:
        from . import pou_writer as writer

        proj = _project(project)
        plan = writer.plan_transplant(proj.root, donor_pou, target_pou)
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)

    lines = [f"Project: {proj.name}", plan.summary(), ""]
    if dry_run:
        lines.append("DRY RUN - nothing written.")
        lines.append("Call again with dry_run=False to transplant the body.")
        return "\n".join(lines)

    try:
        result = writer.apply_transplant(
            plan, backup_dir=writer._default_backup_dir(proj.root)
        )
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)

    lines.append(
        f"TRANSPLANTED {result['donor']!r} into {result['target']!r}: "
        f"{len(result['streams'])} stream(s), {result['localized']} external "
        f"declaration(s) localized."
    )
    lines.append("Backups: " + ", ".join(result["backups"]))
    lines.append(
        "Open MotionWorks IEC and rebuild to confirm; this edit was structurally "
        "verified but not compile-verified."
    )
    return "\n".join(lines)


@mcp.tool()
def mw_close_motionworks(timeout_seconds: float = 15.0) -> str:
    """Close every running MotionWorks IEC instance, then verify it is gone.

    The IDE is asked to quit through COM first so it can flush its state, and a
    process that survives is terminated. The result is **re-checked** rather than
    assumed, so "STILL RUNNING" in the reply means do not write.

    Any helper processes (cam editor, plot tool, simulator) are closed too, since
    they can hold the same project files open.

    Args:
        timeout_seconds: How long to wait for processes to disappear.
    """
    try:
        from . import ide

        result = ide.close_motionworks(timeout=timeout_seconds)
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)

    lines = []
    before = result.get("before") or []
    if not before:
        lines.append("MotionWorks IEC was not running; nothing to close.")
    else:
        for pid, name in result.get("closed") or []:
            lines.append(f"  closed pid {pid} ({name})")
        for pid, name in before:
            if (pid, name) not in (result.get("closed") or []):
                lines.append(f"  was not running by the time it was closed: "
                             f"pid {pid} ({name})")
    remaining = result.get("remaining") or []
    if remaining:
        lines.append("")
        lines.append("STILL RUNNING - do not write:")
        for pid, name in remaining:
            lines.append(f"  pid {pid} {name}")
    else:
        lines.append("")
        lines.append("MotionWorks IEC is closed. Writes are safe.")
    return "\n".join(lines)


@mcp.tool()
def mw_com_status() -> str:
    """Report whether the pywin32 COM automation client can drive MotionWorks.

    This is the Tier 3 path in Python: the `Ade.Application.550` automation server,
    which must be spoken to from a **32-bit** interpreter because `mwt.exe` is a
    32-bit local server. Run this server with `.venv32\\Scripts\\python.exe` for COM
    work; the 64-bit interpreter is fine for everything else.

    If the client is usable it also reports the active project's state. Note the
    distinction the reply makes: if the IDE is running but its project services are
    not answering, **no compile was attempted**, so that must not be read as "the
    project does not compile".
    """
    try:
        from . import com

        result = com.query_via_32bit()
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)

    if not result.get("ok"):
        lines = ["MotionWorks IEC automation: not available."]
        for key in ("reason", "error"):
            if result.get(key):
                lines.append(f"  {key}: {result[key]}")
        lines.append("")
        lines.append(
            "The PowerShell build path (mw_build_project) works with either "
            "interpreter, because it invokes 32-bit Windows PowerShell itself."
        )
        return "\n".join(lines)

    lines = [f"Automation client ({com.PROG_ID}): connected"]
    state = result.get("state") or {}
    for key in ("name", "project_open", "compiled", "modified"):
        lines.append(f"  {key:13}: {state.get(key)}")
    if result.get("services_ready"):
        lines.append("  services     : ready")
    else:
        lines.append(f"  services     : {result.get('services_note')}")
        lines.append("")
        lines.append(
            "The IDE is up but its project services are not answering, so NO compile "
            "was attempted. This is not a build failure."
        )
    if result.get("compile"):
        entry = result["compile"]
        lines.append("")
        lines.append(f"  compile      : accepted={entry.get('accepted')}")
        if entry.get("note"):
            lines.append(f"  note         : {entry['note']}")
    return "\n".join(lines)


@mcp.tool()
def mw_list_windows(limit: int = 25) -> str:
    """List visible windows, largest first, with their handles and positions.

    Use this to find a window before capturing it. Handles are what the other
    screen tools take, so they stay unambiguous when two windows share a title.
    """
    try:
        from . import capture

        return capture.describe_windows(limit=limit)
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)


@mcp.tool()
def mw_screenshot(
    window: str | None = None,
    handle: int | None = None,
    screen: bool = False,
) -> str:
    """Capture the screen, or one window, and return the PNG path.

    This is the agent's eyes on MotionWorks. Use it to see what the IDE is actually
    showing -- a modal dialog, a compile error, a project tree -- rather than
    inferring from files. The returned path can be attached directly to see the image.

    Args:
        window: Case-insensitive substring of the window title, e.g. "Motionworks".
        handle: A window handle from mw_list_windows; more precise than a title.
        screen: Capture every monitor instead of one window.
    """
    try:
        from . import capture

        if screen or (window is None and handle is None):
            path = capture.capture_screen("screen")
            return f"Captured the full desktop to:\n  {path}"
        path, info = capture.capture_window(
            title_contains=window, handle=handle, name="window"
        )
        return (
            f"Captured window {info['title']!r} to:\n  {path}\n"
            f"  size: {info['width']}x{info['height']} at "
            f"({info['left']},{info['top']}), hwnd={info['handle']}"
        )
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)


@mcp.tool()
def mw_read_screen_text(
    window: str | None = None,
    handle: int | None = None,
    image: str | None = None,
) -> str:
    """OCR text out of a window, the screen, or an existing image.

    UI Automation is tried first and OCR is the fallback, because accessibility is not
    always available: MotionWorks' trial dialog reports its buttons as generic panes,
    and anything an application draws itself is invisible to automation entirely. When
    that happens, pixels are the only source of truth.

    Args:
        window: Window title substring to capture and read.
        handle: A window handle from mw_list_windows.
        image: Read an already-captured PNG instead of taking a new one.
    """
    try:
        from pathlib import Path as _Path

        from . import capture

        if image:
            target = _Path(image)
            if not target.is_file():
                return f"ERROR: no such image: {image}"
        elif window or handle:
            target, _info = capture.capture_window(
                title_contains=window, handle=handle, name="ocr"
            )
        else:
            target = capture.capture_screen("ocr")

        text = capture.read_text(target)
        header = f"Text read from {target}:"
        return f"{header}\n\n{text}" if text else f"{header}\n\n(no text found)"
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)


@mcp.tool()
def mw_ui_elements(
    window: str | None = None,
    handle: int | None = None,
    control_type: str = "",
) -> str:
    """List the UI Automation elements of a window (or the desktop).

    Shows what is actually interactive, with each element's type, name and rectangle.
    Note that MotionWorks reports its dialog buttons as ``Pane`` rather than
    ``Button``, so filtering by type can hide them -- listing everything is often the
    better first move.

    Args:
        window: Window title substring; omit to inspect the whole desktop.
        handle: A window handle from mw_list_windows.
        control_type: Filter to one type, e.g. "Button" or "Edit".
    """
    try:
        from . import uia

        found = uia.elements(
            title_contains=window, handle=handle, control_type=control_type or ""
        )
        return uia.describe(found)
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)


@mcp.tool()
def mw_dismiss_trial(timeout_seconds: float = 45.0) -> str:
    """Click **Use Trial** on the MotionWorks trial dialog, if it is showing.

    While that dialog is up the IDE never loads a project, so every COM call -- even
    on an unmodified project -- returns `Internal error`. That looks like a broken
    install but is only an unanswered prompt, so this is worth trying before
    concluding anything is wrong.

    If this reports that it could not click, the dialog needs one manual click: this
    process has been unable to inject mouse input (synthetic clicks are accepted but
    the cursor never moves), which is recorded in docs/computer-use.md.

    Args:
        timeout_seconds: How long to wait for the dialog to appear.
    """
    try:
        from . import uia

        dismissed, detail = uia.dismiss_trial(timeout=timeout_seconds)
        if dismissed:
            return f"Trial dialog handled: {detail}"
        return (
            f"Trial dialog not dismissed: {detail}\n\n"
            "If the dialog is on screen, click **Use Trial** once by hand. Synthetic "
            "input does not reach the desktop from this process."
        )
    except Exception as exc:  # noqa: BLE001
        return _fail(exc)


def main() -> None:
    """Console entry point: run the server over stdio."""
    try:
        mcp.run("stdio")
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
