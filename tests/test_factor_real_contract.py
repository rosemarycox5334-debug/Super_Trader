"""Contract regression: generated backend JSON goes through actual Client source."""
import json,os,shutil,subprocess,time
from pathlib import Path
from types import SimpleNamespace
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from backend.app import create_app
from backend.db import Database
from backend.jobs import JobManager
from backend.factors.service import FactorService
from backend.factors.research import FactorResearchService


def test_actual_backend_to_actual_client_parser(tmp_path):
    node=shutil.which('node')
    if not node:
        candidate=Path(os.environ.get('USERPROFILE',''))/'.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node.exe'
        node=str(candidate) if candidate.is_file() else None
    if not node:pytest.skip('Node is needed for the actual Client parser')
    root=tmp_path/'bars'
    for category,code in [('个股','601088'),('ETF','510300'),('指数','000001')]:
        folder=root/category;folder.mkdir(parents=True)
        close=100+np.sin(np.arange(150)*.1)*10
        pd.DataFrame({'date':pd.bdate_range('2020-01-01',periods=150),'open':close,'close':close,'high':close+1,'low':close-1,'volume':1000}).to_csv(folder/f'{code}_test.csv',index=False)
    class Model:
        settings=SimpleNamespace(configured=True,timeout=30)
        def chat(self,messages,**kw):
            kw['before_round']()
            tools=kw['tool_impls']
            r=tools['write_rule']({'name':'contract generated source','source':'def factor(df):\n    return df["close"] / F.rolling_mean(df["close"], 5) - 1\n'})
            tools['evaluate_rule']({'rule_id':r['rule_id']})
            tools['finish']({})
            return {'content':'done'}
    db=Database(tmp_path/'state.db');jobs=JobManager(db)
    factors=FactorService(root);research=FactorResearchService(factors,Model(),jobs,db)
    try:
        job=research.submit(scope='all',workers=2,max_trials=1)
        until=time.monotonic()+30
        while job['status'] in ('queued','running') and time.monotonic()<until:
            time.sleep(.05);job=jobs.get(job['id'])
        assert job['status']=='done',job
        client=TestClient(create_app(SimpleNamespace(factors=factors,factor_research=research,db=db,jobs=jobs)))
        def get(url):
            r=client.get(url);assert r.status_code==200,(url,r.text);return r.json()
        payload={'stock':get('/api/factors/stock?code=601088'),'etf':get('/api/factors/stock?code=510300&category=ETF'),'universe':get('/api/factors/universe'),'jobs':get('/api/jobs?limit=10'),'results':get('/api/factors/results?job_id='+job['id']+'&limit=50'),'backtest':get('/api/factors/backtest?code=601088&rule_id='+research.current_report('601088')['rule']['id'])}
        p=tmp_path/'payload.json';p.write_text(json.dumps(payload),encoding='utf-8')
        package=Path(__file__).resolve().parents[1]/'dsh-super-trader'
        js=tmp_path/'client-contract.mjs'
        js.write_text('''import fs from 'node:fs';import vm from 'node:vm';
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),root=process.argv[3];
const source=fs.readFileSync(root+'/tools/cockpit-source.js','utf8')+'\\n'+fs.readFileSync(root+'/tools/invest-source.js','utf8');
const api=vm.runInNewContext(source+'\\n({investFactorReport,createInvestStore})',{AbortSignal,AbortController,URLSearchParams,setTimeout,clearTimeout});
for(const key of ['stock','etf','backtest'])api.investFactorReport(p[key],p[key].target,key==='backtest'?p[key].rule.id:undefined);
const store=api.createInvestStore({autoConnect:false,fetch:async(url)=>({ok:true,status:200,json:async()=>url.includes('/factors/universe')?p.universe:url.includes('/api/jobs?')?p.jobs:p.results})});
await store.ensureFactors();await new Promise(r=>setImmediate(r));await store.loadFactorResults();
if(store.getSnapshot().factorUniverse.phase!=='ready')throw Error(JSON.stringify(store.getSnapshot().factorUniverse));
if(store.getSnapshot().factorResults.phase!=='ready')throw Error(JSON.stringify(store.getSnapshot().factorResults));
if(store.getSnapshot().factorResults.data.items.length!==3)throw Error('not all three actual targets');store.dispose();console.log('PASS backend actual JSON -> actual Client parser and job restore');
''',encoding='utf-8')
        run=subprocess.run([node,str(js),str(p),str(package)],capture_output=True,text=True,timeout=15)
        assert run.returncode==0,run.stdout+run.stderr
    finally:jobs._pool.shutdown(wait=True,cancel_futures=True);db.close()
