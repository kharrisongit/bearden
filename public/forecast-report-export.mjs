// Reports are created from a fixed simulation snapshot, entirely in the browser.
// A second, explicit tap opens the native share sheet so iOS keeps user activation.
let dialog,request=0,objectUrl=null,currentFile=null,currentSnapshot=null,returnFocus=null,retry=0;

const icon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6"/></svg>';
const dateLabel=value=>new Date(value+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
const $=id=>dialog.querySelector('#'+id);

function release(){
 if(objectUrl)URL.revokeObjectURL(objectUrl);
 objectUrl=null;currentFile=null;
 if(dialog){$('forecastReportDownload').removeAttribute('href');$('forecastReportDownload').hidden=true;$('forecastReportShare').hidden=true;}
}

function ensureDialog(){
 if(dialog)return;
 dialog=document.createElement('dialog');
 dialog.id='forecastReportDialog';dialog.className='income-card forecast-report-dialog';
 dialog.setAttribute('aria-labelledby','forecastReportTitle');
 dialog.innerHTML='<div class="report-dialog-top"><span class="report-dialog-brand">BEARDEN / REPORTS</span><button type="button" id="closeForecastReport" aria-label="Close forecast report">Close</button></div>'+
  '<div class="report-document-icon">'+icon+'</div><h2 id="forecastReportTitle">Preparing your report</h2><p id="forecastReportSummary" class="subtle"></p>'+
  '<div id="forecastReportProgress" class="report-progress" role="progressbar" aria-label="Creating forecast PDF"><span></span></div>'+
  '<p class="report-contents subtle">A compact summary with your balance graph, monthly totals, shortfalls and contribution reclamation plan.</p>'+
  '<label class="report-ledger-option"><input type="checkbox" id="forecastReportIncludeLedgers" aria-describedby="forecastReportLedgerHint"><span>Include detailed ledgers<small id="forecastReportLedgerHint">Adds every forecast and extended safety-check entry. More pages.</small></span></label>'+
  '<p id="forecastReportDetails" class="subtle"></p><p id="forecastReportStatus" role="status" aria-live="polite"></p>'+
  '<div class="report-download-actions"><a id="forecastReportDownload" class="report-primary" hidden>Save PDF</a><button type="button" id="forecastReportShare" hidden>Share PDF</button><button type="button" id="retryForecastReport" hidden>Try again</button></div>'+
  '<p class="report-device-note subtle">Created on your device from this simulation. Exporting does not change your plan.</p>';
 document.body.append(dialog);
 $('closeForecastReport').onclick=()=>dialog.close();
 dialog.addEventListener('close',()=>{request++;release();currentSnapshot=null;returnFocus?.focus({preventScroll:true});});
 $('retryForecastReport').onclick=()=>{if(currentSnapshot)generate(currentSnapshot);};
 $('forecastReportIncludeLedgers').onchange=()=>{if(currentSnapshot)generate(currentSnapshot);};
 $('forecastReportShare').onclick=async()=>{
  if(!currentFile)return;
  const file=currentFile,token=request;const button=$('forecastReportShare');button.disabled=true;
  try{
   await navigator.share({files:[file],title:'BearDen simulation report'});
   if(token===request)$('forecastReportStatus').textContent='Share sheet closed. Your PDF is still available to save.';
  }catch(error){
   if(token===request)$('forecastReportStatus').textContent=error.name==='AbortError'?'Sharing canceled. You can still save the PDF.':'Sharing is unavailable here. Use Save PDF to keep a copy.';
  }finally{if(token===request)button.disabled=false;}
 };
 $('forecastReportDownload').onclick=()=>{$('forecastReportStatus').textContent='Your PDF is ready to save. On iPhone, choose Share or Save to Files if a preview opens.';};
}

async function generate(snapshot){
 const token=++request;release();currentSnapshot=snapshot;
 const includeLedgers=$('forecastReportIncludeLedgers').checked;
 $('forecastReportTitle').textContent='Preparing your report';
 $('forecastReportSummary').textContent=dateLabel(snapshot.start)+' - '+dateLabel(snapshot.forecast.end)+' · '+(includeLedgers?'Summary and detailed ledgers':'Compact summary');
 $('forecastReportDetails').textContent=includeLedgers?'Adding the complete forecast and safety-check ledgers.':'Summarizing the full forecast and reclamation plan.';
 $('forecastReportStatus').textContent='';$('retryForecastReport').hidden=true;$('forecastReportProgress').hidden=false;
 dialog.setAttribute('aria-busy','true');
 try{
  const suffix=retry?'&retry='+retry:'';
  const [{buildForecastReport},{renderForecastPdf}]=await Promise.all([
   import('./forecast-report-data.mjs?v=forecast-report1'+suffix),
   import('./forecast-report-pdf.mjs?v=compact-report1'+suffix),
  ]);
  if(token!==request||!dialog.open)return;
  const report=buildForecastReport(snapshot);
  // Let the loading state paint before laying out a long ledger.
  await new Promise(resolve=>setTimeout(resolve,0));
  if(token!==request||!dialog.open)return;
  const result=await renderForecastPdf(report,{retry,includeLedgers});
  if(token!==request||!dialog.open)return;
  const blob=new Blob([result.bytes],{type:'application/pdf'});
  objectUrl=URL.createObjectURL(blob);
  currentFile=typeof File==='function'?new File([blob],result.filename,{type:'application/pdf'}):null;
  const download=$('forecastReportDownload');download.href=objectUrl;download.download=result.filename;download.hidden=false;
  let canShare=false;
  try{canShare=!!(currentFile&&navigator.share&&navigator.canShare?.({files:[currentFile]}));}catch{}
  $('forecastReportShare').hidden=!canShare;$('forecastReportShare').disabled=false;
  $('forecastReportTitle').textContent='Your report is ready';
  $('forecastReportSummary').textContent=report.accountName+' · '+dateLabel(report.start)+' - '+dateLabel(report.end)+' · '+result.pageCount+(result.pageCount===1?' page':' pages');
  $('forecastReportDetails').textContent=report.ledger.length+' forecast entries '+(includeLedgers?'included in the ledgers.':'summarized.')+(report.reclamation.status==='ready'?' Reclamation checked through '+dateLabel(report.reclamation.checkedThrough)+'.':' Reclamation unavailable: '+report.reclamation.reason);
  $('forecastReportStatus').textContent=canShare?'Save a copy or choose Share PDF to send it.':'Choose Save PDF to download your report.';
 }catch(error){
  if(token!==request||!dialog.open)return;
  retry++;release();$('forecastReportTitle').textContent='Your report could not be created';
  $('forecastReportDetails').textContent='Your forecast is unchanged.';
  $('forecastReportStatus').textContent='Please try again. If you are offline, reconnect so the report tools can load.';
  $('retryForecastReport').hidden=false;
 }finally{
  if(token===request){dialog.removeAttribute('aria-busy');$('forecastReportProgress').hidden=true;}
 }
}

export function openForecastReport(snapshot,trigger){
 ensureDialog();returnFocus=trigger||document.activeElement;
 $('forecastReportIncludeLedgers').checked=false;
 if(!dialog.open)dialog.showModal();
 return generate(structuredClone(snapshot));
}
