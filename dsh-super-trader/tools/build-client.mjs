import {readFile,writeFile} from 'node:fs/promises';
import {loadDesignTokens,panelTokenCss,reportTokenCss,hostTokenPairs} from './design-tokens.mjs';
const root=new URL('../',import.meta.url);
const files=['tools/client-source.js','lib/pages-bundle.js','assets/styles.css','tools/cockpit-source.js','assets/cockpit.css','tools/ai-bridge-source.js','tools/invest-source.js','assets/invest.css','tools/daily-review-source.js'];
const [source,pages,css,cockpit,cockpitCss,bridge,invest,investCss,dailyReview]=await Promise.all(files.map(path=>readFile(new URL(path,root),'utf8')));
const design=await loadDesignTokens(root);
// Source inputs are declarations only, inlined once. Syntax-check the built client, not templates.
for(const [name,text] of [['pages',pages],['cockpit',cockpit],['bridge',bridge],['dailyReview',dailyReview],['invest',invest]]) {
  if(/^\s*import\s/m.test(text))throw new Error(name+' must be self-contained');
}
const inline=pages.replace(/^export\s+(?=(?:async\s+)?function|const|class)/gm,'');
let output=source;
// Token CSS comes first so every later rule can rely on the --st-* vocabulary.
const bundledCss=[panelTokenCss(design),css,cockpitCss,investCss].join('\n');
for(const [marker,text] of [['/*__PAGES__*/',inline],['/*__COCKPIT__*/',cockpit],['/*__BRIDGE__*/',bridge],['/*__INVEST__*/',invest],['/*__CSS__*/',JSON.stringify(bundledCss)],['/*__HOST_TOKENS__*/ null',JSON.stringify(hostTokenPairs(design))]]) {
  if(output.split(marker).length!==2)throw new Error('Expected one build marker: '+marker);
  output=output.replace(marker,()=>text);
}
const reportMarker="/*__REPORT_TOKEN_CSS__*/ ''";
if(dailyReview.split(reportMarker).length!==2)throw new Error('Expected one build marker: '+reportMarker);
const template=dailyReview.replace(reportMarker,()=>JSON.stringify(reportTokenCss(design)));
await writeFile(new URL('lib/client.js',root),output);
await writeFile(new URL('lib/daily-review-template.js',root),template+'\nexport {investDailyReviewReport, investDailyReviewHtml};\n');
console.log('Built lib/client.js: seven native entries, shared research context, expert jobs, factor prediction, preserved legacy pages and the two-scheme design tokens.');
