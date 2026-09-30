"""Point a staged ``.mwt`` at the staged project, not at wherever it used to live.

A MotionWorks ``.mwt`` is a small OLE property set. One of its strings is an
absolute directory — measured on a real project as the last place that project
lived, which was not the copy under ``stage/``. Opening that wrapper in the IDE
loads the directory named inside it. The open call then sees *a* project and
reports success, while the window is showing a project outside the workspace.

``retarget`` rewrites every Windows path in that property set so it names the
staged directory. The source project is never opened here; callers pass the
staged copy only.
"""

from __future__ import annotations

import re
import struct
from pathlib import Path

from .cfb import CompoundFile

_PATH = re.compile(r"^(?:[A-Za-z]:[\\/]|\\\\)")
_VT_BSTR = 8


def _padded(n: int) -> int:
    return (n + 3) & ~3


def _section(data: bytes) -> tuple[int, int, list[tuple[int, int]]]:
    """Return ``(section_offset, section_size, [(pid, relative_offset), ...])``."""
    if len(data) < 48 or data[:2] != b"\xfe\xff":
        raise ValueError("the .mwt property stream is not an OLE property set")
    nsets = struct.unpack_from("<I", data, 24)[0]
    if nsets != 1:
        raise ValueError(f"expected one property set, found {nsets}")
    section = struct.unpack_from("<I", data, 44)[0]
    if section + 8 > len(data):
        raise ValueError("property section points past the end of the stream")
    size, count = struct.unpack_from("<II", data, section)
    props: list[tuple[int, int]] = []
    for i in range(count):
        pid, off = struct.unpack_from("<II", data, section + 8 + i * 8)
        props.append((pid, off))
    return section, size, props


def embedded_paths(mwt: Path | str) -> list[str]:
    """Absolute Windows paths stored in the wrapper. Empty when it has none."""
    cfb = CompoundFile(mwt)
    found: list[str] = []
    for name in cfb.stream_names():
        data = cfb.read_stream(name)
        try:
            section, size, props = _section(data)
        except ValueError:
            continue
        for _pid, off in props:
            text = _bstr_at(data, section + off, section + size)
            if text and _PATH.match(text):
                found.append(text)
    return found


def _bstr_at(data: bytes, abs_off: int, section_end: int) -> str | None:
    if abs_off + 8 > len(data) or abs_off >= section_end:
        return None
    if struct.unpack_from("<I", data, abs_off)[0] != _VT_BSTR:
        return None
    nbytes = struct.unpack_from("<I", data, abs_off + 4)[0]
    end = abs_off + 8 + nbytes
    if nbytes < 2 or end > len(data):
        return None
    return data[abs_off + 8 : end].decode("utf-16le", "replace").rstrip("\x00")


def retarget(mwt: Path | str, directory: Path | str) -> dict[str, object]:
    """Rewrite path strings in ``mwt`` so they name ``directory``.

    Returns which paths changed. A wrapper with no path is left byte-for-byte
    alone and reported as unchanged — some projects simply do not store one.
    """
    mwt_path = Path(mwt)
    directory = Path(directory).resolve()
    new = str(directory)
    cfb = CompoundFile(mwt_path)
    changed: list[dict[str, str]] = []

    for name in cfb.stream_names():
        raw = cfb.read_stream(name)
        try:
            section, size, props = _section(raw)
        except ValueError:
            continue
        data = bytearray(raw)
        # Later properties first, so a splice does not move a property still queued.
        located: list[tuple[int, int, str]] = []
        abs_offs = sorted(section + off for _pid, off in props)
        for _pid, off in props:
            abs_off = section + off
            text = _bstr_at(data, abs_off, section + size)
            if text and _PATH.match(text) and Path(text) != directory:
                later = [a for a in abs_offs if a > abs_off]
                span_end = min(later) if later else section + size
                located.append((abs_off, span_end - abs_off, text))
        if not located:
            continue
        for abs_off, span, text in sorted(located, reverse=True):
            encoded = (new + "\x00").encode("utf-16le")
            body = struct.pack("<II", _VT_BSTR, len(encoded)) + encoded
            body += b"\x00" * (_padded(len(body)) - len(body))
            delta = len(body) - span
            data[abs_off : abs_off + span] = body
            rel = abs_off - section
            props = [(pid, off + delta if off > rel else off) for pid, off in props]
            for i, (pid, off) in enumerate(props):
                struct.pack_into("<II", data, section + 8 + i * 8, pid, off)
            size += delta
            struct.pack_into("<I", data, section, size)
            changed.append({"from": text, "to": new, "stream": name})
        if changed:
            cfb = CompoundFile(mwt_path)  # re-read; replace uses the current file
            # The loop may see several streams; write this one now, then rescan
            # would double-apply. Write once per stream below.
            cfb.replace_streams({name: bytes(data)}, mwt_path)
            # Refresh so a later stream is read from the file we just wrote.
            cfb = CompoundFile(mwt_path)

    return {
        "changed": bool(changed),
        "bound_to": new,
        "paths": changed,
    }
