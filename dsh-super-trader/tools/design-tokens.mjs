// Build-time derivations from assets/design-tokens.json. No runtime dependency:
// the outputs are inlined into lib/client.js and lib/daily-review-template.js.
import {readFile} from 'node:fs/promises';

export async function loadDesignTokens(root=new URL('../',import.meta.url)) {
  return JSON.parse(await readFile(new URL('assets/design-tokens.json',root),'utf8'));
}

const decl=(tokens,keys=Object.keys(tokens))=>keys.map(key=>`--st-${key}:${tokens[key]}`).join(';');

// Panel scope: both palettes are always defined, the panel root chooses with data-st-theme.
export function panelTokenCss(design) {
  return Object.entries(design.schemes).map(([scheme,def])=>`.st-native-panel[data-st-theme="${scheme}"],.st-theme-scope[data-st-theme="${scheme}"]{${decl(def.tokens)};color-scheme:${scheme}}`).join('\n');
}

// Standalone daily report. Attribute on <body>: theme-light | theme-dark | theme-auto.
// Auto follows prefers-color-scheme; print is always the light palette.
export function reportTokenCss(design) {
  const light=decl(design.schemes.light.tokens),dark=decl(design.schemes.dark.tokens);
  return [
    `body{${light}}`,
    `body.theme-dark{${dark}}`,
    `@media (prefers-color-scheme:dark){body.theme-auto{${dark}}}`,
    `@media print{body,body.theme-dark,body.theme-auto{${light}}}`
  ].join('\n');
}

// Host overlay for ctx.theme.overrideTokens: token -> {light,dark}, plus the shared --st-* pairs
// so shell-level surfaces (settings row) can use the same vocabulary.
export function hostTokenPairs(design) {
  const out={};
  for(const [name,key] of Object.entries(design.host)){
    out[name]={light:design.schemes.light.tokens[key],dark:design.schemes.dark.tokens[key]};
    if(!out[name].light||!out[name].dark)throw new Error('design token missing for '+name+' -> '+key);
  }
  // The same vocabulary, shell-wide: settings rows and slots outside a panel can use var(--st-*).
  for(const key of Object.keys(design.schemes.light.tokens)){
    const light=design.schemes.light.tokens[key],dark=design.schemes.dark.tokens[key];
    if(typeof light!=='string'||typeof dark!=='string')throw new Error('design token '+key+' needs light and dark values');
    out['--st-'+key]={light,dark};
  }
  return out;
}

const channel=value=>{const v=value/255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4;};
export function luminance(hex) {
  const m=/^#([0-9a-f]{6})$/i.exec(hex);
  if(!m)throw new Error('not a #rrggbb color: '+hex);
  const n=parseInt(m[1],16);
  return 0.2126*channel(n>>16&255)+0.7152*channel(n>>8&255)+0.0722*channel(n&255);
}
export function contrast(a,b) {
  const [hi,lo]=[luminance(a),luminance(b)].sort((x,y)=>y-x);
  return (hi+0.05)/(lo+0.05);
}
