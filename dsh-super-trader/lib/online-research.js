// Evidence comes only from committed Host tool events, never from model-written
// claims, links pasted in the prompt, or webpage text pretending to be a receipt.
export function publicSourceUrl(value) {
  try {
    const url=new URL(value);
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password)return null;
    const host=url.hostname.toLowerCase().replace(/\.$/,'');
    if(/^\[(?:f[cd]|fe[89ab]|::ffff:)/.test(host))return null;
    if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host==='[::1]'||/^(?:127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host))return null;
    url.hash='';return url.href;
  }catch{return null;}
}
function readableContent(message) {
  const text=(message?.content??[]).filter(b=>b.type==='text'&&typeof b.text==='string').map(b=>b.text).join('\n');
  const body=text.replace(/^Fetched[^\n]*\n+/i,'').replace(/^External web content follows\.[^\n]*\n+/i,'').trim();
  return !!body&&!/^(?:access denied\b|just a moment\b|checking your browser\b|captcha\b|请先登录|需要登录后|人机验证|访问被拒绝|暂时无法访问)/i.test(body);
}
export function onlineResearchEvidence(events,systemPrompt) {
  const calls=new Map(),searchUrls=new Set(),readUrls=new Set();
  let searches=0,reads=0;
  for(const event of events??[]){
    const data=event.data;
    if(event.type==='tool/call'||event.type==='tool/ptc-dispatch-start'){
      const id=event.type==='tool/call'?data?.callId:(data?.rootCallId&&data?.subCallId?JSON.stringify([data.rootCallId,data.subCallId]):null);
      if(id&&['web_search','web_fetch'].includes(data.name))calls.set(id,{name:data.name,seq:event.seq,parentCallId:data.parentCallId});
      continue;
    }
    const ptc=event.type==='tool/ptc-dispatch';
    if(event.type!=='tool/result'&&!ptc)continue;
    const message=ptc?{toolCallId:JSON.stringify([data?.rootCallId,data?.subCallId]),isError:data?.isError,content:data?.content}:data?.message;
    const call=calls.get(message?.toolCallId);
    if(!call||data.error||message?.isError===true||!(event.seq>call.seq))continue;
    if(ptc&&(data.name!==call.name||data.parentCallId!==call.parentCallId))continue;
    if(message.source?.callId&&message.source.callId!==message.toolCallId)continue;
    if(Array.isArray(event.sourceEventSeqs)&&!event.sourceEventSeqs.includes(call.seq))continue;
    const meta=data.meta;
    if(call.name==='web_search'){
      const sources=Array.isArray(meta?.sources)?meta.sources:[];
      const urls=sources.map(s=>publicSourceUrl(s?.url)).filter(Boolean);
      if(urls.length){searches++;for(const url of urls)searchUrls.add(url);}
    }else if(call.name==='web_fetch'&&Number.isInteger(meta?.statusCode)&&meta.statusCode>=200&&meta.statusCode<300){
      const url=publicSourceUrl(meta.url);
      // A successful HTTP fetch still needs returned content, not just a URL.
      if(url&&readableContent(message)){reads++;readUrls.add(url);}
    }
  }
  const quoted=(typeof systemPrompt==='string'?systemPrompt:'').match(/https?:\/\/[^\s<>"'`\[\]()，。；、！？）】]+/g)??[];
  const citations=[...new Set(quoted.map(publicSourceUrl).filter(Boolean))];
  const citedReads=citations.filter(url=>readUrls.has(url));
  return {searches,reads,searchUrls:[...searchUrls],readUrls:[...readUrls],citedReads,
    verified:searches>0&&reads>0&&citedReads.length>0};
}
