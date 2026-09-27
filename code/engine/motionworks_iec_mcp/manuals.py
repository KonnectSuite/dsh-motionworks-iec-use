"""Search the MotionWorks manuals that ship with the IDE.

The goal for this plugin says to learn about MotionWorks programming, and it turns out the IDE
installs its own documentation - three PDF manuals plus 259 .chm help files - so an agent writing
MotionWorks code can be given the vendor's own words instead of guessing at an API.

WHAT IS READABLE AND WHAT IS NOT.

The PDFs are ordinary PDFs and are read here with zlib alone: inflate every stream, keep the ones
containing text operators, and pull the drawn strings out. Measured on the Toolbox Manual,
217 KB of searchable text from 285 streams.

Part of that text is drawn with a font whose encoding is the ASCII codepoint shifted by 29, in
EITHER direction:

    '5HSODFHB0H'     +29 -> 'Replace_Me'
    'ptboolo|pqor'   -29 -> 'SWERROR_STRUCT'
    '7KLV'           +29 -> 'This'
    'Introduction'   neither - already plain

so a token is decoded only when it carries a character that does not occur inside English words -
a digit, '|', a backtick - and then both directions are tried and the one that scores as more
English wins. Applying one direction to everything makes plain words worse, which is how a first
attempt turned "Introduction" into "fntroduction".

The .chm files are NOT read. They are ITSF containers with LZX-compressed content; the file list
is visible and the text is not, and hh.exe -decompile produced nothing here. Their topics are
listed in the manifest, so a caller can at least be told that a topic exists and which help file
covers it.

The extracted text is cached beside the plugin, because inflating a 6.7 MB manual takes a moment
and the manuals do not change.
"""
from __future__ import annotations

import re
import zlib
from dataclasses import dataclass
from pathlib import Path

from .errors import NotFound

#: Where the IDE installs its documentation. The manuals directory is the readable part.
IDE_ROOTS = (
    Path(r"C:\Program Files (x86)\Yaskawa\MotionWorks IEC 3 Pro"),
    Path(r"C:\Program Files\Yaskawa\MotionWorks IEC 3 Pro"),
)
MANUAL_DIR = "Manuals"
HELP_DIR = "Help"

STREAM = re.compile(rb"stream\r?\n(.*?)endstream", re.DOTALL)
LITERAL = re.compile(rb"\((?:\\.|[^\\()])*\)")
HEXSTR = re.compile(rb"<([0-9A-Fa-f\s]+)>")

_SHIFT = 0x1D
_FINGERPRINT = set("0123456789|`~\\^}{[]#@$%&*+=<>/")
_VOWELS = set("aeiouAEIOU")


@dataclass
class Manual:
    """One document, and whether its text can be read."""

    name: str
    path: Path
    bytes: int
    readable: bool
    note: str = ""


def manuals_root() -> Path:
    for root in IDE_ROOTS:
        candidate = root / MANUAL_DIR
        if candidate.is_dir():
            return candidate
    raise NotFound(
        "no MotionWorks Manuals directory found; looked in "
        + " and ".join(str(r / MANUAL_DIR) for r in IDE_ROOTS)
    )


def list_manuals() -> list[Manual]:
    root = manuals_root()
    found = []
    for path in sorted(root.glob("*.pdf")):
        found.append(Manual(name=path.stem, path=path, bytes=path.stat().st_size, readable=True))
    for path in sorted(root.glob("*.chm")):
        found.append(Manual(
            name=path.stem, path=path, bytes=path.stat().st_size, readable=False,
            note="compiled help (ITSF/LZX); the topic list is available, the text is not",
        ))
    return found


def help_topics() -> list[str]:
    """The .chm help files, which name their subject in the filename."""
    for root in IDE_ROOTS:
        help_dir = root / HELP_DIR
        if help_dir.is_dir():
            names = {p.stem for p in help_dir.glob("*.chm")}
            # Drop the locale-suffixed duplicates (edit033 vs edit001) and locale folders.
            english = sorted(
                n for n in names
                if re.fullmatch(r"[A-Za-z_]+0*1?", n) or not re.search(r"\d{3}$", n)
            )
            return english
    raise NotFound("no MotionWorks Help directory found")


# ── PDF text ─────────────────────────────────────────────────────────────────────

def _unescape(raw: bytes) -> str:
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
                j, digits = i + 1, b""
                while j < len(raw) and len(digits) < 3 and 0x30 <= raw[j] <= 0x37:
                    digits += bytes([raw[j]]); j += 1
                out.append(int(digits, 8) & 0xFF); i = j; continue
            out.append(n); i += 2; continue
        out.append(c); i += 1
    return out.decode("latin1")


