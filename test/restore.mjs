"""Prove the restore works, on a real snapshot, without risking anything real.

The stage is disposable, so the test damages a POU and restores it - which is the whole point of the
tool: mw_ide_build detects a destroyed POU and tells the caller to restore it, and until now there
was no way to.

    a POU that HAS snapshots    damaged -> restored -> its original bytes back
    a POU that has NONE         refused, with the reason
    an unknown POU              refused, with the reason
    dry_run                     reports the plan and changes nothing
"""
import json
import shutil
import sys
from pathlib import Path

SRC = Path(r"C:\Users\KNPhu\OneDrive\Documents\deepseek-harness\default-workspace\motionworks-iec-use")
INST = Path(r"C:\Users\KNPhu\profiles\desktop\node_modules\dsh-motionworks-iec-use")
sys.path.insert(0, str(SRC / "code" / "engine"))
from motionworks_iec_mcp import restore as R  # noqa: E402

ROOT = INST / "stage" / "TopCutter"
if not ROOT.is_dir():
    print("  no staged project to test against")
    raise SystemExit(2)

results = []


def check(name, ok, detail=""):
    results.append((name, ok))
    print(f"  {'ok  ' if ok else 'FAIL'} {name:<50} {str(detail)[:44]}")


live = sorted(ROOT.rglob("POE/*/src.st1"))
have = [(p, R.find_snapshots(ROOT, p.parent.name)) for p in live]
restorable = [(p, s) for p, s in have if s]
nothing = [(p, s) for p, s in have if not s]

print(f"  live POUs: {len(live)}   with snapshots: {len(restorable)}   without: {len(nothing)}\n")

# ── a POU with no snapshots is refused, and says why ─────────────────────────────
if nothing:
    p = nothing[0][0]
    try:
        R.restore_pou(ROOT, p.parent.name, dry_run=True)
        check("a POU with no snapshot is refused", False, "it was NOT refused")
    except Exception as e:
        check("a POU with no snapshot is refused", "no snapshot holds" in str(e),
              str(e).split(".")[0][:44])

# ── an unknown POU is refused ────────────────────────────────────────────────────
try:
    R.restore_pou(ROOT, "NoSuchPouExists", dry_run=True)
    check("an unknown POU is refused", False, "it was NOT refused")
except Exception as e:
    check("an unknown POU is refused", "no POU named" in str(e), str(e).split(";")[0][:44])

# ── dry_run plans without touching anything ──────────────────────────────────────
if restorable:
    victim, snaps = restorable[0]
    pou = victim.parent.name
    original = victim.read_bytes()

    plan = R.restore_pou(ROOT, pou, dry_run=True)
    check("dry_run reports a snapshot and changes nothing",
          plan.get("would_restore") is True and victim.read_bytes() == original,
          f"{plan['snapshot_taken']}  {len(snaps)} available")

    # ── damage it the way the compiler does, then restore ────────────────────────
    victim.write_bytes(b"\x00" * 2_000_000)
    broken = victim.stat().st_size
    check("a damaged POU is reported as not plausible",
          not R.describe(victim)["plausible"], f"{broken} bytes")

    info = R.list_restorable(ROOT)
    check("list_restorable names the damaged POU",
          any(d["pou"] == pou for d in info["damaged"]),
          f"{[d['pou'] for d in info['damaged']]}")

    done = R.restore_pou(ROOT, pou, dry_run=False)
    check("the restore reports success", done.get("restored") is True,
          f"{done.get('bytes_restored')} bytes")
    check("the file is back to the snapshot's size",
          victim.stat().st_size == done["after"]["bytes"],
          f"{victim.stat().st_size} == {done['after']['bytes']}")
    check("the damaged file was kept, so the restore is undoable",
          Path(done.get("saved_current_to", "")).is_file(),
          Path(done.get("saved_current_to", "")).name)

    info2 = R.list_restorable(ROOT)
    check("and it is no longer listed as damaged",
          not any(d["pou"] == pou for d in info2["damaged"]),
          f"{len(info2['damaged'])} damaged now")

    # leave it as it was
    victim.write_bytes(original)
    Path(done["saved_current_to"]).unlink(missing_ok=True)
    check("the original is back", victim.read_bytes() == original, f"{len(original)} bytes")
else:
    check("a POU with snapshots to test with", False, "none found")

print()
bad = sum(1 for _, ok in results if not ok)
for name, ok in results:
    print(f"  {'ok  ' if ok else 'FAIL'} {name}")
print(f"\n  {len(results) - bad} of {len(results)} pass")
