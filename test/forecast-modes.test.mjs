import test from 'node:test';
import assert from 'node:assert/strict';
import {scenarioForecast,paydayEvents,cashForecast} from '../public/income-model.mjs';
const accounts=[{balance:161077,include:true,currency:'USD'}];
const start='2026-10-25';
const plan=()=>({state:{startDate:'2026-11-06',takeHome:2000,cards:[{id:1,balance:3000,apr:0,min:50},{id:2,balance:5000,apr:0,min:75}],budgetItems:[{label:'Rent',amount:600}],checkedPaychecks:{}},schedule:[1,2].map((n)=>({paycheck:n,date:n===1?'2026-11-06':'2026-11-20',takeHomeThisCheck:2000,bonusAmount:0,budgetLineItemsThisCheck:[{label:'Rent',amount:600}],extrasThisCheck:[],payments:[700,700],savingsByGoal:[]}))});
const bills=[{id:'car',key:'car:2026-11-01',name:'Car payment',date:'2026-11-01',amount:30000,billKind:'car-payment',type:'bill',covered:false},{id:'card',name:'Other card',date:'2026-11-05',amount:3000,billKind:'credit-card',type:'bill',covered:false},{id:'matched',name:'Matched card',date:'2026-11-06',amount:5000,source:'plaid-credit',type:'bill',covered:true}];
test('three forecast modes preserve income, opening balance and bills, without changing the plan',()=>{
 const p=plan(),before=structuredClone(p),full=scenarioForecast(accounts,p,bills,start),min=scenarioForecast(accounts,p,bills,start,{debtMode:'minimum'}),none=scenarioForecast(accounts,p,bills,start,{debtMode:'none'});
 for(const f of [full,min,none]){assert.equal(f.income,400000);assert.equal(f.opening,161077);assert.ok(f.rows.some(r=>r.id==='car'));}
 assert.equal(full.outgoing,433000);assert.equal(min.outgoing,178000);assert.equal(none.outgoing,150000);
 assert.equal(min.endBalance,383077);assert.equal(none.endBalance,411077);assert.deepEqual(p,before);
 const existing=cashForecast(accounts,paydayEvents(p,start,'2026-11-24',{billsOnly:true}),bills,start);
 assert.deepEqual({...full,debtMode:undefined},{...existing,debtMode:undefined});
});
test('minimums continue after the accelerated plan ends and cap at what remains',()=>{
 const p=plan();p.state.cards=[{id:1,balance:80,apr:0,min:50}];p.schedule=[{...p.schedule[0],payments:[80]}];
 const f=scenarioForecast(accounts,p,[],start,{debtMode:'minimum'});
 assert.deepEqual(f.rows.map(r=>r.allocations),[65000,63000]);
 assert.equal(scenarioForecast(accounts,p,[],start,{debtMode:'full'}).outgoing,128000);
});
test('minimum simulation includes interest, checked payments, and zero remaining debts',()=>{
 const p=plan();p.state.cards=[{id:1,balance:100,apr:26,min:50},{id:2,balance:30,apr:0,min:30}];
 p.state.startDate='2026-10-23';p.state.checkedPaychecks={1:true};
 p.schedule=[{paycheck:1,date:'2026-10-23',payments:[50,30],interestByAccount:[1,0]}];
 const f=scenarioForecast(accounts,p,[],start,{debtMode:'minimum'});
 assert.equal(f.rows.length,2);assert.deepEqual(f.rows.map(r=>r.allocations),[65000,60153]);
});
test('overrides, saved net bonuses and extra expenses remain in every comparison',()=>{
 const p=plan();p.schedule=[];p.state.paycheckOverrides={1:2400};p.state.appliedBonuses={2:751};p.state.extraExpenses={1:[{label:'Repair',amount:100}]};p.state.budgetItems[0].id=7;p.state.budgetItemOverrides={7:{2:650}};
 for(const debtMode of ['full','minimum','none']){const f=scenarioForecast(accounts,p,[],start,{debtMode});assert.equal(f.income,515100);assert.equal(f.outgoing,debtMode==='minimum'?160000:135000);}
});
test('no debt excludes loans and card payments but keeps both car payments',()=>{
 const b=[...bills,{...bills[0],id:'second-car',amount:40000},{id:'loan',date:'2026-11-02',name:'Loan',type:'bill',amount:20000,billKind:'loan'}];
 const f=scenarioForecast(accounts,plan(),b,start,{debtMode:'none'});assert.equal(f.outgoing,190000);assert.equal(f.rows.filter(r=>r.billKind==='car-payment').length,2);assert.ok(!f.rows.some(r=>r.id==='loan'||r.id==='card'));
});
test('invalid comparison defaults to full and missing balances remain unknown',()=>{
 assert.deepEqual(scenarioForecast([],plan(),[],start,{debtMode:'invalid'}),scenarioForecast([],plan(),[],start));assert.equal(scenarioForecast([],plan(),[],start,{debtMode:'none'}).endBalance,null);
});
