import {simulateMonthlyPayoff} from './monthly-payoff.mjs';
import {trackerDebtStatus} from './income-model.mjs';

// This independent forecast never changes debt balances or paycheck allocations.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>Number.isFinite(value)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value):'—';
const localDay=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
const dateLabel=value=>value?new Date(value+'T12:00:00').toLocaleDateString('en-US',{month:'long',year:'numeric'}):'—';
const shortMonth=value=>value?new Date(value+'T12:00:00').toLocaleDateString('en-US',{month:'short',year:'numeric'}):'—';
const fullDate=value=>value?new Date(value+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—';
const setHTML=(element,html)=>{if(element.innerHTML!==html)element.innerHTML=html;};
const settingKey=value=>JSON.stringify({monthlyBudget:value?.monthlyBudget??null,method:value?.method==='snowball'?'snowball':'avalanche'});

async function mountMonthlyPayoff(){
 if(!window.classicReady&&document.readyState!=='complete')await new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true}));
 await window.classicReady;
 const debtList=document.getElementById('debtListCard');
 if(!debtList||document.getElementById('monthlyPayoffPlanner'))return;
 const panel=document.createElement('section');
 panel.id='monthlyPayoffPlanner';panel.className='income-card monthly-payoff';panel.setAttribute('aria-labelledby','monthlyPayoffTitle');
 panel.innerHTML='<div class="monthly-payoff-heading"><div><span class="chart-eyebrow">Your path to debt-free</span><h3 id="monthlyPayoffTitle">Monthly payoff planner</h3></div><span class="monthly-payoff-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16M6 16v-4m6 4V8m6 8V4M4 8l6-5"/></svg></span></div>'+
 '<p class="monthly-payoff-intro">Choose one monthly amount. Cover every included debt’s minimum first, then put the rest toward your next payoff. As debts finish, their payments roll into the next one.</p>'+
 '<form id="monthlyPayoffForm" class="monthly-payoff-form">'+
 '<label for="monthlyPayoffBudget">Monthly debt budget ($)<input id="monthlyPayoffBudget" name="monthlyBudget" type="number" inputmode="decimal" min="0" max="1000000000" step="0.01" placeholder="Enter amount" autocomplete="off" required aria-describedby="monthlyPayoffBudgetHelp"></label>'+
 '<label for="monthlyPayoffMethod">Put extra money toward<select id="monthlyPayoffMethod" name="method"><option value="avalanche">Highest interest first · Avalanche</option><option value="snowball">Smallest balance first · Snowball</option></select></label>'+
 '<p id="monthlyPayoffBudgetHelp" class="monthly-payoff-help">Your total monthly payment, including minimums and extra.</p>'+
 '<div class="monthly-payoff-save-row"><button type="submit" id="saveMonthlyPayoff" class="bill-save">Save monthly plan</button><span id="monthlyPayoffSaveStatus" class="subtle" role="status"></span></div></form>'+
 '<p class="monthly-payoff-help">Saving remembers this budget and method. These are monthly estimates; make payments by each account’s due date. Your paycheck schedule stays as it is.</p>'+
 '<div id="monthlyPayoffNotice" class="monthly-payoff-notice" role="status" aria-live="polite"></div>'+
 '<div id="monthlyPayoffResults" hidden><div class="monthly-payoff-results">'+
 '<div class="monthly-payoff-result monthly-payoff-result-main"><span>Estimated payoff</span><strong id="monthlyPayoffDate">—</strong><small id="monthlyPayoffDuration">—</small></div>'+
 '<div class="monthly-payoff-result"><span>Estimated future interest</span><strong id="monthlyPayoffInterest">—</strong><small id="monthlyPayoffFees"></small></div>'+
 '<div class="monthly-payoff-result"><span>Total paid</span><strong id="monthlyPayoffTotal">—</strong><small>Balance + interest + fees</small></div></div>'+
 '<p id="monthlyPayoffEmbeddedInterest" class="monthly-payoff-help" hidden>Some starting balances already include scheduled interest. The interest figure shows additional interest only; interest already included cannot be itemized from those balances.</p><div class="monthly-payoff-split" id="monthlyPayoffSplit"></div></div>'+
 '<details id="monthlyPayoffScope" class="monthly-payoff-details"><summary id="monthlyPayoffScopeLabel">Included debts</summary><p class="monthly-payoff-help">Tracked payoff debts only. Car payments in Bills and accounts not linked to your payoff plan are separate. The debts listed below make up this estimate.</p><ul id="monthlyPayoffDebtList" class="monthly-payoff-debt-list"></ul></details>'+
 '<section id="monthlyPayoffSchedule" class="monthly-payoff-schedule" aria-labelledby="monthlyPayoffScheduleTitle" hidden><div class="monthly-payoff-schedule-heading"><h4 id="monthlyPayoffScheduleTitle">Monthly payment plan</h4><div class="monthly-payoff-month-nav"><button type="button" id="monthlyPayoffPrevious" aria-label="Previous payoff month">‹</button><label class="monthly-payoff-month-label" for="monthlyPayoffMonth"><span class="monthly-payoff-sr-only">View payoff month</span><select id="monthlyPayoffMonth"></select></label><button type="button" id="monthlyPayoffNext" aria-label="Next payoff month">›</button></div></div><p id="monthlyPayoffMonthNote" class="monthly-payoff-help"></p><div id="monthlyPayoffPayments"></div><div id="monthlyPayoffMonthTotals" class="monthly-payoff-month-totals"></div></section>'+
 '<details class="monthly-payoff-details" id="monthlyPayoffAssumptions"><summary>How the estimate works</summary><p class="monthly-payoff-help">Uses current tracked balances and saved interest and minimum-payment terms. Assumes the same budget each month, no new borrowing, and on-time payments. Payments are modeled once a month, starting one month from today; actual statement dates and payment timing can change interest. Pay each account by its own due date.</p><ul id="monthlyPayoffNotes" class="monthly-payoff-notes"></ul></details>';
 debtList.before(panel);
 const $=id=>panel.querySelector('#'+id);
 const budgetInput=$('monthlyPayoffBudget'),methodInput=$('monthlyPayoffMethod'),saveButton=$('saveMonthlyPayoff'),saveStatus=$('monthlyPayoffSaveStatus');
 let initialized=false,dirty=false,saving=false,frame=null,monthIndex=0,result=null,currentCards=[],lastSavedKey='';

 function draft(){
  return {monthlyBudget:budgetInput.value.trim()===''?null:Number(budgetInput.value),method:methodInput.value==='snowball'?'snowball':'avalanche'};
 }
 function isValidDraft(value=draft()){
  return value.monthlyBudget!==null&&Number.isFinite(value.monthlyBudget)&&value.monthlyBudget>=0&&value.monthlyBudget<=1000000000&&budgetInput.validity.valid;
 }
 function currentSettings(){
  return window.getDebtPlan?.().state.monthlyPayoffPlan||{};
 }
 function refreshSettings(saved){
  const key=settingKey(saved),editing=panel.querySelector('#monthlyPayoffForm').contains(document.activeElement);
  if(!initialized||(!dirty&&!saving&&!editing&&key!==lastSavedKey)){
   budgetInput.value=Number.isFinite(saved.monthlyBudget)?saved.monthlyBudget:'';
   methodInput.value=saved.method==='snowball'?'snowball':'avalanche';
   initialized=true;lastSavedKey=key;
   saveStatus.textContent=Number.isFinite(saved.monthlyBudget)?'Saved monthly plan':'';
  }
 }
 function queueRender(){
  if(frame)return;
  frame=requestAnimationFrame(()=>{frame=null;render();});
 }
 function renderScope(){
  const included=currentCards.filter(card=>Number(card.balance)>0),total=included.reduce((sum,card)=>sum+card.balance,0);
  $('monthlyPayoffScopeLabel').textContent='Included debts · '+included.length+(included.length?' · '+money(total):'');
  setHTML($('monthlyPayoffDebtList'),included.map(card=>{
   const annualRate=Number.isFinite(card.terms?.apr)?card.terms.apr:card.apr;
   return '<li><span><strong>'+esc(card.name||'Debt')+'</strong><small>'+esc(Number.isFinite(annualRate)?annualRate.toLocaleString('en-US',{maximumFractionDigits:3})+'% APR':'APR needed')+'</small></span><strong>'+money(card.balance)+'</strong></li>';
  }).join('')||'<li class="monthly-payoff-help">Add a debt with a remaining balance to build a monthly plan.</li>');
 }
 function showNotice(message,tone='neutral',issues=[]){
  const notice=$('monthlyPayoffNotice');notice.dataset.tone=tone;notice.hidden=!message&&!issues.length;
  setHTML(notice,(message?'<p>'+esc(message)+'</p>':'')+(issues.length?'<ul>'+issues.map(issue=>'<li>'+esc(typeof issue==='string'?issue:issue.message||'Review this debt’s terms.')+'</li>').join('')+'</ul>':''));
 }
 function render(){
  const plan=window.getDebtPlan?.();
  if(!plan)return;
  refreshSettings(plan.state.monthlyPayoffPlan||{});
  currentCards=(plan.state.cards||[]).map(card=>{
   const status=trackerDebtStatus(plan,card.id);
   return {...card,balance:Number.isFinite(status?.balance)?status.balance/100:card.balance,terms:plan.syncedDebtTerms?.[card.id]};
  });
  renderScope();
  const value=draft();
  saveButton.disabled=saving||!isValidDraft(value)||value.monthlyBudget<=0;
  if(!isValidDraft(value)){
   result=null;$('monthlyPayoffResults').hidden=true;$('monthlyPayoffSchedule').hidden=true;
   showNotice(value.monthlyBudget===null?'Enter a monthly debt budget to see your payoff date and interest.':'Enter a valid monthly amount of $0 or more.',value.monthlyBudget===null?'neutral':'warning');
   setHTML($('monthlyPayoffNotes'),'');return;
  }
  result=simulateMonthlyPayoff({cards:currentCards,monthlyBudget:value.monthlyBudget,startDate:localDay(),method:value.method});
  const complete=result.status==='paid-off'||result.status==='no-debt';
  $('monthlyPayoffResults').hidden=false;
  $('monthlyPayoffDate').textContent=result.status==='no-debt'?'No debt remaining':complete?dateLabel(result.payoffDate):'Not yet available';
  $('monthlyPayoffDuration').textContent=complete?(result.months||0)+' month'+(result.months===1?'':'s')+' to pay off':'Complete estimate needed';
  $('monthlyPayoffInterest').textContent=money(result.totalInterest);
  $('monthlyPayoffEmbeddedInterest').hidden=!currentCards.some(card=>card.balance>0&&card.interestRules?.balanceBasis==='scheduled-total');
  $('monthlyPayoffFees').textContent=Number.isFinite(result.totalFees)?(result.totalFees>0?'+ '+money(result.totalFees)+' estimated fees':'No additional fees modeled'):'Interest estimate is incomplete';
  $('monthlyPayoffTotal').textContent=money(result.totalPaid);
  const first=result.rows?.[0],minimum=first?.minimumTotal??(['missing-details','invalid'].includes(result.status)?null:result.minimumRequired);
  setHTML($('monthlyPayoffSplit'),'<div><span>First month’s minimums</span><strong>'+money(minimum)+'</strong></div><div><span>Extra toward payoff</span><strong>'+money(first?first.payments.reduce((sum,payment)=>sum+payment.extra,0):Number.isFinite(minimum)?Math.max(0,value.monthlyBudget-minimum):null)+'</strong></div>');
  let message='',tone='neutral';
  if(result.status==='no-debt')message='Your tracked debts have no remaining balance. Add another debt to include it here.';
  else if(result.status==='insufficient-budget'){
   message='This budget is '+money(result.shortfall)+' short of the required minimum payments'+(result.failureMonth>1?' in month '+result.failureMonth+' ('+dateLabel(result.failureDate)+')':'')+'. Increase the monthly amount to cover every minimum.';
   tone='warning';
  }else if(result.status==='missing-details'){
   message='Review the missing debt details below to calculate a complete payoff date and interest total.';tone='warning';
  }else if(result.status==='not-amortizing'){
   message='This budget does not pay down the balances enough to finish the plan. Increase the monthly amount and check the debt terms.';tone='warning';
  }else if(result.status==='horizon'){
   message='Payoff extends beyond the 30-year estimate. Increase the monthly amount to see a complete payoff date and interest total.';tone='warning';
  }else if(result.status==='invalid'){
   message='Check the debt amounts and terms below before estimating payoff.';tone='warning';
  }
  showNotice(message,tone,result.issues||[]);
  setHTML($('monthlyPayoffNotes'),(result.notes||[]).map(note=>'<li>'+esc(note)+'</li>').join(''));
  const rows=result.rows||[];
  $('monthlyPayoffSchedule').hidden=!rows.length;
  monthIndex=Math.min(monthIndex,Math.max(0,rows.length-1));
  setHTML($('monthlyPayoffMonth'),rows.map((row,index)=>'<option value="'+index+'">Month '+row.month+' · '+esc(shortMonth(row.date))+'</option>').join(''));
  $('monthlyPayoffMonth').value=String(monthIndex);
  renderMonth();
 }
 function renderMonth(){
  const rows=result?.rows||[],row=rows[monthIndex];if(!row)return;
  $('monthlyPayoffPrevious').disabled=monthIndex<=0;
  $('monthlyPayoffNext').disabled=monthIndex>=rows.length-1;
  $('monthlyPayoffMonth').value=String(monthIndex);
  $('monthlyPayoffMonthNote').textContent='Monthly estimate through '+fullDate(row.date)+'. Pay each account by its own due date. Minimums come first; extra follows your chosen payoff order.';
  const payments=(row.payments||[]).filter(payment=>payment.payment>0||payment.balanceAfter>0);
  setHTML($('monthlyPayoffPayments'),payments.map(payment=>'<article class="monthly-payoff-payment" data-monthly-payoff-debt="'+esc(payment.id)+'"><div class="monthly-payoff-payment-heading"><h5>'+esc(payment.name)+'</h5><strong>'+money(payment.payment)+'</strong></div><dl><div><dt>Minimum</dt><dd>'+money(payment.minimum)+'</dd></div><div><dt>Extra</dt><dd>'+money(payment.extra)+'</dd></div><div><dt>Balance after</dt><dd>'+money(payment.balanceAfter)+'</dd></div></dl>'+(payment.balanceAfter<=0.005?'<p class="monthly-payoff-completed">Paid off this month · freed payment rolls forward</p>':'')+'</article>').join(''));
  const budget=draft().monthlyBudget,unused=Math.max(0,Math.round((budget-row.paymentTotal)*100)/100);
  setHTML($('monthlyPayoffMonthTotals'),'<div><span>Total payment</span><strong>'+money(row.paymentTotal)+'</strong></div><div><span>Interest this month</span><strong>'+money(row.interest)+'</strong></div>'+(row.fees>0?'<div><span>Fees this month</span><strong>'+money(row.fees)+'</strong></div>':'')+'<div><span>Debt remaining</span><strong>'+money(row.remainingBalance)+'</strong></div>'+(unused>0?'<div class="monthly-payoff-unused"><span>Budget left over</span><strong>'+money(unused)+'</strong></div>':''));
 }
 function changed(){
  const saved=currentSettings();
  dirty=settingKey(draft())!==settingKey(saved);
  saveStatus.textContent=dirty?'Preview · save to keep these settings':Number.isFinite(saved.monthlyBudget)?'Saved monthly plan':'';monthIndex=0;queueRender();
 }
 budgetInput.addEventListener('input',changed);
 methodInput.addEventListener('change',changed);
 $('monthlyPayoffMonth').addEventListener('change',event=>{monthIndex=Number(event.target.value)||0;renderMonth();});
 $('monthlyPayoffPrevious').addEventListener('click',()=>{monthIndex=Math.max(0,monthIndex-1);renderMonth();});
 $('monthlyPayoffNext').addEventListener('click',()=>{monthIndex=Math.min((result?.rows.length||1)-1,monthIndex+1);renderMonth();});
 $('monthlyPayoffForm').addEventListener('submit',async event=>{
  event.preventDefault();if(saving||!isValidDraft()||draft().monthlyBudget<=0)return;
  const value=draft(),submittedKey=settingKey(value);
  saving=true;saveButton.disabled=true;saveButton.textContent='Saving…';saveStatus.textContent='Saving monthly plan…';
  try{
   await window.saveMonthlyPayoffPlan(value);
   lastSavedKey=submittedKey;dirty=settingKey(draft())!==submittedKey;
   saveStatus.textContent=dirty?'Plan saved · newer edits are a preview':'Monthly plan saved';
   window.showBearToast?.('Monthly payoff plan saved');
  }catch(error){
   dirty=true;saveStatus.textContent=error?.message||'Could not save the monthly plan. Try again.';
  }finally{saving=false;saveButton.textContent='Save monthly plan';saveButton.disabled=!isValidDraft()||draft().monthlyBudget<=0;queueRender();}
 });
 window.addEventListener('bearden-plan-changed',queueRender);
 window.addEventListener('bearden-connections',queueRender);
 window.addEventListener('bearden-tab-changed',event=>{if(event.detail==='debts')queueRender();});
 render();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{mountMonthlyPayoff().catch(error=>console.error('Monthly payoff planner could not open',error));},{once:true});
else mountMonthlyPayoff().catch(error=>console.error('Monthly payoff planner could not open',error));
