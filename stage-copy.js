import {resolve,sep} from 'node:path';

// State is observed without activating or starting an IDE. A timeout is unknown,
// not permission to overwrite a possibly open project's backing files.
export function assertStageClosed(targetDirectory,state,status){
  if(typeof state?.ide_running!=='boolean')throw Error('REFUSED: IDE running state is unknown; preserve the stage');
  if(state.blocked===true||state.verifier_running===true)throw Error('REFUSED: IDE startup/dialog state is unresolved; preserve the stage');
  if(!state.ide_running)return;
  if(typeof status?.is_project_open!=='boolean')throw Error('REFUSED: active IDE project is unknown; preserve the stage');
  if(!status.is_project_open)return;
  if(typeof status.active_project!=='string'||!status.active_project)throw Error('REFUSED: active IDE project path is unknown; preserve the stage');
  const target=resolve(targetDirectory).toLowerCase(),active=resolve(status.active_project).toLowerCase();
  if(active===target||active===target+'.mwt'||active.startsWith(target+sep))
    throw Error('REFUSED: this staged project is open in the IDE. Preserve its edits and use the approved exact-project save/close workflow before staging again');
}
