'use strict';
// A device-local presentation preference; never stored in the financial plan.
(() => {
  const root = document.documentElement;
  try { root.dataset.layout = localStorage.getItem('bearden:design') === 'classic' ? 'classic' : 'den'; }
  catch { root.dataset.layout = 'den'; }

  document.addEventListener('DOMContentLoaded', () => {
    const $ = selector => document.querySelector(selector);
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const money = n => new Intl.NumberFormat('en-US', {style:'currency', currency:'USD'}).format(n / 100);
    const dateLabel = date => new Date(date + 'T12:00:00').toLocaleDateString('en-US', {month:'short', day:'numeric'});
    const paths = {
      overview:'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9',
      income:'M5 20V10h3v10M11 20V4h3v16M17 20V7h3v13',
      bills:'M5 5h14v16H5zM8 3v4m8-4v4M5 10h14M9 14h2m2 3h2',
      debts:'M3 5h18v14H3zM3 10h18M7 15h4',
      savings:'M5 11c0-5 10-7 13-2l3 1v6h-3l-1 4h-3v-3H9v3H6l-1-5H3v-4zM10 6h4M16 10v1',
      tools:'M14 5a5 5 0 0 0-6 6L3 16v5h5l5-5a5 5 0 0 0 6-6l-4 4-5-5z',
      settings:'M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6M9 15v6',
      plan:'M5 20V12m7 8V4m7 16V8',
      close:'m6 6 12 12M6 18 18 6',
      arrow:'m9 5 7 7-7 7',
      sun:'M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17m10-10 1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    };
    const icon = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+paths[name]+'"/></svg>';
    const bear = '<svg viewBox="0 0 48 30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 19 1-8 5-6 8-1 4 2 7-1 4 2 5-2 3 3 5 2-1 5-6 1-1 7 3 3h-7l-3-7-4 1-2 6h-6l2-7-7-2-3 9H3l3-8-3 1Z"/><path d="m32 7 2-4 4 2M38 10h.1M12 9l-3 5m12 0 2 5"/></svg>';
    const button = (action, label, glyph, extra='') => '<button type="button" data-den-go="'+action+'" '+extra+'>'+icon(glyph)+'<span>'+label+'</span></button>';
    const insert = (parent, name, html) => {
      let box = parent.querySelector(':scope > .'+name);
      if (!box) { box = document.createElement('div'); box.className = 'den-only '+name; parent.append(box); }
      if (box.innerHTML !== html) box.innerHTML = html;
      return box;
    };

    const preference = document.createElement('section');
    preference.id = 'denDesignSettings';
    preference.innerHTML = '<h3>Design</h3><label for="denDesignChoice">Layout</label><select id="denDesignChoice"><option value="den">Wallet — modern cards</option><option value="classic">Original design</option></select><p class="subtle">Switch back anytime. This changes the layout on this device.</p><p id="denDesignStatus" class="subtle" role="status"></p>';
    $('#trackerOptions').before(preference);
    $('#denDesignChoice').value = root.dataset.layout;
    $('#denDesignChoice').onchange = async event => {
      const choice=event.target.value;event.target.disabled=true;
      try { await window.flushBearDenState?.();localStorage.setItem('bearden:design',choice);location.reload(); }
      catch { event.target.value=root.dataset.layout;event.target.disabled=false;$('#denDesignStatus').textContent='Could not save your latest changes or layout choice. Please try again.'; }
    };
    if(root.dataset.layout==='classic')return;

    const brand = document.createElement('header');
    brand.className = 'den-only den-brand';
    brand.innerHTML = '<div>'+bear+'<span>BearDen</span></div><div><button type="button" data-den-go="settings" class="bd-avatar" aria-label="Settings"><span data-bd-initials>BD</span></button></div>';
    $('.app-title-box').before(brand);
    const intro = document.createElement('header');
    intro.className = 'den-only den-intro';
    intro.innerHTML = '<h2>Dashboard</h2><p>'+new Date().toLocaleDateString('en-US', {weekday:'long',month:'long',day:'numeric'})+'</p>';
    $('#tab-debt').prepend(intro);


    const walletIcon = '<span class="den-wallet-icon" aria-hidden="true"><i></i><i></i><i></i></span>';
    const dock = document.createElement('nav');
    dock.id = 'denDock'; dock.className = 'den-only den-dock'; dock.setAttribute('aria-label','Wallet navigation');
    dock.innerHTML = '<button type="button" id="denOpen" aria-haspopup="dialog" aria-expanded="false" aria-controls="denMenu">'+walletIcon+'<span>Wallet</span></button>';
    document.body.append(dock);
    const menu = document.createElement('dialog');
    menu.id = 'denMenu'; menu.setAttribute('aria-labelledby','denMenuTitle');
    const walletCard = (destination, label, glyph, content) => '<button type="button" class="den-wallet-card den-wallet-'+destination+'" data-den-go="'+destination+'"><span class="den-wallet-glyph">'+icon(glyph)+'</span><span class="den-wallet-content"><span class="den-wallet-label">'+label+'</span>'+content+'</span>'+icon('arrow')+'</button>';
    menu.innerHTML = '<div class="den-menu-sheet"><header><div class="den-wallet-brand">'+bear+'<strong>BearDen</strong></div><button type="button" id="denClose" aria-label="Close wallet">'+icon('close')+'</button><h2 id="denMenuTitle">Your wallet</h2><p>Choose a section</p></header><nav class="den-wallet-stack" aria-label="All sections">'
      +walletCard('overview','Dashboard','overview','<small>Your trackers, together</small><span class="den-wallet-metrics"><span><strong data-wallet-value="bank">—</strong><small>bank balance</small></span><span><strong data-wallet-value="bills">—</strong><small>left to pay</small></span></span>')
      +walletCard('income','Income','income','<strong data-wallet-value="paycheck">—</strong><small data-wallet-value="payday">Your next paycheck</small>')
      +walletCard('bills','Bills','bills','<strong data-wallet-value="bills">—</strong><small data-wallet-value="paid">Your recurring bills</small><progress id="denWalletBillsProgress" max="1" value="0" aria-label="Bills paid this month"></progress>')
      +walletCard('debts','Debt','debts','<strong data-wallet-value="debt">—</strong><small data-wallet-value="payoff">Your payoff plan</small>')
      +walletCard('savings','Savings','savings','<strong data-wallet-value="savings">—</strong><small data-wallet-value="goals">Your savings goals</small>')
      +walletCard('settings','Settings','settings','<small>Account · Appearance · Connections</small>')
      +'</nav><footer>'+button('overview','Back to dashboard','overview')+'</footer></div>';
    document.body.append(menu);
    let scrollBeforeMenu = 0, previousOverflow = '';
    function closeMenu() { if(menu.open)menu.close(); }
    $('#denOpen').onclick = () => {
      if(menu.open)return;
      menu.scrollTop=0;
      scrollBeforeMenu = scrollY; previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden'; root.classList.add('den-menu-open');
      $('#denOpen').setAttribute('aria-expanded','true'); menu.showModal();
      menu.querySelector('[data-den-go="overview"]').focus({preventScroll:true});
    };
    $('#denClose').onclick = closeMenu;
    menu.addEventListener('keydown', event => {
      // The shared editor guard disables native Escape; navigation has no draft to discard.
      if(event.key==='Escape'){event.preventDefault();closeMenu();}
      if(event.key==='Tab'){
        const buttons=[...menu.querySelectorAll('button:not([disabled])')].filter(el=>el.checkVisibility());
        const first=buttons[0],last=buttons.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
      }
    });
    menu.addEventListener('click', event => { if(event.target === menu)closeMenu(); });
    menu.addEventListener('close', () => {
      document.body.style.overflow = previousOverflow; root.classList.remove('den-menu-open');
      $('#denOpen').setAttribute('aria-expanded','false');
      // A destination click handles focus and scroll itself. Escape returns to Den.
      if (!navigating) { window.scrollTo(0,scrollBeforeMenu); $('#denOpen').focus({preventScroll:true}); }
      navigating = false;
    });
    let navigating = false;
    function focusSection(element) {
      if(!element)return;
      element.setAttribute('tabindex','-1');
      element.focus({preventScroll:true}); element.scrollIntoView({block:'start',behavior:'instant'});
    }
    function go(destination) {
      navigating = menu.open; closeMenu();
      const tab = {overview:'debt',plan:'debt',savings:'debt',forecast:'bills',budget:'income','income-edit':'income',connections:'settings'}[destination] || destination;
      window.selectBearTab(tab);
      if(destination==='connections'){const search=$('#bdSettingsSearch');search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));}
      if(destination === 'forecast')$('#accounts-nav-calendar').click();
      if(destination === 'income-edit' && $('#incomeToggleBtn').getAttribute('aria-expanded')!=='true')$('#incomeToggleBtn').click();
      if(destination === 'budget' && $('#incomeBudgetToggleBtn').getAttribute('aria-expanded')!=='true')$('#incomeBudgetToggleBtn').click();
      const targets = {overview:'.den-intro',plan:'#schedulePlanSection',savings:'#savingsHeroContainer',forecast:'#billsForecastCard',budget:'#incomeBudgetSlot','income-edit':'#incomeDropdown',connections:'#bdConnections'};
      requestAnimationFrame(() => {
        if(destination==='savings' && $('#savingsHeroContainer').hidden){window.selectBearTab('settings');focusSection($('#savingsTrackerToggle'));}
        else {focusSection($(targets[destination] || '#tab-'+tab+' h2'));if(['overview','income','bills','debts','settings','tools'].includes(destination))window.scrollTo({top:0,behavior:'instant'});}
      });
    }
    document.addEventListener('click', event => {
      const action = event.target.closest('[data-den-go]'); if(action)go(action.dataset.denGo);
    });
    function markDestination(tab) {
      for(const card of menu.querySelectorAll('.den-wallet-card'))card.setAttribute('aria-current',(tab==='debt'?'overview':tab)===card.dataset.denGo?'page':'false');
    }
    window.addEventListener('bearden-tab-changed', event => markDestination(event.detail));
    markDestination('debt');


    const pageSummary = (id, tab, html) => {
      const section=document.createElement('section');section.id=id;section.className='den-only den-page-summary';
      section.innerHTML=html;$('#tab-'+tab+' > .account-view-tabs').before(section);
    };
    const stat = (label, key) => '<div><strong data-den-copy="'+key+'">—</strong><span>'+label+'</span></div>';
    pageSummary('denBillsSummary','bills','<div class="den-summary-heading"><h3 data-den-copy="billTrackerMonth">This month</h3><button type="button" data-forecast-accounts>Account '+icon('arrow')+'</button></div><div class="den-bills-paid"><strong data-den-copy="billTrackerPaidCount">—</strong><div class="den-paid-ring" role="img" aria-label="Bills paid this month"><span id="denBillsPercent">0%</span></div></div><div class="den-summary-stats">'+stat('Bills balance','billTrackerBalance')+stat('Estimated total','billTrackerTotal')+stat('Left to pay','billTrackerRemaining')+'</div>');
    pageSummary('denDebtSummary','debts','<div class="den-summary-heading"><h3>Total remaining</h3>'+button('plan','Payoff plan','plan')+'</div><strong class="den-summary-amount" id="denDebtTotal">—</strong><p id="denDebtCoverage" class="subtle" hidden></p><div class="den-summary-stats">'+stat('Estimated payoff','heroDate')+stat('Projected interest','heroInterest')+'</div><div class="den-summary-progress"><span data-den-copy="heroPiePct">0%</span> paid off<progress id="denDebtProgress" max="100" value="0" aria-label="Debt paid off"></progress></div><div class="den-summary-method"><label for="denPayoffMethod">Payoff method</label><select id="denPayoffMethod"><option value="avalanche">Avalanche</option><option value="snowball">Snowball</option><option value="minimum">Minimums</option><option value="burn">Burn</option></select></div>');
    $('#denPayoffMethod').onchange=event=>window.setPayoffMethod?.(event.target.value);
    insert($('#tab-income .bank-card'),'den-income-heading','<span>Account overview</span><button type="button" data-choose-accounts>Accounts '+icon('arrow')+'</button>');
    $('#tab-income .tab-intro').append($('#tab-income .income-controls-header'));
    const planTitle=$('#schedulePlanSection .section-title');
    planTitle.innerHTML='<span class="den-original-title">📋 Your Schedule:</span><span class="den-only">Your paychecks</span>';


    const actions = (a,b) => '<div class="den-card-actions">'+a+b+'</div>';
    insert($('#debtIncomeCard'),'den-income-actions',actions(button('income-edit','Income','income'),button('budget','Budget','settings')));
    insert($('#billTracker'),'den-bill-actions',actions(button('bills','View bills','bills'),button('forecast','Forecast','plan')));
    insert($('#debtHeroBox'),'den-debt-actions',actions(button('debts','View debts','debts'),button('plan','Payoff plan','plan')));
    const views=window.mountWalletViews({icon,bear,esc,money,go,queueRefresh});
    // Existing widgets continue to own all their numbers, edits and calculations.
    let dashboard = null, frame = null;
    function queueRefresh() { if(frame)return; frame=requestAnimationFrame(()=>{frame=null;refresh();}); }
    window.addEventListener('bearden-dashboard-updated', event => {dashboard=event.detail;queueRefresh();});
    window.addEventListener('bearden-plan-changed',queueRefresh);

    function refresh() {
      if(root.dataset.layout!=='den')return;
      const plan = window.getDebtPlan?.(); if(!plan)return;
      const today = new Date(); const day = today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');
      const next = plan.schedule.find(row => row.date >= day && !plan.state.checkedPaychecks?.[row.paycheck]);
      const upcoming = dashboard?.upcoming;
      const totals = new Map();
      for(const item of upcoming?.allocationDetails || [])totals.set(item.kind,(totals.get(item.kind)||0)+item.amount);
      const fixed = next ? (next.accountBillsThisCheck || []).reduce((sum,bill)=>sum+bill.amount,0) : dashboard?.fixedBills || 0;
      const allocations = (upcoming?.allocations || 0) + fixed;
      const allocationRows = [...(fixed?[['Bills',fixed]]:[]),...['budget','expense','debt','savings'].filter(k=>totals.has(k)).map(k=>[({budget:'Budget',expense:'One-time',debt:'Debt',savings:'Savings'})[k],totals.get(k)])];
      insert($('#debtIncomeCard'),'den-income-detail',upcoming?'<div class="den-payday-total"><span>Estimated next paycheck</span><strong>'+money(upcoming.amount)+'</strong></div><div class="den-allocation-grid">'+allocationRows.map(([label,amount])=>'<div><small>'+label+'</small><strong>'+money(amount)+'</strong></div>').join('')+'<div class="den-remainder"><small>After planned allocations</small><strong>'+money(upcoming.amount-allocations)+'</strong></div></div>':'');
      const contribution = dashboard?.nextContribution;
      insert($('#billTracker'),'den-contribution',contribution?'<div class="den-next-row">'+icon('income')+'<span>Next contribution<small>'+dateLabel(contribution.date)+'</small></span><strong>+'+money(contribution.amount)+'</strong></div>':'');
      const debtAmount = (next?.payments || []).reduce((a,b)=>a+b,0);
      $('#heroPie')?.style.setProperty('--den-progress',parseFloat($('#heroPiePct')?.textContent)||0);
      insert($('#debtHeroBox'),'den-debt-next',next&&debtAmount>0?'<div class="den-next-row">'+icon('bills')+'<span>Next planned debt payments<small>'+dateLabel(next.date)+'</small></span><strong>'+money(Math.round(debtAmount*100))+'</strong></div>':'');
      refreshSummaries(plan, upcoming, allocations);
      const checked = Object.keys(plan.state.checkedPaychecks||{}).filter(k=>plan.state.checkedPaychecks[k]).map(Number);
      const lastChecked = plan.schedule.find(row=>row.paycheck===Math.max(...checked));
      for(const g of plan.state.savingsGoals || []){
        const card = document.getElementById('savingsHero-'+g.id); if(!card)continue;
        const saved = lastChecked?.savingsByGoal?.find(x=>x.id===g.id)?.balance ?? Number(g.start||0);
        const percent = g.goal>0?Math.min(100,Math.max(0,saved/g.goal*100)):0;
        card.querySelector('.hero-pie-corner')?.style.setProperty('--den-progress',percent);
        const goalRows = plan.schedule.filter(row=>row.date>=day && !plan.state.checkedPaychecks?.[row.paycheck]).slice(0,12);
        const balances = [saved,...goalRows.map(row=>row.savingsByGoal?.find(x=>x.id===g.id)?.balance??saved)];
        const max = Math.max(1,...balances); const points = balances.map((v,i)=>(8+i*284/Math.max(1,balances.length-1)).toFixed(1)+','+(66-Math.max(0,v)/max*54).toFixed(1)).join(' ');
        const graph=balances.length>1?'<div class="den-savings-chart"><svg viewBox="0 0 300 76" role="img" aria-label="Projected savings from '+esc(money(Math.round(saved*100)))+' to '+esc(money(Math.round(balances.at(-1)*100)))+'"><path d="M8 68H292M8 38H292M8 8H292" class="den-chart-grid"/><polyline points="'+points+'" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg><div><span>Projected savings</span><span>Through '+dateLabel(goalRows.at(-1).date)+'</span></div></div>':'';
        insert(card,'den-savings-detail','<div class="den-progress-copy"><span>'+Math.round(percent)+'% of goal</span><strong>'+money(Math.round(Math.max(0,g.goal-saved)*100))+' to go</strong></div><progress max="100" value="'+percent+'" aria-label="Savings goal progress"></progress>'+graph+actions('<button type="button" data-bd-click="toggleSavingsGoalEdit('+Number(g.id)+')">'+icon('settings')+'<span>Manage goal</span></button>','<button type="button" data-bd-click="toggleSavingsWithdrawPanel('+Number(g.id)+')">'+icon('savings')+'<span>Log withdrawal</span></button>'));
      }
      views.refresh(plan,next,upcoming,allocationRows,allocations);
    }
    function refreshSummaries(plan, upcoming, allocations) {
      for(const heading of document.querySelectorAll('#billAgenda h4,#debtAccounts h4'))heading.dataset.denMark=(heading.textContent.trim().match(/\b[\p{L}\p{N}]/gu)||['•']).slice(0,2).join('').toUpperCase();
      const content = id => document.getElementById(id)?.textContent.trim() || '—';
      for(const el of document.querySelectorAll('[data-den-copy]'))el.textContent=content(el.dataset.denCopy).replace(/\.00\b/g,'');
      const p=$('#billTrackerProgress'),percent=p.max?Math.round(p.value/p.max*100):0;
      $('#denBillsPercent').textContent=percent+'%';
      insert($('#billTracker'),'den-bill-ring','<div class="den-tracker-ring" role="img" aria-label="'+esc(content('billTrackerPaidCount'))+'" style="--paid:'+percent+'%"><span>'+percent+'%</span></div>');
      $('#denBillsSummary .den-paid-ring').style.setProperty('--paid',percent+'%');
      $('#denBillsSummary .den-paid-ring').setAttribute('aria-label',content('billTrackerPaidCount'));
      $('#denWalletBillsProgress').max=p.max;$('#denWalletBillsProgress').value=p.value;
      $('#denDebtTotal').textContent=[...$('#debtTotalAmount').querySelectorAll('strong')].map(el=>el.textContent).join(' · ')||content('heroTotal');
      $('#denDebtTotal').textContent=$('#denDebtTotal').textContent.replace(/\.00\b/g,'');
      $('#denDebtCoverage').textContent=$('#debtTotalAmount .subtle')?.textContent||'';$('#denDebtCoverage').hidden=!$('#denDebtCoverage').textContent;
      const progress=parseFloat(content('heroPiePct'))||0;
      $('#denDebtProgress').value=progress;
      $('#denDebtSummary .den-summary-progress').hidden=$('#heroPieWrap').style.display==='none';
      $('#denPayoffMethod').value=plan.state.payoffMethod||'avalanche';
      const income=$('#tab-income .bank-card');
      insert(income,'den-income-payday',upcoming?'<span>'+icon('bills')+'<span>Next payday<strong>'+esc(new Date(upcoming.date+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}))+'</strong></span></span><span><strong>'+money(upcoming.amount)+'</strong><small>Estimated take-home</small></span>':'');
      const checked=Object.keys(plan.state.checkedPaychecks||{}).filter(k=>plan.state.checkedPaychecks[k]).map(Number);
      const last=plan.schedule.find(row=>row.paycheck===Math.max(...checked));
      const goals=plan.state.savingsGoals||[],saved=goals.reduce((total,g)=>total+(last?.savingsByGoal?.find(x=>x.id===g.id)?.balance??Number(g.start||0)),0);
      const values={bank:$('#debtIncomeSummary .income-total')?.textContent||'—',bills:content('billTrackerRemaining'),paid:content('billTrackerPaidCount')+' · '+content('billTrackerMonth'),debt:$('#denDebtTotal').textContent,payoff:'Est. payoff '+content('heroDate'),paycheck:upcoming?money(upcoming.amount):'Set up income',payday:upcoming?dateLabel(upcoming.date)+' · '+money(upcoming.amount-allocations)+' after plan':'Choose your first payday',savings:money(Math.round(saved*100)),goals:goals.length?goals.length+' goal'+(goals.length===1?'':'s')+' · '+money(Math.round(goals.reduce((n,g)=>n+Number(g.goal||0),0)*100))+' target':'Create your first goal'};
      for(const el of menu.querySelectorAll('[data-wallet-value]'))el.textContent=values[el.dataset.walletValue];
    }
    window.classicReady?.then(queueRefresh);
    queueRefresh();
  });
})();
