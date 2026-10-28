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
 const r=await f.app.handle(f.req('/api/bank/refresh',{}));assert.equal(r.status,200);assert.equal(calls.length,3);assert.ok(calls[0].endsWith('/accounts/balance/get'));assert.equal(f.get('connections').items[0].cursor,'new');f.db.close();
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
 const result=await (await f.app.handle(f.req('/api/cards/refresh',{itemId:'card'}))).json();assert.match(result.status,/1 card\(s\) and 0 loan\(s\) returned by Plaid Liabilities/);
 const state=await (await f.app.handle(f.req('/api/state'))).json();assert.equal(state.connections.creditCards[0].minimum,2000);assert.equal(state.connections.creditCards[0].payments[0].amount,4000);assert.equal(state.connections.items.length,2);assert.ok(!JSON.stringify(state).includes('card-token'));assert.ok(f.queries+calls.length<50);assert.equal(calls.length,4);f.db.close();
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
 const member=privateSession(f);await assert.rejects(f.app.handle(member.req('/api/gmail/message',{mailboxId:'mail',id:'mail:oct21'})),/connected account/);assert.equal(calls.length,2);f.db.close();
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
 const f=fixture(async()=>{throw Error('No providers should be called');});f.set('connections',{items:[{id:'bank',token:'bank',name:'ELGA'}],transactions:[],candidates:[],gmail:null});const r=await(await f.app.handle(f.req('/api/sync',{gmailOnly:true}))).json();assert.match(r.status,/No email/);assert.equal(f.get('connections').items[0].balancesUpdated,undefined);f.db.close();
});

test('bank cleanup preserves active Plaid and Lunch Flow accounts, links, and private credentials',async()=>{
 const removed=[];const f=fixture(async(url,options)=>{assert.ok(url.endsWith('/item/remove'));removed.push(JSON.parse(options.body).access_token);return Response.json({});});
 const state=blank();state.accounts=[{id:'plaid-a',source:'plaid',balance:10000},{id:'lunchflow-a',source:'lunchflow',balance:20000},{id:'simplefin-a',source:'simplefin',balance:30000}];
 const planner={debtAccountLinks:{card:'plaid-a'},household:{personalAccountId:'plaid-a',billsAccountId:'lunchflow-a'},accountNames:{'plaid-a':'My bank'},transactionLinks:{rent:{accountId:'plaid-a',itemId:'active'}}};
 const tracker={state:{version:1,values:{'income-planner':JSON.stringify(planner),'app-state':'{"cards":[]}'}},revision:7};f.set('classic',tracker);f.set('plan',{state,revision:2});
 const item={id:'active',token:'active-secret',name:'Bank'},lunchflow={apiKey:'lunch-private',status:'Connected'};
 f.set('connections',{items:[item],lunchflow,simplefin:{accessUrl:'https://old:secret@bridge.simplefin.org/simplefin'},transactions:[{transaction_id:'p',itemId:'active',date:'2026-10-27'},{transaction_id:'l',source:'lunchflow',date:'2026-10-27'},{transaction_id:'s',source:'simplefin',date:'2026-10-27'}],creditCards:[{accountId:'a',itemId:'active',balance:10000}],candidates:[],pendingBankRemovals:[item,{id:'old',token:'old-secret'}]});
 assert.equal((await f.app.handle(f.req('/api/banks/retire',{}))).status,200);
 assert.deepEqual(removed,['old-secret']);assert.deepEqual(f.get('connections').items,[item]);assert.deepEqual(f.get('connections').lunchflow,lunchflow);assert.equal(f.get('connections').creditCards.length,1);assert.equal(f.get('connections').transactions.length,2);assert.equal(f.get('connections').simplefin,undefined);
 assert.deepEqual(f.get('classic'),tracker);assert.deepEqual(f.get('plan').state.accounts.map(a=>a.id),['plaid-a','lunchflow-a']);
 const before=f.get('plan');await f.app.handle(f.req('/api/banks/retire',{}));assert.deepEqual(f.get('plan'),before);assert.deepEqual(removed,['old-secret']);
 const publicState=await(await f.app.handle(f.req('/api/state'))).text();assert.doesNotMatch(publicState,/active-secret|lunch-private|old-secret/);f.db.close();
});
test('previously migrated profiles keep new Plaid links on saves and retired SimpleFIN stays unavailable',async()=>{
 const f=fixture();f.set('connections',{items:[{id:'new-bank',name:'Bank',token:'new-secret'}],bankProvidersRetired:1,retiredBankItemIds:['old-bank'],transactions:[],candidates:[]});
 const planner={debtAccountLinks:{card:'plaid-new'},transactionLinks:{rent:{accountId:'plaid-new',itemId:'new-bank'}},household:{personalAccountId:'plaid-new'}};
 const state={version:1,values:{'income-planner':JSON.stringify(planner)}};
 assert.equal((await f.app.handle(f.req('/api/classic',{state,revision:0}))).status,200);assert.deepEqual(f.get('classic').state,state);
 const plan=blank();plan.accounts=[{id:'plaid-new',source:'plaid',name:'Checking',balance:12300,include:true}];
 assert.equal((await f.app.handle(f.req('/api/state',{state:plan,revision:0}))).status,200);assert.equal(f.get('plan').state.accounts[0].id,'plaid-new');
 await f.app.handle(f.req('/api/banks/retire',{}));assert.deepEqual(f.get('classic').state,state);assert.equal(f.get('connections').items.length,1);
 assert.equal((await f.app.handle(f.req('/api/simplefin/connect',{token:'retired'}))).status,410);
 assert.equal((await f.app.handle(new Request(f.env.APP_URL+'/api/plaid/link',{method:'POST'}))).status,401);
 assert.equal((await f.app.handle(f.req('/api/plaid/link',{},'https://other.example'))).status,403);
 const config=await(await f.app.handle(f.req('/api/config'))).json();assert.equal(config.plaidConfigured,true);assert.deepEqual(config.bankProviders,['lunchflow','plaid']);f.db.close();
});

