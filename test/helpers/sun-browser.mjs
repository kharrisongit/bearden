export function fakeSunBrowser(){
 const state={loggedIn:true,closed:[],calls:[],starts:[],targets:[],cookies:[{name:'auth',value:'sun-cookie-secret',domain:'.sunwebportal.com',path:'/',secure:true,httpOnly:true,expires:-1},{name:'other',value:'unrelated-secret',domain:'.google.com',path:'/'}],session:JSON.stringify({userAccount:{security:{token:'sun-access-secret',refreshToken:'sun-refresh-secret'}}}),data:{totalDue:1025.45,balance:1040.45,dueDate:'2026-11-01T00:00:00',currencyCode:'USD'},agreement:'property-a'};
 class Socket extends EventTarget{
  accept(){}
  close(){this.dispatchEvent(new Event('close'));}
  emit(data){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(data)}));}
  send(raw){const m=JSON.parse(raw);state.calls.push(m);let result={};
   if(m.method==='Runtime.evaluate')result={result:{value:state.page&&m.params.expression.includes('document.body')?state.page:state.storage&&m.params.expression.includes('const read=s=>')?state.storage:m.params.expression==='location.href'?'https://app.sunwebportal.com/'+(state.loggedIn?'portal/payments':'auth/login'):{session:state.session,currency:'USD'}}};
   if(m.method==='Network.getResponseBody')result={body:JSON.stringify(state.data),base64Encoded:false};
   if(m.method==='Network.getCookies')result={cookies:state.cookies};
   queueMicrotask(()=>{this.emit({id:m.id,result});if(m.method==='Page.navigate'){this.emit({method:'Network.responseReceived',params:{requestId:'balance',response:{url:'https://portal-api.app.sunwebportal.com/Payment/GetCurrentBalanceBySelf/'+state.agreement,status:200}}});this.emit({method:'Network.loadingFinished',params:{requestId:'balance'}});}});
  }
 }
 const binding={async acquire(options){state.starts.push(options);return {sessionId:'private-browser-'+state.starts.length};},async closeSession(id){state.closed.push(id);},async getLiveView(){return {devtoolsFrontendUrl:'https://live.browser.run/?token=private-live-secret'};},async connectSession(){return {webSocket:{fetch:async()=>({webSocket:new Socket()})}};},devtools:{async newTarget(id,url){state.targets.push(url);return {id:'target'};}}};
 return {binding,state};
}
