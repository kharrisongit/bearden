import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';import {randomBytes,createHash} from 'node:crypto';
import worker,{runtime} from '../cloudflare/worker.mjs';import {blank} from '../public/engine.mjs';
function fixture(fetcher){const db=new DatabaseSync(':memory:');db.exec(readFileSync('cloudflare/schema.sql','utf8'));let queries=0;const env={DATA_KEY:randomBytes(32).toString('base64'),APP_URL:'https://bearden.example',ALLOWED_EMAIL:'owner@example.com',GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-secret',PLAID_CLIENT_ID:'test-plaid',PLAID_SECRET:'test-plaid-secret',DB:{prepare(sql){return {bind(...args){return {async first(){queries++;return db.prepare(sql).get(...args)||null;},async run(){queries++;const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};}};}};}},ASSETS:{fetch:async()=>new Response('test asset')}};const app=runtime(env,fetcher);const token='test-session';db.prepare('INSERT INTO sessions VALUES(?,?)').run(createHash('sha256').update(token).digest('hex'),Date.now()+60000);return {db,env,app,token,get queries(){return queries;},set(id,data){db.prepare('INSERT OR REPLACE INTO vault VALUES(?,?)').run(id,app.encrypt(data));},get(id){return app.decrypt(db.prepare('SELECT value FROM vault WHERE id=?').get(id).value);},req(path,body,origin=env.APP_URL){return new Request(env.APP_URL+path,{method:body===undefined?'GET':'POST',headers:{Cookie:'bearden='+token,Origin:origin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});}};}
test('Worker denies unauthenticated private requests',async()=>{const f=fixture();const r=await f.app.handle(new Request('https://bearden.example/api/state'));assert.equal(r.status,401);f.db.close();});
test('Worker uses persistent encrypted records, checks origin and revision',async()=>{const f=fixture(),s=blank();s.accounts=[{id:'cash',name:'Private bank',balance:12345,include:true}];assert.equal((await f.app.handle(f.req('/api/state',{state:s,revision:0},'https://evil.example'))).status,403);assert.equal((await f.app.handle(f.req('/api/state',{state:s,revision:0}))).status,200);assert.equal((await f.app.handle(f.req('/api/state',{state:s,revision:0}))).status,409);assert.equal((await (await f.app.handle(f.req('/api/state'))).json()).state.accounts[0].balance,12345);assert.ok(!f.db.prepare('SELECT value FROM vault').get().value.includes('Private bank'));f.db.close();});
test('D1 lock prevents overlapping writes across runtime instances',async()=>{const f=fixture();f.db.prepare('INSERT INTO locks VALUES(?,?,?)').run('sync','other',Date.now()+60000);await assert.rejects(()=>f.app.handle(f.req('/api/state',{state:blank(),revision:0})),/already running/);assert.equal(f.db.prepare('SELECT owner FROM locks').get().owner,'other');f.db.close();});
test('encryption is authenticated and wrong keys cannot read it',()=>{const f=fixture(),data=f.app.encrypt({secret:'private'}),g=fixture();assert.deepEqual(f.app.decrypt(data),{secret:'private'});assert.throws(()=>g.app.decrypt(data));f.db.close();g.db.close();});
test('public state never includes refresh or bank access tokens',async()=>{const f=fixture();f.set('connections',{items:[{id:'i',name:'Bank',token:'sensitive-bank',pending:{transactions:[]}}],transactions:[],candidates:[],gmail:{refreshToken:'sensitive-gmail'},status:'Ready'});const text=await (await f.app.handle(f.req('/api/state'))).text();assert.ok(!text.includes('sensitive'));assert.equal(JSON.parse(text).connections.items[0].pending,undefined);f.db.close();});
test('bank pagination keeps committed cursor until last page and retries original after mutation',async()=>{let count=0;const f=fixture(async url=>{if(url.endsWith('/accounts/get'))return Response.json({accounts:[]});if(url.endsWith('/transactions/sync')){count++;if(count===2)return Response.json({error_code:'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION'},{status:400});return Response.json({added:[],modified:[],removed:[],next_cursor:'partial',has_more:true});}throw Error('Unexpected URL');});f.set('connections',{items:[{id:'i',name:'Bank',token:'t',cursor:'old'}],transactions:[],candidates:[],gmail:null});await f.app.sync();let c=f.get('connections');assert.equal(c.items[0].cursor,'old');assert.equal(c.items[0].pending.cursor,'partial');await f.app.sync(true);c=f.get('connections');assert.equal(c.items[0].cursor,'old');assert.equal(c.items[0].pending,undefined);f.db.close();});
test('completed bank sync merges balances without erasing manual plan',async()=>{const f=fixture(async url=>url.endsWith('/transactions/sync')?Response.json({added:[],modified:[],removed:[],next_cursor:'new',has_more:false}):Response.json({accounts:[{account_id:'a',type:'depository',subtype:'checking',name:'Bank',balances:{available:123.45,current:200,iso_currency_code:'USD'}}]}));const s=blank();s.accounts=[{id:'manual',name:'Cash',balance:100,include:true}];f.set('plan',{state:s,revision:2});f.set('connections',{items:[{id:'i',name:'Bank',token:'t',cursor:''}],transactions:[],candidates:[],gmail:null});await f.app.sync();const p=f.get('plan');assert.equal(p.state.accounts.length,2);assert.equal(p.state.accounts[1].balance,12345);assert.equal(p.revision,3);assert.equal(f.get('connections').items[0].cursor,'new');assert.ok(f.queries<50);f.db.close();});
test('Gmail scans only electric bills, ignores other senders, deduplicates reminders and resumes batches',async()=>{
 const calls=[];const f=fixture(async url=>{calls.push(url);if(url.includes('/token'))return Response.json({access_token:'access'});
 if(url.includes('messages?')){assert.match(new URL(url).searchParams.get('q'),/Consumers Energy/);return Response.json({messages:[1,2,3,4,5].map(id=>({id:String(id)}))});}
 const id=url.match(/messages\/(\d)/)?.[1];return Response.json({snippet:'bill',payload:{mimeType:'text/plain',headers:[{name:'From',value:id==='2'?'Water <water@example.com>':'Consumers Energy <bills@consumersenergy.com>'},{name:'Subject',value:'Your bill'}],body:{data:Buffer.from('Amount due: $12.34 Due date: 11/01/2099').toString('base64url')}}});});
 f.set('connections',{items:[],transactions:[],candidates:[],gmail:{refreshToken:'refresh'}});
 await f.app.sync();let c=f.get('connections');assert.equal(c.candidates.length,0);assert.deepEqual(c.gmail.backlog,['4','5']);
 let p=f.get('plan');assert.equal(p.state.bills.length,1);assert.equal(p.state.bills[0].amount,1234);assert.equal(p.state.bills[0].name,'Consumers Energy');assert.equal(p.state.bills[0].repeat,'once');assert.equal(calls.length,5);assert.ok(f.queries+calls.length<50);
 await f.app.sync();assert.equal(f.get('plan').state.bills.length,1);assert.equal(f.get('connections').gmail.backlog.length,0);
 await f.app.sync(true);assert.equal(f.get('plan').state.bills.length,1);f.db.close();
});
test('unclear electric emails report status without creating a review list; receipts do not add bills',async()=>{
 const f=fixture(async url=>{if(url.includes('/token'))return Response.json({access_token:'access'});if(url.includes('messages?'))return Response.json({messages:[{id:'unclear'},{id:'receipt'}]});const receipt=url.includes('/receipt?');return Response.json({payload:{mimeType:'text/plain',headers:[{name:'From',value:'Consumers Energy <billing@consumersenergy.com>'},{name:'Subject',value:receipt?'Payment received':'Your statement'}],body:{data:Buffer.from(receipt?'Amount due: $10.00 Due date: 11/01/2099':'Your bill is available online').toString('base64url')}}});});
 f.set('connections',{items:[],transactions:[],candidates:[],gmail:{refreshToken:'refresh'}});await f.app.sync();const data=await (await f.app.handle(f.req('/api/state'))).json();assert.equal(data.state.bills.length,0);assert.equal(data.connections.candidates.length,0);assert.match(data.connections.electricStatus,/unclear/);f.db.close();
});
test('OAuth start uses bound state and PKCE; callback rejects incorrect binding',async()=>{const f=fixture(),r=await f.app.handle(f.req('/auth/google'));assert.equal(r.status,302);const url=new URL(r.headers.get('location'));assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.ok(r.headers.get('set-cookie').includes('HttpOnly; Secure; SameSite=Lax'));const result=await f.app.handle(f.req('/auth/google/callback?state=wrong&code=test'));assert.equal(result.status,400);f.db.close();});
test('Google callback refuses another verified email',async()=>{const f=fixture(async url=>url.includes('/token')?Response.json({access_token:'a'}):Response.json({email_verified:true,email:'other@example.com'}));const r=await f.app.handle(f.req('/auth/google')),state=new URL(r.headers.get('location')).searchParams.get('state');const callback=new Request(f.env.APP_URL+'/auth/google/callback?state='+state+'&code=code',{headers:{Cookie:'bearden_oauth='+state}});assert.equal((await f.app.handle(callback)).status,403);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM oauth').get().n,0);f.db.close();});
test('unconfigured scheduled worker does no provider work',async()=>{let called=false;await worker.scheduled({}, {}, {waitUntil(){called=true;}});assert.equal(called,false);});

test('bank connection returns balances immediately without requesting transaction history',async()=>{
 const calls=[];const f=fixture(async url=>{calls.push(url);if(url.endsWith('/item/public_token/exchange'))return Response.json({item_id:'i',access_token:'private'});if(url.endsWith('/accounts/get'))return Response.json({accounts:[{account_id:'a',name:'ELGA checking',type:'depository',subtype:'checking',balances:{available:543.21,current:600,iso_currency_code:'USD'}}]});throw Error('History must load separately');});
 const response=await f.app.handle(f.req('/api/plaid/exchange',{public_token:'public',name:'ELGA'}));assert.equal(response.status,200);assert.match((await response.json()).status,/balances loaded/);assert.equal(f.get('plan').state.accounts[0].balance,54321);assert.equal(calls.length,2);f.db.close();
});
test('failed initial balance fetch preserves connection and manual sync recovers before history is ready',async()=>{
 let ready=false;const f=fixture(async url=>{if(url.endsWith('/item/public_token/exchange'))return Response.json({item_id:'i',access_token:'private'});if(url.endsWith('/accounts/get')){if(!ready)return Response.json({error_code:'INSTITUTION_NOT_RESPONDING'},{status:400});return Response.json({accounts:[{account_id:'a',name:'Checking',type:'depository',subtype:'checking',balances:{available:50,current:50,iso_currency_code:'USD'}}]});}return Response.json({error_code:'PRODUCT_NOT_READY'},{status:400});});
 const response=await (await f.app.handle(f.req('/api/plaid/exchange',{public_token:'public'}))).json();assert.match(response.status,/could not load/);assert.equal(f.get('connections').items[0].token,'private');ready=true;await f.app.sync(true);assert.equal(f.get('plan').state.accounts[0].balance,5000);assert.match(f.get('connections').status,/PRODUCT_NOT_READY/);f.db.close();
});
test('Baby Bear import requires owner session and matching origin; source file is not public',async()=>{
 const f=fixture();assert.equal((await f.app.handle(new Request(f.env.APP_URL+'/api/import/baby-bear'))).status,401);
 assert.equal((await f.app.handle(new Request(f.env.APP_URL+'/api/import/baby-bear',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}))).status,401);
 assert.equal((await f.app.handle(f.req('/api/import/baby-bear',{date:'2026-11-01',revision:0},'https://other.example'))).status,403);
 assert.equal((await f.app.handle(new Request(f.env.APP_URL+'/baby-bear.mjs'))).status,404);f.db.close();
});
test('Baby Bear import preserves existing data, skips duplicate debts and rejects stale revisions',async()=>{
 const f=fixture(),s=blank();s.accounts=[{id:'cash',name:'Bank',balance:100,include:true}];s.debts=[{id:'custom',name:'Affirm',balance:100,apr:1,minimum:1,date:'2026-11-01'}];f.set('plan',{state:s,revision:5});
 assert.equal((await f.app.handle(f.req('/api/import/baby-bear',{date:'2026-11-01',revision:4}))).status,409);
 const response=await (await f.app.handle(f.req('/api/import/baby-bear',{date:'2026-11-01',revision:5}))).json();assert.equal(response.added,7);assert.equal(response.skipped,1);
 const p=f.get('plan');assert.deepEqual(p.state.accounts,s.accounts);assert.equal(p.state.debts[0].balance,100);assert.equal(p.state.debts[1].minimumRepeat,'biweekly');
 const again=await (await f.app.handle(f.req('/api/import/baby-bear',{date:'2026-11-01',revision:p.revision}))).json();assert.equal(again.added,0);assert.equal(f.get('plan').state.debts.length,8);f.db.close();
});
test('rerunning a debt-only import persists the missing income and budget',async()=>{
 const f=fixture();await f.app.handle(f.req('/api/import/baby-bear',{date:'2026-11-06',revision:0}));const p=f.get('plan');p.state.income=[];p.state.bills=[];f.set('plan',p);
 const result=await (await f.app.handle(f.req('/api/import/baby-bear',{date:'2026-11-20',takeHome:190000,revision:p.revision}))).json();assert.equal(result.added,0);assert.equal(result.incomeAdded,1);assert.equal(result.budgetAdded,5);assert.equal(f.get('plan').state.income[0].amount,190000);assert.equal(f.get('plan').revision,p.revision+1);f.db.close();
});
test('original tracker storage is private, encrypted, revision checked, and independent of bank sync',async()=>{
 const f=fixture();const state={version:1,values:{'app-state':JSON.stringify({cards:[{id:1,name:'Private card',balance:123}],budgetItems:[],savingsGoals:[]}),notes:'[{"text":"Private note"}]'}};
 assert.equal((await f.app.handle(new Request('https://bearden.example/api/classic'))).status,401);
 assert.equal((await f.app.handle(f.req('/api/classic',{state,revision:0},'https://evil.example'))).status,403);
 assert.equal((await f.app.handle(f.req('/api/classic',{state,revision:0}))).status,200);
 assert.equal((await f.app.handle(f.req('/api/classic',{state,revision:0}))).status,409);
 const saved=await (await f.app.handle(f.req('/api/classic'))).json();assert.deepEqual(saved.state,state);assert.equal(saved.revision,1);
 assert.ok(!f.db.prepare('SELECT value FROM vault WHERE id=?').get('classic').value.includes('Private card'));
 f.set('plan',{state:blank(),revision:8});assert.deepEqual((await (await f.app.handle(f.req('/api/classic'))).json()).state,state);
 await assert.rejects(()=>f.app.handle(f.req('/api/classic',{state:{version:1,values:{unexpected:'secret'}},revision:1})),/Invalid tracker/);f.db.close();
});

test('all scripts and styles used by the original tracker are publicly served with strict script CSP',async()=>{
 const f=fixture(),html=readFileSync('public/index.html','utf8');
 const urls=[...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css)(?:\?[^"]*)?)"/g)].map(m=>m[1]);
 urls.push('classic-migrate.mjs','income-model.mjs','bank-activity.mjs','credit-model.mjs');
 for(const url of urls){const r=await f.app.handle(new Request(f.env.APP_URL+'/'+url));assert.equal(r.status,200,url);assert.match(r.headers.get('Content-Security-Policy'),/script-src 'self' https:\/\/cdn.plaid.com;/);}
 f.db.close();
});

test('widget bank refresh updates balances without scanning Gmail or leaving bank history stale',async()=>{
 const calls=[];const f=fixture(async url=>{calls.push(url);if(url.endsWith('/accounts/get'))return Response.json({accounts:[]});if(url.endsWith('/transactions/sync'))return Response.json({added:[],modified:[],removed:[],next_cursor:'new',has_more:false});throw Error('Gmail must not run');});
 f.set('connections',{items:[{id:'bank',name:'ELGA',token:'secret'}],transactions:[],candidates:[],gmail:{refreshToken:'mail'},lastTask:'bank'});
 const r=await f.app.handle(f.req('/api/bank/refresh',{}));assert.equal(r.status,200);assert.equal(calls.length,2);assert.equal(f.get('connections').items[0].cursor,'new');f.db.close();
});

test('credit accounts show current amount owed, never available credit as cash',async()=>{
 const f=fixture(async url=>url.endsWith('/transactions/sync')?Response.json({added:[],modified:[],removed:[],next_cursor:'new',has_more:false}):Response.json({accounts:[{account_id:'card',type:'credit',subtype:'credit card',name:'Visa',balances:{current:861.21,available:4138.79,iso_currency_code:'USD'}}]}));
 f.set('connections',{items:[{id:'i',name:'Bank',token:'t',cursor:''}],transactions:[],candidates:[],gmail:null});await f.app.sync();const a=f.get('plan').state.accounts[0];assert.equal(a.balance,86121);assert.equal(a.include,false);f.db.close();
});

test('credit Link requests Liabilities and Transactions; update mode reuses existing connection',async()=>{
 const calls=[];const f=fixture(async(url,options)=>{calls.push(JSON.parse(options.body));return Response.json({link_token:'link'});});
 f.set('connections',{items:[{id:'elga',name:'ELGA',token:'private'}],transactions:[],candidates:[],gmail:null});
 await f.app.handle(f.req('/api/plaid/link',{kind:'credit'}));assert.deepEqual(calls[0].products,['liabilities','transactions']);assert.deepEqual(calls[0].account_filters.credit.account_subtypes,['credit card','paypal']);
 await f.app.handle(f.req('/api/plaid/link',{kind:'credit',itemId:'elga'}));assert.equal(calls[1].access_token,'private');assert.equal(calls[1].products,undefined);assert.deepEqual(calls[1].additional_consented_products,['liabilities','transactions']);f.db.close();
});
test('credit refresh targets the requested bank, loads payments, stays private and fits Free Worker limits',async()=>{
 const calls=[];const f=fixture(async(url,options)=>{calls.push(url);assert.equal(JSON.parse(options.body).access_token,'card-token');
 if(url.endsWith('/accounts/get'))return Response.json({accounts:[]});
 if(url.endsWith('/liabilities/get'))return Response.json({accounts:[{account_id:'visa',name:'Visa',type:'credit',balances:{current:90,limit:1000,iso_currency_code:'USD'}}],liabilities:{credit:[{account_id:'visa',minimum_payment_amount:20,next_payment_due_date:'2099-11-05'}]}});
 if(url.endsWith('/transactions/sync'))return Response.json({added:[{transaction_id:'pay',account_id:'visa',name:'Payment thank you',date:'2099-10-20',amount:-40,iso_currency_code:'USD'}],modified:[],removed:[],next_cursor:'new',has_more:false});throw Error('Unexpected URL');});
 f.set('connections',{items:[{id:'checking',name:'Checking',token:'other'},{id:'card',name:'Card',token:'card-token',liabilities:true}],transactions:[],candidates:[],gmail:{refreshToken:'gmail'}});
 const result=await (await f.app.handle(f.req('/api/cards/refresh',{itemId:'card'}))).json();assert.match(result.status,/Card details synced/);
 const state=await (await f.app.handle(f.req('/api/state'))).json();assert.equal(state.connections.creditCards[0].minimum,2000);assert.equal(state.connections.creditCards[0].payments[0].amount,4000);assert.equal(state.connections.items.length,2);assert.ok(!JSON.stringify(state).includes('card-token'));assert.ok(f.queries+calls.length<50);assert.equal(calls.length,3);f.db.close();
});
test('enabling card details on an existing item never exchanges a new public token',async()=>{
 const f=fixture(async url=>{assert.ok(!url.endsWith('/item/public_token/exchange'));if(url.endsWith('/liabilities/get'))return Response.json({accounts:[],liabilities:{credit:[]}});if(url.endsWith('/accounts/get'))return Response.json({accounts:[]});return Response.json({added:[],modified:[],removed:[],next_cursor:'done',has_more:false});});
 f.set('connections',{items:[{id:'elga',name:'ELGA',token:'private'}],transactions:[],candidates:[],gmail:null});await f.app.handle(f.req('/api/plaid/updated',{itemId:'elga'}));const c=f.get('connections');assert.equal(c.items.length,1);assert.equal(c.items[0].liabilities,true);f.db.close();
});

test('bank pagination cannot starve a newly linked credit institution',async()=>{
 const tokens=[];const f=fixture(async(url,options)=>{if(url.endsWith('/accounts/get'))return Response.json({accounts:[]});tokens.push(JSON.parse(options.body).access_token);return Response.json({added:[],modified:[],removed:[],next_cursor:'partial',has_more:true});});
 f.set('connections',{items:[{id:'first',name:'First',token:'first'},{id:'second',name:'Second',token:'second'}],transactions:[],candidates:[],gmail:null});await f.app.sync();await f.app.sync();assert.deepEqual(tokens,['first','second']);f.db.close();
});
