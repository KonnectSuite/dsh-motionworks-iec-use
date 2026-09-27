"""A PDF text extractor that parses /ToUnicode CMaps instead of guessing at font shifts.

WHY THIS EXISTS. The plugin's manuals.py extracts PDF text with 27 lines of zlib and regex, and the
output is mostly unreadable - earlier rounds diagnosed it as a font encoding "shifted by 29 in
either direction" and patched around it by trying +29 and -29. That works for some documents and not
others, because the two directions are two different fonts, not one rule.

The correct source of truth is the PDF itself. A text-showing operator gives a byte string in the
font's own encoding; the document ships a /ToUnicode CMap saying what each code MEANS. Parsing that
is exact, needs no guessing, and works for every font in the file independently.

WHAT IT DOES:
  1  scan objects, inflate FlateDecode streams
  2  collect every /ToUnicode CMap and parse bfchar / bfrange into code -> unicode maps
  3  walk content streams, tracking the current font (Tf) and its CMap
  4  decode Tj / TJ / ' / " operands through that font's map, falling back to latin-1
  5  reassemble lines from the text-positioning operators

This is a research tool, not a change to the plugin. If it turns out to read these manuals properly,
the same approach belongs in manuals.py so mw_code_manual stops returning rubble.
"""
import re
import sys
import zlib
from pathlib import Path


def inflate(data: bytes) -> bytes | None:
    try:
        return zlib.decompress(data)
    except zlib.error:
        pass
    # some streams carry a leading whitespace byte, or use raw deflate
    for skip in (1, 2):
        try:
            return zlib.decompress(data[skip:])
        except zlib.error:
            continue
    try:
        return zlib.decompressobj(-15).decompress(data)
    except zlib.error:
        return None


def objects(raw: bytes) -> dict[int, bytes]:
    """Every `N G obj ... endobj` body, keyed by object number."""
    found: dict[int, bytes] = {}
    for m in re.finditer(rb"(?<![0-9])(\d+)\s+(\d+)\s+obj\b", raw):
        num = int(m.group(1))
        end = raw.find(b"endobj", m.end())
        if end < 0:
            end = len(raw)
        found[num] = raw[m.end():end]
    return found


def stream_of(body: bytes) -> bytes | None:
    m = re.search(rb"stream\r?\n", body)
    if not m:
        return None
    start = m.end()
    end = body.find(b"endstream", start)
    if end < 0:
        return None
    data = body[start:end]
    if b"FlateDecode" in body[:m.start()]:
        return inflate(data)
    return data


