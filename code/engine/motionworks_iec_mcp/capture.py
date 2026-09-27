"""Screenshot capture: screen, a window, or the desktop, for agent observation.

An agent driving a GUI has to be able to *see* it. This module provides the eyes:
capture the whole virtual desktop, or one window found by title substring or handle.
Images are written to PNG under a scratch directory and the **path** is returned, so
the caller can attach the file rather than receive a wall of base64.

Pillow does the encoding, and ``ImageGrab`` handles the multi-monitor case --
measured on this machine, the virtual desktop is 6400x1615 across three screens, so
"grab the primary screen" would miss most of it.

Everything here is read-only: it captures pixels and never sends input. Input lives in
:mod:`motionworks_iec_mcp.uia`, deliberately separate, because looking and touching
carry very different risk.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

#: Where captures are written. Kept in the workspace so the agent can read them.
CAPTURE_DIR = Path(__file__).resolve().parents[2] / ".mcp_captures"

#: How many captures to keep. A full-desktop grab of this three-monitor setup is
#: about 4 MB, so an unbounded directory would grow by that much per screenshot and
#: fill the workspace during a long session.
KEEP_CAPTURES = 40


class CaptureError(RuntimeError):
    """A screenshot could not be taken."""


def _prepare() -> None:
    CAPTURE_DIR.mkdir(parents=True, exist_ok=True)


def prune(keep: int = KEEP_CAPTURES) -> int:
    """Delete the oldest captures beyond ``keep``. Returns how many were removed.

    Called after every capture. Screenshots are cheap to retake and only useful while
    investigating something, so keeping the newest few is the right trade against
    filling the workspace.
    """
    try:
        files = sorted(
            (p for p in CAPTURE_DIR.glob("*.png") if p.is_file()),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
    except OSError:
        return 0
    removed = 0
    for path in files[keep:]:
        try:
            path.unlink()
            removed += 1
        except OSError:
            continue
    return removed


def capture_screen(name: str = "screen") -> Path:
    """Capture every monitor into one image and return the file path."""
    if sys.platform != "win32":
        raise CaptureError("screen capture is only implemented on Windows")
    try:
        from PIL import ImageGrab
    except ImportError as exc:  # pragma: no cover
        raise CaptureError(f"Pillow is required for capture: {exc}") from exc

    _prepare()
    try:
        image = ImageGrab.grab(all_screens=True)
    except Exception as exc:  # noqa: BLE001
        raise CaptureError(f"could not capture the screen: {exc}") from exc

    path = CAPTURE_DIR / f"{name}-{int(time.time())}.png"
    image.save(path)
    prune()
    return path


def list_windows(min_width: int = 40, min_height: int = 40) -> list[dict[str, object]]:
    """Visible top-level windows, largest first.

    Windows below ``min_width``/``min_height`` are skipped: a GUI app owns many tiny
    invisible helper windows, and listing them buries the one that matters. Titles are
    lower-cased for matching, because the same application reports different casing.
    """
    if sys.platform != "win32":
        return []
    import win32gui

    found: list[dict[str, object]] = []

    def visit(hwnd, _):
        if not win32gui.IsWindowVisible(hwnd):
            return True
        left, top, right, bottom = win32gui.GetWindowRect(hwnd)
        width, height = right - left, bottom - top
        if width < min_width or height < min_height:
            return True
        title = win32gui.GetWindowText(hwnd)
        found.append(
            {
                "handle": hwnd,
                "title": title,
                "lower": title.casefold(),
                "left": left,
                "top": top,
                "right": right,
                "bottom": bottom,
                "width": width,
                "height": height,
            }
        )
        return True

    win32gui.EnumWindows(visit, None)
    found.sort(key=lambda w: int(w["width"]) * int(w["height"]), reverse=True)
    return found


def find_window(
    title_contains: str | None = None,
    handle: int | None = None,
    exclude: tuple[str, ...] = (),
) -> dict[str, object] | None:
    """The best window matching a handle or a title substring.

    Matching is case-insensitive and substring-based, so ``"motionworks"`` finds
    ``"MotionWorks IEC 3 Pro - TopCutter"`` without the caller knowing the version
    string. The **largest** match wins, so a splash or tooltip does not shadow the
    main window.

    ``exclude`` rejects titles containing any of those substrings. It is needed
    because a substring search is otherwise fooled by *other* windows that merely
    mention the application: measured here, a Chrome tab titled "MCP server for
    **MotionWorks** IEC offline files" is 1936x1048 and therefore LARGER than the
    733x441 licence dialog, so it won and the dialog was never found.
    """
    if handle is not None:
        import win32gui

        if not win32gui.IsWindow(handle):
            return None
        left, top, right, bottom = win32gui.GetWindowRect(handle)
        title = win32gui.GetWindowText(handle)
        return {
            "handle": handle,
            "title": title,
            "lower": title.casefold(),
            "left": left,
            "top": top,
            "right": right,
            "bottom": bottom,
            "width": right - left,
            "height": bottom - top,
        }
    if not title_contains:
        return None
    needle = title_contains.casefold()
    matches = [
        w
        for w in list_windows()
        if needle in str(w["lower"])
        and not any(word.casefold() in str(w["lower"]) for word in exclude)
    ]
    return matches[0] if matches else None


def _grab_window_pixels(hwnd: int, path: Path) -> bool:
    """Capture a window's rectangle from the screen, or ask it to paint itself.

    Two approaches, in this order, because measurement here rejected the more
    "correct-looking" one:

    * **``PrintWindow``** — asks the window to render into a bitmap, immune to
      occlusion and screen coordinates. On the MotionWorks trial dialog it returns 0
      for both ``PW_RENDERFULLCONTENT`` and the plain flag, and the result is an
      entirely black bitmap, so it cannot be relied on for this application.
    * **Screen rectangle** — grab the window's rectangle out of a full-desktop
      capture. This works, but the **offset must be right**: ``ImageGrab`` returns the
      virtual desktop starting at its top-left, which on this machine is x=-4480. A
      crop taken with the raw window coordinates is 4480 pixels off and comes back
      black, which is exactly the bug this replaces.

    Returns True when pixels were written.
    """
    import ctypes
    from ctypes import wintypes

    from PIL import Image

    if _print_window_pixels(hwnd, path):
        return True

    user32 = ctypes.windll.user32
    rectangle = wintypes.RECT()
    if not user32.GetWindowRect(hwnd, ctypes.byref(rectangle)):
        return False
    virtual_left = user32.GetSystemMetrics(76)  # SM_XVIRTUALSCREEN
    virtual_top = user32.GetSystemMetrics(77)
    virtual_width = user32.GetSystemMetrics(78)
    virtual_height = user32.GetSystemMetrics(79)
    if virtual_width <= 0 or virtual_height <= 0:
        return False

    try:
        from PIL import ImageGrab

        full = ImageGrab.grab(all_screens=True)
    except Exception:  # noqa: BLE001
        return False

    box = (
        rectangle.left - virtual_left,
        rectangle.top - virtual_top,
        rectangle.right - virtual_left,
        rectangle.bottom - virtual_top,
    )
    box = (
        max(0, box[0]),
        max(0, box[1]),
        min(full.size[0], box[2]),
        min(full.size[1], box[3]),
    )
    if box[2] - box[0] <= 0 or box[3] - box[1] <= 0:
        return False
    try:
        full.crop(box).save(path)
    except Exception:  # noqa: BLE001
        return False
    prune()
    return True


def _print_window_pixels(hwnd: int, path: Path) -> bool:
    """The ``PrintWindow`` route. Returns False when the window paints nothing."""
    import ctypes
    from ctypes import wintypes

    from PIL import Image

    user32 = ctypes.windll.user32
    gdi32 = ctypes.windll.gdi32

    rectangle = wintypes.RECT()
    if not user32.GetWindowRect(hwnd, ctypes.byref(rectangle)):
        return False
    width = rectangle.right - rectangle.left
    height = rectangle.bottom - rectangle.top
    if width <= 0 or height <= 0:
        return False

    window_dc = user32.GetWindowDC(hwnd)
    if not window_dc:
        return False
    memory_dc = gdi32.CreateCompatibleDC(window_dc)
    bitmap = gdi32.CreateCompatibleBitmap(window_dc, width, height)
    if not memory_dc or not bitmap:
        gdi32.DeleteDC(memory_dc)
        user32.ReleaseDC(hwnd, window_dc)
        return False

    try:
        gdi32.SelectObject(memory_dc, bitmap)
        if not user32.PrintWindow(hwnd, memory_dc, 2) and not user32.PrintWindow(
            hwnd, memory_dc, 0
        ):
            return False

        class BITMAPINFOHEADER(ctypes.Structure):
            _fields_ = [
                ("biSize", wintypes.DWORD),
                ("biWidth", wintypes.LONG),
                ("biHeight", wintypes.LONG),
                ("biPlanes", wintypes.WORD),
                ("biBitCount", wintypes.WORD),
                ("biCompression", wintypes.DWORD),
                ("biSizeImage", wintypes.DWORD),
                ("biXPelsPerMeter", wintypes.LONG),
                ("biYPelsPerMeter", wintypes.LONG),
                ("biClrUsed", wintypes.DWORD),
                ("biClrImportant", wintypes.DWORD),
            ]

        header = BITMAPINFOHEADER()
        header.biSize = ctypes.sizeof(BITMAPINFOHEADER)
        header.biWidth = width
        header.biHeight = -height  # negative: top-down rows
        header.biPlanes = 1
        header.biBitCount = 32
        header.biCompression = 0  # BI_RGB

        buffer = ctypes.create_string_buffer(width * height * 4)
        if not gdi32.GetDIBits(
            memory_dc, bitmap, 0, height, buffer, ctypes.byref(header), 0
        ):
            return False
        # A composited window reports success but yields an all-black bitmap, so
        # treat "no non-zero pixel" as a failure and let the caller fall back.
        if not any(buffer[: min(len(buffer), 4096)]):
            return False
        image = Image.frombuffer("RGB", (width, height), buffer, "raw", "BGRX", 0, 1)
        image.save(path)
        prune()
        return True
    finally:
        gdi32.DeleteObject(bitmap)
        gdi32.DeleteDC(memory_dc)
        user32.ReleaseDC(hwnd, window_dc)


def capture_window(
    title_contains: str | None = None,
    handle: int | None = None,
    name: str = "window",
    padding: int = 0,
    exclude: tuple[str, ...] = (),
) -> tuple[Path, dict[str, object]]:
    """Capture one window and return ``(path, window)``.

    The window is brought to the foreground first, so the pixels captured are the
    window's own rather than whatever was covering it.
    """
    if sys.platform != "win32":
        raise CaptureError("window capture is only implemented on Windows")
    window = find_window(
        title_contains=title_contains, handle=handle, exclude=exclude
    )
    if window is None:
        wanted = title_contains if title_contains else f"handle {handle}"
        raise CaptureError(f"no visible window matching {wanted!r}")

    _prepare()
    import win32gui

    hwnd = int(window["handle"])
    try:
        if win32gui.IsIconic(hwnd):
            win32gui.ShowWindow(hwnd, 9)  # SW_RESTORE
        win32gui.SetForegroundWindow(hwnd)
    except Exception:  # noqa: BLE001 - foreground rights can be denied; still capture
        pass
    time.sleep(0.35)

    path = CAPTURE_DIR / f"{name}-{hwnd}-{int(time.time())}.png"
    if not _grab_window_pixels(hwnd, path):
        raise CaptureError(f"could not capture window {hwnd}")

    window["capture"] = str(path)
    return path, window


def describe_windows(limit: int = 25) -> str:
    """A readable listing of the visible windows, for a tool reply."""
    windows = list_windows()[:limit]
    if not windows:
        return "No visible windows of a usable size."
    lines = [f"{len(windows)} visible window(s), largest first:"]
    for w in windows:
        title = w["title"] or "(untitled)"
        lines.append(
            f"  {w['width']:>5}x{w['height']:<5} at ({w['left']},{w['top']})  "
            f"hwnd={w['handle']}  {str(title)[:70]}"
        )
    return "\n".join(lines)


#: Common install locations for the Tesseract CLI.
TESSERACT_CANDIDATES = (
    Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe"),
    Path(r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"),
)


def tesseract_path() -> Path | None:
    """The Tesseract executable, if it is installed."""
    import shutil as _shutil

    found = _shutil.which("tesseract")
    if found:
        return Path(found)
    for candidate in TESSERACT_CANDIDATES:
        if candidate.is_file():
            return candidate
    return None


def read_text(image: Path | None = None, psm: int = 6) -> str:
    """OCR an image (or the screen, if none is given) into plain text.

    OCR matters even though UI Automation exists, because **accessibility is not
    always available**. The MotionWorks trial dialog exposes six elements and reports
    every clickable control as a ``Pane``; anything the application draws itself is
    invisible to UI Automation, and only pixels remain.

    Tesseract is invoked as a **subprocess**, not through ``pytesseract``, so there is
    no extra Python dependency -- only the executable, which is already installed
    here. ``--psm 6`` treats the image as a uniform block of text, which suits dialogs
    better than the default page-segmentation mode.
    """
    import subprocess
    import tempfile

    executable = tesseract_path()
    if executable is None:
        raise CaptureError(
            "Tesseract is not installed, so text cannot be read from the image. "
            "Install it (winget install UB-Mannheim.TesseractOCR) or use "
            "mw_ui_elements for windows that expose accessibility."
        )

    if image is None:
        image = capture_screen("ocr")
    if not Path(image).is_file():
        raise CaptureError(f"no such image: {image}")

    with tempfile.TemporaryDirectory() as tmp:
        stem = Path(tmp) / "out"
        try:
            subprocess.run(
                [
                    str(executable),
                    str(image),
                    str(stem),
                    "--psm",
                    str(psm),
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=120,
                creationflags=0x08000000,
            )
        except Exception as exc:  # noqa: BLE001
            raise CaptureError(f"OCR failed to run: {exc}") from exc
        text_file = stem.with_suffix(".txt")
        try:
            raw = text_file.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            raise CaptureError(f"OCR produced no text: {exc}") from exc

    lines = [line.rstrip() for line in raw.splitlines()]
    return "\n".join(line for line in lines if line.strip())
