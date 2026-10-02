/**
 * The DSH tool-registration contract, checked without importing DSH.
 *
 * WHY THIS EXISTS. `@deepseek-ai/*` is not resolvable from this bundle (see the
 * "WHY THERE ARE NO PACKAGE IMPORTS HERE" note in index.js), so the harness's own
 * `assertSupportedJsonSchema` cannot be imported here. That left the contract
 * unenforced: 14 tools declared `required` names that were never DECLARED in
 * `properties`, `ctx.tools.register` threw `JsonSchemaError` on the first of them,
 * and `apply()` aborted — the bundle installed cleanly, listed every file, and
 * registered ZERO tools while reporting no error anywhere.
 *
 * This module reimplements the enforced subset faithfully enough to catch that
 * class of mistake offline. It mirrors `checkSchemaNode`, `checkObjectSchemaTail`
 * and the `ctx.tools.register` guards in @deepseek-ai/dsh-tools.
 *
 * The real harness assertion remains the authority: run
 * `test/registration_contract_live.mjs` (or verify-arya-registry-contract) against
 * an installed copy to confirm this module and DSH still agree.
 */

/** Types the harness accepts in `type`. */
export const SCHEMA_TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'];

/** Keywords that constrain a value. Anything else is rejected. */
export const CONSTRAINT_KEYWORDS = new Set([
  'type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const',
]);

/** Keywords carried through for documentation only. */
export const ANNOTATION_KEYWORDS = new Set(['description', 'title', 'default', 'examples']);

/** Keywords the harness refuses to see beside `oneOf`. */
const ONE_OF_SIBLING_KEYWORDS = ['properties', 'required', 'additionalProperties', 'items', 'enum', 'const'];

/** Which keywords are legal on which `type`. */
const KEYWORD_TYPES = {
  properties: ['object'],
  required: ['object'],
  additionalProperties: ['object'],
  items: ['array'],
  enum: ['string', 'number', 'integer', 'boolean', 'null'],
  const: ['string', 'number', 'integer', 'boolean', 'null'],
};

function isPlainRecord(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function isLosslessJson(value) {
  try { JSON.stringify(value); return true; } catch { return false; }
}

function scalarMatches(type, value) {
  switch (type) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0);
    case 'integer': return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && !Object.is(value, -0);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: return false;
  }
}

/**
 * Collect every violation for one raw schema tree.
 * @returns {string[]} path-qualified violations; empty means inside the subset.
 */
