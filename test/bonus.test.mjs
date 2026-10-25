import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/classic.js',import.meta.url),'utf8');
// Exercise the actual paycheck bonus controls with saved state and DOM input values.
const controls=source.slice(source.indexOf('// ---- Bonus (applied inline'),source.indexOf('// ---- Editable budget line items'));
function setup(rate='',amount='1000',saved={}){
 const fields={bonusWithholding:{value:rate},'bonusInlineAmount-1':{value:amount}};
 const context=vm.createContext({document:{getElementById:id=>fields[id]},appliedBonuses:{...saved},bonusInputOpenForPaycheck:1,calculate:()=>{}});
 vm.runInContext(controls,context);return {context,fields,apply:()=>vm.runInContext('applyBonusToPaycheck(1)',context)};
}
test('blank withholding restores pre-tax bonus entry with the original 24.9% deduction',()=>{
 const {context,apply}=setup();apply();assert.equal(context.appliedBonuses[1],751);assert.equal(context.bonusInputOpenForPaycheck,null);
});
test('explicit bonus withholding overrides the default, including zero',()=>{
 for(const [rate,net]of [['30',700],['0',1000],['100',0]]){const {context,apply}=setup(rate);apply();assert.equal(context.appliedBonuses[1],net);}
});
test('bonus take-home rounds to cents and saved net bonuses are not taxed again',()=>{
 const {context,apply}=setup('','123.45',{2:751});assert.equal(context.appliedBonuses[2],751);apply();assert.equal(context.appliedBonuses[1],92.71);assert.equal(context.appliedBonuses[2],751);
});
test('blank and invalid amounts do not replace saved bonuses or close the input',()=>{
 for(const amount of ['', '-5', 'invalid', 'Infinity']){const {context,apply}=setup('',amount,{1:100});apply();assert.equal(context.appliedBonuses[1],100);assert.equal(context.bonusInputOpenForPaycheck,1);}
});
test('invalid withholding does not silently disable automatic deductions',()=>{
 for(const rate of ['invalid','101','-5']){const {context,apply}=setup(rate);apply();assert.equal(context.appliedBonuses[1],751);}
});
