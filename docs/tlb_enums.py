"""Dump EVERY enum in the Ade type library.

The first dump filtered type-infos by name, which hid the enums that matter most
for driving the IDE - notably `AdeEvcObject` (the argument to
ExportEvcObject/ImportEvcObject) and the real compile-type names, previously only
guessed at empirically.

Run with 32-bit Python:
    .venv32\\Scripts\\python.exe tlb_enums.py
"""
import sys
import pythoncom

TLB = r"C:\Program Files (x86)\Yaskawa\MotionWorks IEC 3 Pro\Ade.tlb"


def main():
    tlb = pythoncom.LoadTypeLib(TLB)
    n = tlb.GetTypeInfoCount()
    printed = 0
    for i in range(n):
        try:
            ti = tlb.GetTypeInfo(i)
            ta = ti.GetTypeAttr()
        except Exception:
            continue
        # An enum: no functions, has variables.
        if ta.cFuncs != 0 or ta.cVars == 0:
            continue
        try:
            iname = tlb.GetDocumentation(i)[0] or f"<unnamed {i}>"
        except Exception:
            iname = f"<unnamed {i}>"
        print(f"=== {iname} ({ta.cVars} values) ===")
        for j in range(ta.cVars):
            try:
                vd = ti.GetVarDesc(j)
                names = ti.GetNames(vd.memid)
                print(f"  {vd.value:>6}  {names[0]}")
            except Exception as e:
                print(f"  <var {j}: {e}>")
        print()
        printed += 1
    print(f"total enum type-infos: {printed} of {n} type-infos", file=sys.stderr)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"FAILED: {exc!r}", file=sys.stderr)
        sys.exit(1)
