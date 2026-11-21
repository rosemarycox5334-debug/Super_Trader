import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandlers} from '../lib/routes.js';
import {investDailyReviewHtml,investDailyReviewReport} from '../lib/daily-review-template.js';

test('original report links follow desktop preference without storing it in the report; explicit dark wins',async()=>{
  const origin='http://localhost:1234';
  const date='2025-07-16', record=investDailyReviewReport(date,{items:[]},[]), frozen=JSON.stringify(record);
  const svc={html:async(d,theme)=>{assert.equal(d,date);return investDailyReviewHtml(record,'en',null,{theme});}};
  const h=createHandlers({},()=>origin,undefined,undefined,undefined,undefined,undefined,undefined,undefined,svc);
  function request(path,body){return {url:path,method:body?'POST':'GET',headers:{host:'localhost:1234',origin},async *[Symbol.asyncIterator](){if(body)yield Buffer.from(JSON.stringify(body));}};}
  function response(){return {writeHead(code,headers){this.code=code;this.headers=headers;},end(text){this.text=text;}};}
  const url='/dsh-super-trader/daily-review/report/'+date;
  async function page(path,theme){const res=response();await h.dailyReviewReport(request(path),res);assert.equal(res.code,200);assert.match(res.text,new RegExp('class="theme-'+theme+'"'));assert.match(res.headers['Content-Security-Policy'],/sandbox/);assert.doesNotMatch(res.text,/<script\b/i);}
  await page(url,'auto');
  const res=response();await h.appearance(request('/dsh-super-trader/appearance',{preference:'light'}),res);assert.equal(res.code,200);
  await page(url,'light');await page(url+'?theme=dark','dark');await page(url+'?theme=invalid','light');assert.equal(JSON.stringify(record),frozen);
});
