"""MotionWorks Use - file-level CODE engine.

WHY THIS EXISTS
---------------
MotionWorks' COM automation API cannot touch POU code. Measured, three routes
tried and all closed:
  * no body accessor exists (->_Pou has 35 members, none is Source/Body/Text);
  * ExecuteCommand() is a stub ("The method or operation is not implemented");
  * the import/export providers are untyped IDispatch and Execute() is a no-op
    from automation (returned OK, wrote 0 files).

So code is edited where it actually lives: the CFB container of the expanded
project. This module is a thin JSON-driven wrapper over the already-proven
engine in the sibling package (motionworks_iec_mcp.writer / .project), which
writes only the textual streams and leaves the binary grid alone.

PROTOCOL
--------
    python mw_code.py <verb> <request.json> <response.json>

Files rather than stdio: a confined harness cannot open named pipes, so a piped
child fails with EPERM. The response is written to a temp file and renamed into
place, and carries no BOM so the Node half can JSON.parse it.

SAFETY
------
* Writes default to dry_run=True: the first call is a preview, never a change.
* Every write goes through the engine's own require_ide_closed() gate, so a
  project held open by the IDE is refused rather than corrupted.
* This module never downloads to a controller and never commands motion.
"""

from __future__ import annotations

import json
import os
import sys
import traceback
from pathlib import Path

# The engine lives in the sibling package; the caller passes its root so this
# file carries no hard-coded absolute path.
# The engine is VENDORED beside this file (code/engine/motionworks_iec_mcp), so the
# plugin is self-contained and does not depend on any other checkout. MW_SRC still
# overrides it, for developing against a different engine tree.
_SRC = os.environ.get("MW_SRC")
if not _SRC:
    _SRC = str(Path(__file__).resolve().parent / "engine")
if _SRC and _SRC not in sys.path:
    sys.path.insert(0, _SRC)


def _ok(**kw):
    return {"ok": True, **kw}


def _fail(message: str, **kw):
    return {"ok": False, "error": message, **kw}


def _project(root: str):
    from motionworks_iec_mcp import project as P

    return P.Project(root=Path(root))


# ── read ─────────────────────────────────────────────────────────────────────

def verb_pous(req):
    """List the POUs of a project directory, straight from its files."""
    proj = _project(req["project"])
    out = []
    for info in proj.pous():
        # NOTE: `name` is a dataclass FIELD on PouInfo, while language/st_body
        # are methods. Measured with inspect, not assumed.
        entry = {"name": info.name}
        try:
            entry["language"] = info.language()
        except Exception as exc:
            entry["language"] = None
            entry["language_error"] = str(exc)
        try:
            stream = info.body_stream()
            entry["body_stream"] = stream[0] if stream else None
            entry["stream_language"] = stream[1] if stream else None
        except Exception as exc:
            entry["body_error"] = str(exc)
        try:
            entry["has_st_body"] = info.st_body() is not None
        except Exception as exc:
            entry["has_st_body"] = None
        out.append(entry)
    return _ok(project=req["project"], count=len(out), pous=out)


def verb_read_st(req):
    """Read one POU: language, ST body text, and its variable declarations."""
    proj = _project(req["project"])
    info = proj.pou(req["pou"])
    body = None
    body_error = None
    try:
        body = info.st_body()
    except Exception as exc:
        body_error = str(exc)

    variables = []
    try:
        table = info.declarations()
        for block in getattr(table, "blocks", []) or []:
            for decl in getattr(block, "declarations", []) or []:
                variables.append({
                    "name": getattr(decl, "name", None),
                    "type": getattr(decl, "type_name", None),
                    "section": getattr(block, "kind", None),
                    "initial_value": getattr(decl, "initial_value", None),
                    "address": getattr(decl, "address", None),
                    "description": getattr(decl, "description", None),
                })
    except Exception as exc:
        variables = [{"error": str(exc)}]

    return _ok(
        pou=req["pou"],
        language=info.language() if hasattr(info, "language") else None,
        body=body,
        body_error=body_error,
        variables=variables,
        summary=info.summary() if hasattr(info, "summary") else None,
    )


def verb_unsupported(req):
    """Name the POUs whose bodies cannot be edited safely."""
    proj = _project(req["project"])
    blocked = []
    for info in proj.pous():
        try:
            if info.st_body() is None:
                stream = None
                try:
                    bs = info.body_stream()
                    stream = bs[0] if bs else None
                except Exception:
                    pass
                blocked.append({
                    "name": info.name,
                    "reason": "no ST body stream (graphical LD/FBD or compressed)",
                    "body_stream": stream,
                })
        except Exception as exc:
            blocked.append({"name": info.name, "reason": str(exc)})
    return _ok(blocked=blocked, count=len(blocked))


