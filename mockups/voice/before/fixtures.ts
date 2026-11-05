import { useSyncExternalStore } from 'react';
const listeners = new Set<() => void>();
const base = { phase:'listening', lines:[], muted:false, error:null, shown:null };
let state:any = base;
const emit = (patch:any) => { state={...state,...patch}; for(const fn of listeners) fn(); };
export const useCall = () => useSyncExternalStore(fn => {listeners.add(fn);return () => listeners.delete(fn);},()=>state);
export const callLevels = () => ({in:null,out:null});
export const partialLines = () => [];
export const setMuted = (muted:boolean) => emit({muted});
export const closeShown = () => emit({shown:null});
export const endCall = () => emit({phase:'ended',shown:null});
export const resetCall = () => emit({...base,phase:'idle'});
export const startCall = async () => emit({...base});
export const getVoiceStatus = async () => ({ready:true});
export const briefMe = async () => {};
export const useHomeBackgroundEnabled = () => true;
const viewer = {request:null,view:()=>{},close:()=>{}};
export const useFileViewer = () => viewer;
export const openUrl = async () => {};
export const openProjectPath = async () => {};
export const sendPrompt = async () => {};
export class KleioApiError extends Error {status=0;detail='';}
const prompt = 'What should I focus on next?';
const reply = 'The review is ready. We can walk through the changes together, then decide what to do next.';
export const scenarios:Record<string,any> = {
  connecting:{phase:'connecting'},listening:{},thinking:{phase:'thinking',lines:[{who:'you',text:prompt}]},
  speaking:{phase:'speaking',lines:[{who:'kleio',text:reply}]},muted:{muted:true},ended:{phase:'ended',lines:[{who:'kleio',text:'Talk soon.'}]},
  'long-caption':{phase:'speaking',lines:[{who:'kleio',text:(reply+' ').repeat(12)}]},
  denied:{phase:'ended',error:'Kleio needs your microphone. Allow it in your system settings, then try again.'},
  'no-key':{phase:'ended',error:"Kleio's voice isn't set up yet. Add an OpenAI key in Settings, under Kleio's voice."},
  'bad-key':{phase:'ended',error:"OpenAI didn't accept the key on your host. Check it in Settings."},
  'no-credit':{phase:'ended',error:'Your OpenAI account is out of credit. Add some on platform.openai.com, then try again.'},
  unreachable:{phase:'ended',error:"Your host couldn't reach OpenAI. Check its internet connection."},
  forbidden:{phase:'ended',error:"This device can't start a conversation."},
  offline:{phase:'ended',error:"I couldn't reach your host. Check it's on and connected."},
  outdated:{phase:'ended',error:'Your host needs the latest Kleio before you can talk to her.'},
  failed:{phase:'ended',error:'Something went wrong starting the conversation.'},
};
for(const kind of ['text','image','pdf','web','capturing','failed']) scenarios['show-'+kind] = {shown:{key:1,title:'Local sample',whose:'Simulated call',url:kind==='web'?'https://example.com':null,problem:null,file:null,show:{id:kind,kind:['capturing','failed'].includes(kind)?'web':kind,state:['capturing','failed'].includes(kind)?kind:'ready',name:'sample.md',format:'markdown',pages:2,totalPages:2,host:'example.com',detail:kind==='failed'?"Kleio couldn't show that.":undefined}}};
export function selectScenario(name:string){emit({...base,...(scenarios[name]??{})});}
export async function getShowPart(_id:string,part:string){
  if(part==='text')return new TextEncoder().encode('# Local sample\n\nThis document is a local fixture, not a host response.\n\n- Review the changes\n- Decide the next step');
  const canvas=document.createElement('canvas');canvas.width=720;canvas.height=900;
  const ctx=canvas.getContext('2d')!;ctx.fillStyle='#f5eee3';ctx.fillRect(0,0,720,900);ctx.fillStyle='#251c1c';ctx.font='32px sans-serif';ctx.fillText('Local visual fixture',60,100);ctx.font='20px sans-serif';ctx.fillText('No document, image or web page was fetched.',60,150);
  const blob=await new Promise<Blob>(resolve=>canvas.toBlob(b=>resolve(b!),'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
