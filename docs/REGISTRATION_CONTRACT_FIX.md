# Registration contract fix — 2026-10-02

## Summary

The bundle installed cleanly, passed `preflight`, and passed the entire offline
test suite while **registering zero of its 61 tools**. DSH reached
`ctx.tools.register` for the first tool, that call threw `JsonSchemaError`, and
`apply()` aborted — so 13 of the 61 tools that were asked for in this workspace
were never available to any chat.

This document records the defect, the evidence, the fix and the new guard.

## The defect

`ToolRuntime.register` (`@deepseek-ai/dsh-tools`) asserts the output schema
**before** inserting anything:

```js
register(definition) {
  const output = definition.output;
  if (output === undefined || ... ) throw new TypeError(...);
  assertSupportedJsonSchema(output.schema);   // <-- throws here
  ...
}
```

`assertSupportedJsonSchema` enforces a closed keyword subset, and one of its rules
is that every name in `required` must be **declared** in `properties`
(`checkObjectSchemaTail`):

```
schema.required names "accepted" which is not in properties
```

Fourteen tools were authored as an open object that *names* its guarantee-keys but
never declares them:

```js
output:{schema:{type:'object',additionalProperties:true,
                required:['accepted','action_performed','evidence_path']}, render:...}
```

`apply()` then registers in a plain loop with **no try/catch**:

```js
for (const definition of defineTools()) {
  ctx.tools.register({ ...definition, async execute(args, exec) { ... } });
}
```

`defineTools()` returns `mw_ide_pou_convert` first, which was one of the fourteen,
so the throw happened on the very first iteration and nothing registered.

Measured against the installed harness, on the pre-fix commit `c12a4ee`:

```json
{ "defined": 61, "registered": 0,
  "applyThrew": "JsonSchemaError: unsupported JSON schema: schema.required names \"accepted\" which is not in properties; ..." }
```

The 14 affected tools, and the keys that were undeclared:

| tool | undeclared `required` names |
| --- | --- |
| `mw_ide_pou_convert`, `mw_ide_pou_package` | accepted, action_performed, evidence_path |
| `mw_ide_graphical_listing` | accepted, evidence_path |
| `mw_code_installed_help`, `mw_code_block_interface` | evidence_kind, action_performed |
| `mw_ide_fb_insert` | verification, completed_phases, evidence_path |
| `mw_ide_code_change` | pou, action_performed, method, native_result, verification, body, evidence_path, next_step |
| `mw_ide_pou_change`, `mw_ide_task_change` | scope, operation, action_performed, native_result, verification, baseline, expected_native, next_step |
| `mw_ide_variable_change` | operation, action_performed, native_result, verification, baseline, expected_variables, next_step |
| `mw_ide_open_worksheet` | accepted, action_performed, logical_name, requested_logical_name, active_project, method, is_modified, modified_state_unchanged, urn |
| `mw_ide_variable_plan` | token, expected_count, declaration, dialog_values, action_performed, expires_in_seconds |
| `mw_ide_variable_verify` | accepted, evidence_kind, expected_count, saved_count, missing, unexpected, changed, errors |
| `mw_code_tasks` | `properties.source_hashes.additionalProperties` was a schema, not a boolean |

Twelve parameter schemas additionally used keywords the subset rejects
(`pattern`, `minimum`, `maximum`, `minLength`, `maxLength`, `uniqueItems`, and
object-valued `additionalProperties`). `register()` does not assert `parameters`,
so those were inert — but they are outside the documented authoring contract and
`defineTool` does assert them, so leaving them was a latent break.

### What the chat saw

`skills.register` runs *before* the tool loop in `apply()`, so the skill
registered and the tools did not: the chat advertised a MotionWorks skill with no
MotionWorks tools behind it. That matches the handoff's open item #1,
`running_chat_catalog_verified: false`.

### Why nothing caught it

- Every test called `defineTools()[i].execute(...)` directly. That is not how DSH
  reaches a tool, so no test ever crossed `register()`.
- `test/render_contract.mjs` is the closest thing, and it registers through a
  deliberate stub: `{ register: (d) => definitions.push(d) }`. A stub cannot fail.
- `preflight.mjs` counted *definitions* ("entry point loads and defines 61 tools")
  and checked only that `{ schema, render }` existed.
- The live evidence in `SUPPORT_ENGINEER_PROGRESS.md` was gathered by calling
  `execute()` directly, so it proved the tools worked — never that DSH could
  reach them.

## The fix

`index.js` gained one helper, and every affected site now uses it:

```js
const openOutput = required => ({
  type: 'object',
  additionalProperties: true,
  properties: Object.fromEntries(required.map(key => [key, {}])),
  required,
});
```

The guarantee-keys stay **required** and unknown keys stay **allowed**, which is
the original intent; they are now simply *declared*, as the harness requires. The
parameter schemas were reduced to the supported subset, with the removed
constraints restated in `description` text. No runtime check was dropped — the
in-code guards (`variableExpectation`, hash preconditions, identity checks) remain
authoritative.

## Verification

