"""Pure text transforms for MotionWorks IEC variable declarations.

These functions operate on the ``.VB`` declaration text only.  That is
sufficient to add, edit and delete variables: measured empirically, the compiler
reads declarations from this stream and does **not** require the binary ``.VGR``
grid to be updated (see docs/tier2-format-notes.md).  A `.VB`-only edit compiled
clean with the grid left byte-identical.

Keeping the transforms pure -- text in, text out -- means they can be unit
tested without touching a project, and the write layer only has to handle
backup, atomic replacement and read-back verification.

Observed format (CRLF, latin-1, tab-indented)::

    <blank>
    (*Group:Default*)
    <blank>
    <blank>
    VAR_EXTERNAL
    \tTopCutter :\tAXIS_REF;(*SGD7S - 1 (Do Not Modify!!) *)
    \tEIP_FromCLX_Axis_SVON_Cmd :\tBOOL;
    END_VAR

Blocks with the same keyword may repeat, each optionally preceded by its own
``(*Group:...*)`` marker.  MotionWorks writes a blank line between blocks.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

#: Declaration blocks this module can address.  ``VAR`` is the default for new
#: local variables; ``VAR_EXTERNAL`` is for symbols owned by another POU.
BLOCK_KEYWORDS = (
    "VAR_GLOBAL",
    "VAR_EXTERNAL",
    "VAR_INPUT",
    "VAR_OUTPUT",
    "VAR_IN_OUT",
    "VAR_TEMP",
    "VAR_RETAIN",
    "VAR_CONFIG",
    "VAR_ACCESS",
    "VAR",
)

_INDENT = "\t"
_SEPARATOR = " :\t"


class DeclarationError(ValueError):
    """Raised when a declaration cannot be parsed or edited safely."""


@dataclass
class Block:
    """A ``VAR``-family block located in the declaration text."""

    keyword: str
    start: int          # index of the keyword line
    end: int            # index of the matching END_VAR line
    lines: list[str]    # the block's lines, inclusive

    @property
    def is_empty(self) -> bool:
        return self.end == self.start + 1


def _line_ending(text: str) -> str:
    return "\r\n" if "\r\n" in text else "\n"


def split_lines(text: str) -> tuple[list[str], str]:
    """Split into lines without terminators, plus the dominant line ending."""
    ending = _line_ending(text)
    normalised = text.replace("\r\n", "\n")
    return normalised.split("\n"), ending


def join_lines(lines: list[str], ending: str) -> str:
    return ending.join(lines)


def find_blocks(lines: list[str]) -> list[Block]:
    """Locate every declaration block, in order."""
    blocks: list[Block] = []
    index = 0
    while index < len(lines):
        stripped = lines[index].strip()
        upper = stripped.upper()
        keyword = None
        for candidate in BLOCK_KEYWORDS:
            if upper == candidate or upper.startswith(candidate + " "):
                keyword = candidate
                break
        if keyword is None:
            index += 1
            continue
        # Find the matching END_VAR.
        end = index + 1
        while end < len(lines) and lines[end].strip().upper() != "END_VAR":
            end += 1
        if end >= len(lines):
            raise DeclarationError(
                f"unterminated {keyword} block starting at line {index + 1}"
            )
        blocks.append(
            Block(keyword=keyword, start=index, end=end, lines=lines[index : end + 1])
        )
        index = end + 1
    return blocks


def format_declaration(
    name: str,
    type_name: str,
    address: str | None = None,
    initial_value: str | None = None,
    description: str | None = None,
) -> str:
    """Render one declaration line the way MotionWorks writes it."""
    left = name
    if address:
        left = f"{name} AT {address}"
    text = f"{_INDENT}{left}{_SEPARATOR}{type_name}"
    if initial_value:
        text += f" := {initial_value}"
    text += ";"
    if description:
        text += f"(*{description}*)"
    return text


def _find_declaration_line(lines: list[str], name: str) -> int:
    """Return the line index declaring ``name``, or raise."""
    pattern = re.compile(rf"^[ \t]*{re.escape(name)}[ \t]*(?:AT[ \t]+\S+[ \t]*)?:",
                         re.IGNORECASE)
    matches = [i for i, line in enumerate(lines) if pattern.match(line)]
    if not matches:
        raise DeclarationError(f"variable {name!r} is not declared")
    if len(matches) > 1:
        raise DeclarationError(
            f"variable {name!r} is declared on {len(matches)} lines "
            f"({[m + 1 for m in matches]}); refusing to guess"
        )
    return matches[0]


#: Address prefixes and the IEC elementary types each can legitimately hold.
#: ``%IX``/``%QX`` are bit addresses, so they must be BOOL.  A word address can
#: hold any numeric type of the matching width or narrower.
_ADDRESS_CLASSES: tuple[tuple[str, set[str] | None], ...] = (
    ("%IX", {"BOOL"}),
    ("%QX", {"BOOL"}),
    ("%MX", {"BOOL"}),
    ("%IW", None),
    ("%QW", None),
    ("%MW", None),
    ("%ID", None),
    ("%QD", None),
    ("%MD", None),
    ("%IL", None),
    ("%QL", None),
    ("%ML", None),
    ("%IB", None),
    ("%QB", None),
    ("%MB", None),
)


def address_class_types(address: str) -> set[str] | None:
    """Return the types an address may hold, or None when unconstrained.

    None means "not a bit address", i.e. a numeric width that we do not attempt
    to police; the callers only use this to catch the clear contradiction of
    putting a non-BOOL type on a ``%IX``/``%QX``/``%MX`` bit address.
    """
    upper = address.strip().upper()
    for prefix, allowed in _ADDRESS_CLASSES:
        if upper.startswith(prefix):
            return allowed
    return None


def check_address_type(address: str | None, type_name: str) -> str | None:
    """Return a warning when ``type_name`` is impossible at ``address``.

    MotionWorks binds a ``%IX``/``%QX``/``%MX`` address to a single bit, so
    declaring it as anything but BOOL cannot compile.  This was observed
    directly: changing an I/O-mapped ``BOOL AT %IX21488.5`` to ``DINT`` made the
    build fail (``IsCompiled=False``, no outputs), while the same type change on
    an unaddressed variable compiled cleanly.
    """
    if not address:
        return None
    allowed = address_class_types(address)
    if allowed is None:
        return None
    if type_name.strip().upper() not in allowed:
        return (
            f"type {type_name!r} cannot be bound to the bit address {address!r}; "
            f"only {', '.join(sorted(allowed))} is valid there"
        )
    return None


def find_referencing_pous(
    variable: str, bodies: dict[str, str]
) -> list[str]:
    """Return the names of POUs whose body references ``variable``.

    Deleting a variable that code still uses produces a dangling reference and
    the build fails; this was observed directly (deleting a POU-local variable
    made the build fail while the same delete of an unreferenced variable
    compiled).  Checking first turns a confusing build error into a clear
    refusal.
    """
    pattern = re.compile(rf"(?<![A-Za-z0-9_.]){re.escape(variable)}(?![A-Za-z0-9_])")
    return sorted(name for name, body in bodies.items() if pattern.search(body))


def add_variable(
    text: str,
    name: str,
    type_name: str,
    section: str = "VAR",
    address: str | None = None,
    initial_value: str | None = None,
    description: str | None = None,
) -> tuple[str, list[str]]:
    """Add a declaration, returning ``(new_text, notes)``.

    Appends to the last block of the requested ``section``; if there is none,
    a new block is appended at the end of the text.  Refuses if the name is
    already declared, because a duplicate would be a confusing build error.
    """
    section = section.upper()
    if section not in BLOCK_KEYWORDS:
        raise DeclarationError(
            f"unknown section {section!r}; expected one of {BLOCK_KEYWORDS}"
        )
    if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", name):
        raise DeclarationError(f"invalid variable name {name!r}")
    if not type_name.strip():
        raise DeclarationError("type name is required")

    lines, ending = split_lines(text)
    notes: list[str] = []

    try:
        _find_declaration_line(lines, name)
    except DeclarationError as exc:
        if "not declared" not in str(exc):
            raise
    else:
        raise DeclarationError(f"variable {name!r} is already declared")

    declaration = format_declaration(
        name, type_name, address, initial_value, description
    )
    blocks = find_blocks(lines)
    target = next((b for b in reversed(blocks) if b.keyword == section), None)

    if target is not None:
        lines.insert(target.end, declaration)
    else:
        notes.append(f"no {section} block existed; appended a new one")
        # Separate with exactly one blank line, reusing a trailing blank if the
        # file already ends with blanks rather than adding another.
        #
        # This is what makes add and delete symmetric.  Appending unconditionally
        # puts the new block below a growing tail of blanks, and delete cannot tell
        # that tail apart from blanks the file legitimately ended with -- a stress
        # matrix caught exactly that as stray lines left behind on every cycle.
        if lines and lines[-1].strip():
            lines.append("")
        lines.append(section)
        lines.append(declaration)
        lines.append("END_VAR")
    return join_lines(lines, ending), notes


def edit_variable(
    text: str,
    name: str,
    new_name: str | None = None,
    type_name: str | None = None,
    address: str | None = None,
    initial_value: str | None = None,
    description: str | None = None,
    clear_address: bool = False,
) -> tuple[str, list[str]]:
    """Rewrite a variable's declaration line, returning ``(new_text, notes)``.

    Only the fields supplied are changed.  ``clear_address`` exists because
    ``address=None`` means "leave the address alone", so removing an ``AT``
    clause needs an explicit flag rather than an ambiguous default.
    """
    from .variables import parse_declarations

    lines, ending = split_lines(text)
    index = _find_declaration_line(lines, name)
    # The declaration parser expects a complete block, so wrap the single line
    # in a temporary one rather than parsing a bare fragment.
    probe = "\r\nVAR\r\n" + lines[index] + "\r\nEND_VAR\r\n"
    existing = parse_declarations(probe, source_stream=None)
    candidate = next(
        (v for v in existing.variables if v.name.casefold() == name.casefold()), None
    )
    if candidate is None:
        raise DeclarationError(f"could not parse the declaration of {name!r}")
    current = candidate

    if new_name and new_name != name:
        try:
            _find_declaration_line(lines, new_name)
        except DeclarationError as exc:
            if "not declared" not in str(exc):
                raise
        else:
            raise DeclarationError(f"variable {new_name!r} already exists")

    final_name = new_name or current.name
    final_type = type_name if type_name is not None else current.type_name
    if clear_address:
        final_address = None
    elif address is not None:
        final_address = address
    else:
        final_address = current.address
    final_initial = (
        initial_value if initial_value is not None else current.initial_value
    )

    # Description handling: an empty string clears it, None preserves it.
    if description is None:
        final_description = current.description
    else:
        final_description = description or None

    lines[index] = format_declaration(
        final_name, final_type, final_address, final_initial, final_description
    )
    notes = [f"rewrote line {index + 1}"]
    return join_lines(lines, ending), notes


def delete_variable(
    text: str,
    name: str,
    remove_empty_blocks: bool = True,
) -> tuple[str, list[str]]:
    """Remove a declaration, returning ``(new_text, notes)``.

    By default an emptied block is removed too, so the text does not accumulate
    stray ``VAR``/``END_VAR`` pairs.  MotionWorks tolerates empty blocks, but
    leaving them behind makes later diffs noisy.
    """
    lines, ending = split_lines(text)
    index = _find_declaration_line(lines, name)
    del lines[index]
    notes = [f"removed the declaration of {name!r}"]

    if remove_empty_blocks:
        blocks = find_blocks(lines)
        removed: list[str] = []
        for block in reversed(blocks):
            if block.end == block.start + 1:
                # Take the blank padding immediately in front of the block, but
                # stop at any real content -- and never walk past the start of the
                # text.
                #
                # An earlier version also consumed a preceding ``(*Group:...*)``
                # marker and every blank before it.  On a POU whose declaration
                # file contains only a group marker (a real case: a POU with no
                # variables), removing a just-added block then emptied the whole
                # file, destroying the marker.  A group marker is content that was
                # never ours to delete.
                start = block.start
                while start > 1 and not lines[start - 1].strip():
                    start -= 1
                del lines[start : block.end + 1]
                removed.append(block.keyword)
        if removed:
            notes.append(
                "removed now-empty block(s): " + ", ".join(reversed(removed))
            )
    return join_lines(lines, ending), notes