export function checkSchema(schema, path = 'schema') {
  const violations = [];
  const walk = (node, at) => {
    if (!isPlainRecord(node)) { violations.push(`${at} must be a schema object`); return; }

    for (const key of Object.keys(node)) {
      if (CONSTRAINT_KEYWORDS.has(key)) continue;
      if (ANNOTATION_KEYWORDS.has(key)) {
        if (!isLosslessJson(node[key])) violations.push(`${at}.${key} annotation must be lossless JSON data`);
        continue;
      }
      violations.push(`${at}.${key} is not a supported keyword `
        + '(subset: type/oneOf/properties/required/additionalProperties/items/enum/const + annotations)');
    }
    if (Object.hasOwn(node, 'description') && typeof node.description !== 'string') {
      violations.push(`${at}.description must be a string`);
    }
    if (Object.hasOwn(node, 'title') && typeof node.title !== 'string') {
      violations.push(`${at}.title must be a string`);
    }

    const hasType = Object.hasOwn(node, 'type');
    const hasOneOf = Object.hasOwn(node, 'oneOf');
    if (hasType && hasOneOf) { violations.push(`${at} cannot declare both type and oneOf`); return; }
    if (!hasType && !hasOneOf) {
      for (const key of ONE_OF_SIBLING_KEYWORDS) {
        if (Object.hasOwn(node, key)) violations.push(`${at}.${key} requires type or oneOf`);
      }
      return;
    }

    if (hasOneOf) {
      const oneOf = node.oneOf;
      if (!Array.isArray(oneOf) || oneOf.length < 2) {
        violations.push(`${at}.oneOf must be an array of at least two schemas`);
      } else {
        oneOf.forEach((branch, i) => walk(branch, `${at}.oneOf[${i}]`));
      }
      for (const key of ONE_OF_SIBLING_KEYWORDS) {
        if (Object.hasOwn(node, key)) violations.push(`${at}.${key} is not supported beside oneOf`);
      }
      return;
    }

    const type = node.type;
    if (typeof type !== 'string' || !SCHEMA_TYPES.includes(type)) {
      violations.push(Array.isArray(type)
        ? `${at}.type must be a single type string (type arrays are not supported)`
        : `${at}.type must be one of ${SCHEMA_TYPES.join('/')}`);
      return;
    }

    for (const [key, types] of Object.entries(KEYWORD_TYPES)) {
      if (Object.hasOwn(node, key) && !types.includes(type)) {
        violations.push(`${at}.${key} is not supported on type "${type}"`);
      }
    }

    if (type === 'object') {
      const properties = Object.hasOwn(node, 'properties') ? node.properties : undefined;
      if (Object.hasOwn(node, 'properties')) {
        if (!isPlainRecord(properties)) violations.push(`${at}.properties must be an object of schemas`);
        else for (const [name, sub] of Object.entries(properties)) walk(sub, `${at}.properties.${name}`);
      }
      // object tail: every required name must be declared, additionalProperties boolean
      if (Object.hasOwn(node, 'required')) {
        const required = node.required;
        if (!Array.isArray(required) || required.some((e) => typeof e !== 'string')) {
          violations.push(`${at}.required must be an array of strings`);
        } else {
          const declared = isPlainRecord(properties) ? properties : {};
          for (const key of required) {
            if (!Object.hasOwn(declared, key)) violations.push(`${at}.required names "${key}" which is not in properties`);
          }
        }
      }
      if (Object.hasOwn(node, 'additionalProperties') && typeof node.additionalProperties !== 'boolean') {
        violations.push(`${at}.additionalProperties must be a boolean`);
      }
      return;
    }

    if (type === 'array') {
      if (Object.hasOwn(node, 'items')) walk(node.items, `${at}.items`);
      return;
    }

    // scalars
    if (Object.hasOwn(node, 'enum')) {
      const allowed = node.enum;
      const ok = Array.isArray(allowed) && allowed.length > 0 && allowed.every((e) => scalarMatches(type, e));
      if (!ok) violations.push(`${at}.enum must be a non-empty array of ${type} values`);
    }
    if (Object.hasOwn(node, 'const') && !scalarMatches(type, node.const)) {
      violations.push(`${at}.const must be a ${type} value`);
    }
  };

  walk(schema, path);
  return violations;
}

/**
 * Check every tool against the contract `ctx.tools.register` enforces.
 *
 * `parameters` is NOT asserted by `register()` itself (it takes the already
 * converted JSON Schema), but a violating parameter schema is still a latent
 * break: it is outside the documented authoring subset and DSH's own `defineTool`
 * asserts it. It is reported here as a parameter problem, separately from the
 * output problems that actually stopped registration.
 *
 * @returns {{output: object[], parameters: object[], shape: object[]}}
 */
export function checkToolContract(tools) {
  const output = [];
  const parameters = [];
  const shape = [];
  for (const tool of tools) {
    const name = tool?.name ?? '(unnamed)';
    if (tool?.output === undefined || typeof tool.output !== 'object'
        || typeof tool.output.render !== 'function') {
      shape.push({ tool: name, violation: 'must declare output { schema, render }' });
      continue;
    }
    for (const v of checkSchema(tool.output.schema, 'schema')) output.push({ tool: name, violation: v });
    if (tool.parameters !== undefined) {
      for (const v of checkSchema(tool.parameters, 'parameters')) parameters.push({ tool: name, violation: v });
      if (tool.parameters?.type !== 'object') {
        parameters.push({ tool: name, violation: 'parameters.type must be "object"' });
      }
    }
  }
  return { output, parameters, shape };
}
