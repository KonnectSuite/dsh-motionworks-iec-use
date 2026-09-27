"""Decode the shifted strings in the MotionWorks manuals - correctly this time.

Two different shifts appear, and a first attempt that applied one of them to every long token
made things WORSE: it turned the already-correct "Introduction" into "fntroduction" while fixing
"5HSODFHB0H" to "Replace_Me".

    '5HSODFHB0H'      +29 -> 'Replace_Me'          the PDF's font encoding
    'ptboolo|pqor'    -29 -> 'SWERROR_STRUCT'      the opposite direction
    '7KLV'            +29 -> 'This'
    'Introduction'    neither - it is already plain

So neither direction is universal and neither is "no shift". The rule that separates them:

  * a token needs decoding when it contains characters that do not occur inside ordinary English
    words - digits, '|', '`', '~', '\\' - because those are the fingerprints of an encoding, not
    of prose;
  * once a token is marked, BOTH directions are tried and the one that scores as more English
    wins, scored on vowel share and on the absence of digits and symbols in the result.

Plain words like "Introduction" contain none of those fingerprints and are left alone, which is
the case the first attempt got wrong.
"""
import re

SHIFT = 0x1D                       # 29
FINGERPRINT = set("0123456789|`~\\^}{[]#@$%&*+=<>/")
VOWELS = set("aeiouAEIOU")


def _shift(text: str, delta: int) -> str:
    out = []
    for c in text:
        n = ord(c) + delta
        out.append(chr(n) if 0x20 <= n <= 0x7E else "\ufffd")
    return "".join(out)


def _score(text: str) -> float:
    """How English does this look? Higher is better."""
    if not text or "\ufffd" in text:
        return -1.0
    letters = sum(1 for c in text if c.isalpha())
    spaces = text.count(" ")
    digits = sum(1 for c in text if c.isdigit())
    symbols = sum(1 for c in text if not c.isalnum() and c != " " and c != "_")
    if letters + spaces == 0:
        return -1.0
    vowel_share = sum(1 for c in text if c in VOWELS) / max(1, letters)
    # Real words have vowels, few digits, and punctuation only where prose would put it.
    return vowel_share * 2.0 - digits * 0.5 - symbols * 0.3


def needs_decoding(token: str) -> bool:
    return any(c in FINGERPRINT for c in token)


def decode_token(token: str) -> str:
    if not needs_decoding(token):
        return token
    candidates = [token, _shift(token, SHIFT), _shift(token, -SHIFT)]
    return max(candidates, key=_score)


def decode_all(text: str) -> str:
    return re.sub(r"[!-~]{4,}", lambda m: decode_token(m.group(0)), text)
