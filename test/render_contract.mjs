/**
 * Render contract: every tool's `render` must return content blocks, not a primitive.
 *
 * `text()` produces `[{ type: 'text', text }]`. A render that returns a bare string
 * hands the harness a String where it expects an array, and the spill policy's
 * `content.some(block => block.type === 'image')` then fails with
 * "content.some is not a function" - an error that names neither this file nor the
 * tool it belongs to.
 *
 * `mw_code_task_model` shipped exactly that way: it was the one tool whose render
 * returned a joined string, and every call failed. `validate_outputs.mjs` covers the
 * other half of the same lesson - a tool whose OUTPUT does not match its declared
 * schema - and between them the two checks cover what the harness validates.
 *
 * The tool list comes from apply(), not from a pattern over the source: a pattern
 * also matches the skill's own `name:` and counts more tools than the plugin has.
 *
 * Static and dependency-free on purpose: no Cordis context, no IDE, no staged project.
 *
 * Run:  node test/render_contract.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { apply } from '../index.js'

const SOURCE = fileURLToPath(new URL('../index.js', import.meta.url))
const src = readFileSync(SOURCE, 'utf8')

const definitions = []
apply({ get: () => undefined, tools: { register: (d) => definitions.push(d) }, on() {}, logger: { warn() {} } })
assert.ok(definitions.length > 0, 'apply() registered no tools; every check below would be vacuous')

const offenders = []
for (const tool of definitions) {
  const at = src.indexOf(`name: '${tool.name}'`)
  if (at < 0) continue
  // Bound each tool's span at the next tool declaration, so a sibling property's
  // return is not mistaken for this render's.
  const next = src.indexOf("name: '", at + 1)
  const body = src.slice(at, next < 0 ? src.length : next)
  const r = body.indexOf('render:')
  if (r < 0) continue
  const after = body.slice(r)
  const stops = ['execute:', 'presentCall:', 'parameters:'].map((k) => after.indexOf(k)).filter((x) => x >= 0)
  const render = stops.length ? after.slice(0, Math.min(...stops)) : after
  for (const m of render.matchAll(/return\s+([^\n;]+)/g)) {
    const value = m[1].trim()
    if (!value || value.startsWith('text(') || value.startsWith('{') || value.startsWith('undefined')) continue
    offenders.push(`${tool.name}: return ${value.slice(0, 90)}`)
  }
}

if (offenders.length > 0) {
  console.error(`render contract: ${offenders.length} render(s) return a primitive instead of text(...):`)
  for (const o of offenders) console.error(`  ${o}`)
  process.exit(1)
}

console.log(`render contract: ${definitions.length} tool(s) return content blocks`)
