import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDebtTerms,reviewedTermSource} from '../public/debt-terms.mjs';
import {resolveDebtDetails} from '../public/connection-model.mjs';

const card={id:17,name:'Example card',balance:437.19,apr:22,min:18.46,monthlyMinimum:40,dueDate:'2026-11-20',debtKind:'credit-card',payoffHistory:[{date:'2026-06-01',interestPaid:12.34}],lifetimeInterestPaid:12.34,cycleStartPaycheck:8,providerId:'private-link'};
const source={asOf:'2026-10-15',label:'Reviewed October statement'};
const patch={apr:24,monthlyMinimum:35,termsSource:source,interestRules:{profileId:'credit-one',closingDay:15,grace:'unknown',balanceBasis:'principal'},minimumRules:{profileId:'credit-one'}};

test('terms-only changes preserve balances, identity, links and history even when a patch contains them',()=>{
 const before=structuredClone(card),change={...patch,balance:9999,name:'Wrong account',id:88,dueDate:'2020-01-01',payoffHistory:[],lifetimeInterestPaid:0,providerId:'other',syncedDebtBalances:{17:{balance:0}}};
 const next=applyDebtTerms(card,change);
 assert.deepEqual(card,before);
 for(const key of ['balance','name','id','dueDate','payoffHistory','lifetimeInterestPaid','cycleStartPaycheck','providerId'])assert.deepEqual(next[key],before[key]);
 assert.equal('syncedDebtBalances' in next,false);
 assert.equal(next.apr,24);assert.equal(next.monthlyMinimum,35);assert.equal(next.min,16.15);assert.equal(next.lastPositiveMonthlyMinimum,35);
 assert.deepEqual(next.termsSource.fields.apr,source);assert.deepEqual(next.termsSource.fields.monthlyMinimum,source);
});

test('updating an APR source does not redate an untouched monthly payment',()=>{
 const initial=applyDebtTerms(card,patch),next=applyDebtTerms(initial,{apr:25,termsSource:{asOf:'2026-10-30',label:'Later rate notice'}});
 assert.equal(reviewedTermSource(next,'apr').asOf,'2026-10-30');assert.equal(reviewedTermSource(next,'monthlyMinimum').asOf,'2026-10-15');
 assert.equal(next.monthlyMinimum,35);assert.equal(next.balance,card.balance);
});

test('historical statement due date stays in source metadata and never replaces the current due date',()=>{
 const next=applyDebtTerms(card,{...patch,termsSource:{...source,statementDueDate:'2026-10-28'}});
 assert.equal(next.dueDate,card.dueDate);assert.equal(next.balance,card.balance);
 assert.equal(next.termsSource.statementDueDate,'2026-10-28');assert.equal(next.termsSource.fields.monthlyMinimum.statementDueDate,'2026-10-28');
 assert.throws(()=>applyDebtTerms(card,{termsSource:{...source,statementDueDate:'2026-02-30'}}));
});

test('interest and fee rules reject incomplete or invalid inputs without changing the account',()=>{
 const before=structuredClone(card);
 for(const invalid of [{apr:-1},{apr:101},{monthlyMinimum:''},{termsSource:{asOf:'2026-02-30'}},{interestRules:{profileId:'guess-by-name'}},{interestRules:{closingDay:32}},{interestRules:{closingDay:1.5}},{interestRules:{grace:'always-free'}},{interestRules:{fixedFees:[{date:'',amount:10,repeat:'monthly'}]}},{interestRules:{fixedFees:[{date:'2026-12-01',amount:10,repeat:'weekly'}]}},{minimumRules:{profileId:'unverified'}}])assert.throws(()=>applyDebtTerms(card,invalid));
 assert.deepEqual(card,before);
 const next=applyDebtTerms(card,{interestRules:{profileId:'affirm',balanceBasis:'unknown',financeChargeCap:12.34,fixedFees:[],balance:555},minimumRules:{profileId:'installment'}});
 assert.equal(next.interestRules.balanceBasis,'unknown');assert.equal(next.interestRules.financeChargeCap,12.34);assert.equal('balance' in next.interestRules,false);
});

const now=Date.parse('2026-11-01T12:00:00Z');
const bank={id:'plaid-example',itemId:'bank',source:'plaid',currency:'USD',balance:21987,balanceUpdated:'2026-11-01T10:00:00Z'};
const issuer={id:'credit-example',accountId:'example',itemId:'bank',currency:'USD',minimum:3000,dueDate:'2026-11-24',aprs:[{type:'purchase_apr',rate:21}],updated:'2026-10-01T10:00:00Z'};

test('dated reviewed terms replace older term observations while keeping the current connected balance',()=>{
 const next=applyDebtTerms(card,patch),resolved=resolveDebtDetails({card:next,primary:bank,issuers:[issuer],now});
 assert.equal(resolved.apr.value,24);assert.equal(resolved.monthlyMinimum.value,3500);assert.equal(resolved.apr.source,source.label);
 assert.equal(resolved.balance.value,21987);assert.equal(resolved.balance.source,'Plaid');assert.equal(resolved.currentCycleMinimum,false);
});

test('newer provider terms and a fresh paid-cycle zero win over a reviewed statement',()=>{
 const next=applyDebtTerms(card,patch),fresh={...issuer,minimum:0,updated:'2026-11-01T10:00:00Z'};
 const resolved=resolveDebtDetails({card:next,primary:bank,issuers:[fresh],now});
 assert.equal(resolved.apr.value,21);assert.equal(resolved.monthlyMinimum.value,0);assert.equal(resolved.currentCycleMinimum,true);
 assert.equal(resolved.forecastMinimum.value,3500);assert.equal(resolved.balance.value,bank.balance);
 const newerDate=applyDebtTerms(card,{...patch,termsSource:{asOf:'2026-11-01',label:'New statement'}});
 const priorDayPaid={...fresh,updated:'2026-10-31T18:00:00Z'};
 assert.equal(resolveDebtDetails({card:newerDate,primary:bank,issuers:[priorDayPaid],now}).monthlyMinimum.value,0);
});

test('a newer email can update reviewed APR and payment terms without using its old closing balance',()=>{
 const next=applyDebtTerms(card,patch),statement={receivedAt:'2026-10-25T10:00:00Z',apr:23,minimum:4500,balance:90000,dueDate:'2026-11-25'};
 const resolved=resolveDebtDetails({card:next,primary:bank,issuers:[issuer],statement,now});
 assert.equal(resolved.apr.value,23);assert.equal(resolved.monthlyMinimum.value,4500);assert.equal(resolved.balance.value,bank.balance);
});
