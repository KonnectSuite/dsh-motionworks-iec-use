"""Are the tree COUNTS correct after an unassign?

The removed tree is structurally clean - 563 lines, no malformed node header - and the IDE
refuses to open it. A node block being well-formed is not enough, so the next thing to check is
the bookkeeping that is NOT part of any node: three numbers that an edit has to move.

    line 1       the project's node total
    line 3       the root node's params, whose child count is field 2
    a task line  the task's params, whose child count is field 2

plan_unassign is supposed to move the task's and the root's, and the docstring says line 1 holds
the total. If any of the three is wrong the tree is internally inconsistent even though every
block in it parses - which is exactly the shape of a project that will not open.

Measured here for one removal (BG <- TopCutterFFCamSetup, an existing assignment):

    what the pristine tree says, what the edit produced, and what it SHOULD be
"""
import shutil
import struct
import sys
from pathlib import Path

ENGINE = Path(
    r"C:\Users\KNPhu\OneDrive\Documents\deepseek-harness\default-workspace"
    r"\motionworks-iec-use\code\engine"
)
sys.path.insert(0, str(ENGINE))

from motionworks_iec_mcp.cfb import CompoundFile          # noqa: E402
from motionworks_iec_mcp.tree import parse_document       # noqa: E402
from motionworks_iec_mcp import tree_writer as TW         # noqa: E402

TASK = "BG"
POU = "TopCutterFFCamSetup"


def read_tree(path: Path) -> list[str]:
    return CompoundFile(path).read_stream("PROJECT.TRE").decode("latin1").splitlines()


def report(label: str, lines: list[str]) -> dict:
    doc = parse_document("\n".join(lines))
    total = int(lines[1])
    root_params = lines[3].split()
    root_kids = int(root_params[2]) if len(root_params) > 2 else -1
    task = TW.find_task(doc, TASK)
    task_kids = task.params[2]
    kids = [k.name for k, c in doc.walk_with_ancestors() if c and c[-1] is task]
    print(f"  {label}")
    print(f"    lines          : {len(lines)}")
    print(f"    line 1 total   : {total}")
    print(f"    root child cnt : {root_kids}")
    print(f"    {TASK} kid cnt    : {task_kids}")
    print(f"    {TASK} children   : {kids}")
    return {"total": total, "root": root_kids, "task_kids": task_kids, "kids": len(kids)}


def main() -> int:
    project = Path(sys.argv[1])
    src = project / "src.st1"
    pristine = read_tree(src)

    scratch = project.parent / "_unassign_probe.mwt"
    if scratch.exists():
        scratch.unlink()

    print("  ── pristine ──")
    before = report("pristine", pristine)

    doc = parse_document("\n".join(pristine))
    plan = TW.plan_unassign(doc, TASK, POU)
    rendered = TW.render(doc, plan).splitlines()

    print("\n  ── after unassign ──")
    after = report("after unassign", rendered)

    print("\n  ── expectations ──")
    expect_total = before["total"] - 1
    expect_root = before["root"] - 1
    expect_task = before["task_kids"] - 1
    checks = [
        ("line 1 total", after["total"], expect_total),
        ("root child count", after["root"], expect_root),
        (f"{TASK} child count", after["task_kids"], expect_task),
    ]
    ok = True
    for name, got, want in checks:
        good = got == want
        ok = ok and good
        print(f"    {name:<20} got {got:<5} want {want:<5} {'ok' if good else '*** WRONG ***'}")
    print(f"\n  all three counts correct: {ok}")

    # And the node total should equal the number of node headers actually present.
    headers = 0
    for i, line in enumerate(rendered):
        f = line.split("\t")[0].split()
        if len(f) == 4 and f[0].isdigit() and f[1].isdigit():
            headers += 1
    print(f"  node headers present     : {headers}   (line 1 says {after['total']})")
    print(f"  they agree               : {headers == after['total']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
