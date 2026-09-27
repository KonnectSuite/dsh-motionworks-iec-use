"""Does the compiler check work on real MotionWorks POUs, and does it stay out of the way?"""
import sys
from pathlib import Path

SRC = Path(r"C:\Users\KNPhu\OneDrive\Documents\deepseek-harness\default-workspace\motionworks-iec-use")
INST = Path(r"C:\Users\KNPhu\profiles\desktop\node_modules\dsh-motionworks-iec-use")
sys.path.insert(0, str(SRC / "code" / "engine"))
from motionworks_iec_mcp import iec  # noqa: E402

results = []


def check(name, ok, detail=""):
    results.append((name, ok))
    print(f"  {'ok  ' if ok else 'FAIL'} {name:<54} {str(detail)[:44]}")


exe = iec.find_compiler()
check("the compiler is found", exe is not None, exe.name if exe else "NOT FOUND")
check("available() agrees", iec.available() == (exe is not None))

# ── the check that matters ───────────────────────────────────────────────────────
class V:
    def __init__(self, name, type_name, section="VAR", initial_value=None):
        self.name, self.type_name, self.section = name, type_name, section
        self.initial_value = initial_value


class T:
    def __init__(self, variables):
        self.variables = variables


table = T([V("CamReady", "BOOL"), V("CamTableID", "UINT"), V("iState", "INT")])

good = iec.validate_pou("P", table, "CamReady := TRUE;\niState := iState + 1;\n")
check("a correct body passes", good == [], iec.summary(good))

bad = iec.validate_pou("P", table, "CamReady := CamTableID;\n")
codes = [d.code for d in (bad or [])]
check("the POU-DESTROYING type error is caught", "P4035" in codes, iec.summary(bad))
if bad:
    check("and the message names both types", "bool" in bad[0].message and "uint" in bad[0].message,
          bad[0].message[:44])

undeclared = iec.validate_pou("P", table, "CamReady := NeverDeclaredAnywhere;\n")
codes = [d.code for d in (undeclared or [])]
check("an undeclared symbol is caught", "P4007" in codes, iec.summary(undeclared))

syntax = iec.validate_pou("P", table, "IF CamReady THEN\n")
codes = [d.code for d in (syntax or [])]
# P0002 is a SYNTAX code and it is FILTERED, by measurement rather than by preference: it fires on
# legal MotionWorks, where a typed literal is used as a CASE label. Trusting it refused every POU in
# the project - four capability-matrix operations began throwing the moment this check went in.
# So the expectation is that a syntax error is NOT refused, and that the reason is on record.
check("a syntax error is NOT used to refuse, because P0002 disagrees with the vendor compiler",
      codes == [], f"filtered; raw code was P0002")
check("P0002 is in the measured ignore list", "P0002" in iec.IGNORED_CODES,
      f"ignored: {sorted(iec.IGNORED_CODES)}")

# The construct that forced that decision, kept as a test so the calibration cannot be quietly
# dropped: a typed literal as a CASE label is legal MotionWorks ST.
calendar_case = """PROGRAM P
VAR
    iState : INT;
    bFlag  : BOOL;
END_VAR
CASE iState OF
    INT#0:
        bFlag := TRUE;
    INT#1:
        bFlag := FALSE;
END_CASE;
END_PROGRAM
"""
raw = iec.check_source(calendar_case)
raw_codes = [d.code for d in (raw or [])]
filtered = iec.validate_pou("P", table, "CASE iState OF\n    INT#0:\n        CamReady := TRUE;\nEND_CASE;\n")
check("a typed CASE label is legal here and is NOT refused",
      filtered == [], f"raw codes {raw_codes} -> filtered {[d.code for d in (filtered or [])]}")

# ── vendor types must NOT block a good body ──────────────────────────────────────
vendor = T([V("fbCamGen", "CamGenerator"), V("CamData", "CamSegmentStruct"),
            V("bFlag", "BOOL"), V("nCount", "UINT")])
clean_vendor = iec.validate_pou("P", vendor, "bFlag := TRUE;\n")
check("a POU with vendor types still passes when the body is fine",
      clean_vendor == [], iec.summary(clean_vendor))

mixed = iec.validate_pou("P", vendor, "bFlag := nCount;\n")
codes = [d.code for d in (mixed or [])]
check("and a REAL error in such a POU is still caught", "P4035" in codes, iec.summary(mixed))
check("the vendor-type noise was filtered", all(d.code not in iec.VENDOR_TYPE_CODES for d in (mixed or [])),
      f"{len(mixed or [])} diagnostic(s) left")

# ── the source is well formed ────────────────────────────────────────────────────
src = iec.build_source("MyPou", T([V("a", "BOOL"), V("g", "UINT", "VAR_EXTERNAL")]), "a := TRUE;\n")
check("VAR_EXTERNAL is preserved", "VAR_EXTERNAL" in src and "END_VAR" in src)
check("the program is closed", src.rstrip().endswith("END_PROGRAM"), repr(src[-24:]))
check("a name with odd characters is made safe",
      "PROGRAM 1_Bad" not in iec.build_source("1-Bad", T([]), ""), "")

print()
bad_count = sum(1 for _, ok in results if not ok)
print(f"  {len(results) - bad_count} of {len(results)} pass")
