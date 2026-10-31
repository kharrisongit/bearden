import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync('public/classic.js','utf8');
const saving=source.slice(source.indexOf('function showAutosaveFailure('),source.indexOf('\nasync function loadAppState('));
function saveFixture(){
 const notices=[],dismissed=[],timers=new Map();let timerId=0,fail=true,writes=0,reloaded=false;
 const context=vm.createContext({saveInFlight:false,saveQueuedAgain:false,saveRetryTimer:null,APP_STATE_KEY:'app-state',gatherAppState:()=>({takeHome:'1500'}),setStorageStatus(){},console:{error(){}},
  storage:{set:async()=>{writes++;if(fail)throw typeof fail==='object'?fail:Error('Offline');return {value:'saved'};}},
  window:{showBearToast:(text,options)=>notices.push({text,options}),dismissBearToast:id=>dismissed.push(id)},
  setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),confirm:()=>false,location:{reload:()=>reloaded=true}});
 vm.runInContext(saving,context);
 return {context,notices,dismissed,timers,set fail(value){fail=value;},get writes(){return writes;},get reloaded(){return reloaded;}};
}
test('autosave retries once quietly, then shows a persistent actionable error',async()=>{
 const f=saveFixture();assert.equal(await f.context.performSaveAppState(),false);assert.equal(f.notices.length,0);assert.equal(f.timers.size,1);
 await [...f.timers.values()][0]();
 assert.equal(f.writes,2);assert.match(f.notices[0].text,/Changes have not saved/);assert.equal(f.notices[0].options.actionLabel,'Retry');assert.equal(f.notices[0].options.persistent,true);
 await f.notices[0].options.onAction();assert.equal(f.writes,3);assert.equal(f.notices.at(-1).options.kind,'error');
 f.fail=false;await f.notices.at(-1).options.onAction();assert.equal(f.writes,4);assert.equal(f.notices.at(-1).text,'Changes saved');assert.equal(f.dismissed.at(-1),'autosave-error');
});
test('successful background saves remain quiet and clear only the saving error',async()=>{
 const f=saveFixture();f.fail=false;assert.equal(await f.context.performSaveAppState(),true);assert.equal(f.notices.length,0);assert.deepEqual(f.dismissed,['autosave-error']);
});
test('revision conflicts offer reload with an unsaved-edit confirmation, not Retry',async()=>{
 const f=saveFixture();f.fail={status:409,message:'Revision changed'};await f.context.performSaveAppState(true);
 const notice=f.notices[0];assert.equal(notice.options.actionLabel,'Reload');let prompt='';f.context.confirm=text=>{prompt=text;return false;};await notice.options.onAction();assert.match(prompt,/Unsaved changes/);assert.equal(f.reloaded,false);
 f.context.confirm=()=>true;await notice.options.onAction();assert.equal(f.reloaded,true);
});
test('blocked-save follow-up retains Reload recovery and transient lock errors allow Retry',async()=>{
 const f=saveFixture();f.fail=Error('Saving is blocked. Your account or saved data changed; reload before editing again.');await f.context.performSaveAppState(true);assert.equal(f.notices.at(-1).options.actionLabel,'Reload');
 f.fail={status:409,code:'SYNC_BUSY',message:'Busy'};await f.context.performSaveAppState(true);assert.equal(f.notices.at(-1).options.actionLabel,'Retry');
});
const toggle=source.slice(source.indexOf('function toggleChecked('),source.indexOf('// Restart the simulation'));
test('completion captures planned records once and Undo restores unchecked state and removes records',()=>{
 const notices=[];let saves=0,calculations=0;
 const context=vm.createContext({checkedPaychecks:{},cardsData:[{id:1},{id:2}],lastSchedule:[{paycheck:1,payments:[25,40],interestByAccount:[2,3]}],celebratingPaycheckNum:null,Event,
  window:{dispatchEvent(){},showBearToast:(text,options)=>notices.push({text,options})},document:{getElementById:()=>null},performSaveAppState:()=>saves++,calculate:()=>calculations++,paycheckCompletesAPayoff:()=>({any:false}),paycheckCompletesASavingsGoal:()=>({any:false})});
 vm.runInContext(toggle,context);context.toggleChecked(1,true);
 assert.equal(saves,1);assert.equal(context.window.debtPaymentHistory[1][1],25);assert.equal(context.window.debtInterestHistory[1][2],3);assert.match(notices[0].text,/No payments were sent/);assert.equal(notices[0].options.actionLabel,'Undo');
 context.lastSchedule[0].payments[0]=999;context.toggleChecked(1,true);assert.equal(saves,1);assert.equal(context.window.debtPaymentHistory[1][1],25);
 notices[0].options.onAction();assert.equal(saves,2);assert.equal(context.checkedPaychecks[1],false);assert.equal(context.window.debtPaymentHistory[1],undefined);assert.equal(context.window.debtInterestHistory[1],undefined);assert.equal(calculations,2);
 notices[0].options.onAction();assert.equal(saves,2);
});

test('explicit app-state save clears the old autosave error only after persistence succeeds',async()=>{
 const f=saveFixture();await f.context.performSaveAppState(true);assert.equal(f.notices.at(-1).options.id,'autosave-error');
 f.context.saveDebounceTimer=null;f.context.calculate=()=>{};
 const flush=source.match(/window\.flushBearDenState=async\(\)=>\{[^\n]+/)[0];vm.runInContext(flush,f.context);
 await assert.rejects(f.context.window.flushBearDenState());assert.deepEqual(f.dismissed,[]);
 f.fail=false;await f.context.window.flushBearDenState();assert.deepEqual(f.dismissed,['autosave-error']);
});
