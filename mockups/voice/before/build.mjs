import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { build } from '../../../gg-app/node_modules/esbuild/lib/main.js';
const root = resolve('mockups/voice/before');
const sources = ['kleio/VoiceMode.tsx','kleio/VoiceOrb.tsx','kleio/VoiceGuide.tsx','kleio/ShowPanel.tsx','kleio/ShowViews.tsx','kleio/kleioWaves.ts','kleio/flip.ts','kleio/safeUrl.ts','HomeDither.tsx','Dither.tsx','useWindowFocused.ts','dialog-focus.ts','Modal.tsx','theme.ts','view-transition.ts','modal-embed.tsx','platform.ts','Markdown.tsx','markdown-prompt.ts','collapse.ts','rehype-animate-words.ts','animated-height.ts','App.css','glass.css','session-help.css','kleio/kleio-theme.css','kleio/assets/fonts/TejaratchiExLefti.woff2'];
const hashes = {};
for (const file of sources) {
  const path = 'gg-app/src/' + file;
  const bytes = readFileSync(path);
  hashes[path] = createHash('sha256').update(bytes).digest('hex');
  const dest = resolve(root, 'source', file);
  if (existsSync(dest)) throw Error('Refusing to overwrite baseline source: ' + dest);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, bytes, { flag: 'wx' });
}
for (const path of ['gg-app/src/kleio/voiceCall.ts','gg-app/src/kleio/voiceTools.ts','mockups/unified/index.html','mockups/unified/home.html','mockups/unified/preview.js','mockups/unified/preview.css']) hashes[path] = createHash('sha256').update(readFileSync(path)).digest('hex');
writeFileSync(resolve(root,'source-hashes.json'), JSON.stringify(hashes,null,2), {flag:'wx'});
const stubs = new Set(['voiceCall','kleioApi','BriefPanel','viewerContext','home-background','agent']);
await build({ entryPoints: [resolve(root,'entry.tsx')], bundle:true, outdir:resolve(root,'bundle'), format:'esm', splitting:true, jsx:'automatic', nodePaths:[resolve('gg-app/node_modules')], loader:{'.woff2':'file'}, metafile:true, plugins:[{name:'inert-boundaries',setup(b){
  b.onResolve({filter:/.*/}, args => {
    const name = args.path.split('/').at(-1);
    if (stubs.has(name) || args.path === '@tauri-apps/plugin-opener') return {path:resolve(root,'fixtures.ts')};
    if (args.path.startsWith('.') && args.importer.includes('/source/')) {
      const base = resolve(args.resolveDir,args.path);
      if (![base,base+'.ts',base+'.tsx'].some(existsSync)) throw Error('Unapproved visual dependency: '+args.path);
    }
  });
}}]}).then(result => writeFileSync(resolve(root,'bundle-inputs.json'), JSON.stringify(Object.keys(result.metafile.inputs),null,2),{flag:'wx'}));
console.log('Isolated baseline built; source files copied byte-for-byte.');
