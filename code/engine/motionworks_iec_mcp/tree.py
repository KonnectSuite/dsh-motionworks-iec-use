"""Parse the ``PROJECT.TRE`` project-tree stream.

MotionWorks keeps the project structure in the ``PROJECT.TRE`` stream of the root
``src.st1``.  It is the authority for which program instances run in which task,
and for the node identities a structural edit (creating or deleting a POU,
assigning a task) must maintain.

Layout, established from real trees::

    line 0   version marker ("V51")
    line 1   total node count
    line 2   configuration count
    line 3   the root node's params line
    then per node:
        <count>                  subtree node count
        <id> <a> <children> <d>  params
        <name>
        <path>                   optional; blank for container nodes
        <state line(s)>          tab-separated; may hold -1 and alnum handles
        <GUID>                   optional
        <marker>                 optional, e.g. "<3>"

**The child count is ``params[2]``, not ``params[1]``.**  ``Project 0 0 56 0``
with header total 57 means 56 children plus the root itself, and
``Logical POUs 4 1 28 0`` means 28 children -- 7 POUs of 4 records each.

Five record-shape details each caused a *silent* desynchronisation, which is the
worst failure mode because the parse still succeeds while producing wrong output.
All are handled here and covered by tests in ``tools/test_tree.py``:

1. the child count is ``params[2]``;
2. a container's state line can be almost all tabs, so testing the *stripped*
   line loses the tabs and it reads as a bare number;
3. state fields can be negative (``-1``);
4. handles are mixed alphanumeric (``a449b235``) and up to 28 characters;
5. a node can carry a bare handle line with no tabs, plus a marker such as
   ``<3>``.

The crux is telling a node's state line from the next node's count line: both can
be a bare integer.  They are distinguished by lookahead -- a genuine count line is
immediately followed by a params line.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from .cfb import CompoundFile

#: A params line: four integers, e.g. "0 0 56 0".
PARAMS_RE = re.compile(r"^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$")

#: GUID lines look like "3D84B45B C9CE 4C2A B1 F2 B7 AC FC B1 A9 94".
GUID_RE = re.compile(r"^[0-9A-Fa-f]{8}(\s+[0-9A-Fa-f]{4}){1,}(\s+[0-9A-Fa-f]{2})+$")

#: A trailing annotation such as "<3>" seen on some nodes.
TRAILING_MARKER_RE = re.compile(r"^<\d+>$")

#: A task node's path points at the resource task directory.
_TASK_PATH_RE = re.compile(
    r"Configuration[\\/]R[\\/]Resource[\\/][^\\/\t]+$", re.IGNORECASE
)


class TreeParseError(ValueError):
    """The tree did not match the expected shape."""


@dataclass
class TreeNode:
    """One node in the project tree.

    ``descendants`` is ``params[2]``: a subtree size used as an upper bound on the
    child loop.  It is deliberately not treated as an exact child count -- see the
    note in :func:`parse_tree`.

    ``start_line`` and ``end_line`` are the span of source lines this node owns,
    from its own count/params line through everything up to (but excluding) the
    next sibling.  Recording the span is what makes a byte-exact re-emit possible:
    the parser does not have to model every record kind, only prove it accounted
    for all of them.  That property is the prerequisite for writing the tree,
    because a writer built on a lossy parse would silently corrupt a project.
    """

    node_id: int
    descendants: int
    params: tuple[int, int, int, int]
    name: str
    path: str
    line: int
    children: list["TreeNode"] = field(default_factory=list)
    start_line: int = 0
    end_line: int = 0

    @property
    def span(self) -> tuple[int, int]:
        """Half-open ``(start, end)`` line range owned by this node."""
        return (self.start_line, self.end_line)

    def walk(self, depth: int = 0):
        yield depth, self
        for child in self.children:
            yield from child.walk(depth + 1)

    def find(self, predicate) -> list["TreeNode"]:
        return [node for _, node in self.walk() if predicate(node)]


def _next_nonblank(lines: list[str], index: int) -> int | None:
    look = index + 1
    while look < len(lines) and not lines[look].strip():
        look += 1
    return look if look < len(lines) else None


def header_starts_node(lines: list[str], index: int) -> bool:
    """True when ``lines[index]`` begins a new node's header block.

    Two forms exist:

    * a **params line** -- the root has no count line of its own, so its header
      begins directly with one on line 3;
    * a **bare integer followed by a params line** -- how every child begins.

    The lookahead is essential.  A node's state line can also be a bare integer
    on its own (``'\\t\\t\\t\\t0\\t'`` strips to ``'0'``), and a params test alone
    cannot tell the two apart.  What separates them is that a real count line is
    immediately followed by that node's params line, whereas a state line is
    followed by a blank or another state line.
    """
    stripped = lines[index].strip()
    if PARAMS_RE.match(stripped):
        return True
    if not stripped.isdigit():
        return False
    following = _next_nonblank(lines, index)
    return following is not None and bool(PARAMS_RE.match(lines[following].strip()))


def is_state_line(line: str) -> bool:
    """True for a node's tab-separated numeric state line.

    These are mostly digits, but a field can be negative or an alphanumeric
    handle, and a container's state line may be almost entirely tabs::

        0\\t0\\t0\\t0\\t0\\t0\\t0\\t0\\t6522df69
        \\t\\t\\t\\t0\\t

    Two easy mistakes both cause a silent desynchronisation: requiring all-digits
    rejects the handle form, and testing the *stripped* line loses the tabs so an
    all-tabs line looks like a bare number.
    """
    if "\t" not in line:
        return False
    fields = line.strip().split("\t")
    if not all(
        f == ""
        or re.fullmatch(r"-?\d+", f)                  # numeric, may be -1
        or re.fullmatch(r"[0-9A-Za-z]{1,64}", f)      # handle, length varies
        for f in fields
    ):
        return False
    return any(re.fullmatch(r"-?\d+", f) for f in fields)


def parse_tree(text: str) -> tuple[list[TreeNode], list[str]]:
    """Parse a ``PROJECT.TRE`` payload into top-level nodes.

    Returns ``(roots, warnings)``.  A node's declared child count delimits its
    children.  A shortfall is reported as a warning rather than raised, because a
    partially readable tree is still useful -- but a shortfall is exactly the
    signal that the walk went wrong, so it must not be swallowed.
    """
    warnings: list[str] = []
    lines = text.replace("\r\n", "\n").split("\n")

    if not lines or not lines[0].startswith("V"):
        raise TreeParseError(f"unexpected tree header: {lines[0]!r}")
    if len(lines) < 4:
        raise TreeParseError("tree is too short to contain a root node")

    index = 0

    def skip_blanks() -> None:
        nonlocal index
        while index < len(lines) and not lines[index].strip():
            index += 1

    def read_node() -> TreeNode | None:
        nonlocal index
        skip_blanks()
        if index >= len(lines):
            return None
        node_start = index

        # A child begins with a bare count line; the root has no count line of
        # its own, so accept a params line here too and validate it next.
        head = lines[index].strip()
        if not (head.isdigit() or PARAMS_RE.match(head)):
            return None
        if head.isdigit():
            index += 1

        skip_blanks()
        if index >= len(lines):
            return None
        params_match = PARAMS_RE.match(lines[index].strip())
        if params_match is None:
            return None
        params = tuple(int(group) for group in params_match.groups())
        params_line = index
        index += 1

        skip_blanks()
        if index >= len(lines):
            return None
        name = lines[index].split("\t")[0]
        index += 1

        # Optional path: present only when the line is neither blank, nor a state
        # line, nor a GUID.
        path = ""
        if index < len(lines):
            candidate = lines[index]
            stripped = candidate.strip()
            if (
                stripped
                and not GUID_RE.match(stripped)
                and not is_state_line(candidate)
            ):
                path = candidate
                index += 1

        # Everything up to the next node's header belongs to this node: state
        # line(s), the GUID, a bare handle, and a marker.
        while index < len(lines):
            stripped = lines[index].strip()
            if not stripped:
                look = index + 1
                while look < len(lines) and not lines[look].strip():
                    look += 1
                if look < len(lines) and header_starts_node(lines, look):
                    break
                index += 1
                continue
            if header_starts_node(lines, index):
                break
            if TRAILING_MARKER_RE.match(stripped):
                index += 1
                continue
            if GUID_RE.match(stripped) or is_state_line(lines[index]):
                index += 1
                continue
            if re.fullmatch(r"[0-9A-Za-z]{2,64}", stripped):
                # A bare handle with no tabs is still this node's data.
                index += 1
                continue
            break

        node = TreeNode(
            node_id=params[0],
            descendants=params[2],
            params=params,  # type: ignore[arg-type]
            name=name,
            path=path,
            line=params_line,
            start_line=node_start,
        )
        # `descendants` (params[2]) is the *subtree* size, used as an upper bound
        # on the child loop.  It is not an exact child count: `Tasks` declares 11
        # where 7 children follow, and `Resource` declares 14 with 1.  The loop is
        # therefore self-terminating -- read_node returns None once the node's
        # records are exhausted and the next sibling's header appears -- and a
        # shortfall is normal rather than an error.
        #
        # Each child's span ends where the next child begins, so between them the
        # children own every line of this node's subtree with no gaps and no
        # overlap.  That is what makes a byte-exact re-emit verifiable.
        previous: TreeNode | None = None
        for _ in range(node.descendants):
            child_start = index
            if previous is not None:
                previous.end_line = child_start
            child = read_node()
            if child is None:
                index = child_start
                break
            node.children.append(child)
            previous = child
        node.end_line = index
        return node

    # The root's params line is line 3.  Skipping "until a numbered line" is
    # wrong, because the root's own params line is numbered.
    index = 3
    roots: list[TreeNode] = []
    root = read_node()
    if root is None:
        raise TreeParseError("could not read the root node")
    roots.append(root)

    while True:
        node = read_node()
        if node is None:
            break
        roots.append(node)
    return roots, warnings


def load_tree(project_or_src: Path) -> tuple[list[TreeNode], str, list[str]]:
    """Load and parse ``PROJECT.TRE`` from a project directory or root src.st1."""
    path = Path(project_or_src)
    if path.is_dir():
        path = path / "src.st1"
    cfb = CompoundFile(path)
    if "PROJECT.TRE" not in cfb.stream_names():
        raise TreeParseError(f"no PROJECT.TRE stream in {path}")
    text = cfb.read_stream("PROJECT.TRE").decode("latin1")
    roots, warnings = parse_tree(text)
    return roots, text, warnings


def _walk_all(roots: list[TreeNode]):
    for root in roots:
        yield from root.walk()


def task_assignments(roots: list[TreeNode]) -> dict[str, list[str]]:
    """Map task name -> assigned program instance names.

    A task node's path points at the resource task directory **and its final path
    component equals its name** -- ``C\\Configuration\\R\\Resource\\FastTsk`` for
    the node called ``FastTsk``.  Matching the directory pattern alone also
    catches ``Global_Variables`` and ``IO_Configuration``, whose paths live in the
    same directory but carry a file extension, and program-instance nodes carry
    the task type in later fields rather than the path.
    """
    assignments: dict[str, list[str]] = {}
    for _, node in _walk_all(roots):
        record = node.path.split("\t")[0].replace("/", "\\")
        if not _TASK_PATH_RE.search(record):
            continue
        if "\t" not in node.path:
            continue
        if record.split("\\")[-1] != node.name:
            continue
        assignments[node.name] = [child.name for child in node.children]
    return assignments


def program_instances(roots: list[TreeNode]) -> list[tuple[str, str]]:
    """Return ``(task_name, program_instance_name)`` pairs."""
    pairs: list[tuple[str, str]] = []
    for task, programs in task_assignments(roots).items():
        for program in programs:
            pairs.append((task, program))
    return pairs


@dataclass
class TreeDocument:
    """A parsed tree together with everything needed to re-emit it exactly.

    Keeping the original text means a re-emit cannot lose a record the parser
    does not model.  That is the whole point: it turns "the parse looks right"
    into "the parse provably accounts for every byte", which is the prerequisite
    for ever writing the tree.

    ``text`` is the verbatim input.  ``lines`` is the LF-normalised view used for
    line indexing, and is *not* what gets emitted -- joining it back would rewrite
    every CRLF, which is exactly the kind of silent change this design exists to
    rule out.  A future edit will splice replacement lines into ``text``.
    """

    text: str
    lines: list[str]
    roots: list[TreeNode]
    warnings: list[str] = field(default_factory=list)

    @property
    def ending(self) -> str:
        return "\r\n" if "\r\n" in self.text else "\n"

    def emit(self) -> str:
        """Re-emit the original text verbatim.

        Byte-identical by construction.  Before any write exists this is the
        safest possible emitter: it cannot invent a change.  Edits replace the
        affected line ranges in ``text`` rather than re-serialising records.
        """
        return self.text

    def lines_for(self, span: tuple[int, int]) -> list[str]:
        """The source lines a span covers, without line endings."""
        return self.lines[span[0]:span[1]]

    def splice(self, edits: list[tuple[int, int, list[str]]]) -> str:
        """Apply several line-level edits at once and re-emit.

        ``edits`` are ``(start, end, replacement_lines)``; ``start == end``
        inserts.  Edits are applied right-to-left so earlier line numbers stay
        valid, which means a caller can compute every span from one parse and
        then commit them together -- important when one edit shifts the lines of
        another.
        """
        lines = list(self.lines)
        # Right-to-left, so edits at lower line numbers keep their coordinates.
        # Insertions sort before replacements at the same start, and the tuple
        # carries a type tag because a plain `start` key collides when one edit
        # inserts at a line another edit rewrites.
        ordered = sorted(edits, key=lambda e: (e[0], 0 if e[0] == e[1] else 1),
                         reverse=True)
        for start, end, replacement in ordered:
            lines[start:end] = list(replacement)
        return self.ending.join(lines)

    def walk_with_ancestors(
        self,
    ) -> list[tuple[TreeNode, list[TreeNode]]]:
        """Every node paired with its ancestor chain, root first.

        Mutating a node's child count changes every ancestor's subtree size, so a
        caller needs the chain, not just the node.
        """
        out: list[tuple[TreeNode, list[TreeNode]]] = []

        def visit(node: TreeNode, ancestors: list[TreeNode]) -> None:
            out.append((node, ancestors))
            for child in node.children:
                visit(child, ancestors + [node])

        for root in self.roots:
            visit(root, [])
        return out

    def replace_span(self, span: tuple[int, int], replacement: list[str]) -> str:
        """Return the text with one span's lines swapped out.

        Splices at line granularity into the original text, so every line outside
        the span survives byte-for-byte and the file's line ending is preserved.
        That is the property a structural edit needs: change a node's records
        without touching the rest of the project tree.

        Callers are responsible for keeping the header counts consistent -- see
        :func:`set_header_total`.
        """
        start, end = span
        before = self.lines[:start]
        after = self.lines[end:]
        return self.ending.join(before + list(replacement) + after)

    def set_header_total(self, total: int) -> str:
        """Return the text with line 1's node count changed.

        Any structural edit changes the node total, and MotionWorks keeps it on
        its own line, so this is the one header field that must move with it.
        """
        if len(self.lines) < 2:
            raise TreeParseError("tree has no total-count line")
        lines = list(self.lines)
        lines[1] = str(total)
        return self.ending.join(lines)

    def lineage(self) -> list[TreeNode]:
        """Nodes in source order, including interior nodes.

        A parent's span necessarily contains its children's, so spans are nested
        rather than disjoint.  :meth:`record_spans` returns the disjoint set that
        actually partitions the file.
        """
        out: list[TreeNode] = []
        for root in self.roots:
            for _, node in root.walk():
                out.append(node)
        return out

    def record_spans(self) -> list[tuple[int, int]]:
        """Disjoint spans covering every record line, in source order.

        A node's own records are its span minus its children's spans, so
        subtracting the children yields one contiguous run per node.  Those runs
        are disjoint by construction, and a correct parse leaves no line unowned.
        Used for both the coverage check and, later, targeted edits.
        """
        spans: list[tuple[int, int]] = []

        def visit(node: TreeNode) -> None:
            cursor = node.start_line
            for child in node.children:
                if child.start_line > cursor:
                    spans.append((cursor, child.start_line))
                visit(child)
                cursor = max(cursor, child.end_line)
            if node.end_line > cursor:
                spans.append((cursor, node.end_line))

        for root in self.roots:
            visit(root)
        return sorted(spans)

    def coverage(self) -> tuple[list[int], list[int]]:
        """Record line indices covered, and any owned more than once.

        Node spans are absolute indices into the same ``lines`` list held here,
        so the comparison is direct.  A correct parse assigns every line after the
        three header lines to exactly one node.
        """
        covered: list[int] = []
        for start, end in self.record_spans():
            covered.extend(range(start, end))
        counts: dict[int, int] = {}
        for index in covered:
            counts[index] = counts.get(index, 0) + 1
        duplicates = sorted(index for index, count in counts.items() if count > 1)
        return sorted(counts), duplicates


def parse_document(text: str) -> TreeDocument:
    """Parse a tree while retaining the source needed for an exact re-emit."""
    roots, warnings = parse_tree(text)
    return TreeDocument(
        text=text,
        lines=text.replace("\r\n", "\n").split("\n"),
        roots=roots,
        warnings=warnings,
    )


def round_trip(text: str) -> tuple[bool, str, list[str]]:
    """Check that parsing then re-emitting reproduces ``text`` exactly.

    Returns ``(matches, emitted, notes)``.  This is the gate on writing the tree:
    a parse that cannot reproduce the input byte-for-byte is not trustworthy
    enough to modify.
    """
    document = parse_document(text)
    emitted = document.emit()

    notes: list[str] = []
    if emitted != text:
        notes.append("re-emitted text differs from the input")
        original_lines = text.replace("\r\n", "\n").split("\n")
        emitted_lines = emitted.replace("\r\n", "\n").split("\n")
        for index in range(max(len(original_lines), len(emitted_lines))):
            before = original_lines[index] if index < len(original_lines) else "<eof>"
            after = emitted_lines[index] if index < len(emitted_lines) else "<eof>"
            if before != after:
                notes.append(
                    f"first difference at line {index}: {before!r} -> {after!r}"
                )
                break

    covered, duplicates = document.coverage()
    expected = set(range(3, len(document.lines)))
    missing = sorted(expected - set(covered))
    if missing:
        notes.append(f"{len(missing)} line(s) not owned by any node: {missing[:8]}")
    if duplicates:
        notes.append(f"line(s) owned by more than one node: {duplicates[:8]}")

    return (emitted == text, emitted, notes)
