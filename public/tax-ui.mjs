import {estimatePay,TAX_YEAR} from './tax-model.mjs?v=tracker-401k1';
export {estimatePay};
const states='AL:Alabama|AK:Alaska|AZ:Arizona|AR:Arkansas|CA:California|CO:Colorado|CT:Connecticut|DE:Delaware|DC:District of Columbia|FL:Florida|GA:Georgia|HI:Hawaii|ID:Idaho|IL:Illinois|IN:Indiana|IA:Iowa|KS:Kansas|KY:Kentucky|LA:Louisiana|ME:Maine|MD:Maryland|MA:Massachusetts|MI:Michigan|MN:Minnesota|MS:Mississippi|MO:Missouri|MT:Montana|NE:Nebraska|NV:Nevada|NH:New Hampshire|NJ:New Jersey|NM:New Mexico|NY:New York|NC:North Carolina|ND:North Dakota|OH:Ohio|OK:Oklahoma|OR:Oregon|PA:Pennsylvania|RI:Rhode Island|SC:South Carolina|SD:South Dakota|TN:Tennessee|TX:Texas|UT:Utah|VT:Vermont|VA:Virginia|WA:Washington|WV:West Virginia|WI:Wisconsin|WY:Wyoming'.split('|').map(s=>s.split(':'));
const fields=['state','filing','twoJobs','extraFederal','extraState','credits','otherIncome','deductions','health','retirement','retirementType','afterTax','localTax','ytdWages'];
const $=id=>document.getElementById('tax-'+id);
export function read(){return {federalExempt:false,stateExempt:false,stateExemptions:0,...Object.fromEntries(fields.map(id=>{const el=$(id);return [id,el.type==='checkbox'?el.checked:el.value];}))};}
export function restore(settings={}){for(const id of fields){const el=$(id);if(settings[id]!==undefined){if(el.type==='checkbox')el.checked=settings[id]===true;else el.value=settings[id];}}update();}
export function update(){document.getElementById('taxStateNote').textContent=$('state').value==='MI'?`${TAX_YEAR} Michigan: 4.25%. Rates fill automatically.`:$('state').value?'Automatic state estimates currently support Michigan. Use your actual take-home pay for this state.':'Choose your state and filing status to estimate taxes.';}
const number=(id,label,hint='')=>`<label for="tax-${id}">${label}<input id="tax-${id}" type="number" min="0" max="1000000000" step="0.01" value="0">${hint?'<small>'+hint+'</small>':''}</label>`;
const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(value)||0);
function breakdown(estimate){
 const entries=[['Gross pay',estimate.gross],['Federal income tax',estimate.federal],['Michigan income tax',estimate.state],['Social Security',estimate.socialSecurity],['Medicare',estimate.medicare],['City / local tax',estimate.local],['401(k) contribution',estimate.retirement],['Benefits / other deductions',estimate.benefits-estimate.retirement],['Total taxes & deductions',estimate.total],['Estimated take-home',estimate.net]];
 return '<dl class="paycheck-tax-breakdown">'+entries.map(([label,value])=>`<div><dt>${label}</dt><dd>${money(value)}</dd></div>`).join('')+'</dl>';
}
function mountPaycheckDetails(){
 const dialog=document.createElement('dialog');dialog.id='paycheckTaxDialog';dialog.className='income-card bill-editor';
 dialog.setAttribute('aria-labelledby','paycheckTaxTitle');
 dialog.innerHTML='<div class="card-heading"><h3 id="paycheckTaxTitle">Taxes &amp; withholding</h3></div><p id="paycheckTaxDate" class="subtle"></p><div id="paycheckTaxContent"></div><form method="dialog" class="bill-editor-actions"><button type="submit" class="bill-save" autofocus>Done</button></form>';
 document.body.append(dialog);
 document.addEventListener('click',event=>{
  const button=event.target.closest('[data-paycheck-taxes]');if(!button)return;
  const plan=window.getDebtPlan(),row=plan.schedule.find(row=>row.paycheck===Number(button.dataset.paycheckTaxes));if(!row)return;
  document.getElementById('paycheckTaxDate').textContent=`Paycheck ${row.paycheck} · ${new Date(row.date+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'})}`;
  const content=document.getElementById('paycheckTaxContent');content.replaceChildren();
  const note=text=>{const p=document.createElement('p');p.className='subtle';p.textContent=text;content.append(p);};
  note(`Planning estimate using your current Income settings and ${TAX_YEAR} tax rates. This is not a payroll statement or a record of actual withholding.`);
  try{
   const gross=window.calcGrossPay(Number(plan.state.hourlyRate)||0,Number(plan.state.hoursPerCheck)||0);
   if(!(gross>0))throw Error('Add your hourly rate, hours, state and filing status in Income to see the estimate. Take-home pay alone does not reveal individual taxes or deductions.');
   const estimate=estimatePay(gross,plan.state.taxSettings);
   content.insertAdjacentHTML('beforeend',breakdown(estimate));
   if(Math.abs(estimate.net-row.takeHomeThisCheck)>.005)note('Your entered take-home differs from this estimate. BearDen continues to use your entered amount for this paycheck.');
  }catch(error){note(error.message);}
  const entered=document.createElement('p');entered.className='paycheck-tax-entered';entered.textContent=`Take-home used in your plan: ${money(row.takeHomeThisCheck)}`;content.append(entered);
  if(row.bonusAmount>0){
   const heading=document.createElement('h4');heading.textContent='Bonus';content.append(heading);
   const bonus=plan.state.bonusTaxEstimates?.[row.paycheck];
   if(bonus&&Math.abs(bonus.net-row.bonusAmount)<.005){note(`Estimate saved when this bonus was added, using ${bonus.year} rates.`);content.insertAdjacentHTML('beforeend',breakdown(bonus));}
   else note('Only the after-tax amount was saved for this bonus, so its withholding breakdown is unavailable.');
   note(`Bonus take-home: ${money(row.bonusAmount)} · Total take-home in your plan: ${money(row.takeHomeThisCheck+row.bonusAmount)}`);
  }
  dialog.showModal();
 });
}
export function mount(){
 mountPaycheckDetails();
 document.getElementById('retirementControls').innerHTML=`<h4>401(k) deduction</h4>${number('retirement','Contribution per paycheck ($)','Your contribution only; leave at $0 if none.')}<label for="tax-retirementType">Contribution type<select id="tax-retirementType"><option value="traditional">Traditional (pre-tax)</option><option value="roth">Roth (after-tax)</option></select></label><p class="subtle">Included in the take-home estimate. Updates automatically when you change your pay or deductions. Your actual take-home already includes this deduction.</p>`;
 document.getElementById('withholdingControls').innerHTML=`<p class="subtle">${TAX_YEAR} estimates · every two weeks. Match the choices on your employer’s W-4.</p><label for="tax-state">State<select id="tax-state"><option value="">Choose state</option>${states.map(([code,name])=>`<option value="${code}">${name}</option>`).join('')}</select></label><p id="taxStateNote" class="subtle" role="status"></p><label for="tax-filing">Filing status<select id="tax-filing"><option value="">Choose filing status</option><option value="single">Single or married filing separately</option><option value="joint">Married filing jointly / qualifying surviving spouse</option><option value="head">Head of household</option></select></label><label class="check-label"><input id="tax-twoJobs" type="checkbox"> Two jobs total / spouse also works — W-4 Step 2(c)</label><p class="subtle">This uses the higher federal withholding table. Match the box on both jobs’ W-4s; it works best when the jobs pay similar amounts.</p><details><summary>Other W-4 entries and paycheck deductions</summary>${number('extraFederal','Extra federal withholding per paycheck ($) — Step 4(c)')}${number('extraState','Extra Michigan withholding per paycheck ($)')}${number('credits','Annual dependent / other credits ($) — Step 3')}${number('otherIncome','Annual other income ($) — Step 4(a)')}${number('deductions','Annual additional deductions ($) — Step 4(b)')}${number('health','Pre-tax health benefits per paycheck ($)')}${number('afterTax','Other paycheck deductions ($)')}${number('localTax','City / local tax per paycheck ($)')}${number('ytdWages','Taxable wages already paid this year ($)','Before this paycheck, for Social Security and Medicare limits. Zero assumes neither limit has been reached.')}</details><p class="subtle">Planning estimates only. Your employer may calculate differently; these choices do not change payroll forms. New bonuses use a separate 22% federal estimate plus state and payroll taxes, assuming annual bonuses below $1 million. <a href="https://www.irs.gov/individuals/tax-withholding-estimator" target="_blank" rel="noopener noreferrer">IRS withholding estimator</a></p>`;
 const changed=()=>{update();window.updateIncomeEstimateDisplay(true);window.queueSaveAppState();};for(const id of ['withholdingControls','retirementControls']){document.getElementById(id).addEventListener('input',changed);document.getElementById(id).addEventListener('change',changed);}
 update();
}
