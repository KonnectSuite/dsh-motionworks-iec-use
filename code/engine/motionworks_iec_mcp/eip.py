"""EtherNet/IP assembly map: how much of each assembly a project actually uses.

WHY THIS EXISTS
---------------
"Is there room for another status word?" is asked every time a diagnostic is added, and answering
it took several steps in the session that prompted this: the ``%QW`` base, the
``I.Data[n] = %QW(base + 2n)`` rule, a scan of the project's declarations, and the module's
``PrimCxnInputSize``/``PrimCxnOutputSize`` attributes in the L5X. Every one of those is a fact
that can be read, so the answer belongs in one call rather than in a reconstruction.

WHAT IT READS, AND FROM WHERE
-----------------------------
Two independent sources, reported separately because they can disagree:

* the **L5X** module definition gives the assembly SIZES, in bytes, as the scanner declares them
  (``Communications/@PrimCxnInputSize`` and ``PrimCxnOutputSize``);
* the **MotionWorks project** gives the USED range, because every mapped word and bit is a
  declared variable carrying an IEC address such as ``%QX21488.0`` or ``%QW21492``.

Neither alone answers the question. Sizes without usage cannot say how much is left; usage
without sizes cannot say what is left *of*.

ADDRESS ARITHMETIC
------------------
The addresses are 16-bit word addresses, and ``.n`` names a bit. Measured on the TopCutter
interface: ``%IX21488.0`` is ``O.Data[0].0`` and ``%IW21490`` is ``O.Data[1]``, so a data word is
two address units. The byte width of a word is therefore what turns bytes into words:
``words = bytes / 2``. The module and the project both use 16-bit ``INT`` elements.

THE ONE THING THIS DOES NOT DO
------------------------------
It does not decide that a gap is usable. It reports the first word address that is NOT used and
the room remaining after it, which is arithmetic over what was read; whether an unused word is
free to take is a question about the peer's program, and guessing at that is how an interface
ends up with two things writing the same offset.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from pathlib import Path

#: ``%QW21492``, ``%IX21488.0``, ``%IB21488`` — the IEC address forms this understands.
_ADDRESS = re.compile(
    r"^%(?P<area>[IQM])(?P<size>[XBWDL])(?P<word>\d+)(?:\.(?P<bit>\d+))?$",
    re.IGNORECASE,
)

#: Bits per word, and the byte width of one address unit, for a data word on this interface.
#: Measured, not assumed: O.Data[n] advances the address by 2, and each element is an INT.
ADDRESS_UNITS_PER_WORD = 2
BYTES_PER_WORD = 2


def read_project_addresses(project_root: Path | str) -> list[dict]:
    """Every declared variable in the project that carries an IEC address.

    Uses the same declaration reader the rest of the engine uses, so this cannot drift from what
    mw_code_globals and mw_code_read_st report.
    """
    from . import project as P

    root = Path(project_root)
    proj = P.Project(root=root)
    found: list[dict] = []

    def collect(table, owner: str) -> None:
        for v in getattr(table, "variables", []) or []:
            address = getattr(v, "address", None)
            if not address:
                continue
            found.append({
                "name": getattr(v, "name", None),
                "type": getattr(v, "type_name", None),
                "address": str(address),
                "owner": owner,
            })

    try:
        collect(proj.global_variables(), "(globals)")
    except Exception:
        pass
    for info in proj.pous():
        try:
            collect(info.declarations(), info.name)
        except Exception:
            continue
    return found


def _data_words(addresses: list[dict]) -> dict:
    """Group ``%I``/``%Q`` addresses into the used word set, per direction.

    ``.`` marks a bit inside a word, so ``%IX21488.0`` and ``%IW21490`` both occupy a word: the
    first shares its word with its neighbours, the second owns one. Both are recorded as used,
    which is what "is there room" has to be computed against.
    """
    used: dict[str, set[int]] = {"input": set(), "output": set()}
    detail: dict[str, list[dict]] = {"input": [], "output": []}
    unparsed: list[str] = []

    for entry in addresses:
        m = _ADDRESS.match(entry["address"])
        if not m:
            unparsed.append(entry["address"])
            continue
        area = m.group("area").upper()
        if area not in ("I", "Q"):
            continue  # %M (internal marker) is not part of an assembly
        direction = "input" if area == "I" else "output"
        word = int(m.group("word"))
        size = m.group("size").upper()
        bit = m.group("bit")
        if size == "X" and bit is not None:
            # A bit address names its word, and the word it names is the one in use.
            used[direction].add(word)
            detail[direction].append({**entry, "direction": direction, "word": word, "kind": "bit"})
        elif size in ("W", "B", "D", "L"):
            # A whole-element address. W is one word; the wider forms occupy more than one, and
            # this reports the span rather than pretending they are all one word wide.
            span = {"W": 1, "B": 1, "D": 2, "L": 2}[size]
            # Address units: a word address advances by ADDRESS_UNITS_PER_WORD, so each
            # extra data word advances the address by that much.
            for i in range(span):
                used[direction].add(word + i * ADDRESS_UNITS_PER_WORD)
            detail[direction].append({
                **entry, "direction": direction, "word": word, "kind": f"element({size})",
                "words": span,
            })
        else:
            unparsed.append(entry["address"])

    return {"used": used, "detail": detail, "unparsed": unparsed}


def _runs(words: set[int]) -> list[dict]:
    """Contiguous runs of used word addresses, so a gap is visible as a gap."""
    if not words:
        return []
    ordered = sorted(words)
    runs = []
    start = prev = ordered[0]
    for w in ordered[1:]:
        if w == prev + ADDRESS_UNITS_PER_WORD:
            prev = w
            continue
        runs.append({"first": start, "last": prev, "words": (prev - start) // ADDRESS_UNITS_PER_WORD + 1})
        start = prev = w
    runs.append({"first": start, "last": prev, "words": (prev - start) // ADDRESS_UNITS_PER_WORD + 1})
    return runs


def read_l5x_module(l5x: Path | str, module_name: str | None = None) -> dict:
    """The Ethernet module's declared assembly sizes, from an exported L5X.

    Reads the ``<Module>`` whose ``CatalogNumber`` is ``ETHERNET-MODULE`` — a generic
    EtherNet/IP module — because that is the shape this interface uses. A named module wins when
    the caller passes one.
    """
    path = Path(l5x)
    if not path.is_file():
        raise FileNotFoundError(f"L5X not found: {path}")
    tree = ET.parse(path)
    root = tree.getroot()

    candidates = []
    for module in root.iter("Module"):
        if module_name and module.get("Name") != module_name:
            continue
        if not module_name and module.get("CatalogNumber") != "ETHERNET-MODULE":
            continue
        comms = module.find("Communications")
        if comms is None:
            continue
        candidates.append({
            "name": module.get("Name"),
            "catalog": module.get("CatalogNumber"),
            "vendor": module.get("Vendor"),
            "product_type": module.get("ProductType"),
            "product_code": module.get("ProductCode"),
            "revision": f"{module.get('Major')}.{module.get('Minor')}",
            "input_bytes": int(comms.get("PrimCxnInputSize") or 0),
            "output_bytes": int(comms.get("PrimCxnOutputSize") or 0),
        })

    if not candidates:
        named = f" named '{module_name}'" if module_name else ""
        raise ValueError(
            f"no EtherNet/IP module{named} with a <Communications> element in {path.name}. "
            "Pass module_name if the module is not a generic ETHERNET-MODULE."
        )
    return {"l5x": str(path), "modules": candidates}


def build_map(
    project_root: Path | str | None = None,
    l5x: Path | str | None = None,
    module_name: str | None = None,
) -> dict:
    """Assemble the answer from whichever sources the caller supplied."""
    report: dict = {"automatic_changes": False}

    modules: list[dict] = []
    if l5x:
        report["module_source"] = read_l5x_module(l5x, module_name)
        modules = report["module_source"]["modules"]

    used = {"input": set(), "output": set()}
    detail = {"input": [], "output": []}
    unparsed: list[str] = []
    if project_root:
        parsed = _data_words(read_project_addresses(project_root))
        used, detail, unparsed = parsed["used"], parsed["detail"], parsed["unparsed"]

    assemblies: list[dict] = []
    for direction, size_key in (("input", "input_bytes"), ("output", "output_bytes")):
        entry: dict = {"direction": direction}
        words = used[direction]
        declared_words = None
        if modules:
            declared_words = modules[0][size_key] // BYTES_PER_WORD
            entry["declared_bytes"] = modules[0][size_key]
            entry["declared_words"] = declared_words

        # THE ASSEMBLY IS A WINDOW, NOT EVERY ADDRESS IN THE PROJECT.
        #
        # Measured: the project carries %I/%Q addresses at 21488 AND at 61443, and a naive
        # min/max over both reported a 64-word assembly spanning 39,955 words with the "next free"
        # address at 61445. Both numbers were arithmetically faithful and completely wrong: they
        # described two separate I/O areas as one.
        #
        # The base is the lowest address in the direction, which is what a mapped assembly starts
        # at; anything at or beyond base + declared span is a different module's area and is
        # reported separately rather than folded in.
        outside: list[int] = []
        if declared_words is not None and words:
            base = min(words)
            limit = base + declared_words * ADDRESS_UNITS_PER_WORD
            inside = {w for w in words if base <= w < limit}
            outside = sorted(w for w in words if w >= limit)
            entry["base_word_address"] = base
            entry["window_last_word_address"] = limit - ADDRESS_UNITS_PER_WORD
            words = inside

        entry["used_words"] = len(words)
        entry["used_runs"] = _runs(words)
        if words:
            entry["first_word_address"] = min(words)
            entry["last_word_address"] = max(words)
            entry["span_words"] = (max(words) - min(words)) // ADDRESS_UNITS_PER_WORD + 1
        if declared_words is not None:
            entry["unused_words"] = declared_words - entry["used_words"]
            entry["full"] = entry["unused_words"] <= 0
            # THE ANSWER TO THE QUESTION, when it can be given: the first word address past the
            # highest one in use. Whether the PEER leaves it alone is not knowable from here.
            if words:
                entry["next_free_word_address"] = max(words) + ADDRESS_UNITS_PER_WORD
                entry["contiguous_room_after_last"] = (
                    entry["window_last_word_address"] - max(words)
                ) // ADDRESS_UNITS_PER_WORD
        if outside:
            entry["addresses_outside_this_assembly"] = {
                "count": len(outside),
                "first": outside[0],
                "note": (
                    "these %I/%Q addresses lie at or beyond this assembly's declared span, so they "
                    "belong to a different module's area; they are NOT part of this map and this "
                    "map's unused_words does not describe them"
                ),
            }
        entry["elements"] = detail[direction]
        assemblies.append(entry)

    report["assemblies"] = assemblies
    report["address_rules"] = {
        "unit": "16-bit word",
        "bytes_per_word": BYTES_PER_WORD,
        "address_units_per_word": ADDRESS_UNITS_PER_WORD,
        "note": (
            "measured on this interface: O.Data[1] is %IW21490 and O.Data[0].0 is %IX21488.0, so "
            "each data word advances the address by 2 and each element is one 16-bit INT"
        ),
    }
    if unparsed:
        report["addresses_not_understood"] = sorted(set(unparsed))
    report["note"] = (
        "used_words counts declared variables carrying an %I/%Q address; it does not prove the "
        "peer program leaves the remaining words alone, so confirm a new offset against the "
        "CompactLogix side before writing it"
    )
    return report
