import test from 'node:test';
import assert from 'node:assert/strict';
import {contrast,loadDesignTokens} from '../tools/design-tokens.mjs';
const design=await loadDesignTokens();
for(const [scheme,{tokens}] of Object.entries(design.schemes)){
  test(`${scheme}: every declared text/surface pair meets WCAG AA`,()=>{
    assert.ok(design.textPairs.length>0);
    for(const [fg,bg] of design.textPairs){const ratio=contrast(tokens[fg],tokens[bg]);assert.ok(ratio>=4.5,`${scheme} ${fg}/${bg}: ${ratio.toFixed(2)}:1`);}
    assert.equal(new Set(['up','down','error'].map(role=>tokens[role].toLowerCase())).size,3);
  });
}
