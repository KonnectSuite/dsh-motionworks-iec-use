# Packaged runtime repair — 0.5.2

The supplied session log showed ENOTDIR failures in an Electron-packaged host.
Installed code inspection reproduced the cause: request/reply files were placed
beside scripts and helper paths were derived from an `app.asar` module URL.
Electron's file reader can read the archive; spawned Python/PowerShell cannot use
archive paths as real filesystem paths. Installation folders are not runtime storage.

## Changes

- Resolve the package root to its existing `app.asar.unpacked` counterpart for
  child-process scripts. Unpacked resources must actually ship with the host.
- Use a unique per-plugin-instance mailbox below the system temp directory for
  bridge/Python requests, replies, logs and diagnostic screenshots.
- Pass that mailbox to the bridge through `MW_BRIDGE_DIR`; retain per-request
  workspace/stage authority and exact-project approval checks.
- Retain installed-file backups before a local hotfix. A host restart/reload is
  required; replacing files does not update already-imported JavaScript.

## Evidence and limits

`test/packaged_runtime.mjs` simulates the ASAR module location, resolves physical
helpers and performs real Python staging/read-only inspection on synthetic temporary
fixtures. It confirms session workspace resolution and no request-file writes beside
installed code. It does not start an IDE or simulate every Electron security setting.

The complete isolated suite passed after the change. Read-only calls using the repaired
installed package read the saved ST and attached to the existing IDE. They correctly
reported the open project as outside the verified stage. No project was saved, built,
edited or closed; no controller operation occurred. End-to-end calls through the live
Arya host after reload remain a required acceptance step.

If the active IDE path differs from the session workspace/project, do not bypass
the guard or stage an unrelated program. Reconcile the requested project with the
user, preserve unsaved work, and approve a disposable stage before editing.

Application reinstall/update can overwrite a local unpacked-file hotfix. Prefer a
host-managed updated bundle or include this fix in the next application distribution.