import {fakeSunBrowser} from './helpers/sun-browser.mjs';
test('rent automatic credentials are encrypted, scoped, write-only, and removed on disconnect',async()=>{
 const f=fixture(),browser=fakeSunBrowser();f.env.BROWSER=browser.binding;browser.state.loggedIn=false;const app=runtime(f.env);
 const credentials={portalUrl:'app.sunwebportal.com',username:'private-resident@example.com',password:'private-test-password'};
 assert.equal((await app.handle(new Request(f.env.APP_URL+'/api/rent/credentials',{method:'POST'}))).status,401);
 assert.equal((await app.handle(f.req('/api/rent/credentials',credentials,'https://evil.example'))).status,403);
 const response=await app.handle(f.req('/api/rent/credentials',credentials));assert.equal(response.status,200);assert.doesNotMatch(await response.text(),/private-resident|private-test-password/);
 assert.equal(f.get('sun-credentials').password,credentials.password);
 assert.doesNotMatch(f.db.prepare("SELECT value FROM vault WHERE id='sun-credentials'").get().value,/private-resident|private-test-password/);
 const publicState=await(await app.handle(f.req('/api/state'))).text();assert.equal(JSON.parse(publicState).connections.sun.automaticLogin,true);assert.doesNotMatch(publicState,/private-resident|private-test-password|sun-access-secret|property-a/);
 assert.equal((await app.handle(f.req('/api/rent/credentials'))).status,405);
 const identity=googleIdentity({email:'second@example.com',sub:'second',email_verified:true},f.env.ALLOWED_EMAIL),token='v2.rent-credentials-second',hash=createHash('sha256').update(token).digest('hex');
 f.db.prepare('INSERT INTO sessions VALUES(?,?)').run(hash,Date.now()+60000);f.set('auth-session:'+hash,identity);
 const other=new Request(f.env.APP_URL+'/api/rent/credentials/remove',{method:'POST',headers:{Cookie:'bearden='+token,Origin:f.env.APP_URL,'Content-Type':'application/json','X-BearDen-Account':identity.accountId},body:'{}'});
 assert.equal((await app.handle(other)).status,200);assert.equal(f.get('sun-credentials').password,credentials.password);
 await app.handle(f.req('/api/rent/disconnect',{}));assert.equal(f.get('sun-credentials'),null);assert.equal(f.get('sun-session'),null);assert.equal(f.get('connections').sun.automaticLogin,false);f.db.close();
});
test('rent failed credential replacements preserve working credentials, session and balance',async()=>{
 const f=fixture(),browser=fakeSunBrowser();f.env.BROWSER=browser.binding;browser.state.loggedIn=false;browser.state.failLogin=true;const app=runtime(f.env);
 const old={portalUrl:'https://app.sunwebportal.com',username:'old@example.com',password:'previous-secret',agreement:'property-a'},session={session:'existing-session',agreement:'property-a'},sun={connected:true,automaticLogin:true,portalUrl:old.portalUrl,snapshot:{currentBalance:10000}};
 f.set('sun-credentials',old);f.set('sun-session',session);f.set('connections',{items:[],transactions:[],candidates:[],sun});
 const result=await app.handle(f.req('/api/rent/credentials',{...old,password:'wrong-secret'}));assert.equal(result.status,400);assert.doesNotMatch(await result.text(),/wrong-secret|previous-secret/);
 assert.deepEqual(f.get('sun-credentials'),old);assert.deepEqual(f.get('sun-session'),session);assert.deepEqual(f.get('connections').sun,sun);
 assert.equal((await app.handle(f.req('/api/rent/credentials',{...old,password:'another'}))).status,429);
 await app.handle(f.req('/api/rent/credentials/remove',{}));assert.equal(f.get('sun-credentials'),null);assert.deepEqual(f.get('sun-session'),session);assert.equal(f.get('connections').sun.automaticLogin,false);f.db.close();
});
test('rent browser is authenticated, origin checked, encrypted, and absent from public state',async()=>{
 const f=fixture(),browser=fakeSunBrowser();f.env.BROWSER=browser.binding;const app=runtime(f.env);
 assert.equal((await app.handle(new Request(f.env.APP_URL+'/api/rent/start',{method:'POST'}))).status,401);
 assert.equal((await app.handle(f.req('/api/rent/start',{},'https://evil.example'))).status,403);assert.equal(browser.state.starts.length,0);
 const start=await(await app.handle(f.req('/api/rent/start',{portalUrl:'app.sunwebportal.com'}))).json();assert.match(start.url,/live.browser.run/);
 let view=await(await app.handle(f.req('/api/state'))).text();assert.doesNotMatch(view,/private-live-secret|private-browser/);
 assert.equal((await app.handle(f.req('/api/rent/complete',{}))).status,200);
 const saved=f.get('sun-session');assert.match(saved.session,/sun-access-secret/);assert.ok(!f.db.prepare("SELECT value FROM vault WHERE id='sun-session'").get().value.includes('sun-access-secret'));
 view=await(await app.handle(f.req('/api/state'))).text();assert.doesNotMatch(view,/sun-access-secret|sun-refresh-secret|sun-cookie-secret|property-a/);assert.equal(JSON.parse(view).connections.sun.snapshot.amountDue,102545);
 assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM vault WHERE id='plan' OR id='classic'").get().n,0);
 await app.handle(f.req('/api/rent/disconnect',{}));assert.equal(f.get('sun-session'),null);assert.equal(f.get('connections').sun.connected,false);assert.equal(f.get('connections').sun.snapshot.amountDue,102545);f.db.close();
});
test('rent browser routes cannot access another BearDen account pending sign-in',async()=>{
 const f=fixture(),browser=fakeSunBrowser();f.env.BROWSER=browser.binding;const app=runtime(f.env);await app.handle(f.req('/api/rent/start',{portalUrl:'app.sunwebportal.com'}));
 const identity=googleIdentity({email:'another@example.com',sub:'another',email_verified:true},f.env.ALLOWED_EMAIL),token='v2.private-rent-test',hash=createHash('sha256').update(token).digest('hex');
 f.db.prepare('INSERT INTO sessions VALUES(?,?)').run(hash,Date.now()+60000);f.set('auth-session:'+hash,identity);
 const req=new Request(f.env.APP_URL+'/api/rent/complete',{method:'POST',headers:{Cookie:'bearden='+token,Origin:f.env.APP_URL,'Content-Type':'application/json','X-BearDen-Account':identity.accountId},body:'{}'});
 const result=await app.handle(req);assert.equal(result.status,400);assert.match((await result.json()).error,/expired/);assert.equal(browser.state.calls.length,0);assert.ok(f.get('connections').sun.pending);f.db.close();
});

