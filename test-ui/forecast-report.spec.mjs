import {test,expect} from './original-design.fixture.mjs';
import {readFileSync} from 'node:fs';
import {runtime} from '../cloudflare/worker.mjs';
import {blank} from '../public/engine.mjs';
import {PDFDocument} from '../public/vendor/pdf-lib.mjs';

// Exercise the real forecast, PDF renderer and production asset allowlist.
// Only the account API is a disposable fixture; exports must never save it.
async function fixture(page,{stale=false,share=false,width=390,blockPdf=false,holdPdf=false}={}){
 await page.setViewportSize({width,height:844});
 await page.clock.setFixedTime(new Date('2026-10-28T16:00:00Z'));
 await page.addInitScript(supported=>{
  window.reportShares=[];
  Object.defineProperty(navigator,'canShare',{configurable:true,value:({files}={})=>supported&&files?.length===1});
  Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{
   window.reportShares.push({title:data.title,files:data.files.map(f=>({name:f.name,type:f.type,size:f.size}))});
  }});
 },share);
 const accounts=[
  {id:'lunchflow-personal',name:'Personal checking',balance:5872},
  {id:'lunchflow-bills',name:'Bills checking',balance:200000,balanceStale:stale},
 ].map(a=>({...a,source:'lunchflow',type:'depository',subtype:'checking',currency:'USD',include:true,balanceUpdated:stale?'2026-10-20T15:00:00Z':'2026-10-28T15:00:00Z'}));
 const planner={manual:[{id:'rent',name:'Rent',date:'2026-11-10',amount:120000,repeat:'monthly',source:'manual',billKind:'rent'}],billFunding:{rent:'shared'},household:{enabled:true,personalAccountId:accounts[0].id,billsAccountId:accounts[1].id,personalAmount:75500,spouseAmount:50000,spouseStartDate:'2026-11-06',spouseRepeat:'biweekly'}};
 const state={cards:[{id:1,name:'Visa',balance:10000,apr:0,min:50,monthlyMinimum:108.33}],cardIdCounter:1,budgetItems:[{id:1,label:'Car Fuel',amount:100},{id:2,label:'Groceries',amount:100},{id:3,label:'Personal spending',amount:25}],budgetItemIdCounter:3,budgetSetupVersion:2,startDate:'2026-11-06',takeHome:'1840.23',payoffMethod:'snowball',savingsGoals:[]};
 let tracker={state:{version:1,values:{'app-state':JSON.stringify(state),onboarding:JSON.stringify({completed:true}),'income-planner':JSON.stringify(planner)}},revision:0};
 const writes=[];
 let releasePdf,blocked=blockPdf;
 const waiting=holdPdf?new Promise(resolve=>releasePdf=resolve):null;
 const app=runtime({APP_URL:'https://bearden.test',ASSETS:{fetch:async req=>{
  const path=new URL(req.url).pathname,name=path==='/'?'index.html':path.slice(1);
  try{return new Response(readFileSync(new URL('../public/'+name,import.meta.url)),{headers:{'Content-Type':name.endsWith('.css')?'text/css':/\.(js|mjs)$/.test(name)?'text/javascript':'text/html'}});}catch{return new Response('',{status:404});}
 }}});
 await page.route('https://bearden.test/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(path==='/vendor/pdf-lib.mjs'){
   if(waiting)await waiting;
   if(blocked)return route.fulfill({status:503,body:'PDF library temporarily unavailable'});
  }
  if(path==='/api/config')return route.fulfill({json:{authenticated:true,accountId:'forecast-report-fixture',bankProvider:'lunchflow'}});
  if(path==='/api/banks/retire')return route.fulfill({json:{ok:true}});
  if(path==='/api/classic'){
   if(request.method()==='POST'){
    writes.push(request.postDataJSON());tracker={state:request.postDataJSON().state,revision:tracker.revision+1};
   }
   return route.fulfill({json:request.method()==='GET'?tracker:{revision:tracker.revision}});
  }
  if(path==='/api/state')return route.fulfill({json:{state:{...blank(),accounts},connections:{items:[],transactions:[],creditCards:[],gmailMessages:[],recurringBills:[]},revision:0}});
  if(path.startsWith('/api/'))return route.fulfill({status:404,json:{}});
  const response=await app.handle(new Request(request.url()));
  return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
 });
 await page.goto('https://bearden.test/');await page.evaluate(()=>window.classicReady);
 await expect(page.locator('#configureHousehold')).toBeEnabled();
 await expect(page.locator('#incomeForecast .forecast-main')).toHaveText('$508.72');
 await page.evaluate(()=>window.flushBearDenState());
 return {writes,releasePdf,unblockPdf:()=>blocked=false,get state(){return structuredClone(tracker.state);}};
}

