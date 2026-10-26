'use strict';
// Preserve the source's declarative controls under a strict script policy.
// Only named tracker actions with literal arguments are dispatched; no eval.
(()=>{
 const allowed=new Set(["activateGodMode", "addBudgetItem", "saveHouseholdBills", "removeHouseholdBills", "addExtraExpenseToPaycheck", "addNotePage", "addSavingsGoal", "applyBonusToPaycheck", "battleAction", "calculate", "clearSavingsWithdrawalHistory", "closeAccountDetail", "deleteNotePage", "dismissCelebration", "flipNotePage", "handlePieSliceClick", "onNotesInput", "openAccountDetail", "openBearSwitchBattle", "openBearSwitchOverworld", "openPaymentAccountDetail", "removeBonusFromPaycheck", "removeBudgetItem", "removeCard", "removeExtraExpense", "removeSavingsGoal", "resetAll", "resetCheckedPaychecks", "resetSavingsGoal", "restartBearCrush", "restartBearQuest", "returnToCampBearCatch", "setHolidayTheme", "setPayoffMethod", "startTrackingSavings", "toggleAddBox", "toggleBonusInlineInput", "toggleBudgetPanel", "toggleCatchDex", "toggleChecked", "toggleDebtBreakdown", "toggleExtraExpenseInput", "toggleGamesSection", "toggleHolidayMenu", "toggleHowToDropdown", "toggleIncomePanel", "toggleNotesSection", "togglePaymentHistoryDetail", "togglePaymentHistoryShowAll", "toggleSavingsGoalEdit", "toggleSavingsWithdrawPanel", "toggleScheduleExpanded", "toggleTheme", "updateAccountPayment", "updateBudgetItemAmount", "updateIncomeEstimateDisplay", "updatePaycheckAmount", "updateSavingsContribution", "updateSavingsGoalField", "saveIncome", "saveBudget", "withdrawFromSavings", "confirmTrackerReset"]);
 function args(text,el,event){if(!text.trim())return [];const parts=text.match(/(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^,])+/g)||[];return parts.map(raw=>{const x=raw.trim();if(x==='this')return el;if(x==='event')return event;if(x==='this.value')return el.value;if(x==='this.checked')return el.checked;if(x==='true')return true;if(x==='false')return false;if(/^-?\d+(?:\.\d+)?$/.test(x))return Number(x);if(x.startsWith('"'))return JSON.parse(x);if(/^'[^']*'$/.test(x))return x.slice(1,-1);throw Error('Unsupported tracker control');});}
 for(const type of ['click','change','input'])document.addEventListener(type,event=>{let el=event.target.closest('[data-bd-'+type+']');if(!el)return;try{for(const command of el.getAttribute('data-bd-'+type).split(';').map(s=>s.trim()).filter(Boolean)){if(command==='event.stopPropagation()'){event.stopPropagation();continue;}const m=command.match(/^(?:window\['([\w$]+)'\]|([\w$]+))\((.*)\)$/);const name=m?.[1]||m?.[2];if(!m||!allowed.has(name)||typeof window[name]!=='function')throw Error('Unknown tracker control: '+name);Promise.resolve(window[name](...args(m[3],el,event))).catch(e=>window.setStorageStatus?.(e.message));}}catch(e){window.setStorageStatus?.(e.message);console.error(e);}});
 // Sanitize generated markup while retaining the source's declarative controls.
 const descriptor=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');let cleaning=false;
 Object.defineProperty(Element.prototype,'innerHTML',{...descriptor,set(value){if(cleaning||typeof value!=='string'){descriptor.set.call(this,value);return;}cleaning=true;try{descriptor.set.call(this,DOMPurify.sanitize(value,{FORBID_TAGS:['script','iframe','object','embed'],ALLOW_DATA_ATTR:true}));}finally{cleaning=false;}}});
 const iconPaths={edit:'M16 3l5 5L9 20H4v-5L16 3z',delete:'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',withdraw:'M12 3v12m-5-5l5 5 5-5M4 17v4h16v-4',add:'M12 4v16M4 12h16'};
 const symbols={'+':'Add','⚙':'Edit','🗑':'Delete','↺':'Reset','🌙':'Dark mode','☀':'Light mode','➕':'Add','✕':'Remove'};
 function plainControls(root){const controls=[];if(!root||root.nodeType!==1)return;if(root.matches('button,summary,.hero-title,.section-title,.spending-summary-link,.milestone-banner'))controls.push(root);controls.push(...root.querySelectorAll('button,summary,.hero-title,.section-title,.spending-summary-link,.milestone-banner'));for(const el of controls){if(el.closest('#gamesSection'))continue;const old=el.textContent;if(el.classList.contains('icon-btn')&&el.title&&!el.querySelector('svg')){const title=el.title;const kind=/withdraw/i.test(title)?'withdraw':/delete/i.test(title)?'delete':/add|new page/i.test(title)?'add':'edit';el.setAttribute('aria-label',title);el.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+iconPaths[kind]+'"/></svg>';continue;}const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode()){const next=n.data.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu,'').trimStart();if(next!==n.data)n.data=next;}if(!el.textContent.trim()&&!el.querySelector('svg'))el.textContent=el.getAttribute('title')||symbols[old.replace(/\uFE0F/g,'').trim()]||'Edit';}}
 plainControls(document.body);new MutationObserver(list=>{for(const change of list){if(change.type==='characterData')plainControls(change.target.parentElement);for(const node of change.addedNodes)if(node.nodeType===1)plainControls(node);}}).observe(document.body,{childList:true,subtree:true,characterData:true});
})();

// Native dialogs make the page inert but do not stop backdrop scrolling on iOS.
// Freeze it at its current position until the last popup closes.
(()=>{
 const root=document.documentElement;
 const popupSelector='dialog[open],#celebrationOverlay.show';
 let position=null;
 function lock(){
  if(position)return;
  position={x:window.scrollX,y:window.scrollY};
  root.style.setProperty('--popup-scroll-top',-position.y+'px');
  root.style.setProperty('--popup-scroll-left',-position.x+'px');
  root.classList.add('popup-scroll-locked');
 }
 function sync(){
  if(document.querySelector(popupSelector)){lock();return;}
  if(!position)return;
  const saved=position;position=null;
  root.classList.remove('popup-scroll-locked');
  root.style.removeProperty('--popup-scroll-top');
  root.style.removeProperty('--popup-scroll-left');
  window.scrollTo({left:saved.x,top:saved.y,behavior:'instant'});
 }
 // Run synchronously so closing a dialog before changing tabs restores the
 // old tab's position before navigation chooses the new tab's position.
 const prototype=HTMLDialogElement.prototype,showModal=prototype.showModal,close=prototype.close;
 prototype.showModal=function(...args){lock();try{return showModal.apply(this,args);}finally{sync();}};
 prototype.close=function(...args){try{return close.apply(this,args);}finally{sync();}};
 new MutationObserver(changes=>{
  if(changes.some(change=>change.type==='childList'||change.target.matches('dialog,#celebrationOverlay')))sync();
 }).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open','class']});
 // Escape, native form submission and removal also release the lock.
 document.addEventListener('close',sync,true);
 sync();
})();