test('saved Sun readings use the first for rent without another portal login',async()=>{
 const f=fixture();f.set('connections',{items:[],transactions:[],candidates:[],sun:{connected:true,snapshot:{amountDue:120000,currentBalance:123456,currency:'USD',dueDate:'2026-10-26',checkedAt:Date.parse('2026-10-26T12:00:00Z')}}});
 const data=await(await f.app.handle(f.req('/api/state'))).json();assert.equal(data.connections.sun.snapshot.dueDate,'2026-11-01');assert.equal(data.connections.sun.snapshot.currentBalance,123456);assert.equal((await f.app.handle(f.req('/rent-model.mjs'))).status,200);f.db.close();
});

test('rent settings preserve an existing login and have no default portal for a new profile',async()=>{
 const f=fixture(),saved={session:'existing-private-session',cookies:[]};f.set('sun-session',saved);f.set('connections',{items:[],transactions:[],candidates:[],sun:{connected:true,snapshot:{currentBalance:123456,amountDue:120000,currency:'USD',checkedAt:Date.now()}}});
 const before=await(await f.app.handle(f.req('/api/state'))).json();assert.equal(before.connections.sun.enabled,true);assert.equal(before.connections.sun.portalUrl,'https://app.sunwebportal.com');
 assert.equal((await f.app.handle(f.req('/api/rent/settings',{enabled:false}))).status,200);assert.deepEqual(f.get('sun-session'),saved);assert.equal(f.get('connections').sun.connected,true);assert.equal(f.get('connections').sun.enabled,false);
 await f.app.handle(f.req('/api/rent/settings',{enabled:true}));assert.deepEqual(f.get('sun-session'),saved);
 f.set('connections',{items:[],transactions:[],candidates:[]});await f.app.handle(f.req('/api/rent/settings',{enabled:true}));const fresh=await(await f.app.handle(f.req('/api/state'))).json();assert.equal(fresh.connections.sun.portalUrl,'');assert.equal((await f.app.handle(f.req('/api/rent/start',{}))).status,400);f.db.close();
});


