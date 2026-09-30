# MotionWorks IEC capability audit — 2026-09-30

Host: MotionWorks IEC 3 Pro 1.19 on Windows. Project: a disposable staged copy of the
user-supplied TopCutter example. Original project files were not edited.

| Operation | Evidence | Status |
| --- | --- | --- |
| IDE start, open, Build, close | Installed v0.4 plugin opened the exact staged wrapper; Build returned `accepted=true`, `settled=true`, `is_compiled=true`; IDE closed. | Passed |
| ST POU create, write, assign to existing BG task | Live checkout matrix read back the assignment and compiled. | Passed on checkout implementation |
| LD POU clone and assign to existing BG task | Live checkout matrix identified the clone as LD and compiled. This does not establish arbitrary rung editing. | Passed for cloning |
| POU create and delete | Live checkout matrix removed the new POU, then compiled. | Passed on checkout implementation |
| POU and global variable add, edit, delete | Live checkout matrix read back the renamed variables, removed them, then compiled. Intermediate states were not each compiled. Installed v0.4 native offline regression also passed. | Partial live coverage |
| Task assignment to existing task | New ST and LD POU assignments were read back from COM and compiled. | Passed on checkout implementation |
| Task create and delete without assignment | New cyclic task was read back from COM, deleted, and the project compiled. | Passed on checkout implementation |
| New task with assigned POU | Creation and assignment read back from COM, but Build stalled after about 90 seconds without compiler messages. | Unverified; do not claim success |
| Library addition from installed libraries | No supported add tool exists. Candidate library discovery does not modify a project. | Unsupported |
| Native Rebuild | Installed bridge requests it, but IDE 1.19 did not accept the command in earlier live checks. Build is a distinct verified operation. | Unsupported on this IDE build |

The installed v0.4 plugin had two live bridge faults fixed for this update: a pathless but
valid `.mwt` wrapper was rejected, and 32-bit PowerShell lacked `Get-FileHash`. The wrapper
check now permits zero embedded absolute paths while keeping staged identity checks; SHA-256
uses .NET. Task names longer than seven characters now fail before COM creation.

The installed v0.4 test suite and its native offline reference test passed. The repository
now contains the installed v0.4 engine plus those fixes. Passing offline tests does not
establish that each edit survives a live Build; repeat the staged live workflow for each
completed engineering change.