def _score(text: str) -> float:
    if not text or "\ufffd" in text:
        return -1.0
    letters = sum(1 for c in text if c.isalpha())
    if letters == 0:
        return -1.0
    digits = sum(1 for c in text if c.isdigit())
    symbols = sum(1 for c in text if not c.isalnum() and c not in " _")
    vowels = sum(1 for c in text if c in _VOWELS) / letters
    return vowels * 2.0 - digits * 0.5 - symbols * 0.3


def _decode_token(token: str) -> str:
    if not any(c in _FINGERPRINT for c in token):
        return token

    def shift(delta: int) -> str:
        out = []
        for c in token:
            n = ord(c) + delta
            out.append(chr(n) if 0x20 <= n <= 0x7E else "\ufffd")
        return "".join(out)

    return max((token, shift(_SHIFT), shift(-_SHIFT)), key=_score)


# ── PDF text, by the document's own character maps ──────────────────────────────
#
# The heuristic below guesses at a font encoding. This does not: a PDF that uses a non-ASCII font
# ships a /ToUnicode CMap saying what each byte means, and reading that is exact. The guess stays as
# a fallback for fonts that carry no map.

_OBJ = re.compile(rb"(?<![0-9])(\d+)\s+(\d+)\s+obj\b")
_STREAM = re.compile(rb"stream\r?\n", re.DOTALL)
_FONT_REF = re.compile(rb"/([A-Za-z0-9]+)\s+(\d+)\s+0\s+R")


def _inflate(data: bytes) -> bytes | None:
    """FlateDecode, tolerating the variants that appear in real files."""
    for attempt in (data, data[1:], data[2:]):
        try:
            return zlib.decompress(attempt)
        except zlib.error:
            continue
    try:
        return zlib.decompressobj(-15).decompress(data)
    except zlib.error:
        return None


def _objects(data: bytes) -> dict[int, bytes]:
    """Every `N G obj ... endobj` body, keyed by object number."""
    found: dict[int, bytes] = {}
    for m in _OBJ.finditer(data):
        end = data.find(b"endobj", m.end())
        found[int(m.group(1))] = data[m.end():end if end >= 0 else len(data)]
    return found


def _object_stream(body: bytes) -> bytes | None:
    m = _STREAM.search(body)
    if not m:
        return None
    raw = body[m.end():body.find(b"endstream", m.end())]
    if b"FlateDecode" in body[:m.start()]:
        return _inflate(raw)
    return raw