| check | result |
| --- | --- |
| Real harness assertion, repo copy, pre-fix | 0/61 registered, `apply()` threw |
| Real harness assertion, repo copy, post-fix | **61/61 registered, 0 parameter and 0 output violations** |
| `test/registration_contract.mjs` on pre-fix commit | **fails**, 70 output-schema violations |
| `test/registration_contract.mjs` post-fix | passes, 61 registered / 61 unique names |
| Full `npm test` | **exit 0** (new check included) |
| `preflight.mjs`, repo copy | 7/7 checks pass |
| Install to `app.asar.unpacked` | 138 files copied and hash-verified |
| `preflight.mjs` against the installed copy | 7/7 checks pass |

The real-harness runs imported `@deepseek-ai/dsh-tools` from the installed
`app.asar` and replayed `register()`'s guards, so `apply()` was exercised the way
DSH exercises it.

Because `createSuccessResult` validates **every** returned value against
`output.schema`, the fourteen outputs become newly enforced once they register. All
fourteen were audited and each declared `required` key is genuinely produced:

- inline returns with both success and refusal paths — `mw_ide_pou_convert`,
  `mw_ide_pou_package`, `mw_ide_fb_insert`;
- `graphical-listing.js` (`accepted`), `native-code.js`, `native-structure.js`,
  `native-variables.js`, `edit-session.js` (`retainPlan`), and `compareVariables`
  in `index.js`;
- the native bridge `open_worksheet` verb (`bridge/mw_bridge.ps1`);
- the code engine for `mw_code_tasks` (`code/mw_code.py`), `mw_code_installed_help`
  (`installed_help.py`) and `mw_code_block_interface` (`block_interfaces.py`).

The refusal paths were also exercised: with no IDE running and no staged project in
this checkout, all fourteen throw before returning, so no output validation is
attempted on that path.

### Live baseline in the running chat

Taken while the running process still held the pre-fix bundle, from the live
harness rather than from disk:

```
plugin_manager list_plugins
  -> {"entryId":"include:motionworks-iec-use","moduleName":"dsh-motionworks-iec-use",
      "enabled":true,"fiberPhase":"failed", ...}

cordis_inspect_query host Tool listTools
  -> 182 tools callable by the agent, 0 of them named mw_*
  -> the string "motionworks" does not appear in the catalog at all
```

Every other plugin in the same profile reports `"fiberPhase":"active"`. The plugin
is enabled, its fiber failed, and the agent has no MotionWorks tool — which is the
predicted consequence of `apply()` throwing on the first tool.

This also fixes how the gap is checked. `apply()` runs before any tool is callable,
so a still-failing schema shows up as `fiberPhase: "failed"` plus an empty catalog —
not as a tool error. The two signals to read are:

1. `plugin_manager list_plugins` — `fiberPhase` for `motionworks-iec-use`.
2. `cordis_inspect_query` on `platform: "host"`, `provider: "Tool"`,
   `method: "listTools"` — the tools actually callable by the agent.

### Live confirmation after restart

Arya was restarted against the installed bundle, and both signals flipped:

```
plugin_manager list_plugins
  before: {"moduleName":"dsh-motionworks-iec-use","fiberPhase":"failed"}
  after : {"moduleName":"dsh-motionworks-iec-use","fiberPhase":"active"}

cordis_inspect_query host Tool listTools
  before: 182 tools callable, 0 named mw_*, "motionworks" absent
  after : 243 tools callable, 61 named mw_*
```

243 = 182 + 61, so the whole tool set arrived and nothing else was displaced. The
61 names are exactly `defineTools()`: `mw_project_find`, `mw_workflow_check`, the
29 `mw_code_*` tools and the 30 `mw_ide_*` tools. Several repaired schemas are
visible verbatim in the live catalog — `mw_ide_pou_convert`'s
`expected_body_sha256` now carries its constraint as a description,
`mw_ide_fb_insert.bindings` and `mw_ide_task_change.settings_changes` report
`additionalProperties: true`, and `mw_code_reference`'s `query`/`limit` and
`mw_ide_graphical_listing`'s `start`/`limit` carry their bounds as descriptions.

The restart was sufficient on its own. `index.js` does not import the new
`tool-contract.mjs` (only `preflight.mjs` and the tests do), so the runtime module
graph is the one that already resolved all 61 definitions out of
`app.asar.unpacked`.

## New guard

- `tool-contract.mjs` — a dependency-free reimplementation of
  `assertSupportedJsonSchema` and `register()`'s guards. It cannot import the real
  one because `@deepseek-ai/*` is not resolvable from this bundle.
- `test/registration_contract.mjs` — registers the way DSH does against a
  `register()` that *enforces* the guards, then asserts the registered count equals
  the defined count. Wired into `test/workspace_suite.mjs`.
- `preflight.mjs` step 7 — reports the same contract at install time, which is
  where a bundle that registers nothing should be caught.

The local validator is not the authority; it was cross-checked against the harness.
On the pre-fix commit it reports exactly the violations the real
`assertSupportedJsonSchema` reports (70 output violations across 14 tools).

## Version and limitations

Version stays **0.5.5**; nothing was published and no release tag moved.

- The running chat's catalog was confirmed live after a restart: `fiberPhase`
  `active`, 61 `mw_*` tools callable. A reload is still required after any future
  change to this bundle, because the catalog is read at load time.
- Live *success-path* output validation for the fourteen tools was not exercised —
  that needs the disposable fixture, the IDE and an authorized edit session. Their
  refusal paths were exercised (all throw), and every declared key was traced to the
  code or engine that produces it.
- Nothing was sent to a controller; no download, no Run/Reset, no forcing, no
  motion. No customer project was opened, staged or modified.
