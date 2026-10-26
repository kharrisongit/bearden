import test from 'node:test';import assert from 'node:assert/strict';
import {cleanSharedBills,previewSharedBills,importSharedBills} from '../public/bill-sharing.mjs';
import {billSharingAction,billShareKey,billShareLifetime} from '../bill-sharing.mjs';
const water={name:'Water',amount:6400,date:'2026-11-15',repeat:'monthly',billKind:'utility'};
const rent={name:'Rent',amount:72500,date:'2026-11-01',repeat:'monthly',billKind:'rent'};
const bundle={id:'a'.repeat(64),bills:[water,rent],expires:Date.now()+1000};
function store(){const db=new Map();return {db,as(accountId,now=100){const read=async id=>db.get(accountId+':'+id)||null,write=async(id,data)=>db.set(accountId+':'+id,structuredClone(data));return {accountId,now,read,write,rawRead:async id=>db.get(id)||null,rawWrite:async(id,data)=>db.set(id,structuredClone(data)),rawDelete:async id=>db.delete(id)};}};}
test('shared bill templates allow only bill fields and reject invalid money, dates, schedules and oversized lists',()=>{
 assert.deepEqual(cleanSharedBills([{...water,id:'bank-id',emailLinks:'private-email',transactions:'private-bank',notes:'private-notes',paid:true,accountId:'1234',refreshToken:'private-token'}]),[water]);
 for(const item of [{...water,amount:NaN},{...water,amount:-1},{...water,amount:1.2},{...water,date:'2026-02-30'},{...water,name:''},{...water,repeat:'daily'},{...water,billKind:'credit-card'}])assert.throws(()=>cleanSharedBills([item]));
 assert.throws(()=>cleanSharedBills([]));assert.throws(()=>cleanSharedBills(Array(101).fill(water)));
});
test('imports create separate manual bills and preserve recipient accounts, connections and contribution settings',()=>{
 const planner={manual:[{id:'existing',name:'Phone',amount:5000,date:'2026-11-10',repeat:'monthly',source:'manual'}],household:{enabled:true,personalAccountId:'mine',billsAccountId:'shared',personalAmount:40000},emailLinks:{'bill:existing':{mailboxId:'my-inbox'}},transactionLinks:{'bill:existing':{accountId:'my-bank'}},covered:{existing:true},paid:['existing:2026-11-10'],estimates:{},notes:'personal'};
 const before=structuredClone(planner);let id=0;const result=importSharedBills(planner,bundle,[0,1],[],()=>String(++id));assert.deepEqual(planner,before);assert.equal(result.added.length,2);assert.equal(result.planner.manual.length,3);assert.deepEqual(result.planner.household,before.household);assert.deepEqual(result.planner.emailLinks,before.emailLinks);assert.deepEqual(result.planner.transactionLinks,before.transactionLinks);assert.deepEqual(result.planner.paid,before.paid);assert.equal(result.planner.billFunding['manual-1'],'shared');assert.equal(result.planner.sunRentDisabled['manual-2'],true);assert.deepEqual(Object.keys(result.added[0]).sort(),['id','name','amount','date','repeat','billKind','source'].sort());
 result.planner.manual[1].name='My renamed water';const retry=importSharedBills(result.planner,bundle,[0,1],[],()=>String(++id));assert.equal(retry.added.length,0);assert.equal(retry.planner.manual.length,3);
});
test('import skips existing matching schedules while preserving distinct bills and only copies selected rows',()=>{
 const existing={id:'my-water',...water,date:'2026-12-15',source:'manual'},planner={manual:[existing],billFunding:{'my-water':'personal'}};
 assert.equal(previewSharedBills(planner,bundle)[0].existingId,'my-water');
 const result=importSharedBills(planner,bundle,[0,1],[],()=> 'new');assert.equal(result.added.length,1);assert.deepEqual(result.skipped,['Water']);assert.deepEqual(result.planner.manual[0],existing);assert.equal(result.planner.billFunding['my-water'],'personal');
 assert.equal(importSharedBills({},bundle,[1],[],()=> 'selected').added[0].name,'Rent');
 assert.equal(importSharedBills({manual:[{...existing,date:'2026-12-20'}]},bundle,[0],[],()=> 'distinct').added.length,1);
 assert.throws(()=>importSharedBills({},bundle,[2]));assert.throws(()=>importSharedBills({},bundle,[0,0]));assert.throws(()=>previewSharedBills({}, {...bundle,id:'__proto__'}));
});
test('share codes are scoped for management, expire, revoke and replace without exposing owner identity',async()=>{
 const s=store(),owner=s.as('owner'),other=s.as('other');
 const first=await billSharingAction('create',{bills:[water]},owner);assert.match(first.code,/^BD1-[A-Za-z0-9_-]{32}$/);assert.equal(first.expires,100+billShareLifetime);assert.equal(first.ownerId,undefined);
 assert.equal((await billSharingAction('status',{},owner)).code,first.code);assert.equal((await billSharingAction('status',{},other)).code,null);
 const preview=await billSharingAction('preview',{code:first.code},other);assert.deepEqual(preview.bills,[water]);assert.equal(preview.code,undefined);assert.equal(preview.ownerId,undefined);
 await billSharingAction('revoke',{code:first.code},other);assert.equal((await billSharingAction('preview',{code:first.code},other)).bills.length,1);
 const second=await billSharingAction('create',{bills:[rent]},owner);assert.notEqual(second.code,first.code);assert.ok(!s.db.has(billShareKey(first.code)));await assert.rejects(()=>billSharingAction('preview',{code:first.code},other),/expired or was revoked/);
 await assert.rejects(()=>billSharingAction('preview',{code:second.code},s.as('other',second.expires)),/expired/);await billSharingAction('revoke',{},owner);await assert.rejects(()=>billSharingAction('preview',{code:second.code},other),/revoked/);assert.equal((await billSharingAction('status',{},owner)).code,null);
});