async function ready(page){
 await expect(page.locator('#forecastReportDialog')).toBeVisible();
 await expect(page.locator('#forecastReportDialog')).toContainText('Your report is ready',{timeout:30000});
 await expect(page.locator('#forecastReportDownload')).toHaveAttribute('href',/^blob:/);
}

async function downloadedPdf(page){
 const downloadPromise=page.waitForEvent('download');
 await page.locator('#forecastReportDownload').click();
 const download=await downloadPromise;
 expect(download.suggestedFilename()).toMatch(/^BearDen-.*\.pdf$/i);
 const bytes=readFileSync(await download.path());
 expect(bytes.subarray(0,5).toString()).toBe('%PDF-');
 const pdf=await PDFDocument.load(bytes);
 expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
 return {pdf,filename:download.suggestedFilename(),bytes};
}

test('PDF summarizes the full bills simulation in two pages and offers optional complete ledgers without changing financial state',async({page})=>{
 test.setTimeout(60000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));const f=await fixture(page);
 await page.locator('#nav-bills').click();await page.locator('#accounts-nav-calendar').click();await page.locator('#billsForecastScrub').fill('9');
 await expect(page.locator('#billsForecast .forecast-ledger-row')).toHaveCount(3);
 const before=f.state,writes=f.writes.length;
 await page.locator('[data-export-forecast="bills"]').click();await ready(page);
 await expect(page.locator('#forecastReportSummary')).toContainText('Nov 27');
 await expect(page.locator('#forecastReportDetails')).toContainText(/5 (?:forecast )?(?:ledger )?(?:entries|rows)/i);
 await expect(page.locator('#forecastReportShare')).toBeHidden();
 const {pdf,filename}=await downloadedPdf(page);
 expect(filename).toContain('2026-10-28');
 expect(pdf.getPageCount()).toBe(2);
 expect(filename).toContain('-summary.pdf');
 expect(pdf.getTitle()).toMatch(/bills/i);
 await expect(page.locator('#forecastReportIncludeLedgers')).not.toBeChecked();
 await page.locator('#forecastReportIncludeLedgers').check();await ready(page);
 const detailed=await downloadedPdf(page);
 expect(detailed.filename).toContain('-detailed.pdf');
 expect(detailed.pdf.getPageCount()).toBeGreaterThan(pdf.getPageCount());
 await expect(page.locator('#forecastReportDetails')).toContainText('included in the ledgers');
 await page.locator('#forecastReportIncludeLedgers').uncheck();await ready(page);
 const compact=await downloadedPdf(page);
 expect(compact.pdf.getPageCount()).toBe(pdf.getPageCount());
 expect(f.state).toEqual(before);expect(f.writes.length).toBe(writes);
 await page.locator('#closeForecastReport').click();await expect(page.locator('#forecastReportDialog')).not.toBeVisible();
 await expect(page.locator('#billsForecast .forecast-main')).toHaveText('$2,055.00');
 expect(errors).toEqual([]);
});

