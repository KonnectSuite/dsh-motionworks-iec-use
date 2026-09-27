# Why do declarations not land on a NEWLY CREATED POU?
#
# The author-a-program run failed at the point that matters: mw_code_var_add reported applied=true
# for two declarations on a freshly created POU, the body that USES them was written, the POU was
# assigned so it would actually be compiled - and the build stalled, with the IDE reporting 0
# variables for the POU. A stalled build with an empty Errors pane is the unresolved-symbol
# signature: the compiler cannot see what the editor accepted.
#
# Declarations on an EXISTING POU work; the capability matrix has proved that repeatedly,
# including a declaration the body uses. So the difference is the POU, not the writer. Two things
# could differ for a freshly created one:
#
#   * its grid stream, if the create leaves a .VGR that the append logic cannot extend
#   * its declaration text, if the create writes something the append does not match
#
# This compares a created POU against an existing one on both, without writing anything.
$ErrorActionPreference = 'Continue'

$INST = "$env:USERPROFILE\profiles\desktop\node_modules\dsh-motionworks-iec-use"
$py = "$env:LOCALAPPDATA\Programs\AryaAI\resources\runtime\primary-runtime\dependencies\python\python.exe"
$ENV:PYTHONIOENCODING = 'utf-8'

$script = Join-Path $env:TEMP 'newpou_inspect.py'
$body = @'
import sys, re
sys.path.insert(0, r"INSTDIR\code\engine")
from motionworks_iec_mcp.cfb import CompoundFile
from motionworks_iec_mcp import project as P
from pathlib import Path

root = Path(r"INSTDIR\stage\TopCutter")
doc = P.Project(root=root)

print("  === every src.st1 in the project, and the POU streams in each ===")
for src in sorted(root.rglob("src.st1")):
    try:
        names = CompoundFile(src).stream_names()
    except Exception as e:
        print(f"    {src.relative_to(root)}  -> {e}")
        continue
    relevant = [n for n in names if n.endswith((".VB", ".VGR", ".ST", ".POE"))]
    if relevant:
        print(f"    {src.relative_to(root)}")
        for n in relevant:
            raw = CompoundFile(src).read_stream(n)
            print(f"        {n}: {len(raw)} bytes")

print()
print("  === find the created POU and an existing one ===")
for name in ("ZzAuthored", "TopCutterCamSetup"):
    hits = []
    for src in sorted(root.rglob("src.st1")):
        try:
            for n in CompoundFile(src).stream_names():
                if name.lower() in n.lower():
                    hits.append((src, n))
        except Exception:
            pass
    print(f"    {name}: {len(hits)} stream(s)")
    for src, n in hits[:6]:
        raw = CompoundFile(src).read_stream(n)
        extra = ""
        if n.upper().endswith("VB"):
            t = raw.decode("latin1", "replace")
            decls = re.findall(r"^\s*(\w+)\s*:\s*(\w+)", t, re.M)
            extra = f"  declarations-in-text={len(decls)} {[d[0] for d in decls][:8]}"
        print(f"        {src.relative_to(root)} :: {n}  {len(raw)}B{extra}")
'@
$body = $body.Replace('INSTDIR', $INST)
$body | Out-File -FilePath $script -Encoding utf8
& $py $script 2>&1 | Select-Object -First 40
Remove-Item Env:PYTHONIOENCODING -ErrorAction SilentlyContinue