function microsoftFixture(fetcher){const f=fixture(fetcher);f.env.MICROSOFT_CLIENT_ID='ms-client';f.env.MICROSOFT_CLIENT_SECRET='ms-test-secret';f.app=runtime(f.env,fetcher);return f;}
function microsoftCallback(f,state,cookie=''){return new Request(f.env.APP_URL+'/auth/microsoft/callback?code=code&state='+state,{headers:{Cookie:'bearden_microsoft_oauth='+state+(cookie?'; bearden='+cookie:'')}});}
async function microsoftStart(f,path='/auth/microsoft'){const response=await f.app.handle(f.req(path));assert.equal(response.status,302);const url=new URL(response.headers.get('location'));return {response,url,state:url.searchParams.get('state')};}
test('Microsoft-only deployment signs in to an empty private profile without reusing the matching Google owner email',async()=>{
 const calls=[],fetcher=async(url,opts)=>{calls.push(url);if(url.endsWith('/token')){assert.ok(opts.body.get('code_verifier'));assert.equal(opts.body.get('redirect_uri'),'https://bearden.example/auth/microsoft/callback');return Response.json({access_token:'ms-access'});}assert.match(url,/graph.microsoft.com\/v1.0\/me\?/);return Response.json({id:'microsoft-owner-id',mail:'owner@example.com'});};
 const f=microsoftFixture(fetcher);delete f.env.GOOGLE_CLIENT_ID;delete f.env.GOOGLE_CLIENT_SECRET;f.app=runtime(f.env,fetcher);
 f.set('classic',{state:{version:1,values:{notes:'private Google budget'}},revision:3});
 const start=await microsoftStart(f);assert.match(start.response.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);assert.equal(start.url.searchParams.get('prompt'),'select_account');assert.doesNotMatch(start.url.searchParams.get('scope'),/Mail\./);
 const callback=microsoftCallback(f,start.state),response=await f.app.handle(callback);assert.equal(response.status,302);const session=response.headers.get('set-cookie').match(/bearden=([^;]+)/)[1];
 const req=path=>new Request(f.env.APP_URL+path,{headers:{Cookie:'bearden='+session}}),config=await(await f.app.handle(req('/api/config'))).json();assert.equal(config.microsoftConfigured,true);assert.equal(config.googleConfigured,false);assert.equal(config.authenticated,true);assert.notEqual(config.accountId,'owner');
 const data=await(await f.app.handle(req('/api/classic'))).json();assert.deepEqual(data.state.values,{});assert.equal(f.get('classic').state.values.notes,'private Google budget');assert.equal((await f.app.handle(callback)).status,400);assert.equal(calls.length,2);f.db.close();
});
test('Microsoft inbox consent binds the existing session, stays encrypted, and disconnect does not call Google',async()=>{
 let calls=0;const f=microsoftFixture(async url=>{calls++;return url.endsWith('/token')?Response.json({access_token:'ms-access',refresh_token:'private-ms-refresh',scope:'User.Read Mail.Read'}):Response.json({id:'inbox-id',mail:'person@hotmail.com'});});
 const start=await microsoftStart(f,'/auth/microsoft?mail=1&account=owner');assert.match(start.url.searchParams.get('scope'),/Mail.Read/);
 const response=await f.app.handle(microsoftCallback(f,start.state,f.token));assert.equal(response.status,302);assert.doesNotMatch(response.headers.get('set-cookie'),/bearden=v2/);
 const c=f.get('connections'),a=c.outlookAccounts[0];assert.equal(a.email,'person@hotmail.com');assert.equal(a.refreshToken,'private-ms-refresh');assert.doesNotMatch(f.db.prepare("SELECT value FROM vault WHERE id='connections'").get().value,/private-ms-refresh/);
 const state=await(await f.app.handle(f.req('/api/state'))).text();assert.doesNotMatch(state,/private-ms-refresh|refreshToken|microsoftId/);assert.equal(JSON.parse(state).connections.emailConnected,true);
 assert.equal((await f.app.handle(f.req('/api/gmail/disconnect',{id:a.id}))).status,200);assert.equal(f.get('connections').outlookAccounts.length,0);assert.equal(calls,2);f.db.close();
});
test('Microsoft rejects wrong browser state, expired state, wrong provider and switched BearDen session before exchange',async()=>{
 const f=microsoftFixture(async()=>{throw Error('Provider must not be called');});
 const first=await microsoftStart(f);const wrong=microsoftCallback(f,first.state);wrong.headers.set('Cookie','bearden_microsoft_oauth=wrong');assert.equal((await f.app.handle(wrong)).status,400);
 f.db.prepare('UPDATE oauth SET expires=0').run();assert.equal((await f.app.handle(microsoftCallback(f,first.state))).status,400);
 const google=await f.app.handle(f.req('/auth/google')),gState=new URL(google.headers.get('location')).searchParams.get('state');assert.equal((await f.app.handle(microsoftCallback(f,gState))).status,400);
 const ms=await microsoftStart(f);assert.equal((await f.app.handle(new Request(f.env.APP_URL+'/auth/google/callback?code=c&state='+ms.state,{headers:{Cookie:'bearden_oauth='+ms.state}}))).status,400);
 assert.equal((await f.app.handle(f.req('/auth/microsoft?mail=1&account=wrong-account'))).status,409);
 const inbox=await microsoftStart(f,'/auth/microsoft?mail=1&account=owner');assert.equal((await f.app.handle(microsoftCallback(f,inbox.state,'another-session'))).status,403);
 const anon=new Request(f.env.APP_URL+'/auth/microsoft?mail=1');assert.equal((await f.app.handle(anon)).status,401);f.db.close();
});
test('Microsoft declined mailbox scope cannot connect or replace an inbox',async()=>{
 const f=microsoftFixture(async url=>url.endsWith('/token')?Response.json({access_token:'a',refresh_token:'r',scope:'User.Read'}):Response.json({id:'m',mail:'person@hotmail.com'}));
 const start=await microsoftStart(f,'/auth/microsoft?mail=1&account=owner');await assert.rejects(()=>f.app.handle(microsoftCallback(f,start.state,f.token)),/not granted/);assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM vault WHERE id='connections'").get().n,0);f.db.close();
});
test('Microsoft refresh-token rotation survives a selected message provider failure',async()=>{
 const f=microsoftFixture(async url=>url.endsWith('/token')?Response.json({access_token:'a',refresh_token:'rotated'}):Response.json({error:{code:'ErrorItemNotFound'}},{status:404}));
 f.set('connections',{items:[],transactions:[],candidates:[],outlookAccounts:[{id:'ms',provider:'microsoft',email:'person@hotmail.com',refreshToken:'old'}]});
 await assert.rejects(()=>f.app.handle(f.req('/api/gmail/message',{mailboxId:'ms',id:'ms:message='})),/Provider request failed/);assert.equal(f.get('connections').outlookAccounts[0].refreshToken,'rotated');f.db.close();
});

