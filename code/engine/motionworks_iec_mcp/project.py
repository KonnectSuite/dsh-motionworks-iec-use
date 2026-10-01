"""Resolve, inventory, and read MotionWorks IEC projects on disk.

A MotionWorks project on disk is an *expanded directory* plus a small sibling
``.mwt`` file.  In the sample projects the ``.mwt`` is only 4096 bytes: it is a
wrapper, not the project.  Everything editable lives in the expanded directory::

    <Project>/
        src.st1                 project tree + view state (CFB)
        LIST.POU                textual POU list
        NODES.LST               node/task assignment list
        @LIBRARY.LST            library references
        PROJECT.INF             last-change stamp
        NODES.LST ...
        C/                      configuration (holds VAR_GLOBAL + IO config)
        DT/  HW/  LIB/          data types, hardware, library nodes
        POE/<POU>/              one directory per POU
            src.st1             <POU>T.TXT, <POU>V.VGR, <POU>V.VB, <POU>.STB|.GB
            NodeProperties.xml  worksheet GUIDs
            <POU>.CCI           POU descriptor
            *.xml               translation documents

Two layout generations appear in the sample data: ``C/Configuration/R/Resource``
and the older ``C/Resource/R/Resource``.  Both are handled by searching for the
resource directory rather than assuming a fixed path.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from .cfb import CfbError, CompoundFile
from .errors import (
    AmbiguousProject,
    NotFound,
    ProjectNotFound,
    UnsupportedFormat,
)
from .variables import (
    DeclarationTable,
    Variable,
    cross_check,
    decode_declarations,
    read_grid_variable_count,
)

#: Extensions that mark a directory as an expanded MotionWorks project.
_ROOT_MARKERS = ("src.st1", "LIST.POU", "PROJECT.INF")

#: Default directory searched when a caller passes only a project name.
DEFAULT_SEARCH_ROOT = "Yaskawa"

_GLOBAL_STREAM_RE = re.compile(r"^GLOBAL_VARIABLES", re.IGNORECASE)


@dataclass
class PouInfo:
    """One POU directory."""

    name: str
    directory: Path

    @property
    def source_path(self) -> Path:
        return self.directory / "src.st1"

    @property
    def node_properties_path(self) -> Path:
        return self.directory / "NodeProperties.xml"

    def source(self) -> CompoundFile:
        return CompoundFile(self.source_path)

    # -- stream discovery -------------------------------------------------

    def stream_names(self) -> list[str]:
        try:
            return self.source().stream_names()
        except CfbError:
            return []

    def body_stream(self) -> tuple[str, str] | None:
        """Return ``(stream_name, language)`` for the POU body.

        Graphical streams share the .GB extension. Resolve LD/FBD from the
        saved worksheet node; the extension alone cannot distinguish them.
        """
        streams = self.stream_names()
        for name in streams:
            if name.upper().endswith(".STB"):
                return name, "ST"
        for name in streams:
            if name.upper().endswith(".GB"):
                from .tree import parse_document
                root = self.directory.parent.parent
                document = parse_document(CompoundFile(root / 'src.st1').read_stream('PROJECT.TRE').decode('latin1'))
                expected = ('POE/' + self.name + '/' + name).casefold()
                matches = [node for node, _ in document.walk_with_ancestors()
                           if node.path.split('\t')[0].replace('\\', '/').casefold() == expected]
                if document.warnings or len(matches) != 1:
                    raise ValueError('Graphical worksheet tree identity absent or ambiguous')
                # The leading record kind is 11=LD / 12=FBD. node_id is
                # the separate, project-specific handle in the params line.
                record_kind = document.lines[matches[0].start_line].strip()
                return name, {'11': 'LD', '12': 'FBD'}.get(record_kind, 'GRAPHICAL')
        return None

    def language(self) -> str | None:
        found = self.body_stream()
        return found[1] if found else None

    def declaration_stream_name(self) -> str | None:
        for name in self.stream_names():
            if name.upper().endswith("V.VB"):
                return name
        return None

    def grid_stream_name(self) -> str | None:
        for name in self.stream_names():
            if name.upper().endswith("V.VGR"):
                return name
        return None

    def comment_stream_name(self) -> str | None:
        for name in self.stream_names():
            if name.upper().endswith("T.TXT"):
                return name
        return None

    # -- content ----------------------------------------------------------

    def declarations(self) -> DeclarationTable:
        cfb = self.source()
        stream_name = self.declaration_stream_name()
        if stream_name is None:
            return DeclarationTable(
                warnings=["no <POU>V.VB declaration stream present"],
                source_stream=None,
            )
        table = decode_declarations(cfb.read_stream(stream_name), stream_name)
        grid_name = self.grid_stream_name()
        if grid_name:
            table.warnings.extend(
                cross_check(table, read_grid_variable_count(cfb.read_stream(grid_name)))
            )
        return table

    def st_body(self) -> str | None:
        """Return the Structured Text body, or None for a graphical POU."""
        found = self.body_stream()
        if not found or found[1] != "ST":
            return None
        return self.source().read_stream(found[0]).decode("latin1")

    def st_body_text(self) -> str | None:
        """Return readable ST, restoring comments from native translations."""
        body = self.st_body()
        if body is None or '\x07' not in body:
            return body
        from .st_comments import resolve_comments
        worksheet = self.body_stream()[0][:-4]
        matches = [p for p in self.directory.iterdir()
                   if p.name.casefold() == (worksheet + 'Translation.xml').casefold()]
        if len(matches) != 1:
            raise ValueError('Native ST comment translation is absent or ambiguous')
        return resolve_comments(body, matches[0])

    def summary(self) -> dict[str, object]:
        try:
            stream_names = self.stream_names()
        except CfbError as exc:
            return {"name": self.name, "error": str(exc)}
        body = self.body_stream()
        return {
            "name": self.name,
            "language": body[1] if body else None,
            "body_stream": body[0] if body else None,
            "streams": len(stream_names),
            "directory": str(self.directory),
        }


@dataclass
class Project:
    """An expanded MotionWorks project directory."""

    root: Path
    _pous: list[PouInfo] | None = field(default=None, repr=False)

    def __post_init__(self) -> None:
        # Accept str for convenience: every path operation below assumes a Path,
        # and a raw string would fail late and confusingly.
        if not isinstance(self.root, Path):
            self.root = Path(self.root)

    # -- identity ---------------------------------------------------------

    @property
    def name(self) -> str:
        return self.root.name

    @property
    def mwt_path(self) -> Path | None:
        candidate = self.root.with_suffix(".mwt")
        return candidate if candidate.is_file() else None

    @property
    def node_list_path(self) -> Path | None:
        for candidate in (self.root / "NODES.LST",):
            if candidate.is_file():
                return candidate
        return None

    # -- raw file reads (ANSI/latin1, as MotionWorks writes them) ---------

    def _read_text(self, name: str) -> str | None:
        path = self.root / name
        if not path.is_file():
            return None
        return path.read_bytes().decode("latin1")

    def list_pou_lines(self) -> list[str]:
        text = self._read_text("LIST.POU")
        return [line for line in (text or "").splitlines() if line.strip()]

    def library_entries(self) -> list[str]:
        text = self._read_text("@LIBRARY.LST")
        if not text:
            return []
        # First line is a version banner ("Library List, V40").
        return [line for line in text.splitlines()[1:] if line.strip()]

    def node_lines(self) -> list[str]:
        text = self._read_text("NODES.LST")
        return [line for line in (text or "").splitlines() if line.strip()]

    def last_change(self) -> str | None:
        text = self._read_text("PROJECT.INF")
        if not text:
            return None
        for line in text.splitlines():
            if line.lower().startswith("lastchange"):
                return line.split("=", 1)[-1].strip()
        return None

    def project_tree_streams(self) -> dict[str, int]:
        path = self.root / "src.st1"
        if not path.is_file():
            return {}
        return CompoundFile(path).summary()

    # -- POUs -------------------------------------------------------------

    @property
    def pou_directory(self) -> Path:
        return self.root / "POE"

    def pous(self) -> list[PouInfo]:
        if self._pous is None:
            base = self.pou_directory
            if not base.is_dir():
                self._pous = []
            else:
                self._pous = [
                    PouInfo(name=child.name, directory=child)
                    for child in sorted(base.iterdir())
                    if child.is_dir() and (child / "src.st1").is_file()
                ]
        return self._pous

    def pou(self, name: str) -> PouInfo:
        target = name.casefold()
        for pou in self.pous():
            if pou.name.casefold() == target:
                return pou
        available = ", ".join(p.name for p in self.pous()) or "<none>"
        raise NotFound(f"No POU named {name!r} in {self.name}. Available: {available}")

    # -- tasks ------------------------------------------------------------

    def task_assignments(self) -> dict[str, list[str]]:
        """Map task name -> assigned program names.

        Read from the project tree, which is authoritative.  ``NODES.LST`` is the
        fallback, and is genuinely worse: ``RotaryKnife_ASP_v350`` has no
        ``NODES.LST`` at all, so a list-only reader reports no tasks for a project
        that has four.

        In the tree a task node's path points at the resource task directory and
        its final component equals its name (``...\\Resource\\FastTsk`` for the
        node ``FastTsk``); matching the directory alone also catches
        ``Global_Variables`` and ``IO_Configuration``, whose paths live there but
        carry a file extension.
        """
        from_tree = self._task_assignments_from_tree()
        if from_tree:
            return from_tree
        return self._task_assignments_from_node_list()

    def _task_assignments_from_tree(self) -> dict[str, list[str]]:
        from .tree import TreeParseError, parse_tree, task_assignments

        path = self.root / "src.st1"
        if not path.is_file():
            return {}
        try:
            text = CompoundFile(path).read_stream("PROJECT.TRE").decode("latin1")
            roots, _ = parse_tree(text)
        except (OSError, ValueError, TreeParseError):
            return {}
        return task_assignments(roots)

    def _task_assignments_from_node_list(self) -> dict[str, list[str]]:
        """Read assignments from ``NODES.LST`` files.

        Loose lines look like::

            TASK     5  MedTsk      eCLR  MP2600iec
            PROGRAM  6  ServoHoming ServoHoming eCLR MP2600iec

        Both the project root and the resource directory are checked, because
        projects differ in where they keep the file.  Where both exist they
        describe the same instances, so programs are de-duplicated in order --
        without that, every program is reported twice.
        """
        assignments: dict[str, list[str]] = {}
        sources = [self.node_list_path]
        for extra in (
            self.root / "C/Configuration/R/Resource/NODES.LST",
            self.root / "C/Resource/R/Resource/NODES.LST",
        ):
            sources.append(extra)

        for source in sources:
            if source is None or not source.is_file():
                continue
            try:
                lines = source.read_bytes().decode("latin1").splitlines()
            except OSError:
                continue
            current_task: str | None = None
            for line in lines:
                if not line.strip():
                    continue
                parts = line.split("\t")
                kind = parts[0].strip().upper()
                if kind == "TASK" and len(parts) >= 3:
                    current_task = parts[2].strip()
                    assignments.setdefault(current_task, [])
                elif kind == "PROGRAM" and len(parts) >= 3 and current_task:
                    program = parts[2].strip()
                    seen = assignments[current_task]
                    if program not in seen:
                        seen.append(program)
        return assignments

    # -- variables --------------------------------------------------------

    def global_variables(self) -> DeclarationTable:
        """Read ``VAR_GLOBAL`` declarations from the resource source.

        If the resource stores only the binary ``.VGR`` grid (as the newer
        TopCutter and RotaryKnife projects do), the textual declarations are
        absent and that is reported rather than invented.
        """
        resource = self.resource_source()
        if resource is None:
            return DeclarationTable(warnings=["no resource src.st1 found"])

        cfb = CompoundFile(resource)
        names = cfb.stream_names()
        # The resource-level stream is named "Global_Variables.VB", which does
        # not end in "V.VB" (that pattern is for "<POU>V.VB"), so match on the
        # plain extension here.
        decl_names = [n for n in names if n.upper().endswith(".VB")]
        grid_names = [n for n in names if n.upper().endswith(".VGR")]

        if not decl_names:
            note = "resource src.st1 has no textual declaration stream"
            if grid_names:
                count = read_grid_variable_count(cfb.read_stream(grid_names[0]))
                note += (
                    f"; the binary grid {grid_names[0]!r} records {count} variables, "
                    f"but their names and types are not stored as text"
                )
            return DeclarationTable(warnings=[note], source_stream=None)

        table = decode_declarations(cfb.read_stream(decl_names[0]), decl_names[0])
        if grid_names:
            table.warnings.extend(
                cross_check(table, read_grid_variable_count(cfb.read_stream(grid_names[0])))
            )
        return table

    def resource_source(self) -> Path | None:
        """Locate the resource ``src.st1`` that holds ``VAR_GLOBAL`` data.

        Handles both observed layouts without hardcoding either one.
        """
        for pattern in (
            "C/Configuration/R/Resource/src.st1",
            "C/Resource/R/Resource/src.st1",
        ):
            candidate = self.root / pattern
            if candidate.is_file():
                return candidate
        # Fall back to a search, preferring a directory named Resource.
        matches = [
            p for p in self.root.glob("C/**/src.st1")
            if p.parent.name.lower() == "resource"
        ]
        return matches[0] if matches else None

    # -- reporting --------------------------------------------------------

    def inventory(self) -> dict[str, object]:
        pous = self.pous()
        languages: dict[str, int] = {}
        for pou in pous:
            languages[pou.language() or "?"] = languages.get(pou.language() or "?", 0) + 1
        return {
            "name": self.name,
            "root": str(self.root),
            "mwt": str(self.mwt_path) if self.mwt_path else None,
            "last_change": self.last_change(),
            "pou_count": len(pous),
            "languages": languages,
            "tasks": self.task_assignments(),
            "libraries": self.library_entries(),
            "tree_streams": self.project_tree_streams(),
            "resource_source": str(self.resource_source()) if self.resource_source() else None,
        }


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------


def looks_like_project(directory: Path) -> bool:
    """True when ``directory`` holds an expanded MotionWorks project."""
    if not directory.is_dir():
        return False
    if (directory / "POE").is_dir():
        return True
    return any((directory / marker).is_file() for marker in _ROOT_MARKERS)


def discover(search_root: str | Path) -> list[Path]:
    """Return every expanded project directory under ``search_root``.

    A directory qualifies when it contains a ``POE`` subdirectory (this is the
    reliable marker: every sample project has one, including ones missing some
    root metadata files).
    """
    base = Path(search_root)
    if not base.is_absolute():
        base = Path.cwd() / base
    if not base.is_dir():
        return []
    found = {p.parent for p in base.rglob("POE") if p.is_dir()}
    return sorted(found)


def _match_by_name(base: Path, wanted: str) -> list[Path]:
    """Match projects by name, supporting a disambiguating path suffix.

    Two of the sample projects are both called ``TopCutter`` (one at the top
    level, one under ``MP2600iec Program``), so a bare name is genuinely
    ambiguous.  Callers can qualify it::

        TopCutter                        -> matches both
        MP2600iec Program/TopCutter      -> matches one
        Yaskawa/TopCutter                -> matches one

    A supplied multi-segment query must match the project's trailing path
    components, which is unambiguous without needing an absolute path.
    """
    parts = [
        p.casefold()
        for p in re.split(r"[\\/]+", wanted.strip())
        if p and p not in (".", "..")
    ]
    if not parts:
        return []
    matches: list[Path] = []
    for candidate in discover(base):
        tail = [p.casefold() for p in candidate.parts[-len(parts):]]
        if tail == parts:
            matches.append(candidate)
    return matches


def resolve(
    project: str | Path,
    search_root: str | Path | None = None,
) -> Project:
    """Resolve a project by path, by ``.mwt`` file, or by bare/qualified name.

    Accepts an expanded directory, an ``.mwt`` file, or a name that is searched
    for under ``search_root`` (default :data:`DEFAULT_SEARCH_ROOT`).
    """
    candidate = Path(project)
    if candidate.exists():
        resolved = candidate.resolve()
        if resolved.is_file():
            if resolved.suffix.lower() == ".mwt":
                expanded = resolved.with_suffix("")
                if expanded.is_dir():
                    return Project(root=expanded)
                raise ProjectNotFound(
                    f"{resolved.name} has no expanded project directory beside it "
                    f"({expanded}). Open the project in MotionWorks once to expand it."
                )
            raise ProjectNotFound(
                f"{resolved} is a file; expected an expanded project directory or .mwt"
            )
        if looks_like_project(resolved):
            return Project(root=resolved)
        raise ProjectNotFound(
            f"{resolved} does not look like an expanded MotionWorks project "
            f"(no POE directory or project markers)"
        )

    # Treat the argument as a name (possibly path-qualified) and search.  Try the
    # whole query first: a query containing a separator is itself a qualified
    # suffix such as "MP2600iec Program/TopCutter", and matching on just the last
    # component would wrongly discard the qualifier.
    base = Path(search_root) if search_root else Path(DEFAULT_SEARCH_ROOT)
    if not base.is_absolute():
        base = Path.cwd() / base
    raw = str(project)
    matches = _match_by_name(base, raw)
    if not matches and candidate.name and candidate.name != raw:
        matches = _match_by_name(base, candidate.name)
    if len(matches) == 1:
        return Project(root=matches[0])
    if len(matches) > 1:
        listing = "\n  ".join(str(m) for m in matches)
        raise AmbiguousProject(
            f"{project!r} matches {len(matches)} projects; qualify it with a "
            f"parent directory or pass a full path:\n  {listing}"
        )
    available = discover(base)
    listing = "\n  ".join(str(p) for p in available) or "<none found>"
    raise ProjectNotFound(
        f"No project named {project!r} under {base}. Available projects:\n  {listing}"
    )


def describe_all(search_root: str | Path | None = None) -> list[dict[str, object]]:
    """Inventory every discovered project, for the list tool."""
    base = Path(search_root) if search_root else Path(DEFAULT_SEARCH_ROOT)
    if not base.is_absolute():
        base = Path.cwd() / base
    out: list[dict[str, object]] = []
    for path in discover(base):
        project = Project(root=path)
        out.append(
            {
                "name": project.name,
                "root": str(path),
                "pou_count": len(project.pous()),
                "languages": _language_counts(project),
                "last_change": project.last_change(),
            }
        )
    return out


def _language_counts(project: Project) -> dict[str, int]:
    counts: dict[str, int] = {}
    for pou in project.pous():
        key = pou.language() or "?"
        counts[key] = counts.get(key, 0) + 1
    return counts


def library_usage(project: Project) -> dict[str, int]:
    """Count how many POUs declare each function-block type.

    Useful context for an agent: it shows which library blocks the project
    actually depends on, and therefore which donor POUs are good examples.
    """
    counts: dict[str, int] = {}
    for pou in project.pous():
        try:
            table = pou.declarations()
        except UnsupportedFormat:
            continue
        for variable in table.variables:
            if variable.is_fb_instance:
                counts[variable.type_name] = counts.get(variable.type_name, 0) + 1
    return dict(sorted(counts.items(), key=lambda kv: -kv[1]))


def symbol_index(project: Project) -> dict[str, list[str]]:
    """Map every declared symbol name to the POU(s) that declare it.

    This is the cross-reference an agent needs before editing code, so it can
    avoid inventing symbol names that do not exist.
    """
    index: dict[str, list[str]] = {}

    def record(name: str, where: str) -> None:
        index.setdefault(name, [])
        if where not in index[name]:
            index[name].append(where)

    try:
        for variable in project.global_variables().variables:
            record(variable.name, "<global>")
    except UnsupportedFormat:
        pass

    for pou in project.pous():
        try:
            table = pou.declarations()
        except UnsupportedFormat:
            continue
        for variable in table.variables:
            record(variable.name, pou.name)
    return index


def known_symbol_names(project: Project) -> set[str]:
    """Every name that could legitimately appear in a POU body.

    This is the allowance list for the ST linter: declared symbols from the
    whole project plus every type name in use.  It is intentionally generous.
    Flagging a name that exists elsewhere would be a false positive, and a
    linter that cries wolf gets ignored; a name that is genuinely undefined will
    still be caught, because it appears nowhere at all.
    """
    names: set[str] = set(symbol_index(project).keys())
    try:
        names |= {v.type_name for v in project.global_variables().variables}
    except UnsupportedFormat:
        pass
    for pou in project.pous():
        try:
            names |= {v.type_name for v in pou.declarations().variables}
        except UnsupportedFormat:
            continue
    return names


def global_names(project: Project) -> set[str]:
    """The names of the project's VAR_GLOBAL declarations.

    Separate from ``known_symbol_names``, which is deliberately generous, because a
    global is reachable from a POU ONLY if that POU declares it as VAR_EXTERNAL.  The
    linter needs to tell the two apart: a name that resolves nowhere is a spelling
    mistake, while a global this POU has not imported is a build that STALLS with an
    empty Errors pane.  Measured with PLCMODE_ON, a system global the project has had
    from the first byte.
    """
    try:
        return {v.name for v in project.global_variables().variables}
    except UnsupportedFormat:
        return set()


def find_symbol(project: Project, symbol: str) -> list[Variable]:
    """Return every declaration of ``symbol`` anywhere in the project."""
    found: list[Variable] = []
    try:
        found.extend(project.global_variables().variants(symbol))
    except UnsupportedFormat:
        pass
    for pou in project.pous():
        try:
            found.extend(pou.declarations().variants(symbol))
        except UnsupportedFormat:
            continue
    return found
