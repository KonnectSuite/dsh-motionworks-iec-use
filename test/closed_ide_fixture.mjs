import {cpSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

// Tests exercise temporary project files, never the user's live IDE. Only a
// copied bridge is changed; production guards are tested separately with real
// guard functions and injected open/unknown/modal states in stage_copy.mjs.
export function mockClosedIdeBridge(directory){
 const path=join(directory,'mw_bridge.ps1'),source=readFileSync(path,'utf8');
 const marker='Log "bridge started pid=';
 if(source.split(marker).length!==2)throw Error('Cannot isolate fixture bridge');
 writeFileSync(path,source.replace(marker,
  'function Get-IdeState { return [ordered]@{ide_running=$false;blocked=$false;verifier_running=$false} }\n'+marker));
}
export function copyClosedIdePlugin(repo,destination){
 mkdirSync(destination,{recursive:true});
 for(const file of readdirSync(repo).filter(f=>f.endsWith('.js')||['package.json','SKILL.md'].includes(f)))
  cpSync(join(repo,file),join(destination,file));
 for(const folder of ['code','bridge','docs'])cpSync(join(repo,folder),join(destination,folder),{recursive:true});
 mockClosedIdeBridge(join(destination,'bridge'));
}
