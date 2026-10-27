import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {blank} from '../public/engine.mjs';

const publicUrl=new URL('../public/',import.meta.url);
const html=readFileSync(new URL('index.html',publicUrl),'utf8');
const css=[...html.matchAll(/<link[^>]+href="([^"?]+\.css)(?:\?[^\"]*)?"/g)].map(([,name])=>readFileSync(new URL(name,publicUrl),'utf8')).join('\n');
const picker=html.match(/<dialog id="colorPickerDialog"[\s\S]*?<\/dialog>/)[0];
const names=[...picker.matchAll(/data-color-scheme-choice="([a-z]+)"/g)].map(m=>m[1]);

function contrastAudit(){
 const rgb=value=>{const c=value.match(/[\d.]+/g).map(Number);return c.length===3?[...c,1]:c;};
 const over=(a,b)=>[0,1,2].map(i=>a[i]*a[3]+b[i]*(1-a[3])).concat(1);
 const lum=c=>c.slice(0,3).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
 return [...document.body.querySelectorAll('*')].filter(el=>el.checkVisibility()&&(el.matches('input')||[...el.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim()))).map(el=>{
  const style=getComputedStyle(el),stack=[];
  for(let p=el;p;p=p.parentElement)stack.unshift(rgb(getComputedStyle(p).backgroundColor));
  const bg=stack.reduce((b,a)=>over(a,b),[255,255,255,1]),fg=over(rgb(style.color),bg),a=lum(fg),b=lum(bg);
  return {text:el.textContent||el.value,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
 });
}

for(const width of [320,390,1280])for(const mode of ['light','dark'])for(const name of names){
 test(`${name} ${mode} ${width}px: picker and financial controls remain readable`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:844});
  await page.setContent(`<!doctype html><html data-theme="${mode}" data-color-scheme="${name}"><head><style>${css}</style></head><body><main class="wrap">
   <section class="tab-intro"><h2>Accounts</h2><p>Bills and balances in one place.</p></section>
   <section class="income-card account-total-card"><h3>Account balance</h3><strong class="account-total-amount">$1,234,567.89</strong><p class="subtle">Updated today</p></section>
   <section class="income-card"><h3>Forecast</h3><p class="subtle">Next payment · Nov 3</p><input aria-label="Amount" value="$1,234.56">
    <button class="bill-save">Save bill</button><button disabled>Refreshing…</button><button data-bill-paid>Paid</button><button data-bill-unpaid>Mark unpaid</button>
    <div class="forecast-range"><button aria-pressed="true">30 days</button><button aria-pressed="false">90 days</button></div>
    <div class="forecast-stats"><div class="forecast-incoming">Expected deposits <strong>$3,020.00</strong></div><div class="forecast-outgoing">Planned outflow <strong>$3,044.51</strong></div><div class="forecast-lowest">Lowest balance <strong>$33.18</strong></div></div>
    <p class="forecast-warning">Your forecast falls below zero.</p><div class="bill-amount"><span>Amount due</span><strong>$123.45</strong></div><div class="bill-date">Nov 3</div>
   </section><section class="income-card bank-card"><h3>Income</h3><strong class="income-total">$2,345.67</strong><p class="subtle">Available balance</p><div class="income-controls-header"><div class="income-widget-actions"><button aria-expanded="true">Income</button><button>Budget</button></div></div></section>
   <nav class="bottom-tabs"><button aria-selected="true">Accounts</button><button>Settings</button></nav>
   </main>${picker}</body></html>`);
  for(const result of await page.evaluate(contrastAudit))expect(result.ratio,`${result.text} contrast`).toBeGreaterThanOrEqual(4.5);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.evaluate(name=>{document.querySelector(`[data-color-scheme-choice="${name}"]`).setAttribute('aria-pressed','true');document.querySelector('#colorPickerDialog').showModal();},name);
  for(const result of await page.evaluate(contrastAudit))expect(result.ratio,`${result.text} contrast with picker open`).toBeGreaterThanOrEqual(4.5);
  expect(await page.locator('#colorPickerDialog').evaluate(el=>el.scrollWidth<=el.clientWidth&&el.getBoundingClientRect().left>=0&&el.getBoundingClientRect().right<=innerWidth)).toBe(true);
  const chosen=page.locator(`[data-color-scheme-choice="${name}"]`);await chosen.focus();
  expect(await chosen.evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('solid');
  if(width===390&&((name==='ocean'&&mode==='light')||(name==='violet'&&mode==='dark')))await page.screenshot({path:testInfo.outputPath(`${name}-${mode}.png`)});
 });
}

