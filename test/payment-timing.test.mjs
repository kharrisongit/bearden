import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import * as payments from '../public/debt-payments.mjs';
import {paydayEvents} from '../public/income-model.mjs';
const settings={mode:'due-date',leadDays:3},card={id:1,name:'Card',balance:10000,apr:0,min:46.15,monthlyMinimum:100,dueDate:'2026-11-15'};
const source=readFileSync('public/classic.js','utf8'),calculate=source.slice(source.indexOf('function calculate('),source.indexOf('\nfunction fmtDate('));
function plan({cards=[card],method='minimum',overrides={},history={},interestHistory={},terms={},checked={},timing=settings,income=1000,start='2026-11-06'}={}){
 const fields={takeHome:{value:String(income)},startDate:{value:start}};
 const ctx=vm.createContext({window:{BearDenDebtPayments:payments,debtPaymentSettings:timing,debtPaymentHistory:history,debtInterestHistory:interestHistory,syncedDebtTerms:terms,dispatchEvent(){},syncedDebtBalances:{}},document:{getElementById:id=>fields[id]||null},Event,cardsData:structuredClone(cards),paycheckSlices:{},paycheckSquashes:{},budgetItems:[],currentPayoffMethod:method,savingsGoals:[],paycheckOverrides:{},appliedBonuses:{},checkedPaychecks:checked,budgetItemOverrides:{},savingsContributionOverrides:{},extraExpenses:{},accountPaymentOverrides:overrides,queueSaveAppState(){},payoffActionPayment(){throw Error('Unexpected action');}});
 ctx.renderResults=(cards,schedule)=>ctx.result={cards,schedule};vm.runInContext(calculate+'\ncalculate()',ctx);return ctx.result;
}
const plain=value=>JSON.parse(JSON.stringify(value));
test('due-date mode schedules one full monthly payment before each buffer and keeps unused checks free',()=>{
 const p=plan();assert.deepEqual(plain(p.schedule.slice(0,5).map(r=>r.payments[0])),[100,0,100,0,100]);assert.equal(p.schedule[1].cashAfterDebt,1000);
 assert.equal(p.schedule[0].debtTiming[0].dueDate,'2026-11-15');
 const legacy=plan({timing:{mode:'every-paycheck'}});assert.deepEqual(plain(legacy.schedule.slice(0,3).map(r=>r.payments[0])),[46.15,46.15,46.15]);
});
test('month-end due days clamp through February and leap years without drifting',()=>{
 const c={...card,dueDate:'2028-01-31'};
 assert.equal(payments.scheduledPayment(c,'2028-02-18','2028-01-07',settings).dueDate,'2028-02-29');
 assert.equal(payments.scheduledPayment(c,'2028-03-17','2028-01-07',settings).dueDate,'2028-03-31');
 assert.equal(payments.scheduledPayment(c,'2027-02-19','2027-01-08',settings).dueDate,'2027-02-28');
 assert.equal(payments.validDueDate('2026-02-30'),false);
});
test('a buffer deadline on the next payday belongs to that payday, and a late starting plan warns',()=>{
 const c={...card,dueDate:'2026-11-23'};
 assert.equal(payments.scheduledPayment(c,'2026-11-06','2026-11-06',settings).scheduled,false);
 assert.equal(payments.scheduledPayment(c,'2026-11-20','2026-11-06',settings).scheduled,true);
 const late=payments.scheduledPayment({...card,dueDate:'2026-11-07'},'2026-11-06','2026-11-06',settings);assert.equal(late.late,true);assert.equal(late.minimum,100);
});
test('missing dates safely retain every-paycheck payments with a visible warning flag',()=>{
 const p=plan({cards:[{...card,dueDate:''}]});assert.equal(p.schedule[0].payments[0],46.15);assert.equal(p.schedule[0].debtTiming[0].missingDate,true);
});
test('snowball and avalanche only allocate extras to eligible debts and keep their priority',()=>{
 const cards=[{...card,balance:2000,apr:10},{...card,id:2,name:'High APR',balance:5000,apr:30},{...card,id:3,balance:50,apr:90,dueDate:'2026-11-30'}];
 const snow=plan({cards,method:'snowball'}),ava=plan({cards,method:'avalanche'});
 assert.deepEqual(plain(snow.schedule[0].payments),[900,100,0]);assert.deepEqual(plain(ava.schedule[0].payments),[100,900,0]);
 assert.equal(snow.schedule[0].naturalPayments[2],0);assert.equal(ava.schedule[0].naturalPayments[2],0);
});
test('manual payments work on off checks; completed payments survive a timing change; insufficient income stays visible',()=>{
 const p=plan({overrides:{1:{2:75}},history:{1:{1:40}},checked:{1:true}});
 assert.deepEqual(plain(p.schedule.slice(0,3).map(r=>r.payments[0])),[40,75,100]);
 const short=plan({income:60});assert.equal(short.schedule[0].payments[0],100);assert.equal(short.schedule[0].cashAfterDebt,-40);
 const tiny=plan({cards:[{...card,balance:20}]});assert.equal(tiny.schedule[0].payments[0],20);
});
test('minimum-only forecast follows the same dates even after the full payoff plan ends',()=>{
 const p=plan(),state={cards:[card],startDate:'2026-11-06',takeHome:1000,debtPaymentSettings:settings};
 const events=paydayEvents({state,schedule:p.schedule.slice(0,1)},'2026-11-06','2026-12-05',{debtMode:'minimum'});
 assert.deepEqual(events.map(e=>e.allocations),[10000,0,10000]);
});

test('synced minimum, due date and APR affect future checks while recorded amounts and interest remain intact',()=>{
 const terms={1:{date:'2026-11-20',monthlyMinimum:200,dueDate:'2026-11-30',apr:26}},p=plan({terms,checked:{1:true},history:{1:{1:75}},interestHistory:{1:{1:12}}});
 assert.equal(p.schedule[0].payments[0],75);assert.equal(p.schedule[0].interestByAccount[0],12);
 assert.equal(p.schedule[1].payments[0],200);assert.equal(p.schedule[1].debtTiming[0].dueDate,'2026-11-30');assert.ok(p.schedule[1].interestByAccount[0]>90);
 const events=paydayEvents({state:{cards:[card],startDate:'2026-11-06',takeHome:1000,debtPaymentSettings:settings},schedule:[],syncedDebtTerms:terms},'2026-11-06','2026-12-05',{debtMode:'minimum'});
 assert.deepEqual(events.map(e=>e.allocations),[10000,20000,0]);
});

test('payment warnings begin after the actual due date, never inside the buffer or for a completed payment',()=>{
 const timing={dueDate:'2026-11-07',late:true};
 for(const today of ['2026-11-04','2026-11-06','2026-11-07'])assert.equal(payments.paymentIsLate(timing,'2026-11-06',today,false,100),false);
 assert.equal(payments.paymentIsLate(timing,'2026-11-06','2026-11-08',false,100),true);
 assert.equal(payments.paymentIsLate(timing,'2026-11-06','2026-11-08',true,100),false);
 assert.equal(payments.paymentIsLate(timing,'2026-11-06','2026-11-08',false,0),false);
 assert.equal(payments.paymentIsLate({},'2026-11-06','2026-11-08',false,100),false);
});
