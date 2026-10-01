import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,writeFile,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {resolve,basename} from 'node:path';
import readline from 'node:readline';
import {existsSync,watch} from 'node:fs';
import {syncAssistant,source as assistantSource} from './assistant-sync.mjs';
const root=resolve(import.meta.dirname,'..'),bin='/opt/homebrew/opt/postgresql@15/bin';
if(process.env.NODE_ENV==='production')throw Error('Development launcher cannot run in production');
async function unusedPort(){const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
const stateDirectory=resolve(root,'.assistant-local');await mkdir(stateDirectory,{recursive:true});
let previous;
try{previous=JSON.parse(await readFile(resolve(stateDirectory,'state.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
if(previous?.launcherPid){try{process.kill(previous.launcherPid,0);throw Error('Recorded launcher is still running; use its restart-api command.');}catch(error){if(error.code!=='ESRCH')throw error;}}
let pgRoot;
if(previous?.pgRoot){
 const candidate=resolve(previous.pgRoot);
 if(!basename(candidate).startsWith('omnitech-assistant-dev-')||(await stat(candidate)).uid!==process.getuid()||(await readFile(resolve(candidate,'.assistant-owner'),'utf8'))!==root)throw Error('Recorded database is not owned by this launcher');
 pgRoot=candidate;
}else{
 pgRoot=await mkdtemp(`${tmpdir()}/omnitech-assistant-dev-`);
 execFileSync(`${bin}/initdb`,['-D',`${pgRoot}/data`,'--auth=trust','--username=fixture_owner','--no-locale'],{stdio:'pipe'});
 await writeFile(resolve(pgRoot,'.assistant-owner'),root);
}
const pgPort=await unusedPort();
const postgres=spawn(`${bin}/postgres`,['-D',`${pgRoot}/data`,'-h','127.0.0.1','-p',String(pgPort),'-k',pgRoot],{stdio:['ignore','pipe','pipe']});
let pgLog='';postgres.stderr.on('data',chunk=>{pgLog+=chunk;});
const deadline=Date.now()+10000;
for(;;){try{execFileSync(`${bin}/psql`,['-h','127.0.0.1','-p',String(pgPort),'-U','fixture_owner','postgres','-c','SELECT 1'],{stdio:'pipe'});break;}catch{if(Date.now()>deadline||postgres.exitCode!==null)throw Error(`Own PostgreSQL startup failed: ${pgLog}`);await new Promise(resolve=>setTimeout(resolve,20));}}
execFileSync(`${bin}/psql`,['-h','127.0.0.1','-p',String(pgPort),'-U','fixture_owner','postgres','-c',"DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='fixture_member') THEN CREATE ROLE fixture_member LOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$;"],{stdio:'pipe'});
// Make sure the local model is loaded with a context window big enough for the
// system prompt, history and a drafted answer (LM Studio defaults to 4-8k tokens).
// ASSISTANT_CONTEXT_TOKENS and ASSISTANT_MODEL_TTL_SECONDS override the defaults.
const lms=resolve(process.env.HOME??'','.lmstudio/bin/lms');
async function ensureLmStudioModel(id){
 const wanted=Number(process.env.ASSISTANT_CONTEXT_TOKENS??32768),ttl=String(process.env.ASSISTANT_MODEL_TTL_SECONDS??14400);
 try{
  const listing=await (await fetch('http://127.0.0.1:1234/api/v0/models',{signal:AbortSignal.timeout(3000)})).json();
  const loaded=listing.data?.find(item=>item.id===id&&item.state==='loaded');
  if(loaded?.loaded_context_length>=wanted)return;
  if(!existsSync(lms)){console.error(`LM Studio CLI not found at ${lms}; load ${id} with a context of at least ${wanted} tokens yourself.`);return;}
  console.log(JSON.stringify({loadingModel:id,contextTokens:wanted}));
  if(loaded)execFileSync(lms,['unload',id],{stdio:'pipe'});
  execFileSync(lms,['load',id,'--identifier',id,'--context-length',String(wanted),'--ttl',ttl,'-y'],{stdio:'pipe'});
 }catch(error){console.error(`Could not prepare ${id} in LM Studio: ${error.message}`);}
}
let mode=previous?.mode==='lm-studio'?'lm-studio':'fixture',modelId=mode==='lm-studio'?previous.modelId:'deterministic-local-fixture',api;
const state=()=>({pgRoot,pgPort,postgresPid:postgres.pid,apiPid:api?.pid,launcherPid:process.pid,frontendPid:frontend?.pid,mode,modelId,url:'http://127.0.0.1:5175/t/local/p/interview'});
async function saveState(){await writeFile(resolve(stateDirectory,'state.json'),JSON.stringify(state(),null,2));}
function startApi(){api=spawn(process.execPath,['apps/api/dist/main.js'],{cwd:root,env:{...process.env,NODE_ENV:'development',OMNI_ASSISTANT_LOCAL_DEV:'1',ASSISTANT_PG_PORT:String(pgPort),ASSISTANT_API_PORT:'8791',ASSISTANT_MODEL_MODE:mode,ASSISTANT_MODEL_ID:modelId},stdio:['ignore','pipe','pipe']});api.stdout.pipe(process.stdout);api.stderr.pipe(process.stderr);return api;}
if(mode==='lm-studio')await ensureLmStudioModel(modelId);
let frontend;
function startFrontend(force=false){frontend=spawn('pnpm',['--filter','@omnitech/assistant-frontend','dev','--port','5175',...(force?['--force']:[])],{cwd:root,env:{...process.env,ASSISTANT_API_ORIGIN:'http://127.0.0.1:8791'},stdio:['ignore','pipe','pipe']});frontend.stdout.pipe(process.stdout);frontend.stderr.pipe(process.stderr);return frontend;}
startApi();startFrontend();
await saveState();console.log(JSON.stringify(state()));
let stopping=false;
async function stopChild(child){if(!child||child.exitCode!==null)return;const exited=once(child,'exit');child.kill('SIGTERM');await exited;}
async function close(){if(stopping)return;stopping=true;await stopChild(frontend);await stopChild(api);await stopChild(postgres);process.exit(0);}
process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());
// Live omni-assistant: a change in its sources is built, copied into the
// installed @omni-assistant/* packages, and the affected process restarts.
// ASSISTANT_WATCH=0 turns this off; OMNI_ASSISTANT_SRC points at another checkout.
let syncing=false,resyncAgain=false,debounce,changing=false;
async function resync(){
 if(stopping)return;
 if(syncing){resyncAgain=true;return;}
 syncing=true;
 try{
  const changed=await syncAssistant();
  if(changed.length){
   console.log(JSON.stringify({assistantSynced:changed}));
   if(changed.some(name=>['contracts','providers','server','storage-postgres'].includes(name))){await stopChild(api);startApi();}
   if(changed.some(name=>['contracts','sdk','react'].includes(name))){await stopChild(frontend);startFrontend(true);}
   await saveState();
  }
 }catch(error){console.error('assistant sync failed:',error.message);}
 finally{syncing=false;if(resyncAgain){resyncAgain=false;void resync();}}
}
if(process.env.ASSISTANT_WATCH!=='0'&&existsSync(assistantSource)){
 for(const name of ['contracts','providers','server','storage-postgres','sdk','react'])
  watch(resolve(assistantSource,'packages',name,'src'),{recursive:true},(_event,file)=>{
   if(!file||!/\.(ts|tsx)$/.test(file)||/\.test\./.test(file))return;
   clearTimeout(debounce);debounce=setTimeout(()=>void resync(),600);
  });
 console.log(JSON.stringify({watchingAssistant:assistantSource}));
}
// This repository's own backend builds (`tsc -b` in the interview product, the API
// or the AI packages) restart the API too, so a rebuild is all a change needs.
let apiDebounce;
for(const dir of ['apps/api/dist','products/interview/dist/backend','packages/ai-provider-openai/dist','packages/ai-runtime/dist','packages/ai-contracts/dist']){
 const full=resolve(root,dir);if(!existsSync(full))continue;
 watch(full,{recursive:true},(_event,file)=>{
  if(!file||!/\.js$/.test(file))return;
  clearTimeout(apiDebounce);
  apiDebounce=setTimeout(()=>void (async()=>{if(stopping||syncing||changing)return;await stopChild(api);startApi();await saveState();console.log(JSON.stringify({apiRestarted:dir}));})(),1000);
 });
}
const lines=readline.createInterface({input:process.stdin});
lines.on('line',async line=>{if(changing)return;changing=true;try{
 if(line==='stop'){await close();return;}
 if(line.startsWith('model lm-studio ')){modelId=line.slice('model lm-studio '.length).trim();if(!modelId||modelId.length>256)throw Error('Valid observed model ID required');mode='lm-studio';await ensureLmStudioModel(modelId);}
 else if(line==='model fixture'){mode='fixture';modelId='deterministic-local-fixture';}
 else if(line==='sync'){await resync();return;}
 else if(line!=='restart-api'){console.log('Commands: restart-api | sync | model lm-studio MODEL_ID | model fixture | stop');return;}
 await stopChild(api);startApi();await saveState();console.log(JSON.stringify({restarted:true,...state()}));
 }catch(error){console.error(error.message);}finally{changing=false;}});
