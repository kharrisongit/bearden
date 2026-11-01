import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import {createBugReportStore} from '../bug-reports.mjs';
import worker,{runtime} from '../cloudflare/worker.mjs';
import {APP_RELEASE} from '../public/app-release.mjs';

const input=(submissionId='submission-one')=>({submissionId,title:'Save button does not respond',details:'The button stays disabled after editing a note.',expected:'The note should save.',steps:'Open Notes, edit, select Save.',area:'tools',appVersion:'test-version',diagnostics:{browser:'Test browser',viewport:'390x844',secret:'not copied'},status:'fixed',accountId:'owner'});
function storeFixture(){const data=new Map(),release={id:'release-one',title:'Test update',notes:[],fixedReportIds:[]};let tail=Promise.resolve();const store=createBugReportStore({read:async(key,fallback)=>structuredClone(data.get(key)??fallback),write:async(key,value)=>data.set(key,structuredClone(value)),locked:fn=>{const task=tail.then(fn);tail=task.catch(()=>{});return task;},release,now:()=>Date.parse('2026-11-01T12:00:00Z')});return {data,release,store};}
function workerFixture(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync('cloudflare/schema.sql','utf8'));
 const env={DATA_KEY:randomBytes(32).toString('base64'),APP_URL:'https://bearden.example',ALLOWED_EMAIL:'owner@example.com',GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'secret',DB:{prepare(sql){return {bind(...args){return {async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){return {meta:{changes:Number(db.prepare(sql).run(...args).changes)}};}};}};}},ASSETS:{fetch:async()=>new Response('test asset')}};
 const app=runtime(env),hash=value=>createHash('sha256').update(value).digest('hex');
 function set(key,value){db.prepare('INSERT OR REPLACE INTO vault VALUES(?,?)').run(key,app.encrypt(value));}
 const ownerToken='v2.owner-test',memberToken='v2.member-test';
 for(const [token,identity]of [[ownerToken,{scope:'',accountId:'owner',email:'owner@example.com',sessionVersion:2}],[memberToken,{scope:'member',accountId:'member',email:'member@example.com',sessionVersion:2}]]){db.prepare('INSERT INTO sessions VALUES(?,?)').run(hash(token),Date.now()+60000);set('auth-session:'+hash(token),identity);}
 async function call(path,{body,account='owner',token,origin=env.APP_URL}={}){const headers={'Content-Type':'application/json'};if(account){headers.Cookie='bearden='+(account==='owner'?ownerToken:memberToken);headers['X-BearDen-Account']=account;}if(token)headers.Authorization='Bearer '+token;if(origin)headers.Origin=origin;return worker.fetch(new Request(env.APP_URL+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)}),env);}
 return {db,env,set,call,get:key=>app.decrypt(db.prepare('SELECT value FROM vault WHERE id=?').get(key).value)};
}

test('reports are isolated, encrypted, idempotent, and independent from financial records',async()=>{
 const f=workerFixture();try{
  const finance={state:{values:{balance:'1234'}},revision:7};f.set('classic',finance);f.set('plan',{revision:3});f.set('connections',{private:'bank token'});
  const before=f.db.prepare("SELECT id,value FROM vault WHERE id IN ('classic','plan','connections') ORDER BY id").all();
  const first=await(await f.call('/api/bug-reports',{body:input()})).json(),retry=await(await f.call('/api/bug-reports',{body:input()})).json();assert.equal(retry.report.id,first.report.id);assert.equal(first.report.status,'new');assert.equal(first.report.accountId,undefined);assert.equal(first.report.diagnostics.secret,undefined);
  const second=await(await f.call('/api/bug-reports',{account:'member',body:input()})).json();assert.notEqual(second.report.id,first.report.id);
  const member=await(await f.call('/api/bug-reports',{account:'member'})).json();assert.deepEqual(member.reports.map(r=>r.id),[second.report.id]);
  const admin=await(await f.call('/api/bug-reports/admin')).json();assert.equal(admin.reports.length,2);assert.deepEqual(admin.release,APP_RELEASE);assert.ok(!JSON.stringify(admin).includes('example.com'));
  assert.ok(!f.db.prepare('SELECT value FROM vault WHERE id=?').get('bug-report:'+first.report.id).value.includes('Save button'));
  await f.call('/api/app-release/ack',{body:{releaseId:APP_RELEASE.id}});
  assert.deepEqual(f.db.prepare("SELECT id,value FROM vault WHERE id IN ('classic','plan','connections') ORDER BY id").all(),before);
 }finally{f.db.close();}
});

