import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runtime} from '../cloudflare/worker.mjs';

// Use the real Worker router, not a file-only browser mock that bypasses its
// allowlist. A missing transitive import can blank every account and balance.
test('all browser scripts and their imports are reachable through the Worker',async()=>{
 const app=runtime({APP_URL:'https://bearden.test',ASSETS:{fetch:async req=>{
  const path=new URL(req.url).pathname;
  return new Response(readFileSync(new URL('../public'+path,import.meta.url)),{headers:{'Content-Type':path.endsWith('.css')?'text/css':'text/javascript'}});
 }}});
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const queue=[...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map(m=>new URL(m[1],'https://bearden.test/'));
 const seen=new Set();
 while(queue.length){
  const url=queue.shift();if(seen.has(url.href))continue;seen.add(url.href);
  const response=await app.handle(new Request(url));
  assert.equal(response.status,200,`${url.pathname}${url.search} must be served`);
  assert.match(response.headers.get('Content-Type'),/javascript/);
  const code=await response.text();
  for(const match of code.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"](\.[^'"]+)['"]/g))queue.push(new URL(match[1],url));
 }
 assert.ok([...seen].some(url=>url.includes('/bills-savings.mjs')),'savings dependency was traversed');
 assert.equal((await app.handle(new Request('https://bearden.test/server.mjs'))).status,404);
});
