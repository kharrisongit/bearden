import {APP_RELEASE} from './app-release.mjs?v=bug-reports1';

// Reports and release acknowledgements never read or save the financial plan.
const $ = (selector, root=document) => root.querySelector(selector);
const element = (tag, text, className) => {
  const node=document.createElement(tag);
  if(text!==undefined)node.textContent=String(text);
  if(className)node.className=className;
  return node;
};
const areas={dashboard:'Dashboard',income:'Income',bills:'Bills',debt:'Debt',tools:'Tools',settings:'Settings',other:'Something else'};
const statuses={new:'Received',investigating:'Investigating',needs_details:'Needs details',fixed:'Fixed'};
let account, reportDialog, releaseDialog, releaseData, displayedReleaseId, reportsCursor=null, requestInFlight=false, sending=false, lastSubmission=null;
let activeArea='dashboard', openedFromArea='dashboard';
const dismissed=new Set();

async function request(path, body){
  if(!account?.authenticated)throw Error('Sign in to BearDen to use bug reports.');
  const response=await fetch(path,{method:body===undefined?'GET':'POST',cache:'no-store',credentials:'same-origin',headers:{...(account.accountId?{'X-BearDen-Account':account.accountId}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  let data;try{data=await response.json();}catch{throw Error('Could not read the response. Please try again.');}
  if(!response.ok){const error=Error(data.error||'Could not complete that request. Please try again.');error.status=response.status;throw error;}
  return data;
}

function dialog(id,title,content){
  const node=element('dialog',undefined,'income-card bill-editor bug-dialog');node.id=id;node.setAttribute('aria-labelledby',id+'Title');
  const header=element('div',undefined,'card-heading');const heading=element('h2',title);heading.id=id+'Title';
  const close=element('button','×','bill-icon-button');close.type='button';close.setAttribute('aria-label','Close '+title.toLowerCase());close.addEventListener('click',()=>node.close());
  header.append(heading,close);node.append(header);const body=element('div',undefined,'bug-dialog-content');body.innerHTML=content;node.append(body);document.body.append(node);return node;
}

function mount(){
  if(!$('#bdSettingsHub')){
    const support=element('section');support.id='classicBugSupport';support.innerHTML='<h3>Support</h3><p>Send a bug report or see what changed in BearDen.</p><button type="button" data-bug-report-open>Report a bug</button><button type="button" data-bug-updates-open>Updates</button>';
    $('#connectionDialog').append(support);
  }
  reportDialog=dialog('bugReportDialog','Report a bug',`
    <p id="bugReportIntro">Tell dot what went wrong and how to repeat it.</p>
    <p id="bugReportSignIn" class="subtle" hidden>Sign in with Google or Microsoft in Settings to send a report.</p>
    <form id="bugReportForm">
      <fieldset id="bugReportFields">
        <label>Short description<input name="title" maxlength="120" required placeholder="e.g. A button does not respond"></label>
        <label>Where did it happen?<select name="area">${Object.entries(areas).map(([value,label])=>'<option value="'+value+'">'+label+'</option>').join('')}</select></label>
        <label>What happened?<textarea name="details" maxlength="4000" rows="4" required placeholder="Describe the problem."></textarea></label>
        <details class="bug-extra"><summary>Add more details (optional)</summary>
          <label>What did you expect?<textarea name="expected" maxlength="2000" rows="2"></textarea></label>
          <label>Steps to repeat it<textarea name="steps" maxlength="3000" rows="3" placeholder="1. Open…&#10;2. Tap…"></textarea></label>
        </details>
        <p class="subtle">Includes this app version, the area you choose, browser, and screen size. Your balances, email, and saved plan are not attached. Please leave passwords and account numbers out of your report.</p>
        <button type="submit" class="bill-save" id="sendBugReport">Send report</button>
      </fieldset>
      <p id="bugReportStatus" class="subtle" role="status" aria-live="polite"></p>
    </form>
    <section class="bug-history"><div class="bug-section-heading"><h3>Your reports</h3><button type="button" id="refreshBugReports">Refresh</button></div><p id="bugReportListStatus" class="subtle" role="status"></p><div id="bugReportList"></div><button type="button" id="loadEarlierBugReports" hidden>Load earlier reports</button></section>
    <section id="bugDotConnection" class="bug-history" hidden><h3>dot connection</h3>
      <p class="subtle">dot checks submitted reports hourly when its ChatGPT task is running. Reports that need more information may be marked Needs details.</p>
      <p><a href="/support.html" target="_blank" rel="noopener noreferrer">Manage reports</a></p>
      <details><summary>Optional private connection</summary><p class="subtle">A private link gives dot access to reports and their progress, without access to your financial data. Keep the link private. You can revoke it here. Creating a link does not start a ChatGPT task.</p>
      <p id="bugDotStatus" class="subtle" role="status"></p><div class="bug-actions"><button type="button" id="createBugDotLink">Create private connection link</button><button type="button" id="replaceBugDotLink" hidden>Replace link</button><button type="button" id="revokeBugDotLink" hidden>Revoke link</button></div>
      <label id="bugDotLinkField" hidden>Private support link<input id="bugDotLink" type="text" readonly autocomplete="off" spellcheck="false"></label></details>
    </section>`);
  releaseDialog=dialog('bugReleaseDialog','BearDen was updated',`
    <p id="bugReleaseTitle" class="bug-release-title"></p><ul id="bugReleaseNotes"></ul><p id="bugReleaseVersion" class="subtle"></p>
    <p id="bugReleaseHelp" class="subtle"></p><div class="bug-actions"><button type="button" id="bugReleaseDismiss">Done</button><button type="button" id="bugReleaseReload" class="bill-save" hidden>Reload app</button></div><p id="bugReleaseStatus" class="subtle" role="status"></p>`);
  reportDialog.addEventListener('close',()=>$('#bugDotLink').value='');
  $('#bugReportForm').addEventListener('submit',submitReport);
  $('#refreshBugReports').addEventListener('click',loadReports);
  $('#loadEarlierBugReports').addEventListener('click',()=>{if(reportsCursor)loadReports(reportsCursor);});
  $('#createBugDotLink').addEventListener('click',()=>changeConnection('enable'));
  $('#replaceBugDotLink').addEventListener('click',()=>changeConnection('rotate'));
  $('#revokeBugDotLink').addEventListener('click',()=>changeConnection('revoke'));
  $('#bugReleaseDismiss').addEventListener('click',dismissRelease);
  releaseDialog.addEventListener('cancel',event=>{event.preventDefault();dismissRelease();});
  releaseDialog.addEventListener('close',()=>{if(displayedReleaseId&&!dismissed.has(displayedReleaseId))dismissRelease();});
  $('#bugReleaseReload').addEventListener('click',async()=>{
    const button=$('#bugReleaseReload');button.disabled=true;
    try{await dismissRelease();location.reload();}finally{button.disabled=false;}
  });
  document.addEventListener('click',event=>{
    if(event.target.closest('[data-bug-report-open]'))openReports();
    if(event.target.closest('[data-bug-updates-open]'))openUpdates();
  });
  window.addEventListener('bearden-tab-changed',event=>{
    const next={debt:'dashboard',debts:'debt'}[event.detail]||event.detail;
    if(next==='settings'&&activeArea!=='settings')openedFromArea=activeArea;
    activeArea=areas[next]?next:'other';
  });
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkRelease();});
  document.addEventListener('focusout',()=>setTimeout(maybeShowRelease,150));
  document.addEventListener('close',()=>setTimeout(maybeShowRelease,150),true);
  setInterval(()=>{if(!document.hidden)checkRelease();},60000);
  setInterval(maybeShowRelease,5000);
}

async function openReports(){
  if(!reportDialog.open){
    if(!$('#bugReportForm').elements.title.value&&!$('#bugReportForm').elements.details.value)$('#bugReportForm').elements.area.value=activeArea==='settings'?openedFromArea:activeArea;
    reportDialog.showModal();
  }
  $('#bugReportFields').disabled=!account?.authenticated||sending;
  $('#bugReportSignIn').hidden=!!account?.authenticated;$('#refreshBugReports').hidden=!account?.authenticated;
  $('#bugDotConnection').hidden=!account?.authenticated||account.accountId!=='owner';
  if(!account?.authenticated)return;
  await loadReports();
  if(account.accountId==='owner')try{renderConnection(await request('/api/bug-reports/automation'));}catch(error){$('#bugDotStatus').textContent=error.message;}
}

async function submitReport(event){
  event.preventDefault();if(sending||!account?.authenticated)return;
  const form=event.currentTarget;if(!form.reportValidity())return;
  const values=Object.fromEntries(new FormData(form));
  const payload={title:values.title.trim(),details:values.details.trim(),expected:values.expected.trim(),steps:values.steps.trim(),area:values.area,appVersion:APP_RELEASE.id,diagnostics:{browser:navigator.userAgent.slice(0,240),viewport:Math.round(innerWidth)+'x'+Math.round(innerHeight)}};
  if(!payload.title||!payload.details){$('#bugReportStatus').textContent='Add a description and tell us what happened.';return;}
  const signature=JSON.stringify(payload);if(lastSubmission?.signature!==signature)lastSubmission={signature,id:crypto.randomUUID()};
  sending=true;$('#bugReportFields').disabled=true;$('#bugReportStatus').textContent='Sending report…';
  try{
    const data=await request('/api/bug-reports',{submissionId:lastSubmission.id,...payload});
    form.reset();lastSubmission=null;$('#bugReportStatus').textContent='Report '+data.report.id+' received. You can follow its progress below.';await loadReports();
  }catch(error){$('#bugReportStatus').textContent=error.message+' Your draft is still here.';}
  finally{sending=false;$('#bugReportFields').disabled=!account?.authenticated;}
}

async function loadReports(cursor=null){
  if(!account?.authenticated)return;
  if(typeof cursor!=='string')cursor=null;
  const button=$('#refreshBugReports'),earlier=$('#loadEarlierBugReports');button.disabled=true;earlier.disabled=true;$('#bugReportListStatus').textContent='Loading reports…';
  try{
    const data=await request('/api/bug-reports'+(cursor?'?cursor='+encodeURIComponent(cursor):'')),list=$('#bugReportList');if(!cursor)list.replaceChildren();
    for(const report of data.reports||[]){
      const item=element('details',undefined,'bug-report-item'),summary=element('summary');summary.append(element('span',report.title),element('span',statuses[report.status]||'Received','bug-report-badge'));item.append(summary);
      const date=new Date(report.createdAt);item.append(element('p',report.id+(Number.isFinite(date.getTime())?' · '+date.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):''),'subtle'));
      for(const [label,value]of [['What happened',report.details],['Expected',report.expected],['Steps',report.steps],['dot’s response',report.response]])if(value){const text=element('p',undefined,'bug-report-text');text.append(element('strong',label+': '),document.createTextNode(String(value)));item.append(text);}
      if(report.status==='needs_details')item.append(element('p','Send a new report with the requested details and include report '+report.id+'.','subtle'));
      if(report.fixedInRelease)item.append(element('p','Fixed in '+report.fixedInRelease,'subtle'));
      list.append(item);
    }
    reportsCursor=typeof data.nextCursor==='string'?data.nextCursor:null;earlier.hidden=!reportsCursor;
    $('#bugReportListStatus').textContent=list.childElementCount?'':'No reports yet.';
  }catch(error){$('#bugReportListStatus').textContent=error.message;}
  finally{button.disabled=false;earlier.disabled=false;}
}

function renderConnection(data){
  const enabled=!!data.enabled;$('#createBugDotLink').hidden=enabled;$('#replaceBugDotLink').hidden=!enabled;$('#revokeBugDotLink').hidden=!enabled;
  $('#bugDotStatus').textContent=enabled?'Private connection ready. Keep its link with your ChatGPT task.':'No private connection link is active.';
  if(data.token){$('#bugDotLinkField').hidden=false;$('#bugDotLink').value=location.origin+'/support.html#token='+encodeURIComponent(data.token);$('#bugDotLink').select();}
  else{$('#bugDotLinkField').hidden=true;$('#bugDotLink').value='';}
}
async function changeConnection(action){
  const buttons=[...$('#bugDotConnection').querySelectorAll('button')];buttons.forEach(button=>button.disabled=true);
  try{renderConnection(await request('/api/bug-reports/automation',{action}));}
  catch(error){$('#bugDotStatus').textContent=error.message;}
  finally{buttons.forEach(button=>button.disabled=false);}
}

function editing(){
  return document.hidden||!!$('dialog[open]')||!!$('#setupWizard:not([hidden])')||!!document.activeElement?.matches('input,textarea,select,[contenteditable="true"]')||!!$('#incomeDropdown.open,#budgetDropdown.open');
}
function renderRelease(){
  const release=releaseData.release,needsReload=release.id!==APP_RELEASE.id;
  displayedReleaseId=release.id;
  $('#bugReleaseDialogTitle').textContent=needsReload?'An update is ready':'BearDen was updated';
  $('#bugReleaseTitle').textContent=release.title||'Latest update';$('#bugReleaseNotes').replaceChildren();
  for(const note of release.notes||[])$('#bugReleaseNotes').append(element('li',note));
  $('#bugReleaseVersion').textContent='Version '+release.id;
  $('#bugReleaseHelp').textContent=needsReload?'The update is live. Reload when you are ready; your current page will stay open until you choose to reload.':'You are using this update.';
  $('#bugReleaseReload').hidden=!needsReload;$('#bugReleaseDismiss').textContent=needsReload?'Later':'Done';$('#bugReleaseStatus').textContent='';
}
function maybeShowRelease(){
  if(!account?.authenticated||!releaseData?.release?.id||releaseData.acknowledged||dismissed.has(releaseData.release.id)||editing())return;
  renderRelease();releaseDialog.showModal();
}
async function checkRelease(){
  if(requestInFlight||!account?.authenticated)return;requestInFlight=true;
  try{const data=await request('/api/app-release');if(data.release?.id){releaseData=data;maybeShowRelease();}}
  catch{}finally{requestInFlight=false;}
}
async function openUpdates(){
  if(!account?.authenticated){window.showBearToast?.('Sign in to see app updates.');return;}
  try{const data=await request('/api/app-release');if(!data.release?.id)throw Error('Update information is not available yet.');releaseData=data;renderRelease();if(!releaseDialog.open)releaseDialog.showModal();}
  catch(error){window.showBearToast?.(error.message,{kind:'error'});}
}
async function dismissRelease(){
  const id=displayedReleaseId;if(!id)return;
  dismissed.add(id);if(releaseDialog.open)releaseDialog.close();
  try{await request('/api/app-release/ack',{releaseId:id});if(releaseData?.release?.id===id)releaseData.acknowledged=true;}
  catch{window.showBearToast?.('The update notice was closed. Its dismissal could not be saved yet.',{kind:'error'});}
}

async function start(){
  mount();await window.BearDen?.ready;account=window.BearDen?.config||{};
  await window.classicReady;await checkRelease();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