def _parse_cmap(text: bytes) -> dict[int, str]:
    """code -> character, from the bfchar and bfrange sections of a ToUnicode CMap."""
    mapping: dict[int, str] = {}
    for block in re.findall(rb"beginbfchar(.*?)endbfchar", text, re.DOTALL):
        for src, dst in re.findall(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", block):
            try:
                mapping[int(src, 16)] = bytes.fromhex(dst.decode()).decode("utf-16-be", "replace")
            except Exception:
                continue
    for block in re.findall(rb"beginbfrange(.*?)endbfrange", text, re.DOTALL):
        for lo, hi, dst in re.findall(
                rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", block):
            try:
                start, stop, base = int(lo, 16), int(hi, 16), int(dst, 16)
            except Exception:
                continue
            if stop - start > 65535:
                continue
            for offset in range(stop - start + 1):
                mapping[start + offset] = chr(base + offset)
    return mapping


def _font_maps(objects: dict[int, bytes]) -> tuple[dict[str, dict[int, str]], dict[str, bool]]:
    """Resource name -> its CMap, and resource name -> whether the font is two-byte.

    The name is assigned by whoever REFERENCES the font, not by the font itself, so the lookup runs
    in that direction: find the font object, then find every object naming it.
    """
    cmaps: dict[int, dict[int, str]] = {}
    for number, body in objects.items():
        if b"beginbfchar" in body or b"beginbfrange" in body:
            stream = _object_stream(body)
            if stream:
                cmaps[number] = _parse_cmap(stream)
    if not cmaps:
        return {}, {}

    # font object number -> the CMap it points at
    font_to_cmap: dict[int, dict[int, str]] = {}
    two_byte_objects: set[int] = set()
    for number, body in objects.items():
        ref = re.search(rb"/ToUnicode\s+(\d+)\s+0\s+R", body)
        if ref and int(ref.group(1)) in cmaps:
            font_to_cmap[number] = cmaps[int(ref.group(1))]
        if b"/Type0" in body:
            two_byte_objects.add(number)

    # every `/Name N 0 R` anywhere, where N is a font object
    by_name: dict[str, dict[int, str]] = {}
    two_byte: dict[str, bool] = {}
    for body in objects.values():
        for name, target in _FONT_REF.findall(body):
            target = int(target)
            if target in font_to_cmap:
                key = name.decode()
                by_name[key] = font_to_cmap[target]
                if target in two_byte_objects:
                    two_byte[key] = True
    return by_name, two_byte


def _apply_cmap(raw: bytes, cmap: dict[int, str] | None, two_byte: bool) -> str:
    if not cmap:
        return raw.decode("latin1", "replace")
    if two_byte:
        return "".join(cmap.get((raw[i] << 8) | raw[i + 1], "")
                       for i in range(0, len(raw) - 1, 2))
    return "".join(cmap.get(c, chr(c)) for c in raw)


_TEXT_OP = re.compile(
    rb"/([A-Za-z0-9]+)\s+[\d.]+\s+Tf"          # 1 font selection
    rb"|\[(.*?)\]\s*TJ"                          # 2 array show
    rb"|\((.*?)(?<!\\)\)\s*Tj"                # 3 string show
    rb"|(T\*|Td|TD)",                             # 4 positioning
    re.DOTALL,
)
_IN_ARRAY = re.compile(rb"\((.*?)(?<!\\)\)", re.DOTALL)


def extract_pdf_by_cmap(path: Path) -> str | None:
    """Text read through the document's own ToUnicode maps, or None if it has none."""
    data = path.read_bytes()
    objects = _objects(data)
    by_name, two_byte = _font_maps(objects)
    if not by_name:
        return None

    pieces: list[str] = []
    for body in objects.values():
        if b"Tj" not in body and b"TJ" not in body:
            continue
        stream = _object_stream(body)
        if not stream or (b"Tj" not in stream and b"TJ" not in stream):
            continue
        cmap, wide = None, False
        for m in _TEXT_OP.finditer(stream):
            if m.group(1):
                name = m.group(1).decode()
                cmap, wide = by_name.get(name), two_byte.get(name, False)
            elif m.group(2) is not None:
                for s in _IN_ARRAY.finditer(m.group(2)):
                    pieces.append(_apply_cmap(_unescape_bytes(s.group(1)), cmap, wide))
            elif m.group(3) is not None:
                pieces.append(_apply_cmap(_unescape_bytes(m.group(3)), cmap, wide))
            elif m.group(4):
                pieces.append("\n")

    if not pieces:
        return None
    text = "".join(pieces)
    text = re.sub(r"[ \t]+", " ", text)
    return re.sub(r"\n{3,}", "\n\n", text)


def _unescape_bytes(raw: bytes) -> bytes:
    """PDF string escapes, as bytes, so a multi-byte font encoding survives intact."""
    out, i = bytearray(), 0
    simple = {0x6E: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12,
              0x28: 0x28, 0x29: 0x29, 0x5C: 0x5C}
    while i < len(raw):
        if raw[i] == 0x5C and i + 1 < len(raw):
            nxt = raw[i + 1]
            if nxt in simple:
                out.append(simple[nxt]); i += 2; continue
            if 0x30 <= nxt <= 0x37:
                j, digits = i + 1, b""
                while j < len(raw) and len(digits) < 3 and 0x30 <= raw[j] <= 0x37:
                    digits += bytes([raw[j]]); j += 1
                out.append(int(digits, 8) & 0xFF); i = j; continue
            i += 2; continue
        out.append(raw[i]); i += 1
    return bytes(out)


def _extract_pdf_by_shift(path: Path) -> str:
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
            piece = [_unescape(m.group(0)[1:-1]) for m in LITERAL.finditer(line)]
            for m in HEXSTR.finditer(line):
                try:
                    piece.append(bytes.fromhex(m.group(1).decode("ascii")).decode("utf-16-be", "replace"))
                except Exception:
                    pass
            if piece:
                chunks.append("".join(piece))
    text = " ".join(chunks)
    text = re.sub(r"[\x00-\x1f]+", " ", text)
    text = re.sub(r"\s{2,}", " ", text)
    return re.sub(r"[!-~]{4,}", lambda m: _decode_token(m.group(0)), text)


def manual_text(name: str, cache_dir: Path | None = None) -> str:
    """The decoded text of one manual, cached on disk."""
    root = manuals_root()
    matches = [p for p in root.glob("*.pdf") if name.lower() in p.stem.lower()]
    if not matches:
        available = ", ".join(p.stem for p in root.glob("*.pdf"))
        raise NotFound(f"no manual matching {name!r}. Available: {available}")
    path = matches[0]

    cache = (cache_dir or path.parent / ".mw_manual_cache") / (path.stem + ".txt")
    try:
        if cache.is_file() and cache.stat().st_mtime >= path.stat().st_mtime:
            return cache.read_text(encoding="utf-8")
    except OSError:
        pass

    text = extract_pdf(path)
    try:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(text, encoding="utf-8")
    except OSError:
        pass
    return text


def search(term: str, name: str | None = None, limit: int = 5,
           cache_dir: Path | None = None) -> list[dict]:
    """Find a term across the manuals, with surrounding context.

    A term's words are allowed to sit apart in the text: the PDFs draw each word as its own
    operation, so a phrase has to be matched with whitespace between its parts or it never hits.
    """
    targets = list_manuals()
    if name:
        targets = [m for m in targets if name.lower() in m.name.lower() and m.readable]
    else:
        targets = [m for m in targets if m.readable]

    pattern = re.compile(r"\W+".join(re.escape(w) for w in term.split()), re.IGNORECASE)
    out: list[dict] = []
    for manual in targets:
        try:
            text = manual_text(manual.name, cache_dir=cache_dir)
        except Exception:
            continue
        hits = list(pattern.finditer(text))
        if not hits:
            continue
        out.append({
            "manual": manual.name,
            "hits": len(hits),
            "passages": [
                text[max(0, h.start() - 200):h.end() + 400].strip()
                for h in hits[:limit]
            ],
        })
    return out


def extract_pdf(path: Path) -> str:
    """Text from a PDF, preferring the document's own character maps.

    The CMap path is exact and is tried first. The older heuristic - inflate, pull the drawn
    strings, and guess at a +/-29 font shift - remains as a fallback, because some PDFs really do
    use a shifted encoding and ship no map to read.
    """
    candidates: list[tuple[str, str]] = []

    try:
        by_cmap = extract_pdf_by_cmap(path)
        if by_cmap and by_cmap.strip():
            candidates.append(("cmap", by_cmap))
    except Exception:
        pass

    try:
        plain = _extract_pdf_plain(path)
        if plain.strip():
            candidates.append(("plain", plain))
    except Exception:
        pass

    try:
        shifted = _extract_pdf_by_shift(path)
        if shifted.strip():
            candidates.append(("shift", shifted))
    except Exception:
        pass

    if not candidates:
        return ""

    # Judge by English: count the ordinary words in a sample. The three decoders differ enormously
    # when the right one is chosen and barely at all when it is not, so this only has to be roughly
    # right - but it does have to be about words, which the vowel-based _score is not.
    return max(candidates, key=lambda pair: _english(pair[1]))[1]


#: Ordinary words, used only to decide which decoder produced readable text.
_ENGLISH = frozenset("""
the and for with this that are not from which function block variable type value input output
is of to in on be by or an as it at we you they can may must will would should has have been
when where what how all any each other more most such only same than then there their them
""".split())


def _english(text: str) -> float:
    """Fraction of the words in a sample that are ordinary English words."""
    words = re.findall(r"[A-Za-z]{3,}", text[:20000])
    if not words:
        return 0.0
    return sum(1 for w in words if w.lower() in _ENGLISH) / len(words)


def _extract_pdf_plain(path: Path) -> str:
    """The drawn strings decoded as latin-1, with no re-encoding guess applied.

    This is what the shift heuristic is a correction FOR. Some documents are already plain and the
    correction damages them - AN.MPIEC.01 reads at 24% this way and 0% with the shift - so the two
    are offered as alternatives and the scorer picks.
    """
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
        # Walk the whole stream, not line by line: an operator and its operand are often on
        # different lines, and a drawn string can contain a newline of its own.
        for m in _TEXT_RUN.finditer(body):
            piece = m.group(1) if m.group(1) is not None else m.group(2)
            for s in _STRING_IN.finditer(piece):
                chunks.append(_unescape(s.group(1)))
            chunks.append("\n")
    text = "".join(chunks)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return re.sub(r"\n{3,}", "\n\n", text)

#: A drawn-string run: either the operand of Tj, or the array operand of TJ.
_TEXT_RUN = re.compile(rb"\((.*?)(?<!\\)\)\s*Tj|\[(.*?)\]\s*TJ", re.DOTALL)
_STRING_IN = re.compile(rb"\((.*?)(?<!\\)\)", re.DOTALL)