test('bill sharing requires sign-in, origin and current account, and exposes only an encrypted selected template',async()=>{
 const f=fixture(),member=privateSession(f),bills=[{name:'Shared Water',amount:4200,date:'2026-11-10',repeat:'monthly',billKind:'utility',bankToken:'private-bank',mailboxId:'private-mail',accountId:'private-id'}];
 const payload={bills},anonymous=new Request(f.env.APP_URL+'/api/bills/share/create',{method:'POST',headers:{Origin:f.env.APP_URL,'Content-Type':'application/json'},body:JSON.stringify(payload)});
 assert.equal((await f.app.handle(anonymous)).status,401);assert.equal((await f.app.handle(f.req('/api/bills/share/create',payload,'https://evil.example'))).status,403);assert.equal((await f.app.handle(member.req('/api/bills/share/create',payload,'wrong-account'))).status,409);
 const created=await(await f.app.handle(f.req('/api/bills/share/create',payload))).json();assert.ok(created.code);const stored=f.db.prepare("SELECT value FROM vault WHERE id LIKE 'bill-share:%'").get().value;assert.doesNotMatch(stored,/Shared Water/);
 const preview=await(await f.app.handle(member.req('/api/bills/share/preview',{code:created.code}))).json();assert.equal(preview.bills[0].name,'Shared Water');assert.doesNotMatch(JSON.stringify(preview),/private-|ownerId/);
 assert.equal((await(await f.app.handle(member.req('/api/bills/share/status',{}))).json()).code,null);
 const state=await(await f.app.handle(member.req('/api/classic'))).json();assert.deepEqual(state.state.values,{});assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM vault WHERE id LIKE '%connections'").get().n,0);
 await f.app.handle(member.req('/api/bills/share/revoke',{code:created.code}));assert.equal((await f.app.handle(f.req('/api/bills/share/preview',{code:created.code.toLowerCase()}))).status,200);
 await f.app.handle(f.req('/api/bills/share/revoke',{}));await assert.rejects(()=>f.app.handle(member.req('/api/bills/share/preview',{code:created.code})),/not found or expired/);f.db.close();
});

