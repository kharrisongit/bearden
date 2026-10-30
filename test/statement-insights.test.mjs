import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStatement,analyzeStatement,readCents} from '../public/statement-model.mjs';
import {textFromItems} from '../public/statement-reader.mjs';
import {validateClassic} from '../classic-state.mjs';

// Fictional utility history; no customer document or account data belongs here.
const costs=[24000,29000,27500,28000,21000,20500,24000,34000,42000,33000,26000,20000];
const history=costs.map((amount,i)=>({month:i===0?'2025-12':`2026-${String(i).padStart(2,'0')}`,amount,included:true}));

test('annual costs, seasonal budget, reserve and adjustable simulation agree in cents',()=>{
 const a=analyzeStatement(history);
 assert.equal(a.total,329000);assert.equal(a.average,27417);assert.equal(a.complete,true);
 assert.equal(a.budget,27500);assert.equal(a.suggestedReserve,40000);assert.equal(a.seasonalDraw,26500);assert.equal(a.surplus,1000);
 assert.deepEqual(a.highestStretch.rows.map(r=>r.month),['2026-07','2026-08','2026-09']);
 const july=analyzeStatement(history,{budget:30000,reserve:40000,startMonth:7});
 assert.equal(july.simulation[2].balance,21000);assert.equal(july.minBalance,21000);
 const low=analyzeStatement(history,{budget:25000,reserve:0,startMonth:7});
 assert.equal(low.surplus,-29000);assert.ok(low.minBalance<0);
 assert.equal(analyzeStatement([{month:'2026-01',amount:25001}]).suggestedBudget,27500);
});
test('Consumers itemized history excludes old balances and short cycles, keeping latest twelve months',()=>{
 const row=(month,amount,days=30)=>`Current Bill(123456) - ${month}\nElectric 00000000 01/01/2026 01/30/2026 ${days} 100 200 ACTUAL 100 3 $${(amount/100-10).toFixed(2)}\nGas 00000000 01/01/2026 01/30/2026 ${days} 100 100 ACTUAL 0 0 $8.00\nTax $2.00\nTotal Current Bill due on or before\n02/28/2026 $${(amount/100).toFixed(2)}\nTotal Amount Due $999.00\nPayment Received $999.00- 02/28/2026\nTransfer In - Electric $500.00`;
 const raw=row('Nov 2025',20000)+ '\n'+row('Dec 2025',4000,4)+'\n'+history.map(r=>row(new Date(r.month+'-15T12:00:00Z').toLocaleDateString('en-US',{month:'short',year:'numeric'}),r.amount)).join('\n');
 const parsed=parseStatement(raw),a=analyzeStatement(parsed.rows);
 assert.equal(a.total,329000);assert.equal(a.count,12);assert.equal(parsed.rows.find(r=>r.days===4).included,false);
 assert.equal(parsed.rows[0].included,false);assert.equal(a.peak.electric,41000);
});
test('PDF row reconstruction tolerates misaligned column baselines without joining adjacent lines',()=>{
 const item=(str,x,y)=>({str,transform:[1,0,0,1,x,y],height:8});
 assert.equal(textFromItems([item('Electric',10,453.6),item('$123.45',450,455.76),item('Gas',10,433.68),item('$10.00',450,436.56)]),'Electric $123.45\nGas $10.00');
});
test('CSV handles quoted amounts, duplicate rows and credits; partial history never fabricates missing months',()=>{
 const parsed=parseStatement('Month,Amount\n2026-01,"$1,200.00"\n2026-01,"$1,200.00"\n2026-03,-25.00\n2026-04,125.00');
 assert.equal(parsed.rows.length,3);assert.equal(analyzeStatement(parsed.rows).total,130000);
 assert.equal(analyzeStatement(parsed.rows).complete,false);assert.equal(analyzeStatement(parsed.rows).simulation.length,3);
 assert.equal(readCents('($25.00)'),-2500);assert.equal(readCents('25.00 CR'),-2500);
 assert.equal(readCents(''),null);assert.equal(readCents('NaN'),null);
 assert.throws(()=>analyzeStatement([{month:'',amount:1000}]),/valid month/);
 assert.throws(()=>analyzeStatement(history,{budget:-1}),/monthly budget/);
 assert.throws(()=>analyzeStatement(history,{reserve:Infinity}),/starting reserve/);
});
test('simple monthly tables are supported and payment/balance amounts are not imported as charges',()=>{
 const parsed=parseStatement('Jan 2026 $100.00\nFeb 2026 $150.00\nMar 2026 Payment Received $150.00\nApr 2026 Balance $300.00');
 assert.equal(parsed.rows.length,2);assert.equal(analyzeStatement(parsed.rows).total,25000);
 assert.equal(parseStatement('Account 1234\nTotal amount due $500.00').rows.length,0);
});
test('reports persist in the existing scoped tracker storage and malformed JSON is rejected',()=>{
 assert.doesNotThrow(()=>validateClassic({version:1,values:{'statement-reports':JSON.stringify([{id:'test',rows:history}])}}));
 assert.throws(()=>validateClassic({version:1,values:{'statement-reports':'broken'}}));
});
