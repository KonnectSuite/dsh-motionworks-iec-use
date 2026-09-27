/**
 * Self-containment check: the plugin must work off its OWN files.
 *
 * Clears MW_SRC and MW_PYTHON so nothing can point at an external engine or
 * interpreter, then proves the code path resolves and imports the vendored
 * engine. If this passes from a fresh clone, the package really does contain
 * everything it needs.
 *
 * Needs no MotionWorks project and no running IDE, so it runs anywhere. Set
 * MW_SAMPLE_PROJECT to additionally exercise a real project read.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

delete process.env.MW_SRC;
delete process.env.MW_PYTHON;

const mod = await import('../index.js');
const { runCode, pythonExe, codeSrc, CODE_DIR } = mod.__internals;

const engine = codeSrc();
const py = pythonExe();

console.log('MW_SRC     :', process.env.MW_SRC ?? '(unset — must use the vendored engine)');
console.log('MW_PYTHON  :', process.env.MW_PYTHON ?? '(unset — must discover one)');
console.log('resolved py:', py, existsSync(py) || py === 'python' ? '' : '(MISSING)');
console.log('resolved eng:', engine);
console.log('engine dir :', existsSync(engine) ? 'present' : 'MISSING');
console.log(
  'engine pkg :',
  existsSync(join(engine, 'motionworks_iec_mcp', 'writer.py'))
    ? 'motionworks_iec_mcp/writer.py present'
    : 'MISSING',
);

// Assert the engine is the VENDORED one, not something reached from elsewhere.
if (engine !== join(CODE_DIR, 'engine')) {
  console.error(`\nFAIL: engine resolved to ${engine}, not the vendored copy`);
  process.exit(1);
}
if (!existsSync(join(engine, 'motionworks_iec_mcp', 'writer.py'))) {
  console.error('\nFAIL: vendored engine is incomplete');
  process.exit(1);
}

// Prove the vendored package actually imports under the discovered interpreter.
// `ide_closed` reads the ide module and needs no project.
const probe = await runCode('ide_closed', {});
console.log('\nvendored engine imported OK; ide module reports:', JSON.stringify(probe).slice(0, 200));

// Optional: exercise a real project when one is supplied.
if (process.env.MW_SAMPLE_PROJECT) {
  const tools = new Map(mod.__internals.defineTools().map((t) => [t.name, t]));
  const staged = await tools.get('mw_ide_stage').execute(
    { source: process.env.MW_SAMPLE_PROJECT }, {},
  );
  console.log(`\nstaged ${staged.files_copied} files`);
  const pous = await tools.get('mw_code_pous').execute({}, {});
  console.log(`read ${pous.count} POUs from the vendored engine:`);
  for (const p of pous.pous) console.log(`   ${p.name.padEnd(14)} ${p.language}`);
} else {
  console.log('\n(MW_SAMPLE_PROJECT not set — skipped the project read)');
}

console.log('\nSELF-CONTAINED: the plugin used only its own files');