test('Plaid balance failure still refreshes posted transactions and keeps prior balances',async()=>{
 const f=fixture(async url=>url.endsWith('/accounts/get')?Response.json({error_code:'INSTITUTION_NOT_RESPONDING'},{status:400}):url.endsWith('/transactions/sync')?Response.json({added:[{transaction_id:'posted',account_id:'a',date:'2026-10-26',amount:25,pending:false,name:'Lender',iso_currency_code:'USD'}],modified:[],removed:[],next_cursor:'new',has_more:false}):Promise.reject(Error('Unexpected URL')));
 const s=blank();s.accounts=[{id:'plaid-a',itemId:'i',source:'plaid',name:'Bank',balance:12345,include:true}];f.set('plan',{state:s,revision:1});f.set('connections',{items:[{id:'i',name:'Bank',token:'t',cursor:'old'}],transactions:[],candidates:[]});
 await f.app.sync(true);const c=f.get('connections');assert.equal(c.items[0].cursor,'new');assert.equal(c.transactions[0].transaction_id,'posted');assert.equal(c.items[0].balanceError,'INSTITUTION_NOT_RESPONDING');assert.ok(c.items[0].transactionsUpdated);assert.equal(f.get('plan').state.accounts[0].balance,12345);f.db.close();
});
test('mailbox-scoped email refresh checks only the requested connected inbox',async()=>{
 let tokens=[];const f=fixture(async(url,opts)=>{if(url.includes('/token')){tokens.push(String(opts.body));return Response.json({access_token:'access'});}return Response.json({messages:[]});});
 f.set('connections',{items:[],transactions:[],candidates:[],gmailAccounts:[{id:'a',email:'a@example.com',refreshToken:'first'},{id:'b',email:'b@example.com',refreshToken:'second'}]});
 const response=await f.app.handle(f.req('/api/gmail/search',{query:'',mailboxId:'b'}));assert.equal(response.status,200);assert.equal(tokens.length,1);assert.match(tokens[0],/second/);assert.doesNotMatch(tokens[0],/first/);f.db.close();
});


test('manual Plaid refresh drains history pages and preserves each account while remaining within Worker limits',async()=>{
 let page=0;const calls=[],today=new Date().toISOString().slice(0,10);
 const f=fixture(async(url,options)=>{calls.push(url);if(url.endsWith('/accounts/get'))return Response.json({accounts:[{account_id:'a',name:'Checking',type:'depository',subtype:'checking',balances:{current:100,iso_currency_code:'USD'}},{account_id:'b',name:'Loan',type:'loan',balances:{current:1000,iso_currency_code:'USD'}}]});if(url.endsWith('/accounts/balance/get'))return Response.json({accounts:[{account_id:'a',name:'Checking',type:'depository',subtype:'checking',balances:{current:110,iso_currency_code:'USD'}}]});
  const body=JSON.parse(options.body);assert.equal(body.count,500);assert.equal(body.cursor,page?'cursor-'+page:'');page++;return Response.json({added:[{transaction_id:'t'+page,account_id:page%2?'a':'b',date:today,amount:12,pending:false,name:'Purchase',iso_currency_code:'USD'}],modified:[],removed:[],next_cursor:'cursor-'+page,has_more:page<3});});
 f.set('connections',{items:[{id:'bank',name:'Bank',token:'t'}],transactions:[],candidates:[]});const r=await(await f.app.handle(f.req('/api/bank/refresh',{itemId:'bank'}))).json();
 assert.equal(r.transactionsPending,false);assert.equal(page,3);assert.equal(f.get('connections').transactions.length,3);assert.equal(f.get('plan').state.accounts.length,2);assert.ok(f.queries+calls.length<50);f.db.close();
});
test('large Plaid histories continue without repeating balance calls and commit only after the last page',async()=>{
 let page=0,balanceCalls=0;const f=fixture(async url=>{if(url.includes('/accounts/')){balanceCalls++;return Response.json({accounts:[]});}page++;return Response.json({added:[],modified:[],removed:[],next_cursor:'cursor-'+page,has_more:page<7});});
 f.set('connections',{items:[{id:'bank',name:'Bank',token:'t',cursor:'old'}],transactions:[],candidates:[]});let r=await(await f.app.handle(f.req('/api/bank/refresh',{itemId:'bank'}))).json();
 assert.equal(r.transactionsPending,true);assert.equal(page,5);assert.equal(f.get('connections').items[0].cursor,'old');assert.equal(balanceCalls,2);
 r=await(await f.app.handle(f.req('/api/bank/refresh',{itemId:'bank',continueTransactions:true}))).json();assert.equal(r.transactionsPending,false);assert.equal(page,7);assert.equal(balanceCalls,2);assert.equal(f.get('connections').items[0].cursor,'cursor-7');f.db.close();
});
test('empty initial Plaid history is labelled preparing and retried shortly instead of six hours later',async()=>{
 const f=fixture(async url=>url.includes('/accounts/')?Response.json({accounts:[]}):Response.json({added:[],modified:[],removed:[],next_cursor:'',has_more:false}));
 f.set('connections',{items:[{id:'bank',name:'Bank',token:'t'}],transactions:[],candidates:[]});const r=await(await f.app.handle(f.req('/api/bank/refresh',{itemId:'bank'}))).json();assert.equal(r.transactionsLoading,true);assert.equal(r.transactionsPending,false);assert.match(r.status,/preparing/);assert.ok(f.get('connections').items[0].nextSync<Date.now()+16*60000);f.db.close();
});
test('both providers import a second profile’s transactions without reading or changing the original profile',async()=>{
 const today=new Date().toISOString().slice(0,10),stamp=Math.floor(Date.now()/1000)-60;
 const f=fixture(async(url,options)=>{
  if(url.includes('lunchflow.app')){assert.equal(options.headers['x-api-key'],'member-lunchflow-key');if(url.endsWith('/accounts'))return Response.json({accounts:[{id:1,name:'Checking',currency:'USD'}]});if(url.endsWith('/balance'))return Response.json({balance:{amount:50,currency:'USD'}});return Response.json({transactions:[{id:'lf-tx',accountId:1,date:today,amount:-8,currency:'USD',description:'Lunch Flow purchase'}],total:1});}
  assert.equal(JSON.parse(options.body).access_token,'member-bank-token');
  if(url.includes('/accounts/'))return Response.json({accounts:[{account_id:'member-account',name:'Checking',type:'depository',subtype:'checking',balances:{current:100,iso_currency_code:'USD'}}]});
  return Response.json({added:[{transaction_id:'member-tx',account_id:'member-account',date:today,amount:12,pending:false,name:'Member purchase',iso_currency_code:'USD'}],modified:[],removed:[],next_cursor:'done',has_more:false});
 });const member=privateSession(f),key='user:'+member.identity.scope+':connections';
 const owner={items:[{id:'owner-bank',token:'owner-secret'}],transactions:[{transaction_id:'owner-tx',date:today}],candidates:[]};f.set('connections',owner);
 f.set(key,{items:[{id:'member-bank',name:'Member bank',token:'member-bank-token'}],transactions:[],candidates:[],lunchflow:{apiKey:'member-lunchflow-key'}});
 assert.equal((await f.app.handle(member.req('/api/bank/refresh',{itemId:'member-bank'}))).status,200);
 assert.equal((await f.app.handle(member.req('/api/lunchflow/refresh',{}))).status,200);
 const data=await(await f.app.handle(member.req('/api/state'))).json();assert.equal(data.connections.transactions.length,2);assert.equal(data.state.accounts.length,2);assert.ok(data.connections.transactions.some(t=>t.name==='Member purchase'));assert.ok(data.connections.transactions.some(t=>t.name==='Lunch Flow purchase'));assert.deepEqual(f.get('connections'),owner);assert.ok(!JSON.stringify(data).includes('owner-secret'));f.db.close();
});

