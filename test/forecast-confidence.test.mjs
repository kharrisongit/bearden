import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {cashForecast,forecastThrough} from '../public/income-model.mjs';

const source=readFileSync(new URL('../public/tabs.js',import.meta.url),'utf8');
function extract(name){
 const start=source.indexOf(' function '+name+'('),end=source.indexOf('\n }',start)+3;
 assert.ok(start>=0&&end>start);return source.slice(start,end);
}
const helpers=extract('accountBalanceStatus')+'\n'+extract('forecastRisk');
const context=vm.createContext({Date,Number});vm.runInContext(helpers,context);
const now=Date.parse('2026-10-31T12:00:00Z');
test('balance freshness uses the account update, never its latest failed retrieval',()=>{
 const account={source:'plaid',balance:12000,balanceUpdated:'2026-10-27T12:00:00Z',balanceRetrieved:'2026-10-31T12:00:00Z'};
 const status=context.accountBalanceStatus(account,now);
 assert.match(status,/Plaid · Last known balance · Updated/);assert.match(status,/Refresh in Settings/);
 assert.ok(status.includes(new Date(account.balanceUpdated).toLocaleString()));
 assert.ok(!status.includes(new Date(account.balanceRetrieved).toLocaleString()));
});
test('provider failure and missing accounts are unavailable even with a retained numeric balance',()=>{
 for(const flag of ['balanceUnavailable','providerUnavailable','accountMissing'])assert.match(context.accountBalanceStatus({source:'plaid',balance:100,[flag]:true},now),/Balance unavailable/);
 assert.match(context.accountBalanceStatus({source:'plaid',balance:null},now),/Balance unavailable/);
});
test('Lunch Flow retrieval is not mislabeled as the bank balance timestamp',()=>{
 const status=context.accountBalanceStatus({source:'lunchflow',balance:100,balanceDateUnknown:true,balanceUpdated:'2026-10-31T10:00:00Z'},now);
 assert.match(status,/Lunch Flow · Retrieved/);assert.match(status,/Bank balance time not supplied/);assert.doesNotMatch(status,/Updated|Last known/);
 assert.match(context.accountBalanceStatus({source:'plaid',balance:100},now),/Balance update time unknown/);
});
test('selected-day rendering retains the whole-horizon warning but filters the ledger and totals',()=>{
 const start='2026-11-01',full=cashForecast([{include:true,balance:10000}],[],[{type:'bill',name:'Future rent',date:'2026-11-10',amount:20000}],start,30);
 const ledger={scrollTop:0},container={innerHTML:'',querySelector:()=>ledger};
 const scope=vm.createContext({Date,Number,model:{forecastThrough},forecastViews:{bills:{start,index:0,length:30,rowLimit:100,forecast:full,plan:{state:{startDate:start}}}},modelDay:(day,n)=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10),$:()=>container,money:n=>'$'+(n/100).toFixed(2),esc:String});
 vm.runInContext(helpers+'\n'+extract('renderForecastDetails'),scope);scope.renderForecastDetails('bills');
 assert.match(container.innerHTML,/data-full-range-risk/);assert.match(container.innerHTML,/First projected negative balance/);assert.match(container.innerHTML,/Risk across the full forecast/);
 assert.match(container.innerHTML,/Totals and lowest balance through/);assert.match(container.innerHTML,/forecast-main">\$100.00/);
 assert.doesNotMatch(container.innerHTML,/data-forecast-date="2026-11-10"/);
 scope.forecastViews.bills.index=30;scope.renderForecastDetails('bills');
 assert.match(container.innerHTML,/data-forecast-date="2026-11-10"/);assert.match(container.innerHTML,/forecast-main is-negative">\$-100.00/);
});
test('risk is absent for positive and unknown balances, and includes an already-negative opening',()=>{
 assert.equal(context.forecastRisk({opening:null,rows:[]},'2026-11-01'),null);
 assert.equal(context.forecastRisk({opening:100,low:100,rows:[]},'2026-11-01'),null);
 const r=context.forecastRisk({opening:-100,low:-100,rows:[],end:'2026-12-01'},'2026-11-01');assert.equal(r.first.opening,true);assert.equal(r.lowest,'2026-11-01');
});
