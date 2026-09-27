"""
Manifest of a MotionWorks project's inner containers, for before/after comparison.

Every POU's src.st1 is itself a CFB container holding the real streams
(*.STB = Structured Text, *.VB/*.VGR = visual, *.TXT = translations). A file-level
size comparison is misleading because CFB pads; this reports the actual streams so
a smoke test can prove no CODE changed.

Usage:  python smoke_manifest.py <project_dir>      -> JSON on stdout
"""
import json
import sys
from pathlib import Path

ENGINE = Path(r"C:\Users\KNPhu\profiles\desktop\node_modules\dsh-motionworks-iec-use\code\engine")
sys.path.insert(0, str(ENGINE))

from motionworks_iec_mcp.cfb import CompoundFile  # noqa: E402


def stream_map(path: Path) -> dict:
    """name -> sha256 of the stream bytes, or an error marker."""
    import hashlib
    try:
        cf = CompoundFile(path)
        out = {}
        for name in cf.stream_names():
            data = cf.read_stream(name)
            out[name] = {
                "bytes": len(data),
                "sha256": hashlib.sha256(data).hexdigest()[:16],
            }
        return out
    except Exception as exc:                                    # noqa: BLE001
        return {"__error__": f"{type(exc).__name__}: {exc}"}


def main() -> int:
    root = Path(sys.argv[1])
    if not root.is_dir():
        print(json.dumps({"error": f"not a directory: {root}"}))
        return 2

    manifest = {"root": str(root), "pous": {}, "root_streams": {}}

    poe = root / "POE"
    if poe.is_dir():
        for pou_dir in sorted(p for p in poe.iterdir() if p.is_dir()):
            src = pou_dir / "src.st1"
            entry = {"files": sorted(f.name for f in pou_dir.iterdir() if f.is_file())}
            entry["streams"] = stream_map(src) if src.is_file() else {"__error__": "no src.st1"}
            manifest["pous"][pou_dir.name] = entry

    # The project root's own src.st1 is the global/declaration container.
    root_src = root / "src.st1"
    if root_src.is_file():
        manifest["root_streams"] = stream_map(root_src)

    # Registry vs filesystem: every registered POU should have a directory, and
    # every directory should be registered. A mismatch is what would make the IDE
    # refuse a project.
    lst = root / "LIST.POU"
    if lst.is_file():
        text = lst.read_text(encoding="latin-1", errors="replace")
        registered = set()
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            # entries look like a name, possibly with surrounding decoration
            registered.add(line.split()[0].strip())
        manifest["registered_raw_count"] = len(registered)
        manifest["registered_sample"] = sorted(registered)[:30]

    print(json.dumps(manifest))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
