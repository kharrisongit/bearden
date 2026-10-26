import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {blank} from '../public/engine.mjs';
async function fixture(page,{signed=false,configured=true}={}){
 const account={id:'ms-inbox',provider:'microsoft',email:'person@hotmail.com',status:'Connected'};
 await page.route('https://bearden.test/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/config')return route.fulfill({json:{authenticated:signed,email:signed?account.email:null,accountId:signed?'microsoft-profile':null,googleConfigured:false,microsoftConfigured:configured}});
  if(path==='/api/classic')return route.fulfill({json:{state:{version:1,values:signed?{onboarding:JSON.stringify({completed:true})}:{}},revision:0}});
  if(path==='/api/state')return route.fulfill({json:{state:blank(),revision:0,connections:{items:[],transactions:[],candidates:[],gmail:false,emailConnected:true,mailAccounts:[account],gmailAccounts:[],outlookAccounts:[account],gmailMessages:[]}}});
  if(path==='/api/gmail/search')return route.fulfill({json:{emailConnected:true,mailAccounts:[{...account,status:'Checked bills and payments.'}],gmailAccounts:[],outlookAccounts:[account],gmailMessages:[]}});
  if(path.startsWith('/api/'))return route.fulfill({status:404,json:{}});
  if(path.startsWith('/auth/'))return route.fulfill({body:'Microsoft redirect fixture',contentType:'text/plain'});
  const name=path==='/'?'index.html':path.slice(1),contentType=name.endsWith('.css')?'text/css':/\.(js|mjs)$/.test(name)?'text/javascript':'text/html';
  try{return route.fulfill({body:readFileSync(new URL('../public/'+name,import.meta.url)),contentType});}catch{return route.fulfill({status:404,body:''});}
 });
 await page.goto('https://bearden.test/');await page.evaluate(()=>window.classicReady);
}
test('new Microsoft user can sign in directly from mobile setup',async({page})=>{
 await page.setViewportSize({width:390,height:844});await fixture(page);
 const login=page.locator('#setupContent a[href="/auth/microsoft"]');await expect(login).toBeVisible();await expect(page.locator('#setupContent a[href="/auth/google"]')).toHaveCount(0);await login.click();await expect(page).toHaveURL('https://bearden.test/auth/microsoft');
});
test('Hotmail-only profile lists its inbox, checks bills and can add another Microsoft inbox',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await fixture(page,{signed:true});await page.locator('#nav-settings').click();
 await expect(page.locator('#classicMicrosoftLogin')).toBeHidden();await expect(page.locator('#gmailAccountList')).toContainText('person@hotmail.com');await expect(page.locator('#gmailAccountSummary')).toHaveText('Email accounts (1)');await expect(page.locator('#classicGmail')).toBeDisabled();
 await page.locator('#checkGmailAccounts').click();await expect(page.locator('#gmailFeedback')).toHaveText('Email checked.');await page.locator('#classicOutlook').click();await expect(page).toHaveURL('https://bearden.test/auth/microsoft?mail=1&account=microsoft-profile');expect(errors).toEqual([]);
});
test('missing Microsoft setup does not offer a broken sign-in link',async({page})=>{
 await fixture(page,{configured:false});await expect(page.locator('#setupContent')).toContainText('Microsoft sign-in is being set up.');await expect(page.locator('#setupContent a[href="/auth/microsoft"]')).toHaveCount(0);
});