# ── write ────────────────────────────────────────────────────────────────────

def verb_write_st(req):
    """Replace a POU's Structured Text body. dry_run defaults to True."""
    from motionworks_iec_mcp import writer as W

    root = Path(req["project"])
    dry = bool(req.get("dry_run", True))
    plan = W.plan_st_body(root, req["pou"], req["body"], run_lint=bool(req.get("run_lint", True)))
    result = W.apply_st_body(plan, root, dry_run=dry)
    return _ok(dry_run=dry, result=_jsonable(result))


def verb_var_add(req):
    """Add a variable declaration. dry_run defaults to True."""
    from motionworks_iec_mcp import writer as W

    root = Path(req["project"])
    dry = bool(req.get("dry_run", True))
    plan = W.plan_variable_add(
        root,
        req.get("pou"),
        req["name"],
        req["type"],
        section=req.get("section", "VAR"),
        address=req.get("address"),
        initial_value=req.get("initial_value"),
        description=req.get("description"),
    )
    return _ok(dry_run=dry, result=_jsonable(W.apply_declaration(plan, root, dry_run=dry)))


def verb_var_edit(req):
    """Edit an existing variable declaration. dry_run defaults to True."""
    from motionworks_iec_mcp import writer as W

    root = Path(req["project"])
    dry = bool(req.get("dry_run", True))
    kwargs = {}
    for k in ("new_name", "type", "section", "address", "initial_value", "description"):
        if req.get(k) is not None:
            kwargs[k if k != "type" else "type_name"] = req[k]
    plan = W.plan_variable_edit(root, req.get("pou"), req["name"], **kwargs)
    return _ok(dry_run=dry, result=_jsonable(W.apply_declaration(plan, root, dry_run=dry)))


def verb_var_delete(req):
    """Delete a variable declaration. dry_run defaults to True."""
    from motionworks_iec_mcp import writer as W

    root = Path(req["project"])
    dry = bool(req.get("dry_run", True))
    plan = W.plan_variable_delete(root, req.get("pou"), req["name"])
    return _ok(dry_run=dry, result=_jsonable(W.apply_declaration(plan, root, dry_run=dry)))


def verb_ide_closed(req):
    """Report whether the IDE-held gate would let a write through."""
    from motionworks_iec_mcp import ide as I

    running = None
    for attr in ("motionworks_running", "is_motionworks_running"):
        fn = getattr(I, attr, None)
        if callable(fn):
            try:
                running = bool(fn())
                break
            except Exception:
                pass
    return _ok(running=running, helpers=[n for n in dir(I) if not n.startswith("_")][:40])


VERBS = {
    "pous": verb_pous,
    "read_st": verb_read_st,
    "unsupported": verb_unsupported,
    "write_st": verb_write_st,
    "var_add": verb_var_add,
    "var_edit": verb_var_edit,
    "var_delete": verb_var_delete,
    "ide_closed": verb_ide_closed,
}


def _jsonable(value):
    """Best-effort conversion of engine results into JSON-friendly data."""
    try:
        json.dumps(value)
        return value
    except (TypeError, ValueError):
        pass
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if hasattr(value, "__dict__"):
        return {str(k): _jsonable(v) for k, v in vars(value).items()}
    return str(value)


def main(argv):
    if len(argv) != 4:
        print("usage: mw_code.py <verb> <request.json> <response.json>", file=sys.stderr)
        return 2
    verb, req_path, res_path = argv[1], argv[2], argv[3]
    res = Path(res_path)

    try:
        req = json.loads(Path(req_path).read_text(encoding="utf-8-sig"))
    except Exception as exc:
        _write(res, _fail(f"could not read request: {exc}"))
        return 1

    handler = VERBS.get(verb)
    if handler is None:
        _write(res, _fail(f"unknown verb {verb!r}", allowed=sorted(VERBS)))
        return 1

    try:
        _write(res, handler(req))
        return 0
    except Exception as exc:
        _write(res, _fail(
            f"{type(exc).__name__}: {exc}",
            traceback=traceback.format_exc().splitlines()[-6:],
        ))
        return 1


def _write(path: Path, payload) -> None:
    """Write without a BOM, via a temp file, so a reader never sees a partial file."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    os.replace(tmp, path)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
