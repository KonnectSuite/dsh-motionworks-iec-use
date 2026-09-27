"""Make mw_code_pou_create tell the truth about what a created POU can and cannot do.

Four rounds established this precisely, by measurement:

    create, assign, build                      is_compiled=true    CLEAN
    create, empty the body, assign, build      is_compiled=true    CLEAN
    create, ADD a declaration, assign, build   is_compiled=false   STALLED
    the same add on an EXISTING POU            survives and compiles

Everything observable about the created POU is correct: its four streams, its .VB (two
VAR_EXTERNAL -> VAR renames and nothing else), its localized grid, its appended record's row, every
sidecar file including NodeProperties.xml checked by content, and its tree nodes carrying the IDE's
own markers. NODES.LST is an assignment registry that correctly omits an unassigned POU, and the
.mwt is a 4 KB container that lists none.

So a working path and a broken path both exist and the tool distinguishes neither. An agent that
creates a POU and then adds the declarations it needs gets one that reads back correctly, builds
clean while unassigned, and destroys itself the first time it is assigned and compiled - .VB to 0
bytes, grid to 79 MB. Silent, delayed and catastrophic is the worst failure shape there is.

This is a documentation fix, not a repair. The repair is not known, and a tool that hides a known
landmine is worse than one with no feature at all.
"""
import sys
from pathlib import Path

NEW_DESCRIPTION = (
    "'Create a new POU by cloning a template POU that already exists in the project. "
    "Template is required - creation clones that POU's directory and renames its streams, so a "
    "POU cannot be authored from nothing. The new POU INHERITS the template's variable "
    "declarations and those ARE usable: write the body to use them. "
    "KNOWN LIMITATION - adding a declaration to a created POU BREAKS it. Measured: the add reports "
    "success and the declaration reads back correctly, and then the first build after the POU is "
    "assigned STALLS, with the IDE truncating the .VB to 0 bytes and the grid to 79,432,063 "
    "bytes. The identical add on an EXISTING POU survives and compiles. So choose a template that "
    "already declares what the new POU needs, or add declarations to an existing POU; if a created "
    "POU must have new declarations, add them once in the MotionWorks editor and edit it from here "
    "afterwards. This is stated because the failure is silent and delayed. **dry_run defaults to "
    "true.**'"
)


def patch(path: Path) -> None:
    t = path.read_text(encoding="utf-8")
    marker = "'Create a new POU by cloning a template POU that already exists in the project."
    i = t.index(marker)
    # the description runs to the first "'," after the marker
    end = t.index("',", i) + 2
    t = t[:i] + NEW_DESCRIPTION + t[end:]
    path.write_text(t, encoding="utf-8")
    print(f"  mw_code_pou_create now states the limitation, in {path.name}")


for arg in sys.argv[1:]:
    patch(Path(arg))
