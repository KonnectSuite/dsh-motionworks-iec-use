"""How does ironplc react to MotionWorks types it has never heard of?

This decides whether ironplc can be wired into the writer. A real POU here declares things like

    fbCamGen : CamGenerator;          a vendor function block from a Yaskawa library
    CamData  : CamSegmentStruct;      a project-defined STRUCT
    fbCamSel : Y_CamStructSelect;     a library type

and ironplc ships only TwinCAT standard libraries. If every unknown type produces an error, the
checker would refuse every real POU and be useless. If the unknown-type codes are distinguishable,
they can be filtered and what remains - type mismatches, undeclared symbols, syntax - is exactly what
is worth having.
"""
import json
import subprocess
from pathlib import Path

EXE = Path(r"C:\Users\KNPhu\AppData\Local\Programs\AryaAI\resources\mcp-servers\ironplc\bin\ironplcmcp.exe")

CASES = {
    "unknown FB type": """PROGRAM P
VAR
    fbCamGen : CamGenerator;
END_VAR
    fbCamGen();
END_PROGRAM
""",
    "unknown struct type": """PROGRAM P
VAR
    CamData : CamSegmentStruct;
END_VAR
    CamData := CamData;
END_PROGRAM
""",
    "unknown ENUM in a declaration": """PROGRAM P
VAR
    eMode : Y_CamStructSelect;
END_VAR
END_PROGRAM
""",
    "declared struct, used properly": """TYPE Seg : STRUCT
    StartPos : LREAL;
END_STRUCT
END_TYPE
PROGRAM P
VAR
    CamData : Seg;
    r : LREAL;
END_VAR
    r := CamData.StartPos;
END_PROGRAM
""",
    "unknown FB plus a REAL type error": """PROGRAM P
VAR
    fbCamGen : CamGenerator;
    bFlag    : BOOL;
    nCount   : UINT;
END_VAR
    bFlag := nCount;
END_PROGRAM
""",
    "undeclared symbol": """PROGRAM P
VAR
    bFlag : BOOL;
END_VAR
    bFlag := SomethingNeverDeclared;
END_PROGRAM
""",
    "syntax error": """PROGRAM P
VAR
    bFlag : BOOL;
END_VAR
    IF bFlag THEN
END_PROGRAM
""",
}


def call_sequence(exe: Path, requests: list[dict]) -> list[dict]:
    proc = subprocess.Popen([str(exe)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True, encoding="utf-8", bufsize=1)
    out = []
    try:
        for req in requests:
            proc.stdin.write(json.dumps(req) + "\n")
            proc.stdin.flush()
            while True:
                line = proc.stdout.readline()
                if not line:
                    return out
                try:
                    msg = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if msg.get("id") == req.get("id"):
                    out.append(msg)
                    break
    finally:
        try:
            proc.stdin.close()
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
    return out


def main() -> int:
    reqs = [{"jsonrpc": "2.0", "id": 1, "method": "initialize",
             "params": {"protocolVersion": "2024-11-05", "capabilities": {},
                        "clientInfo": {"name": "probe", "version": "1"}}}]
    seq = call_sequence(EXE, reqs)
    if not seq:
        print("  the server did not respond")
        return 2

    print("  case                                 ok     codes")
    print("  " + "-" * 72)
    for label, src in CASES.items():
        res = call_sequence(EXE, [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize",
             "params": {"protocolVersion": "2024-11-05", "capabilities": {},
                        "clientInfo": {"name": "probe", "version": "1"}}},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/call",
             "params": {"name": "check", "arguments": {
                 "sources": [{"name": "main.st", "content": src}],
                 "options": {"dialect": "codesys"}}}},
        ])
        text = ""
        for msg in res:
            if msg.get("id") == 2:
                content = msg.get("result", {}).get("content", [])
                text = content[0].get("text", "") if content else ""
        try:
            data = json.loads(text)
        except Exception:
            print(f"  {label:<36} ?      {text[:60]}")
            continue
        codes = ", ".join(sorted({d["code"] for d in data.get("diagnostics", [])})) or "(none)"
        print(f"  {label:<36} {str(data.get('ok')):<6} {codes}")
        for d in data.get("diagnostics", [])[:2]:
            print(f"      {d['code']}: {d['message'][:88]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
