import {googleIdentity} from '../user-scope.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';import {randomBytes,createHash} from 'node:crypto';
import worker,{runtime} from '../cloudflare/worker.mjs';import {blank} from '../public/engine.mjs';
function fixture(fetcher){const db=new DatabaseSync(':memory:');db.exec(readFileSync('cloudflare/schema.sql','utf8'));let queries=0;const env={DATA_KEY:randomBytes(32).toString('base64'),APP_URL:'https://bearden.example',ALLOWED_EMAIL:'owner@example.com',GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-secret',PLAID_CLIENT_ID:'test-plaid',PLAID_SECRET:'test-plaid-secret',DB:{prepare(sql){return {bind(...args){return {async first(){queries++;return db.prepare(sql).get(...args)||null;},async all(){queries++;return {results:db.prepare(sql).all(...args)};},async run(){queries++;const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};}};}};}},ASSETS:{fetch:async()=>new Response('test asset')}};const app=runtime(env,fetcher);const token='test-session';db.prepare('INSERT INTO sessions VALUES(?,?)').run(createHash('sha256').update(token).digest('hex'),Date.now()+60000);return {db,env,app,token,get queries(){return queries;},set(id,data){db.prepare('INSERT OR REPLACE INTO vault VALUES(?,?)').run(id,app.encrypt(data));},get(id){return app.decrypt(db.prepare('SELECT value FROM vault WHERE id=?').get(id).value);},req(path,body,origin=env.APP_URL){return new Request(env.APP_URL+path,{method:body===undefined?'GET':'POST',headers:{Cookie:'bearden='+token,Origin:origin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});}};}
test('Worker denies unauthenticated private requests',async()=>{const f=fixture();const r=await f.app.handle(new Request('https://bearden.example/api/state'));assert.equal(r.status,401);f.db.close();});
test('Worker uses persistent encrypted records, checks origin and revision',async()=>{const f=fixture(),s=blank();s.accounts=[{id:'cash',name:'Private bank',balance:12345,include:true}];assert.equal((await f.app.handle(f.req('/api/state',{state:s,revision:0},'https://evil.example'))).status,403);assert.equal((await f.app.handle(f.req('/api/state',{state:s,revision:0}))).status,200);assert.equal((await f.app.handle(f.req('/api/state',{state:s,revision:0}))).status,409);assert.equal((await (await f.app.handle(f.req('/api/state'))).json()).state.accounts[0].balance,12345);assert.ok(!f.db.prepare('SELECT value FROM vault').get().value.includes('Private bank'));f.db.close();});
test('D1 lock prevents overlapping writes across runtime instances',async()=>{const f=fixture();f.db.prepare('INSERT INTO locks VALUES(?,?,?)').run('sync','other',Date.now()+60000);await assert.rejects(()=>f.app.handle(f.req('/api/state',{state:blank(),revision:0})),/already running/);assert.equal(f.db.prepare('SELECT owner FROM locks').get().owner,'other');f.db.close();});
test('encryption is authenticated and wrong keys cannot read it',()=>{const f=fixture(),data=f.app.encrypt({secret:'private'}),g=fixture();assert.deepEqual(f.app.decrypt(data),{secret:'private'});assert.throws(()=>g.app.decrypt(data));f.db.close();g.db.close();});
test('public state never includes refresh or bank access tokens',async()=>{const f=fixture();f.set('connections',{items:[{id:'i',name:'Bank',token:'sensitive-bank',pending:{transactions:[]}}],transactions:[],candidates:[],gmail:{refreshToken:'sensitive-gmail'},status:'Ready'});const text=await (await f.app.handle(f.req('/api/state'))).text();assert.ok(!text.includes('sensitive'));assert.equal(JSON.parse(text).connections.items[0].pending,undefined);f.db.close();});
test('bank pagination keeps committed cursor until last page and retries original after mutation',async()=>{let count=0;const f=fixture(async url=>{if(url.endsWith('/accounts/get'))return Response.json({accounts:[]});if(url.endsWith('/transactions/sync')){count++;if(count===2)return Response.json({error_code:'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION'},{status:400});return Response.json({added:[],modified:[],removed:[],next_cursor:'partial',has_more:true});}throw Error('Unexpected URL');});f.set('connections',{items:[{id:'i',name:'Bank',token:'t',cursor:'old'}],transactions:[],candidates:[],gmail:null});await f.app.sync();let c=f.get('connections');assert.equal(c.items[0].cursor,'old');assert.equal(c.items[0].pending.cursor,'partial');await f.app.sync(true);c=f.get('connections');assert.equal(c.items[0].cursor,'old');assert.equal(c.items[0].pending,undefined);f.db.close();});
test('completed bank sync merges balances without erasing manual plan',async()=>{const f=fixture(async url=>url.endsWith('/transactions/sync')?Response.json({added:[],modified:[],removed:[],next_cursor:'new',has_more:false}):Response.json({accounts:[{account_id:'a',type:'depository',subtype:'checking',name:'Bank',balances:{available:123.45,current:200,iso_currency_code:'USD'}}]}));const s=blank();s.accounts=[{id:'manual',name:'Cash',balance:100,include:true}];f.set('plan',{state:s,revision:2});f.set('connections',{items:[{id:'i',name:'Bank',token:'t',cursor:''}],transactions:[],candidates:[],gmail:null});await f.app.sync();const p=f.get('plan');assert.equal(p.state.accounts.length,2);assert.equal(p.state.accounts[1].balance,12345);assert.equal(p.revision,3);assert.equal(f.get('connections').items[0].cursor,'new');assert.ok(f.queries<50);f.db.close();});
test('Gmail scans bills and payments while preserving electric bill imports and bounded batches',async()=>{
 const calls=[];const f=fixture(async url=>{calls.push(url);if(url.includes('/token'))return Response.json({access_token:'access'});
 if(url.includes('messages?')){assert.match(new URL(url).searchParams.get('q'),/statement/);return Response.json({messages:[1,2,3,4,5].map(id=>({id:String(id)}))});}
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
test('Google callback accepts another verified email into a separate private account',async()=>{const f=fixture(async url=>url.includes('/token')?Response.json({access_token:'a'}):Response.json({email_verified:true,email:'other@example.com',sub:'other-user'}));const r=await f.app.handle(f.req('/auth/google')),state=new URL(r.headers.get('location')).searchParams.get('state');const callback=new Request(f.env.APP_URL+'/auth/google/callback?state='+state+'&code=code',{headers:{Cookie:'bearden_oauth='+state}});const response=await f.app.handle(callback);assert.equal(response.status,302);const session=response.headers.get('set-cookie').match(/bearden=([^;]+)/)[1];const saved=await(await f.app.handle(new Request(f.env.APP_URL+'/api/classic',{headers:{Cookie:'bearden='+session}}))).json();assert.deepEqual(saved.state.values,{});assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM oauth').get().n,0);f.db.close();});
test('unconfigured scheduled worker does no provider work',async()=>{let called=false;await worker.scheduled({}, {}, {waitUntil(){called=true;}});assert.equal(called,false);});

test('bank connection returns balances immediately without requesting transaction history',async()=>{
 const calls=[];const f=fixture(async url=>{calls.push(url);if(url.endsWith('/item/public_token/exchange'))return Response.json({item_id:'i',access_token:'private'});if(url.endsWith('/accounts/get'))return Response.json({accounts:[{account_id:'a',name:'ELGA checking',type:'depository',subtype:'checking',balances:{available:543.21,current:600,iso_currency_code:'USD'}}]});throw Error('History must load separately');});
 const response=await f.app.handle(f.req('/api/plaid/exchange',{public_token:'public',name:'ELGA'}));assert.equal(response.status,200);assert.match((await response.json()).status,/balances loaded/);assert.equal(f.get('plan').state.accounts[0].balance,54321);assert.equal(calls.length,2);f.db.close();
});
test('failed initial balance fetch preserves connection and manual sync recovers before history is ready',async()=>{
 let ready=false;const f=fixture(async url=>{if(url.endsWith('/item/public_token/exchange'))return Response.json({item_id:'i',access_token:'private'});if(url.endsWith('/accounts/get')){if(!ready)return Response.json({error_code:'INSTITUTION_NOT_RESPONDING'},{status:400});return Response.json({accounts:[{account_id:'a',name:'Checking',type:'depository',subtype:'checking',balances:{available:50,current:50,iso_currency_code:'USD'}}]});}return Response.json({error_code:'PRODUCT_NOT_READY'},{status:400});});
 const response=await (await f.app.handle(f.req('/api/plaid/exchange',{public_token:'public'}))).json();assert.match(response.status,/could not load/);assert.equal(f.get('connections').items[0].token,'private');ready=true;await f.app.sync(true);assert.equal(f.get('plan').state.accounts[0].balance,5000);assert.match(f.get('connections').status,/PRODUCT_NOT_READY/);f.db.close();
});
test('retired preset imports cannot replace existing accounts or income',async()=>{
 const f=fixture(),state=blank();state.accounts=[{id:'cash',name:'Checking',balance:50000,include:true}];state.debts=[{id:'saved',name:'Saved debt',balance:12300,apr:15,minimum:2500,date:'2026-11-01'}];state.income=[{id:'income',name:'My pay',amount:180000,date:'2026-11-01',repeat:'biweekly'}];f.set('plan',{state,revision:3});
 const tracker={state:{version:1,values:{'app-state':JSON.stringify({cards:[{id:1,name:'Saved debt',balance:123}],babyBearMode:true,papaBearMode:true})}},revision:4};f.set('classic',tracker);
 for(const method of ['GET','POST']){const r=await f.app.handle(f.req('/api/import/baby-bear',method==='GET'?undefined:{date:'2026-11-01',revision:3}));assert.equal(r.status,410);}
 assert.deepEqual(f.get('plan'),{state,revision:3});assert.deepEqual(f.get('classic'),tracker);assert.equal((await f.app.handle(new Request(f.env.APP_URL+'/api/import/baby-bear'))).status,401);f.db.close();
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
 urls.push('classic-migrate.mjs','income-model.mjs','bank-activity.mjs','credit-model.mjs','transaction-links.mjs','email-model.mjs','tax-model.mjs','tax-ui.mjs','onboarding.js');
 for(const url of urls){const r=await f.app.handle(new Request(f.env.APP_URL+'/'+url));assert.equal(r.status,200,url);assert.match(r.headers.get('Content-Security-Policy'),/script-src 'self' https:\/\/cdn.plaid.com;/);}
 f.db.close();
});

test('widget bank refresh updates balances without scanning Gmail or leaving bank history stale',async()=>{
 const calls=[];const f=fixture(async url=>{calls.push(url);if(url.endsWith('/accounts/balance/get'))return Response.json({accounts:[]});if(url.endsWith('/transactions/sync'))return Response.json({added:[],modified:[],removed:[],next_cursor:'new',has_more:false});throw Error('Gmail must not run');});
 f.set('connections',{items:[{id:'bank',name:'ELGA',token:'secret'}],transactions:[],candidates:[],gmail:{refreshToken:'mail'},lastTask:'bank'});
 const r=await f.app.handle(f.req('/api/bank/refresh',{}));assert.equal(r.status,200);assert.equal(calls.length,2);assert.ok(calls[0].endsWith('/accounts/balance/get'));assert.equal(f.get('connections').items[0].cursor,'new');f.db.close();
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

test('Baby Bear income shortcut is owner-only and contains only privately saved income',async()=>{
 const f=fixture(),state=blank();state.accounts=[{id:'a',name:'Checking',balance:10000,include:true}];f.set('plan',{state,revision:5});const classic={state:{version:1,values:{'app-state':JSON.stringify({takeHome:1500,hourlyRate:24,hoursPerCheck:80,cards:[{id:1,name:'Saved debt',balance:800}],budgetItems:[]})}},revision:2};f.set('classic',classic);
 assert.equal((await f.app.handle(new Request(f.env.APP_URL+'/api/income/baby-bear'))).status,401);
 const preset=await (await f.app.handle(f.req('/api/income/baby-bear'))).json();assert.equal(preset.hourlyRate,24);assert.equal(preset.hoursPerCheck,80);assert.equal(preset.amount,150000);assert.equal(preset.debts,undefined);assert.equal(preset.accounts,undefined);assert.equal(preset.budgetItems,undefined);assert.deepEqual(f.get('plan'),{state,revision:5});assert.deepEqual(f.get('classic'),classic);
 assert.equal((await f.app.handle(new Request(f.env.APP_URL+'/income-preset.mjs'))).status,404);f.db.close();
});
test('income snapshot survives later income edits and does not restore accounts',async()=>{
 const f=fixture(),initial={version:1,values:{'app-state':JSON.stringify({takeHome:1500,hourlyRate:24,hoursPerCheck:80,cards:[],budgetItems:[]})}};
 await f.app.handle(f.req('/api/classic',{state:initial,revision:0}));assert.equal(f.get('income-shortcut').amount,150000);
 const edited={version:1,values:{'app-state':JSON.stringify({takeHome:1700,hourlyRate:26,hoursPerCheck:80,cards:[{id:1,name:'New debt',balance:900}],budgetItems:[]})}};
 await f.app.handle(f.req('/api/classic',{state:edited,revision:1}));const before=f.get('classic'),preset=await (await f.app.handle(f.req('/api/income/baby-bear'))).json();assert.equal(preset.amount,150000);assert.deepEqual(f.get('classic'),before);assert.equal(before.state.values['app-state'],edited.values['app-state']);f.db.close();
});

test('owner can attach a second Gmail without changing the BearDen login or replacing the first mailbox',async()=>{
 const f=fixture(async url=>url.includes('/token')?Response.json({access_token:'access',refresh_token:'second-private',scope:'openid email https://www.googleapis.com/auth/gmail.readonly'}):Response.json({email_verified:true,email:'bills@example.com',sub:'second'}));
 f.set('connections',{items:[],transactions:[],candidates:[],gmail:{refreshToken:'first-private'}});
 const start=await f.app.handle(f.req('/auth/google?gmail=1')),oauth=new URL(start.headers.get('location')),state=oauth.searchParams.get('state');assert.equal(oauth.searchParams.get('prompt'),'consent select_account');
 const response=await f.app.handle(new Request(f.env.APP_URL+'/auth/google/callback?state='+state+'&code=code',{headers:{Cookie:'bearden='+f.token+'; bearden_oauth='+state}}));
 assert.equal(response.status,302);assert.ok(!response.headers.get('set-cookie').includes('bearden='));
 const c=f.get('connections');assert.equal(c.gmailAccounts.length,2);assert.equal(c.gmailAccounts[0].refreshToken,'first-private');assert.equal(c.gmailAccounts[1].email,'bills@example.com');
 const publicState=await (await f.app.handle(f.req('/api/state'))).text();assert.ok(!publicState.includes('private'));assert.equal(JSON.parse(publicState).connections.gmailAccounts.length,2);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sessions').get().n,1);f.db.close();
});
test('additional Gmail authorization requires the same still-active owner session at callback',async()=>{
 for(const mode of ['absent','different','expired']){
  let fetched=false;const f=fixture(async()=>{fetched=true;throw Error('Must reject before token exchange');});
  const start=await f.app.handle(f.req('/auth/google?gmail=1')),state=new URL(start.headers.get('location')).searchParams.get('state');
  if(mode==='different')f.db.prepare('INSERT INTO sessions VALUES(?,?)').run(createHash('sha256').update('another').digest('hex'),Date.now()+60000);
  if(mode==='expired')f.db.prepare('UPDATE sessions SET expires=0').run();
  const cookie='bearden_oauth='+state+(mode==='absent'?'':'; bearden='+(mode==='different'?'another':f.token));
  const r=await f.app.handle(new Request(f.env.APP_URL+'/auth/google/callback?state='+state+'&code=code',{headers:{Cookie:cookie}}));assert.equal(r.status,403);assert.equal(fetched,false);f.db.close();
 }
});
test('Gmail searches every connected account, namespaces message IDs, and never exposes tokens or bodies',async()=>{
 const calls=[];const f=fixture(async(url,options)=>{
  calls.push(url);if(url.includes('/token'))return Response.json({access_token:new URLSearchParams(options.body).get('refresh_token')});
  if(url.includes('messages?')){assert.match(new URL(url).searchParams.get('q'),/"Example"/);return Response.json({messages:[{id:'same'}]});}
  return Response.json({internalDate:String(Date.now()),payload:{mimeType:'text/plain',headers:[{name:'From',value:'Example <billing@example.com>'},{name:'Subject',value:'Payment submitted'}],body:{data:Buffer.from('Payment amount: $50.00. Private full email body.').toString('base64url')}}});
 });
 f.set('connections',{items:[],transactions:[],candidates:[],gmailAccounts:[{id:'one',email:'one@example.com',refreshToken:'private-one'},{id:'two',email:'two@example.com',refreshToken:'private-two'}]});
 const r=await f.app.handle(f.req('/api/gmail/search',{query:'Example'}));assert.equal(r.status,200);const raw=await r.text(),data=JSON.parse(raw);assert.equal(data.gmailMessages.length,2);assert.deepEqual(data.gmailMessages.map(m=>m.id).sort(),['one:same','two:same']);assert.ok(data.gmailMessages.every(m=>m.paymentStatus==='pending'));assert.ok(!raw.includes('private-'));assert.ok(!raw.includes('Private full email'));assert.ok(f.queries+calls.length<50);
 assert.equal((await f.app.handle(f.req('/api/gmail/search',{query:'Example'},'https://evil.example'))).status,403);f.db.close();
});
test('disconnecting one Gmail revokes only that token and preserves other accounts and their messages',async()=>{
 const revoked=[];const f=fixture(async(url,options)=>{assert.ok(url.endsWith('/revoke'));revoked.push(new URLSearchParams(options.body).get('token'));return new Response('{}');});
 f.set('connections',{items:[],transactions:[],candidates:[],gmailAccounts:[{id:'one',email:'one@example.com',refreshToken:'first-token'},{id:'two',email:'two@example.com',refreshToken:'second-token'}],gmailMessages:[{id:'one:m',mailboxId:'one'},{id:'two:m',mailboxId:'two'}]});
 assert.equal((await f.app.handle(f.req('/api/gmail/disconnect',{}))).status,400);
 assert.equal((await f.app.handle(f.req('/api/gmail/disconnect',{id:'two'}))).status,200);const c=f.get('connections');assert.deepEqual(revoked,['second-token']);assert.equal(c.gmailAccounts.length,1);assert.equal(c.gmailAccounts[0].id,'one');assert.deepEqual(c.gmailMessages,[{id:'one:m',mailboxId:'one'}]);f.db.close();
});

function privateSession(f,email='member@example.com',sub='member'){
 const identity=googleIdentity({email,email_verified:true,sub},f.env.ALLOWED_EMAIL),token='v2.'+sub;
 f.db.prepare('INSERT INTO sessions VALUES(?,?)').run(createHash('sha256').update(token).digest('hex'),Date.now()+60000);
 f.set('auth-session:'+createHash('sha256').update(token).digest('hex'),identity);
 return {identity,token,req(path,body,accountId=identity.accountId){return new Request(f.env.APP_URL+path,{method:body===undefined?'GET':'POST',headers:{Cookie:'bearden='+token,Origin:f.env.APP_URL,'Content-Type':'application/json',...(accountId===null?{}:{'X-BearDen-Account':accountId})},body:body===undefined?undefined:JSON.stringify(body)});}};
}
test('another profile can attach its own Gmail and rejects an account switch before starting OAuth',async()=>{
 const f=fixture(async url=>url.includes('/token')?Response.json({access_token:'access',refresh_token:'member-private',scope:'openid email https://www.googleapis.com/auth/gmail.readonly'}):Response.json({email_verified:true,email:'other-inbox@example.com',sub:'extra-inbox'})),member=privateSession(f);
 f.set('connections',{items:[],transactions:[],candidates:[],gmail:{refreshToken:'owner-private'}});
 for(const query of ['', '&account=owner'])assert.equal((await f.app.handle(member.req('/auth/google?gmail=1'+query))).status,409);
 const start=await f.app.handle(member.req('/auth/google?gmail=1&account='+member.identity.accountId)),state=new URL(start.headers.get('location')).searchParams.get('state');
 const response=await f.app.handle(new Request(f.env.APP_URL+'/auth/google/callback?state='+state+'&code=code',{headers:{Cookie:'bearden='+member.token+'; bearden_oauth='+state}}));assert.equal(response.status,302);assert.ok(!response.headers.get('set-cookie').includes('bearden='));
 assert.equal(f.get('user:'+member.identity.scope+':connections').gmailAccounts[0].email,'other-inbox@example.com');assert.equal(f.get('connections').gmail.refreshToken,'owner-private');f.db.close();
});
test('returning Google login restores the same private budget and leaves the original profile intact',async()=>{
 const f=fixture(async url=>url.includes('/token')?Response.json({access_token:'a'}):Response.json({email_verified:true,email:'member@example.com',sub:'member'})),member=privateSession(f),saved={state:{version:1,values:{notes:'[{"text":"Member saved note"}]'}},revision:3};
 f.set('user:'+member.identity.scope+':classic',saved);f.set('classic',{state:{version:1,values:{notes:'[]'}},revision:8});
 const start=await f.app.handle(f.req('/auth/google')),state=new URL(start.headers.get('location')).searchParams.get('state'),response=await f.app.handle(new Request(f.env.APP_URL+'/auth/google/callback?state='+state+'&code=code',{headers:{Cookie:'bearden_oauth='+state}}));
 const session=response.headers.get('set-cookie').match(/bearden=([^;]+)/)[1],restored=await(await f.app.handle(new Request(f.env.APP_URL+'/api/classic',{headers:{Cookie:'bearden='+session}}))).json();assert.deepEqual(restored,saved);assert.equal(f.get('classic').revision,8);f.db.close();
});
test('budgets, connections, income shortcuts and backups are isolated between Google logins',async()=>{
 const f=fixture(),member=privateSession(f),ownerState={version:1,values:{notes:'[]','app-state':JSON.stringify({cards:[],budgetItems:[{id:1,label:'Private owner expense',amount:246}],savingsGoals:[]})}};
 f.set('classic',{state:ownerState,revision:4});const plan=blank();plan.accounts=[{id:'owner-cash',name:'Owner checking',balance:12345,include:true}];f.set('plan',{state:plan,revision:2});f.set('income-shortcut',{amount:12345});f.set('connections',{items:[{id:'owner-bank',name:'Owner bank',token:'private-owner'}],transactions:[],candidates:[],gmail:{refreshToken:'private-mail'}});
 const fresh=await(await f.app.handle(member.req('/api/state'))).json();assert.deepEqual(fresh.state.accounts,[]);assert.deepEqual(fresh.connections.items,[]);assert.deepEqual(fresh.connections.gmailAccounts,[]);assert.equal((await f.app.handle(member.req('/api/income/baby-bear'))).status,404);
 const own={version:1,values:{'app-state':JSON.stringify({cards:[],budgetItems:[],savingsGoals:[]}),notes:'[{"text":"Member note"}]'}};
 assert.equal((await f.app.handle(member.req('/api/classic',{state:own,revision:0}))).status,200);
 assert.deepEqual((await(await f.app.handle(f.req('/api/classic'))).json()).state,ownerState);assert.deepEqual((await(await f.app.handle(member.req('/api/classic'))).json()).state,own);
 assert.ok(!JSON.stringify(await(await f.app.handle(member.req('/api/state'))).json()).includes('Owner'));assert.equal(f.get('classic').revision,4);f.db.close();
});
test('stale tabs, spoofed account headers, and missing identity metadata cannot cross accounts',async()=>{
 const f=fixture(),member=privateSession(f),state={version:1,values:{notes:'[]'}};
 for(const header of ['owner',null])assert.equal((await f.app.handle(member.req('/api/classic',{state,revision:0},header))).status,409);
 const ownerRequest=new Request(f.env.APP_URL+'/api/classic',{headers:{Cookie:'bearden='+f.token,'X-BearDen-Account':member.identity.accountId}});assert.equal((await f.app.handle(ownerRequest)).status,409);
 f.db.prepare('DELETE FROM vault WHERE id=?').run('auth-session:'+createHash('sha256').update(member.token).digest('hex'));assert.equal((await f.app.handle(member.req('/api/state'))).status,401);f.db.close();
});
test('a member cannot refresh or disconnect another login’s bank or Gmail connection',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;throw Error('No provider request should occur');}),member=privateSession(f);
 f.set('connections',{items:[{id:'private-bank',name:'Owner bank',token:'owner-token'}],transactions:[],candidates:[],gmailAccounts:[{id:'private-gmail',email:'owner@example.com',refreshToken:'mail-token'}]});
 for(const path of ['/api/cards/refresh','/api/plaid/updated'])assert.equal((await f.app.handle(member.req(path,{itemId:'private-bank'}))).status,404);
 assert.equal((await f.app.handle(member.req('/api/plaid/disconnect',{id:'private-bank'}))).status,404);assert.equal((await f.app.handle(member.req('/api/gmail/disconnect',{id:'private-gmail'}))).status,400);assert.equal(calls,0);assert.equal(f.get('connections').items.length,1);f.db.close();
});
test('concurrent requests keep their own account scope and use separate save locks',async()=>{
 const f=fixture(),a=privateSession(f,'a@example.com','a'),b=privateSession(f,'b@example.com','b');
 const stateA={version:1,values:{notes:'[{"text":"A"}]'}},stateB={version:1,values:{notes:'[{"text":"B"}]'}};
 const saved=await Promise.all([f.app.handle(a.req('/api/classic',{state:stateA,revision:0})),f.app.handle(b.req('/api/classic',{state:stateB,revision:0}))]);assert.deepEqual(saved.map(r=>r.status),[200,200]);
 const reads=await Promise.all([a,b,a,b].map(async user=>(await(await f.app.handle(user.req('/api/classic'))).json()).state));assert.deepEqual(reads,[stateA,stateB,stateA,stateB]);f.db.close();
});
test('Plaid client identifiers and newly linked accounts belong to the signed-in profile',async()=>{
 const clientIds=[];const f=fixture(async(url,options)=>{const body=JSON.parse(options.body);if(url.endsWith('/link/token/create')){clientIds.push(body.user.client_user_id);return Response.json({link_token:'link'});}if(url.endsWith('/item/public_token/exchange'))return Response.json({item_id:'new-bank',access_token:'new-private'});if(url.endsWith('/accounts/get'))return Response.json({accounts:[]});throw Error('Unexpected provider URL');});const member=privateSession(f);
 await f.app.handle(f.req('/api/plaid/link',{}));await f.app.handle(member.req('/api/plaid/link',{}));assert.notEqual(clientIds[0],clientIds[1]);
 assert.equal((await f.app.handle(member.req('/api/plaid/exchange',{public_token:'sample'}))).status,200);
 assert.equal((await(await f.app.handle(member.req('/api/state'))).json()).connections.items[0].id,'new-bank');assert.deepEqual((await(await f.app.handle(f.req('/api/state'))).json()).connections.items,[]);f.db.close();
});
test('background sync selects a profile and never merges its Gmail with the original owner',async()=>{
 const tokens=[];const f=fixture(async(url,options)=>{if(url.includes('/token')){tokens.push(new URLSearchParams(options.body).get('refresh_token'));return Response.json({access_token:'access'});}if(url.includes('messages?'))return Response.json({messages:[]});throw Error('Unexpected provider URL');});const member=privateSession(f);
 f.set('user-index:owner',{scope:'',accountId:'owner',email:'owner@example.com',lastSync:9999999999999});f.set('user-index:'+member.identity.accountId,{...member.identity,lastSync:0});
 const base={items:[],transactions:[],candidates:[]};f.set('connections',{...base,gmail:{refreshToken:'owner-private'}});f.set('user:'+member.identity.scope+':connections',{...base,gmailAccounts:[{id:'member-mail',email:'member@example.com',refreshToken:'member-private'}]});
 await f.app.syncNextAccount();assert.deepEqual(tokens,['member-private']);assert.ok(f.get('user:'+member.identity.scope+':connections').gmailUpdated);assert.equal(f.get('connections').gmailUpdated,undefined);f.db.close();
});

test('Cloudflare serves every shipped public JavaScript module, including dynamic dependencies',async()=>{
 const {readdirSync}=await import('node:fs');const f=fixture();
 for(const name of readdirSync('public').filter(n=>/\.(?:mjs|js)$/.test(n))){const r=await f.app.handle(new Request(f.env.APP_URL+'/'+name+'?v=deployment-check'));assert.equal(r.status,200,'Cloudflare must serve '+name);assert.equal(await r.text(),'test asset');}
 assert.equal((await f.app.handle(new Request(f.env.APP_URL+'/server.mjs'))).status,404);f.db.close();
});
test('Cloudflare selected-message reread updates the private email cache and preserves saved cards and bills',async()=>{
 const calls=[];const f=fixture(async(url,options)=>{calls.push(url);if(url.includes('/token'))return Response.json({access_token:'private-access'});assert.match(url,/messages\/oct21\?format=full$/);return Response.json({internalDate:String(Date.parse('2026-10-21T12:00:00Z')),payload:{mimeType:'text/plain',headers:[{name:'From',value:'Consumers Energy <billing@consumersenergy.com>'},{name:'Subject',value:'Your bill is ready'}],body:{data:Buffer.from('Amount due: $275.00. Due date: 10/29/2026').toString('base64url')}}});});
 const saved={state:{version:1,values:{'app-state':JSON.stringify({cards:[{id:1,name:'Visa',balance:500}],budgetItems:[],takeHome:2000}),'income-planner':JSON.stringify({manual:[{id:'electric',amount:35300,date:'2026-10-29'}]})}},revision:7};f.set('classic',saved);f.set('connections',{items:[],transactions:[],candidates:[],gmailAccounts:[{id:'mail',email:'owner@example.com',refreshToken:'private-refresh'}],gmailMessages:[{id:'mail:oct21',mailboxId:'mail',amount:null}]});
 const r=await f.app.handle(f.req('/api/gmail/message',{mailboxId:'mail',id:'mail:oct21'}));assert.equal(r.status,200);const raw=await r.text(),data=JSON.parse(raw);assert.equal(data.message.amount,27500);assert.equal(data.message.dueDate,'2026-10-29');assert.ok(!raw.includes('private-'));assert.deepEqual(f.get('classic'),saved);assert.equal(f.get('connections').gmailMessages[0].amount,27500);
 assert.equal((await f.app.handle(f.req('/api/gmail/message',{mailboxId:'mail',id:'mail:oct21'},'https://evil.example'))).status,403);
 const member=privateSession(f);await assert.rejects(f.app.handle(member.req('/api/gmail/message',{mailboxId:'mail',id:'mail:oct21'})),/connected Gmail/);assert.equal(calls.length,2);f.db.close();
});
test('saving shared-bills preferences through Cloudflare retains existing accounts, cards, and bills',async()=>{
 const f=fixture(),values={'app-state':JSON.stringify({cards:[{id:1,name:'Visa',balance:500}],budgetItems:[],takeHome:2000}),'income-planner':JSON.stringify({manual:[{id:'power',name:'Electric',amount:35300,date:'2026-10-29'}],bankRules:{merchant:{id:'car',choice:'bill'}}})};f.set('classic',{state:{version:1,values},revision:4});
 const planner=JSON.parse(values['income-planner']);planner.household={enabled:true,personalAccountId:'plaid-own',billsAccountId:'plaid-shared',personalAmount:72500,spouseAmount:72500,spouseStartDate:'2026-11-06',spouseRepeat:'biweekly'};planner.billFunding={power:'shared'};
 const next={...values,'income-planner':JSON.stringify(planner)},r=await f.app.handle(f.req('/api/classic',{state:{version:1,values:next},revision:4}));assert.equal(r.status,200);const restored=await(await f.app.handle(f.req('/api/classic'))).json();assert.equal(restored.state.values['app-state'],values['app-state']);assert.deepEqual(JSON.parse(restored.state.values['income-planner']),planner);assert.equal(restored.revision,5);f.db.close();
});
test('combine duplicate connection protects revisions and preserves linked debt state',async()=>{
 const f=fixture();f.set('connections',{items:[{id:'old',name:'ELGA'},{id:'new',name:'ELGA'}],transactions:[],creditCards:[],candidates:[]});
 const state=blank();state.accounts=['old','new'].map(id=>({id:'plaid-'+id,itemId:id,name:'Loan',type:'loan',subtype:'auto',currency:'USD',balance:10000,source:'plaid',include:false}));f.set('plan',{state,revision:0});
 f.set('classic',{revision:2,state:{version:1,values:{'app-state':'{"cards":[{"id":1,"balance":100}]}','income-planner':'{"debtAccountLinks":{"1":"plaid-new"}}'}}});
 assert.equal((await f.app.handle(f.req('/api/plaid/combine',{removeId:'new',keepId:'old',revision:1}))).status,409);
 assert.equal(f.get('connections').items.length,2);
 assert.equal((await f.app.handle(f.req('/api/plaid/combine',{removeId:'new',keepId:'old',revision:2}))).status,200);
 assert.equal(f.get('connections').items.length,1);assert.equal(f.get('plan').state.accounts.length,1);assert.equal(JSON.parse(f.get('classic').state.values['income-planner']).debtAccountLinks[1],'plaid-old');assert.equal(f.get('classic').revision,3);assert.equal(f.get('bank-combine-backup').connections.items.length,2);f.db.close();
});
test('targeted refresh visits the requested connection and saves provider details even after another bank fails',async()=>{
 const calls=[];const f=fixture(async(url,options)=>{const token=JSON.parse(options.body).access_token;calls.push([url,token]);if(token==='broken')return Response.json({error_code:'ITEM_LOGIN_REQUIRED'},{status:400});if(url.endsWith('/accounts/balance/get'))return Response.json({accounts:[{account_id:token,type:'loan',subtype:'auto',name:token,balances:{current:token==='loan-zero'?0:1234.56,available:null,iso_currency_code:'USD'}}]});if(url.endsWith('/transactions/sync'))return Response.json({added:[],modified:[],removed:[],next_cursor:'done',has_more:false});throw Error('Unexpected request '+url);});
 f.set('connections',{items:['broken','loan-zero','loan-positive'].map(id=>({id,name:'ELGA',token:id})),transactions:[],candidates:[],gmail:null});
 let r=await(await f.app.handle(f.req('/api/bank/refresh',{itemId:'broken'}))).json();assert.equal(r.balanceRefreshed,false);assert.equal(r.balanceError,'ITEM_LOGIN_REQUIRED');
 for(const id of ['loan-zero','loan-positive']){r=await(await f.app.handle(f.req('/api/bank/refresh',{itemId:id}))).json();assert.equal(r.itemId,id);assert.equal(r.balanceRefreshed,true);}
 const result=await(await f.app.handle(f.req('/api/state'))).json();const zero=result.state.accounts.find(a=>a.id==='plaid-loan-zero'),positive=result.state.accounts.find(a=>a.id==='plaid-loan-positive');assert.equal(zero.reportedCurrent,0);assert.equal(zero.reportedAvailable,null);assert.ok(zero.balanceRetrieved);assert.equal(positive.reportedCurrent,1234.56);assert.equal(positive.balance,123456);assert.equal(result.connections.items[0].balanceError,'ITEM_LOGIN_REQUIRED');assert.equal(calls.filter(([url,token])=>token==='loan-positive'&&url.endsWith('/accounts/balance/get')).length,1);f.db.close();
});
test('Gmail-only continuation never refreshes an unrelated bank connection',async()=>{
 const f=fixture(async()=>{throw Error('No providers should be called');});f.set('connections',{items:[{id:'bank',token:'bank',name:'ELGA'}],transactions:[],candidates:[],gmail:null});const r=await(await f.app.handle(f.req('/api/sync',{gmailOnly:true}))).json();assert.match(r.status,/No Gmail/);assert.equal(f.get('connections').items[0].balancesUpdated,undefined);f.db.close();
});

test('SimpleFIN setup is private, encrypted, immediately loads balances, and reconnects without duplicating accounts',async()=>{
 const setup=Buffer.from('https://beta-bridge.simplefin.org/simplefin/claim/sample').toString('base64'),access='https://sf-private-user:sf-private-secret@beta-bridge.simplefin.org/simplefin';
 const f=fixture(async(url,options)=>{assert.equal(options.redirect,'manual');if(url.includes('/claim/'))return new Response(access);assert.ok(!url.includes('sf-private'));assert.match(options.headers.Authorization,/^Basic /);return Response.json({connections:[{conn_id:'i',name:'Indigo'}],accounts:[{id:'card',conn_id:'i',name:'Indigo',currency:'USD',balance:'-123.45','balance-date':Math.floor(Date.now()/1000)}]});});
 assert.equal((await f.app.handle(new Request(f.env.APP_URL+'/api/simplefin/connect',{method:'POST',body:JSON.stringify({token:setup})}))).status,401);
 assert.equal((await f.app.handle(f.req('/api/simplefin/connect',{token:setup},'https://evil.example'))).status,403);
 const connected=await f.app.handle(f.req('/api/simplefin/connect',{token:setup}));assert.equal(connected.status,200);assert.equal(f.get('connections').simplefin.accessUrl,access);
 assert.ok(!f.db.prepare('SELECT value FROM vault WHERE id=?').get('connections').value.includes('sf-private'));
 let publicState=await(await f.app.handle(f.req('/api/state'))).text();assert.ok(!publicState.includes('sf-private'));let data=JSON.parse(publicState);assert.equal(data.state.accounts.length,1);const id=data.state.accounts[0].id;assert.equal(data.connections.simplefin.connected,true);
 assert.equal((await f.app.handle(f.req('/api/simplefin/account',{id,kind:'credit',debtSign:'negative'}))).status,200);assert.equal(f.get('plan').state.accounts[0].balance,12345);
 assert.equal((await f.app.handle(f.req('/api/simplefin/connect',{token:setup}))).status,409);
 assert.equal((await f.app.handle(f.req('/api/simplefin/connect',{token:setup,replace:true}))).status,200);assert.equal(f.get('plan').state.accounts.length,1);assert.equal(f.get('plan').state.accounts[0].type,'credit');
 const member=privateSession(f);assert.equal((await(await f.app.handle(member.req('/api/state'))).json()).connections.simplefin,null);await assert.rejects(()=>f.app.handle(member.req('/api/simplefin/refresh',{})),/Connect SimpleFIN/);
 await f.app.handle(member.req('/api/simplefin/disconnect',{}));assert.equal(f.get('connections').simplefin.accessUrl,access);
 await f.app.handle(f.req('/api/simplefin/disconnect',{}));assert.equal(f.get('connections').simplefin,undefined);assert.equal(f.get('plan').state.accounts.length,0);f.db.close();
});
test('SimpleFIN failed initial fetch keeps its consumed token and scheduled refresh recovers',async()=>{
 let ready=false,calls=0;const access='https://u:p@beta-bridge.simplefin.org/simplefin',f=fixture(async url=>{if(url.includes('/claim/'))return new Response(access);calls++;return ready?Response.json({accounts:[]}):new Response('private upstream error',{status:503});});
 const setup=Buffer.from('https://beta-bridge.simplefin.org/simplefin/claim/sample').toString('base64');await f.app.handle(f.req('/api/simplefin/connect',{token:setup}));let c=f.get('connections');assert.equal(c.simplefin.accessUrl,access);assert.match(c.simplefin.status,/503/);
 ready=true;c.simplefin.nextSync=0;c.simplefin.lastAttempt=Date.now()-300001;f.set('connections',c);await f.app.sync();assert.equal(calls,2);assert.match(f.get('connections').simplefin.status,/Add financial institutions/);f.db.close();
});

import {fakeSunBrowser} from './helpers/sun-browser.mjs';
test('rent browser is authenticated, origin checked, encrypted, and absent from public state',async()=>{
 const f=fixture(),browser=fakeSunBrowser();f.env.BROWSER=browser.binding;const app=runtime(f.env);
 assert.equal((await app.handle(new Request(f.env.APP_URL+'/api/rent/start',{method:'POST'}))).status,401);
 assert.equal((await app.handle(f.req('/api/rent/start',{},'https://evil.example'))).status,403);assert.equal(browser.state.starts.length,0);
 const start=await(await app.handle(f.req('/api/rent/start',{}))).json();assert.match(start.url,/live.browser.run/);
 let view=await(await app.handle(f.req('/api/state'))).text();assert.doesNotMatch(view,/private-live-secret|private-browser/);
 assert.equal((await app.handle(f.req('/api/rent/complete',{}))).status,200);
 const saved=f.get('sun-session');assert.match(saved.session,/sun-access-secret/);assert.ok(!f.db.prepare("SELECT value FROM vault WHERE id='sun-session'").get().value.includes('sun-access-secret'));
 view=await(await app.handle(f.req('/api/state'))).text();assert.doesNotMatch(view,/sun-access-secret|sun-refresh-secret|sun-cookie-secret|property-a/);assert.equal(JSON.parse(view).connections.sun.snapshot.amountDue,102545);
 assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM vault WHERE id='plan' OR id='classic'").get().n,0);
 await app.handle(f.req('/api/rent/disconnect',{}));assert.equal(f.get('sun-session'),null);assert.equal(f.get('connections').sun,undefined);f.db.close();
});
test('rent browser routes cannot access another BearDen account pending sign-in',async()=>{
 const f=fixture(),browser=fakeSunBrowser();f.env.BROWSER=browser.binding;const app=runtime(f.env);await app.handle(f.req('/api/rent/start',{}));
 const identity=googleIdentity({email:'another@example.com',sub:'another',email_verified:true},f.env.ALLOWED_EMAIL),token='v2.private-rent-test',hash=createHash('sha256').update(token).digest('hex');
 f.db.prepare('INSERT INTO sessions VALUES(?,?)').run(hash,Date.now()+60000);f.set('auth-session:'+hash,identity);
 const req=new Request(f.env.APP_URL+'/api/rent/complete',{method:'POST',headers:{Cookie:'bearden='+token,Origin:f.env.APP_URL,'Content-Type':'application/json','X-BearDen-Account':identity.accountId},body:'{}'});
 const result=await app.handle(req);assert.equal(result.status,400);assert.match((await result.json()).error,/expired/);assert.equal(browser.state.calls.length,0);assert.ok(f.get('connections').sun.pending);f.db.close();
});
