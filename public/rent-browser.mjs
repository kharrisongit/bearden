// The hosted screencast forwards hardware keys but has no native mobile input.
// Keep this viewer and its masked keyboard draft in memory only. Text travels
// directly to the existing, short-lived Cloudflare session, never a BearDen API.
export function rentLiveSocketURL(value){
 const view=new URL(value);
 if(view.protocol!=='https:'||view.hostname!=='live.browser.run'||view.port||view.username||view.password)throw Error('The private sign-in address could not be verified.');
 const address=view.searchParams.get('wss');
 if(!address)throw Error('Start a new rent sign-in to open the phone keyboard.');
 const socket=new URL(address.startsWith('wss://')?address:'wss://'+address);
 if(socket.protocol!=='wss:'||socket.hostname!=='live.browser.run'||socket.port||socket.username||socket.password||!socket.pathname.startsWith('/api/devtools/browser/')||!socket.searchParams.get('jwt'))throw Error('The private sign-in address could not be verified.');
 return socket.href;
}

export function openRentBrowser({url,expires,onSave}){
 const socketURL=rentLiveSocketURL(url);
 if(!Number.isFinite(expires)||expires<=Date.now())throw Error('This sign-in window expired. Start a new rent connection.');
 const existing=document.querySelector('#rentBrowser');if(existing){existing.focus();return;}
 const dialog=document.createElement('dialog');dialog.id='rentBrowser';dialog.className='rent-browser';
 dialog.setAttribute('aria-labelledby','rentBrowserTitle');
 dialog.innerHTML=`<header class="rent-browser-heading"><h3 id="rentBrowserTitle">Private rent sign-in</h3><button type="button" data-close aria-label="Close private rent browser">Close</button></header>
 <p class="rent-browser-help">Tap a portal field, then Keyboard to type. After signing in, open your balance and save.</p>
 <p class="rent-browser-status" role="status" aria-live="polite">Connecting…</p>
 <div class="rent-browser-screen"><img alt="Your private rent portal. Tap to interact." draggable="false" hidden></div>
 <form class="rent-browser-keyboard" hidden autocomplete="off"><label for="rentBrowserText">Text for the selected portal field</label><div class="rent-browser-entry"><input id="rentBrowserText" type="password" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" maxlength="4096"><button type="button" data-show aria-label="Show typed text">Show</button><button type="submit">Send</button></div><button type="button" data-cancel>Cancel typing</button></form>
 <footer class="rent-browser-controls"><button type="button" data-keyboard disabled>Keyboard</button><button type="button" data-save disabled>Save connection</button></footer>`;
 document.body.append(dialog);
 const $=s=>dialog.querySelector(s),screen=$('.rent-browser-screen'),picture=$('img'),status=$('[role=status]'),form=$('form'),input=$('input'),keyboard=$('[data-keyboard]'),save=$('[data-save]');
 let socket,closed=false,ready=false,saving=false,nextId=0,frame=null,target=null,sequence=Promise.resolve(),gesture=null;
 const pending=new Map();
 const errorMessage='The private browser disconnected. Close this view and reopen it, or start a new sign-in if it expired.';
 function failPending(){for(const request of pending.values()){clearTimeout(request.timer);request.reject(Error(errorMessage));}pending.clear();}
 function send(method,params={}){
  if(closed||socket?.readyState!==WebSocket.OPEN)return Promise.reject(Error(errorMessage));
  return new Promise((resolve,reject)=>{const id=++nextId,timer=setTimeout(()=>{pending.delete(id);reject(Error('The private browser took too long to respond. Try again.'));},15000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
 }
 function run(task){sequence=sequence.catch(()=>{}).then(()=>{if(!closed)return task();}).catch(()=>{if(!closed)status.textContent=errorMessage;});return sequence;}
 function hideKeyboard(){input.value='';input.type='password';input.blur();form.hidden=true;$('[data-show]').textContent='Show';$('[data-show]').setAttribute('aria-label','Show typed text');target=null;}
 function viewport(){const v=window.visualViewport;dialog.style.setProperty('--rent-view-height',(v?.height||window.innerHeight)+'px');dialog.style.setProperty('--rent-view-top',(v?.offsetTop||0)+'px');}
 function cleanup(){
  if(closed)return;hideKeyboard();closed=true;ready=false;clearTimeout(expiryTimer);failPending();
  if(socket?.readyState===WebSocket.OPEN){socket.send(JSON.stringify({id:++nextId,method:'Page.stopScreencast'}));socket.send(JSON.stringify({id:++nextId,method:'Runtime.releaseObjectGroup',params:{objectGroup:'bearden-rent-input'}}));}
  socket?.close();picture.removeAttribute('src');frame=null;window.visualViewport?.removeEventListener('resize',viewport);window.visualViewport?.removeEventListener('scroll',viewport);window.removeEventListener('pagehide',close);dialog.remove();
 }
 function close(){if(dialog.open)dialog.close();cleanup();}
 dialog.addEventListener('close',cleanup);$('[data-close]').onclick=close;
 dialog.addEventListener('cancel',event=>{if(saving)event.preventDefault();});
 window.addEventListener('pagehide',close);window.visualViewport?.addEventListener('resize',viewport);window.visualViewport?.addEventListener('scroll',viewport);
 const expiryTimer=setTimeout(()=>{ready=false;keyboard.disabled=save.disabled=true;hideKeyboard();status.textContent='This sign-in window expired. Close it and start a new connection.';socket?.close();},Math.max(0,expires-Date.now()));
 viewport();dialog.showModal();
 socket=new WebSocket(socketURL);
 socket.onmessage=event=>{
  let message;try{message=JSON.parse(event.data);}catch{return;}
  if(message.id){const request=pending.get(message.id);if(!request)return;pending.delete(message.id);clearTimeout(request.timer);message.error?request.reject(Error('The portal could not complete that action.')):request.resolve(message.result);return;}
  if(message.method==='Page.screencastFrame'){
   const p=message.params;if(closed)return;
   frame=p.metadata;picture.src='data:image/jpeg;base64,'+p.data;picture.hidden=false;
   send('Page.screencastFrameAck',{sessionId:p.sessionId}).catch(()=>{});
  }
 };
 socket.onclose=socket.onerror=()=>{ready=false;keyboard.disabled=save.disabled=true;hideKeyboard();failPending();if(!closed&&!saving)status.textContent=Date.now()>=expires?'This sign-in window expired. Close it and start a new connection.':errorMessage;};
 socket.onopen=()=>run(async()=>{
  await send('Page.enable');await send('Runtime.enable');
  const width=Math.max(320,Math.min(800,Math.round(screen.clientWidth)));
  await send('Emulation.setDeviceMetricsOverride',{width,height:Math.max(500,Math.min(900,Math.round(screen.clientHeight))),deviceScaleFactor:1,mobile:false});
  await send('Page.startScreencast',{format:'jpeg',quality:80,everyNthFrame:1});
  ready=true;keyboard.disabled=save.disabled=false;status.textContent='Connected to your private browser.';
 });
 function coordinates(event){const rect=picture.getBoundingClientRect();return {x:(event.clientX-rect.left)*frame.deviceWidth/rect.width,y:(event.clientY-rect.top)*frame.deviceHeight/rect.height-(frame.offsetTop||0)};}
 picture.addEventListener('pointerdown',event=>{if(!ready||saving||!form.hidden||!frame)return;event.preventDefault();picture.setPointerCapture(event.pointerId);gesture={id:event.pointerId,start:coordinates(event),last:coordinates(event),moved:false};});
 picture.addEventListener('pointermove',event=>{
  if(!gesture||gesture.id!==event.pointerId)return;const point=coordinates(event),deltaY=gesture.last.y-point.y,deltaX=gesture.last.x-point.x;
  if(!gesture.moved&&Math.hypot(point.x-gesture.start.x,point.y-gesture.start.y)<8)return;
  gesture.moved=true;gesture.last=point;run(()=>send('Input.dispatchMouseEvent',{type:'mouseWheel',x:point.x,y:point.y,deltaX,deltaY}));
 });
 picture.addEventListener('pointerup',event=>{
  if(!gesture||gesture.id!==event.pointerId)return;const current=gesture;gesture=null;if(current.moved)return;
  run(async()=>{await send('Input.dispatchMouseEvent',{type:'mousePressed',...current.start,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...current.start,button:'left',clickCount:1});status.textContent='Field selected? Tap Keyboard to enter text.';});
 });
 picture.addEventListener('pointercancel',()=>{gesture=null;});
 picture.addEventListener('wheel',event=>{if(!ready||saving||!form.hidden||!frame)return;event.preventDefault();const point=coordinates(event);run(()=>send('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:event.deltaX,deltaY:event.deltaY}));},{passive:false});
 keyboard.onclick=()=>{
  if(!ready||saving)return;
  form.hidden=false;input.value='';input.type='password';form.querySelector('[type=submit]').disabled=true;
  // Must run in the tap handler, before any await, for iOS to open its keyboard.
  input.focus({preventScroll:true});
  run(async()=>{
   await send('Runtime.releaseObjectGroup',{objectGroup:'bearden-rent-input'});
   const result=await send('Runtime.evaluate',{expression:`(()=>{let e=document.activeElement;while(e?.shadowRoot?.activeElement)e=e.shadowRoot.activeElement;return e&&(e.tagName==='TEXTAREA'||e.tagName==='INPUT'&&['text','email','password','tel','url','search','number'].includes(e.type))&&!e.disabled&&!e.readOnly?e:null;})()`,objectGroup:'bearden-rent-input'});
   if(!result.result?.objectId){hideKeyboard();status.textContent='Tap an email, password, or verification-code field in the portal first.';return;}
   target=result.result.objectId;form.querySelector('[type=submit]').disabled=false;status.textContent='Type here, then Send to fill the selected field.';
  });
 };
 $('[data-cancel]').onclick=hideKeyboard;
 $('[data-show]').onclick=()=>{const show=input.type==='password';input.type=show?'text':'password';$('[data-show]').textContent=show?'Hide':'Show';$('[data-show]').setAttribute('aria-label',show?'Hide typed text':'Show typed text');input.focus({preventScroll:true});};
 form.onsubmit=event=>{
  event.preventDefault();if(!target||saving)return;let text=input.value;const objectId=target;input.value='';form.querySelector('[type=submit]').disabled=true;
  run(async()=>{
   try{
    // Bind typing to the selected DOM node. Never read its existing value, and
    // reject a changed/removed field instead of inserting secrets elsewhere.
    const selected=await send('Runtime.callFunctionOn',{objectId,functionDeclaration:`function(){if(!this.isConnected||this.disabled||this.readOnly||this.ownerDocument.activeElement!==this)return false;this.focus();this.select();return true;}`,returnByValue:true});
    if(selected.exceptionDetails||selected.result?.value!==true){status.textContent='The portal field changed. Tap the field again, then Keyboard.';return;}
    await send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2,commands:['selectAll']});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
    if(text)await send('Input.insertText',{text});
    else{await send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});}
    status.textContent='Field filled. Continue signing in on the portal.';
   }finally{text='';hideKeyboard();await send('Runtime.releaseObjectGroup',{objectGroup:'bearden-rent-input'}).catch(()=>{});}
  });
 };
 save.onclick=async()=>{
  if(!ready||saving)return;saving=true;hideKeyboard();keyboard.disabled=save.disabled=$('[data-close]').disabled=true;await sequence;if(closed)return;status.textContent='Reading your rent balance and saving…';
  try{await onSave();close();}catch(error){status.textContent=error.message||'Could not save. Finish signing in and open your balance, then try again.';}finally{saving=false;if(!closed){keyboard.disabled=save.disabled=!ready;$('[data-close]').disabled=false;}}
 };
 return {close};
}
