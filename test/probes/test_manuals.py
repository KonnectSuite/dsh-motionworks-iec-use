"""Measure each decoder and the chooser, on the documents that need different ones."""
import ast
import re
import sys
from pathlib import Path

SRC = Path(r"C:\Users\KNPhu\OneDrive\Documents\deepseek-harness\default-workspace\motionworks-iec-use")
p = SRC / "code" / "engine" / "motionworks_iec_mcp" / "manuals.py"
ast.parse(p.read_text(encoding="utf-8"))
sys.path.insert(0, str(SRC / "code" / "engine"))
from motionworks_iec_mcp import manuals as M  # noqa: E402

COMMON = {"the", "and", "for", "with", "this", "that", "are", "not", "from", "which",
          "function", "block", "variable", "type", "value", "input", "output",
          "is", "of", "to", "in", "on", "be", "by", "or", "an", "as", "it"}


def density(text):
    if not isinstance(text, str) or not text:
        return 0.0
    words = re.findall(r"[A-Za-z]{3,}", text)
    if not words:
        return 0.0
    return sum(1 for w in words if w.lower() in COMMON) / len(words)


def measure(path, label):
    path = Path(path)
    if not path.is_file():
        print(f"  {label:<34} (missing)")
        return
    out = {}
    for name, fn in (("cmap", M.extract_pdf_by_cmap),
                     ("plain", M._extract_pdf_plain),
                     ("shift", M._extract_pdf_by_shift)):
        try:
            out[name] = density(fn(path))
        except Exception as e:
            out[name] = f"<{type(e).__name__}>"
    chosen = M.extract_pdf(path)
    best = max((k for k, v in out.items() if isinstance(v, float)), key=lambda k: out[k])
    print(f"  {label:<34} cmap {out['cmap']:>6.1%}  plain {out['plain']:>6.1%}  "
          f"shift {out['shift']:>6.1%}   -> shipped {density(chosen):>6.1%} ({best} is best)")


print("\n  --- documents that need OPPOSITE decoders ---")
measure(Path(r"C:\Users\KNPhu\Downloads") /
        "AN.MPIEC.01 Creating PLCopen Compliant function blocks.pdf",
        "AN.MPIEC.01 (needs plain)")
measure(Path(r"C:\Users\KNPhu\AppData\Local\Temp\yaskawa_test") / "MotionWorksIEC_CM.pdf",
        "MotionWorksIEC_CM")
measure(Path(r"C:\Users\KNPhu\AppData\Local\Temp\yaskawa_test") / "TRM010-MPiec-PLCopenPart4.pdf",
        "TRM010 PLCopen Part 4")

print("\n  --- the manuals shipped with the IDE (must not regress) ---")
try:
    for pdf in sorted(M.manuals_root().glob("*.pdf")):
        measure(pdf, pdf.stem[:34])
except Exception as e:
    print("  ", type(e).__name__, e)
