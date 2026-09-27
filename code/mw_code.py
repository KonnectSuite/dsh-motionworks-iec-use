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


# â”€â”€ read â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
        # DeclarationTable exposes `.variables` (a flat list of Variable), plus
        # `warnings` and `source_stream`. It has NO `.blocks` â€” iterating that
        # silently produced an empty list, so callers could read a POU's body but
        # never its declarations.
        table = info.declarations()
        for v in getattr(table, "variables", []) or []:
            variables.append({
                "name": getattr(v, "name", None),
                "type": getattr(v, "type_name", None),
                "section": getattr(v, "section", None),
                "group": getattr(v, "group", None),
                "address": getattr(v, "address", None),
                "initial_value": getattr(v, "initial_value", None),
                "description": getattr(v, "description", None),
            })
    except Exception as exc:
        variables = [{"error": f"{type(exc).__name__}: {exc}"}]

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


# â”€â”€ write â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    plan = W.plan_variable_edit(
        root,
        req.get("pou"),
        req["name"],
        new_name=req.get("new_name"),
        type_name=req.get("type"),
        address=req.get("address"),
        initial_value=req.get("initial_value"),
        description=req.get("description"),
        clear_address=bool(req.get("clear_address", False)),
        force=bool(req.get("force", False)),
    )
    return _ok(dry_run=dry, result=_jsonable(W.apply_declaration(plan, root, dry_run=dry)))


def verb_var_delete(req):
    """Delete a variable declaration. dry_run defaults to True."""
    from motionworks_iec_mcp import writer as W

    root = Path(req["project"])
    dry = bool(req.get("dry_run", True))
    plan = W.plan_variable_delete(
        root, req.get("pou"), req["name"], force=bool(req.get("force", False))
    )
    return _ok(dry_run=dry, result=_jsonable(W.apply_declaration(plan, root, dry_run=dry)))


def _plan_summary(plan):
    """Flatten a planner's dataclass into JSON-friendly fields (no methods)."""
    out = {}
    for key, value in vars(plan).items():
        if callable(value):
            continue
        out[key] = _jsonable(value)
    return out


def _backup_dir(req, root: Path) -> Path:
    """Backups go beside the plugin, NOT inside the staging root.

    Writing into stage/ creates a directory that a naive "newest staged project"
    search can then mistake for a project, so the staging root is kept to
    projects only.
    """
    raw = req.get("backup_dir")
    directory = Path(raw) if raw else (Path(__file__).resolve().parent.parent / "backups")
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def verb_pou_create(req):
    """Create a new POU by cloning a template POU already in the project.

    ``template`` must be the name of an existing POU: creation clones that POU's
    directory and renames its streams, so there is no way to author a POU from
    nothing. dry_run defaults to True and returns the plan instead of applying it.
    """
    from motionworks_iec_mcp import pou_writer as PW

    root = Path(req["project"])
    dry = bool(req.get("dry_run", True))
    plan = PW.plan_pou_creation(root, req["name"], req["template"])
    if dry:
        return _ok(dry_run=True, plan=_plan_summary(plan))
    result = PW.apply_pou_creation(
        plan, backup_dir=_backup_dir(req, root), project_root=root
    )
    return _ok(dry_run=False, result=_jsonable(result))


def verb_pou_delete(req):
    """Delete a POU, its task assignments and its registry entries.

    The POU directory is moved to an archive rather than removed, so the deletion
    is recoverable. Refuses when another POU still calls it unless ``force`` is set.
    dry_run defaults to True and returns the plan instead of applying it.
    """
    from motionworks_iec_mcp import pou_writer as PW

    root = Path(req["project"])
    dry = bool(req.get("dry_run", True))
    plan = PW.plan_pou_deletion(root, req["name"], force=bool(req.get("force", False)))
    if dry:
        return _ok(dry_run=True, plan=_plan_summary(plan))
    result = PW.apply_pou_deletion(plan, backup_dir=_backup_dir(req, root))
    return _ok(dry_run=False, result=_jsonable(result))


