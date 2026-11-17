import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const files=['tools/client-source.js','lib/pages-bundle.js','assets/styles.css','tools/cockpit-source.js','assets/cockpit.css','tools/ai-bridge-source.js','tools/invest-source.js','assets/invest.css'];
const [source,pages,css,cockpit,cockpitCss,bridge,invest,investCss]=await Promise.all(files.map(path=>readFile(new URL(path,root),'utf8')));
// Source inputs are declarations only, inlined once. Syntax-check the built client, not templates.
for(const [name,text] of [['pages',pages],['cockpit',cockpit],['bridge',bridge],['invest',invest]]) {
  if(/^\s*import\s/m.test(text))throw new Error(name+' must be self-contained');
}
const inline=pages.replace(/^export\s+(?=(?:async\s+)?function|const|class)/gm,'');
let output=source;
for(const [marker,text] of [['/*__PAGES__*/',inline],['/*__COCKPIT__*/',cockpit],['/*__BRIDGE__*/',bridge],['/*__INVEST__*/',invest],['/*__CSS__*/',JSON.stringify(css+'\n'+cockpitCss+'\n'+investCss)]]) {
  if(output.split(marker).length!==2)throw new Error('Expected one build marker: '+marker);
  output=output.replace(marker,()=>text);
}
await writeFile(new URL('lib/client.js',root),output);
console.log('Built lib/client.js: seven native entries, shared research context, expert jobs, factor prediction and preserved legacy pages.');
