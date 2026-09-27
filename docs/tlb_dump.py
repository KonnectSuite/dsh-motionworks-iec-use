"""Dump the Ade type library's interfaces so COM calls are made from fact, not guesswork.

We need exact signatures (OpenProject, ExecuteCommand, Compile, ...) because COM
dispatch is unforgiving: a wrong arity fails with a message that does not say
what the right arity is.

Run with 32-bit Python (Mwt.exe is a 32-bit server):
    .venv32\\Scripts\\python.exe tlb_dump.py
"""
import sys
import pythoncom

TLB = r"C:\Program Files (x86)\Yaskawa\MotionWorks IEC 3 Pro\Ade.tlb"

WANT = ("Application", "Project", "Pou", "Variable")


def type_name(tdesc):
    try:
        if tdesc.vt == pythoncom.VT_PTR and tdesc.pdesc:
            return "*" + type_name(tdesc.pdesc)
        if tdesc.vt == pythoncom.VT_USERDEFINED:
            return f"udef({tdesc.hreftype})"
        return {
            pythoncom.VT_I4: "long", pythoncom.VT_BSTR: "BSTR",
            pythoncom.VT_BOOL: "bool", pythoncom.VT_VARIANT: "variant",
            pythoncom.VT_DISPATCH: "IDispatch", pythoncom.VT_VOID: "void",
            pythoncom.VT_UI4: "ulong", pythoncom.VT_I2: "short",
            pythoncom.VT_R8: "double", pythoncom.VT_DATE: "date",
        }.get(tdesc.vt, f"vt={tdesc.vt}")
    except Exception as e:
        return f"?{e}"


def main():
    tlb = pythoncom.LoadTypeLib(TLB)
    n = tlb.GetTypeInfoCount()
    print(f"{TLB}\ntypeinfos: {n}\n")

    for i in range(n):
        try:
            doc = tlb.GetDocumentation(i)
            iname = doc[0] or f"<unnamed {i}>"
        except Exception:
            iname = f"<unnamed {i}>"

        if not any(w.lower() in iname.lower() for w in WANT):
            continue

        try:
            ti = tlb.GetTypeInfo(i)
            ta = ti.GetTypeAttr()
        except Exception as e:
            print(f"--- {iname}: no typeattr ({e})")
            continue

        print(f"=== {iname}  (funcs={ta.cFuncs}, vars={ta.cVars}) ===")
        # Enums: the member names are the constants we need (compile types etc.)
        if ta.cFuncs == 0 and ta.cVars:
            for j in range(ta.cVars):
                try:
                    vd = ti.GetVarDesc(j)
                    vnames = ti.GetNames(vd.memid)
                    print(f"  {vnames[0]} = {vd.value}")
                except Exception as e:
                    print(f"  <var {j}: {e}>")
            print()
            continue
        for j in range(ta.cFuncs):
            try:
                fd = ti.GetFuncDesc(j)
            except Exception:
                continue
            try:
                names = ti.GetNames(fd.memid)
            except Exception:
                names = ("?",)
            fname = names[0] if names else "?"
            nparams = len(fd.args)
            params = []
            for k in range(nparams):
                pname = names[k + 1] if k + 1 < len(names) else f"arg{k}"
                params.append(pname)
            try:
                argdesc = ", ".join(
                    f"{p}:{type_name(fd.args[k])}" for k, p in enumerate(params)
                )
            except Exception:
                argdesc = ", ".join(params)
            flag = []
            propget = getattr(pythoncom, "INVK_PROPERTYGET", 2)
            propput = getattr(pythoncom, "INVK_PROPERTYPUT", 4)
            if fd.invkind == propget:
                flag.append("propget")
            if fd.invkind == propput:
                flag.append("propput")
            try:
                ret = type_name(fd.rettype)
            except Exception:
                ret = "?"
            print(f"  {fname}({argdesc})  ret={ret} {' '.join(flag)}")
        print()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"FAILED: {exc!r}", file=sys.stderr)
        sys.exit(1)
