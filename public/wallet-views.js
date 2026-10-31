'use strict';
// Wallet page compositions. Existing inputs, actions and live financial widgets
// are moved, never copied, so their IDs, save handlers and data remain authoritative.
window.mountWalletViews = ({icon, bear, esc, money, go, queueRefresh}) => {
  const $ = (s, p=document) => p.querySelector(s);
  const $$ = (s, p=document) => [...p.querySelectorAll(s)];
  const root = document.documentElement;
  const make = (tag, cls, html='') => { const el=document.createElement(tag);el.className=cls;el.innerHTML=html;return el; };
  const glyphs = {
    people:'M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3m20 0v-3a4 4 0 0 0-3-3.87M13 3.13a4 4 0 0 1 0 7.75M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    mail:'M3 5h18v14H3zM3 6l9 7 9-7', search:'M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Zm5.5-2 5 5',
    cloud:'M7 17H5a4 4 0 0 1-1-7.87 7 7 0 0 1 13-3 5.5 5.5 0 0 1 2 10.7M8 18l3 3 5-6',
    bolt:'m13 2-9 12h7l-1 8 10-12h-8z', car:'m5 6-2 7v6h3v-3h12v3h3v-6l-2-7zM3 12h18M6 15h1m10 0h1',
    wifi:'M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8 16a6 6 0 0 1 8 0M12 20h.01',
    gift:'M3 8h18v4H3zM5 12v9h14v-9M12 8v13M12 8C5 9 4 3 8 3c3 0 4 5 4 5Zm0 0c7 1 8-5 4-5-3 0-4 5-4 5Z',
    chart:'M12 3v9h9M9 3.5a9 9 0 1 0 11.5 11.5M16 3.5a9 9 0 0 1 4.5 4.5',
    stack:'m3 7 9-4 9 4-9 4zM3 12l9 4 9-4M3 17l9 4 9-4',
    target:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-4 0a5 5 0 1 1-10 0 5 5 0 0 1 10 0Zm-3 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
    edit:'m16 3 5 5L9 20H4v-5z', plus:'M12 4v16M4 12h16', refresh:'M20 11a8 8 0 1 0-2.35 6.65M20 4v7h-7',
  };
  const svg = name => glyphs[name]?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+glyphs[name]+'"/></svg>':icon(name);
  const chevron=icon('arrow');
  $('#schedulePlanSection .section-title .den-only').textContent='Paycheck schedule';
  const oldSettings=$('#connectionDialog');
  const settingsHub=make('div','bd-settings-hub');settingsHub.id='bdSettingsHub';
  const settingsPage=$('#tab-settings');
  settingsPage.prepend(oldSettings.querySelector('.tab-header-peek'),oldSettings.querySelector('.connection-notice'),settingsHub);
  const dialogs=new Map();
  function detail(key,title,nodes){
    const dialog=make('dialog','bd-detail-dialog income-card');dialog.id='bdDetail-'+key;dialog.setAttribute('aria-labelledby',dialog.id+'-title');
    dialog.innerHTML='<header class="bd-detail-heading"><h2 id="'+dialog.id+'-title">'+esc(title)+'</h2><button type="button" aria-label="Close '+esc(title)+'">'+icon('close')+'</button></header><div class="bd-detail-content"></div>';
    nodes.filter(Boolean).forEach(n=>$('.bd-detail-content',dialog).append(n));
    $('header button',dialog).onclick=()=>dialog.close();const feedback=make('p','bd-detail-feedback');feedback.setAttribute('role','status');$('.bd-detail-content',dialog).append(feedback);document.body.append(dialog);dialogs.set(key,dialog);return dialog;
  }
  function openDetail(key){
    if(['plaid','lunchflow','email','rent','balances'].includes(key)&&!window.BearDen?.config?.authenticated)key='account';
    const dialog=dialogs.get(key);if(!dialog||dialog.open)return;const feedback=$('.bd-detail-feedback',dialog);if(feedback)feedback.textContent='';dialog.showModal();
    const config={plaid:['#configurePlaid','#plaidConfig'],lunchflow:['#configureLunchflow','#lunchflowConfig'],rent:['#configureRent','#rentConfig']}[key];
    if(config&&$(config[1]).hidden)$(config[0]).click();
  }
  const account=$('#accountMode').closest('section');detail('account','Your account',[account]);
  detail('plaid','Plaid',[$('#plaidSection')]);detail('lunchflow','Lunch Flow',[$('#lunchflowSection')]);
  detail('email','Email accounts',[$('#gmailSection')]);detail('rent','Rent portal',[$('#rentTrackingOption'),$('#rentSection')]);
  detail('balances','Displayed accounts',[$('.bank-display-options')]);
  detail('timing','Debt payment timing',[$('.debt-timing-settings')]);
  const tracker=$('#trackerOptions');
  const row=(label,glyph,action,value='',extra='')=>'<button type="button" class="bd-setting-row" '+action+' data-setting-keywords="'+esc(label.toLowerCase())+'" '+extra+'><span class="bd-setting-icon">'+svg(glyph)+'</span><span class="bd-setting-label">'+label+'</span><span class="bd-setting-value">'+value+'</span>'+chevron+'</button>';
  const group=(title,body,id='',extra='')=>'<section class="bd-setting-group" '+(id?'id="'+id+'"':'')+'><div class="bd-group-heading"><h3>'+title+'</h3>'+extra+'</div><div class="bd-setting-surface">'+body+'</div></section>';
  settingsHub.innerHTML='<div class="bd-profile"><div class="bd-profile-avatar" data-bd-initials>BD</div><div class="bd-profile-info"><strong>Your account</strong><span id="bdAccountEmail">On this device</span><small id="bdBackupStatus">'+svg('cloud')+'<span>Local plan</span></small></div><div class="bd-profile-actions"><span class="bd-status" id="bdAccountBadge">Local</span><button type="button" data-bd-detail="account">Manage account '+chevron+'</button></div></div>'
    +'<label class="bd-settings-search">'+svg('search')+'<input type="search" id="bdSettingsSearch" placeholder="Find a setting" aria-label="Find a setting"></label>'
    +group('Appearance','<div class="bd-mode-row">'+svg('sun')+'<div class="bd-mode-segment" role="group" aria-label="Color mode"><button type="button" data-bd-mode="light">Light</button><button type="button" data-bd-mode="dark">Dark</button><button type="button" data-bd-mode="auto">Auto</button></div></div><div class="bd-theme-swatches" role="group" aria-label="Color palette">'+[['','Standard blue','#0868ff'],['lavender','Lavender','#bca1f4'],['sunset','Sunset','#ff9650'],['rose','Rose','#f59aba'],['twilight','Twilight','linear-gradient(135deg,#121f50,#725cae)']].map(([value,name,color])=>'<button type="button" data-bd-palette="'+value+'" aria-label="'+name+' palette" title="'+name+'" style="--swatch:'+color+'"><span aria-hidden="true">✓</span></button>').join('')+'</div><div id="bdAllThemes"></div>','bdAppearance')
    +group('Household',row('Income','income','data-den-go="income-edit"','Pay & withholding')+row('Budget','chart','data-den-go="budget"','Per paycheck')+row('Debt payment timing','bills','data-bd-detail="timing"','<span id="bdTimingValue"></span>')+row('Shared contributions','people','data-bd-household','Set up'),'bdHousehold')
    +group('Connections',row('Plaid','target','data-bd-detail="plaid"','<span data-bd-status="classicBankStatus">Connect</span>')+row('Lunch Flow','stack','data-bd-detail="lunchflow"','<span data-bd-status="lunchflowStatus">Connect</span>')+row('Email accounts','mail','data-bd-detail="email"','<span data-bd-status="classicEmailStatus">Connect</span>')+row('Rent portal','overview','data-bd-detail="rent"','<span data-bd-status="rentStatus">Connect</span>'),'bdConnections','<button type="button" id="bdSyncAll">Sync all '+svg('refresh')+'</button>')
    +group('Options','<div id="bdSwitchRows"></div>'+row('More preferences','settings','data-bd-detail="preferences"','','aria-label="More preferences, setup and layout"')+row('Tools','tools','id="bdToolsButton" data-den-go="tools"','Notes &amp; games'),'bdOptions')
    +'<p id="bdSearchEmpty" class="subtle" hidden>No settings match your search.</p>';
  const switchRows=[['sharedBillsToggle','Use shared bills account','people'],['carPaymentsInDebtToggle','Include car in debt','car'],['savingsTrackerToggle','Savings tracker','savings'],['payoffControlsToggle','Slice & Squash','target'],['bonusControlsToggle','Bonus paychecks','gift']];
  for(const [id,label,glyph] of switchRows){
    const input=$('#'+id),oldLabel=input.closest('label');
    const labelEl=make('label','bd-setting-row bd-switch-row','<span class="bd-setting-icon">'+svg(glyph)+'</span><span class="bd-setting-label">'+label+'</span>');labelEl.dataset.settingKeywords=label.toLowerCase();input.setAttribute('aria-label',label);labelEl.append(input);
    if(id==='sharedBillsToggle'&&oldLabel.nextElementSibling?.matches('p.subtle')){const help=oldLabel.nextElementSibling;help.id='bdSharedBillsHelp';help.classList.add('bd-visually-hidden');input.setAttribute('aria-describedby',help.id);labelEl.append(help);}
    $('#bdSwitchRows').append(labelEl);oldLabel.remove();
  }
  $('#bdOptions').append($('#featureSettingsStatus'));
  for(const [source,keys] of [['#featureSettingsStatus',['timing','preferences']],['#connectionMessage',['account','plaid','lunchflow','email','rent','balances']]])new MutationObserver(()=>{for(const key of keys){const dialog=dialogs.get(key);if(dialog?.open)$('.bd-detail-feedback',dialog).textContent=$(source).textContent;}}).observe($(source),{subtree:true,childList:true,characterData:true});
  $('#colorPickerDialog').addEventListener('close',()=>$('#openColorPicker').focus({preventScroll:true}));
  const allThemes=$('#openColorPicker');allThemes.textContent='Customize theme '+String.fromCharCode(8594);$('#bdAllThemes').append(allThemes);
  detail('preferences','More preferences',[tracker,$('#denDesignSettings')]);
  // Original controls remain available in their detail views. Their explanatory
  // text belongs with the control rather than on the compact hub.
  tracker.querySelector('h3').textContent='Tracking & setup';
  $('#privateConnections').classList.add('bd-source-only');
  $('#bdSyncAll').onclick=()=>$('#classicSync').click();
  new MutationObserver(()=>{$('#bdSyncAll').disabled=!window.BearDen?.config?.authenticated||$('#classicSync').disabled;}).observe($('#classicSync'),{attributes:true,attributeFilter:['disabled']});
  document.addEventListener('click',event=>{
    const target=event.target.closest('[data-bd-detail]');if(target)openDetail(target.dataset.bdDetail);
    if(event.target.closest('[data-bd-household]'))$('#configureHousehold').click();
    const mode=event.target.closest('[data-bd-mode]');if(mode){try{localStorage.setItem('bearden:mode',mode.dataset.bdMode);}catch{}applyMode(mode.dataset.bdMode);}
    const pickerMode=event.target.closest('[data-color-mode]');if(pickerMode){modePref=pickerMode.dataset.colorMode;try{localStorage.setItem('bearden:mode',modePref);}catch{}syncAppearance();}
    const palette=event.target.closest('[data-bd-palette]');if(palette){
      if(!palette.dataset.bdPalette)$('#resetColorScheme').click();
      else $('#colorPickerDialog [data-color-scheme-choice="'+palette.dataset.bdPalette+'"]').click();
    }
  });
  const media=matchMedia('(prefers-color-scheme: dark)');let modePref;
  try{modePref=localStorage.getItem('bearden:mode');}catch{}
  function applyMode(mode){
    modePref=mode;const dark=mode==='auto'?media.matches:mode==='dark';
    if((root.dataset.theme==='dark')!==dark)window.toggleTheme?.();syncAppearance();
  }
  media.addEventListener('change',()=>{if(modePref==='auto')applyMode('auto');});
  function syncAppearance(){
    const mode=modePref==='auto'?'auto':root.dataset.theme==='dark'?'dark':'light';
    $$('[data-bd-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.bdMode===mode)));
    $$('[data-bd-palette]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.bdPalette===(root.dataset.colorScheme||'')&&!root.dataset.holiday)));
  }
  new MutationObserver(syncAppearance).observe(root,{attributes:true,attributeFilter:['data-theme','data-color-scheme','data-holiday']});
  if(modePref==='auto')applyMode('auto');else syncAppearance();
  $('#bdSettingsSearch').oninput=event=>{
    const query=event.target.value.trim().toLowerCase();let count=0;
    for(const group of $$('.bd-setting-group',settingsHub)){
      const title=$('h3',group).textContent.toLowerCase(),all=title.includes(query);
      const rows=$$('[data-setting-keywords]',group);
      rows.forEach(row=>{row.hidden=!all&&!row.dataset.settingKeywords.includes(query);});
      group.hidden=rows.length?!rows.some(row=>!row.hidden):!!query&&!'appearance theme color light dark auto palette'.includes(query);
      if(!group.hidden)count++;
    }
    $('#bdSearchEmpty').hidden=!!count;
  };
  function updateProfile(){
    const bridge=window.BearDen,config=bridge?.config||{},email=config.email||'',signed=!!config.authenticated;
    $('#bdAccountEmail').textContent=email||(signed?'Signed in':'On this device');
    const initials=email?email.split('@')[0].split(/[._\-\s]+/).map(s=>s[0]).slice(0,2).join('').toUpperCase():'BD';
    $$('[data-bd-initials]').forEach(el=>el.textContent=initials);
    $('#bdAccountBadge').textContent=signed?'Signed in':'Local';$('#bdAccountBadge').classList.toggle('is-connected',signed);
    $('#bdAccountBadge').setAttribute('role','img');$('#bdAccountBadge').setAttribute('aria-label',signed?'Signed in':'Not signed in');$('#bdAccountBadge').title=signed?'Signed in':'Not signed in';
    $('#bdBackupStatus span').textContent=!signed?'Saved on this device':bridge.lastSaved?'Saved '+new Date(bridge.lastSaved).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}):'Cloud sync enabled';
    $('#bdSyncAll').disabled=!signed||$('#classicSync').disabled;
    for(const status of $$('[data-bd-status]')){
      const source=$('#'+status.dataset.bdStatus);const connected=source?.dataset.connected==='true';
      status.textContent=!signed?'Disconnected · Sign in':connected?'Connected':status.dataset.bdStatus==='rentStatus'&&!$('#rentEnabledToggle').checked?'Disconnected · Disabled':/sign in needed/i.test(source?.textContent||'')?'Disconnected · Sign in needed':'Disconnected';
      status.className='bd-status'+(connected&&signed?' is-connected':'');
      status.setAttribute('role','img');status.setAttribute('aria-label',status.textContent);status.title=status.textContent;
    }
    for(const source of $$('.connection-state[data-connected]')){source.setAttribute('role','img');source.setAttribute('aria-label',source.textContent);source.title=source.textContent;}
    const text=$('#householdSummary').textContent;
    const amounts=[...text.matchAll(/\$[\d,.]+/g)].map(m=>m[0]);
    $('#bdHousehold [data-bd-household] .bd-setting-value').textContent=amounts.length===2?(amounts[0]===amounts[1]?amounts[0].replace(/\.00$/,'')+' each':amounts.map(n=>n.replace(/\.00$/,'')).join(' / ')):'Set up';
    $('#bdTimingValue').textContent=$('#debtPaymentTiming').value==='due-date'?'By due date':'Every paycheck';
  }
  window.addEventListener('bearden-connections',()=>requestAnimationFrame(updateProfile));window.addEventListener('bearden-saved',updateProfile);
  $('#debtPaymentTiming').addEventListener('change',updateProfile);
  // New page headers use only the title and the section's primary actions.
  const originalIncomeControls=$('#tab-income .income-controls-header');
  const setupButton=$('#incomeToggleBtn'),budgetButton=$('#incomeBudgetToggleBtn'),transactionToggle=$('#incomeTransactionsToggleBtn');
  const refreshButton=$('[data-refresh-bank]',originalIncomeControls);
  for(const tab of ['income','bills','debts','settings','tools']){
    const header=$('#tab-'+tab+' .tab-intro');if(!header)continue;
    const h2=$('h2',header);header.replaceChildren(h2);header.classList.add('bd-page-heading');header.classList.remove('connection-heading');
    if(tab==='bills'||tab==='debts'){
      const list=$('#'+(tab==='bills'?'billListCard':'debtListCard'));
      const add=$('[data-account-kind]',list);if(add){add.classList.add('bd-add-account');header.append(add);}
    }
  }
  $('#debts-nav-debt').textContent='Accounts';
  $$('[data-open-bill-sharing]').forEach(button=>button.remove());
  for(const kind of ['bill','debt']){
    const list=$('#'+kind+'ListCard'),heading=$(':scope>.card-heading',list),sort=$('.account-sort-controls',list);
    const toolbar=make('div','bd-list-toolbar'),count=$('#'+kind+'AccountCount');
    const countLabel=make('span','bd-list-count',kind==='bill'?'Bills this month ':'Accounts ');countLabel.append(count);toolbar.append(countLabel);
    const sorting=make('details','bd-list-options','<summary>Sort &amp; organize '+chevron+'</summary>');sorting.append(sort);toolbar.append(sorting);
    const refresh=$('#refreshAllDebts',heading);if(refresh)toolbar.append(refresh);
    heading.replaceWith(toolbar);
    const total=$('#'+(kind==='bill'?'bills':'debt')+'TotalAmount').closest('section');
    $('.bill-sharing-toolbar',list)?.remove();
    total.classList.add('bd-list-total');list.after(total);
  }
  // Income: balance / next paycheck / forecast / recent transactions / spending.
  const income=$('#tab-income'),bank=$('.bank-card',income),bankWrap=bank.parentElement;
  const editorControls=make('div','');editorControls.hidden=true;editorControls.append(setupButton,budgetButton);settingsPage.append(editorControls);
  for(const [key,title,node,panelId] of [['income','Income editor',$('#incomeDropdown'),'incomeDropdown'],['budget','Budget editor',$('#incomeBudgetSlot'),'budgetDropdown']]){
    const dialog=detail(key,title,[node]);dialog.dataset.incomeEditor=panelId;
    dialog.addEventListener('close',()=>{
      window.setIncomePanel?.(null);
      $('#bdHousehold [data-den-go="'+(key==='income'?'income-edit':'budget')+'"]').focus({preventScroll:true});
    });
  }
  const activity=$('#bankActivityCard');
  // The old header was detached above; its refresh control remains a real control.
  if(refreshButton)bank.append(refreshButton);
  const paycheck=make('section','bd-next-paycheck income-card');paycheck.id='bdNextPaycheck';bankWrap.after(paycheck);
  const forecast=$('#personalForecastCard');paycheck.after(forecast);$('h3',forecast).textContent='Personal forecast';
  const forecastDetails=make('details','bd-forecast-details','<summary>Forecast details &amp; planned activity '+chevron+'</summary>');
  // Keep chart interaction on the overview; put the full ledger and scenario
  // controls one disclosure away instead of making a several-screen card.
  for(const node of [...forecast.children])if(node.id==='incomeForecast'||node.id==='forecastModeNote'||node.classList.contains('forecast-debt-modes')||node.matches('p.subtle'))forecastDetails.append(node);
  forecast.append(forecastDetails);
  const recent=make('section','income-card bd-recent');recent.id='bdRecentTransactions';
  recent.innerHTML='<div class="bd-section-heading"><h3>Recent transactions</h3></div><div id="bdRecentRows"></div><div class="bd-recent-footer"></div>';
  transactionToggle.textContent='View all transactions';$('.bd-recent-footer',recent).append(transactionToggle);forecast.after(recent);recent.after(activity);
  const spending=$('#spendingDonut').closest('section');spending.classList.add('bd-spending');activity.after(spending);
  const oldIncomeControls=$('.income-controls-header',income);oldIncomeControls?.remove();
  $('#tab-debts').append(make('div','bd-page-footer','<button type="button" data-den-go="plan">Plan next paycheck '+chevron+'</button>'));
  // Trackers get a dedicated header and metric area; savings deliberately places
  // the progress ring on the left, unlike the debt tracker.
  function buildTrackers(){
    for(const [selector,glyph,title] of [['#debtIncomeCard','income','Income'],['#billTracker','bills','Bills'],['#debtHeroBox','debts','Debt'],['.savings-hero','savings','Savings']]){
      for(const card of $$(selector)){
        if(card.dataset.bdBuilt)continue;card.dataset.bdBuilt='true';card.classList.add('bd-tracker');
        const heading=$('.tracker-header',card),label=$('.hero-title',heading);
        label.innerHTML='<span class="bd-tracker-icon">'+svg(glyph)+'</span><span>'+title+'</span>';
        const methods=$('.payoff-method-toggle',heading);if(methods)heading.after(methods);
        const stats=make('div','bd-tracker-stats');
        $$(':scope > .row',card).forEach(row=>stats.append(row));if(stats.childElementCount)card.append(stats);
        if(title==='Savings'){
          const banner=$('.hero-date-banner',card),ring=$('.hero-pie-wrap-corner',banner);if(ring)banner.prepend(ring);
          const name=$(':scope > div:not([class]):has(>.label)',card);if(name){name.classList.add('bd-savings-name');heading.after(name);}
          const controls=$('.hero-controls',heading);if(controls)controls.classList.add('bd-savings-controls');
        }
      }
    }
  }
  function accountGlyph(name){return /rent|mortgage/i.test(name)?'overview':/electric|energy|power/i.test(name)?'bolt':/car|auto|vehicle/i.test(name)?'car':/internet|phone|mobile|wifi/i.test(name)?'wifi':'debts';}
  function buildAccounts(){
    const note=$('#heroBalanceNote'),stats=$('#debtHeroBox .bd-tracker-stats');if(note&&stats&&note.parentElement===stats)stats.after(note);
    for(const card of $$('#billAgenda .bill-tile,#debtAccounts .debt-account')){
      if(card.dataset.bdBuilt)continue;card.dataset.bdBuilt='true';card.classList.add('bd-account-card');
      const bill=card.classList.contains('bill-tile'),h4=$('h4',card);if(!h4)continue;
      const name=h4.textContent.trim(),info=h4.parentElement,tools=$('.debt-account-tools',card),date=$('.den-date-stamp',card);
      const original=[...card.children];
      const head=make('div','bd-account-head'),identity=make('div','bd-account-identity');
      identity.append(make('span','bd-account-icon',svg(accountGlyph(name))),h4);head.append(identity);
      const brand=window.BearDenBrands?.find(name,card.dataset.vehicleName);
      if(brand){identity.dataset.brand=brand.key;const mark=$('.bd-account-icon',identity);mark.classList.add('bd-brand-logo');const image=document.createElement('img');image.src=brand.src;image.alt=brand.label+' logo';image.width=48;image.height=40;mark.replaceChildren(image);}
      if(date){date.removeAttribute('aria-hidden');const due=new Date(date.dateTime+'T12:00:00');date.classList.toggle('is-near',!date.classList.contains('is-paid')&&due-new Date()<14*86400000);head.append(date);}
      const edit=tools?.querySelector('.account-edit'),details=tools?.querySelector('[data-show-debt-details]');
      if(details){details.classList.add('bd-account-open');details.innerHTML=chevron;head.append(details);}
      if(edit){edit.classList.add('bd-account-edit');edit.innerHTML='<span aria-hidden="true">•••</span>';head.append(edit);}
      const amount=make('div','bd-account-amount');
      const amounts=$('.debt-key-amounts',card),balance=bill?$('.bill-amount strong',card):amounts?$('strong',amounts):$('.debt-compact-amount strong',card);
      if(balance){balance.textContent=balance.textContent.replace(/\.00\b/g,'');amount.append(balance);}
      amount.append(make('span','bd-amount-caption',bill?esc($('.bill-amount>span',card)?.textContent||'Amount due'):card.classList.contains('payment-only-debt')?'scheduled payment':'remaining'));
      const min=$('.minimum-due',card);if(min){min.classList.add('bd-minimum');amount.append(min);}
      const meta=make('div','bd-account-metrics');
      if(bill){const recurring=$('.den-bill-meta',card);if(recurring)meta.append(...recurring.children);}
      else{
        const available=$('.account-available-credit',card);if(available)meta.append(available);
        const dl=$('.debt-card-estimates dl',card);if(dl)meta.append(...dl.children);
      }
      const footer=make('div','bd-account-actions');
      if(bill){
        const more=make('button','bd-bill-details','Details');more.type='button';more.setAttribute('aria-label','Details for '+name);
        const extra=make('div','bd-bill-detail-content');
        const detailDialog=make('dialog','bd-detail-dialog income-card','<header class="bd-detail-heading"><h2>'+esc(name)+'</h2><button type="button" aria-label="Close bill details">'+icon('close')+'</button></header>');
        $('header button',detailDialog).onclick=()=>detailDialog.close();detailDialog.append(extra);card.append(detailDialog);
        // This dialog stays with its card and is rebuilt when the live list updates.
        const due=$('.bill-due-date',card);if(due)extra.append(due);
        for(const child of original)if(!child.matches('.bill-card-header,.bill-amount,.den-date-stamp,.den-bill-meta,.account-card-footer,.bill-due-date'))extra.append(child);
        more.onclick=()=>detailDialog.showModal();footer.append(more);
      }
      if(tools)footer.append(...tools.children);
      const connection=$('.account-connection',card);if(connection){connection.title=connection.textContent;connection.setAttribute('aria-label',connection.textContent);connection.setAttribute('role','img');footer.append(connection);}
      const statuses=$$('.debt-account-status,.account-status,.debt-paid-badge',info);statuses.forEach(n=>footer.append(n));
      const dueLabel=$('.debt-due-date',card);if(dueLabel&&/^Due [A-Z][a-z]{2} \d{1,2}$/.test(dueLabel.textContent))dueLabel.classList.add('bd-plain-due');
      const originalAmountLabel=amounts?.querySelector('div>span')?.textContent||'';if(/statement|last reported/i.test(originalAmountLabel))$('.bd-amount-caption',amount).textContent=originalAmountLabel;
      const detailsTemplate=$('template',card);
      const preserved=make('div','bd-account-notes');
      if(!bill){for(const child of original)if(!child.matches('.debt-card-header,.debt-key-amounts,.debt-card-estimates,.den-date-stamp,template,.account-card-footer'))preserved.append(child);}
      for(const child of original)if(child.parentElement===card)child.remove();
      card.prepend(head,amount,meta,footer);
      if(preserved.textContent.trim())card.append(preserved);
      if(detailsTemplate)card.append(detailsTemplate);
      // Source metadata and balance-unavailable notes are retained even when
      // the main amount cannot be shown.
      const oldFooter=original.find(n=>n.classList.contains('account-card-footer'));
      if(oldFooter?.textContent.trim())card.append(oldFooter);
      if(!balance){amount.textContent='Balance unavailable';amount.classList.add('bd-balance-unavailable');}
    }
  }
  const collapsed=new Set();let exploreOpen=false;
  function buildPaychecks(){
    for(const card of $$('.paycheck')){
      if(card.dataset.bdBuilt)continue;card.dataset.bdBuilt='true';card.classList.add('bd-paycheck');
      const head=$('.paycheck-head',card),number=card.id.replace('paycheck-card-',''),check=$('input[type=checkbox]',head),date=$('.date',head);
      const title=make('div','bd-paycheck-title','<small>Paycheck '+esc(number)+'</small><strong>'+esc(date.textContent.split('—').slice(1).join('—').trim())+'</strong>');
      head.replaceChildren(check,title,make('span','bd-paycheck-status',check.checked?'Completed':'Planned'));
      const collapse=make('button','bd-paycheck-collapse',chevron);collapse.type='button';collapse.setAttribute('aria-label','Collapse paycheck '+number);head.append(collapse);
      check.setAttribute('aria-label','Mark paycheck '+number+' plan complete');
      const body=make('div','bd-paycheck-body');[...card.children].filter(n=>n!==head).forEach(n=>body.append(n));card.append(body);
      body.hidden=collapsed.has(number);collapse.setAttribute('aria-expanded',String(!body.hidden));
      collapse.onclick=()=>{body.hidden=!body.hidden;body.hidden?collapsed.add(number):collapsed.delete(number);collapse.setAttribute('aria-expanded',String(!body.hidden));collapse.setAttribute('aria-label',(body.hidden?'Expand':'Collapse')+' paycheck '+number);};
      const summary=$('.check-summary',body),children=[...summary.children];
      const takehome=make('section','bd-paycheck-section bd-takehome','<h4>Take-home pay</h4>'),budget=make('section','bd-paycheck-section bd-paycheck-budget','<h4>Budget &amp; bills</h4>'),savings=make('section','bd-paycheck-section bd-paycheck-savings','<h4>Savings</h4>');
      let stage='income';
      for(const n of children){
        if(n.matches('.paycheck-income,.paycheck-tax-button')){takehome.append(n);continue;}
        const action=n.getAttribute('data-bd-click')||'',isBonus=/Bonus/.test(action)||/bonus/.test(n.className);
        const saving=!!$('[data-bd-change^="updateSavingsContribution"]',n)||/after savings/i.test(n.textContent);
        if(saving)stage='savings';
        else if(stage==='income'&&!isBonus)stage='budget';
        (stage==='income'?takehome:stage==='savings'?savings:budget).append(n);
      }
      summary.replaceChildren(takehome,budget);if(savings.children.length>1)summary.append(savings);
      const firstDebt=$('.paycheck-debt-row',body);
      if(firstDebt)firstDebt.before(make('h4','bd-paycheck-section-title','Debt payments'));
      const cash=$('.paycheck-cash-left',body);if(cash){$('span',cash).textContent='Left to spend';body.append(cash);}
      const totals=make('div','bd-paycheck-totals');
      $$(':scope > .line:not(.paycheck-debt-row):not(.paycheck-cash-left)',body).forEach(n=>totals.append(n));if(totals.childElementCount)cash?cash.before(totals):body.append(totals);
      $('.paycheck-bear-scene',body)?.remove();
    }
  }
  function updateIncome(plan,next,upcoming,allocationRows,allocations){
    const card=$('#bdNextPaycheck');
    if(!upcoming){card.innerHTML='<h3>Your next paycheck</h3><p class="subtle">Set up your pay schedule to build a plan.</p><button type="button" data-den-go="income-edit">Set up income '+chevron+'</button>';return;}
    const date=new Date(upcoming.date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
    const rows=[['Take-home',upcoming.amount,'income','income'],...allocationRows.map(([label,amount])=>[label,-amount,label==='Bills'?'overview':label==='Savings'?'savings':label==='Debt'?'stack':'chart',label.toLowerCase()])];
    const html='<h3>'+esc(date)+' paycheck</h3>'+(next?'<button type="button" class="paycheck-tax-button" data-paycheck-taxes="'+next.paycheck+'" aria-haspopup="dialog" aria-controls="paycheckTaxDialog">Taxes &amp; withholding</button>':'')+'<div class="bd-paycheck-preview">'+rows.map(([label,amount,glyph,kind])=>'<button type="button" data-bd-paycheck-edit="'+kind+'" data-paycheck="'+(next?.paycheck||'')+'">'+svg(glyph)+'<span>'+label+'</span><strong>'+esc(money(amount))+'</strong>'+svg('edit')+'</button>').join('')+'</div><div class="bd-next-total"><span>Left to spend<strong>'+money(upcoming.amount-allocations)+'</strong></span><button type="button" data-den-go="plan">Open paycheck '+chevron+'</button></div>';
    if(card.innerHTML!==html)card.innerHTML=html;
    if(transactionToggle.getAttribute('aria-expanded')!=='true')transactionToggle.textContent='View all transactions';
    const selected=$('#personalSpendingAccount').value;
    const transactions=(window.BearDen?.plan?.connections?.transactions||[]).filter(t=>!selected||t.account_id===selected).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,3);
    const recentHtml=transactions.map(t=>'<button type="button" class="bd-recent-row" data-bd-transactions>'+svg('debts')+'<span><strong>'+esc(t.name||'Transaction')+'</strong><small>'+esc(t.date)+'</small></span><strong>'+money(Math.round(-Number(t.amount)*100))+'</strong>'+chevron+'</button>').join('')||'<p class="bd-empty">Your recent purchases will appear here when your bank sends transactions.</p>';
    if($('#bdRecentRows').innerHTML!==recentHtml)$('#bdRecentRows').innerHTML=recentHtml;
    const chart=$('#forecastChart .forecast-chart');if(chart&&!$('.bd-chart-explore',chart)){
      const scrubber=$('.chart-scrubber',chart),output=$('output',chart);
      if(scrubber){const explore=make('details','bd-chart-explore','<summary>Explore your balance '+chevron+'</summary>');explore.open=exploreOpen;explore.ontoggle=()=>{if(explore.isConnected)exploreOpen=explore.open;};explore.append(scrubber);if(output)explore.append(output);chart.append(explore);}
      $('svg',chart)?.setAttribute('preserveAspectRatio','none');
    }
    $('.den-income-heading>span').textContent='Bank balance';
    const mode=$('#incomeToggleBtn');if(mode.getAttribute('aria-expanded')!=='true')mode.textContent='Setup';
  }
  document.addEventListener('click',event=>{
    if(event.target.closest('[data-bd-transactions]')){if(activity.hidden)transactionToggle.click();activity.scrollIntoView({block:'start'});}
    const edit=event.target.closest('[data-bd-paycheck-edit]');if(!edit)return;
    go('plan');requestAnimationFrame(()=>{
      const card=$('#paycheck-card-'+edit.dataset.paycheck);if(!card)return;
      const body=$('.bd-paycheck-body',card);if(body?.hidden)$('.bd-paycheck-collapse',card).click();
      const selector={income:'.paycheck-income input',budget:'.bd-paycheck-budget input',savings:'.bd-paycheck-savings input',debt:'.pay-input',bills:'.paycheck-shared-details summary','one-time':'[data-bd-click^="toggleExtraExpenseInput"]'}[edit.dataset.bdPaycheckEdit];
      const target=selector?$(selector,card):null;(target||card).scrollIntoView({block:'center'});target?.focus({preventScroll:true});
    });
  });
  // Lists are replaced as data arrives; observe only those replacement roots.
  for(const id of ['billAgenda','debtAccounts','scheduleOut','scheduleRestOut','savingsHeroContainer'])new MutationObserver(queueRefresh).observe($('#'+id),{childList:true});
  // Give every editor the same Wallet shell. Move the original controls so
  // delegated actions, form validation, draft protection and provider links survive.
  function groupFields(formId,groups){
    const form=$('#'+formId);if(!form)return;
    const children=[...form.children];
    const directChild=selector=>{let node=$(selector,form);while(node&&node.parentElement!==form)node=node.parentElement;return node;};
    const boundaries=groups.map(([title,start,end])=>[title,directChild(start),directChild(end)]);
    for(const [title,first,last] of boundaries){
      if(!first||!last)continue;
      const section=make('section','bd-popup-section',first.matches('h4')?'':'<h4>'+title+'</h4>');
      first.before(section);children.slice(children.indexOf(first),children.indexOf(last)+1).forEach(node=>section.append(node));
    }
  }
  groupFields('billEditorForm', [['Account','[name=name]','[name=billKind]'],['Payment schedule','#electricLinkOption','#billFundingNote'],['Connected sources','#billEmailLink','#billTransactionLink']]);
  groupFields('creditEditorForm', [['Account','[name=name]','#creditLimitNote'],['Payment plan','[name=tracking]','[name=replaces]'],['Connected sources','#creditEmailLink','#creditTransactionLink']]);
  groupFields('householdForm', [['Your accounts','[name=enabled]','#billsForecastAccount'],['Contributions','[name=personalAmount]','label:has([name=spouseRepeat]) + p'],['Shared bills','h4','#householdBillChoices']]);
  // Keep loan fields with the account they describe, including when tabs.js
  // inserted them before the Wallet composition mounted.
  const loanFields=$('#billLoanField');if(loanFields)$('#billEditorForm > section').append(loanFields);
  const debtForm=$('#debtEditorForm'),debtSections=$$(':scope > section',debtForm);
  const debtSources=make('section','bd-popup-section','<h4>Connected sources</h4>');
  const bankSources=$('#debtEditorConnections'),matching=$(':scope > details',debtForm);
  bankSources.before(debtSources);debtSources.append($('#debtConnectionChoice'),bankSources);if(matching)debtSources.append(matching);
  if(debtSections[1])debtSections[1].append($('#debtPlanNote'));
  const popupThemes={
    debtProgressDialog:['Debt','debts'],debtHistoryDialog:['Debt','debts'],debtEditor:['Debt','debts'],creditEditor:['Debt','debts'],addDebtPaymentDialog:['Paycheck','debts'],
    billEditor:['Bills','bills'],billShareDialog:['Bills','bills'],householdEditor:['Household','people'],
    accountTypePicker:['Your wallet','stack'],accountPicker:['Income','income'],accountOrderEditor:['Your wallet','stack'],connectedAccountNameEditor:['Income','income'],
    emailLinkPicker:['Connected sources','mail'],transactionLinkPicker:['Connected sources','stack'],transactionCategoryEditor:['Transactions','chart'],colorPickerDialog:['Appearance','sun'],
  };
  function stylePopup(dialog){
    if(dialog.classList.contains('bd-popup')||['denMenu','expandedAccountView','rentBrowser','forecastReportDialog'].includes(dialog.id))return;
    const heading=$(':scope > .card-heading, :scope > .bd-detail-heading',dialog);
    const title=heading?.querySelector('h2,h3');if(!heading||!title)return;
    const [category,glyph]=popupThemes[dialog.id]||(dialog.classList.contains('bd-detail-dialog')?[dialog.id?'Settings':'Bills',dialog.id?'settings':'bills']:['Your wallet','stack']);
    dialog.classList.add('bd-popup');dialog.dataset.popupTone=['Debt','Bills'].includes(category)?'lilac':'blue';
    heading.classList.add('bd-popup-heading');
    if(!title.id)title.id=(dialog.id||'bdBillPopup-'+Math.random().toString(36).slice(2))+'-title';
    dialog.setAttribute('aria-labelledby',title.id);
    const titleGroup=make('div','bd-popup-title','<span class="bd-popup-eyebrow">'+category+'</span>');
    title.before(titleGroup);titleGroup.append(title);heading.prepend(make('span','bd-popup-icon',svg(glyph)));
    const close=$('button',heading);if(close){close.classList.add('bd-popup-close');if(!close.getAttribute('aria-label'))close.setAttribute('aria-label','Close '+title.textContent);close.innerHTML=icon('close');}
    let body=$(':scope > .bd-detail-content, :scope > .bd-bill-detail-content',dialog);
    if(!body){body=make('div','bd-popup-body');[...dialog.children].filter(node=>node!==heading).forEach(node=>body.append(node));dialog.append(body);}
    body.classList.add('bd-popup-body');
  }
  $$('dialog').forEach(stylePopup);
  function addEditorTabs(formId,labels){
    const form=$('#'+formId),dialog=form.closest('dialog'),body=form.closest('.bd-popup-body');
    const panels=$$(':scope > .bd-popup-section, :scope > .debt-editor-section',form);
    if(panels.length!==labels.length)return;
    dialog.classList.add('bd-tabbed-popup');
    const nav=make('div','bd-popup-tabs');nav.setAttribute('role','tablist');nav.setAttribute('aria-label','Editor sections');body.before(nav);
    const buttons=panels.map((panel,index)=>{
      panel.id=panel.id||formId+'-panel-'+index;panel.setAttribute('role','tabpanel');
      const button=make('button','',labels[index]);button.type='button';button.id=formId+'-tab-'+index;button.setAttribute('role','tab');button.setAttribute('aria-controls',panel.id);panel.setAttribute('aria-labelledby',button.id);nav.append(button);
      button.onclick=()=>select(index);return button;
    });
    function select(index,focus=false){
      panels.forEach((panel,i)=>{panel.hidden=i!==index;buttons[i].setAttribute('aria-selected',String(i===index));buttons[i].tabIndex=i===index?0:-1;});
      body.scrollTop=0;if(focus)buttons[index].focus();
    }
    nav.onkeydown=event=>{const i=buttons.indexOf(document.activeElement);if(i<0)return;let next;
      if(event.key==='ArrowRight')next=(i+1)%buttons.length;else if(event.key==='ArrowLeft')next=(i+buttons.length-1)%buttons.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=buttons.length-1;else return;
      event.preventDefault();select(next,true);
    };
    let revealingInvalid=false;
    form.addEventListener('invalid',event=>{if(revealingInvalid)return;const index=panels.findIndex(panel=>panel.contains(event.target));if(index<0)return;revealingInvalid=true;select(index);requestAnimationFrame(()=>{revealingInvalid=false;});},true);
    new MutationObserver(()=>{if(dialog.open)select(0);}).observe(dialog,{attributes:true,attributeFilter:['open']});select(0);
  }
  addEditorTabs('billEditorForm',['Account','Payments','Connections']);
  addEditorTabs('creditEditorForm',['Account','Payments','Connections']);
  addEditorTabs('debtEditorForm',['Account','Balance','Connections']);
  addEditorTabs('householdForm',['Accounts','Contributions','Bills']);
  new MutationObserver(records=>{
    for(const record of records)for(const node of record.addedNodes){
      if(node.nodeType!==1)continue;
      if(node.matches('dialog'))stylePopup(node);
      node.querySelectorAll('dialog').forEach(stylePopup);
    }
  }).observe(document.body,{childList:true,subtree:true});
  return {refresh(plan,next,upcoming,rows,allocations){buildTrackers();buildAccounts();buildPaychecks();updateProfile();updateIncome(plan,next,upcoming,rows,allocations);},openConnections(){go('settings');requestAnimationFrame(()=>$('#bdConnections').scrollIntoView({block:'start'}));}};
};