async function app(page){
 let tracker={state:{version:1,values:{'app-state':JSON.stringify({cards:[],budgetItems:[],budgetSetupVersion:2,takeHome:1000,savingsGoals:[]}),onboarding:JSON.stringify({completed:true})}},revision:0};
 await page.route('https://bearden.test/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(path==='/api/config')return route.fulfill({json:{authenticated:true,accountId:'member'}});
  if(path==='/api/classic'){
   if(req.method()==='POST'){tracker={state:req.postDataJSON().state,revision:tracker.revision+1};return route.fulfill({json:{revision:tracker.revision}});}
   return route.fulfill({json:tracker});
  }
  if(path==='/api/state')return route.fulfill({json:{state:blank(),connections:{},revision:0}});
  if(path.startsWith('/api/'))return route.fulfill({status:404,json:{}});
  const name=path==='/'?'index.html':path.slice(1);
  try{return route.fulfill({body:readFileSync(new URL(name,publicUrl)),contentType:name.endsWith('.css')?'text/css':/\.(js|mjs)$/.test(name)?'text/javascript':'text/html'});}catch{return route.fulfill({status:404,body:''});}
 });
 await page.goto('https://bearden.test/');await page.evaluate(()=>window.classicReady);
}
async function openPicker(page){
 await page.locator('#nav-settings').click();await page.locator('#holidayToggleBtn').click();await page.locator('#openColorPicker').click();
 await expect(page.locator('#colorPickerDialog')).toBeVisible();
}

test('tap all ten colors, switch light/dark, remember across reload, reset and restore focus',async({page})=>{
 await page.setViewportSize({width:390,height:844});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await app(page);await openPicker(page);
 for(const name of names){
  await page.locator(`[data-color-scheme-choice="${name}"]`).click();
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme',name);
  await expect(page.locator('[data-color-scheme-choice][aria-pressed="true"]')).toHaveCount(1);
  for(const mode of ['dark','light']){await page.locator(`[data-color-mode="${mode}"]`).click();await expect(page.locator(`#colorPickerStatus`)).toContainText(mode==='dark'?'Dark mode':'Light mode');}
 }
 await page.locator('[data-color-mode="dark"]').click();await page.locator('#closeColorPicker').click();await expect(page.locator('#holidayToggleBtn')).toBeFocused();
 await page.reload();await page.evaluate(()=>window.classicReady);await expect(page.locator('html')).toHaveAttribute('data-color-scheme','slate');await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await openPicker(page);await expect(page.locator('[data-color-scheme-choice="slate"]')).toBeFocused();await page.locator('#resetColorScheme').click();
 await expect(page.locator('html')).not.toHaveAttribute('data-color-scheme');await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await page.keyboard.press('Escape');await expect(page.locator('#colorPickerDialog')).not.toBeVisible();await expect(page.locator('#holidayToggleBtn')).toBeFocused();
 expect(await page.evaluate(()=>localStorage.getItem('bearden:classic:color-scheme'))).toBeNull();expect(errors).toEqual([]);
});

test('saved color works with holiday bears and the existing header mode toggle',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('bearden:classic:color-scheme','rose');localStorage.setItem('bearden:classic:theme','dark');localStorage.setItem('bearden:classic:holiday','christmas');});
 await app(page);await expect(page.locator('html')).toHaveAttribute('data-color-scheme','rose');await expect(page.locator('html')).toHaveAttribute('data-holiday','christmas');
 await page.locator('#nav-settings').click();await page.locator('#themeToggleBtn').click();await expect(page.locator('html')).not.toHaveAttribute('data-theme','dark');await expect(page.locator('html')).toHaveAttribute('data-color-scheme','rose');
 await openPicker(page);await page.locator('[data-color-scheme-choice="forest"]').click();await expect(page.locator('html')).toHaveAttribute('data-holiday','christmas');await page.locator('#closeColorPicker').click();
 await page.locator('#holidayToggleBtn').click();await page.locator('#holidayItemStandard').click();await expect(page.locator('html')).not.toHaveAttribute('data-color-scheme');await expect(page.locator('html')).not.toHaveAttribute('data-holiday');
});
