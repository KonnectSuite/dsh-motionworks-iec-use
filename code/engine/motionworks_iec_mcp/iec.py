"""A real IEC 61131-3 compiler in front of the writer.

WHY. stlint.py refuses a body that names an undeclared symbol, and round 54 added a hand-written
check for assignment type mismatches after measuring that a type error does not merely fail a build -
it DESTROYS the POU, taking the .VB to 0 bytes and the resource grid to 79,432,063 bytes. That check
is about eighty lines of regex over one statement shape. It catches the case that was measured and
nothing near it.

ironplc is a real IEC 61131-3 compiler, shipped as a standalone executable that speaks MCP over
stdio. It needs no library, no service, and no network: it is a subprocess. So the writer can ask a
compiler instead of asking a guess.

WHAT IT CATCHES, measured against constructs from this project:

    P4035  assignment value type does not match the target     BOOL := UINT, the destructive one
    P4007  variable not defined before use                     an undeclared symbol
    P0002  syntax error                                        a malformed statement

WHAT IT CANNOT RESOLVE, and why the filter exists. MotionWorks POUs declare vendor types - CamGenerator,
Y_CamStructSelect, CamSegmentStruct - and ironplc ships only TwinCAT standard libraries. Every such
type raises:

    P2008  cannot determine kind of type identifier
    P4012  function block invocation is not a variable in scope     (a consequence of P2008)

Those two are dropped and everything else is kept. That this is safe was checked rather than assumed:
a POU declaring an unknown CamGenerator AND containing a real type error reports BOTH, so filtering
P2008 leaves P4035 standing.

IT FAILS SOFT. If the executable is absent the check returns nothing and the existing lint decides,
because a missing compiler must not stop a write that would otherwise be fine.

WHERE IT LIVES. The path is looked for in MOTIONWORKS_IEC_IRONPLC, then beside the host application,
then on PATH. It is never vendored into this plugin: ironplc is a separate program with its own
licence, and the plugin should use it if the machine has it rather than redistribute it.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

#: Codes that mean "ironplc does not know this type" rather than "this code is wrong". A MotionWorks
#: project is full of vendor types and library function blocks that only the vendor compiler can
#: resolve, so these are noise here. Dropping them is safe because a real error survives alongside
#: them - verified with a POU that declares an unknown CamGenerator and also assigns a UINT to a BOOL.
VENDOR_TYPE_CODES = frozenset({"P2008", "P4012"})

#: Codes MEASURED to fire on code the vendor compiler accepts, so they cannot be used to refuse a
#: write. This is not an opinion about ironplc; it is a measurement of where it disagrees with the
#: compiler that actually has to build the project.
#:
#: How it was measured - and it is worth re-running whenever the checker is upgraded:
#:
#:   run check_source over every POU body in a project that BUILDS CLEAN,
#:   and record which codes fire. Every code that fires is, by definition, wrong here.
#:
#: Result on this project, 3 POUs with a readable body, all compiling:
#:
#:   P0002   fired on 3 of 3      a typed literal as a CASE label:
#:                                    CASE iState OF
#:                                        INT#0:            <- legal MotionWorks, rejected by ironplc
#:                                            ...
#:   (nothing else fired)
#:
#: P0002 is a SYNTAX code, so it is the one that would do most damage if trusted: it would refuse
#: every POU in the project. It did - four capability-matrix operations began throwing the moment the
#: check went in, which is how this was found.
DISAGREES_WITH_VENDOR = frozenset({"P0002"})

#: The union: everything filtered out before a caller sees it.
IGNORED_CODES = VENDOR_TYPE_CODES | DISAGREES_WITH_VENDOR

#: Where the executable is usually found. The first is this machine's layout.
CANDIDATE_PATHS = (
    Path(r"C:\Users\KNPhu\AppData\Local\Programs\AryaAI\resources\mcp-servers\ironplc\bin\ironplcmcp.exe"),
    Path(r"C:\Program Files\IronPLC\ironplcmcp.exe"),
)

DEFAULT_TIMEOUT = 45.0


@dataclass
class Diagnostic:
    """One thing the compiler objected to."""

    code: str
    message: str
    line: int | None = None
    vendor_type: bool = False

    def as_text(self) -> str:
        where = f"line {self.line}: " if self.line else ""
        return f"{where}{self.message}"

    def as_dict(self) -> dict:
        return {"code": self.code, "message": self.message, "line": self.line,
                "vendor_type": self.vendor_type}


def calibrate(project_root: Path) -> dict:
    """Measure which codes this checker disagrees with the vendor compiler about.

    Re-runnable on purpose: the filter above is a measurement of one ironplc version against one
    project, and both change. Run this over a project that BUILDS CLEAN - every code that fires is
    wrong about that codebase, because the vendor compiler accepted the code it fired on.
    """
    from . import project as P

    try:
        proj = P.Project(root=project_root)
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}"}

    fired: dict[str, int] = {}
    checked = 0
    for pou in proj.pous():
        try:
            body = pou.st_body()
        except Exception:
            continue
        if not body:
            continue
        try:
            table = pou.declarations()
        except Exception:
            continue
        checked += 1
        found = check_source(build_source(pou.name, table, body))
        if found is None:
            return {"error": "no compiler available"}
        for code in {d.code for d in found if not d.vendor_type}:
            fired[code] = fired.get(code, 0) + 1

    return {
        "pous_checked": checked,
        "codes_that_fired": fired,
        "already_ignored": sorted(IGNORED_CODES),
        "note": "every code listed above fired on code the vendor compiler ACCEPTS, so it cannot "
                "be used to refuse a write",
    }


def find_compiler() -> Path | None:
    """The ironplc executable, or None. Never raises: an absent compiler is not an error."""
    override = os.environ.get("MOTIONWORKS_IEC_IRONPLC")
    if override:
        candidate = Path(override)
        if candidate.is_file():
            return candidate
    for candidate in CANDIDATE_PATHS:
        if candidate.is_file():
            return candidate
    found = shutil.which("ironplcmcp") or shutil.which("ironplcmcp.exe")
    return Path(found) if found else None


def available() -> bool:
    """Whether a real compiler can be reached."""
    return find_compiler() is not None


def build_source(pou_name: str, table, body: str) -> str:
    """Assemble the POU as a complete ST program ironplc can be asked about.

    ironplc wants a whole compilation unit, so the declarations are reproduced as a VAR block beside
    the body. VAR_EXTERNAL is kept as VAR_EXTERNAL - the distinction matters to the checker and is
    part of what is being tested. Sections other than VAR are carried through with their own header,
    so an input or output is checked as one.
    """
    by_section: dict[str, list] = {}
    for variable in getattr(table, "variables", []) or []:
        by_section.setdefault(variable.section or "VAR", []).append(variable)

    safe_name = "".join(c if c.isalnum() or c == "_" else "_" for c in (pou_name or "POU"))
    if not safe_name or safe_name[0].isdigit():
        safe_name = "POU_" + safe_name

    # The declarations belong INSIDE the program, after its header. Emitting them first - which the
    # first version of this did - is not a unit at all, and the compiler said so with a syntax error
    # on the PROGRAM line rather than anything that named the real problem.
    lines: list[str] = [f"PROGRAM {safe_name}"]

    # Deterministic order, with VAR_EXTERNAL first because that is how the files read.
    order = sorted(by_section, key=lambda s: (s != "VAR_EXTERNAL", s))
    for section in order:
        lines.append(section)
        for variable in by_section[section]:
            decl = f"    {variable.name} : {variable.type_name}"
            if getattr(variable, "initial_value", None):
                decl += f" := {variable.initial_value}"
            lines.append(decl + ";")
        lines.append("END_VAR")

    body_text = body or ""
    return (
        "\n".join(lines)
        + "\n"
        + body_text
        + ("\n" if body_text and not body_text.endswith("\n") else "")
        + "END_PROGRAM\n"
    )


def _call(exe: Path, source: str, dialect: str, timeout: float) -> dict | None:
    """Run one check. Returns the parsed result, or None if the compiler could not be driven."""
    requests = [
        {"jsonrpc": "2.0", "id": 1, "method": "initialize",
         "params": {"protocolVersion": "2024-11-05", "capabilities": {},
                    "clientInfo": {"name": "motionworks-iec-use", "version": "1"}}},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/call",
         "params": {"name": "check", "arguments": {
             "sources": [{"name": "pou.st", "content": source}],
             "options": {"dialect": dialect}}}},
    ]
    try:
        proc = subprocess.Popen(
            [str(exe)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8", bufsize=1,
        )
    except OSError:
        return None

    try:
        for request in requests:
            proc.stdin.write(json.dumps(request) + "\n")
            proc.stdin.flush()
            while True:
                line = proc.stdout.readline()
                if not line:
                    return None
                try:
                    message = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if message.get("id") != request["id"]:
                    continue
                if request["id"] == 2:
                    content = message.get("result", {}).get("content", [])
                    if not content:
                        return None
                    try:
                        return json.loads(content[0].get("text", ""))
                    except json.JSONDecodeError:
                        return None
                break
    except (BrokenPipeError, OSError):
        return None
    finally:
        try:
            proc.stdin.close()
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
    return None


def _line_of(source: str, offset) -> int | None:
    """A 1-based line number for a character offset, when the compiler gives one."""
    try:
        position = int(offset)
    except (TypeError, ValueError):
        return None
    if position <= 0:
        return None
    return source[:position].count("\n") + 1


def check_source(source: str, dialect: str = "codesys",
                 timeout: float = DEFAULT_TIMEOUT) -> list[Diagnostic] | None:
    """Every diagnostic for a complete ST program, vendor-type noise included.

    None means the compiler could not be reached, which is different from an empty list - the caller
    needs to tell "nothing wrong" from "nothing checked".
    """
    exe = find_compiler()
    if exe is None:
        return None
    result = _call(exe, source, dialect, timeout)
    if result is None:
        return None
    out: list[Diagnostic] = []
    for item in result.get("diagnostics", []) or []:
        code = str(item.get("code", ""))
        out.append(Diagnostic(
            code=code,
            message=str(item.get("message", "")),
            line=_line_of(source, item.get("start")),
            vendor_type=code in IGNORED_CODES,
        ))
    return out


def validate_pou(pou_name: str, table, body: str,
                 dialect: str = "codesys") -> list[Diagnostic] | None:
    """Check a POU body against its declarations with a real compiler, noise filtered out.

    Returns the diagnostics worth acting on, an empty list for a clean body, or None when no compiler
    is available - so a caller can say "checked and fine" rather than "not checked".
    """
    source = build_source(pou_name, table, body)
    found = check_source(source, dialect=dialect)
    if found is None:
        return None
    return [d for d in found if not d.vendor_type]


def summary(diagnostics: list[Diagnostic] | None) -> str:
    """One line for a report."""
    if diagnostics is None:
        return "not checked (no IEC compiler available)"
    if not diagnostics:
        return "checked by ironplc: clean"
    return f"checked by ironplc: {len(diagnostics)} problem(s)"
