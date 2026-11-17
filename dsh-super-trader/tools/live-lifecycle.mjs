// Explicit opt-in integration test: real Python backend, isolated temporary DB, no model calls.
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,basename,dirname} from 'node:path';
import assert from 'node:assert/strict';
import {BackendManager} from '../lib/backend-manager.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
if(process.argv.includes('--worker')){
  const manager=new BackendManager();
  const state=await manager.ensureBackend();
  process.send({phase:state.phase,pid:state.pid,baseUrl:state.baseUrl,lastError:state.lastError});
  // Deliberate unclean exit: no manager.dispose. Its supervisor must observe stdin EOF.
  if(process.env.ST_TEST_FORCE_KILL==='1' && state.phase==='running')setInterval(()=>{},1000);
  else process.exit(state.phase==='running'?0:1);
}else{
  const parent=resolve(tmpdir());
  const owned=await mkdtemp(join(parent,'st-plugin-lifecycle-'));
  assert.equal(dirname(resolve(owned)),parent);
  assert.ok(basename(owned).startsWith('st-plugin-lifecycle-'));
  console.log('Owned test directory:',owned);
  const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');
  const port=server.address().port;await new Promise(r=>server.close(r));
  const baseUrl='http://127.0.0.1:'+port;
  let worker;
  try{
    worker=fork(new URL(import.meta.url),['--worker'],{env:{...process.env,ST_BASE_URL:baseUrl,ST_STATE_DB:join(owned,'state.db'),ST_TEST_FORCE_KILL:process.argv.includes('--kill-worker')?'1':'0'},stdio:['ignore','pipe','pipe','ipc']});
    let log='';worker.stderr.on('data',b=>{log=(log+b).slice(-4000);});
    const exited=once(worker,'exit');
    let timer;
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('worker startup timeout '+log)),25000);});
    let state;try{state=await Promise.race([once(worker,'message').then(([m])=>m),timeout]);}finally{clearTimeout(timer);}
    assert.equal(state.phase,'running',JSON.stringify(state));
    console.log('Real backend started:',JSON.stringify(state));
    if(process.argv.includes('--kill-worker'))worker.kill('SIGKILL');
    const [code,exitSignal]=await exited;
    if(!process.argv.includes('--kill-worker'))assert.equal(code,0);
    console.log('Node worker exit:',code,exitSignal);
    const deadline=Date.now()+8000;let alive=true;
    while(Date.now()<deadline){
      try{await fetch(baseUrl+'/api/status',{signal:AbortSignal.timeout(500)});}catch{alive=false;break;}
      await sleep(150);
    }
    assert.equal(alive,false,'Backend must stop after owning Node worker exits without disposal');
    console.log('PASS: parent EOF stopped owned Python backend without explicit dispose.');
  }finally{
    if(worker && worker.exitCode===null)worker.kill();
    // Resolved, validated mkdtemp path above; never touches the user's persistent backend DB.
    await rm(owned,{recursive:true,force:true,maxRetries:10,retryDelay:200});
  }
}