test('Worker marks lock contention as retryable without bypassing the active lock',async()=>{
 const f=fixture();f.db.prepare('INSERT INTO locks VALUES(?,?,?)').run('sync','other',Date.now()+60000);
 const response=await worker.fetch(f.req('/api/rent/refresh',{}),f.env),data=await response.json();
 assert.equal(response.status,409);assert.equal(data.code,'SYNC_BUSY');assert.equal(f.db.prepare('SELECT owner FROM locks').get().owner,'other');f.db.close();
});

test('existing Plaid loan consent imports principal when general balances are zero and keeps transaction sync separate',async()=>{
 const calls=[];const f=fixture(async(url,options)=>{
  calls.push({path:new URL(url).pathname,body:JSON.parse(options.body)});
  const account={account_id:'auto',name:'Auto',type:'loan',subtype:'auto',balances:{current:0,available:0,iso_currency_code:'USD'}};
  if(url.endsWith('/accounts/get')||url.endsWith('/accounts/balance/get'))return Response.json({accounts:[account],request_id:'balance-request'});
  if(url.endsWith('/liabilities/get'))return Response.json({accounts:[account],liabilities:{loan:[{account_id:'auto',principal_balance:7123.45,account_number:'do-not-expose'}]},request_id:'loan-request'});
  if(url.endsWith('/transactions/sync'))return Response.json({added:[],modified:[],removed:[],next_cursor:'done',has_more:false});
  throw Error('Unexpected endpoint');
 });
 f.set('connections',{items:[{id:'bank',name:'ELGA',token:'private-token'}],transactions:[],candidates:[]});
 const result=await (await f.app.handle(f.req('/api/plaid/updated',{kind:'loan',itemId:'bank'}))).json();assert.match(result.status,/1 loan/);
 const state=await(await f.app.handle(f.req('/api/state'))).json(),loan=state.state.accounts[0];assert.equal(loan.balance,712345);assert.equal(loan.balanceSource,'liabilities');assert.equal(loan.reportedCurrent,0);assert.equal(loan.balanceUnavailable,false);
 assert.ok(calls.every(c=>c.body.access_token==='private-token'));assert.ok(!JSON.stringify(state).includes('private-token'));assert.ok(!JSON.stringify(state).includes('do-not-expose'));assert.equal(f.get('connections').items.length,1);f.db.close();
});
for(const balanceResult of ['unavailable','zero'])test('Plaid empty loan checks persist diagnostics with '+balanceResult+' balances',async t=>{
 const calls=[],priorTime=new Date(Date.now()-3600000).toISOString();
 const f=fixture(async(url,options)=>{
  const path=new URL(url).pathname;calls.push(path);assert.equal(JSON.parse(options.body).access_token,'private-token');
  if(path==='/accounts/get'||path==='/accounts/balance/get')return balanceResult==='unavailable'?Response.json({error_code:'INSTITUTION_NOT_RESPONDING'},{status:400}):Response.json({accounts:[{account_id:'auto',name:'Auto',type:'loan',subtype:'auto',balances:{current:0,available:0,iso_currency_code:'USD'}}],request_id:'balance-request'});
  if(path==='/liabilities/get')return Response.json({accounts:[],liabilities:{},request_id:'empty-loan-request'});
  if(path==='/transactions/sync')return Response.json({added:[],modified:[],removed:[],next_cursor:'done',has_more:false});
  throw Error('Unexpected endpoint '+path);
 });t.after(()=>f.db.close());
 const state=blank(),saved={id:'plaid-auto',itemId:'bank',source:'plaid',name:'Auto',type:'loan',subtype:'auto',currency:'USD',include:false,balance:712345,balanceSource:'liabilities',balanceUnavailable:false,balanceUpdated:priorTime,lastPositiveBalance:712345,lastPositiveBalanceUpdated:priorTime,liabilityPrincipal:712345,liabilityAccountCurrent:0,liabilityUpdated:priorTime,liabilityRequestId:'previous-loan-request'};
 state.accounts=[saved];f.set('plan',{state,revision:3});
 f.set('connections',{items:[{id:'bank',name:'ELGA',token:'private-token',liabilities:true,liabilitiesUpdated:priorTime,liabilitiesAttempt:Date.parse(priorTime),liabilitiesRequestId:'previous-loan-request',balancesUpdated:Date.parse(priorTime)}],loanDetails:[],transactions:[],candidates:[]});
 const started=Date.now(),result=await f.app.handle(f.req('/api/cards/refresh',{itemId:'bank'}));assert.equal(result.status,200);
 const connections=f.get('connections'),persisted=f.get('plan').state.accounts[0],data=await(await f.app.handle(f.req('/api/state'))).json(),loan=data.state.accounts[0],item=data.connections.items[0];
 assert.equal(calls.filter(path=>path==='/liabilities/get').length,1);assert.equal(connections.loanDetails.length,0);assert.equal(item.liabilities,true);
 assert.ok(item.liabilitiesAttempt>=started);assert.equal(item.liabilitiesAttempt,connections.items[0].liabilitiesAttempt);assert.ok(Date.parse(item.liabilitiesUpdated)>=started);
 assert.equal(item.liabilitiesUpdated,connections.items[0].liabilitiesUpdated);assert.equal(item.liabilitiesRequestId,'empty-loan-request');assert.equal(loan.liabilityCheckedAt,item.liabilitiesUpdated);assert.equal(loan.liabilityStatus,'account-not-returned');
 assert.deepEqual(loan,persisted);for(const key of ['balance','liabilityPrincipal','liabilityAccountCurrent','liabilityUpdated','liabilityRequestId'])assert.equal(loan[key],saved[key]);
 if(balanceResult==='unavailable')assert.equal(item.balanceError,'INSTITUTION_NOT_RESPONDING');else assert.equal(loan.zeroUnconfirmed,true);
 assert.equal('token' in item,false);
});
test('Plaid connection diagnosis is scoped, persisted, and excludes raw private payloads',async()=>{
 const f=fixture(async url=>{assert.ok(url.endsWith('/item/get'));return Response.json({item:{institution_id:'ins_elga',available_products:['liabilities'],consented_products:['transactions'],access_token:'private-token',error:null},status:{transactions:{last_successful_update:'2026-10-26T12:00:00Z'}},request_id:'check-request'});});
 f.set('connections',{items:[{id:'bank',name:'ELGA',token:'private-token'}],transactions:[],candidates:[]});
 const response=await f.app.handle(f.req('/api/plaid/diagnose',{itemId:'bank'}));assert.equal(response.status,200);const diagnostic=(await response.json()).diagnostic;assert.equal(diagnostic.loanDetailsSupported,true);assert.ok(!JSON.stringify(diagnostic).includes('private-token'));
 const state=await(await f.app.handle(f.req('/api/state'))).json();assert.equal(state.connections.items[0].diagnostics.requestId,'check-request');assert.equal((await f.app.handle(f.req('/api/plaid/diagnose',{itemId:'other'}))).status,404);f.db.close();
});
