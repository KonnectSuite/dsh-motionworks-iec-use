"""Extract and NORMALISE text from the MotionWorks PDF manuals.

The first version kept every drawn string on its own line, so "Program Instance" could never
match: the PDF emits "Program" and "Instance" as separate Tj operations, sometimes with a
positioning gap between them, and the extractor preserved that as a newline. Searching then
found nothing and the manual looked empty of the very topic it covers.

So the text is joined, whitespace collapsed to single spaces, and searches run against that.
A search term is also split into words and matched with any whitespace between them, so a phrase
matches across whatever the PDF put in the gaps.
"""
import re
import sys
import zlib
from pathlib import Path

STREAM = re.compile(rb"stream\r?\n(.*?)endstream", re.DOTALL)
LITERAL = re.compile(rb"\((?:\\.|[^\\()])*\)")
HEXSTR = re.compile(rb"<([0-9A-Fa-f\s]+)>")


def unescape(raw: bytes) -> str:
    out = bytearray()
    i = 0
    while i < len(raw):
        c = raw[i]
        if c == 0x5C and i + 1 < len(raw):
            n = raw[i + 1]
            simple = {0x6E: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12}
            if n in simple:
                out.append(simple[n]); i += 2; continue
            if 0x30 <= n <= 0x37:
                j = i + 1
                digits = b""
                while j < len(raw) and len(digits) < 3 and 0x30 <= raw[j] <= 0x37:
                    digits += bytes([raw[j]]); j += 1
                out.append(int(digits, 8) & 0xFF); i = j; continue
            out.append(n); i += 2; continue
        out.append(c); i += 1
    return out.decode("latin1")


def extract(path: Path) -> str:
    data = path.read_bytes()
    chunks: list[str] = []
    for raw in STREAM.findall(data):
        body = raw
        if body[:2] in (b"\x78\x9c", b"\x78\x01", b"\x78\xda"):
            try:
                body = zlib.decompress(body)
            except Exception:
                continue
        if b"Tj" not in body and b"TJ" not in body:
            continue
        for line in body.split(b"\n"):
            if b"Tj" not in line and b"TJ" not in line:
                continue
            piece = []
            for m in LITERAL.finditer(line):
                piece.append(unescape(m.group(0)[1:-1]))
            for m in HEXSTR.finditer(line):
                try:
                    piece.append(bytes.fromhex(m.group(1).decode("ascii")).decode("utf-16-be", "replace"))
                except Exception:
                    pass
            if piece:
                chunks.append("".join(piece))
    # Join with a space and collapse: the PDF splits words across operators, so any newline a
    # reader would not see must not survive into the searchable text.
    text = " ".join(chunks)
    text = re.sub(r"[\x00-\x1f]+", " ", text)
    return re.sub(r"\s{2,}", " ", text)


def main() -> int:
    path = Path(sys.argv[1])
    term = sys.argv[2] if len(sys.argv) > 2 else None
    text = extract(path)
    print(f"  {path.name}: {len(text)} characters of searchable text")

    if not term:
        print("\n  --- first 1000 characters ---")
        print(text[:1000])
        return 0

    # Allow any whitespace between the words of the term.
    pattern = re.compile(r"\W+".join(re.escape(w) for w in term.split()), re.IGNORECASE)
    hits = list(pattern.finditer(text))
    print(f"  {len(hits)} occurrence(s) of {term!r}")
    for h in hits[:5]:
        start = max(0, h.start() - 260)
        print("\n  ── context ──")
        print("  " + text[start:h.end() + 380][:760])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
