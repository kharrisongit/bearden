import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

test('Lunch Flow controls clear the token, refresh imported accounts, and save explicit debt interpretation',async()=>{
 const elements=new Map(),requests=[];
 function element(id){if(!elements.has(id))elements.set(id,{hidden:false,textContent:'',innerHTML:'',value:'',disabled:false,dataset:{},handlers:{},addEventListener(name,fn){this.handlers[name]=fn;},focus(){},setAttribute(){},removeAttribute(){}});return elements.get(id);}
 const state={accounts:[],debts:[],income:[],goals:[]},connections={items:[],creditCards:[],transactions:[],gmailAccounts:[],lunchflow:null};
 const window={dispatchEvent(){},addEventListener(){},selectBearTab(){}};
 const context={MutationObserver:class{observe(){}},window,document:{querySelector:element,querySelectorAll:()=>[],addEventListener(){}},Event,URLSearchParams,structuredClone,Intl,console,confirm:()=>true,history:{replaceState(){}},location:{search:''},sessionStorage:{getItem:()=>null},localStorage:{getItem:()=>null},fetch:async(path,options)=>{
  const body=options?.body?JSON.parse(options.body):null;requests.push({path,body});
  if(path==='/api/config')return Response.json({authenticated:true,accountId:'owner',googleConfigured:true});
  if(path==='/api/classic')return Response.json({state:{values:{}},revision:0});
  if(path==='/api/state')return Response.json({state,connections,revision:0});
  if(path==='/api/lunchflow/connect'){assert.equal(body.apiKey,'only-once');assert.equal(element('#lunchflowToken').value,'');connections.lunchflow={connected:true,status:'Connected'};state.accounts=[{id:'lunchflow-one',name:'Indigo',source:'lunchflow',type:'unknown',currency:'USD',rawBalance:-21845,balance:-21845}];return Response.json({status:'Connected'});}
  if(path==='/api/lunchflow/account'){assert.deepEqual(body,{id:'lunchflow-one',kind:'credit',debtSign:'negative'});Object.assign(state.accounts[0],{type:'credit',debtSign:'negative',balance:21845});return Response.json({ok:true});}
  if(path==='/api/lunchflow/refresh')return Response.json({status:'Showing saved balances; checked recently.'});
  if(path==='/api/lunchflow/disconnect'){connections.lunchflow=null;state.accounts=[];return Response.json({status:'Disconnected'});}
  throw Error('Unexpected API '+path);
 }};
 vm.runInNewContext(readFileSync('public/connections.js','utf8'),context);await window.BearDen.ready;
 element('#lunchflowToken').value='only-once';await element('#lunchflowConnectForm').onsubmit({preventDefault(){}});
 assert.equal(element('#lunchflowToken').value,'');assert.equal(element('#lunchflowActions').hidden,false);assert.match(element('#lunchflowAccounts').innerHTML,/Indigo/);assert.match(element('#lunchflowAccounts').innerHTML,/218.45 owed/);
 const status=element('accountStatus'),button=element('accountButton'),form={dataset:{lunchflowAccount:'lunchflow-one'},elements:{kind:{value:'credit'},debtSign:{value:'negative'}},querySelector:s=>s==='button[type=submit]'?button:status};
 await element('#lunchflowAccounts').handlers.submit({preventDefault(){},target:{closest:()=>form}});
 assert.equal(button.disabled,false);assert.equal(element('#lunchflowStatus').textContent,'Connected');assert.equal(element('#lunchflowStatus').dataset.connected,'true');assert.match(element('#lunchflowFeedback').textContent,/Account type saved/);
 await element('#lunchflowRefresh').onclick();assert.equal(element('#lunchflowStatus').textContent,'Connected');assert.match(element('#lunchflowFeedback').textContent,/checked recently/);
 await element('#lunchflowDisconnect').onclick();assert.equal(element('#lunchflowActions').hidden,true);assert.equal(element('#lunchflowAccounts').innerHTML,'');
 const sent=requests.filter(x=>x.body?.apiKey);assert.equal(sent.length,1);assert.equal(requests.filter(x=>x.path==='/api/classic'&&x.body).length,0);
});