def verb_tasks(req):
    """List the tasks and which POU is assigned to each, plus the unassigned ones.

    This matters more than it looks. A POU that exists but is assigned to no task
    NEVER RUNS, and -- measured -- it is also not flagged by the build: a POU
    containing an undeclared variable compiled cleanly while it was unassigned.
    So an agent that creates a POU and stops there has produced code that does
    nothing, and a green build will not tell it so.
    """
    from motionworks_iec_mcp.cfb import CompoundFile
    from motionworks_iec_mcp.tree import load_tree, task_assignments

    root = Path(req["project"])
    roots = load_tree(root)[0]
    assignments = task_assignments(roots)

    # Which POUs exist at all, from the registry, so "unassigned" can be computed.
    known = []
    for line in (root / "LIST.POU").read_text(encoding="latin-1", errors="replace").splitlines():
        parts = line.split("\t")
        if len(parts) > 1 and parts[0].strip().upper() == "PROGRAM" and parts[1].strip():
            known.append(parts[1].strip())
    assigned = {p for programs in assignments.values() for p in programs}

    return _ok(
        project=str(root),
        tasks={k: sorted(v) for k, v in sorted(assignments.items())},
        task_count=len(assignments),
        unassigned=sorted(set(known) - assigned),
        unassigned_note=(
            "These POUs exist but are assigned to no task, so they never run and a clean "
            "build does NOT prove they compile - measured, a POU with an undeclared "
            "variable built cleanly while unassigned. THIS PLUGIN CANNOT ASSIGN: writing "
            "the instance node into PROJECT.TRE makes MotionWorks rewrite the tree it "
            "touches at open, so mw_code_pou_assign is refused. The step is manual and "
            "takes a moment: in the MotionWorks Project Tree, right-click the task and add "
            "the program. Then call this tool again to confirm it landed - the entries "
            "above are read from the tree, so a successful assignment shows up here."
        ),
        next_step=(
            "Tell the user which POU needs a task and which task, then re-run this tool to "
            "verify. Do not report the POU as working until it appears under a task."
        ),
    )


def verb_assign(req):
    """Assign a POU to a task. dry_run defaults to True.

    Without this, a created POU is inert: it is not called by anything, so it never
    executes and the compiler does not check it.
    """
    from motionworks_iec_mcp.cfb import CompoundFile
    from motionworks_iec_mcp.tree import parse_document
    from motionworks_iec_mcp.tree_writer import apply_assignment, plan_assign

    root = Path(req["project"])
    src = root / "src.st1"
    dry = bool(req.get("dry_run", True))
    document = parse_document(
        CompoundFile(src).read_stream("PROJECT.TRE").decode("latin1")
    )
    kwargs = {}
    if req.get("cycle"):
        kwargs["cycle"] = str(req["cycle"])
    if req.get("controller"):
        kwargs["controller"] = str(req["controller"])
    plan = plan_assign(document, str(req["task"]), str(req["pou"]), **kwargs)
    if dry:
        return _ok(dry_run=True, plan=_plan_summary(plan), summary=plan.summary())
    result = apply_assignment(src, root, plan, backup_dir=_backup_dir(req, root))
    return _ok(dry_run=False, result=_jsonable(result))


def verb_unassign(req):
    """Remove a POU's assignment from a task. dry_run defaults to True."""
    from motionworks_iec_mcp.cfb import CompoundFile
    from motionworks_iec_mcp.tree import parse_document
    from motionworks_iec_mcp.tree_writer import apply_assignment, plan_unassign

    root = Path(req["project"])
    src = root / "src.st1"
    dry = bool(req.get("dry_run", True))
    document = parse_document(
        CompoundFile(src).read_stream("PROJECT.TRE").decode("latin1")
    )
    plan = plan_unassign(document, str(req["task"]), str(req["pou"]))
    if dry:
        return _ok(dry_run=True, plan=_plan_summary(plan), summary=plan.summary())
    result = apply_assignment(src, root, plan, backup_dir=_backup_dir(req, root))
    return _ok(dry_run=False, result=_jsonable(result))