def parse_cmap(text: bytes) -> dict[int, str]:
    """code -> unicode from bfchar and bfrange sections of a ToUnicode CMap."""
    mapping: dict[int, str] = {}
    for block in re.findall(rb"beginbfchar(.*?)endbfchar", text, re.S):
        for src, dst in re.findall(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", block):
            try:
                mapping[int(src, 16)] = bytes.fromhex(dst.decode()).decode("utf-16-be", "replace")
            except Exception:
                pass
    for block in re.findall(rb"beginbfrange(.*?)endbfrange", text, re.S):
        for lo, hi, dst in re.findall(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", block):
            try:
                a, b = int(lo, 16), int(hi, 16)
                base = int(dst, 16)
                for i in range(min(b - a + 1, 65536)):
                    mapping[a + i] = chr(base + i)
            except Exception:
                pass
    return mapping


def decode_string(s: bytes, cmap: dict[int, str] | None, two_byte: bool) -> str:
    if not cmap:
        return s.decode("latin-1", "replace")
    out = []
    if two_byte:
        for i in range(0, len(s) - 1, 2):
            out.append(cmap.get((s[i] << 8) | s[i + 1], ""))
    else:
        for ch in s:
            out.append(cmap.get(ch, chr(ch)))
    return "".join(out)


ESCAPES = {b"n": b"\n", b"r": b"\r", b"t": b"\t", b"b": b"\b", b"f": b"\f",
           b"(": b"(", b")": b")", b"\\": b"\\"}


def unescape(s: bytes) -> bytes:
    out, i = bytearray(), 0
    while i < len(s):
        if s[i] == 0x5C and i + 1 < len(s):          # backslash
            nxt = s[i + 1:i + 2]
            if nxt in ESCAPES:
                out += ESCAPES[nxt]
                i += 2
                continue
            m = re.match(rb"[0-7]{1,3}", s[i + 1:i + 4])
            if m:
                out.append(int(m.group(0), 8) & 0xFF)
                i += 1 + len(m.group(0))
                continue
            i += 2
            continue
        out.append(s[i])
        i += 1
    return bytes(out)


def extract(path: Path) -> str:
    raw = path.read_bytes()
    objs = objects(raw)

    # every ToUnicode CMap, keyed by the object number that holds it
    cmaps: dict[int, dict[int, str]] = {}
    for num, body in objs.items():
        if b"beginbfchar" in body or b"beginbfrange" in body:
            st = stream_of(body)
            if st:
                cmaps[num] = parse_cmap(st)

    # which font resource name maps to which CMap object
    font_to_cmap: dict[str, dict[int, str]] = {}
    two_byte_fonts: set[str] = set()
    for num, body in objs.items():
        if b"/Font" not in body and b"/Type0" not in body and b"/TrueType" not in body:
            continue
        m = re.search(rb"/ToUnicode\s+(\d+)\s+0\s+R", body)
        if m:
            cm = cmaps.get(int(m.group(1)))
            if cm:
                # find this font's resource name by looking for `/Name N 0 R` pointing at this object
                for other_num, other in objs.items():
                    for nm, ref in re.findall(rb"/([A-Za-z0-9]+)\s+(\d+)\s+0\s+R", other):
                        if int(ref) == num:
                            font_to_cmap[nm.decode()] = cm
                if b"/Type0" in body:
                    two_byte_fonts.add(str(num))

    # resource name -> is two-byte, via the font object the name points at
    name_two_byte: dict[str, bool] = {}
    for other_num, other in objs.items():
        for nm, ref in re.findall(rb"/([A-Za-z0-9]+)\s+(\d+)\s+0\s+R", other):
            target = objs.get(int(ref), b"")
            if b"/Type0" in target:
                name_two_byte[nm.decode()] = True

    pieces: list[str] = []
    for num, body in objs.items():
        if b"Tj" not in body and b"TJ" not in body:
            continue
        st = stream_of(body)
        if not st or (b"Tj" not in st and b"TJ" not in st):
            continue
        current: dict[int, str] | None = None
        current_two = False
        for m in re.finditer(
            rb"/([A-Za-z0-9]+)\s+[\d.]+\s+Tf"                       # font select
            rb"|\[(.*?)\]\s*TJ"                                      # array show
            rb"|\((.*?)(?<!\\)\)\s*Tj"                               # string show
            rb"|(T\*|Td|TD|ET)",                                     # positioning
            st, re.S):
            if m.group(1):
                nm = m.group(1).decode()
                current = font_to_cmap.get(nm)
                current_two = name_two_byte.get(nm, False)
            elif m.group(2) is not None:
                for sm in re.finditer(rb"\((.*?)(?<!\\)\)", m.group(2), re.S):
                    pieces.append(decode_string(unescape(sm.group(1)), current, current_two))
            elif m.group(3) is not None:
                pieces.append(decode_string(unescape(m.group(3)), current, current_two))
            elif m.group(4):
                pieces.append("\n")

    text = "".join(pieces)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        p = Path(arg)
        if not p.is_file():
            print(f"  missing: {p}")
            continue
        try:
            t = extract(p)
        except Exception as e:
            print(f"  {p.name}: {type(e).__name__}: {e}")
            continue
        out = p.with_suffix(".extracted.txt")
        out.write_text(t, encoding="utf-8")
        words = [w for w in re.findall(r"[A-Za-z]{3,}", t)]
        common = sum(1 for w in words if w.lower() in
                     ("the", "and", "for", "with", "this", "that", "are", "not", "from", "which",
                      "function", "block", "variable", "type", "value", "input", "output"))
        print(f"  {p.name}: {len(t)} chars, {len(words)} words, {common} common-word hits")
        print(f"    -> {out}")
