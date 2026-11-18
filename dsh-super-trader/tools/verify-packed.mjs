// Real tarball portability smoke, never opens the user's research DB or credentials.
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';

const archive=resolve(process.argv[2] || '.out/dsh-super-trader-0.25.3.tgz');
const root=await mkdtemp(join(tmpdir(),'st packed 中文 '));
let manager;
try{
  const result=spawnSync('python',['-c','import sys,tarfile; tarfile.open(sys.argv[1]).extractall(sys.argv[2], filter="data")',archive,root],{stdio:'inherit'});
  assert.equal(result.status,0,'extract real tgz');
  const packageRoot=join(root,'package');
  const manifest=JSON.parse(await readFile(join(packageRoot,'package.json'),'utf8'));
  assert.equal(manifest.version,'0.25.3');
  const server=createServer();
  await new Promise((yes,no)=>server.once('error',no).listen(0,'127.0.0.1',yes));
  const port=server.address().port;await new Promise(yes=>server.close(yes));
  assert.ok(![8000,8711].includes(port));
  const env={};
  for(const key of ['SystemRoot','WINDIR','PATH','TEMP','TMP','HOME','USERPROFILE','LOCALAPPDATA','APPDATA'])if(process.env[key])env[key]=process.env[key];
  Object.assign(env,{ST_BASE_URL:'http://127.0.0.1:'+port,ST_STATE_DIR:join(root,'user state'),PYTHONDONTWRITEBYTECODE:'1'});
  const {BackendManager}=await import(pathToFileURL(join(packageRoot,'lib/backend-manager.js')).href);
  manager=new BackendManager({env,startTimeoutMs:40000,stopTimeoutMs:3000});
  assert.equal(manager.portable,true,'must not find or reuse source repo');
  const start=await manager.ensureBackend();assert.equal(start.phase,'running',JSON.stringify(start));
  const health=await manager.request('GET','/api/status');
  assert.equal(health.capabilities.research_data_available,false);
  assert.equal(health.capabilities.market_configured,false);
  assert.equal(health.model.configured,false);
  assert.deepEqual(await manager.request('GET','/api/symbols/search?q=601088'),{items:[]});
  await assert.rejects(manager.request('GET','/api/quant/probability?code=601088&horizon=10'),e=>e.status===503);
  await assert.rejects(manager.request('GET','/api/market/history?code=601088&limit=5'),e=>e.status===503 && e.body.code==='market_not_configured');
  assert.ok((await manager.request('GET','/api/experts')).items.length);
  assert.ok((await stat(join(root,'user state/state.db'))).isFile());
  assert.equal((await manager.retryBackend()).pid,start.pid,'healthy explicit retry must not restart');
  await manager.dispose();assert.equal(manager.getState().pid,null);
  await assert.rejects(fetch('http://127.0.0.1:'+port+'/api/status',{signal:AbortSignal.timeout(1500)}));
  console.log(JSON.stringify({archive,version:manifest.version,independentPort:port,portable:true,noCredentials:true,controlledNoData:true,externalState:true,ownedProcessReaped:true}));
}finally{
  await manager?.dispose();
  const resolved=resolve(root);
  if(!resolved.startsWith(resolve(tmpdir())+sep+'st packed 中文 '))throw new Error('Refuse unexpected cleanup target');
  await rm(resolved,{recursive:true,force:true});
}