def verb_globals(req):
    """List the project's VAR_GLOBAL declarations.

    The automation API exposes NO project-level variable collection - measured:
    project.Variables, project.Globals and project.VariableGroups are all absent or
    empty - so the live variable model cannot show globals even though it reads
    POU-scoped declarations well. Without this an agent can ADD a global and never see
    it again, and cannot discover the tags several POUs share.
    """
    proj = _project(req["project"])
    table = proj.global_variables()
    out = []
    for v in getattr(table, "variables", []) or []:
        out.append({
            "name": getattr(v, "name", None),
            "type": getattr(v, "type_name", None),
            "section": getattr(v, "section", None),
            "group": getattr(v, "group", None),
            "address": getattr(v, "address", None),
            "initial_value": getattr(v, "initial_value", None),
            "description": getattr(v, "description", None),
        })
    warnings = list(getattr(table, "warnings", []) or [])
    return _ok(
        project=str(req["project"]),
        count=len(out),
        variables=out,
        source_stream=getattr(table, "source_stream", None),
        warnings=warnings,
    )


def verb_ide_closed(req):
    """Report whether the IDE gate would let a write through."""
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
    return _ok(running=running, helper_names=[n for n in dir(I) if not n.startswith("_")][:40])


def verb_types(request):
    """Read the project's user-defined data types, or one of them in full.

    Nothing else in this plugin could see a UDT, so an agent editing a POU that declares
    ``CamData : CamSegmentStruct`` had no way to learn what a CamSegmentStruct contains.
    The definitions are plain text in DT/Tyllist.typ, parsed by motionworks_iec_mcp
    .datatypes, whose module docstring records the field layout and how it was measured.

    Returns through ``_ok`` like every other verb: the Node side rejects a response whose
    ``ok`` is not true, so a bare dict here fails as "code engine failed 'types'" with no
    message, which is what happened the first time this verb was wired up.
    """
    from motionworks_iec_mcp import datatypes as DT

    project = Path(request["project"])
    name = request.get("name")
    if name:
        t = DT.find_type(project, str(name))
        return _ok(
            project=str(project),
            name=t.name,
            kind=t.kind,
            type_id=t.type_id,
            container=t.container,
            declared_members=t.declared_members,
            element_type=t.element_type,
            members=[
                {"name": m.name, "type": m.type_name, "type_id": m.type_id,
                 "array_size": m.array_size}
                for m in t.members
            ],
        )

    types, counts = DT.read_types(project)
    return _ok(
        project=str(project),
        defined=len(types),
        header_counts=counts,
        types=[
            {"name": t.name, "kind": t.kind, "type_id": t.type_id,
             "container": t.container, "members": len(t.members),
             "declared_members": t.declared_members, "element_type": t.element_type}
            for t in sorted(types, key=lambda x: (x.container, x.name))
        ],
    )


def verb_library(request):
    """Read the library side: which blocks the project uses, and what one offers.

    Two questions, two sources. ``eCLRPouDependencies.dat`` is a plain-text manifest naming
    every POU and library block with its kind and what it calls, so "what does this POU use"
    needs no binary at all. A block's own members come from its compiled assembly, which is
    a real .NET assembly (BSJB, v4.0.30319) whose identifiers sit in the metadata #Strings
    heap.

    WHAT THE MEMBER LIST IS NOT: it does not record input/output DIRECTION. Execute and Done
    are distinguishable by convention, not by anything in the heap, and this does not guess.
    The declaration in the calling POU, read with mw_code_read_st, is what settles direction.
    """
    from motionworks_iec_mcp import libraries as L

    project = Path(request["project"])
    name = request.get("name")
    if name:
        m = L.read_block_members(project, str(name))
        return _ok(
            project=str(project),
            name=m.name,
            assembly=m.assembly,
            runtime=m.runtime,
            identifiers=m.identifiers,
            filtered_out=m.filtered_out,
            note=(
                "these are the identifiers the assembly defines; input/output DIRECTION is "
                "not recorded in them, so read the declaration in the calling POU "
                "(mw_code_read_st) to tell an input from an output"
            ),
        )

    blocks = L.read_dependencies(project)
    return _ok(
        project=str(project),
        count=len(blocks),
        blocks=[
            {"index": b.index, "name": b.name, "kind": b.kind,
             "library": b.is_library, "depends_on": b.depends_on}
            for b in blocks
        ],
    )


