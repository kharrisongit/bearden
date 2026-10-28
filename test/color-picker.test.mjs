import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const css=readFileSync(new URL('../public/theme.css',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const bootstrap=readFileSync(new URL('../public/classic-theme.js',import.meta.url),'utf8');
const names=[...html.matchAll(/data-color-scheme-choice="([a-z]+)"/g)].map(m=>m[1]);
const declarations=text=>Object.fromEntries([...text.matchAll(/--([\w-]+)\s*:\s*(#[\da-f]{6})\s*;/gi)].map(m=>[m[1],m[2]]));
const blocks=[...css.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m=>({selector:m[1].trim(),values:declarations(m[2]),gradient:m[2].match(/--theme-gradient\s*:\s*([^;]+)/)?.[1]}));
const luminance=hex=>hex.slice(1).match(/../g).map(n=>parseInt(n,16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
const requiredPalette=['ink','ink-fixed','muted','paper','card','line','accent','accent-fill','on-accent','accent-soft','accent-line','surface-inset','surface-subtle','amount-line','header','hero-debt','hero-savings','on-dark','on-dark-muted','on-dark-accent','on-dark-line','on-dark-hover','on-dark-disabled'];

function assertGradientContrast(colors,gradient,label){
 const stops=[...gradient.matchAll(/#[\da-f]{6}(?![\da-f])/gi)].map(m=>m[0]);
 assert.ok(stops.length>=2,`${label}: gradient has at least two color stops`);
 // Sample every interval, including its endpoints and midpoint, rather than
 // assuming that the first and last stop describe the whole gradient.
 for(let i=1;i<stops.length;i++)for(let step=0;step<=20;step++){
  const rgb=hex=>hex.slice(1).match(/../g).map(n=>parseInt(n,16));
  const from=rgb(stops[i-1]),to=rgb(stops[i]),fraction=step/20;
  const background='#'+from.map((n,index)=>Math.round(n+(to[index]-n)*fraction).toString(16).padStart(2,'0')).join('');
  for(const fg of ['on-dark','on-dark-muted','on-dark-accent']){
   const ratio=contrast(colors[fg],background);
   assert.ok(ratio>=4.5,`${label}: ${fg} gradient interval ${i} at ${step*5}% contrast ${ratio.toFixed(2)}`);
  }
 }
}

test('Color Picker offers 32 distinct named schemes and a matching light/dark palette for each',()=>{
 assert.equal(names.length,32);assert.equal(new Set(names).size,32);
 for(const name of names)for(const mode of ['light','dark']){
  const selector=`:root[data-color-scheme="${name}"]`+(mode==='dark'?'[data-theme="dark"]':':not([data-theme="dark"])');
  const block=blocks.find(b=>b.selector===selector);assert.ok(block,`${name} ${mode}`);
  for(const key of requiredPalette)assert.ok(block.values[key],`${name} ${mode}: ${key} defined`);
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
 const pairs=[...['card','paper','surface-inset','surface-subtle'].flatMap(bg=>[['ink',bg],['muted',bg]]),['accent','accent-soft'],['accent','card'],['on-accent','accent-fill'],...['header','hero-debt','hero-savings'].flatMap(bg=>[['on-dark',bg],['on-dark-muted',bg],['on-dark-accent',bg]]),['on-dark-muted','on-dark-disabled'],['on-dark','on-dark-hover'],[colors['on-hero-accent']?'on-hero-accent':'ink-fixed','on-dark-accent'],['warn','warn-soft'],['cash-in','cash-in-bg'],['cash-out','cash-out-bg'],['amount-ink','amount-bg'],['amount-label','amount-bg'],['due-ink','due-bg'],['status','status-soft'],['on-paid','paid-fill'],['on-paid','paid-hover'],['on-danger','danger-fill']];
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

test('seasonal themes restore and every gradient interval retains readable banner text',()=>{
 for(const name of ['christmas','halloween','thanksgiving','valentine','newyear']){
  assert.equal(boot({'bearden:classic:holiday':name})['data-holiday'],name);
  for(const mode of ['light','dark']){
   const selector=`:root[data-holiday="${name}"]:not([data-color-scheme])`+(mode==='dark'?'[data-theme="dark"]':':not([data-theme="dark"])');
   const block=blocks.find(b=>b.selector===selector),colors=block?.values;assert.ok(colors);
   for(const bg of ['card','paper','surface-inset','surface-subtle'])for(const fg of ['ink','muted'])assert.ok(contrast(colors[fg],colors[bg])>=4.5,`${name} ${mode} ${fg}/${bg}`);
   assertGradientContrast(colors,block.gradient,`${name} ${mode}`);
  }
 }
 for(const name of names){
  for(const mode of ['light','dark']){
   const selector=`:root[data-color-scheme="${name}"]`,modeSelector=selector+(mode==='dark'?'[data-theme="dark"]':':not([data-theme="dark"])');
   const palette=blocks.find(b=>b.selector===modeSelector),shared=blocks.find(b=>b.selector===selector);
   const gradient=palette.gradient??shared?.gradient;
   if(gradient)assertGradientContrast(palette.values,gradient,`${name} ${mode}`);
  }
 }
});
