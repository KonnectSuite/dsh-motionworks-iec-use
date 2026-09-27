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


def extract_pdf(path: Path) -> str:
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
