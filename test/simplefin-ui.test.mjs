import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

test('SimpleFIN controls clear the token, refresh imported accounts, and save explicit debt interpretation',async()=>{
 const elements=new Map(),requests=[];
 function element(id){if(!elements.has(id))elements.set(id,{hidden:false,textContent:'',innerHTML:'',value:'',disabled:false,dataset:{},handlers:{},addEventListener(name,fn){this.handlers[name]=fn;},focus(){},setAttribute(){},removeAttribute(){}});return elements.get(id);}
 const state={accounts:[],debts:[],income:[],goals:[]},connections={items:[],creditCards:[],transactions:[],gmailAccounts:[],simplefin:null};
 const window={dispatchEvent(){},selectBearTab(){}};
 const context={window,document:{querySelector:element,querySelectorAll:()=>[],addEventListener(){}},Event,URLSearchParams,structuredClone,Intl,console,confirm:()=>true,history:{replaceState(){}},location:{search:''},sessionStorage:{getItem:()=>null},localStorage:{getItem:()=>null},fetch:async(path,options)=>{
  const body=options?.body?JSON.parse(options.body):null;requests.push({path,body});
  if(path==='/api/config')return Response.json({authenticated:true,accountId:'owner',googleConfigured:true});
  if(path==='/api/classic')return Response.json({state:{values:{}},revision:0});
  if(path==='/api/state')return Response.json({state,connections,revision:0});
  if(path==='/api/simplefin/connect'){assert.equal(body.token,'only-once');assert.equal(element('#simplefinToken').value,'');connections.simplefin={connected:true,status:'Connected'};state.accounts=[{id:'simplefin-one',name:'Indigo',source:'simplefin',type:'unknown',currency:'USD',rawBalance:-21845,balance:-21845}];return Response.json({status:'Connected'});}
  if(path==='/api/simplefin/account'){assert.deepEqual(body,{id:'simplefin-one',kind:'credit',debtSign:'negative'});Object.assign(state.accounts[0],{type:'credit',debtSign:'negative',balance:21845});return Response.json({ok:true});}
  if(path==='/api/simplefin/refresh')return Response.json({status:'Showing saved balances; checked recently.'});
  if(path==='/api/simplefin/disconnect'){connections.simplefin=null;state.accounts=[];return Response.json({status:'Disconnected'});}
  throw Error('Unexpected API '+path);
 }};
 vm.runInNewContext(readFileSync('public/connections.js','utf8'),context);await window.BearDen.ready;
 element('#simplefinToken').value='only-once';await element('#simplefinConnectForm').onsubmit({preventDefault(){}});
 assert.equal(element('#simplefinToken').value,'');assert.equal(element('#simplefinActions').hidden,false);assert.match(element('#simplefinAccounts').innerHTML,/Indigo/);assert.match(element('#simplefinAccounts').innerHTML,/218.45 owed/);
 const status=element('accountStatus'),button=element('accountButton'),form={dataset:{simplefinAccount:'simplefin-one'},elements:{kind:{value:'credit'},debtSign:{value:'negative'}},querySelector:s=>s==='button'?button:status};
 await element('#simplefinAccounts').handlers.submit({preventDefault(){},target:{closest:()=>form}});
 assert.equal(button.disabled,false);assert.equal(element('#simplefinStatus').textContent,'Connected');assert.equal(element('#simplefinStatus').dataset.connected,'true');assert.match(element('#simplefinFeedback').textContent,/Account type saved/);
 await element('#simplefinRefresh').onclick();assert.equal(element('#simplefinStatus').textContent,'Connected');assert.match(element('#simplefinFeedback').textContent,/checked recently/);
 await element('#simplefinDisconnect').onclick();assert.equal(element('#simplefinActions').hidden,true);assert.equal(element('#simplefinAccounts').innerHTML,'');
 const sent=requests.filter(x=>x.body?.token);assert.equal(sent.length,1);assert.equal(requests.filter(x=>x.path==='/api/classic'&&x.body).length,0);
});
