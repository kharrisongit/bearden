import test from 'node:test';
import assert from 'node:assert/strict';
import {occurrences} from '../public/engine.mjs';
import {billEvents,scenarioForecast,forecastTimeline,forecastBalanceOn} from '../public/income-model.mjs';
test('a full year includes all paydays and recurring bills, not just the first month',()=>{
 const plan={state:{startDate:'2026-11-06',takeHome:1000,budgetItems:[]},schedule:[]},bills=billEvents({}, {manual:[{id:'rent',name:'Rent',amount:50000,date:'2026-11-10',repeat:'monthly',source:'manual'}]}, {},'2026-11-06','2027-11-06');
 const result=scenarioForecast([{include:true,balance:10000}],plan,bills,'2026-11-06',{length:365});
 assert.equal(result.end,'2027-11-06');assert.equal(result.income,2700000);assert.equal(result.outgoing,600000);assert.equal(result.endBalance,2110000);assert.equal(result.rows.filter(r=>r.type==='bill').length,12);
});
test('recurrences continue beyond the previous 2400-event ceiling and can start far in the future',()=>{
 const all=occurrences('2026-01-02','weekly','2026-01-02','2086-01-04');assert.ok(all.length>2400);assert.equal(all.at(-1),'2086-01-04');
 const later=occurrences('2026-01-02','weekly','2086-01-01','2086-01-31');assert.deepEqual(later,['2086-01-04','2086-01-11','2086-01-18','2086-01-25']);
 assert.deepEqual(occurrences('2026-01-31','monthly','2128-02-01','2128-03-31'),['2128-02-29','2128-03-31']);
 assert.deepEqual(occurrences('2026-01-01','once','2027-01-01','2028-01-01'),[]);
});
test('long-range timeline aggregates same-day changes and scrubs days without transactions correctly',()=>{
 const f={opening:10000,end:'2031-01-01',rows:[{date:'2026-11-01',delta:-15000},{date:'2026-11-01',delta:2000},{date:'2027-01-01',delta:20000}]};
 const points=forecastTimeline(f,'2026-10-25');assert.equal(points.length,4);assert.equal(forecastBalanceOn(points,'2026-10-31'),10000);assert.equal(forecastBalanceOn(points,'2026-11-01'),-3000);assert.equal(forecastBalanceOn(points,'2026-12-31'),-3000);assert.equal(forecastBalanceOn(points,'2031-01-01'),17000);
 assert.deepEqual(forecastTimeline({...f,opening:null},'2026-10-25'),[]);assert.equal(forecastBalanceOn([],'2026-10-25'),null);
});
