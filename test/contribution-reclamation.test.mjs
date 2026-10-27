import test from 'node:test';
import assert from 'node:assert/strict';
import {contributionReclamationHorizon,contributionReclamationPlan,coverBillShortfalls,thirdPaycheckDates} from '../public/bills-savings.mjs';

const start='2026-10-27',end='2028-01-01',checkedThrough='2029-01-01';
const options={end,buffer:5000,personalStart:'2026-11-06',spouseStart:'2026-11-13',personalContribution:75000,spouseContribution:60000};
const ledger=(opening,rows=[])=>({opening,end:checkedThrough,rows});

test('search ends January 1 after the following calendar year and keeps a later bill guard',()=>{
 assert.deepEqual(contributionReclamationHorizon(start),{end,checkedThrough});
 assert.deepEqual(contributionReclamationHorizon('2027-12-31'),{end:'2029-01-01',checkedThrough:'2030-01-01'});
 assert.deepEqual(contributionReclamationHorizon('2028-02-29'),{end:'2030-01-01',checkedThrough:'2031-01-01'});
 assert.equal(contributionReclamationHorizon('2026-02-29'),null);
});

test('reclamations identify each person, their configured amount, and their own third payday',()=>{
 const f=ledger(1000000),copy=structuredClone(f),r=contributionReclamationPlan(f,start,options);
 assert.equal(r.status,'ready');assert.equal(r.now,0);assert.equal(r.total,345000);
 assert.deepEqual(r.schedule.map(s=>[s.date,s.person,s.amount]),[
  ['2027-01-29','mine',75000],['2027-04-30','spouse',60000],['2027-07-30','mine',75000],['2027-10-29','spouse',60000],['2027-12-31','mine',75000]
 ]);
 assert.deepEqual(f,copy);
});

test('an existing $4.35 dip is allowed below a $50 target and is never topped up',()=>{
 const f=ledger(10000,[{date:'2026-11-01',delta:-9565},{date:'2026-11-06',delta:500000}]);
 const funding=coverBillShortfalls(f,start,{buffer:5000});
 assert.deepEqual(funding.deposits,[]);
 const r=contributionReclamationPlan(funding.forecast,start,options);
 assert.equal(r.status,'ready');assert.equal(r.lowAfter,435);assert.equal(r.lowDate,'2026-11-01');assert.equal(r.total,345000);
});

test('even a one-cent negative balance blocks an unconditional reclamation plan',()=>{
 const f=ledger(10000,[{date:'2026-11-01',delta:-10001},{date:'2026-11-06',delta:500000}]);
 const r=contributionReclamationPlan(f,start,options);
 assert.equal(r.status,'shortfall');assert.equal(r.total,0);assert.equal(r.shortfall.balance,-1);
 const funding=coverBillShortfalls(f,start,{buffer:5000});
 assert.equal(funding.deposits[0].amount,5001);
 assert.ok(contributionReclamationPlan(funding.forecast,start,options).lowAfter>=0);
});

test('same-day bills settle before income and a delayed reclamation keeps its original owner',()=>{
 const f=ledger(10000,[{date:'2027-01-29',delta:-9000},{date:'2027-01-29',delta:10000},{date:'2027-02-01',delta:-10000},{date:'2027-02-02',delta:15000}]);
 const r=contributionReclamationPlan(f,start,{...options,end:'2027-03-01',buffer:1000,personalContribution:10000,spouseContribution:0});
 assert.deepEqual(r.schedule.map(s=>[s.date,s.contributionDate,s.person,s.amount]),[['2027-02-02','2027-01-29','mine',10000]]);
 assert.equal(r.lowAfter,1000);
});

test('shared dates split limited capacity proportionally and never allocate an odd cent twice',()=>{
 const r=contributionReclamationPlan(ledger(10001),start,{...options,end:'2027-03-01',buffer:0,spouseStart:options.personalStart,personalContribution:10000,spouseContribution:10000});
 assert.equal(r.total,10001);assert.deepEqual(r.schedule.map(s=>[s.person,s.amount]),[['mine',5001],['spouse',5000]]);assert.equal(r.lowAfter,0);
});

