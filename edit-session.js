// Declaration plans are immutable, workspace-bound read-back evidence, not UI input.
import { randomUUID } from 'node:crypto';
const fields = ['name','type','section','group','address','initial_value','description'];
const plans = new Map();
const ttl = 30 * 60 * 1000;
export function variableExpectation(baseline, declaration, pou) {
  if (!Array.isArray(baseline)) throw new Error('Missing saved declaration baseline');
  if (!declaration || fields.some(f => !Object.hasOwn(declaration, f)
      || (declaration[f] !== null && typeof declaration[f] !== 'string')))
    throw new Error('Supply all seven declaration fields, using null for absent metadata');
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,29}$/.test(declaration.name ?? ''))
    throw new Error('Use an IEC identifier of at most 30 characters; never silently truncate or rename');
  if (!declaration.type || /[;\r\n]/.test(declaration.type)) throw new Error('Invalid data type');
  if (!(pou ? ['VAR','VAR_EXTERNAL'] : ['VAR_GLOBAL']).includes(declaration.section))
    throw new Error('Usage does not match worksheet scope');
  if (!declaration.group) throw new Error('An explicit existing variable group is required');
  if (declaration.section === 'VAR_EXTERNAL' && (declaration.address || declaration.initial_value))
    throw new Error('Externals must not duplicate a global physical address or initializer');
  if (baseline.some(v => v.name.toUpperCase() === declaration.name.toUpperCase()))
    throw new Error('Variable already exists; addition refused');
  if (!baseline.some(v => v.group === declaration.group))
    throw new Error('Group is not in the saved baseline; create/verify it separately');
  if (declaration.address && baseline.some(v => v.address?.toUpperCase() === declaration.address.toUpperCase()))
    throw new Error('Exact IEC address already used; addition refused');
  // Distinct strings can overlap physically. This is not an IO allocation proof.
  return [...baseline.map(v => Object.fromEntries(fields.map(f => [f,v[f] ?? null]))), {...declaration}];
}
export function requireVariableView(view, pou) {
  const expected = pou ? `/Pous/${pou}/${pou}V` : null;
  if (!view || (expected ? view.toLowerCase() !== expected.toLowerCase()
      : !/^\/Hardware\/[^/]+\/[^/]+\/Global_Variables$/i.test(view)))
    throw new Error(`REFUSED: active worksheet '${view ?? ''}' is not the requested variable worksheet`);
}
export function retainPlan({workspace, project, pou, view, baseline, declaration}, now = Date.now()) {
  requireVariableView(view,pou);
  const expected = variableExpectation(baseline,declaration,pou);
  const token = randomUUID();
  for (const [id,p] of plans) if (now - p.created > ttl) plans.delete(id);
  plans.set(token, structuredClone({workspace,project,pou:pou ?? null,view,baseline,expected,created:now}));
  return {token, expected_count:expected.length, declaration:{...declaration},
    dialog_values:{name:declaration.name,type:declaration.type,usage:declaration.section,
      address:declaration.address ?? '',initial_value:declaration.initial_value ?? '',description:declaration.description ?? ''},
    action_performed:false, expires_in_seconds:ttl/1000};
}
export function lookupPlan(token, workspace, now = Date.now()) {
  const plan = plans.get(token);
  if (!plan || plan.workspace !== workspace || now - plan.created > ttl)
    throw new Error('REFUSED: declaration plan is missing, expired, or belongs to another workspace; do not reconstruct it from damaged read-back');
  return structuredClone(plan);
}
