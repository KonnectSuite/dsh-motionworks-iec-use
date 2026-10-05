import {isDeepStrictEqual} from 'node:util';

export function validateListingRange(args) {
  if(args.start!==undefined&&(!Number.isInteger(args.start)||args.start<1))
    throw Error('Graphical listing start must be a positive integer');
  if(args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>50))
    throw Error('Graphical listing limit must be an integer from 1 to 50');
}

// Compiler text is diagnostic evidence, never a replacement graphical body.
export async function graphicalListing(args, deps) {
  validateListingRange(args);
  if(args.baseline_saved!==true)throw Error('Reconcile/save edits before graphical listing');
  const before=await deps.saved();
  const pou=before.pous.find(p=>p.name===args.pou);
  if(!pou||!['LD','FBD'].includes(pou.language))throw Error('Exact saved LD/FBD POU required');
  if((await deps.status()).is_modified!==false)throw Error('Native project has unsaved or unknown edits');
  const build_started_ms=Date.now();
  const build=await deps.build();
  const after=await deps.saved();
  for(const key of ['pous','tasks','globals','program_sources','translation_files'])
    if(!isDeepStrictEqual(before[key],after[key]))throw Error('Saved source changed during Build; inspect before another action');
  if(build.is_compiled!==true||build.evidence_kind!=='observed_compile_transition')
    throw Error('Fresh Build completion is unverified; inspect compiler diagnostics');
  const status=await deps.status();
  if(status.is_compiled!==true||status.is_modified!==false)throw Error('Compiled saved state is not clean; reconcile and inspect before another action');
  const listing=await deps.read();
  if(!Array.isArray(listing.artifacts)||listing.artifacts.length!==4||listing.artifacts.some(a=>
    !Number.isFinite(a.modified_ms)||a.modified_ms<build_started_ms||a.modified_ms>Date.now()))
    throw Error('Compiler artifacts were not regenerated during this Build; cached listing freshness is unverified');
  if(!Array.isArray(listing.dependency_artifacts)||listing.dependency_artifacts.some(a=>
    !Number.isFinite(a.modified_ms)||a.modified_ms<build_started_ms||a.modified_ms>Date.now()))
    throw Error('Compiler FB dependencies were not regenerated during this Build; pin freshness is unverified');
  const final=await deps.saved(),finalStatus=await deps.status();
  for(const key of ['pous','tasks','globals','program_sources','translation_files'])
    if(!isDeepStrictEqual(after[key],final[key]))throw Error('Saved source changed during listing read');
  if(finalStatus.is_compiled!==true||finalStatus.is_modified!==false)throw Error('Native state changed during listing read');
  return {...listing,build,accepted:true,evidence_kind:'fresh-build-graphical-instruction-listing',
    source_baseline_unchanged:true,compiler_cache_freshness_verified:true,compiler_dependency_freshness_verified:true,build_started_ms,
    action_performed:true,code_edit_performed:false,layout_verified:false,wiring_verified:false,
    next_step:'Use compiler networks and symbols for diagnosis. Unknown tokens stay raw. Inspect the actual canvas to verify placement/wiring; this tool does not edit graphical code.'};
}