test('a partially reclaimed contribution keeps its owner when the rest becomes available later',()=>{
 const r=contributionReclamationPlan(ledger(5000,[{date:'2027-02-02',delta:15000}]),start,{...options,end:'2027-03-01',buffer:0,spouseStart:options.personalStart,personalContribution:10000,spouseContribution:10000});
 assert.deepEqual(r.schedule.map(s=>[s.date,s.person,s.amount]),[['2027-01-29','mine',2500],['2027-01-29','spouse',2500],['2027-02-02','mine',7500],['2027-02-02','spouse',7500]]);
 assert.ok(r.schedule.every(s=>s.contributionDate==='2027-01-29'));
});

test('cutoff is inclusive and no new withdrawals are suggested after January 1',()=>{
 const r=contributionReclamationPlan(ledger(0,[{date:end,delta:10000},{date:'2028-01-02',delta:10000}]),start,{...options,buffer:0});
 assert.equal(r.total,10000);assert.ok(r.schedule.every(s=>s.date===end));
});

test('later bills remain reserved beyond the reclamation search cutoff',()=>{
 const r=contributionReclamationPlan(ledger(300000,[{date:'2028-12-31',delta:-280000}]),start,options);
 assert.equal(r.total,15000);assert.equal(r.lowAfter,5000);assert.equal(r.lowDate,'2028-12-31');
});

test('weekly or monthly spouse contributions are not misidentified as third biweekly paychecks',()=>{
 for(const spouseRepeat of ['weekly','monthly']){
  const r=contributionReclamationPlan(ledger(1000000),start,{...options,spouseRepeat});
  assert.ok(r.schedule.every(s=>s.person==='mine'));assert.equal(r.total,225000);
 }
});

test('replaying every suggested withdrawal together never produces a negative event balance',()=>{
 let seed=37;const next=n=>{seed=(seed*1664525+1013904223)>>>0;return seed%n;};
 for(let k=0;k<80;k++){
  const rows=[];
  for(let month=1;month<=12;month++){
   const m=String(month).padStart(2,'0');
   rows.push({date:'2027-'+m+'-05',delta:next(100000)},{date:'2027-'+m+'-15',delta:-next(140000)});
  }
  const f=ledger(next(300000),rows),buffer=next(10000),funding=coverBillShortfalls(f,start,{buffer});
  const r=contributionReclamationPlan(funding.forecast,start,{...options,buffer});
  assert.equal(r.status,'ready');
  const events=[...funding.forecast.rows,...r.schedule.map(s=>({...s,delta:-s.amount,reclaim:true}))].sort((a,b)=>a.date.localeCompare(b.date)||(a.reclaim?3:a.type==='extra-deposit'?0:a.delta<0?1:2)-(b.reclaim?3:b.type==='extra-deposit'?0:b.delta<0?1:2));
  let balance=funding.forecast.opening,low=balance;
  for(const event of events){balance+=event.delta;low=Math.min(low,balance);assert.ok(balance>=0);}
  assert.equal(r.lowAfter,low);assert.equal(r.total,r.schedule.reduce((sum,s)=>sum+s.amount,0));
  for(const [person,anchor,amount]of [['mine',options.personalStart,75000],['spouse',options.spouseStart,60000]]){
   const eligible=thirdPaycheckDates(anchor,start,end);
   for(const row of r.schedule.filter(s=>s.person===person)){assert.ok(eligible.includes(row.contributionDate));assert.ok(row.date>=row.contributionDate&&row.date<=end);}
   for(const date of eligible)assert.ok(r.schedule.filter(s=>s.person===person&&s.contributionDate===date).reduce((sum,s)=>sum+s.amount,0)<=amount);
  }
 }
});