test('report endpoints enforce real sessions, owner role, account header, and origin',async()=>{
 const f=workerFixture();try{
  for(const path of ['/api/bug-reports','/api/bug-reports/admin','/api/bug-reports/automation','/api/support/reports','/api/app-release'])assert.equal((await f.call(path,{account:null})).status,401,path);
  for(const path of ['/api/bug-reports/admin','/api/bug-reports/automation'])assert.equal((await f.call(path,{account:'member'})).status,403,path);
  assert.equal((await f.call('/api/support/reports',{account:'member'})).status,401);
  assert.equal((await f.call('/api/support/reports')).status,200);
  assert.equal((await f.call('/api/bug-reports',{body:input(),origin:'https://elsewhere.example'})).status,403);
  assert.equal((await f.call('/api/bug-reports',{body:input(),account:'stale-account'})).status,409);
  assert.equal((await f.call('/api/bug-reports/status',{body:{},account:'member'})).status,403);
  assert.equal((await f.call('/api/bug-reports/automation',{body:{action:'enable'},account:'member'})).status,403);
 }finally{f.db.close();}
});

test('reporting bearer tokens are revocable and cannot authorize financial routes',async()=>{
 const f=workerFixture();try{
  const report=(await(await f.call('/api/bug-reports',{body:input()})).json()).report;
  const issued=await(await f.call('/api/bug-reports/automation',{body:{action:'enable'}})).json();assert.match(issued.token,/^bdr_/);assert.equal(issued.connected,false);
  assert.equal((await(await f.call('/api/app-release')).json()).automationEnabled,false);
  const noToken=await(await f.call('/api/bug-reports/automation',{body:{action:'enable'}})).json();assert.equal(noToken.token,undefined);
  const token=issued.token;assert.equal((await f.call('/api/support/reports',{account:null,token})).status,200);
  for(const path of ['/api/classic','/api/state','/api/bug-reports/automation'])assert.equal((await f.call(path,{account:null,token})).status,401,path);
  assert.equal((await f.call('/api/support/reports/status',{account:null,token,origin:'https://elsewhere.example',body:{id:report.id,revision:1,status:'investigating'}})).status,403);
  assert.equal((await f.call('/api/support/reports/status',{account:null,token,origin:null,body:{id:report.id,revision:1,status:'investigating',response:'Checking the save action.'}})).status,200);
  const rotated=await(await f.call('/api/bug-reports/automation',{body:{action:'rotate'}})).json();assert.notEqual(rotated.token,token);assert.equal((await f.call('/api/support/reports',{account:null,token})).status,401);
  await f.call('/api/bug-reports/automation',{body:{action:'revoke'}});assert.equal((await f.call('/api/support/reports',{account:null,token:rotated.token})).status,401);
 }finally{f.db.close();}
});

test('report status checks revisions and deployed fixes remain fixed across later releases',async()=>{
 const {store,release}=storeFixture(),report=(await store.submit('member',input())).report;
 await assert.rejects(store.update({id:report.id,revision:0,status:'investigating'}),{status:409});
 await assert.rejects(store.update({id:report.id,revision:1,status:'fixed'}),{status:409});
 release.fixedReportIds.push(report.id);assert.equal((await store.list({admin:true})).reports[0].status,'new');
 const fixed=(await store.update({id:report.id,revision:1,status:'fixed',response:'Fixed the save action.'})).report;assert.equal(fixed.fixedInRelease,'release-one');
 release.id='release-two';release.fixedReportIds=[];
 const edited=(await store.update({id:report.id,revision:2,status:'fixed',response:'The fix is live.'})).report;assert.equal(edited.fixedInRelease,'release-one');assert.equal((await store.list({accountId:'member'})).reports[0].status,'fixed');
});

test('report validation and rate limits bound submissions without blocking idempotent retries',async()=>{
 const {store,data}=storeFixture();await assert.rejects(store.submit('owner',{...input(),title:'x'.repeat(121)}),{status:400});await assert.rejects(store.submit('owner',{...input(),area:'arbitrary'}),{status:400});
 await Promise.all(Array.from({length:10},(_,n)=>store.submit('owner',input('submission-'+n))));
 await assert.rejects(store.submit('owner',input('submission-over-limit')),{status:429});assert.equal((await store.submit('owner',input('submission-0'))).report.status,'new');
 assert.equal((await store.list({accountId:'owner',limit:3})).reports.length,3);assert.equal(data.get('bug-reports:index').length,10);
});

test('release acknowledgements are account-specific and a configured task is distinct from a token',async()=>{
 const {store,release}=storeFixture();assert.equal((await store.appRelease('owner')).acknowledged,false);
 await assert.rejects(store.acknowledge('owner',{releaseId:'stale'}),{status:409});await store.acknowledge('owner',{releaseId:release.id});assert.equal((await store.appRelease('owner')).acknowledged,true);assert.equal((await store.appRelease('member')).acknowledged,false);
 await store.manage({action:'connect',taskId:'task_123'});assert.deepEqual(await store.automation(),{enabled:false,connected:true,taskId:'task_123',mode:'session'});assert.equal((await store.appRelease('owner')).automationEnabled,true);
 await store.manage({action:'enable'});await store.manage({action:'rotate'});await store.manage({action:'revoke'});assert.equal((await store.automation()).connected,true);
 await store.manage({action:'enable'});await store.manage({action:'connect',taskId:'task_456',mode:'token'});await store.manage({action:'rotate'});assert.equal((await store.automation()).connected,false);
 release.id='release-two';assert.equal((await store.appRelease('owner')).acknowledged,false);
});