def verb_manual(request):
    """Search the MotionWorks manuals the IDE installs, or list what is available.

    The IDE ships its own documentation - three PDFs and 259 .chm help files - so an agent
    writing MotionWorks code can be given the vendor's own words rather than guessing at a
    library block's behaviour. The Toolbox Manual documents every function block and data type
    the toolboxes provide, which is exactly what is needed to call CamGenerator or read a
    CamSegmentStruct correctly.
    """
    from motionworks_iec_mcp import manuals as M

    name = request.get("name")
    term = request.get("term")

    if not term:
        listed = M.list_manuals()
        topics = []
        try:
            topics = M.help_topics()
        except Exception:
            pass
        return _ok(
            manuals=[
                {"name": m.name, "bytes": m.bytes, "readable": m.readable, "note": m.note}
                for m in listed
            ],
            help_topics=topics,
            note=(
                "Pass a 'term' to search. The PDFs are read; the .chm files are compiled help "
                "whose text cannot be extracted here, though their filenames name their subjects."
            ),
        )

    raw = request.get("limit")
    limit = int(raw) if isinstance(raw, (int, float)) else 5
    results = M.search(str(term), name=str(name) if name else None, limit=limit)
    if not results:
        return _ok(
            term=str(term), found=0,
            note=(
                "No manual mentions that. Try a symbol the project actually uses - a function "
                "block, a data type - or call this with no term to see what is available."
            ),
        )
    return _ok(
        term=str(term),
        found=len(results),
        results=results,
    )



def verb_restore_pou(req):
    """Put a POU back from a snapshot. dry_run defaults to True.

    Added because mw_ide_build now DETECTS a destroyed POU and says to restore it, and there was no
    way to do that. A diagnosis with no remedy is half a fix.
    """
    from motionworks_iec_mcp import restore as R

    root = Path(req["project"])
    dry = bool(req.get("dry_run", True))
    # pou is OPTIONAL: omitting it asks what is restorable rather than naming one. Reading it
    # with [] raised KeyError before the guard below could run - the guard was right and the
    # access above it was wrong, which is the pair written the wrong way round.
    pou = req.get("pou")
    which = int(req.get("which", 0) or 0)

    if not pou:
        # No POU named: report what is restorable and what looks damaged, so a caller that only
        # knows something is wrong can find out what.
        return _ok(dry_run=dry, result=R.list_restorable(root))

    report = R.restore_pou(root, pou, which=which, dry_run=dry)
    return _ok(dry_run=dry, result=_jsonable(report))

VERBS = {
    "types": verb_types,
    "manual": verb_manual,
    "library": verb_library,
    "pous": verb_pous,
    "read_st": verb_read_st,
    "unsupported": verb_unsupported,
    "write_st": verb_write_st,
    "var_add": verb_var_add,
    "restore_pou": verb_restore_pou,
    "var_edit": verb_var_edit,
    "var_delete": verb_var_delete,
    "pou_create": verb_pou_create,
    "pou_delete": verb_pou_delete,
    "globals": verb_globals,
    "tasks": verb_tasks,
    "assign": verb_assign,
    "unassign": verb_unassign,
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
