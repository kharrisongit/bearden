import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/connections.js',import.meta.url),'utf8');
function harness(){
 const notices=[],readouts=[{textContent:'old giant readout'}],settings=[];
 const context={syncNoticeDismissed:false,window:{showBearToast:(text,options)=>notices.push({text,options}),dismissBearToast:id=>settings.push(id),selectBearTab:tab=>settings.push(tab)},document:{querySelectorAll:()=>readouts},message:text=>settings.push(text)};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf(' function clearRefreshReadouts'),source.indexOf(' async function request')),context);
 return {context,notices,readouts,settings};
}
test('refresh success is concise and clears both old inline readouts',()=>{
 const h=harness();h.context.finishRefreshNotice(['Bank: Updated '+('account '.repeat(90))]);
 assert.equal(h.notices.at(-1).text,'Connections refreshed.');assert.equal(h.readouts[0].textContent,'');assert.equal(h.settings[0],'');assert.equal(h.notices[0].options.dismissible,true);
});
test('handled Lunch Flow failures and incomplete updates never claim success',()=>{
 for(const status of ['Lunch Flow refused access. Check your API key. Saved balances and history are kept.','Lunch Flow returned an unreadable response.','Lunch Flow returned invalid account IDs.','Lunch Flow returned no accounts.','Lunch Flow returned partial history; saved history is kept.']){
  const h=harness();h.context.finishRefreshNotice([status]);assert.match(h.notices[0].text,/need attention/);assert.equal(h.notices[0].options.kind,'error');assert.equal(h.notices[0].options.persistent,true);
 }
 const h=harness(),results=['Status'];results.needsAttention=true;h.context.finishRefreshNotice(results);assert.match(h.notices[0].text,/need attention/);
});
test('cached readings are not labeled freshly refreshed',()=>{
 const h=harness();h.context.finishRefreshNotice(['Lunch Flow was checked less than five minutes ago. Showing saved readings.']);assert.equal(h.notices[0].text,'Recently checked. Showing saved balances.');
});
test('dismissed progress stays dismissed; final problems still surface',()=>{
 const h=harness();h.context.beginRefreshNotice();h.notices[0].options.onDismiss();h.context.syncMessage('Loading remaining transaction history…');h.context.finishRefreshNotice(['Updated']);assert.equal(h.notices.length,1);
 h.context.finishRefreshNotice('Network failed',{error:true});assert.equal(h.notices.length,2);assert.equal(h.notices[1].options.kind,'error');
});
test('progress never repeats a verbose provider status',()=>{
 const h=harness();h.context.syncMessage('Lunch Flow updated '+('account '.repeat(100)));assert.equal(h.notices[0].text,'Refreshing connections…');
});
