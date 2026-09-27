"""Drop the bridge's cached COM object whenever the project changes underneath it.

The bug, measured this round with everything else held constant:

    standalone PowerShell, fresh COM object   Tasks.Create('ZzTask2','CYCLIC')  -> OK
    through the bridge, same project, same instant
                                              "Internal error in 'Create
                                               (internal creation process)'."

and the SAME verb succeeds the moment the bridge process is restarted while the IDE keeps running.

So the failure was never the call. Connect-App caches $script:App and only probes $script:App.Version
to decide whether it is still good - and a cached Application keeps handing back the project it
first saw. Across a session that stages and reopens a project repeatedly - which every test here
does, and which an agent working through several projects would do too - that cache goes stale and
mutation verbs start failing with errors that name the operation rather than the cause.

That is the second time this class has cost time: round 37 chased "unknown verb" from a bridge whose
script had changed under it. Both are the same mistake - trusting a long-lived child to notice that
the world moved.

The fix is to forget the cached object whenever the project is opened or the IDE is closed, so the
next verb reconnects. It costs one COM connect on the operations that already take hundreds of
milliseconds, and it removes a failure that is invisible from the outside.
"""
import sys
from pathlib import Path

# After a project is opened or the IDE is closed, the cached Application may describe a project
# that no longer exists. Forget it.
INVALIDATE = "        $script:App = $null\n"

TARGETS = [
    ("            'open' {", "open"),
    ("            'close_ide' {", "close_ide"),
]


def patch(path: Path) -> None:
    t = path.read_text(encoding="utf-8")
    nl = "\r\n" if "\r\n" in t else "\n"
    added = 0
    for anchor, label in TARGETS:
        a = anchor if nl == "\n" else anchor
        if a not in t:
            print(f"  {label}: anchor not found, skipped")
            continue
        # insert the invalidation immediately after the case opens
        idx = t.index(a) + len(a)
        # find the end of that line
        eol = t.index("\n", idx) + 1
        line = "                # The cached Application can describe a project that no longer" + nl
        line += "                # exists once this has run; drop it so the next verb reconnects." + nl
        line += "                $script:App = $null" + nl
        if "$script:App = $null" in t[eol:eol + 400]:
            print(f"  {label}: already invalidates")
            continue
        t = t[:eol] + line + t[eol:]
        added += 1
    path.write_text(t, encoding="utf-8")
    print(f"  invalidated the cached App in {added} verb(s) of {path.name}")


for arg in sys.argv[1:]:
    patch(Path(arg))
