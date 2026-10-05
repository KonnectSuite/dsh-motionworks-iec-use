import {createHash} from 'node:crypto';
const identifier=name=>typeof name==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,29}$/.test(name);
const sameType=(a,b)=>a.replace(/\s+/g,'').toUpperCase()===b.replace(/\s+/g,'').toUpperCase();
function expression(value){
  if(typeof value!=='string'||!value.trim()||/[^\x20-\x7e]/.test(value))throw new Error('Binding must be one printable ASCII expression');
  let quote=null;const stack=[];
  for(let n=0;n<value.length;n++){
    const c=value[n],pair=value.slice(n,n+2);
    if(quote){if(c==='$'){n++;continue;}if(c===quote){if(value[n+1]===quote)n++;else quote=null;}continue;}
    if(c==="'"||c==='"'){quote=c;continue;}
    if(['(*','*)','//'].includes(pair)||/[;{}]/.test(c)||c===','&&!stack.length)throw new Error('Binding contains a statement/comment or extra argument');
    if(c==='('||c==='[')stack.push(c);
    if(c===')'||c===']'){if(stack.pop()!==(c===')'?'(':'['))throw new Error('Unbalanced binding expression');}
  }
  if(quote||stack.length)throw new Error('Unbalanced binding expression');
  return value.trim();
}
function insertionPoint(body,offset){
  if(!Number.isInteger(offset)||offset<0||offset>body.length||offset!==0&&offset!==body.length&&body[offset-1]!=='\n')throw new Error('offset must be a line boundary in expected_body');
  let depth=0,quote=null,lineComment=false;
  for(let n=0;n<offset;n++){
    const c=body[n],pair=body.slice(n,n+2);
    if(lineComment){if(c==='\n')lineComment=false;continue;}
    if(depth){if(pair==='(*'){depth++;n++;}else if(pair==='*)'){depth--;n++;}continue;}
    if(quote){if(c==='$'){n++;continue;}if(c===quote){if(body[n+1]===quote)n++;else quote=null;}continue;}
    if(pair==='(*'){depth++;n++;}else if(pair==='//'){lineComment=true;n++;}else if(c==="'"||c==='"')quote=c;
  }
  if(depth||quote||lineComment)throw new Error('Insertion point is inside a comment/string');
}
export function fbInsertionPlan(args,block,read){
  if(args.baseline_saved!==true||!identifier(args.instance))throw new Error('Saved baseline and valid new instance name required');
  const compiled=block.evidence_kind==='fresh-bound-compiled-block-interface';
  if(block.kind!=='FUNCTION_BLOCK'||block.hidden||!identifier(block.name)||!['installed-declared-block-interface','fresh-bound-compiled-block-interface'].includes(block.evidence_kind))throw new Error('Requires a visible, declared function-block interface or verified current compiled contract');
  if(compiled&&(block.insertion_eligible!==true||block.project_compiler_freshness_verified!==true||block.compiler_library_binding_verified!==true||block.compiler_pin_types_verified!==true||block.compile_acceptance_only!==true||!Number.isFinite(block.verified_at_ms)||block.verified_at_ms>Date.now()||Date.now()-block.verified_at_ms>300000||! /^[a-f0-9]{64}$/.test(block.library_manifest_digest??'')||! /^[a-f0-9]{64}$/.test(block.source_baseline_digest??'')))throw new Error('Current compiled contract is incomplete or expired');
  if(block.insertion_eligible===false)throw new Error('Diagnostic compiled interface is not insertion eligible; freshness/source binding remains unverified');
  const hashMode=args.expected_body_sha256!==undefined;
  if(hashMode&&(args.expected_body!==undefined||! /^[a-f0-9]{64}$/.test(args.expected_body_sha256)))throw new Error('Supply either exact expected_body or readable expected_body_sha256');
  if(read.language!=='ST'||read.body_error||typeof read.body!=='string'||(hashMode?
    createHash('sha256').update(read.body).digest('hex')!==args.expected_body_sha256:read.body!==args.expected_body))throw new Error('Exact saved ST expected_body/readable hash required');
  if(/[^\x09\x0a\x0d\x20-\x7e]/.test(read.body))throw new Error('Native ST insertion currently requires printable ASCII source');
  if(read.variables.some(v=>v.name.toUpperCase()===args.instance.toUpperCase()))throw new Error('Instance already declared');
  const bindings=args.bindings??{},pins=new Map(block.pins.map(p=>[p.name.toUpperCase(),p]));
  const seen=new Set(),fields=[],outputs=[],warnings=[];
  for(const [name,input] of Object.entries(bindings)){
    const pin=pins.get(name.toUpperCase());
    if(!pin||seen.has(pin.name.toUpperCase()))throw new Error('Unknown or repeated pin: '+name);
    seen.add(pin.name.toUpperCase());const value=expression(input);
    const variable=read.variables.find(v=>v.name.toUpperCase()===value.toUpperCase());
    if(pin.direction==='output'||pin.direction==='in_out'){
      if(!identifier(value)||!variable)throw new Error('Output/in-out binding requires an existing direct variable: '+pin.name);
      if(pin.type.toUpperCase()!=='ANY'&&!sameType(variable.type,pin.type))throw new Error('Binding type mismatch: '+pin.name);
    }else if(pin.direction==='input'){
      if(variable&&pin.type.toUpperCase()!=='ANY'&&!sameType(variable.type,pin.type))throw new Error('Binding type mismatch: '+pin.name);
      if(!variable)warnings.push('Compiler must validate input expression type: '+pin.name);
    }else throw new Error('Unresolved pin direction: '+pin.name);
    // eCLR requires both sides of VAR_IN_OUT connected to the same variable.
    // Installed help: TheVARINOUTParameterIsNotConnectedToAVariable.htm and
    // TheVARINOUTParameterIsConnectedToDifferentVariables.htm.
    if(pin.direction==='output'||pin.direction==='in_out')outputs.push(value+' := '+args.instance+'.'+pin.name+';\r\n');
    if(pin.direction!=='output')fields.push(pin.name+' := '+value);
  }
  for(const pin of block.pins)if(pin.direction==='in_out'&&!seen.has(pin.name.toUpperCase()))throw new Error('Required in-out binding missing: '+pin.name);
  let offset=args.offset??read.body.length;
  if(args.before!==undefined){
    if(args.offset!==undefined||typeof args.before!=='string'||!args.before)throw new Error('Use either a nonempty before anchor or offset');
    offset=read.body.indexOf(args.before);
    if(offset<0||read.body.indexOf(args.before,offset+1)>=0)throw new Error('before anchor must match exactly once');
  }
  insertionPoint(read.body,offset);
  const call=args.instance+'('+fields.join(', ')+');\r\n'+outputs.join('');
  const prefix=read.body.slice(0,offset),suffix=read.body.slice(offset);
  return {declaration:{name:args.instance,type:block.name,section:'VAR',group:args.group??'Default',address:null,initial_value:null,description:null},
    code:prefix+(prefix&&!prefix.endsWith('\n')?'\r\n':'')+call+suffix,call,offset,warnings,interface:block};
}
