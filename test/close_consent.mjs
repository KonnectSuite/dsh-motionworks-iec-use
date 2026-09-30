import assert from 'node:assert/strict';
import { __internals } from '../index.js';

const tools = new Map(__internals.defineTools().map((tool) => [tool.name, tool]));
const close = tools.get('mw_ide_close');
const open = tools.get('mw_ide_open');
assert(close);
assert(open);
assert(close.parameters.required.includes('user_approved'));
assert(open.parameters.properties.expected_project);
assert(open.parameters.properties.user_approved);
assert.throws(
  () => close.execute({ user_approved: false }),
  /Ask the user whether the agent may save and close MotionWorks/,
);
console.log('IDE close requires user approval; open requires exact-project consent fields');
