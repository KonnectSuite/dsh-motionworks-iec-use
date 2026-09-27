"""Static checks for MotionWorks IEC Structured Text bodies.

This linter is deliberately conservative.  It reports only *high-confidence*
problems and stays silent whenever the answer depends on information it cannot
see: library types, function-block pin diagrams, struct member layouts, device
I/O configuration, and the internals of other POUs.

That restraint is the whole design.  An earlier revision flagged every member
name and function-block pin (``Axis1.AxisNum``, ``MC.Power``'s ``.Execute``,
``.Done``, ``.Error``) as an undefined symbol, which produced hundreds of
findings on correct production code.  A noisy linter is worse than none, because
an agent will either ignore it or start "fixing" working logic.

Checks performed:

``undefined-assignment-target``
    An assignment target (``Name := ...``) is declared nowhere reachable.  This
    is the highest-value check: it is exactly the mistake an agent makes when it
    invents a variable name, and an assignment target is never a member access
    unless written as ``Struct.Member := ...``, which is excluded.

``unused-local``
    A plain ``VAR`` local is never referenced in the executable region.

``unassigned-fb-output``
    A function-block instance is called but none of its outputs is read, so the
    result is discarded.  Reported only when the instance has no output-style
    member access at all.

``unterminated-statement``
    A logical statement does not end with ``;``.  Statements are joined across
    continuation lines first, so multi-line assignments are not misreported.

Scope note: graphical (``.GB``) bodies are not text and cannot be analysed.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

#: IEC 61131-3 keywords and operators that must never be reported as symbols.
KEYWORDS = {
    "IF", "THEN", "ELSIF", "ELSE", "END_IF", "CASE", "OF", "END_CASE",
    "FOR", "TO", "BY", "DO", "END_FOR", "WHILE", "END_WHILE", "REPEAT",
    "UNTIL", "END_REPEAT", "RETURN", "EXIT", "CONTINUE", "VAR", "VAR_INPUT",
    "VAR_OUTPUT", "VAR_IN_OUT", "VAR_GLOBAL", "VAR_EXTERNAL", "VAR_TEMP",
    "END_VAR", "PROGRAM", "FUNCTION", "FUNCTION_BLOCK", "END_PROGRAM",
    "END_FUNCTION", "END_FUNCTION_BLOCK", "TYPE", "END_TYPE", "STRUCT",
    "END_STRUCT", "AT", "RETAIN", "NON_RETAIN", "CONSTANT", "ARRAY", "AND",
    "OR", "XOR", "NOT", "MOD", "TRUE", "FALSE", "NULL",
}

ELEMENTARY_TYPES = {
    "BOOL", "BYTE", "WORD", "DWORD", "LWORD", "SINT", "USINT", "INT", "UINT",
    "DINT", "UDINT", "LINT", "ULINT", "REAL", "LREAL", "STRING", "WSTRING",
    "TIME", "LTIME", "DATE", "LDATE", "TOD", "LTOD", "DT", "LDT",
}

_IDENTIFIER_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
_BLOCK_COMMENT_RE = re.compile(r"\(\*.*?\*\)", re.DOTALL)
_LINE_COMMENT_RE = re.compile(r"//[^\n]*")
_STRING_RE = re.compile(r"'[^'\n]*'")
_TYPED_LITERAL_RE = re.compile(r"\b([A-Za-z_][A-Za-z0-9_]*)#")
#: Identifiers that are the *root* of an expression: not preceded by a dot
#: (so not a member name) and not followed by a dot (so not a struct reference).
_ROOT_IDENT_RE = re.compile(r"(?<![.\w])([A-Za-z_][A-Za-z0-9_]*)\b(?!\s*\.)")
#: An assignment target at the start of a statement, optionally address-prefixed.
#: Retained for reference; statement-level extraction is done by
#: :func:`assignment_targets`, which tracks parenthesis depth.
_MEMBER_NAMES_RE = re.compile(r"\.\s*([A-Za-z_][A-Za-z0-9_]*)")
#: The root of a member access, e.g. ``Axis1`` in ``Axis1.AxisNum``.  Deliberately
#: separate from _ROOT_IDENT_RE, which skips these.
_MEMBER_ROOT_RE = re.compile(r"(?<![.\w])([A-Za-z_][A-Za-z0-9_]*)\s*\.")
_CALL_RE = re.compile(r"\b([A-Za-z_][A-Za-z0-9_]*)\s*\(")
_END_VAR_RE = re.compile(r"\bEND_VAR\b", re.IGNORECASE)


@dataclass
class Finding:
    """One lint result."""

    severity: str  # "error" | "warning" | "info"
    code: str
    message: str
    line: int | None = None
    hint: str | None = None

    def format(self) -> str:
        location = f"line {self.line}: " if self.line else ""
        text = f"[{self.severity.upper()}] {location}{self.message}"
        if self.hint:
            text += f"\n           hint: {self.hint}"
        return text


@dataclass
class LintResult:
    findings: list[Finding] = field(default_factory=list)
    used_symbols: set[str] = field(default_factory=set)
    referenced_members: set[str] = field(default_factory=set)

    @property
    def errors(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "error"]

    @property
    def warnings(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "warning"]

    @property
    def ok(self) -> bool:
        return not self.errors

    def add(self, severity: str, code: str, message: str, line: int | None = None,
            hint: str | None = None) -> None:
        self.findings.append(
            Finding(severity=severity, code=code, message=message, line=line, hint=hint)
        )


def strip_comments_and_strings(text: str) -> str:
    """Remove comments and string literals, preserving line structure.

    Line count is preserved so reported line numbers stay accurate.
    """

    def blank(match: re.Match[str]) -> str:
        return re.sub(r"[^\n]", " ", match.group(0))

    return _STRING_RE.sub(blank, _LINE_COMMENT_RE.sub(blank, _BLOCK_COMMENT_RE.sub(blank, text)))


def split_code_region(body: str, clean: str) -> tuple[str, str, int]:
    """Split a POU into its declaration region and executable region.

    Returns ``(declarations, code, code_start_line)``.

    MotionWorks stores POU declarations in the separate ``<POU>V.VB`` stream,
    so the ST body normally contains *only* executable code and there is no
    ``END_VAR`` to find.  Some other IEC toolchains inline declarations before
    the implementation; that form is handled too.
    """
    matches = list(_END_VAR_RE.finditer(clean))
    if not matches:
        return "", clean, 1
    last = matches[-1]
    return clean[: last.start()], clean[last.end():], body.count("\n", 0, last.end()) + 1


#: A line that legitimately does not need a trailing semicolon because it opens
#: or closes a block.
_BLOCK_EDGE_RE = re.compile(
    r"^(END_|ELSE\b|ELSIF\b|CASE\b|REPEAT$|UNTIL\b|TYPE\b|STRUCT\b|"
    r"FOR\b|WHILE\b|IF\b)",
    re.IGNORECASE,
)
#: A line whose ending means the statement carries on, so the missing ';' is
#: expected rather than a defect.
_CONTINUATION_TAIL_RE = re.compile(
    r"(\:\=|[+\-*/(,=<>&|^]|\b(?:AND|OR|XOR|MOD|NOT|TO|BY))$",
    re.IGNORECASE,
)
#: A line ending that completes a statement or a block header.  The `:` branch
#: accepts any label-style colon, including a typed-literal CASE label such as
#: ``INT#10:``, while the lookahead excludes the `:` of `:=`, which marks an
#: assignment that continues onto the next line.
_TERMINAL_TAIL_RE = re.compile(
    r"(;(?!\s*=)|:(?!\s*=)|\bTHEN$|\bDO$|\bREPEAT$|\bELSE$|"
    r"\bEND_IF$|\bEND_CASE$|\bEND_WHILE$|\bEND_FOR$|\bEND_REPEAT$)",
    re.IGNORECASE,
)


def _next_significant_line(lines: list[str], offset: int) -> str:
    """Return the next non-blank line after ``offset``, or an empty string."""
    for probe in lines[offset + 1:]:
        text = probe.strip()
        if text:
            return text
    return ""


def unterminated_lines(code: str, start_line: int) -> list[tuple[int, str]]:
    """Find lines that look like they are missing a terminating ``;``.

    MotionWorks ST deliberately spreads one statement over several lines::

        EIP_ToCLX_CLXMasterHealthy :=
            xCLXHeartbeatValidated
            AND (NOT fbCLXHeartbeatTimeout.Q);

        IF
            xCLXMasterHealthyPrev
            AND (NOT EIP_ToCLX_CLXMasterHealthy)
        THEN

    Only the *opening* line of such a statement could carry a semicolon, and
    continuation lines never do.  Detection therefore tracks whether the previous
    line reached a terminal token (``;``, ``:``, ``THEN``, ``DO``, ``REPEAT``,
    ``ELSE``, or an ``END_*``):

    * if it did, this line starts a fresh statement, so a missing terminator is a
      real defect and the line is reported;
    * if it did not, this line continues the previous statement and is skipped.

    A statement is treated as continuing only when it *ends* with something that
    cannot end a statement (an operator or a bare ``:=``), or when it sits inside
    an unclosed parenthesis.  Mid-line ``:=`` is deliberately not a continuation
    signal, because ``X := value`` is a complete statement; treating it as open
    would hide a genuinely dropped semicolon.

    One special case is closed explicitly: a complete-looking assignment such as
    ``X := Y.Z`` immediately before a block edge (``IF``, ``END_IF``) must be
    missing its semicolon, since an expression cannot continue into a block
    keyword.
    """
    findings: list[tuple[int, str]] = []
    lines = code.splitlines()
    depth = 0
    previous_terminal = True  # start of region behaves like a fresh statement

    for offset, raw in enumerate(lines):
        # Right-strip as well as strip: a line ending in ':=' followed by
        # trailing whitespace would defeat the $-anchored checks below.
        line = raw.strip().rstrip()
        if not line:
            # A blank line does not change whether we are mid-statement.
            continue

        depth_before = depth
        depth += line.count("(") - line.count(")")
        opens_group = depth_before != 0 or depth > 0

        terminates = bool(_TERMINAL_TAIL_RE.search(line))
        continues = bool(_CONTINUATION_TAIL_RE.search(line))

        # `X := Y.Z` right before a block edge is a dropped semicolon.
        if (
            not terminates
            and not continues
            and not opens_group
            and ":=" in line
            and _BLOCK_EDGE_RE.match(_next_significant_line(lines, offset) or "")
        ):
            findings.append((start_line + offset, line))
            previous_terminal = True
            continue

        if (
            previous_terminal
            and not terminates
            and not opens_group
            and not _BLOCK_EDGE_RE.match(line)
            and not continues
        ):
            findings.append((start_line + offset, line))

        # `continues` means the statement is still open, so the next line is a
        # continuation and must NOT be treated as starting a fresh statement.
        # `opens_group` likewise leaves the statement open.
        previous_terminal = (not continues) and (not opens_group) and terminates

    return findings


def _line_of(text: str, index: int) -> int:
    return text.count("\n", 0, index) + 1


def assignment_targets(code: str) -> list[tuple[int, str]]:
    """Find ``Name := `` at *statement* level, ignoring named FB parameters.

    MotionWorks function blocks are called with named parameters::

        MC_Power_1(Enable := TRUE, Axis := Axis1);

    That ``Enable := TRUE`` sits inside parentheses and is an input pin, not a
    variable assignment.  Reporting it as an undefined symbol is exactly the
    false positive that makes a linter useless, so only assignments at paren
    depth zero are treated as statement targets.
    """
    results: list[tuple[int, str]] = []
    i = 0
    length = len(code)
    while i < length:
        char = code[i]
        if char == "(":
            depth = 1
            i += 1
            # Skip the entire parenthesised group, including nested ones.
            while i < length and depth:
                if code[i] == "(":
                    depth += 1
                elif code[i] == ")":
                    depth -= 1
                i += 1
            continue
        if char == ":" and i + 1 < length and code[i + 1] == "=":
            # Walk back over the optional lvalue to its first identifier.
            j = i - 1
            while j >= 0 and code[j] in " \t":
                j -= 1
            # Allow an array index on the lvalue.
            if j >= 0 and code[j] == "]":
                depth = 1
                j -= 1
                while j >= 0 and depth:
                    if code[j] == "]":
                        depth += 1
                    elif code[j] == "[":
                        depth -= 1
                    j -= 1
                while j >= 0 and code[j] in " \t":
                    j -= 1
            end = j
            while j >= 0 and (code[j].isalnum() or code[j] == "_"):
                j -= 1
            start = j + 1
            name = code[start : end + 1]
            if name and (name[0].isalpha() or name[0] == "_"):
                results.append((start, name))
            i += 2
            continue
        i += 1
    return results


def lint(
    body: str,
    declared: set[str] | None = None,
    known_symbols: set[str] | None = None,
    fb_instance_types: set[str] | None = None,
    local_vars: set[str] | None = None,
    project_globals: set[str] | None = None,
) -> LintResult:
    """Lint one Structured Text body.

    Args:
        body: Raw ST source.
        declared: Every name reachable in this POU (locals plus externals).
        known_symbols: Project globals plus every type/library name that could
            legitimately appear.  Names here are never reported.
        fb_instance_types: Names of declared function-block instances.
        local_vars: Names declared in a plain ``VAR`` block, used for the
            unused-local check.  Externals are excluded: they are owned
            elsewhere and may legitimately be unused here.
        project_globals: Names of the project's VAR_GLOBAL declarations.  A
            global is reachable ONLY if this POU declares it as VAR_EXTERNAL,
            and MotionWorks does not say so - it stalls the build silently.
    """
    result = LintResult()
    declared_u = {n.upper() for n in (declared or set())}
    known_u = {n.upper() for n in (known_symbols or set())}
    fb_instances = {n.upper() for n in (fb_instance_types or set())}
    # Preserve original casing so messages quote the declared name, not an
    # upper-cased comparison key.
    declared_display = {n.upper(): n for n in (local_vars or set())}
    locals_u = set(declared_display)
    globals_u = {n.upper() for n in (project_globals or set())}

    clean = strip_comments_and_strings(body)
    if not clean.strip():
        return result

    _declarations, code, code_start = split_code_region(body, clean)
    if not code.strip():
        return result

    # Member names (`.Done`, `.AxisNum`) are never symbols of this POU.
    members = {m.group(1).upper() for m in _MEMBER_NAMES_RE.finditer(code)}
    result.referenced_members = members

    # Every root identifier in the executable region: a name that is neither
    # preceded by a dot (so not a member) nor followed by a dot (so not a struct
    # access).
    roots = {m.group(1) for m in _ROOT_IDENT_RE.finditer(code)}
    # Roots of member accesses, e.g. Axis1 in `Axis1.AxisNum`.  These ARE uses of
    # the variable, even though the root regex deliberately skips them.
    member_roots = {m.group(1) for m in _MEMBER_ROOT_RE.finditer(code)}
    invoked = {m.group(1).upper() for m in _CALL_RE.finditer(code)}
    # A name used in any of these ways counts as used.
    used = {r.upper() for r in roots} | {r.upper() for r in member_roots} | invoked
    result.used_symbols = roots | member_roots

    # ------------------------------------------------------------------
    # High-confidence check: assignment targets that resolve to nothing.
    # ------------------------------------------------------------------
    for start, name in assignment_targets(code):
        upper = name.upper()
        if upper in KEYWORDS or upper in declared_u:
            continue
        if upper in globals_u:
            # THE SILENT STALL.  This name exists - it is a project global - so the
            # old check let it through via known_u.  But MotionWorks only reaches a
            # global from a POU that declares it VAR_EXTERNAL, and when it does not
            # it does not report an undeclared symbol: the build STALLS with
            # is_compiled=false, is_modified=true and an EMPTY Errors pane, so the
            # agent sees a hang and no reason.  Measured with PLCMODE_ON, a system
            # global present in the project from the start.
            line = code_start + code.count("\n", 0, start)
            result.add(
                "error",
                "global-not-declared-external",
                f"{name!r} is a project global but this POU does not declare it as "
                f"VAR_EXTERNAL, so the compiler cannot resolve it and the build STALLS "
                f"with an empty error list",
                line,
                hint=(
                    "Add it to this POU's VAR_EXTERNAL block, or use a variable this "
                    "POU already declares - read them with mw_code_read_st. MotionWorks "
                    "does not report this as an error; it simply never finishes."
                ),
            )
            continue
        if upper in known_u:
            continue
        if upper in ELEMENTARY_TYPES or upper in members:
            continue
        line = code_start + code.count("\n", 0, start)
        result.add(
            "error",
            "undefined-assignment-target",
            f"assignment to {name!r}, which is not declared in this POU, in the "
            f"project's globals, or as a known library name",
            line,
            hint=(
                "Check the spelling, or declare it. If another POU owns it, that "
                "POU must declare it in VAR and this POU must declare it as "
                "VAR_EXTERNAL. Use the symbol index to confirm the real name."
            ),
        )

    # ------------------------------------------------------------------
    # The silent stall, for READS as well as writes.
    #
    # The assignment check above catches `X := ...`.  Reading an undeclared global stalls
    # the build just as hard - `IF PLCMODE_ON THEN` never finishes either - so the same
    # rule has to be applied to every reference, not only to assignment targets.
    # ------------------------------------------------------------------
    reported = {f.line for f in result.findings if f.code == "global-not-declared-external"}
    for name in sorted(used, key=str.casefold):
        if name not in globals_u or name in declared_u:
            continue
        if name in KEYWORDS or name in fb_instances:
            continue
        line = code_start + code.count("\n", 0, code.upper().find(name))
        if line in reported:
            continue
        reported.add(line)
        result.add(
            "error",
            "global-not-declared-external",
            f"{name} is a project global but this POU does not declare it as "
            f"VAR_EXTERNAL, so the compiler cannot resolve it and the build STALLS "
            f"with an empty error list",
            line,
            hint=(
                "Add it to this POU's VAR_EXTERNAL block, or use a variable this POU "
                "already declares - read them with mw_code_read_st. MotionWorks does "
                "not report this as an error; it simply never finishes."
            ),
        )

    # ------------------------------------------------------------------
    # Unused locals.
    # ------------------------------------------------------------------
    for name in sorted(locals_u, key=str.casefold):
        if name in used:
            continue
        result.add(
            "warning",
            "unused-local",
            f"local variable {declared_display.get(name, name)!r} is declared but "
            f"never used in the body",
            None,
            hint="Remove it, or confirm it is reserved intentionally.",
        )

    # ------------------------------------------------------------------
    # Function-block instances whose outputs are all discarded.
    # ------------------------------------------------------------------
    for name in sorted(fb_instances, key=str.casefold):
        pattern = re.compile(rf"(?<![.\w]){re.escape(name)}\s*\(", re.IGNORECASE)
        if not pattern.search(code):
            continue
        # Any `Inst.something` read is treated as using the block's result.
        reads = re.findall(
            rf"(?<![.\w]){re.escape(name)}\s*\.\s*([A-Za-z_]\w*)", code, re.IGNORECASE
        )
        if not reads:
            result.add(
                "warning",
                "unassigned-fb-output",
                f"function block {name!r} is called but none of its outputs is read",
                None,
                hint=(
                    "MotionWorks blocks expose results as outputs such as .Done, "
                    ".Busy and .Error. Discarding them is legal but often a mistake."
                ),
            )

    # ------------------------------------------------------------------
    # Statements missing their terminator.
    # ------------------------------------------------------------------
    for line_no, statement in unterminated_lines(code, code_start):
        result.add(
            "warning",
            "unterminated-statement",
            f"line does not end with ';': {statement[:70]!r}",
            line_no,
        )

    return result


def lint_pou(pou: object, known_symbols: set[str] | None = None,
            project_globals: set[str] | None = None) -> LintResult:
    """Lint a POU by combining its declarations with its body.

    ``pou`` is a :class:`motionworks_iec_mcp.project.PouInfo`.  Typed loosely to
    avoid a circular import.
    """
    body = pou.st_body()  # type: ignore[attr-defined]
    if body is None:
        result = LintResult()
        result.add(
            "info",
            "not-structured-text",
            "POU body is graphical (LD/FBD), not Structured Text; nothing to lint",
        )
        return result

    try:
        table = pou.declarations()  # type: ignore[attr-defined]
    except Exception as exc:  # noqa: BLE001
        result = LintResult()
        result.add(
            "warning",
            "declarations-unreadable",
            f"declarations could not be read, so results are limited: {exc}",
        )
        return result

    declared = {v.name for v in table.variables}
    locals_only = {v.name for v in table.variables if not v.is_external}
    fb_types = {v.name for v in table.variables if v.is_fb_instance}
    return lint(
        body,
        declared=declared,
        known_symbols=known_symbols,
        fb_instance_types=fb_types,
        local_vars=locals_only,
        project_globals=project_globals,
    )


# ── assignment type checking ─────────────────────────────────────────────────────
#
# Measured: a body that assigns a UINT to a BOOL makes the builder destroy the POU - .VB to 0 bytes
# and the grid to 79 MB - where a type-correct body merely stalls and leaves the POU intact. A type
# error is therefore worth refusing here, before it can reach the compiler.
#
# Deliberately narrow. Anything whose type cannot be established confidently is ignored, because a
# false refusal blocks correct code and costs more than the check saves.

_INTEGER_TYPES = frozenset({
    "SINT", "USINT", "INT", "UINT", "DINT", "UDINT", "LINT", "ULINT",
    "BYTE", "WORD", "DWORD", "LWORD",
})
_REAL_TYPES = frozenset({"REAL", "LREAL"})
_BOOL_TYPES = frozenset({"BOOL"})
_STRING_TYPES = frozenset({"STRING", "WSTRING", "CHAR", "WCHAR"})

_ASSIGN_LINE = re.compile(
    r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:=\s*(.+?)\s*;\s*$"
)
_COMPARISON = re.compile(r"<=|>=|<>|=|<|>")
_LIT_REAL = re.compile(r"^[+-]?\d+\.\d*([eE][+-]?\d+)?$|^[+-]?\d+[eE][+-]?\d+$")
_LIT_INT = re.compile(r"^[+-]?\d+$")
_LIT_BOOL = re.compile(r"^(TRUE|FALSE)$", re.IGNORECASE)
_LIT_STRING = re.compile(r"^'[^']*'$")
_KEYWORDS = frozenset({"TRUE", "FALSE", "NOT", "AND", "OR", "XOR", "MOD", "DIV", "AND_THEN",
                       "OR_ELSE"})


def elementary_family(type_name):
    """'integer', 'real', 'bool', 'string' - or None when the type is not an elementary one."""
    t = (type_name or "").strip().upper()
    if t in _INTEGER_TYPES:
        return "integer"
    if t in _REAL_TYPES:
        return "real"
    if t in _BOOL_TYPES:
        return "bool"
    if t in _STRING_TYPES:
        return "string"
    return None


def _strip_comments(text):
    return re.sub(r"\(\*.*?\*\)", " ", text)


def _rhs_family(expr, types):
    """The family of a right-hand side, or None when it cannot be told confidently."""
    e = _strip_comments(expr).strip()
    while e.startswith("(") and e.endswith(")"):
        e = e[1:-1].strip()
    if not e:
        return None

    if _LIT_STRING.match(e):
        return "string"
    if _LIT_BOOL.match(e):
        return "bool"
    if _LIT_REAL.match(e):
        return "real"
    if _LIT_INT.match(e):
        return "integer"

    if re.match(r"^NOT\b", e, re.IGNORECASE):
        return "bool"
    if _COMPARISON.search(e):
        head = _COMPARISON.split(e)[0].strip()
        if head and not _LIT_INT.match(head) and not _LIT_REAL.match(head):
            return "bool"

    tokens = re.findall(r"[A-Za-z_][A-Za-z0-9_]*", e)
    if not tokens:
        return None
    families = set()
    for tok in tokens:
        if tok.upper() in _KEYWORDS:
            continue
        declared = types.get(tok)
        if declared is None:
            return None                 # unknown to us - say nothing
        fam = elementary_family(declared)
        if fam is None:
            return None                 # struct, FB instance, array - not our business
        families.add(fam)

    if len(families) == 1:
        return families.pop()
    if families == {"integer", "real"}:
        return "real"                   # INTEGER widens to REAL; never the reverse
    return None


def check_assignment_types(code, types):
    """Assignments whose right-hand side cannot fit the left.

    ``types`` maps a declared name to its type name. Returns a list of
    ``(line_number, target, declared_type, rhs_family)``.
    """
    findings = []
    if not types:
        return findings
    for number, line in enumerate(code.split("\n"), start=1):
        clean = _strip_comments(line)
        if ":=" not in clean:
            continue
        m = _ASSIGN_LINE.match(clean)
        if not m:
            continue
        target, rhs = m.group(1), m.group(2)
        declared = types.get(target)
        if declared is None:
            continue
        want = elementary_family(declared)
        got = _rhs_family(rhs, types)
        if want is None or got is None or want == got:
            continue
        if want == "real" and got == "integer":
            continue                    # a widening the compiler accepts
        findings.append((number, target, declared, got))
    return findings
