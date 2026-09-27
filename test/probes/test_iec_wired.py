"""Does the real compiler actually refuse a bad body through the writer?

The unit tests exercised iec.py directly. This goes through plan_st_body, which is what
mw_code_write_st calls, so it tests the wiring and not just the module - the first version of that
wiring was unreachable code that would have looked installed and done nothing.
"""
import sys
from pathlib import Path

SRC = Path(r"C:\Users\KNPhu\OneDrive\Documents\deepseek-harness\default-workspace\motionworks-iec-use")
INST = Path(r"C:\Users\KNPhu\profiles\desktop\node_modules\dsh-motionworks-iec-use")
sys.path.insert(0, str(SRC / "code" / "engine"))
from motionworks_iec_mcp import writer as W  # noqa: E402
from motionworks_iec_mcp.errors import MotionWorksError  # noqa: E402
from motionworks_iec_mcp import iec  # noqa: E402

ROOT = INST / "stage" / "TopCutter"
if not ROOT.is_dir():
    print("  no staged project")
    raise SystemExit(2)

# A POU with declarations that make each case meaningful.
POU = "TopCutterCamSetup"

results = []


def check(name, ok, detail=""):
    results.append((name, ok))
    print(f"  {'ok  ' if ok else 'FAIL'} {name:<56} {str(detail)[:40]}")


def attempt(body):
    """Plan a body write; return (refused, message)."""
    try:
        W.plan_st_body(ROOT, POU, body, run_lint=True)
        return False, ""
    except MotionWorksError as e:
        return True, str(e)
    except Exception as e:
        return True, f"{type(e).__name__}: {e}"


print(f"  compiler available: {iec.available()}\n")

# 1. a good body must still be allowed
good = "xSelect := NOT xSelect;\niState := iState + 1;\n"
refused, msg = attempt(good)
check("a correct body is not refused", not refused, msg.split("\n")[0][:40] if refused else "ok")

# 2. the hand-written check catches BOOL := UINT
refused, msg = attempt("TopCutterCamReady := TopCutterCamTableID;\n")
check("a type error is refused", refused, "type-mismatch" if "type" in msg else msg[:40])
check("  and says what is wrong", "CamReady" in msg or "BOOL" in msg or "bool" in msg, "")

# 3. something the hand-written check does NOT cover: a malformed statement.
#    check_assignment_types only looks at `x := y;` lines, so this must be the compiler's doing.
syntax = "IF xSelect THEN\n"
refused, msg = attempt(syntax)
check("a syntax error the hand-written check cannot see is refused", refused, msg[:44])
check("  and the compiler is what refused it", "IEC compiler" in msg or "P0002" in msg or "Syntax" in msg,
      [ln for ln in msg.split("\n") if "IEC" in ln or "Syntax" in ln][:1])

# 4. an undeclared symbol - stlint catches this, but confirm it still does
refused, msg = attempt("xSelect := SomethingNeverDeclaredAtAll;\n")
check("an undeclared symbol is refused", refused, msg[:44])

# 5. a body using a vendor FB must NOT be refused for that reason alone
refused, msg = attempt("xSelect := TRUE;\n")
check("vendor types in the POU do not block a good body", not refused,
      msg.split("\n")[0][:40] if refused else "ok")

print()
bad = sum(1 for _, ok in results if not ok)
print(f"  {len(results) - bad} of {len(results)} pass")