test('a stale bills balance exports an explanatory report and sharing requires an explicit tap',async({page})=>{
 test.setTimeout(60000);
 const f=await fixture(page,{stale:true,share:true,width:320});
 await page.locator('#nav-bills').click();await page.locator('#accounts-nav-calendar').click();
 const before=f.state,writes=f.writes.length;
 await page.locator('[data-export-forecast="bills"]').click();await ready(page);
 await expect(page.locator('#forecastReportDetails')).toContainText(/reclamation.*unavailable|refresh.*(?:reclamation|balance|bank)/i);
 await expect(page.locator('#forecastReportShare')).toBeVisible();
 expect(await page.evaluate(()=>window.reportShares)).toEqual([]);
 expect(await page.locator('#forecastReportDialog').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&el.scrollWidth<=el.clientWidth;})).toBe(true);
 await expect(page.locator('html')).toHaveClass(/popup-scroll-locked/);
 await page.locator('#forecastReportShare').click();
 await expect.poll(()=>page.evaluate(()=>window.reportShares.length)).toBe(1);
 const [share]=await page.evaluate(()=>window.reportShares);
 expect(share.files).toHaveLength(1);expect(share.files[0].type).toBe('application/pdf');
 expect(share.files[0].size).toBeGreaterThan(1000);expect(share.files[0].name).toMatch(/^BearDen-.*\.pdf$/i);
 const {pdf}=await downloadedPdf(page);expect(pdf.getTitle()).toMatch(/bills/i);expect(pdf.getPageCount()).toBe(1);
 expect(f.state).toEqual(before);expect(f.writes.length).toBe(writes);
 await page.locator('#closeForecastReport').click();await expect(page.locator('html')).not.toHaveClass(/popup-scroll-locked/);
});

test('a missing optional PDF library shows a local export error and can be retried without changing the forecast',async({page})=>{
 test.setTimeout(60000);const f=await fixture(page,{blockPdf:true});await page.locator('#nav-bills').click();await page.locator('#accounts-nav-calendar').click();
 await page.locator('[data-export-forecast="bills"]').click();
 await expect(page.locator('#forecastReportDialog')).toBeVisible();
 await expect(page.locator('#forecastReportStatus')).toContainText(/could not|couldn't|unable|try again|reload/i,{timeout:15000});
 await expect(page.locator('#forecastReportDownload')).toBeHidden();
 f.unblockPdf();await page.locator('#retryForecastReport').click();await ready(page);await downloadedPdf(page);
 await page.locator('#closeForecastReport').click();
 await expect(page.locator('#incomeForecast .forecast-main')).toHaveText('$508.72');
 await page.locator('#nav-income').click();
 await page.locator('[data-forecast-debt-mode="none"]').click();
 await expect(page.locator('#incomeForecast .forecast-main')).toHaveText('$2,229.18');
});

test('closing during PDF generation does not reopen the report or publish a stale download',async({page})=>{
 test.setTimeout(60000);const f=await fixture(page,{holdPdf:true});await page.locator('#nav-bills').click();await page.locator('#accounts-nav-calendar').click();
 const requested=page.waitForRequest(/\/vendor\/pdf-lib\.mjs/);
 await page.locator('[data-export-forecast="bills"]').click();await requested;
 await expect(page.locator('#forecastReportDialog')).toBeVisible();
 await page.locator('#closeForecastReport').click();f.releasePdf();
 // Wait for the delayed dependency to finish; the cancelled generation must stay closed.
 await page.evaluate(()=>import('/vendor/pdf-lib.mjs'));
 await expect(page.locator('[data-export-forecast="bills"]')).toBeEnabled({timeout:30000});
 await expect(page.locator('#forecastReportDialog')).not.toBeVisible();
 await expect(page.locator('#forecastReportDownload')).toBeHidden();
 await expect(page.locator('html')).not.toHaveClass(/popup-scroll-locked/);
 await expect(page.locator('#incomeForecast .forecast-main')).toHaveText('$508.72');
});
