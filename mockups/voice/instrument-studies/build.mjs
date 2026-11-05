import { build } from '../../../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/lib/main.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const root=resolve('mockups/voice/instrument-studies');
const out=resolve(root,process.argv[2]||'bundle');
if(!out.startsWith(root+'/bundle')||existsSync(out))throw Error('Use a new bundle directory within this study');
const stubs=new Set(['voiceCall','kleioApi','BriefPanel','viewerContext','home-background','agent']);
const result=await build({entryPoints:[resolve(root,'entry.tsx')],bundle:true,outdir:out,format:'esm',splitting:true,jsx:'automatic',nodePaths:[resolve('node_modules/.pnpm/node_modules')],loader:{'.woff2':'file'},metafile:true,plugins:[{name:'isolated-snapshot',setup(b){
  b.onResolve({filter:/.*/},args=>{
    const name=args.path.split('/').at(-1);
    if(stubs.has(name)||args.path==='@tauri-apps/plugin-opener')return {path:resolve(root,'../before/fixtures.ts')};
    if(name==='VoiceOrb')return {path:resolve(root,'Orb.tsx')};
    if(args.path.includes('gg-app')||args.path.includes('/gg-framework/'))throw Error('Source boundary');
  });
}}]});
if(Object.keys(result.metafile.inputs).some(p=>p.startsWith('gg-app/')))throw Error('Unexpected production input');
writeFileSync(resolve(out,'inputs.json'),JSON.stringify(Object.keys(result.metafile.inputs),null,2),{flag:'wx'});
console.log('Built isolated baseline with orb replacement; no production source inputs.');
