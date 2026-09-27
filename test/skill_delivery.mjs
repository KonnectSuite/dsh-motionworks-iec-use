// Does the plugin actually register its skill, and does the rule ride along in the fields an agent
// sees WITHOUT loading it?
//
// Why this test exists: SKILL.md shipped for the whole life of this plugin and was never registered.
// The cordis patch registers the plugin row and nothing else, and index.js had no reference to the
// file - so a 777-line document, including the workspace rule at line 764, was never once delivered
// to an agent. The owner reported the same failure three times.
//
// A file on disk is not a rule. This asserts the delivery, not the file.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PLUGIN = process.env.MW_PLUGIN ?? process.argv[2];
if (!PLUGIN) { console.error('set MW_PLUGIN or pass the plugin directory'); process.exit(2); }

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); };

const mod = await import(pathToFileURL(join(PLUGIN, 'index.js')).href);

// A context shaped like the host's, recording what the plugin registers.
const registered = { skills: [], tools: [], effects: [] };
const ctx = {
  get: (name) => (name === 'skills'
    ? { register: (skill) => { registered.skills.push(skill); return () => {}; } }
    : undefined),
  effect: (fn) => { registered.effects.push(fn); return () => {}; },
  tools: { register: (def) => { registered.tools.push(def); } },
  on: () => {},
  logger: { warn: (m) => console.log(`    warn: ${m}`) },
};

mod.apply(ctx);

console.log('\n  ══ the skill is delivered ══');
check('apply() registers a skill at all', registered.skills.length === 1,
  `${registered.skills.length} registered`);

const skill = registered.skills[0] ?? {};
check('it is named motionworks-iec-use', skill.name === 'motionworks-iec-use', String(skill.name));
check('the body is loaded from SKILL.md, not empty',
  typeof skill.content === 'string' && skill.content.length > 5000,
  `${skill.content?.length ?? 0} chars`);
check('the frontmatter is stripped from the body',
  !!skill.content && !skill.content.startsWith('---'),
  skill.content?.slice(0, 12).replace(/\n/g, '\\n'));

// The point of the whole exercise: the rule must be in what an agent sees WITHOUT loading.
console.log('\n  ══ the rule rides in the summary, not only the body ══');
const desc = String(skill.description ?? '');
const when = String(skill.whenToUse ?? '');
check('the description says to find the project first',
  /mw_project_find/.test(desc), desc.slice(0, 60) + '...');
check('the description says to stay in the workspace',
  /inside the workspace/i.test(desc), '');
check('the description warns against a project elsewhere',
  /never one from elsewhere|elsewhere on the machine/i.test(desc), '');
check('whenToUse fires on merely mentioning a project',
  /mentioned at all/i.test(when), when.slice(0, 60) + '...');
check('it is model-invocable so the agent can load it',
  skill.invocation?.modelInvocable === true, JSON.stringify(skill.invocation));
check('the source is bundled', skill.source === 'bundled', String(skill.source));

console.log('\n  ══ and the tools are unaffected ══');
check('all tools still register', registered.tools.length >= 38, `${registered.tools.length} tools`);
check('every tool keeps its schema and render',
  registered.tools.every((t) => t.output?.schema && typeof t.output?.render === 'function'),
  `${registered.tools.filter((t) => t.output?.schema).length} with schema`);

console.log('\n  ══ a broken SKILL.md must not take the tools down ══');
{
  // Simulate the failure the try/catch exists for: registration throwing.
  const broken = { skills: [], tools: [] };
  const ctx2 = {
    get: (n) => (n === 'skills' ? { register: () => { throw new Error('catalogue full'); } } : undefined),
    effect: () => () => {},
    tools: { register: (d) => broken.tools.push(d) },
    on: () => {},
    logger: { warn: () => {} },
  };
  let threw = false;
  try { mod.apply(ctx2); } catch { threw = true; }
  check('a failing skill registration does not throw out of apply()', !threw, '');
  check('  and the tools still register anyway', broken.tools.length >= 38,
    `${broken.tools.length} tools`);
}

console.log('\n════════════════════════════════════════════════════════════════════════════════════════');
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.detail ? `   ${r.detail}` : ''}`);
console.log(`\n  ${results.length - failed.length} of ${results.length} pass\n`);
process.exit(failed.length ? 1 : 0);
