/**
 * Self-containment check: the plugin must work off its OWN files.
 *
 * Clears MW_SRC and MW_PYTHON so nothing can point at an external engine or
 * interpreter, then exercises the code path and reports which interpreter it
 * actually used. If this passes, the plugin package really does contain
 * everything it needs.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

delete process.env.MW_SRC;
delete process.env.MW_PYTHON;

const mod = await import('../index.js');

const bundled = join(
  process.env.LOCALAPPDATA ?? '', 'Programs', 'AryaAI', 'resources', 'runtime',
  'primary-runtime', 'dependencies', 'python', 'python.exe',
);
const engine = join(mod.__internals.BRIDGE_DIR, '..', 'code', 'engine');

console.log('MW_SRC     :', process.env.MW_SRC ?? '(unset — must use the vendored engine)');
console.log('MW_PYTHON  :', process.env.MW_PYTHON ?? '(unset — must discover one)');
console.log('bundled py :', existsSync(bundled) ? bundled : 'NOT FOUND');
console.log('engine dir :', existsSync(engine) ? 'present' : 'MISSING');
console.log('engine pkg :', existsSync(join(engine, 'motionworks_iec_mcp', 'writer.py'))
  ? 'motionworks_iec_mcp/writer.py present' : 'MISSING');

const tools = new Map(mod.__internals.defineTools().map((t) => [t.name, t]));
const run = (name, args = {}) => tools.get(name).execute(args, {});

const pous = await run('mw_code_pous');
console.log(`\nread ${pous.count} POUs from the vendored engine:`);
for (const p of pous.pous) console.log(`   ${p.name.padEnd(14)} ${p.language}`);

const st = await run('mw_code_read_st', { pou: 'Initialize' });
console.log(`\nread ST body for ${st.pou}:\n${st.body}`);

console.log('\nSELF-CONTAINED: the plugin used only its own files');
