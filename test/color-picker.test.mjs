import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const css=readFileSync(new URL('../public/theme.css',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const bootstrap=readFileSync(new URL('../public/classic-theme.js',import.meta.url),'utf8');
const names=[...html.matchAll(/data-color-scheme-choice="([a-z]+)"/g)].map(m=>m[1]);
const declarations=text=>Object.fromEntries([...text.matchAll(/--([\w-]+)\s*:\s*(#[\da-f]{6})\s*;/gi)].map(m=>[m[1],m[2]]));
const blocks=[...css.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m=>({selector:m[1].trim(),values:declarations(m[2])}));
const luminance=hex=>hex.slice(1).match(/../g).map(n=>parseInt(n,16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};

test('Color Picker offers 22 distinct named schemes and a matching light/dark palette for each',()=>{
 assert.equal(names.length,22);assert.equal(new Set(names).size,22);
 for(const name of names)for(const mode of ['light','dark']){
  const selector=`:root[data-color-scheme="${name}"]`+(mode==='dark'?'[data-theme="dark"]':':not([data-theme="dark"])');
  const block=blocks.find(b=>b.selector===selector);assert.ok(block,`${name} ${mode}`);assert.equal(Object.keys(block.values).length,23);
 }
});

for(const name of names)for(const mode of ['light','dark'])test(`${name} ${mode}: text and focus colors remain readable on their intended surfaces`,()=>{
 let colors={};
 for(const block of blocks){
  if(block.selector.includes('data-holiday'))continue;
  if(!block.selector.includes(':root')||!Object.keys(block.values).length)continue;
  if(block.selector.includes('data-color-scheme')){
   if(!block.selector.includes(`data-color-scheme="${name}"`))continue;
   if(block.selector.includes(':not(')!==(mode==='light'))continue;
  }else if(block.selector.includes('data-theme=dark')&&!block.selector.includes(':not(')&&mode!=='dark')continue;
  if(block.selector.includes('#')||block.selector.includes(' .'))continue;
  colors={...colors,...block.values};
 }
 const pairs=[...['card','paper','surface-inset','surface-subtle'].flatMap(bg=>[['ink',bg],['muted',bg]]),['accent','accent-soft'],['accent','card'],['on-accent','accent-fill'],...['header','hero-debt','hero-savings'].flatMap(bg=>[['on-dark',bg],['on-dark-muted',bg],['on-dark-accent',bg]]),['on-dark-muted','on-dark-disabled'],['on-dark','on-dark-hover'],['ink-fixed','on-dark-accent'],['warn','warn-soft'],['cash-in','cash-in-bg'],['cash-out','cash-out-bg'],['amount-ink','amount-bg'],['amount-label','amount-bg'],['due-ink','due-bg'],['status','status-soft'],['on-paid','paid-fill'],['on-paid','paid-hover'],['on-danger','danger-fill']];
 for(const [fg,bg]of pairs){assert.ok(colors[fg]&&colors[bg],`${fg}/${bg} defined`);const ratio=contrast(colors[fg],colors[bg]);assert.ok(ratio>=4.5,`${name} ${mode}: ${fg}/${bg} contrast ${ratio.toFixed(2)}`);}
 for(const bg of ['card','paper','surface-subtle'])assert.ok(contrast(colors.accent,colors[bg])>=3,`${name} ${mode} focus on ${bg}`);
});

function boot(saved,blocked=false){
 const attrs={};
 const context={document:{documentElement:{setAttribute:(k,v)=>attrs[k]=v},addEventListener:()=>{}},localStorage:{getItem:key=>{if(blocked)throw Error('Storage blocked');return saved[key]||null;}}};
 vm.runInNewContext(bootstrap,context);return attrs;
}
test('saved schemes restore before paint without losing dark mode or holiday decorations',()=>{
 for(const name of names)assert.deepEqual(boot({'bearden:classic:theme':'dark','bearden:classic:holiday':'christmas','bearden:classic:color-scheme':name}),{'data-theme':'dark','data-holiday':'christmas','data-color-scheme':name});
});
test('invalid or blocked stored preferences fall back without preventing app startup',()=>{
 assert.deepEqual(boot({'bearden:classic:color-scheme':'invalid'}),{});
 assert.deepEqual(boot({},true),{});
});

test('seasonal themes restore and all gradient stops retain readable banner text',()=>{
 for(const name of ['christmas','halloween','thanksgiving','valentine','newyear']){
  assert.equal(boot({'bearden:classic:holiday':name})['data-holiday'],name);
  for(const mode of ['light','dark']){
   const selector=`:root[data-holiday="${name}"]:not([data-color-scheme])`+(mode==='dark'?'[data-theme="dark"]':':not([data-theme="dark"])');
   const colors=blocks.find(b=>b.selector===selector)?.values;assert.ok(colors);
   for(const bg of ['card','paper','surface-inset','surface-subtle'])for(const fg of ['ink','muted'])assert.ok(contrast(colors[fg],colors[bg])>=4.5,`${name} ${mode} ${fg}/${bg}`);
   for(const bg of ['gradient-start','gradient-end'])for(const fg of ['on-dark','on-dark-muted','on-dark-accent'])assert.ok(contrast(colors[fg],colors[bg])>=4.5,`${name} ${mode} ${fg}/${bg}`);
  }
 }
 for(const name of names){
  const stops=blocks.find(b=>b.selector===`:root[data-color-scheme="${name}"]`)?.values;if(!stops)continue;
  for(const mode of ['light','dark']){
   const colors=blocks.find(b=>b.selector===`:root[data-color-scheme="${name}"]`+(mode==='dark'?'[data-theme="dark"]':':not([data-theme="dark"])')).values;
   for(const bg of ['gradient-start','gradient-end'])for(const fg of ['on-dark','on-dark-muted','on-dark-accent'])assert.ok(contrast(colors[fg],stops[bg])>=4.5,`${name} ${mode} ${fg}/${bg}`);
  }
 }
});
