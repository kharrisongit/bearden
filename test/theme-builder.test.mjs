import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../public/theme-builder.js',import.meta.url),'utf8');
function boot(colors,mode='light',blocked=false){
 const styles={},dataset={theme:mode};
 const root={dataset,style:{setProperty:(key,value)=>styles[key]=value,removeProperty:key=>delete styles[key]}};
 vm.runInNewContext(source,{document:{documentElement:root,addEventListener:()=>{}},MutationObserver:class{observe(){}},localStorage:{getItem:key=>{if(blocked)throw Error('Storage blocked');return key==='bearden:custom-theme'?JSON.stringify(colors):'custom';}}});
 return {styles,dataset};
}
const lum=hex=>hex.slice(1).match(/../g).map(n=>parseInt(n,16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);

test('custom surface, button, and accent extremes keep readable text in both modes',()=>{
 const choices=['#000000','#ffffff','#ff0000','#00ff00','#0000ff','#777777'];
 for(const mode of ['light','dark'])for(const surface of choices)for(const button of choices)for(const accent of choices){
  const {styles:c}=boot({surface,button,accent},mode);
  assert.equal(c['--accent-fill'],button);assert.equal(c['--custom-accent'],accent);
  for(const bg of ['paper','card','surface-inset','surface-subtle','accent-soft'])for(const fg of ['ink','muted','accent'])assert.ok(contrast(c['--'+fg],c['--'+bg])>=4.5,`${mode} ${surface} ${button} ${accent}: ${fg}/${bg}`);
  assert.ok(contrast(c['--on-accent'],button)>=4.5);
  for(const fg of ['on-dark','on-dark-muted','on-dark-accent'])assert.ok(contrast(c['--'+fg],c['--header'])>=4.5);
 }
});

test('custom themes restore before paint and reject invalid or unavailable stored colors',()=>{
 const saved={surface:'#123456',button:'#ABCDEF',accent:'#908070'};
 assert.equal(boot(saved).dataset.colorScheme,'custom');assert.equal(boot(saved).styles['--accent-fill'],'#abcdef');
 assert.equal(boot({button:'url(https://example.com)',accent:'#bad'}).styles['--accent-fill'],'#2056a0');
 assert.deepEqual(boot(saved,'light',true).styles,{});
});
