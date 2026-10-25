import test from 'node:test';import assert from 'node:assert/strict';import {estimatePay} from '../public/tax-model.mjs';import {paydayEvents} from '../public/income-model.mjs';
const mi={state:'MI',filing:'joint',stateExemptions:1};
test('2026 IRS Worksheet 1A and Michigan formula produce the independently calculated biweekly amounts',()=>{
 const singleJob=estimatePay(2000,mi),twoJobs=estimatePay(2000,{...mi,twoJobs:true});assert.equal(singleJob.federal,76.15);assert.equal(singleJob.state,75.36);assert.equal(singleJob.socialSecurity,124);assert.equal(singleJob.medicare,29);assert.equal(singleJob.net,1695.49);assert.equal(twoJobs.federal,156.15);assert.equal(twoJobs.state,singleJob.state);assert.equal(twoJobs.net,1615.49);
 assert.equal(estimatePay(2500,{...mi,filing:'single'}).federal,216.15);assert.equal(estimatePay(2500,{...mi,filing:'head'}).federal,174.92);
});
test('W-4 credits, additional withholding, exemptions and pretax deductions remain independent',()=>{
 assert.equal(estimatePay(2000,{...mi,credits:260,extraFederal:20}).federal,86.15);
 const federalExempt=estimatePay(2000,{...mi,federalExempt:true});assert.equal(federalExempt.federal,0);assert.equal(federalExempt.state,75.36);assert.equal(federalExempt.socialSecurity,124);
 const stateExempt=estimatePay(2000,{...mi,stateExempt:true});assert.equal(stateExempt.state,0);assert.equal(stateExempt.federal,76.15);
 assert.equal(estimatePay(2000,{...mi,health:100,retirement:200}).socialSecurity,117.8);assert.equal(estimatePay(2000,{...mi,health:100,retirement:200}).benefits,300);
});
test('FICA limits use this employer’s year-to-date wages and bonus estimate includes payroll taxes',()=>{
 const cap=estimatePay(2000,{...mi,ytdWages:184000});assert.equal(cap.socialSecurity,31);assert.equal(cap.medicare,29);
 const high=estimatePay(2000,{...mi,ytdWages:199000});assert.equal(high.socialSecurity,0);assert.equal(high.medicare,38);
 const bonus=estimatePay(1000,mi,{bonus:true});assert.equal(bonus.federal,220);assert.equal(bonus.state,42.5);assert.equal(bonus.socialSecurity,62);assert.equal(bonus.medicare,14.5);assert.equal(bonus.net,661);
});
test('unconfigured or unsupported states and invalid inputs do not create a misleading take-home estimate',()=>{
 for(const settings of [{},{...mi,state:'CA'},{...mi,stateExemptions:1.2},{...mi,credits:-1},{...mi,health:3000}])assert.throws(()=>estimatePay(2000,settings));assert.throws(()=>estimatePay(NaN,mi));assert.equal(estimatePay(0,mi).net,0);
});
test('fixed household bills entered during setup count once per paycheck',()=>{
 const state={cards:[],budgetItems:[{id:1,label:'Household bills',kind:'household-bills',amount:640}],takeHome:1500,startDate:'2026-11-06'};const events=paydayEvents({state,schedule:[]},'2026-11-01','2026-11-30',{billsOnly:true});assert.deepEqual(events.map(e=>e.allocations),[64000,64000]);
});
