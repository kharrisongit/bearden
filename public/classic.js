function bdEscape(s){return String(s??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));}

// Storage: uses the browser's localStorage so data persists between visits
// when this file is saved and opened directly (as a standalone file/bookmark),
// rather than through Claude's artifact viewer — Claude's artifact sandbox
// blocks real browser storage.
const storage=window.BearDen.storage;

// ---- State ----
let cardIdCounter = 0;
let cardsData = [];

let budgetItemIdCounter = 0;
let budgetItems = [];
let budgetSetupVersion=0;
function starterBudgetItems(){return [{id:2,label:'Car Fuel',amount:100},{id:3,label:'Groceries',amount:100}];}

let savingsGoalIdCounter = 0;
let savingsGoals = [];

let appliedBonuses = {};
let bonusControlsEnabled=true;
let payoffControlsEnabled=false;
let paycheckOverrides = {};
let savingsContributionOverrides = {}; // { [goalId]: { [paycheckNum]: amount } }
let checkedPaychecks = {};
let bonusInputOpenForPaycheck = null; // which paycheck's inline "add bonus" field is expanded
let currentPayoffMethod = 'avalanche'; // avalanche, snowball, or minimum
let budgetItemOverrides = {}; // { [itemId]: { [paycheckNum]: amount } } — per-check edits to a budget line item
let paycheckSquashes = {}; // Full payoff selections, including projected interest for that paycheck.
let paycheckSlices = {}; // { [paycheck]: { [cardId]: true } }; selections recalculate from that paycheck’s balance
let accountPaymentOverrides = {}; // { [cardId]: { [paycheckNum]: amount } } — a manually logged actual payment for that account/check, overriding the projected avalanche/snowball payment
let extraExpenses = {}; // { [paycheckNum]: [{id, label, amount}, ...] } — one-time expenses, don't recur
let extraExpenseIdCounter = 0;
let extraExpenseInputOpenForPaycheck = null; // which paycheck's inline "add expense" field is expanded

// Most recent saved tracker snapshot. Account setup is explicit through Accounts.
let loadedState = null;

function money(n){
  const sign = n < 0 ? '-' : '';
  return sign + '$' + Math.abs(n).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
}

const PIE_COLORS = ['#5ca9a0','#c69a61','#8aa9bd','#b96c63','#8caa87','#d4be92','#648d92','#a2c1b7'];

// Builds a CSS conic-gradient pie chart with a legend. segments is
// [{label, value, target}]; colors are assigned automatically. If
// onClickFnName is given (a global function name as a string), both the
// individual pie slices (via click-angle math) and legend rows become
// tappable, calling window[onClickFnName](segment.target). Returns '' if
// there's nothing meaningful to show.
function buildPieChartHTML(segments, size, onClickFnName, showLegend){
  if (showLegend === undefined) showLegend = true;
  const filtered = segments.filter(s => s.value > 0.005);
  const total = filtered.reduce((a,s)=>a+s.value, 0);
  if (total <= 0.005) return '';
  let cumulative = 0;
  const boundaries = [];
  const stops = filtered.map((s, i) => {
    const color = PIE_COLORS[i % PIE_COLORS.length];
    const startPct = (cumulative/total)*100;
    cumulative += s.value;
    const endPct = (cumulative/total)*100;
    boundaries.push({ start: startPct, end: endPct, target: s.target });
    return { color, css: `${color} ${startPct.toFixed(2)}% ${endPct.toFixed(2)}%` };
  });
  const gradient = stops.map(s=>s.css).join(', ');
  const clickable = !!onClickFnName;
  const legend = filtered.map((s, i) => `
    <div class="pie-legend-item"${clickable ? ` data-bd-click="window['${onClickFnName}'](${JSON.stringify(s.target)})" style="cursor:pointer;"` : ''}><span class="pie-legend-dot" style="background:${stops[i].color};"></span>${bdEscape(s.label)} — ${money(s.value)}</div>
  `).join('');
  const boundariesAttr = clickable ? ` data-pie-boundaries='${JSON.stringify(boundaries)}' data-pie-fn="${onClickFnName}" data-bd-click="handlePieSliceClick(event, this)"` : '';
  return `
    <div class="pie-chart-wrap"${showLegend ? '' : ' style="padding:0;"'}>
      <div class="pie-chart" style="width:${size}px;height:${size}px;background:conic-gradient(${gradient});${clickable ? 'cursor:pointer;' : ''}"${boundariesAttr}></div>
      ${showLegend ? `<div class="pie-legend">${legend}</div>` : ''}
    </div>
  `;
}

// Figures out which pie slice was tapped based on the click angle relative
// to the circle's center (conic-gradient starts at 12 o'clock, clockwise).
function handlePieSliceClick(evt, el){
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width/2;
  const cy = rect.top + rect.height/2;
  const dx = evt.clientX - cx;
  const dy = evt.clientY - cy;
  let angleDeg = Math.atan2(dx, -dy) * 180/Math.PI;
  if (angleDeg < 0) angleDeg += 360;
  const pct = (angleDeg/360)*100;
  let boundaries;
  try { boundaries = JSON.parse(el.getAttribute('data-pie-boundaries')); } catch(e) { return; }
  const fnName = el.getAttribute('data-pie-fn');
  const seg = boundaries.find(b => pct >= b.start && pct < b.end) || boundaries[boundaries.length - 1];
  if (seg && fnName && window[fnName]) window[fnName](seg.target);
}

// ---- Debt (cards) ----
// Accounts are now added and edited right from the Accounts dropdown's
// account list (see renderSpendingTracker / buildAccountDetailHTML) instead
// of a separate raw-input page, so there's no standalone list to rebuild
// here — just update the data and let calculate() re-render everything.
function removeCard(id){
  cardsData = cardsData.filter(c => c.id !== id);
  delete accountPaymentOverrides[id];
  for(const paycheck of Object.keys(paycheckSlices)){delete paycheckSlices[paycheck][id];if(!Object.keys(paycheckSlices[paycheck]).length)delete paycheckSlices[paycheck];}
  for(const paycheck of Object.keys(paycheckSquashes)){delete paycheckSquashes[paycheck][id];if(!Object.keys(paycheckSquashes[paycheck]).length)delete paycheckSquashes[paycheck];}
  Object.keys(extraExpenses).forEach(pc => {
    extraExpenses[pc] = extraExpenses[pc].filter(e => e.autoFromCardId !== id);
    if (extraExpenses[pc].length === 0) delete extraExpenses[pc];
  });
  if (currentDetailAccountIdx !== null) currentDetailAccountIdx = null;
  calculate();
}

// ---- Budget items ----
function renderBudgetItems(){
  const container = document.getElementById('budgetItemsList');
  container.innerHTML = budgetItems.map(item => `
    <div class="field-row">
      <div class="field-name">${bdEscape(item.label)}<span class="remove" style="margin-left:6px;" data-bd-click="removeBudgetItem(${item.id})">Remove</span></div>
      <input type="number" id="budget_${item.id}" value="${item.amount}" step="0.01">
    </div>
  `).join('');
}

function addBudgetItem(){
  const label = document.getElementById('newBudgetLabel').value.trim() || 'Other';
  const amount = parseFloat(document.getElementById('newBudgetAmount').value)||0;
  budgetItemIdCounter++;
  budgetItems.push({id: budgetItemIdCounter, label, amount});
  document.getElementById('newBudgetLabel').value = '';
  document.getElementById('newBudgetAmount').value = '';
  renderBudgetItems();
  calculate();
}

function removeBudgetItem(id){
  budgetItems = budgetItems.filter(item => item.id !== id);
  renderBudgetItems();
  calculate();
}

// ---- Savings goals ----
// Editing now happens inline on each hero card (via its gear icon) rather
// than in a separate dropdown — savingsGoalEditingId tracks which goal's
// edit panel is currently expanded (only one at a time).
let savingsGoalEditingId = null;
let savingsWithdrawOpenId = null;
let justAddedGoalId = null; // set right before a recalculation so the newly-created card can animate in

function addSavingsGoal(){
  savingsGoalIdCounter++;
  const n = savingsGoals.length + 1;
  savingsGoals.push({id: savingsGoalIdCounter, name: `Savings Goal ${n}`, goal: 0, start: 0, contribution: 0, withdrawalHistory: []});
  savingsGoalEditingId = savingsGoalIdCounter; // open its edit panel right away
  justAddedGoalId = savingsGoalIdCounter;
  calculate();
}

function removeSavingsGoal(id){
  const cardEl = document.getElementById('savingsHero-' + id);
  if (cardEl) {
    // Let the card play its disappearing animation before the data change
    // and recalculation rebuild the savings container out from under it.
    cardEl.classList.add('savings-card-leaving');
    setTimeout(() => {
      savingsGoals = savingsGoals.filter(g => g.id !== id);
      delete savingsContributionOverrides[id];
      if (savingsGoalEditingId === id) savingsGoalEditingId = null;
      if (savingsWithdrawOpenId === id) savingsWithdrawOpenId = null;
      calculate();
    }, 900);
    return;
  }
  savingsGoals = savingsGoals.filter(g => g.id !== id);
  delete savingsContributionOverrides[id];
  if (savingsGoalEditingId === id) savingsGoalEditingId = null;
  if (savingsWithdrawOpenId === id) savingsWithdrawOpenId = null;
  calculate();
}

function toggleSavingsGoalEdit(id){
  const wasEditingThis = savingsGoalEditingId === id;
  savingsGoalEditingId = wasEditingThis ? null : id;
  savingsWithdrawOpenId = null; // mutually exclusive with the withdraw panel

  // Pure UI toggle — animate the panel directly rather than triggering a
  // full recalculation just to expand or collapse it. savingsGoalEditingId
  // still gets consulted (in buildSavingsGoalHeroHTML) so the right state
  // survives any later re-render triggered by an actual data change.
  document.querySelectorAll('.savings-hero-edit.open').forEach(el => closeSlidingDropdown(el));
  if (!wasEditingThis) {
    const target = document.getElementById('savingsGoalEdit-' + id);
    if (target) openSlidingDropdown(target);
  }
}

function toggleSavingsWithdrawPanel(id){
  const wasOpenForThis = savingsWithdrawOpenId === id;
  savingsWithdrawOpenId = wasOpenForThis ? null : id;
  savingsGoalEditingId = null; // mutually exclusive with the edit panel

  document.querySelectorAll('.savings-hero-edit.open').forEach(el => closeSlidingDropdown(el));
  if (!wasOpenForThis) {
    const target = document.getElementById('savingsWithdrawPanel-' + id);
    if (target) openSlidingDropdown(target);
  }
}

// ---- Bonus (applied inline, per paycheck card) ----
function bonusEstimateNote(){return 'Enter your bonus before taxes. Uses your saved state and W-4 settings with the separate bonus withholding estimate. Set those in Income first.';}

function toggleBonusInlineInput(paycheckNum){
  bonusInputOpenForPaycheck = (bonusInputOpenForPaycheck === paycheckNum) ? null : paycheckNum;
  calculate();
}

function applyBonusToPaycheck(paycheckNum){
  const grossEl = document.getElementById(`bonusInlineAmount-${paycheckNum}`);
  const gross = Number(grossEl?.value);
  if (!Number.isFinite(gross) || gross <= 0) return;
  let net;
  try{net=window.BearDenTaxes.estimatePay(gross,window.BearDenTaxes.read(),{bonus:true}).net;}
  catch(e){setStorageStatus(e.message);grossEl.setCustomValidity(e.message);grossEl.reportValidity();return;}
  grossEl.setCustomValidity('');
  appliedBonuses[paycheckNum] = net;
  bonusInputOpenForPaycheck = null;
  calculate();
}

function removeBonusFromPaycheck(paycheckNum){
  delete appliedBonuses[paycheckNum];
  calculate();
}

// ---- Editable budget line items (per paycheck) ----
function updateBudgetItemAmount(itemId, paycheckNum, value){
  const amt = parseFloat(value);
  if (!budgetItemOverrides[itemId]) budgetItemOverrides[itemId] = {};
  if (isNaN(amt) || amt < 0) {
    delete budgetItemOverrides[itemId][paycheckNum];
  } else {
    budgetItemOverrides[itemId][paycheckNum] = amt;
  }
  calculate();
}

// ---- Editable account payments (per paycheck) ----
// Lets a person log what they actually paid toward an account on a given
// check, in place of the projected avalanche/snowball payment — e.g. they
// paid extra one check, or less than planned. Because calculate() re-runs
// the whole schedule from scratch every time, this one edit ripples
// forward through every later balance, interest figure, payoff date, and
// milestone automatically — there's nothing else to keep in sync.
//
// A SMALLER payment than planned is usually smaller for a reason — some
// other expense ate into the budget that check — so rather than quietly
// freeing that money up for another account, the shortfall (planned minus
// actual, using the "natural" no-override baseline computed in
// calculate()) gets logged automatically as a one-time expense on that
// same check. That keeps the money accounted for and, since it comes out
// of the shared budget before anything is divided up, it stops the
// avalanche/snowball engine from quietly handing it to a different
// account instead. A BIGGER payment doesn't get this treatment — that's
// just extra money going straight at the debt, nothing to explain away.
function payoffActionPayment(balance,interest,minimum,action){
 return action==='squash'?balance+interest:Math.min(balance+interest,Math.max(minimum,Math.round(balance*50)/100));
}
function paycheckActionAllowance(row,index,action){
 const amount=payoffActionPayment(row.balancesBefore[index],row.interestByAccount[index],row.minimumPayments[index],action);
 const required=row.payoffActionPayments.reduce((sum,n)=>sum+n,0)-row.payoffActionPayments[index]+amount;
 const shortfall=Math.max(0,Math.round(required*100)-Math.round(row.payoffActionFunds*100))/100;
 return {allowed:row.balancesBefore[index]>.005&&shortfall===0,shortfall};
}

function togglePaycheckSlice(cardId,paycheck){
 const row=lastSchedule.find(r=>r.paycheck===paycheck),index=lastCardsForSpending.findIndex(c=>String(c.id)===String(cardId));
 if(!row||index<0)return;
 const selected=!!paycheckSlices[paycheck]?.[cardId]&&!paycheckSquashes[paycheck]?.[cardId];
 if(!selected&&!paycheckActionAllowance(row,index,'slice').allowed)return;
 if(paycheckSquashes[paycheck]){delete paycheckSquashes[paycheck][cardId];if(!Object.keys(paycheckSquashes[paycheck]).length)delete paycheckSquashes[paycheck];}
 paycheckSlices[paycheck]={...paycheckSlices[paycheck]};
 if(selected)delete paycheckSlices[paycheck][cardId];else paycheckSlices[paycheck][cardId]=true;
 if(!Object.keys(paycheckSlices[paycheck]).length)delete paycheckSlices[paycheck];
 calculate();
}

function togglePaycheckSquash(cardId,paycheck){
 const row=lastSchedule.find(r=>r.paycheck===paycheck),index=lastCardsForSpending.findIndex(c=>String(c.id)===String(cardId));
 if(!row||index<0)return;
 const selected=!!paycheckSquashes[paycheck]?.[cardId];
 if(!selected&&!paycheckActionAllowance(row,index,'squash').allowed)return;
 paycheckSquashes[paycheck]={...paycheckSquashes[paycheck]};
 if(selected)delete paycheckSquashes[paycheck][cardId];else paycheckSquashes[paycheck][cardId]=true;
 if(!Object.keys(paycheckSquashes[paycheck]).length)delete paycheckSquashes[paycheck];
 // Keep any prior Slice underneath, so Undo Squash restores that choice.
 calculate();
}

function updateAccountPayment(cardId, paycheckNum, value, naturalPayment){
  const amt = parseFloat(value);
  if (!accountPaymentOverrides[cardId]) accountPaymentOverrides[cardId] = {};

  if (isNaN(amt) || amt < 0) {
    delete accountPaymentOverrides[cardId][paycheckNum];
    removeAutoShortfallExpense(cardId, paycheckNum);
    calculate();
    return;
  }

  accountPaymentOverrides[cardId][paycheckNum] = amt;

  const shortfall = naturalPayment - amt;
  if (shortfall > 0.005) {
    const card = cardsData.find(c => c.id === cardId);
    setAutoShortfallExpense(cardId, paycheckNum, shortfall, card ? card.name : 'account');
  } else {
    removeAutoShortfallExpense(cardId, paycheckNum);
  }

  calculate();
}

// Creates (or updates, in place, rather than stacking a second entry) the
// one-time expense standing in for a reduced payment's shortfall. Tagged
// with autoFromCardId so it can be found again on the next edit, or
// cleaned up automatically if the account itself is later deleted.
function setAutoShortfallExpense(cardId, paycheckNum, amount, cardName){
  if (!extraExpenses[paycheckNum]) extraExpenses[paycheckNum] = [];
  const list = extraExpenses[paycheckNum];
  const existing = list.find(e => e.autoFromCardId === cardId);
  if (existing) {
    existing.amount = amount;
    existing.label = `Reduced payment: ${cardName}`;
  } else {
    extraExpenseIdCounter++;
    list.push({ id: extraExpenseIdCounter, label: `Reduced payment: ${cardName}`, amount, autoFromCardId: cardId });
  }
}

function removeAutoShortfallExpense(cardId, paycheckNum){
  if (!extraExpenses[paycheckNum]) return;
  extraExpenses[paycheckNum] = extraExpenses[paycheckNum].filter(e => e.autoFromCardId !== cardId);
  if (extraExpenses[paycheckNum].length === 0) delete extraExpenses[paycheckNum];
}

// ---- One-time unexpected expenses (per paycheck, don't recur) ----
function toggleExtraExpenseInput(paycheckNum){
  extraExpenseInputOpenForPaycheck = (extraExpenseInputOpenForPaycheck === paycheckNum) ? null : paycheckNum;
  calculate();
}

function addExtraExpenseToPaycheck(paycheckNum){
  const labelEl = document.getElementById(`extraExpenseLabel-${paycheckNum}`);
  const amountEl = document.getElementById(`extraExpenseAmount-${paycheckNum}`);
  const label = labelEl ? (labelEl.value.trim() || 'Unexpected expense') : 'Unexpected expense';
  const amount = amountEl ? (parseFloat(amountEl.value)||0) : 0;
  if (amount > 0) {
    extraExpenseIdCounter++;
    if (!extraExpenses[paycheckNum]) extraExpenses[paycheckNum] = [];
    extraExpenses[paycheckNum].push({ id: extraExpenseIdCounter, label, amount });
  }
  extraExpenseInputOpenForPaycheck = null;
  calculate();
}

function removeExtraExpense(paycheckNum, expenseId){
  if (extraExpenses[paycheckNum]) {
    const removed = extraExpenses[paycheckNum].find(e => e.id === expenseId);
    extraExpenses[paycheckNum] = extraExpenses[paycheckNum].filter(e => e.id !== expenseId);
    if (extraExpenses[paycheckNum].length === 0) delete extraExpenses[paycheckNum];

    // This expense might be the auto-logged stand-in for a reduced
    // account payment (see updateAccountPayment) rather than a real
    // one-time expense the person added themselves. Deleting it here
    // means "I didn't actually have that expense" — so the payment
    // override it was covering for needs to go too, or the money it
    // freed up would otherwise flow to whichever account is next in the
    // avalanche/snowball line instead of back into the payment it was
    // reduced from.
    if (removed && removed.autoFromCardId !== undefined) {
      const overrideMap = accountPaymentOverrides[removed.autoFromCardId];
      if (overrideMap) delete overrideMap[paycheckNum];
    }
  }
  calculate();
}

// ---- Single consolidated, debounced save ----
const APP_STATE_KEY = 'app-state';
let saveDebounceTimer = null;
let saveInFlight = false;
let saveQueuedAgain = false;

function setStorageStatus(msg){
  const el = document.getElementById('storageStatus');
  if (el) el.textContent = msg;
}

function gatherAppState(){
  const state = {
    cards: cardsData.map(c => ({
      id: c.id, name: c.name,
      balance: c.balance,
      apr: c.apr,
      min: c.min,
      monthlyMinimum: c.monthlyMinimum,
      lastPositiveMonthlyMinimum: c.lastPositiveMonthlyMinimum,
      dueDate: c.dueDate || '',
      debtKind: c.debtKind || 'other',
      payoffHistory: c.payoffHistory || [],
      activelyPaidOff: !!c.activelyPaidOff,
      lifetimeInterestPaid: c.lifetimeInterestPaid || 0,
      cycleStartPaycheck: c.cycleStartPaycheck || 0,
    })),
    cardIdCounter,
    budgetItems: budgetItems.map(item => {
      const el = document.getElementById(`budget_${item.id}`);
      return { id: item.id, label: item.label, amount: el ? (parseFloat(el.value)||0) : item.amount, hint: item.hint, kind: item.kind };
    }),
    budgetItemIdCounter,
    budgetSetupVersion,
    hourlyRate: document.getElementById('hourlyRate').value,
    hoursPerCheck: document.getElementById('hoursPerCheck').value,
    taxSettings: window.BearDenTaxes?.read(),
    appliedBonuses,
    bonusControlsEnabled,
    payoffControlsEnabled,
    savingsGoals: savingsGoals.map(g => ({ id: g.id, name: g.name, goal: g.goal, start: g.start, contribution: g.contribution, withdrawalHistory: g.withdrawalHistory || [] })),
    savingsGoalIdCounter,
    takeHome: document.getElementById('takeHome').value,
    startDate: document.getElementById('startDate').value,
    payoffMethod: currentPayoffMethod,
    debtPaymentSettings: window.debtPaymentSettings || {},
    debtPaymentHistory: window.debtPaymentHistory || {},
    debtInterestHistory: window.debtInterestHistory || {},
    paycheckOverrides,
    savingsContributionOverrides,
    budgetItemOverrides,
    accountPaymentOverrides,
    paycheckSlices,
    paycheckSquashes,
    extraExpenses,
    extraExpenseIdCounter,
    checkedPaychecks,
  };

  loadedState = state;
  return state;
}

function queueSaveAppState(delayMs){
  setStorageStatus('Saving…');
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(performSaveAppState, delayMs || 500);
}

async function performSaveAppState(retrying){
  if (saveInFlight) { saveQueuedAgain = true; return; }
  saveInFlight = true;
  let shouldRetry = false;
  try {
    const state = gatherAppState();
    const result = await storage.set(APP_STATE_KEY, JSON.stringify(state), false);
    setStorageStatus(result ? `Saved ${new Date().toLocaleTimeString()}` : 'Save returned null');
    if (!result) console.error('storage.set(app-state) returned null/falsy', result);
  } catch (e) {
    console.error('storage.set(app-state) threw', e);
    if (!retrying) {
      setStorageStatus('Save hiccup, retrying…');
      shouldRetry = true;
    } else {
      setStorageStatus('Save FAILED: ' + (e && e.message ? e.message : e));
    }
  } finally {
    saveInFlight = false;
  }
  if (shouldRetry) {
    setTimeout(() => performSaveAppState(true), 1200);
    return;
  }
  if (saveQueuedAgain) {
    saveQueuedAgain = false;
    performSaveAppState();
  }
}

async function loadAppState(){
  try {
    const result = await storage.get(APP_STATE_KEY, false);
    if (!result || !result.value) return null;
    const state = JSON.parse(result.value);
    loadedState = state;
    window.debtPaymentSettings = window.BearDenDebtPayments.paymentTiming(state.debtPaymentSettings);
    window.debtPaymentHistory = state.debtPaymentHistory || {};
    window.debtInterestHistory = state.debtInterestHistory || {};

    if (state.cards && state.cards.length) { cardsData = state.cards; cardIdCounter = state.cardIdCounter || cardIdCounter; }
    if (state.budgetItems) { budgetItems = state.budgetItems; budgetItemIdCounter = state.budgetItemIdCounter || budgetItemIdCounter; }
    if (state.appliedBonuses) appliedBonuses = state.appliedBonuses;
    if (state.savingsGoals) { savingsGoals = state.savingsGoals; savingsGoalIdCounter = state.savingsGoalIdCounter || savingsGoalIdCounter; }
    if (state.paycheckOverrides) paycheckOverrides = state.paycheckOverrides;
    if (state.savingsContributionOverrides) savingsContributionOverrides = state.savingsContributionOverrides;
    if (state.budgetItemOverrides) budgetItemOverrides = state.budgetItemOverrides;
    if (state.accountPaymentOverrides) accountPaymentOverrides = state.accountPaymentOverrides;
    if (state.paycheckSlices) paycheckSlices = state.paycheckSlices;
    if (state.paycheckSquashes) paycheckSquashes = state.paycheckSquashes;
    if (state.extraExpenses) { extraExpenses = state.extraExpenses; extraExpenseIdCounter = state.extraExpenseIdCounter || extraExpenseIdCounter; }
    if (state.checkedPaychecks) checkedPaychecks = state.checkedPaychecks;

    setStorageStatus('Loaded saved data from ' + new Date().toLocaleTimeString());
    return state;
  } catch (e) {
    setStorageStatus('Load FAILED: ' + (e && e.message ? e.message : e));
    console.error('loadAppState threw', e);
    return null;
  }
}

// One-time migration from the older multi-key storage scheme, if present.
async function migrateLegacyKeys(){
  const legacy = {};
  const tryGet = async (key) => {
    try {
      const r = await storage.get(key, false);
      return (r && r.value) ? r.value : null;
    } catch (e) { return null; }
  };
  const fullStateRaw = await tryGet('full-state');
  if (fullStateRaw) {
    try { Object.assign(legacy, JSON.parse(fullStateRaw)); } catch (e) {}
  }
  const parsePairs = (raw) => {
    const out = {};
    if (!raw) return out;
    raw.split(',').filter(Boolean).forEach(pair => {
      const [k, v] = pair.split(':');
      if (k && v !== undefined) out[parseInt(k)] = parseFloat(v);
    });
    return out;
  };
  const bonusesRaw = await tryGet('applied-bonuses');
  const paycheckRaw = await tryGet('paycheck-overrides');
  const savingsOverrideRaw = await tryGet('savings-contribution-overrides');
  const checkedRaw = await tryGet('checked-paychecks');
  if (bonusesRaw) legacy.appliedBonuses = parsePairs(bonusesRaw);
  if (paycheckRaw) legacy.paycheckOverrides = parsePairs(paycheckRaw);
  if (checkedRaw) {
    const parsedChecked = {};
    checkedRaw.split(',').filter(Boolean).forEach(n => { parsedChecked[n] = true; });
    legacy.checkedPaychecks = parsedChecked;
  }
  if (Object.keys(legacy).length === 0) return null;

  loadedState = legacy;

  if (legacy.cards && legacy.cards.length) { cardsData = legacy.cards; cardIdCounter = legacy.cardIdCounter || cardIdCounter; }
  if (legacy.budgetItems) { budgetItems = legacy.budgetItems; budgetItemIdCounter = legacy.budgetItemIdCounter || budgetItemIdCounter; }
  if (legacy.appliedBonuses) appliedBonuses = legacy.appliedBonuses;

  // Migrate the old single-goal savings fields into the new multi-goal array.
  if (!legacy.savingsGoals && (legacy.savingsGoal || legacy.savingsStart || legacy.savingsContribution)) {
    savingsGoalIdCounter++;
    const newGoal = {
      id: savingsGoalIdCounter, name: 'Savings',
      goal: parseFloat(legacy.savingsGoal)||0,
      start: parseFloat(legacy.savingsStart)||0,
      contribution: parseFloat(legacy.savingsContribution)||0,
    };
    legacy.savingsGoals = [newGoal];
    if (savingsOverrideRaw) {
      savingsContributionOverrides = { [newGoal.id]: parsePairs(savingsOverrideRaw) };
    }
  }
  if (legacy.savingsGoals) { savingsGoals = legacy.savingsGoals; savingsGoalIdCounter = legacy.savingsGoalIdCounter || savingsGoalIdCounter; }
  if (legacy.paycheckOverrides) paycheckOverrides = legacy.paycheckOverrides;
  if (legacy.checkedPaychecks) checkedPaychecks = legacy.checkedPaychecks;

  setStorageStatus('Migrated data from previous version');
  return legacy;
}

// ---- Per-paycheck edits ----
function updatePaycheckAmount(paycheckNum, value){
  const amt = parseFloat(value);
  if (isNaN(amt) || amt <= 0) {
    delete paycheckOverrides[paycheckNum];
  } else {
    paycheckOverrides[paycheckNum] = amt;
  }
  calculate();
}

function updateSavingsContribution(goalId, paycheckNum, value){
  const amt = parseFloat(value);
  if (!savingsContributionOverrides[goalId]) savingsContributionOverrides[goalId] = {};
  if (isNaN(amt) || amt < 0) {
    delete savingsContributionOverrides[goalId][paycheckNum];
  } else {
    savingsContributionOverrides[goalId][paycheckNum] = amt;
  }
  calculate();
}

// Writes a single edited field (name, goal, start, or contribution) from the
// goal's setup panel straight into savingsGoals — the source of truth that
// calculate() now reads directly — rather than calculate() re-reading it
// back out of this specific <input> element on every recalculation. That
// indirection was the root cause of withdrawals not always sticking: any
// full re-render replaces the hero card's DOM, and calculate() had no
// guarantee the element it looked up a moment later was still "the" live
// one versus a browser quirk restoring a stale value into a freshly
// recreated element with the same id. Writing once, here, avoids that
// entirely.
function updateSavingsGoalField(goalId, field, rawValue){
  const g = savingsGoals.find(x => x.id === goalId);
  if (!g) return;
  if (field === 'name') {
    g.name = rawValue.trim() || g.name;
  } else {
    const num = parseFloat(rawValue);
    g[field] = isNaN(num) ? 0 : num;
  }
  calculate();
}

// Lets the user pull money back out of a savings goal (e.g. an emergency
// expense) without losing track of it. This works by lowering the goal's
// baseline "starting balance" by the withdrawn amount — since every future
// paycheck's saved total is start + contributions, this shifts the whole
// balance (past and future) down by exactly that much while leaving the
// contribution schedule itself untouched. g (the persisted record) is the
// sole source of truth — calculate() now reads g.start directly rather than
// re-reading a DOM input, so there's nothing else to keep in sync. The
// withdrawal is also logged to withdrawalHistory purely so the person has a
// record of when and why.
function withdrawFromSavings(goalId){
  const amtInput = document.getElementById(`sg_withdraw_amt_${goalId}`);
  const noteInput = document.getElementById(`sg_withdraw_note_${goalId}`);
  const errorEl = document.getElementById(`sg_withdraw_error_${goalId}`);

  // Strip anything but digits and a decimal point ($ signs, commas, stray
  // spaces) so a copy-pasted or dollar-prefixed amount still parses —
  // this field is a plain text input specifically so mobile numeric
  // keyboards and locale decimal quirks can't silently blank the value.
  const rawValue = amtInput ? amtInput.value : '';
  const cleaned = rawValue.replace(/[^0-9.]/g, '');
  const amt = parseFloat(cleaned);

  if (isNaN(amt) || amt <= 0) {
    if (errorEl) errorEl.style.display = 'block';
    return;
  }
  if (errorEl) errorEl.style.display = 'none';

  const note = noteInput ? noteInput.value.trim() : '';

  const g = savingsGoals.find(x => x.id === goalId);
  if (!g) return;

  // No floor at 0 here on purpose: "start" is just a baseline offset added
  // to every paycheck's running total, so if a withdrawal exceeds it, the
  // baseline needs to go negative for the math to stay correct — otherwise
  // (as happened before) a withdrawal bigger than the current start simply
  // vanishes with nowhere to go once start is already at 0. A goal that's
  // been withdrawn from more than it's earned will correctly show a
  // negative "saved so far" until contributions catch back up.
  g.start = (g.start||0) - amt;
  if (!g.withdrawalHistory) g.withdrawalHistory = [];
  g.withdrawalHistory.push({ id: Date.now(), date: new Date().toISOString(), amount: amt, note });

  if (amtInput) amtInput.value = '';
  if (noteInput) noteInput.value = '';

  calculate();
}

// Clears a goal's withdrawal history log — this is a record-keeping reset
// only. It does not add the money back to the balance; the withdrawals
// already logged stay baked into the goal's totals, only the list of past
// entries disappears.
function clearSavingsWithdrawalHistory(goalId){
  const g = savingsGoals.find(x => x.id === goalId);
  if (!g) return;
  g.withdrawalHistory = [];
  calculate();
}

// Resets a goal's progress all the way back to square one: starting
// balance goes back to $0, the withdrawal log clears, and any per-paycheck
// contribution overrides drop — so it behaves exactly like a freshly
// created goal. The name, goal amount, and default contribution rate are
// left untouched, since those describe the goal itself rather than
// progress toward it.
function resetSavingsGoal(goalId){
  const g = savingsGoals.find(x => x.id === goalId);
  if (!g) return;
  g.start = 0;
  g.withdrawalHistory = [];
  delete savingsContributionOverrides[goalId];
  calculate();
}

// ---- Income ----
function calcGrossPay(rate, hours){
  return rate * Math.min(hours, 80) + rate * 1.5 * Math.max(0, hours - 80);
}

function updateIncomeEstimateDisplay(){
 const rate=Number(document.getElementById('hourlyRate').value)||0,hours=Number(document.getElementById('hoursPerCheck').value)||0,gross=calcGrossPay(rate,hours),box=document.getElementById('incomeEstimate');let estimate=null,error='';
 try{estimate=window.BearDenTaxes?.estimatePay(gross,window.BearDenTaxes.read());}catch(e){error=e.message;}
 box.style.display=gross>0?'block':'none';
 document.getElementById('useIncomeEstimate').disabled=!(estimate&&estimate.net>0);
 box.innerHTML=gross>0?`Gross: <strong>${money(gross)}</strong>${estimate?` · Estimated take-home: <strong>${money(estimate.net)}</strong><div class="tax-breakdown"><span>Federal <b>${money(estimate.federal)}</b></span><span>Michigan <b>${money(estimate.state)}</b></span><span>Social Security <b>${money(estimate.socialSecurity)}</b></span><span>Medicare <b>${money(estimate.medicare)}</b></span><span>401(k) deduction <b>${money(estimate.retirement)}</b></span><span>Benefits / other deductions <b>${money(estimate.benefits-estimate.retirement+estimate.local)}</b></span></div>`:'<p>'+bdEscape(error||'Choose your state and filing status below.')+'</p>'}`:'';
}
function prepareIncomeForSave(){
 const takeHome=document.getElementById('takeHome');
 if(!takeHome.value.trim()){
  const gross=calcGrossPay(Number(document.getElementById('hourlyRate').value)||0,Number(document.getElementById('hoursPerCheck').value)||0);
  const estimate=window.BearDenTaxes.estimatePay(gross,window.BearDenTaxes.read());
  if(estimate.net>0)takeHome.value=estimate.net.toFixed(2);
 }
 if(!(Number(takeHome.value)>0)||!document.getElementById('startDate').value)throw Error('Enter your first paycheck date and take-home pay, or add your hourly rate and hours for an estimate.');
}
async function saveIncome(button){
 const status=document.getElementById('incomeEditorStatus');status.textContent='';button.disabled=true;
 try{prepareIncomeForSave();await window.flushBearDenState();setIncomePanel(null);document.getElementById('incomeToggleBtn').focus();}
 catch(error){status.textContent=error.message;}finally{button.disabled=false;}
}
async function saveBudget(button){
 const status=document.getElementById('budgetEditorStatus');status.textContent='';button.disabled=true;
 try{await window.flushBearDenState();setIncomePanel(null);document.getElementById('incomeBudgetToggleBtn').focus();}
 catch(error){status.textContent=error.message;}finally{button.disabled=false;}
}

// ---- Reset ----
async function resetAll(){
 await window.classicReady;
 const fresh={cards:[],cardIdCounter:0,budgetItems:starterBudgetItems(),budgetItemIdCounter:3,budgetSetupVersion:2,savingsGoals:[],savingsGoalIdCounter:0,hourlyRate:'',hoursPerCheck:'',takeHome:'',startDate:'',taxSettings:{},bonusControlsEnabled:false,payoffControlsEnabled:false,appliedBonuses:{},paycheckOverrides:{},savingsContributionOverrides:{},budgetItemOverrides:{},accountPaymentOverrides:{},paycheckSlices:{},paycheckSquashes:{},extraExpenses:{},extraExpenseIdCounter:0,checkedPaychecks:{},payoffMethod:'avalanche'};
 clearTimeout(saveDebounceTimer);await window.BearDen.resetSetup(fresh);location.reload();
}

// ---- Main calculation ----
function calculate(isInitialLoad){
  // Balance/APR/min inputs only exist in the DOM while that specific
  // account's detail view is expanded in the Accounts dropdown — for every
  // other (collapsed) account, fall back to the last-known value on
  // cardsData, the source of truth.
  const cards = cardsData.map((c)=>{
    const balEl = document.getElementById(`bal_${c.id}`);
    const aprEl = document.getElementById(`apr_${c.id}`);
    const minEl = document.getElementById(`monthlyMin_${c.id}`);
    return {
      id: c.id,
      name: c.name,
      dueDate: c.dueDate || '',
      balance: balEl ? (parseFloat(balEl.value)||0) : c.balance,
      apr: (aprEl ? (parseFloat(aprEl.value)||0) : c.apr)/100,
      ...(minEl&&Number(minEl.value)!==window.BearDenDebtPayments.monthlyMinimum(c)
        ?window.BearDenDebtPayments.monthlyPaymentSettings(c,Number(minEl.value)||0)
        :{min:c.min,monthlyMinimum:c.monthlyMinimum}),
    };
  });
  // Persist any live edits back into cardsData so they survive after the
  // account's detail view closes and its inputs leave the DOM.
  cardsData.forEach((c, idx) => {
    c.balance = cards[idx].balance;
    c.apr = cards[idx].apr * 100;
    c.min = cards[idx].min;
    c.monthlyMinimum = cards[idx].monthlyMinimum;
  });

  const takeHome = parseFloat(document.getElementById('takeHome').value)||0;
  const budgetItemsSnapshot = budgetItems.map(item => {
    const el = document.getElementById(`budget_${item.id}`);
    return { id: item.id, label: item.label, amount: el ? (parseFloat(el.value)||0) : item.amount };
  });

  function project(withoutPayoffActions=false){
  const startDateVal = document.getElementById('startDate').value;
  let date = startDateVal ? new Date(startDateVal + 'T00:00:00') : new Date();

  let balances = cards.map(c => c.balance);
  // Rates are resolved for each future paycheck below.
  const mins = cards.map(c => c.min);
  const paidOffAt = new Array(cards.length).fill(null);
  let prevTotal = balances.reduce((a,b)=>a+b,0);

  const payoffMethod = currentPayoffMethod;

  const savingsEnabled = savingsGoals.length > 0;
  // Note: unlike cardsData above, savingsGoals fields are NOT re-read from
  // the DOM here. Each input writes straight to savingsGoals via
  // updateSavingsGoalField on change (and withdrawFromSavings writes to it
  // directly too), so savingsGoals is always the single source of truth —
  // this avoids relying on a specific <input> element still being the
  // "live" one a moment later, which browsers don't always guarantee
  // across a DOM rebuild.
  const goalsCalc = savingsGoals.map(g => {
    const alreadyThere = savingsEnabled && g.goal > 0 && g.goal <= g.start;
    return {
      id: g.id, name: g.name, goal: g.goal, start: g.start, contribution: g.contribution,
      running: g.start,
      withdrawalHistory: g.withdrawalHistory || [],
      reachedDate: alreadyThere ? (startDateVal ? new Date(startDateVal+'T00:00:00') : new Date()) : null,
      reachedPaycheck: alreadyThere ? 0 : null,
    };
  });

  const syncedApplied=new Set();
  const schedule = [];
  let totalInterest = 0;
  let paycheck = 0;
  const maxPaychecks = 780; // 30 years of biweekly checks — a generous ceiling, not a realistic target

  const todayForSchedule=new Date();todayForSchedule.setHours(0,0,0,0);
  const currentPaycheck=Math.max(1,Math.floor((todayForSchedule-date)/86400000/14)+1);
  const incomeHorizon=startDateVal&&takeHome>0?Math.min(maxPaychecks,Math.max(26,currentPaycheck+25,...Object.keys(checkedPaychecks).filter(n=>checkedPaychecks[n]).map(n=>Number(n)+2))):0;
  const anyGoalStillTracking = () => savingsEnabled && goalsCalc.some(g => g.reachedDate === null && g.goal > 0);
  let debtFreeDate = null;
  let debtFreePaycheck = null;

  const carPayoffDate=(window.carDebtForecast||[]).map(l=>l.payoffDate).filter(Boolean).sort().at(-1);
  const carPayoffHorizon=carPayoffDate?new Date(carPayoffDate+'T00:00:00'):null;
  while ((paycheck < incomeHorizon || carPayoffHorizon&&date<=carPayoffHorizon || balances.reduce((a,b)=>a+b,0) > 0.01 || anyGoalStillTracking()) && paycheck < maxPaychecks) {
    paycheck++;
    const thisCheckTakeHome = paycheckOverrides[paycheck] !== undefined ? paycheckOverrides[paycheck] : takeHome;
    const bonusThisCheck = appliedBonuses[paycheck] || 0;

    // Budget line items are editable per paycheck — most checks just use the
    // default amount, but any can be overridden for that one check.
    let expensesThisCheck = 0;
    const budgetLineItemsThisCheck = budgetItemsSnapshot.map(item => {
      const overrideMap = budgetItemOverrides[item.id] || {};
      const amt = overrideMap[paycheck] !== undefined ? overrideMap[paycheck] : item.amount;
      expensesThisCheck += amt;
      return { id: item.id, label: item.label, amount: amt, isOverridden: overrideMap[paycheck] !== undefined };
    });

    const dateKey=date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
    // Rebase only future, unchecked rows; historical checkoffs retain their original math.
    let rebased=false;
    cards.forEach((card,i)=>{const snapshot=window.syncedDebtBalances?.[card.id];if(snapshot&&!syncedApplied.has(card.id)&&dateKey>=snapshot.date&&!checkedPaychecks[paycheck]){balances[i]=snapshot.balance/100;paidOffAt[i]=null;syncedApplied.add(card.id);rebased=true;}});
    if(rebased){prevTotal=balances.reduce((a,b)=>a+b,0);debtFreeDate=null;debtFreePaycheck=null;}
    const accountBillsThisCheck=window.accountBillsForPaycheck?.(dateKey,paycheck)||[];
    expensesThisCheck+=accountBillsThisCheck.reduce((sum,bill)=>sum+bill.amount/100,0);

    // One-time unexpected expenses only apply to the specific paycheck they
    // were added to — they don't recur like regular budget items.
    const squashed=cards.map((card,i)=>!withoutPayoffActions&&!!paycheckSquashes[paycheck]?.[card.id]&&balances[i]>0.005);
    const sliced=cards.map((card,i)=>!withoutPayoffActions&&!squashed[i]&&!!paycheckSlices[paycheck]?.[card.id]&&balances[i]>0.005);
    const sliceMode=sliced.some(Boolean)||squashed.some(Boolean);
    const extrasThisCheck = (extraExpenses[paycheck] || []).filter(e=>!sliceMode||e.autoFromCardId==null);
    const extrasTotal = extrasThisCheck.reduce((a,e)=>a+e.amount, 0);

    let avail = thisCheckTakeHome - expensesThisCheck - extrasTotal + bonusThisCheck;
    avail = Math.max(0, avail);

    let totalContribThisCheck = 0;
    const savingsByGoal = [];
    goalsCalc.forEach(g => {
      const overrideMap = savingsContributionOverrides[g.id] || {};
      const contrib = savingsEnabled ? (overrideMap[paycheck] !== undefined ? overrideMap[paycheck] : g.contribution) : 0;
      totalContribThisCheck += contrib;
      savingsByGoal.push({ id: g.id, name: g.name, contribution: contrib, isOverridden: overrideMap[paycheck] !== undefined, balance: 0 });
    });

    const availAfterSavings = Math.max(0, avail - totalContribThisCheck);

    goalsCalc.forEach((g, gi) => {
      if (savingsEnabled) {
        g.running += savingsByGoal[gi].contribution;
        if (g.reachedDate === null && g.goal > 0 && g.running >= g.goal) {
          g.reachedDate = new Date(date);
          g.reachedPaycheck = paycheck;
        }
      }
      savingsByGoal[gi].balance = g.running;
    });

    const payday=date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
    const effective=cards.map(c=>window.BearDenDebtPayments.effectiveDebtTerms({...c,apr:c.apr*100},window.syncedDebtTerms?.[c.id],payday,!!checkedPaychecks[paycheck]));
    const aprs=effective.map(c=>c.apr/100);
    const interest = balances.map((b,i) => {
      const recorded=checkedPaychecks[paycheck]&&window.debtInterestHistory?.[paycheck]?.[cards[i].id];
      return Number.isFinite(recorded)?recorded:b*aprs[i]/26;
    });
    const interestThisCheck = interest.reduce((a,b)=>a+b, 0);
    interest.forEach(v => totalInterest += v);

    const timing=effective.map(c=>window.BearDenDebtPayments.scheduledPayment(c,payday,startDateVal||payday,window.debtPaymentSettings));
    const minApplied = balances.map((b,i) => b <= 0 ? 0 : Math.min(timing[i].minimum, b + interest[i]));
    // A payoff action replaces automatic extra payments and old manual payment
    // adjustments. Reserve real spending, savings and every other debt first.
    const realExtras=(extraExpenses[paycheck]||[]).filter(e=>e.autoFromCardId==null).reduce((sum,e)=>sum+e.amount,0);
    const payoffActionFunds=Math.max(0,thisCheckTakeHome+bonusThisCheck-expensesThisCheck-realExtras-totalContribThisCheck);
    const payoffActionPayments=cards.map((card,i)=>squashed[i]?payoffActionPayment(balances[i],interest[i],minApplied[i],'squash'):sliced[i]?payoffActionPayment(balances[i],interest[i],minApplied[i],'slice'):minApplied[i]);
    const payoffActionShortfall=Math.max(0,Math.round(payoffActionPayments.reduce((sum,n)=>sum+n,0)*100)-Math.round(payoffActionFunds*100))/100;
    // Keep recorded history intact. Upcoming actions remain selected but pause
    // at minimums when refreshed balances or budget edits make them unaffordable.
    const payoffActionsPaused=sliceMode&&payoffActionShortfall>0&&!checkedPaychecks[paycheck];


    // A manually logged payment for this account/check (e.g. "I actually
    // paid more/less than planned") takes over that account's payment
    // entirely for this check — it's excluded from the normal min-payment
    // + avalanche/snowball-extra allocation below, and the money it
    // consumes is set aside first so the remaining leftover only gets
    // divided up among accounts that are still on the projected plan.
    const overridePayment = cards.map((c,i) => {
      const recorded=checkedPaychecks[paycheck]&&window.debtPaymentHistory?.[paycheck]?.[c.id];
      if(Number.isFinite(recorded))return Math.max(0,recorded);
      if(payoffActionsPaused)return null;
      if(squashed[i]||sliced[i])return payoffActionPayments[i];
      if(sliceMode)return null;
      const overrideMap = accountPaymentOverrides[c.id] || {};
      const ov = overrideMap[paycheck];
      return ov !== undefined ? Math.max(0, ov) : null;
    });

    const committedTotal = cards.reduce((sum, c, i) => {
      return sum + (overridePayment[i] !== null ? overridePayment[i] : minApplied[i]);
    }, 0);
    let leftover = Math.max(0, availAfterSavings - committedTotal);

    const priorityOrder = cards.map((c,i)=>i).sort((a,b) => {
      if (payoffMethod === 'snowball') {
        return balances[a] - balances[b];
      }
      return aprs[b] - aprs[a];
    });

    const extra = new Array(cards.length).fill(0);
    for (const i of sliceMode||payoffMethod==='minimum'?[]:priorityOrder) {
      if (overridePayment[i] !== null) continue; // this account's payment is already fixed by the manual override
      if (balances[i] <= 0 || !timing[i].scheduled) continue;
      const remainingAfterMin = Math.max(0, balances[i] + interest[i] - minApplied[i]);
      const e = Math.min(leftover, remainingAfterMin);
      extra[i] = e;
      leftover -= e;
    }

    // "Natural" payment per account: what avalanche/snowball would assign
    // THIS account this check if it alone had no override, while still
    // honoring every OTHER account's current override as fixed. This is
    // the baseline a reduced payment gets measured against when turning
    // the shortfall into an automatic one-time expense (see
    // updateAccountPayment) — recomputing it fresh from scratch each time,
    // rather than comparing against whatever was last on screen, means
    // repeated edits to the same account/check always land on the true
    // total shortfall instead of stacking up incremental deltas.
    //
    // Crucially, each account's own baseline also excludes its OWN
    // previously auto-logged shortfall expense (if any) from the budget
    // math — that expense only exists because of an earlier edit to this
    // same account, so leaving it in would shrink the available budget
    // and make the baseline drift downward on every subsequent edit.
    // Other accounts' auto-expenses (and any real manual ones) still
    // count against the pool as normal.
    const naturalPayments = cards.map((c, i) => {
      if(sliceMode||payoffMethod==='minimum'||!timing[i].scheduled)return minApplied[i];
      const ownAutoExpense = extrasThisCheck.find(e => e.autoFromCardId === c.id);
      const ownAutoAmount = ownAutoExpense ? ownAutoExpense.amount : 0;
      let availExclOwn = thisCheckTakeHome - expensesThisCheck - (extrasTotal - ownAutoAmount) + bonusThisCheck;
      availExclOwn = Math.max(0, availExclOwn);
      const availAfterSavingsExclOwn = Math.max(0, availExclOwn - totalContribThisCheck);

      const committedExcludingI = cards.reduce((sum, cc, j) => {
        if (j === i) return sum + minApplied[j];
        return sum + (overridePayment[j] !== null ? overridePayment[j] : minApplied[j]);
      }, 0);
      let loExcludingI = Math.max(0, availAfterSavingsExclOwn - committedExcludingI);
      let extraForI = 0;
      for (const j of priorityOrder) {
        if(!timing[j].scheduled)continue;
        if (j === i) {
          if (balances[j] > 0) {
            const remainingAfterMin = Math.max(0, balances[j] + interest[j] - minApplied[j]);
            extraForI = Math.min(loExcludingI, remainingAfterMin);
          }
          break; // only need to reach i's own turn in priority order
        }
        if (overridePayment[j] !== null) continue; // fixed, doesn't draw from the leftover pool
        if (balances[j] <= 0) continue;
        const remainingAfterMinJ = Math.max(0, balances[j] + interest[j] - minApplied[j]);
        loExcludingI -= Math.min(loExcludingI, remainingAfterMinJ);
      }
      return minApplied[i] + extraForI;
    });

    const payments = [];
    const newBalances = [];
    for (let i = 0; i < cards.length; i++) {
      const payment = overridePayment[i] !== null ? overridePayment[i] : (minApplied[i] + extra[i]);
      const newBal = Math.max(0, balances[i] + interest[i] - payment);
      payments.push(payment);
      newBalances.push(newBal);
      if (balances[i] > 0 && newBal <= 0.005 && paidOffAt[i] === null) {
        paidOffAt[i] = paycheck;
      }
    }

    const newTotal = newBalances.reduce((a,b)=>a+b,0);

    schedule.push({
      paycheck, date: new Date(date), avail,
      balancesBefore:balances.slice(),sliced,squashed,sliceMode,
      debtTiming:timing,minimumPayments:minApplied.slice(),payoffActionFunds,payoffActionPayments,payoffActionShortfall,payoffActionsPaused,
      cashAfterDebt:availAfterSavings-payments.reduce((sum,n)=>sum+n,0),
      takeHomeThisCheck: thisCheckTakeHome,
      isOverridden: paycheckOverrides[paycheck] !== undefined,
      isBonus: bonusThisCheck > 0,
      bonusAmount: bonusThisCheck,
      budgetLineItemsThisCheck,
      accountBillsThisCheck,
      budgetShortfall:Math.max(0,expensesThisCheck+extrasTotal-thisCheckTakeHome-bonusThisCheck),
      extrasThisCheck,
      savingsByGoal,
      availAfterSavings,
      debtReduction: prevTotal - newTotal,
      interestThisCheck,
      interestByAccount: interest.slice(),
      payments: payments.slice(),
      naturalPayments,
      paymentOverridden: overridePayment.map(v => !sliceMode&&v !== null),
      balancesAfter: newBalances.slice(),
      total: newTotal,
    });

    prevTotal = newTotal;

    if (debtFreeDate === null && newTotal <= 0.01) {
      debtFreeDate = new Date(date);
      debtFreePaycheck = paycheck;
    }

    balances = newBalances;
    date.setDate(date.getDate() + 14);
  }

  const goalsInfo = savingsEnabled ? goalsCalc.map(g => ({
    id: g.id, name: g.name, goal: g.goal, start: g.start, contribution: g.contribution,
    reachedDate: g.reachedDate, reachedPaycheck: g.reachedPaycheck, withdrawalHistory: g.withdrawalHistory,
  })) : [];

  return {schedule,totalInterest,savingsEnabled,goalsInfo,debtFreeDate,debtFreePaycheck};
  }
  const {schedule,totalInterest,savingsEnabled,goalsInfo,debtFreeDate,debtFreePaycheck}=project();
  let sliceComparison=null;
  if(schedule.some(row=>row.sliceMode)&&!schedule.some(row=>row.payoffActionsPaused)){
    const baseline=project(true);
    if(debtFreeDate){const comparedInterest=baseline.debtFreeDate?baseline.totalInterest:baseline.schedule.filter(row=>row.date<=debtFreeDate).reduce((sum,row)=>sum+row.interestThisCheck,0);sliceComparison={difference:comparedInterest-totalInterest,through:baseline.debtFreeDate?null:debtFreeDate,actions:[schedule.some(row=>row.sliced.some(Boolean))?'Slice':'',schedule.some(row=>row.squashed.some(Boolean))?'Squash':''].filter(Boolean).join(' and ')};}
  }
  renderResults(cards, schedule, totalInterest, savingsEnabled, goalsInfo, debtFreeDate, debtFreePaycheck, budgetItemsSnapshot, sliceComparison);
  queueSaveAppState(isInitialLoad ? 1500 : 500);
  window.dispatchEvent(new Event('bearden-plan-changed'));
}

function fmtDate(d){
  return d.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'});
}

function daysCounterText(targetDate){
  const now = new Date();
  now.setHours(0,0,0,0);
  const target = new Date(targetDate);
  target.setHours(0,0,0,0);
  const days = Math.round((target - now) / (1000*60*60*24));
  if (days <= 0) return 'Today';
  if (days === 1) return '1 day to go';
  return `${days} days to go`;
}

// Counts remaining paychecks to a target milestone (debt-free, or a savings
// goal reached), based on which paychecks have actually been checked off —
// so it reflects real progress, not just the original projected schedule.
function paychecksCounterText(targetPaycheck){
  if (targetPaycheck === null || targetPaycheck === undefined) return '';
  const checkedNums = Object.keys(checkedPaychecks).filter(k => checkedPaychecks[k]).map(Number);
  const maxChecked = checkedNums.length ? Math.max(...checkedNums) : 0;
  const remaining = targetPaycheck - maxChecked;
  if (remaining <= 0) return 'This paycheck 💰';
  if (remaining === 1) return '1 paycheck to go';
  return `${remaining} paychecks to go`;
}

function toggleAddBox(id){
  const el = document.getElementById(id);
  if (!el) return;
  if (el.classList.contains('open')) {
    closeSlidingDropdown(el);
  } else {
    openSlidingDropdown(el);
  }
}

// Configuration panels live in their own tabs; opening one closes another.
const HERO_DROPDOWN_IDS = ['incomeDropdown', 'budgetDropdown', 'debtBreakdownDropdown'];
const HERO_DROPDOWN_BUTTONS = {
  incomeDropdown: [{ btnId: 'incomeToggleBtn', label: 'Income' }],
  budgetDropdown: [{ btnId: 'incomeBudgetToggleBtn', label: 'Budget' }],
};

const HERO_SLIDE_TRANSITION_MS = 600;
let heroSlideHideTimers = {};
let heroSlideAutoTimers = {};

// Rather than relying on a guessed CSS max-height cap (which clips any
// content taller than that guess — e.g. a long paycheck schedule), this
// measures the element's real content height and animates to that exact
// pixel value, then relaxes to max-height:none once open so it can keep
// growing/shrinking with its content (checking off paychecks, adding
// notebook pages, etc.) without ever getting cut off again.
function openSlidingDropdown(el){
  clearTimeout(heroSlideHideTimers[el.id]);
  clearTimeout(heroSlideAutoTimers[el.id]);
  el.style.display = 'block';
  el.style.maxHeight = '0px';
  // Force a layout flush so the browser registers the closed (max-height:0)
  // state before we jump to the real target height — otherwise it snaps
  // straight to open with no animation.
  void el.offsetHeight;
  el.classList.add('open');
  el.style.maxHeight = el.scrollHeight + 'px';
  heroSlideAutoTimers[el.id] = setTimeout(() => {
    if (el.classList.contains('open')) el.style.maxHeight = 'none';
  }, HERO_SLIDE_TRANSITION_MS);
}

function closeSlidingDropdown(el){
  clearTimeout(heroSlideAutoTimers[el.id]);
  // If it was sitting at max-height:none (fully open), pin it back to its
  // current real pixel height first so there's an actual number to
  // transition from — you can't animate max-height from "none".
  el.style.maxHeight = el.scrollHeight + 'px';
  void el.offsetHeight;
  el.classList.remove('open');
  el.style.maxHeight = '0px';
  clearTimeout(heroSlideHideTimers[el.id]);
  heroSlideHideTimers[el.id] = setTimeout(() => { el.style.display = 'none'; }, HERO_SLIDE_TRANSITION_MS);
}

function toggleHeroDropdown(id){
  const target = document.getElementById(id);
  if (!target) return;
  const wasOpen = target.classList.contains('open');

  HERO_DROPDOWN_IDS.forEach(did => {
    const el = document.getElementById(did);
    if (el) closeSlidingDropdown(el);
    for (const meta of HERO_DROPDOWN_BUTTONS[did] || []) {
      const btn = document.getElementById(meta.btnId);
      if (btn) { btn.textContent = meta.label; btn.setAttribute('aria-expanded', 'false'); }
    }
  });

  if (!wasOpen) {
    openSlidingDropdown(target);
    for (const meta of HERO_DROPDOWN_BUTTONS[id] || []) {
      const btn = document.getElementById(meta.btnId);
      if (btn && btn.closest('.tab-page') === target.closest('.tab-page')) {
        btn.textContent = 'Close'; btn.setAttribute('aria-expanded', 'true');
      }
    }
  }
}

// Tapping the small pie on the Debt Tracker card expands a bigger pie right
// below it, broken down by account instead of just overall % paid off.
function toggleDebtBreakdown(){ toggleHeroDropdown('debtBreakdownDropdown'); }

// How To is a simple inline dropdown at the bottom of the page — no
// panel-switching involved, it just expands/collapses in place.
function toggleHowToDropdown(){
  const panel = document.getElementById('howToDropdown');
  const btn = document.getElementById('howToToggleBtn');
  const isOpen = panel.style.display === 'block';
  panel.style.display = isOpen ? 'none' : 'block';
  if (btn) btn.textContent = isOpen ? '📖 How To' : '📖 Hide';
}

// Notes: a simple bear-themed notebook, collapsed by default just like
// Games. Text autosaves (debounced) to the same storage wrapper everything
// else uses, so it persists across visits the same way the high scores do.
// Slides open/closed the same way the Income/Budget/Accounts dropdowns do.
function toggleNotesSection(){
  const panel = document.getElementById('notesSection');
  const btn = document.getElementById('notesToggleBtn');
  const isOpen = panel.classList.contains('open');
  if (isOpen) {
    closeSlidingDropdown(panel);
  } else {
    openSlidingDropdown(panel);
  }
  if (btn) btn.textContent = isOpen ? '📝 Notepad' : '📝 Hide Notepad';
}

let notesSaveTimer = null;
let notesData = [];   // array of page strings, one per notebook page
let notesIndex = 0;   // which page is currently showing in the textarea

// Typing just updates the in-memory page and (debounced) saves the whole
// notesData array back to storage as JSON — same debounce pattern as the
// old single-note version had.
function onNotesInput(){
  const ta = document.getElementById('notesTextarea');
  if (!ta) return;
  notesData[notesIndex] = ta.value;
  clearTimeout(notesSaveTimer);
  notesSaveTimer = setTimeout(persistNotes, 500);
}

function persistNotes(){
  storage.set('notes', JSON.stringify(notesData)).then(() => {
    const ind = document.getElementById('notesSaveIndicator');
    if (!ind) return;
    ind.classList.add('show');
    setTimeout(() => ind.classList.remove('show'), 1200);
  }).catch(() => {});
}

// Redraws the textarea + page indicator/nav buttons for whatever page
// notesIndex currently points at.
function renderNotePage(){
  const ta = document.getElementById('notesTextarea');
  if (!ta) return;
  ta.value = notesData[notesIndex] || '';
  const indicator = document.getElementById('notesPageIndicator');
  if (indicator) indicator.textContent = (notesIndex + 1) + ' / ' + notesData.length;
  const prevBtn = document.getElementById('notesPrevBtn');
  const nextBtn = document.getElementById('notesNextBtn');
  if (prevBtn) prevBtn.disabled = notesIndex === 0;
  if (nextBtn) nextBtn.disabled = notesIndex === notesData.length - 1;
  const delBtn = document.getElementById('notesDeleteBtn');
  if (delBtn) delBtn.style.display = notesData.length > 1 ? 'block' : 'none';
}

function flipNotePage(delta){
  const next = notesIndex + delta;
  if (next < 0 || next >= notesData.length) return;
  notesIndex = next;
  renderNotePage();
}

function addNotePage(){
  notesData.push('');
  notesIndex = notesData.length - 1;
  renderNotePage();
  persistNotes();
}

function deleteNotePage(){
  if (notesData.length <= 1) return;
  notesData.splice(notesIndex, 1);
  notesIndex = Math.min(notesIndex, notesData.length - 1);
  renderNotePage();
  persistNotes();
}

// Loads saved pages on startup. Transparently migrates the old
// single-note format (a plain string, not JSON) into a one-page array
// the first time someone opens Notes after this update.
async function setupNotes(){
  const ta = document.getElementById('notesTextarea');
  if (!ta) return;
  try {
    const res = await storage.get('notes');
    if (res && res.value) {
      let parsed = null;
      try { parsed = JSON.parse(res.value); } catch (e) {}
      if (Array.isArray(parsed) && parsed.length) {
        notesData = parsed;
      } else if (typeof res.value === 'string' && res.value.trim()) {
        notesData = [res.value];
      }
    }
  } catch (e) {}
  if (!notesData.length) notesData = [''];
  notesIndex = 0;
  renderNotePage();
}

// Games (Bear Run + Bear Crush) start collapsed so the page opens focused
// on the budget itself rather than the bonus games — same simple
// expand/collapse as How To. Since the games section is display:none at
// page load, the runner game's very first canvas resize() (done during
// setup) measures a zero-width box; re-running it here once the section
// actually becomes visible corrects the canvas to the real card width.
// Games (Bear Run + Bear Crush) start collapsed so the page opens focused
// on the budget itself rather than the bonus games — slides open/closed
// the same way the Income/Budget/Accounts dropdowns do. Since the games
// section starts with max-height:0, the runner game's very first canvas
// resize() (done during setup) measures a zero-width box; re-running it
// here once the section starts opening corrects the canvas to the real
// card width.
// Games (Bear Run + Bear Crush + Bear Quest) start collapsed so the page
// opens focused on the budget itself rather than the bonus games — slides
// open/closed the same way the Income/Budget/Accounts dropdowns do. Since
// the games section starts with max-height:0, each canvas game's very
// first resize() (done during setup) measures a zero-width box;
// re-running it here once the section starts opening corrects the
// canvases to the real card width.
function toggleGamesSection(){
  const panel = document.getElementById('gamesSection');
  const btn = document.getElementById('gamesToggleBtn');
  const isOpen = panel.classList.contains('open');
  if (isOpen) {
    closeSlidingDropdown(panel);
  } else {
    openSlidingDropdown(panel);
  }
  if (btn) btn.textContent = isOpen ? '🎮 Show Games' : '🎮 Hide Games';
  if (!isOpen) {
    requestAnimationFrame(() => {
      if (window.bearRunnerRefreshSize) window.bearRunnerRefreshSize();
      if (window.bearQuestRefreshSize) window.bearQuestRefreshSize();
      if (window.bearCatchRefreshSize) window.bearCatchRefreshSize();
    });
  }
}

// The theme attribute selects one shared palette. Remove legacy inline colors
// so page backgrounds always match the active CSS theme, including after reload.
function applyThemeBackground(){
  document.documentElement.style.removeProperty('background-color');
  if (document.body) document.body.style.removeProperty('background-color');
}

function applyThemeButtonIcon(){
  const btn = document.getElementById('themeToggleBtn');
  if (!btn) return;
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  // Shows the icon for what tapping it switches TO, not the current state.
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(isDark?'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>':'<path d="M20.8 13A8.8 8.8 0 0 1 11 3.2 9 9 0 1 0 20.8 13Z"/>')+'</svg>';
  btn.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
  btn.setAttribute('aria-label',btn.title);
}

function toggleTheme(){
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
  applyThemeBackground(!isDark);
  try { localStorage.setItem('bearden:classic:theme', isDark ? 'light' : 'dark'); } catch (e) {}
  applyThemeButtonIcon();
}

// Holiday bear themes (Christmas Santa hats / Halloween fangs+wings),
// independent of light/dark mode. Persisted the same direct-localStorage
// way as the light/dark toggle above.
function applyHolidayMenuState(){
  const current = document.documentElement.getAttribute('data-holiday') || 'standard';
  ['christmas', 'halloween', 'standard'].forEach(key => {
    const el = document.getElementById('holidayItem' + key[0].toUpperCase() + key.slice(1));
    if (el) el.classList.toggle('active', key === current);
  });
}

function toggleHolidayMenu(){
  const menu = document.getElementById('holidayMenu');
  if (menu) menu.classList.toggle('open');
}

function setHolidayTheme(theme){
  if (theme === 'christmas' || theme === 'halloween') {
    document.documentElement.setAttribute('data-holiday', theme);
  } else {
    document.documentElement.removeAttribute('data-holiday');
  }
  try { localStorage.setItem('bearden:classic:holiday', theme); } catch (e) {}
  applyHolidayMenuState();
  if (window.bearRunnerOnHolidayChange) window.bearRunnerOnHolidayChange();
  if (window.bearCrushOnHolidayChange) window.bearCrushOnHolidayChange();
  if (window.bearQuestOnHolidayChange) window.bearQuestOnHolidayChange();
  if (window.bearCatchOnHolidayChange) window.bearCatchOnHolidayChange();
  const menu = document.getElementById('holidayMenu');
  if (menu) menu.classList.remove('open');
}

document.addEventListener('click', (e) => {
  const wrap = document.querySelector('.theme-menu-wrap');
  const menu = document.getElementById('holidayMenu');
  if (wrap && menu && menu.classList.contains('open') && !wrap.contains(e.target)) {
    menu.classList.remove('open');
  }
});

// Income tools share a single open panel, including transaction drilldowns.
function setIncomePanel(id){
 for(const [panelId,buttonId,label] of [['incomeDropdown','incomeToggleBtn','Income'],['budgetDropdown','incomeBudgetToggleBtn','Budget'],['bankActivityCard','incomeTransactionsToggleBtn','Transactions']]){
  const panel=document.getElementById(panelId),button=document.getElementById(buttonId),open=panelId===id;
  panel.hidden=!open;
  if(panelId!=='bankActivityCard'){
   if(open)openSlidingDropdown(panel);
   else{clearTimeout(heroSlideHideTimers[panelId]);clearTimeout(heroSlideAutoTimers[panelId]);panel.classList.remove('open');panel.style.display='none';panel.style.maxHeight='0px';}
  }
  button.textContent=open?'Close':label;button.setAttribute('aria-expanded',String(open));
 }
}
function toggleIncomePanel(){setIncomePanel(document.getElementById('incomeDropdown').classList.contains('open')?null:'incomeDropdown');}
function toggleBudgetPanel(){setIncomePanel(document.getElementById('budgetDropdown').classList.contains('open')?null:'budgetDropdown');}

function updatePayoffMethodExplain(){
  const avalancheBtn = document.getElementById('pmBtnAvalanche');
  const snowballBtn = document.getElementById('pmBtnSnowball');
  if (avalancheBtn) avalancheBtn.classList.toggle('active', currentPayoffMethod === 'avalanche');
  if (snowballBtn) snowballBtn.classList.toggle('active', currentPayoffMethod === 'snowball');
  const minimumBtn=document.getElementById('pmBtnMinimum');if(minimumBtn)minimumBtn.classList.toggle('active',currentPayoffMethod==='minimum');
  for(const [method,button]of [['avalanche',avalancheBtn],['snowball',snowballBtn],['minimum',minimumBtn]])button?.setAttribute('aria-pressed',String(currentPayoffMethod===method));
}

function setPayoffMethod(method){
  if(!['avalanche','snowball','minimum'].includes(method))return;
  currentPayoffMethod = method;
  updatePayoffMethodExplain();
  calculate();
}

function startTrackingSavings(){
  addSavingsGoal(); // creates the first goal and calls calculate() itself
}

// ---- Hero progress ----
let lastSchedule = [];
let lastSavingsGoalsInfo = [];
let lastStartTotal = 0;
let lastCardsForSpending = [];
let lastDebtSpending = [];
let scheduleExpanded = false; // whether the full schedule (beyond the next upcoming paycheck) is shown

function toggleScheduleExpanded(){
  scheduleExpanded = !scheduleExpanded;
  const rest = document.getElementById('scheduleRestOut');
  const btn = document.getElementById('scheduleExpandBtn');
  if (rest) {
    const restCount = rest.children.length;
    if (scheduleExpanded) {
      openSlidingDropdown(rest);
    } else {
      closeSlidingDropdown(rest);
    }
    if (btn) btn.textContent = scheduleExpanded ? '▴ Hide full schedule' : `▾ Show full schedule (${restCount} more)`;
  }
}
let currentDetailAccountIdx = null; // which debt account's detail view is showing inside the Spending panel
let paymentHistoryExpanded = false; // whether the History section is expanded in the currently-open account detail
let paymentHistoryShowAll = false; // whether the Payment History subsection shows every payment vs. just the last 2

function renderSpendingTrackerWithFade(){
  const container = document.getElementById('spendingTrackerContent');
  if (!container) { renderSpendingTracker(); return; }
  container.style.opacity = '0';
  setTimeout(() => {
    renderSpendingTracker();
    container.style.opacity = '1';
  }, 220);
}

function openAccountDetail(idx){
  currentDetailAccountIdx = idx;
  paymentHistoryExpanded = false;
  paymentHistoryShowAll = false;
  renderSpendingTrackerWithFade();
}

function closeAccountDetail(){
  currentDetailAccountIdx = null;
  paymentHistoryExpanded = false;
  paymentHistoryShowAll = false;
  renderSpendingTrackerWithFade();
}

function togglePaymentHistoryDetail(id){
  paymentHistoryExpanded = !paymentHistoryExpanded;
  paymentHistoryShowAll = false;
  const el = document.getElementById('accountHistoryContent-' + id);
  const btn = document.getElementById('historyToggleBtn-' + id);
  if (el) {
    if (paymentHistoryExpanded) openSlidingDropdown(el);
    else closeSlidingDropdown(el);
  }
  if (btn) btn.textContent = paymentHistoryExpanded ? '▾ Hide History' : '📜 History';
}

function togglePaymentHistoryShowAll(){
  paymentHistoryShowAll = !paymentHistoryShowAll;
  renderSpendingTracker();
}

function buildAccountDetailHTML(d, idx){
  const bankPayments=window.getDebtBankPaymentHistory?.(d.id)||[];
  const bankHistory=bankPayments.length?`<div class="history-section-title">Bank payment history</div><p class="subtle">${bankPayments.length} posted payments · ${money(bankPayments.reduce((sum,t)=>sum+t.amount,0))}</p><div class="linked-payment-list">${bankPayments.map(t=>`<div class="spend-item-numbers"><span>${bdEscape(t.name)}<small style="display:block;color:var(--muted)">${fmtDate(new Date(t.date+'T12:00:00'))}</small></span><span>${money(t.amount)}</span></div>`).join('')}</div><hr class="history-section-divider">`:'';
  const total = d.paid + Math.max(0, d.remaining);
  const pct = d.isComplete ? 100 : (total > 0 ? Math.min(100, (d.paid / total) * 100) : 0);
  const wasEverPaidOff = d.payoffHistory && d.payoffHistory.length > 0;
  const isReopened = !d.isComplete && wasEverPaidOff;
  // Translucent white badges (rather than the usual solid colors) so they
  // stand out against the banner's gradient instead of blending into it.
  const badge = d.isComplete
    ? `<span class="spend-item-badge" style="background:rgba(255,255,255,0.28);color:#fff;">✓ Paid Off</span>`
    : (isReopened ? `<span class="spend-item-badge" style="background:rgba(255,255,255,0.28);color:#fff;">↻ New balance</span>` : '');

  // History is split into three distinct sections: the payment ledger, the
  // payoff-date log, and the lifetime interest total. checkedPaychecks
  // never gets cleared (short of a full Reset), so the payment ledger
  // doubles as the account's full lifetime payment record.
  const paymentRowsArr = (typeof idx === 'number') ? lastSchedule
    .filter(row => checkedPaychecks[row.paycheck])
    .map(row => `
      <div class="spend-item-numbers" style="padding:4px 0;">
        <span>${fmtDate(row.date)}</span>
        <span>${money(row.payments[idx])}${row.interestByAccount && row.interestByAccount[idx] > 0.005 ? ` <span style="color:var(--warn);">(+${money(row.interestByAccount[idx])} int.)</span>` : ''}</span>
      </div>
    `) : [];

  const payoffDateRows = wasEverPaidOff ? d.payoffHistory.map(h => `
    <div class="spend-item-numbers" style="padding:4px 0;"><span>🎉 Paid off</span><span>${new Date(h.date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}${typeof h.interestPaid === 'number' ? ` <span style="color:var(--muted);font-weight:400;">· ${money(h.interestPaid)} interest that cycle</span>` : ''}</span></div>
  `).join('') : '';

  // When it's already paid off, show the confirmed date from history instead
  // of a forward-looking estimate; otherwise, project from the schedule.
  let dateLabel = 'Est. payoff date';
  let dateValue = d.estimatedPayoffDate ? fmtDate(new Date(d.estimatedPayoffDate)) : '—';
  if (d.isComplete && wasEverPaidOff) {
    dateLabel = 'Paid off on';
    dateValue = new Date(d.payoffHistory[d.payoffHistory.length - 1].date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  }

  return `
    <button class="back-to-spending-btn" data-bd-click="closeAccountDetail()">← Back to Accounts</button>
    <div class="account-detail-title-box">
      <div class="account-detail-title-name">${bdEscape(d.name)}</div>
      <div style="margin-top:8px;font-size:0.8rem;color:rgba(255,255,255,0.9);position:relative;">${dateLabel}: <strong style="color:#fff;">${dateValue}</strong></div>
    </div>

    <div style="display:flex;align-items:center;justify-content:center;gap:14px;margin:18px 0 6px;">
      <div class="pie-chart" style="width:165px;height:165px;flex-shrink:0;background:conic-gradient(var(--accent) 0% ${pct.toFixed(2)}%, var(--line) ${pct.toFixed(2)}% 100%);"></div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <div class="account-terms-mini account-terms-mini-warn account-terms-mini-sm">
          <div class="account-terms-mini-row"><span>Interest paid</span><span style="color:var(--warn);">${money(d.interestPaid)}</span></div>
        </div>
        <div class="account-terms-mini account-terms-mini-sm">
          <div class="account-terms-mini-row"><span>Amount paid</span><span style="color:var(--accent);">${money(d.paid)}</span></div>
          <div class="account-terms-mini-row"><span>Remaining</span><span>${money(Math.max(0,d.remaining))}</span></div>
        </div>
      </div>
    </div>
    <div style="text-align:center;font-size:0.78rem;color:var(--muted);margin-bottom:14px;">${pct.toFixed(1)}% paid off${badge ? ' · ' + badge : ''}</div>

    <div class="card-group-title">Edit account</div>
    <div class="field-row">
      <div class="field-name">Balance</div>
      <input type="number" id="bal_${d.id}" value="${d.balance.toFixed(2)}" step="0.01" data-bd-change="calculate()">
    </div>
    <div class="field-row">
      <div class="field-name">APR (%)</div>
      <input type="number" id="apr_${d.id}" value="${(d.apr*100).toFixed(2)}" step="0.01" data-bd-change="calculate()">
    </div>
    <div class="field-row">
      <div class="field-name">Monthly amount due</div>
      <input type="number" id="monthlyMin_${d.id}" value="${window.BearDenDebtPayments.monthlyMinimum(d).toFixed(2)}" step="0.01" data-bd-change="calculate()">
    </div>
    <div style="text-align:right;margin-top:8px;">
      <button type="button" class="account-delete-button" data-edit-debt="${d.id}">Delete debt</button>
    </div>

    <button class="recalc" style="margin:16px 0 20px;" id="historyToggleBtn-${d.id}" data-bd-click="togglePaymentHistoryDetail(${d.id})">${paymentHistoryExpanded ? '▾ Hide History' : '📜 History'}</button>
    <div class="account-history-content${paymentHistoryExpanded ? ' open' : ''}" id="accountHistoryContent-${d.id}">
    <div class="history-section-title">💰 Lifetime Interest Paid</div>
    <div class="spend-item-numbers" style="padding:0 0 4px;"><span style="font-weight:700;color:var(--ink);">Across all payoff cycles</span><span style="color:var(--warn);font-weight:700;">${money(d.lifetimeInterestPaid)}</span></div>

    <hr class="history-section-divider">

    <div class="history-section-title">🎉 Payoff Dates</div>
    ${payoffDateRows || '<p style="color:var(--muted);font-size:0.8rem;text-align:center;margin:6px 0 0;">Not paid off yet.</p>'}

    <hr class="history-section-divider">

    ${bankHistory}
    <div class="history-section-title">Checked paycheck history</div>
    ${paymentRowsArr.length ? (paymentHistoryShowAll ? paymentRowsArr.join('') : paymentRowsArr.slice(-2).join('')) : '<p style="color:var(--muted);font-size:0.8rem;text-align:center;margin:6px 0 0;">No checked-off paychecks yet.</p>'}
    ${paymentRowsArr.length > 2 ? `<button class="add-toggle-btn" data-bd-click="togglePaymentHistoryShowAll()">${paymentHistoryShowAll ? '▾ Show fewer' : `▸ Show all ${paymentRowsArr.length} payments`}</button>` : ''}
    </div>
  `;
}

let debtAccountSummary=null;
window.setDebtAccountSummary=summary=>{debtAccountSummary=summary;updateDebtHeroProgress();};

function updateDebtHeroProgress(){
  const avalancheBtn = document.getElementById('pmBtnAvalanche');
  const snowballBtn = document.getElementById('pmBtnSnowball');
  if (avalancheBtn) avalancheBtn.classList.toggle('active', currentPayoffMethod === 'avalanche');
  if (snowballBtn) snowballBtn.classList.toggle('active', currentPayoffMethod === 'snowball');
  const minimumBtn=document.getElementById('pmBtnMinimum');if(minimumBtn)minimumBtn.classList.toggle('active',currentPayoffMethod==='minimum');
  for(const [method,button]of [['avalanche',avalancheBtn],['snowball',snowballBtn],['minimum',minimumBtn]])button?.setAttribute('aria-pressed',String(currentPayoffMethod===method));

  const checkedNums = Object.keys(checkedPaychecks).filter(k => checkedPaychecks[k]).map(Number);
  const row=lastSchedule.find(r=>r.paycheck===Math.max(...checkedNums));
  const currentBalances=lastCardsForSpending.map((card,i)=>(window.syncedDebtBalances?.[card.id]?window.syncedDebtBalances[card.id].balance/100:row?.balancesAfter[i]??card.balance));
  const summary=debtAccountSummary;
  const remaining=summary?summary.totals.reduce((sum,t)=>sum+t.amount/100,0):currentBalances.reduce((a,b)=>a+b,0);
  const startTotal=summary?summary.starting/100:lastStartTotal;
  const el = document.getElementById('heroTotal');
  if (el) el.textContent=summary?(summary.totals.length?summary.totals.map(t=>new Intl.NumberFormat('en-US',{style:'currency',currency:t.currency}).format(t.amount/100)).join(' · '):summary.missing?'Unavailable':money(0)):money(remaining);
  let balanceNote=document.getElementById('heroBalanceNote');
  if(!balanceNote&&el){balanceNote=document.createElement('p');balanceNote.id='heroBalanceNote';balanceNote.className='hero-balance-note';el.closest('.row').after(balanceNote);}
  if(balanceNote){balanceNote.hidden=!summary?.missing;balanceNote.textContent=summary?.missing?summary.missing+' account'+(summary.missing===1?' has':'s have')+' no balance available.':'';}

  // Interest actually charged so far, based only on checked-off paychecks —
  // distinct from "Total interest you'll pay," which is the full projected
  // total over the life of the plan, checked or not.
  let interestPaidSoFar = 0;
  lastSchedule.forEach(row => {
    if (checkedPaychecks[row.paycheck]) interestPaidSoFar += row.interestThisCheck || 0;
  });
  const interestPaidEl = document.getElementById('heroInterestPaid');
  if (interestPaidEl) interestPaidEl.textContent = money(interestPaidSoFar);

  const pieWrap = document.getElementById('heroPieWrap');
  const pie = document.getElementById('heroPie');
  const pctLabel = document.getElementById('heroPiePct');
  if (pieWrap && pie && pctLabel) {
    if (startTotal > 0.005 && (!summary || summary.totals.length<=1)) {
      const paidOffAmount = Math.max(0, startTotal - remaining);
      const pct = Math.min(100, (paidOffAmount / startTotal) * 100);
      pie.style.background = `conic-gradient(#c9a8ff 0% ${pct.toFixed(2)}%, rgba(255,255,255,0.18) ${pct.toFixed(2)}% 100%)`;
      pctLabel.textContent = pct.toFixed(0) + '%';
      pieWrap.style.display = 'flex';
    } else {
      pieWrap.style.display = 'none';
    }
  }

  // Detailed breakdown pie — how the current remaining balance splits across
  // each account, kept in sync so it's current whenever the dropdown opens.
  const breakdownEl = document.getElementById('debtBreakdownDropdown');
  if (breakdownEl) {
    const segments=summary?summary.accounts.map(a=>({label:a.name,value:a.amount/100})):lastCardsForSpending.map((c,i)=>({label:c.name,value:Math.max(0,currentBalances[i])}));
    const pieHTML = summary?.totals.length>1?'':buildPieChartHTML(segments, 180, null);
    breakdownEl.innerHTML = pieHTML
      ? `<div style="font-size:0.72rem;color:var(--on-dark-muted);text-align:center;margin-bottom:8px;">Remaining balance by account</div><div class="debt-breakdown-pie">${pieHTML}</div>`
      : `<p style="font-size:0.8rem;color:var(--on-dark-muted);text-align:center;margin:0;">No balance breakdown available.</p>`;
  }
}

function updateSavingsHeroesProgress(){
  if (!lastSavingsGoalsInfo || lastSavingsGoalsInfo.length === 0) return;
  const checkedNums = Object.keys(checkedPaychecks).filter(k => checkedPaychecks[k]).map(Number);
  const maxChecked = checkedNums.length ? Math.max(...checkedNums) : null;
  lastSavingsGoalsInfo.forEach(g => {
    let savedSoFar = g.start;
    if (maxChecked !== null) {
      const row = lastSchedule.find(r => r.paycheck === maxChecked);
      if (row) {
        const gr = row.savingsByGoal.find(x => x.id === g.id);
        if (gr) savedSoFar = gr.balance;
      }
    }
    const el = document.getElementById('savingsHeroCurrent-' + g.id);
    if (el) el.textContent = money(savedSoFar);

    const pieWrap = document.getElementById('savingsHeroPieWrap-' + g.id);
    const pie = document.getElementById('savingsHeroPie-' + g.id);
    const pctLabel = document.getElementById('savingsHeroPiePct-' + g.id);
    if (pieWrap && pie && pctLabel) {
      if (g.goal > 0.005) {
        const pct = Math.min(100, Math.max(0, (savedSoFar / g.goal) * 100));
        pie.style.background = `conic-gradient(rgba(255,255,255,0.95) 0% ${pct.toFixed(2)}%, rgba(255,255,255,0.18) ${pct.toFixed(2)}% 100%)`;
        pctLabel.textContent = pct.toFixed(0) + '%';
        pieWrap.style.display = 'flex';
      } else {
        pieWrap.style.display = 'none';
      }
    }
  });
}

// ---- Spending tracker ----
// Shows how much has actually gone toward each debt account and each budget
// item so far, based on which paychecks are checked off as completed —
// separate from the projected schedule, which shows the plan either way.
// This is also now the Accounts page: accounts get added, removed, and
// edited (balance/APR/min payment) right from this view.
function computeAndRenderSpendingTracker(){
  const checkedNums = Object.keys(checkedPaychecks).filter(k => checkedPaychecks[k]).map(Number);
  const maxChecked = checkedNums.length ? Math.max(...checkedNums) : null;
  const maxCheckedRow = maxChecked !== null ? lastSchedule.find(r => r.paycheck === maxChecked) : null;

  lastDebtSpending = lastCardsForSpending.map((c, i) => {
    const persistentCard = cardsData.find(cd => cd.id === c.id);
    if (persistentCard && typeof persistentCard.lifetimeInterestPaid !== 'number') persistentCard.lifetimeInterestPaid = 0;
    if (persistentCard && typeof persistentCard.cycleStartPaycheck !== 'number') persistentCard.cycleStartPaycheck = 0;
    const cycleStartPaycheck = persistentCard ? persistentCard.cycleStartPaycheck : 0;

    // "paid" and "interestPaid" only count paychecks since the current
    // payoff cycle started, so the pie chart and its stats track this
    // cycle only — not any previous cycle from before the account was
    // paid off and reopened.
    let paid = 0;
    let interestPaid = 0;
    lastSchedule.forEach(row => {
      if (checkedPaychecks[row.paycheck] && row.paycheck > cycleStartPaycheck) {
        paid += row.payments[i];
        interestPaid += row.interestByAccount ? row.interestByAccount[i] : 0;
      }
    });
    const remaining = window.syncedDebtBalances?.[c.id]?window.syncedDebtBalances[c.id].balance/100:(maxCheckedRow ? maxCheckedRow.balancesAfter[i] : c.balance);
    const isComplete = remaining <= 0.01;

    // Projected date this specific account's balance hits zero, per the
    // current schedule — not the overall debt-free date, just this account's.
    const payoffRow = lastSchedule.find(row => row.balancesAfter[i] <= 0.01);
    const estimatedPayoffDate = payoffRow ? payoffRow.date : null;

    // Lifetime interest = every previously-completed cycle (frozen on the
    // persistent card) plus this cycle's interest so far, captured here
    // before any bookkeeping below moves the cycle boundary — so it's
    // correct whether or not this account just finished paying off on
    // this exact recalculation.
    const lifetimeInterestPaid = (persistentCard ? persistentCard.lifetimeInterestPaid : 0) + interestPaid;

    // Payoff history lives on the persistent card record (cardsData), keyed
    // by id, so it survives balance edits. We only log a new entry the
    // moment an account transitions from "has a balance" to "paid off" —
    // activelyPaidOff tracks whether we've already logged the current
    // streak, so re-adding a balance later and paying it off again logs a
    // second entry instead of losing or duplicating history. That same
    // moment is also when this cycle's interest gets folded into the
    // lifetime total and the cycle boundary moves up, so a reopened
    // account starts its next cycle from a clean slate.
    let payoffHistory = [];
    if (persistentCard) {
      if (!persistentCard.payoffHistory) persistentCard.payoffHistory = [];
      if (isComplete && !persistentCard.activelyPaidOff) {
        persistentCard.lifetimeInterestPaid += interestPaid;
        persistentCard.cycleStartPaycheck = checkedNums.length ? Math.max(...checkedNums) : cycleStartPaycheck;
        persistentCard.payoffHistory.push({ date: new Date().toISOString(), interestPaid });
        persistentCard.activelyPaidOff = true;
      } else if (!isComplete && persistentCard.activelyPaidOff) {
        persistentCard.activelyPaidOff = false;
      }
      payoffHistory = persistentCard.payoffHistory;
    }

    return { id: c.id, name: c.name, balance: c.balance, apr: c.apr, min: c.min, monthlyMinimum: c.monthlyMinimum, paid, remaining, interestPaid, lifetimeInterestPaid, isComplete, payoffHistory, estimatedPayoffDate };
  });

  renderSpendingTracker();
}

function renderSpendingTracker(){
  const container = document.getElementById('spendingTrackerContent');
  if (!container) return;

  if (currentDetailAccountIdx !== null) {
    const d = lastDebtSpending[currentDetailAccountIdx];
    if (d) {
      container.innerHTML = buildAccountDetailHTML(d, currentDetailAccountIdx);
      return;
    }
    currentDetailAccountIdx = null; // account no longer exists — fall through to the list view
  }

  const addAccountBoxHTML = '<button class="add-toggle-btn" data-open-account-add>+ Add Account</button>';

  if (lastDebtSpending.length === 0) {
    container.innerHTML = `
      <p style="color:var(--muted);font-size:0.85rem;text-align:center;padding:8px 0;">Add some accounts to start tracking spending.</p>
      ${addAccountBoxHTML}
    `;
    return;
  }

  const checkedCount = Object.keys(checkedPaychecks).filter(k => checkedPaychecks[k]).length;
  let html = `
    <p style="color:var(--muted);font-size:0.78rem;margin:0 0 10px;">Based on ${checkedCount} checked-off paycheck${checkedCount === 1 ? '' : 's'}.</p>
  `;

  if (lastDebtSpending.length > 0) {
    const totalInterestPaid = lastDebtSpending.reduce((a,d)=>a+d.interestPaid, 0);
    const totalPaid = lastDebtSpending.reduce((a,d)=>a+d.paid, 0);
    html += `
      <div class="spend-section">
        <div class="spend-section-header">
          <span class="spend-section-title">💳 Debt Accounts</span>
          <span class="spend-section-total">${money(totalPaid)} paid</span>
        </div>`;
    // Active accounts first, paid-off ones sink to the bottom of the list.
    const orderedDebt = lastDebtSpending
      .map((d, idx) => ({ ...d, idx }))
      .sort((a, b) => (a.isComplete === b.isComplete) ? 0 : (a.isComplete ? 1 : -1));
    html += orderedDebt.map((d) => {
      const idx = d.idx;
      const total = d.paid + Math.max(0, d.remaining);
      const pct = d.isComplete ? 100 : (total > 0 ? Math.min(100, (d.paid / total) * 100) : 0);
      const wasEverPaidOff = d.payoffHistory && d.payoffHistory.length > 0;
      const isReopened = !d.isComplete && wasEverPaidOff;
      const cardClass = 'spend-item spend-item-card' + (d.isComplete ? ' spend-item-complete' : '');
      const badge = d.isComplete
        ? `<span class="spend-item-badge spend-item-badge-complete">✓ Paid Off</span>`
        : (isReopened ? `<span class="spend-item-badge spend-item-badge-reopened">↻ New balance</span>` : '');
      return `
        <div class="${cardClass}" data-bd-click="openAccountDetail(${idx})">
          <div class="spend-item-name">${bdEscape(d.name)}${badge}<span class="spend-item-caret">›</span></div>
          <div class="spend-item-bar"><div class="spend-item-bar-fill" style="width:${pct.toFixed(1)}%;"></div></div>
          <div class="spend-item-numbers"><span>${money(d.paid)} paid</span><span>${money(Math.max(0,d.remaining))} remaining</span></div>
        </div>
      `;
    }).join('');
    html += addAccountBoxHTML;
    html += `
        <div class="spend-item" style="border-top:1px solid var(--line);">
          <div class="spend-item-numbers"><span style="font-weight:700;color:var(--ink);">Total interest charged</span><span style="color:var(--warn);font-weight:700;">${money(totalInterestPaid)}</span></div>
        </div>
      </div>
    `;
  } else {
    html += addAccountBoxHTML;
  }

  container.innerHTML = html;
}

// Checks lastSchedule (already computed, independent of checked status) to
// see whether a given paycheck is the exact one where an account — or the
// whole debt — first hits zero, by comparing its balances against the
// paycheck right before it.
function paycheckCompletesAPayoff(paycheckNum){
  const idx = lastSchedule.findIndex(r => r.paycheck === paycheckNum);
  if (idx === -1) return { any: false, whole: false, names: [] };
  const row = lastSchedule[idx];
  const names = [];
  lastCardsForSpending.forEach((c, i) => {
    const prevBal = idx > 0 ? lastSchedule[idx - 1].balancesAfter[i] : c.balance;
    if (prevBal > 0.01 && row.balancesAfter[i] <= 0.01) names.push(c.name);
  });
  const prevTotal = idx > 0 ? lastSchedule[idx - 1].total : lastCardsForSpending.reduce((a,c)=>a+c.balance,0);
  const previousCar=idx>0?lastSchedule[idx-1].carDebt?.balance:(window.carDebtForecast||[]).reduce((sum,l)=>sum+(l.balance||0),0);
  const whole = row.carDebt?.balance!==null&&(prevTotal+(previousCar||0)/100)>0.01&&row.total+(row.carDebt?.balance||0)/100<=0.01;
  return { any: names.length > 0 || whole, whole, names };
}

// lastSavingsGoalsInfo already records the exact paycheck each goal was
// first reached (computed once in calculate()), so this is just a lookup.
function paycheckCompletesASavingsGoal(paycheckNum){
  const names = lastSavingsGoalsInfo.filter(g => g.reachedPaycheck === paycheckNum).map(g => g.name);
  return { any: names.length > 0, names };
}

let celebrationDismissTimer = null;
let celebratingPaycheckNum = null;

function spawnConfetti(){
  const container = document.getElementById('celebrationConfetti');
  if (!container) return;
  container.innerHTML = '';
  const colors = ['#5ca9a0','#c69a61','#8aa9bd','#b96c63','#8caa87','#d4be92','#648d92'];
  for (let i = 0; i < 80; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = (Math.random()*100) + '%';
    piece.style.background = colors[Math.floor(Math.random()*colors.length)];
    piece.style.width = (6 + Math.random()*6) + 'px';
    piece.style.height = (10 + Math.random()*8) + 'px';
    piece.style.animationDuration = (2 + Math.random()*1.6).toFixed(2) + 's';
    piece.style.animationDelay = (Math.random()*0.6).toFixed(2) + 's';
    piece.style.transform = `rotate(${Math.floor(Math.random()*360)}deg)`;
    container.appendChild(piece);
  }
}

function showCelebration(payoff, savings){
  const overlay = document.getElementById('celebrationOverlay');
  const titleEl = document.getElementById('celebrationTitle');
  const emojiEl = document.getElementById('celebrationEmoji');
  if (!overlay || !titleEl) { calculate(); return; }

  let title;
  if (payoff.whole && savings.any) {
    title = `Debt Free & ${savings.names.join(', ')} Reached!`;
  } else if (payoff.whole) {
    title = "You're Debt Free!";
  } else if (payoff.any && savings.any) {
    title = `${payoff.names.join(', ')} Paid Off & ${savings.names.join(', ')} Reached!`;
  } else if (payoff.any) {
    title = `${payoff.names.join(', ')} Paid Off!`;
  } else {
    title = `${savings.names.join(', ')} Reached!`;
  }
  titleEl.textContent = title;
  if (emojiEl) emojiEl.textContent = (payoff.any && savings.any) ? '🎉💰' : (savings.any ? '💰' : '🎉');

  spawnConfetti();
  overlay.style.display = 'flex';
  requestAnimationFrame(() => overlay.classList.add('show'));
  clearTimeout(celebrationDismissTimer);
  celebrationDismissTimer = setTimeout(dismissCelebration, 3200);
}

function dismissCelebration(){
  clearTimeout(celebrationDismissTimer);
  const overlay = document.getElementById('celebrationOverlay');
  if (overlay) {
    overlay.classList.remove('show');
    overlay.style.display = 'none';
  }
  const confettiContainer = document.getElementById('celebrationConfetti');
  if (confettiContainer) confettiContainer.innerHTML = '';

  // Only now — after the celebration has actually cleared — does the
  // triggering paycheck card play its leaving animation.
  const cardEl = celebratingPaycheckNum !== null ? document.getElementById('paycheck-card-' + celebratingPaycheckNum) : null;
  celebratingPaycheckNum = null;
  if (cardEl) {
    cardEl.classList.add('paycheck-disappearing');
    setTimeout(calculate, 920);
  } else {
    calculate();
  }
}

function toggleChecked(paycheckNum, checked){
  window.debtPaymentHistory??={};
  const row=lastSchedule.find(r=>r.paycheck===paycheckNum);
  if(checked&&row)window.debtPaymentHistory[paycheckNum]=Object.fromEntries(cardsData.map((c,i)=>[c.id,row.payments[i]]));
  else delete window.debtPaymentHistory[paycheckNum];
  window.debtInterestHistory??={};
  if(checked&&row)window.debtInterestHistory[paycheckNum]=Object.fromEntries(cardsData.map((c,i)=>[c.id,row.interestByAccount?.[i]||0]));
  else delete window.debtInterestHistory[paycheckNum];
  checkedPaychecks[paycheckNum] = checked;
  window.dispatchEvent(new Event('bearden-plan-changed'));
  performSaveAppState(); // Persist completion before the celebration or leaving animation.
  if (checked) {
    const payoff = paycheckCompletesAPayoff(paycheckNum);
    const savings = paycheckCompletesASavingsGoal(paycheckNum);
    if (payoff.any || savings.any) {
      // The card's disappearing animation is deferred until the
      // celebration is dismissed (see dismissCelebration), which also
      // calls calculate() itself once that's done.
      celebratingPaycheckNum = paycheckNum;
      showCelebration(payoff, savings);
      return;
    }
    // Let the card play its disappearing animation before the full
    // recalculation rebuilds the schedule out from under it.
    const cardEl = document.getElementById('paycheck-card-' + paycheckNum);
    if (cardEl) {
      cardEl.classList.add('paycheck-disappearing');
      setTimeout(calculate, 920);
      return;
    }
  }
  // Full recalculation, not just a lightweight update — this guarantees any
  // pending edit elsewhere on the page (like a contribution override you just
  // typed) is captured too, rather than depending on its onchange having
  // already fired before this checkbox's own handler runs. calculate()
  // already re-renders the hero, spending tracker, and schedule internally.
  calculate();
}

// Unchecks every paycheck without touching balances, budget, income, or
// savings — just gives you a clean slate to re-check things off from.
function resetCheckedPaychecks(){
  if(!confirm('Uncheck all paychecks? This clears paycheck checkoffs and recalculates your progress. Your income, budget, and accounts stay saved.'))return;
  const section = document.getElementById('schedulePlanSection');
  checkedPaychecks = {};
  window.debtPaymentHistory={};window.debtInterestHistory={};
  if (section) {
    section.classList.remove('schedule-resetting');
    void section.offsetHeight; // restart the animation if it's already mid-play
    section.classList.add('schedule-resetting');
    setTimeout(calculate, 500); // swap content right at the animation's invisible midpoint
    setTimeout(() => section.classList.remove('schedule-resetting'), 1000);
    return;
  }
  calculate();
}

function buildSavingsGoalHeroHTML(g, canDelete, isEditing, isWithdrawing){
  return `
    <div class="hero-peek-wrap savings-peek-wrap">
    <div class="hero savings-hero" id="savingsHero-${g.id}">
      <div class="tracker-header">
        <div class="hero-title">🐷 Savings Tracker</div>
        <div class="hero-controls">
          <button class="icon-btn" data-bd-click="addSavingsGoal()" title="Add another goal" style="font-size:1.3rem;">+</button>
          <button class="icon-btn" data-bd-click="toggleSavingsWithdrawPanel(${g.id})" title="Withdraw from savings" aria-label="Withdraw from savings"><svg class="savings-withdraw-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 14V3m-4 4 4-4 4 4M7 10H3v11h18V10h-4"/></svg></button>
          <button class="icon-btn" data-bd-click="toggleSavingsGoalEdit(${g.id})" title="Edit goal">⚙️</button>
          ${canDelete ? `<button class="icon-btn" data-bd-click="removeSavingsGoal(${g.id})" title="Delete goal">🗑️</button>` : ''}
        </div>
      </div>
      <div class="savings-hero-edit savings-withdraw-panel${isWithdrawing ? ' open' : ''}" id="savingsWithdrawPanel-${g.id}">
        <div class="savings-withdraw-label">💸 Spent some of this?</div>
        <div class="savings-withdraw-hint">Log a withdrawal to pull it out of your saved balance — future paychecks keep contributing on top from there.</div>
        <div class="field-row-dark">
          <div class="field-name-dark">Amount</div>
          <input type="text" inputmode="decimal" id="sg_withdraw_amt_${g.id}" class="amt-text" placeholder="0.00">
        </div>
        <div class="field-row-dark">
          <div class="field-name-dark">Note<small>optional</small></div>
          <input type="text" id="sg_withdraw_note_${g.id}" placeholder="e.g. car repair">
        </div>
        <div id="sg_withdraw_error_${g.id}" style="display:none;color:#ffd6c2;font-size:0.72rem;text-align:right;margin-top:4px;">Enter an amount greater than $0.</div>
        <div style="text-align:right;margin-top:6px;">
          <button class="withdraw-btn" data-bd-click="withdrawFromSavings(${g.id})">Log Withdrawal</button>
        </div>
        ${g.withdrawalHistory && g.withdrawalHistory.length > 0 ? `
          <div style="margin-top:8px;">
            ${g.withdrawalHistory.slice().reverse().map(w => `
              <div class="withdrawal-history-row">
                <span>${new Date(w.date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}${w.note ? ` · ${bdEscape(w.note)}` : ''}</span>
                <span>-${money(w.amount)}</span>
              </div>
            `).join('')}
          </div>
          <div style="text-align:right;margin-top:8px;">
            <span class="remove" style="color:#ffd6c2;" data-bd-click="clearSavingsWithdrawalHistory(${g.id})">Clear history</span>
          </div>
        ` : ''}
        <div style="text-align:right;margin-top:12px;">
          <button class="savings-save-btn" data-bd-click="toggleSavingsWithdrawPanel(${g.id})">Done</button>
        </div>
      </div>
      <div class="savings-hero-edit${isEditing ? ' open' : ''}" id="savingsGoalEdit-${g.id}">
        <div class="field-row-dark">
          <div class="field-name-dark">Name</div>
          <input type="text" id="sg_name_${g.id}" value="${bdEscape(g.name)}" data-bd-change="updateSavingsGoalField(${g.id}, 'name', this.value)">
        </div>
        <div class="field-row-dark">
          <div class="field-name-dark">Goal amount</div>
          <input type="number" id="sg_goal_${g.id}" value="${g.goal}" step="0.01" data-bd-change="updateSavingsGoalField(${g.id}, 'goal', this.value)">
        </div>
        <div class="field-row-dark">
          <div class="field-name-dark">Starting balance</div>
          <input type="number" id="sg_start_${g.id}" value="${g.start}" step="0.01" data-bd-change="updateSavingsGoalField(${g.id}, 'start', this.value)">
        </div>
        <div class="field-row-dark">
          <div class="field-name-dark">Contribution<small>per paycheck</small></div>
          <input type="number" id="sg_contrib_${g.id}" value="${g.contribution}" step="0.01" data-bd-change="updateSavingsGoalField(${g.id}, 'contribution', this.value)">
        </div>
        <div style="text-align:right;margin-top:10px;">
          <span class="remove" style="color:#ffd6c2;" data-bd-click="resetSavingsGoal(${g.id})">↺ Reset progress to starting goal</span>
        </div>
        <div style="text-align:right;margin-top:12px;">
          <button class="savings-save-btn" data-bd-click="toggleSavingsGoalEdit(${g.id})">Save</button>
        </div>
      </div>
      <div style="margin-top:10px;">
        <div class="label" style="word-break:break-word;">${bdEscape(g.name)}</div>
      </div>
      <div class="hero-date-banner" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-top:6px;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:0.9rem;font-weight:800;color:#f0f3f5;text-transform:uppercase;letter-spacing:0.07em;">Reached by</div>
          <div class="big">${g.reachedDate ? fmtDate(g.reachedDate) : 'Add a contribution to see a date'}</div>
          <div class="day-counter">${g.reachedDate ? daysCounterText(g.reachedDate) : ''}</div>
          <div class="paycheck-counter">${g.reachedDate ? paychecksCounterText(g.reachedPaycheck) : ''}</div>
        </div>
        <div class="hero-pie-wrap-corner" id="savingsHeroPieWrap-${g.id}" style="display:none;">
          <div class="hero-pie-corner" id="savingsHeroPie-${g.id}" style="background:conic-gradient(rgba(255,255,255,0.95) 0% 0%, rgba(255,255,255,0.18) 0% 100%);">
            <div class="hero-pie-hole-sm">
              <span class="pct" id="savingsHeroPiePct-${g.id}">0%</span>
            </div>
          </div>
          <div style="font-size:0.58rem;color:#e6f0ec;text-align:center;margin-top:3px;max-width:64px;line-height:1.2;">% of goal saved</div>
        </div>
      </div>
      <div class="row"><span>Saved so far</span><span id="savingsHeroCurrent-${g.id}">—</span></div>
      <div class="row"><span>Goal amount</span><span>${money(g.goal)}</span></div>
      <div class="row"><span>Contribution per paycheck</span><span>${money(g.contribution)}</span></div>
      ${g.withdrawalHistory && g.withdrawalHistory.length > 0 ? `<div class="row"><span>Total withdrawn</span><span>${money(g.withdrawalHistory.reduce((a,w)=>a+w.amount,0))}</span></div>` : ''}
    </div></div>
  `;
}

// A capped simulation is not a lifetime-interest estimate. Explain which
// unpaid debts have no payment or fail to reduce principal in upcoming checks.
function debtForecastNotice(cards,schedule,debtFreeDate,checked={},today=new Date()){
  if(debtFreeDate!==null)return '';
  const midnight=new Date(today);midnight.setHours(0,0,0,0);
  const future=schedule.filter(row=>!checked[row.paycheck]&&row.date>=midnight);
  const last=schedule.at(-1);
  if(!last||last.total<=0.01)return '';
  const missing=cards.filter((card,i)=>last.balancesAfter[i]>0.005&&future.some(row=>row.debtTiming?.[i]?.missingFutureMinimum)).map(c=>c.name);
  if(missing.length)return 'Nothing is due for the current cycle on '+missing.join(', ')+', but a balance remains. Add a future monthly payment estimate in Accounts, or wait for the next statement. A due date alone cannot supply that amount; the payoff date is unavailable until it is known.';
  const upcoming=future.slice(0,26);
  const unpaid=[],notReducing=[];
  if(upcoming.length===26)cards.forEach((card,i)=>{
    if(!(last.balancesAfter[i]>0.005))return;
    const payments=upcoming.reduce((sum,row)=>sum+(row.payments[i]||0),0);
    const interest=upcoming.reduce((sum,row)=>sum+(row.interestByAccount[i]||0),0);
    if(payments<0.005)unpaid.push(card.name);
    else if(interest>0&&payments<=interest+0.005)notReducing.push(card.name);
  });
  const reasons=[];
  if(unpaid.length)reasons.push('No payments scheduled over the next 26 paychecks for: '+unpaid.join(', ')+'.');
  if(notReducing.length)reasons.push('Payments do not exceed projected interest over the next 26 paychecks for: '+notReducing.join(', ')+'.');
  if(reasons.length)reasons.push('Review payment amounts and monthly minimums in Accounts.');
  else reasons.push('The current plan still has debt at the end of the 30-year forecast.');
  reasons.push('Total payoff interest is unavailable until the plan pays off.');
  return reasons.join(' ');
}

function renderResults(cards, schedule, totalInterest, savingsEnabled, goalsInfo, debtFreeDate, debtFreePaycheck, budgetItemsSnapshot, sliceComparison=null){
  const startTotal = cards.reduce((a,c)=>a+c.balance,0);
  lastStartTotal = startTotal;
  const baseDebtFreeDate=debtFreeDate;
  const dateKey=date=>date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
  const forecast=window.BearDenCarDebt.combinedDebtForecast({date:debtFreeDate?dateKey(debtFreeDate):null,interest:totalInterest,hasDebt:cards.some(c=>c.balance>0)},window.carDebtForecast||[],dateKey(new Date()));
  debtFreeDate=forecast.date?new Date(forecast.date+'T00:00:00'):null;
  if((window.carDebtForecast||[]).length){
    const first=document.getElementById('startDate').value;
    debtFreePaycheck=debtFreeDate&&first?Math.max(1,Math.floor((debtFreeDate-new Date(first+'T00:00:00'))/86400000/14)+1):null;
    totalInterest=forecast.interest;
  }
  const neverPaysOff = debtFreeDate === null;

  if (neverPaysOff) {
    const missingFutureMinimum=schedule.some(row=>row.debtTiming?.some((t,i)=>t.missingFutureMinimum&&row.balancesBefore[i]>0));
    document.getElementById('heroDate').textContent = forecast.needsCarDetails?'Car loan details needed':missingFutureMinimum?'Future minimum needed':(cards.some(c=>c.balance>0)||(window.carDebtForecast||[]).some(l=>l.balance>0))&&Number(document.getElementById('takeHome').value)>0?'No payoff within 30 years':'Set up income, budget, and debt to begin';
    document.getElementById('heroDate').style.color = '#e8a15c';
    document.getElementById('heroDate').style.fontSize = '1.15rem';
    document.getElementById('heroDayCounter').textContent = '';
    document.getElementById('heroPaycheckCounter').textContent = '';
  } else {
    document.getElementById('heroDate').textContent = fmtDate(debtFreeDate);
    document.getElementById('heroDate').style.color = '';
    document.getElementById('heroDate').style.fontSize = '';
    document.getElementById('heroDayCounter').textContent = daysCounterText(debtFreeDate);
    document.getElementById('heroPaycheckCounter').textContent = paychecksCounterText(debtFreePaycheck);
  }
  document.getElementById('heroDayCounter').style.display=neverPaysOff?'none':'';
  document.getElementById('heroPaycheckCounter').style.display=neverPaysOff?'none':'';
  document.getElementById('heroInterest').textContent = neverPaysOff?'Unavailable':money(totalInterest);
  const forecastNote=document.getElementById('debtForecastNote');
  forecastNote.textContent=debtForecastNotice(cards,schedule,baseDebtFreeDate,checkedPaychecks);
  forecastNote.hidden=!forecastNote.textContent;
  const sliceNote=document.getElementById('sliceInterestNote');
  sliceNote.hidden=!sliceComparison;
  if(sliceComparison){const difference=Math.round(sliceComparison.difference*100)/100,method={avalanche:'Avalanche',snowball:'Snowball',minimum:'Minimums'}[currentPayoffMethod];sliceNote.textContent=(Math.abs(difference)<.01?'No projected interest change':money(Math.abs(difference))+(difference>0?' less':' more')+' projected interest')+' vs '+method+' without '+sliceComparison.actions+(sliceComparison.through?' through '+fmtDate(sliceComparison.through):'')+'.';}


  lastSchedule = schedule;
  lastSavingsGoalsInfo = goalsInfo;
  lastCardsForSpending = cards;
  updateDebtHeroProgress();
  computeAndRenderSpendingTracker();

  const heroContainer = document.getElementById('savingsHeroContainer');
  if (savingsEnabled && goalsInfo.length > 0) {
    const canDelete = true; // deleting the last goal is fine now — it just returns to the "start tracking" banner
    heroContainer.innerHTML = goalsInfo.map(g =>
        buildSavingsGoalHeroHTML(g, canDelete, savingsGoalEditingId === g.id, savingsWithdrawOpenId === g.id)
      ).join('');
    if (justAddedGoalId !== null) {
      const newCardEl = document.getElementById('savingsHero-' + justAddedGoalId);
      if (newCardEl) newCardEl.classList.add('savings-card-entering');
      justAddedGoalId = null;
    }
    updateSavingsHeroesProgress();
  } else {
    heroContainer.innerHTML = `
      <button class="start-savings-btn" data-bd-click="startTrackingSavings()"><span class="ssb-icon">🐷</span><span>Start Tracking Savings</span></button>
    `;
  }

  const out = document.getElementById('scheduleOut');
  const restOut = document.getElementById('scheduleRestOut');
  const expandBtn = document.getElementById('scheduleExpandBtn');
  out.innerHTML = '';
  restOut.innerHTML = '';

  if (schedule.length === 0) {
    const preview = document.createElement('div');
    preview.className = 'paycheck milestone-debt';
    preview.innerHTML = `
      <div class="milestone-banner milestone-banner-debt">🎉 Debt Paid Off! 🎉</div>
      <p style="text-align:center;color:var(--muted);font-size:0.85rem;margin:4px 0 2px;">Congrats, you're debt free! Or... maybe you need to set up your Budget, Income, and Debt Accounts.</p>
    `;
    out.appendChild(preview);
  }

  // Only the very next upcoming paycheck (the first one not yet checked
  // off) shows by default — everything else lives behind the expand
  // button, so the page opens focused on just what's coming up next.
  let visibleIndices = [];
  for (let i = 0; i < schedule.length; i++) {
    if (!checkedPaychecks[schedule[i].paycheck]) {
      visibleIndices.push(i);
      if (visibleIndices.length >= 1) break;
    }
  }
  if (visibleIndices.length === 0 && schedule.length > 0) {
    visibleIndices = [schedule.length - 1]; // everything's checked off — show the last one
  }
  const visibleIndexSet = new Set(visibleIndices);

  const alreadyDone = new Array(cards.length).fill(false);
  const restOutCheckedDivs = [];

  schedule.forEach((row, rowIdx) => {
    const periodEnd=new Date(row.date);periodEnd.setDate(periodEnd.getDate()+13);
    row.carDebt=window.BearDenCarDebt.carDebtPeriod(window.carDebtForecast||[],dateKey(row.date),dateKey(periodEnd));
    const isDebtFreeCard = debtFreePaycheck !== null && row.paycheck === debtFreePaycheck;
    const isAfterDebtFree = debtFreePaycheck !== null && row.paycheck > debtFreePaycheck;
    const reachedGoalsThisRow = goalsInfo.filter(g => g.reachedPaycheck === row.paycheck);
    const isSavingsGoalCard = reachedGoalsThisRow.length > 0;
    const isChecked = !!checkedPaychecks[row.paycheck];
    const div = document.createElement('div');
    div.id = 'paycheck-card-' + row.paycheck;

    // Accounts paid off in a previous paycheck are omitted from this and
    // future cards entirely — they still get one final appearance (with the
    // PAID OFF badge) on the exact paycheck they're cleared on.
    let lines = '';
    const paidOffNamesThisRow = [];
    // Sort the view only: payment arrays and actions keep their original account index.
    const orderedAccounts=cards.map((c,i)=>({c,i})).sort((a,b)=>(row.balancesBefore[a.i]-row.balancesBefore[b.i])||a.c.name.localeCompare(b.c.name));
    orderedAccounts.forEach(({c,i}) => {
      if (alreadyDone[i]) return;
      if(window.debtPaymentSettings?.mode==='due-date'&&row.payments[i]<=0&&row.balancesBefore[i]>0)return;
      const paid = row.balancesAfter[i] <= 0;
      const justPaidOff = paid && row.payments[i] > 0;
      if (justPaidOff) paidOffNamesThisRow.push(c.name);
      const isPayOverridden = row.paymentOverridden && row.paymentOverridden[i];
      const payInputClass = row.payments[i] > 0.005 ? 'pay-input' : 'pay-input zero';
      const squashSelected=!!paycheckSquashes[row.paycheck]?.[c.id],sliceSelected=!!paycheckSlices[row.paycheck]?.[c.id]&&!squashSelected;
      const sliceAllowance=paycheckActionAllowance(row,i,'slice'),squashAllowance=paycheckActionAllowance(row,i,'squash');
      const sliceTitle=sliceSelected?'Undo Slice':sliceAllowance.allowed?'Pay half the balance at this paycheck, at least the minimum':'Slice needs '+money(sliceAllowance.shortfall)+' more in this paycheck';
      const squashTitle=squashSelected?'Undo Squash':squashAllowance.allowed?'Pay off the full balance, including this paycheck’s projected interest':'Squash needs '+money(squashAllowance.shortfall)+' more in this paycheck';
      lines += `<div class="line paycheck-debt-row" data-paycheck-debt="${bdEscape(c.id)}">
        <span class="name paycheck-debt-name"><span>${bdEscape(c.name)}${isPayOverridden ? ' <span class="edited-tag">edited</span>' : ''}${justPaidOff ? '<span class="paidoff-badge">PAID OFF</span>' : ''}</span>${payoffControlsEnabled?`<span class="paycheck-debt-actions"><button type="button" class="slice-payment" aria-pressed="${sliceSelected}" title="${bdEscape(sliceTitle)}" aria-label="${bdEscape(sliceTitle+' for '+c.name)}" data-bd-click="togglePaycheckSlice(${bdEscape(JSON.stringify(c.id))}, ${row.paycheck})" ${!sliceAllowance.allowed&&!sliceSelected?'disabled':''}>${sliceSelected?'Undo Slice':'Slice'}</button><button type="button" class="slice-payment squash-payment" aria-pressed="${squashSelected}" title="${bdEscape(squashTitle)}" aria-label="${bdEscape(squashTitle+' for '+c.name)}" data-bd-click="togglePaycheckSquash(${bdEscape(JSON.stringify(c.id))}, ${row.paycheck})" ${!squashAllowance.allowed&&!squashSelected?'disabled':''}>${squashSelected?'Undo Squash':'Squash'}</button></span>`:''}</span>
        <div class="paycheck-debt-amounts">
          <div><small>Before</small><span class="balance-before">${money(row.balancesBefore[i])}</span></div>
          <div><small>Interest</small><span class="interest">${money(row.interestByAccount[i])}</span></div>
          <label><small>${row.debtTiming?.[i]?.estimatedMinimum?'Est. payment':'Payment'}</small><input type="number" class="${payInputClass}" aria-label="Payment for ${bdEscape(c.name)}" ${row.sliceMode?`readonly title="${payoffControlsEnabled?'Undo Slice or Squash':'Enable Slice / Squash in Settings, then undo the choice'} to edit this paycheck’s payments"`:''} value="${row.payments[i].toFixed(2)}" step="0.01" data-bd-change="updateAccountPayment(${c.id}, ${row.paycheck}, this.value, ${row.naturalPayments[i]})"></label>
          <div><small>After</small><span class="bal">${money(row.balancesAfter[i])}</span></div>
        </div>
      </div>`;
      if (paid) alreadyDone[i] = true;
    });

    // An individual account paid off is its own milestone, distinct from
    // the whole-debt-free milestone — but when this check IS the debt-free
    // check, every remaining account finishes here too, so we skip the
    // (redundant) account milestone and let the bigger one take over.
    const isAccountPaidOffCard = paidOffNamesThisRow.length > 0 && !isDebtFreeCard;

    div.className = 'paycheck'
      + (isDebtFreeCard ? ' milestone-debt' : (isAccountPaidOffCard ? ' milestone-account' : ''))
      + (isSavingsGoalCard ? ' milestone-savings' : '')
      + (isChecked ? ' completed' : '');

    let milestoneBanner = '';
    let bottomMilestoneBanner = '';
    if (isDebtFreeCard && isSavingsGoalCard) {
      milestoneBanner = `<div class="milestone-banner milestone-both">🎉 Debt Paid Off & ${bdEscape(reachedGoalsThisRow.map(g=>g.name).join(', '))} Reached! 🎉</div>`;
    } else if (isDebtFreeCard) {
      milestoneBanner = `<div class="milestone-banner milestone-banner-debt">🎉 Debt Paid Off! 🎉</div>`;
    } else if (isAccountPaidOffCard && isSavingsGoalCard) {
      milestoneBanner = `<div class="milestone-banner milestone-both">🎉 ${bdEscape(paidOffNamesThisRow.join(', '))} Paid Off & ${bdEscape(reachedGoalsThisRow.map(g=>g.name).join(', '))} Reached! 🎉</div>`;
    } else if (isAccountPaidOffCard) {
      // The standalone account-paid-off milestone is intentionally more
      // subtle than the others, so it sits at the bottom of the card
      // instead of up top with the bigger celebrations.
      bottomMilestoneBanner = `<div class="milestone-banner milestone-banner-account">🎉 ${bdEscape(paidOffNamesThisRow.join(', '))} Paid Off! 🎉</div>`;
    } else if (isSavingsGoalCard) {
      milestoneBanner = `<div class="milestone-banner milestone-banner-savings">💰 ${bdEscape(reachedGoalsThisRow.map(g=>g.name).join(', '))} Reached! 💰</div>`;
    }

    const budgetLines = row.budgetLineItemsThisCheck.map(item => `
      <div class="check-summary-row editable">
        <span>− ${bdEscape(item.label)}${item.isOverridden ? ' <span class="edited-tag">edited</span>' : ''}</span>
        <span class="amount-input-wrap">$<input type="number" class="amount-input" value="${item.amount.toFixed(2)}" step="0.01" data-bd-change="updateBudgetItemAmount(${item.id}, ${row.paycheck}, this.value)"></span>
      </div>
    `).join('');

    const accountBillLines=[...(row.accountBillsThisCheck||[])].sort((a,b)=>a.amount-b.amount||a.name.localeCompare(b.name)).map(bill=>`<div class="check-summary-row paycheck-account-bill"><span>− ${bdEscape(bill.name)}<small>${bill.transfer?'Transfer to shared bills account':'Due '+fmtDate(new Date(bill.date+'T00:00:00'))}</small></span><span>${money(bill.amount/100)}</span></div>${bill.transfer?`<details class="paycheck-shared-details" data-paycheck-date="${bdEscape(bill.date)}"><summary>Shared bills & contributions</summary><div class="paycheck-shared-content"><div class="paycheck-shared-balances" aria-live="polite"></div><p>Your Fixed Bills amount above is your only deduction for these shared bills.</p>${[...(bill.sharedBills||[])].sort((a,b)=>a.amount-b.amount||a.name.localeCompare(b.name)).map(b=>`<div class="check-summary-row"><span>${bdEscape(b.name)}<small>${fmtDate(new Date(b.date+'T00:00:00'))}</small></span><span class="cash-outgoing">${money(b.amount/100)}</span></div>`).join('')}${(bill.spouseContributions||[]).map(c=>`<div class="check-summary-row"><span>Spouse contribution<small>${fmtDate(new Date(c.date+'T00:00:00'))}</small></span><span class="cash-incoming">+${money(c.amount/100)}</span></div>`).join('')}</div></details>`:''}`).join('');
    const extraExpenseLines = row.extrasThisCheck.map(e => `
      <div class="check-summary-row"><span>− ${bdEscape(e.label)} <span class="edited-tag" style="background:#fdf1e6;color:#a15f22;">one-time</span></span><span class="amount-input-wrap">${money(e.amount)}<span class="remove" style="margin-left:6px;" data-bd-click="removeExtraExpense(${row.paycheck}, ${e.id})">✕</span></span></div>
    `).join('');
    const extraExpenseControl = extraExpenseInputOpenForPaycheck === row.paycheck
      ? `<div class="extra-expense-input">
           <input type="text" id="extraExpenseLabel-${row.paycheck}" placeholder="What for?">
           <div class="ee-amount-row">
             <span>$</span><input type="number" id="extraExpenseAmount-${row.paycheck}" placeholder="0.00" step="0.01">
             <button data-bd-click="addExtraExpenseToPaycheck(${row.paycheck})">Add</button>
           </div>
         </div>`
      : `<button class="bonus-inline-btn" style="border-color:#d98b4f;background:#fdf1e6;color:#a15f22;" data-bd-click="toggleExtraExpenseInput(${row.paycheck})">🧾 Add One-Time Expense</button>`;

    const savingsLines = savingsEnabled ? row.savingsByGoal.map(g => `
      <div class="check-summary-row editable">
        <span>${bdEscape(g.name)} contribution${g.isOverridden ? ' <span class="edited-tag">edited</span>' : ''}</span>
        <span class="amount-input-wrap">$<input type="number" class="amount-input" value="${g.contribution.toFixed(2)}" step="0.01" data-bd-change="updateSavingsContribution(${g.id}, ${row.paycheck}, this.value)"></span>
      </div>
    `).join('') : '';

    // Accounts section: only show the "all paid off" placeholder once, right
    // on the debt-free card — future cards past that point skip it entirely
    // since the bottom section below switches to showing savings instead.
    let accountsSection = '';
    if (lines) {
      accountsSection = lines;
    } else if (!isAfterDebtFree&&!(window.carDebtForecast||[]).length) {
      accountsSection = `<p style="text-align:center;color:var(--muted);font-size:0.8rem;padding:6px 0;">${row.balancesBefore.some(n=>n>0)?'No debt payment scheduled for this paycheck.':'All accounts paid off 🎉'}</p>`;
    }

    if(!isChecked&&row.balancesBefore.some(n=>n>0))accountsSection+=`<button type="button" class="add-debt-payment" data-add-debt-payment="${row.paycheck}">+ Add debt payment</button>`;
    const timingWarnings=(row.debtTiming||[]).flatMap((t,i)=>row.balancesBefore[i]>0&&t.missingDate?[cards[i].name+': add a due date; paying every paycheck for now.']:row.balancesBefore[i]>0&&t.late?[cards[i].name+': this paycheck is inside your payment buffer. Pay promptly.']:[]);
    if(row.cashAfterDebt<-.005)timingWarnings.push('This paycheck is short by '+money(-row.cashAfterDebt)+'. Adjust your plan to cover the payments.');
    if(timingWarnings.length)accountsSection+='<p class="subtle" role="status">'+timingWarnings.map(bdEscape).join('<br>')+'</p>';

    // Bottom summary: debt-reduction + total remaining debt while debt is
    // still being paid off (through and including the debt-free card
    // itself); the savings total shows alongside it whenever savings
    // tracking is enabled, on every card — before and after debt-free.
    let bottomSection = '';
    if (!isAfterDebtFree) {
      bottomSection += `
      <div class="line" style="padding:4px 0;">
        <span>💸 Interest charged this check</span>
        <span style="color:var(--warn);font-weight:600;">${row.carDebt.interest===null?'Unavailable':money(row.interestThisCheck+row.carDebt.interest/100)}</span>
      </div>
      <div class="line debt-reduction-line">
        <span>⬇ Debt reduced this check</span>
        <span style="color:var(--accent);font-weight:700;">${row.carDebt.reduction===null?'Unavailable':money(row.debtReduction+row.carDebt.reduction/100)}</span>
      </div>
      <div class="line" style="border-top:1px solid var(--line);margin-top:6px;padding-top:8px;">
        <span style="font-weight:700;">Total remaining debt</span>
        <span style="font-weight:700;">${row.carDebt.balance===null?'Unavailable':money(row.total+row.carDebt.balance/100)}</span>
      </div>`;
    }
    if (savingsEnabled) {
      const totalSavings = row.savingsByGoal.reduce((a,g)=>a+g.balance,0);
      bottomSection += `
      <div class="line" style="border-top:1px solid var(--line);margin-top:6px;padding-top:8px;">
        <span style="font-weight:700;">Savings total</span>
        <span style="font-weight:700;color:var(--accent);">${money(totalSavings)}</span>
      </div>`;
    }

    div.innerHTML = `
      ${milestoneBanner}
      <div class="paycheck-head">
        <span class="checkbox-wrap">
          <input type="checkbox" id="chk-${row.paycheck}" ${isChecked ? 'checked' : ''} data-bd-change="toggleChecked(${row.paycheck}, this.checked)">
          <span class="date">Paycheck ${row.paycheck} — ${fmtDate(row.date)}${row.isBonus ? '<span class=\"bonus-tag\">Bonus</span>' : ''}</span>
        </span>
      </div>
      <div class="check-summary">
        <div class="check-summary-row editable paycheck-income">
          <span>Paycheck amount (after taxes)${row.isOverridden ? ' <span class="edited-tag">edited</span>' : ''}</span>
          <span class="amount-input-wrap">$<input type="number" class="amount-input" value="${row.takeHomeThisCheck.toFixed(2)}" step="0.01" data-bd-change="updatePaycheckAmount(${row.paycheck}, this.value)"></span>
        </div>
        ${row.bonusAmount > 0 ? `
        <div class="check-summary-row bonus-row"><span>🎁 + Bonus (after taxes)</span><span>${money(row.bonusAmount)}</span></div>
        ${bonusControlsEnabled?`<div style="text-align:right;margin:2px 0 4px;"><span class="remove" data-bd-click="removeBonusFromPaycheck(${row.paycheck})">Remove bonus</span></div>`:''}
        <div class="check-summary-row prominent-row"><span>Total this paycheck (after taxes)</span><span>${money(row.takeHomeThisCheck + row.bonusAmount)}</span></div>
        ` : (
          !bonusControlsEnabled ? '' : bonusInputOpenForPaycheck === row.paycheck
            ? `<div class="bonus-inline-input">
                 <span>$</span><input type="number" id="bonusInlineAmount-${row.paycheck}" placeholder="Before-tax amount" aria-label="Before-tax bonus" min="0.01" step="0.01">
                 <button data-bd-click="applyBonusToPaycheck(${row.paycheck})">Apply</button>
               </div>
               <div style="font-size:0.68rem;color:var(--muted);margin:-2px 0 4px;">${bonusEstimateNote()}</div>`
            : `<button class="bonus-inline-btn" data-bd-click="toggleBonusInlineInput(${row.paycheck})">🎁 Add Bonus</button>`
        )}
        ${budgetLines}
        ${accountBillLines?`<div class="paycheck-bills-heading">Bills from Accounts</div>${accountBillLines}`:''}
        ${extraExpenseLines}
        ${extraExpenseControl}
        <div class="check-summary-row prominent-row"><span>Left over after budget and bills</span><span>${money(row.avail)}</span></div>
        ${row.budgetShortfall>0?`<p class="forecast-warning">Budget and bills exceed this paycheck by ${money(row.budgetShortfall)}.</p>`:''}
        ${savingsEnabled ? `
        ${savingsLines}
        <div class="check-summary-row prominent-row"><span>Left over after savings</span><span>${money(row.availAfterSavings)}</span></div>
        ` : ''}
      </div>
      ${row.payoffActionsPaused?'<div class="paycheck-slice-note payoff-paused" role="status">Slice / Squash paused<span>Needs '+money(row.payoffActionShortfall)+' more this paycheck. Using minimums for now.</span></div>':row.sliceMode?'<div class="paycheck-slice-note">'+[row.sliced.some(Boolean)?'Slice':'',row.squashed.some(Boolean)?'Squash':'','minimums'].filter(Boolean).join(' + ')+'<span>Other debts stay at their minimum.</span></div>':''}
      ${accountsSection}
      <div class="line paycheck-cash-left"><span>${row.cashAfterDebt<-.005?'Extra needed for debt payments':'Left after debt payments'}</span><strong class="${row.cashAfterDebt<-.005?'overdue':''}">${money(Math.abs(row.cashAfterDebt))}</strong></div>
      ${bottomSection}
      ${bottomMilestoneBanner}
      <div class="paycheck-bear-scene">
        <div class="paycheck-bear" aria-hidden="true">
          <div class="paycheck-bear-wings"></div>
          <div class="paycheck-bear-body"></div>
          <div class="paycheck-bear-head">
            <div class="paycheck-bear-hat"></div>
            <div class="paycheck-bear-fangs"></div>
            <div class="paycheck-bear-horns"></div>
          </div>
          <div class="paycheck-bear-arm"></div>
          <div class="paycheck-bear-rude-hand"></div>
          <div class="paycheck-bear-walk-profile"></div>
          <div class="paycheck-bear-walk-hat"></div>
          <div class="paycheck-bear-walk-horns"></div>
          <div class="paycheck-bear-walk-fangs"></div>
          <div class="paycheck-bear-bubble">Grrr</div>
        </div>
        <div class="honey-pot" aria-hidden="true">
          <div class="honey-pot-intact"></div>
          <div class="honey-pot-broken"></div>
        </div>
        <div class="christmas-tree" aria-hidden="true">
          <div class="christmas-tree-intact"></div>
          <div class="christmas-tree-dark"></div>
        </div>
        <div class="bear-skull" aria-hidden="true">
          <div class="bear-skull-intact"></div>
          <div class="bear-skull-broken"></div>
        </div>
      </div>
    `;
    if (visibleIndexSet.has(rowIdx)) {
      out.appendChild(div);
    } else if (checkedPaychecks[row.paycheck]) {
      restOutCheckedDivs.push(div);
    } else {
      restOut.appendChild(div);
    }
  });

  // Checked-off cards sink to the very bottom of the expanded list instead
  // of staying interleaved in chronological order — everything above this
  // point (already appended) is upcoming/unchecked.
  restOutCheckedDivs.forEach(d => restOut.appendChild(d));

  // A second "close" button right at the bottom of the expanded list, so
  // closing it doesn't require scrolling back up to the top button —
  // fires the exact same toggle as the one above the list.
  if (restOut.children.length > 0) {
    const closeBtn = document.createElement('button');
    closeBtn.className = 'schedule-expand-btn schedule-close-btn';
    closeBtn.textContent = '▴ Close Schedule';
    closeBtn.onclick = toggleScheduleExpanded;
    restOut.appendChild(closeBtn);
  }

  const restCount = schedule.length - visibleIndices.length;
  if (restCount > 0) {
    expandBtn.style.display = 'block';
    expandBtn.textContent = scheduleExpanded ? '▴ Hide full schedule' : `▾ Show full schedule (${restCount} more)`;
    restOut.classList.toggle('open', scheduleExpanded);
  } else {
    expandBtn.style.display = 'none';
    restOut.classList.remove('open');
  }
}

// Peeking header bear: pops up along the top of the active tab banner
// each cycle, and glares angrily (a sharp shake + "Grrr" bubble) on tap.
const initializedHeroBears=new WeakSet();
function setupHeroBear(root=document){
  root.querySelectorAll('.hero-bear').forEach(bear => {
  if(initializedHeroBears.has(bear))return;
  initializedHeroBears.add(bear);

  function moveToRandomSpot(){
    // Keep clear of the rounded corners at either end (roughly 6%-78%
    // of the box width, leaving room for the bear's own 64px width).
    const pct = (6 + Math.random() * 72).toFixed(1);
    bear.style.left = pct + '%';
  }

  moveToRandomSpot();
  // The animation is fully hidden (translateY 60px) at both the start
  // and end of each loop, so repositioning right on the loop boundary
  // never causes a visible jump.
  bear.addEventListener('animationiteration', (e) => {
    if (e.animationName === 'bearPopUpDown') moveToRandomSpot();
  });

  let angryTimer = null;
  let restTimer = null;
  bear.addEventListener('click', () => {
    if (bear.classList.contains('angry') || bear.classList.contains('resting')) return;
    bear.classList.add('angry');
    clearTimeout(angryTimer);
    clearTimeout(restTimer);
    // Shake plays once (0.5s) then he just holds still with the angry
    // face and "Grrr" bubble for a good while longer before reverting.
    angryTimer = setTimeout(() => {
      bear.classList.remove('angry');
      // Cool off completely out of sight for a while, then pick a fresh
      // spot before he's allowed to pop back up.
      bear.classList.add('resting');
      restTimer = setTimeout(() => {
        moveToRandomSpot();
        bear.classList.remove('resting');
      }, 10000);
    }, 3200);
  });
  });
}

// Paycheck-card bears: tap makes one angry (grrr + arm flip), then he
// turns and stomps off the edge of his card and stays gone for 15s.
// Tapping the prop next to him (honey pot, or its Christmas tree /
// Halloween skull equivalent) triggers the same reaction with a
// different message — that's what actually set him off. The cards
// themselves get re-rendered on every recalculation, so this uses one
// delegated listener instead of binding to each bear/prop directly.
const paycheckBearTimers = new WeakMap();

function triggerPaycheckBearAngry(bear, message){
  if (bear.classList.contains('angry') || bear.classList.contains('walking')) return;
  const bubble = bear.querySelector('.paycheck-bear-bubble');
  if (bubble) bubble.textContent = message;
  bear.classList.add('angry');

  const walkTimer = setTimeout(() => {
    const card = bear.closest('.paycheck');
    if (card) {
      const cardRect = card.getBoundingClientRect();
      const bearRect = bear.getBoundingClientRect();
      // Walk toward whichever edge is closer, clearing it fully.
      const distToRight = cardRect.right - bearRect.right;
      const distToLeft = bearRect.left - cardRect.left;
      const walkingRight = distToRight <= distToLeft;
      const dist = walkingRight ? (distToRight + 70) : -(distToLeft + 70);
      bear.style.setProperty('--walk-dist', dist + 'px');
      // The side-profile art is drawn facing right; mirror it when
      // he's headed for the left edge instead.
      bear.style.setProperty('--walk-scale', walkingRight ? '1' : '-1');
    }
    bear.classList.add('walking');

    // Once the walk-off animation finishes he's fully out of sight —
    // that's when the 15s absence actually starts counting.
    const goneTimer = setTimeout(() => {
      const resetTimer = setTimeout(() => {
        bear.classList.remove('angry', 'walking');
        bear.style.removeProperty('--walk-dist');
        bear.style.removeProperty('--walk-scale');
        if (bubble) bubble.textContent = 'Grrr';
        // Reset the honey pot/tree/skull alongside him, so it's back in
        // one piece by the time he reappears — only one is visible at a
        // time (the others stay display:none), but reset all three so
        // whichever was actually tapped comes back intact even if the
        // holiday theme changes while he's away.
        const card2 = bear.closest('.paycheck');
        const props = card2 ? card2.querySelectorAll('.honey-pot, .christmas-tree, .bear-skull') : [];
        props.forEach(p => p.classList.remove('broken', 'shaking'));
      }, 15000);
      paycheckBearTimers.set(bear, resetTimer);
    }, 1400);
    paycheckBearTimers.set(bear, goneTimer);
  }, 900);
  paycheckBearTimers.set(bear, walkTimer);
}

function setupPaycheckBears(){
  document.body.addEventListener('click', (e) => {
    const bear = e.target.closest('.paycheck-bear');
    if (bear) {
      triggerPaycheckBearAngry(bear, 'Grrr');
      return;
    }

    const prop = e.target.closest('.honey-pot, .christmas-tree, .bear-skull');
    if (prop) {
      if (prop.classList.contains('broken')) return;
      const card = prop.closest('.paycheck');
      const bearEl = card && card.querySelector('.paycheck-bear');
      prop.classList.add('shaking');
      setTimeout(() => {
        prop.classList.remove('shaking');
        prop.classList.add('broken');
      }, 250);
      if (bearEl) triggerPaycheckBearAngry(bearEl, "That's rude!");
    }
  });
}

// ---- Bear Run: a Chrome-Dino-style endless runner living in its own hero
// card. Everything (physics, spawning, drawing) is plain canvas 2D — no
// image assets, the bear and every obstacle are drawn as vector shapes
// each frame so they can be recolored per holiday theme for free. Wrapped
// in an IIFE so its many small helpers don't leak into the global scope;
// only setupBearRunnerGame() and bearRunnerOnHolidayChange() are exposed,
// for init() and the holiday theme switcher to call respectively.
(function(){
  let wrap, canvas, ctx, overlay, overlayTitle, overlaySub, scoreCurrentEl, scoreBestEl;
  let width = 0, height = 0, groundY = 0;
  let state = 'idle'; // 'idle' | 'playing' | 'gameover'
  let bestScore = 0;
  let rafId = null;
  let lastFrameTime = null;

  const bear = { x: 26, y: 0, vy: 0, w: 34, h: 36, onGround: true, legPhase: 0, legTimer: 0 };
  let obstacles = [];
  let speed = 230;
  let elapsed = 0;
  let spawnTimer = 0;
  let nextSpawnIn = 1.2;
  let snowDots = [];
  let bats = [];

  const GRAVITY = 1700;
  const JUMP_VELOCITY = -480;
  const MAX_SPEED = 480;

  function currentHoliday(){
    return document.documentElement.getAttribute('data-holiday') || 'standard';
  }

  function palette(){
    const h = currentHoliday();
    if (h === 'christmas') return {
      ground: '#dff0e4', groundLine: '#bcdcc4',
      obstacle: { trunk:'#6b4423', low:'#1e6b3f', mid:'#22894f', top:'#2ea360', star:'#ffd23f' }
    };
    if (h === 'halloween') return {
      ground: '#3a2350', groundLine: '#241831',
      obstacle: { bone:'#efe8d4', socket:'#2a1c10', outline:'#c7bfa0' }
    };
    return {
      ground: '#e8dcc8', groundLine: '#d8c8a8',
      obstacle: { pot:'#c96f4a', rim:'#6b4423', lid:'#8a5a34' }
    };
  }

  function initParticles(){
    snowDots = Array.from({ length: 16 }, () => ({
      x: Math.random() * 500, y: Math.random() * 140, r: 1 + Math.random() * 1.6, s: 12 + Math.random() * 14
    }));
    bats = [
      { baseX: 70, baseY: 26, phase: 0 },
      { baseX: 210, baseY: 44, phase: 2.1 },
    ];
  }

  function resize(){
    if (!wrap || !canvas) return;
    const rect = wrap.getBoundingClientRect();
    width = Math.max(220, rect.width);
    height = 170;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    groundY = height - 28;
    bear.y = groundY - bear.h;
    drawStaticFrame();
  }

  function resetRun(){
    bear.y = groundY - bear.h;
    bear.vy = 0;
    bear.onGround = true;
    bear.legPhase = 0;
    bear.legTimer = 0;
    obstacles = [];
    speed = 230;
    elapsed = 0;
    spawnTimer = 0;
    nextSpawnIn = 1.1 + Math.random() * 0.6;
  }

  function startGame(){
    resetRun();
    state = 'playing';
    overlay.classList.remove('show');
    lastFrameTime = null;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  function endGame(){
    state = 'gameover';
    const score = Math.floor(elapsed * 10);
    if (score > bestScore) {
      bestScore = score;
      scoreBestEl.textContent = bestScore;
      try { storage.set('runnerHighScore', String(bestScore)); } catch (e) {}
    }
    overlayTitle.textContent = 'Game Over';
    overlaySub.textContent = `Score ${score} — tap to try again`;
    overlay.classList.add('show');
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    drawStaticFrame();
  }

  function jump(){
    if (state === 'idle' || state === 'gameover') { startGame(); return; }
    if (state === 'playing' && bear.onGround) {
      bear.vy = JUMP_VELOCITY;
      bear.onGround = false;
    }
  }

  function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh){
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function spawnObstacle(){
    const w = 20 + Math.random() * 10;
    const h = 26 + Math.random() * 14;
    obstacles.push({ x: width + 10, y: groundY - h, w, h });
  }

  function loop(ts){
    if (state !== 'playing') return;
    if (lastFrameTime === null) lastFrameTime = ts;
    let dt = (ts - lastFrameTime) / 1000;
    lastFrameTime = ts;
    dt = Math.min(dt, 0.05); // clamp so a backgrounded-tab pause doesn't cause a huge catch-up jump

    elapsed += dt;
    speed = Math.min(MAX_SPEED, 230 + elapsed * 14);

    bear.vy += GRAVITY * dt;
    bear.y += bear.vy * dt;
    if (bear.y >= groundY - bear.h) {
      bear.y = groundY - bear.h;
      bear.vy = 0;
      bear.onGround = true;
    }

    if (bear.onGround) {
      bear.legTimer += dt;
      if (bear.legTimer > 0.13) { bear.legTimer = 0; bear.legPhase = 1 - bear.legPhase; }
    }

    spawnTimer += dt;
    if (spawnTimer >= nextSpawnIn) {
      spawnTimer = 0;
      nextSpawnIn = Math.max(0.7, 1.3 - elapsed * 0.01) + Math.random() * 0.5;
      spawnObstacle();
    }

    obstacles.forEach(o => { o.x -= speed * dt; });
    obstacles = obstacles.filter(o => o.x + o.w > -10);

    for (const o of obstacles) {
      // A few px of forgiveness inset on both boxes so near-misses don't
      // feel unfair against the bear's rounded silhouette.
      if (rectsOverlap(bear.x + 6, bear.y + 6, bear.w - 12, bear.h - 10, o.x + 3, o.y + 3, o.w - 6, o.h - 6)) {
        endGame();
        return;
      }
    }

    draw();
    scoreCurrentEl.textContent = Math.floor(elapsed * 10);
    rafId = requestAnimationFrame(loop);
  }

  function drawBackground(){
    const h = currentHoliday();
    if (h === 'christmas') {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      snowDots.forEach(d => {
        if (state === 'playing') {
          d.y += d.s * (1/60);
          if (d.y > groundY) { d.y = -4; d.x = Math.random() * width; }
        }
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
      });
    } else if (h === 'halloween') {
      ctx.fillStyle = 'rgba(15,8,22,0.55)';
      const t = Date.now() / 1000;
      bats.forEach(b => {
        const x = b.baseX + Math.sin(t * 1.4 + b.phase) * 14;
        const y = b.baseY + Math.sin(t * 2.6 + b.phase) * 5;
        drawBat(x, y);
      });
    }
  }

  function drawBat(x, y){
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x - 10, y - 7, x - 15, y);
    ctx.quadraticCurveTo(x - 7, y - 1, x, y + 3);
    ctx.quadraticCurveTo(x + 7, y - 1, x + 15, y);
    ctx.quadraticCurveTo(x + 10, y - 7, x, y);
    ctx.fill();
  }

  function drawGround(){
    const p = palette();
    ctx.fillStyle = p.ground;
    ctx.fillRect(0, groundY, width, height - groundY);
    ctx.strokeStyle = p.groundLine;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(width, groundY);
    ctx.stroke();
  }

  function drawObstacle(o){
    const h = currentHoliday();
    ctx.save();
    ctx.translate(o.x, o.y);
    if (h === 'christmas') drawTreeObstacle(o.w, o.h);
    else if (h === 'halloween') drawSkullObstacle(o.w, o.h);
    else drawPotObstacle(o.w, o.h);
    ctx.restore();
  }

  function drawTreeObstacle(w, h){
    const p = palette().obstacle;
    ctx.fillStyle = p.trunk;
    ctx.fillRect(w * 0.4, h * 0.82, w * 0.2, h * 0.18);
    ctx.fillStyle = p.low;
    ctx.beginPath(); ctx.moveTo(w / 2, h * 0.5); ctx.lineTo(0, h * 0.85); ctx.lineTo(w, h * 0.85); ctx.closePath(); ctx.fill();
    ctx.fillStyle = p.mid;
    ctx.beginPath(); ctx.moveTo(w / 2, h * 0.25); ctx.lineTo(w * 0.12, h * 0.58); ctx.lineTo(w * 0.88, h * 0.58); ctx.closePath(); ctx.fill();
    ctx.fillStyle = p.top;
    ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w * 0.22, h * 0.32); ctx.lineTo(w * 0.78, h * 0.32); ctx.closePath(); ctx.fill();
    ctx.fillStyle = p.star;
    ctx.beginPath(); ctx.arc(w / 2, -2, 2.4, 0, Math.PI * 2); ctx.fill();
  }

  function drawSkullObstacle(w, h){
    const p = palette().obstacle;
    ctx.fillStyle = p.bone;
    ctx.strokeStyle = p.outline;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(w / 2, h * 0.45, w / 2, Math.PI, 0);
    ctx.lineTo(w, h * 0.75);
    ctx.quadraticCurveTo(w / 2, h, 0, h * 0.75);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = p.socket;
    ctx.beginPath(); ctx.ellipse(w * 0.32, h * 0.48, w * 0.13, h * 0.15, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(w * 0.68, h * 0.48, w * 0.13, h * 0.15, 0, 0, Math.PI * 2); ctx.fill();
  }

  function drawPotObstacle(w, h){
    const p = palette().obstacle;
    ctx.fillStyle = p.rim;
    ctx.fillRect(w * 0.15, 0, w * 0.7, h * 0.16);
    ctx.fillStyle = p.pot;
    ctx.beginPath();
    ctx.moveTo(w * 0.22, h * 0.16);
    ctx.quadraticCurveTo(0, h * 0.55, w * 0.1, h * 0.85);
    ctx.quadraticCurveTo(w / 2, h, w * 0.9, h * 0.85);
    ctx.quadraticCurveTo(w, h * 0.55, w * 0.78, h * 0.16);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = p.lid;
    ctx.fillRect(w * 0.1, 0, w * 0.8, h * 0.09);
  }

  function drawBearSprite(x, y, jumping, legPhase){
    const holiday = currentHoliday();
    const w = bear.w, h = bear.h;
    ctx.save();
    ctx.translate(x, y);

    // Legs — short and a bit chunky rather than thin, to read as a stocky
    // bear instead of a lean, long-legged dog.
    ctx.fillStyle = '#8a5a34';
    if (!jumping) {
      if (legPhase === 0) {
        ctx.fillRect(w * 0.16, h * 0.82, w * 0.2, h * 0.18);
        ctx.fillRect(w * 0.56, h * 0.74, w * 0.2, h * 0.26);
      } else {
        ctx.fillRect(w * 0.16, h * 0.74, w * 0.2, h * 0.26);
        ctx.fillRect(w * 0.56, h * 0.82, w * 0.2, h * 0.18);
      }
    } else {
      ctx.fillRect(w * 0.2, h * 0.8, w * 0.18, h * 0.18);
      ctx.fillRect(w * 0.58, h * 0.8, w * 0.18, h * 0.18);
    }

    // Body — round and chunky, sitting low and wide.
    ctx.fillStyle = '#c9955f';
    ctx.beginPath(); ctx.ellipse(w * 0.46, h * 0.62, w * 0.4, h * 0.32, 0, 0, Math.PI * 2); ctx.fill();

    // Head — a big round head held close against the body, which along
    // with the ears below is what actually reads as "bear" instead of a
    // longer-muzzled, side-eared dog profile.
    ctx.beginPath(); ctx.arc(w * 0.56, h * 0.28, w * 0.33, 0, Math.PI * 2); ctx.fill();

    // Ears — set close together on TOP of the head (not out at head
    // height to the sides), each with a lighter inner-ear circle like
    // every other bear in the app.
    ctx.fillStyle = '#8a5a34';
    ctx.beginPath(); ctx.arc(w * 0.4, h * 0.04, w * 0.13, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(w * 0.68, h * 0.02, w * 0.13, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8c9a0';
    ctx.beginPath(); ctx.arc(w * 0.4, h * 0.05, w * 0.06, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(w * 0.68, h * 0.03, w * 0.06, 0, Math.PI * 2); ctx.fill();

    // Snout — round and centered on the lower face, not a small oval
    // stuck off to one side.
    ctx.fillStyle = '#f0dcc0';
    ctx.beginPath(); ctx.ellipse(w * 0.58, h * 0.36, w * 0.19, h * 0.14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2a1c10';
    ctx.beginPath(); ctx.arc(w * 0.63, h * 0.34, w * 0.035, 0, Math.PI * 2); ctx.fill();

    // Two eyes rather than one, for a friendlier, more recognizably bear
    // face.
    ctx.beginPath(); ctx.arc(w * 0.46, h * 0.22, w * 0.032, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(w * 0.62, h * 0.2, w * 0.032, 0, Math.PI * 2); ctx.fill();

    if (holiday === 'christmas') {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.ellipse(w * 0.54, h * 0.0, w * 0.24, h * 0.05, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#d1272f';
      ctx.beginPath();
      ctx.moveTo(w * 0.36, h * 0.0);
      ctx.quadraticCurveTo(w * 0.5, -h * 0.3, w * 0.76, -h * 0.14);
      ctx.quadraticCurveTo(w * 0.66, h * 0.0, w * 0.72, h * 0.04);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(w * 0.74, -h * 0.12, w * 0.06, 0, Math.PI * 2); ctx.fill();
    } else if (holiday === 'halloween') {
      ctx.fillStyle = '#a31212';
      ctx.beginPath(); ctx.moveTo(w * 0.38, h * 0.02); ctx.lineTo(w * 0.32, -h * 0.16); ctx.lineTo(w * 0.44, -h * 0.02); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(w * 0.66, h * 0.0); ctx.lineTo(w * 0.74, -h * 0.18); ctx.lineTo(w * 0.74, h * 0.0); ctx.closePath(); ctx.fill();
    }

    ctx.restore();
  }

  function drawStaticFrame(){
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    drawBackground();
    drawGround();
    drawBearSprite(bear.x, groundY - bear.h, false, 0);
  }

  function draw(){
    ctx.clearRect(0, 0, width, height);
    drawBackground();
    drawGround();
    obstacles.forEach(o => drawObstacle(o));
    drawBearSprite(bear.x, bear.y, !bear.onGround, bear.legPhase);
  }

  function debounce(fn, ms){
    let t;
    return function(...args){ clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
  }

  function onPointerDown(e){
    e.preventDefault();
    jump();
  }

  function onKeydown(e){
    if (e.code !== 'Space' && e.code !== 'ArrowUp') return;
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    jump();
  }

  function setupBearRunnerGame(){
    wrap = document.getElementById('runnerGameWrap');
    canvas = document.getElementById('runnerCanvas');
    if (!wrap || !canvas) return;
    ctx = canvas.getContext('2d');
    overlay = document.getElementById('runnerOverlay');
    overlayTitle = document.getElementById('runnerOverlayTitle');
    overlaySub = document.getElementById('runnerOverlaySub');
    scoreCurrentEl = document.getElementById('runnerScoreCurrent');
    scoreBestEl = document.getElementById('runnerScoreBest');

    initParticles();
    resize();
    window.addEventListener('resize', debounce(resize, 200));

    wrap.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeydown);

    // Stop requesting frames while the tab is hidden (rather than letting
    // a huge deltaTime pile up), and pick the loop back up cleanly on
    // return instead of the bear appearing to teleport through obstacles.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
      } else if (state === 'playing' && !rafId) {
        lastFrameTime = null;
        rafId = requestAnimationFrame(loop);
      }
    });

    storage.get('runnerHighScore').then(res => {
      if (res && res.value) {
        bestScore = parseInt(res.value, 10) || 0;
        scoreBestEl.textContent = bestScore;
      }
    }).catch(() => {});
  }

  window.setupBearRunnerGame = setupBearRunnerGame;
  // The wrap sits inside a display:none section until the games toggle is
  // opened, so its very first resize() at setup time measures a
  // zero-width box. Re-running resize() once the section is actually
  // shown fixes the canvas up to the real card width.
  window.bearRunnerRefreshSize = resize;
  window.bearRunnerOnHolidayChange = function(){
    initParticles();
    if (state !== 'playing') drawStaticFrame();
  };
})();

// ---- Bear Crush: a small match-3 grid living in its own hero card,
// under Bear Run. Plain DOM tiles (not canvas) — a 6x6 CSS grid of
// emoji, since match-3 benefits from simple click handling and CSS
// transitions far more than it needs per-pixel drawing. Wrapped in its
// own IIFE for the same reason as the runner game: keep its helpers out
// of the global scope, only setupBearCrushGame(), restartBearCrush(),
// and bearCrushOnHolidayChange() are exposed.
(function(){
  const ROWS = 6, COLS = 6;
  let gridEl, scoreEl, bestEl, hintEl;
  let board = [];
  let selected = null;
  let busy = false;
  let scoreVal = 0;
  let bestScoreVal = 0;
  let comboMultiplier = 1;

  function idx(r, c){ return r * COLS + c; }

  function currentCrushHoliday(){
    return document.documentElement.getAttribute('data-holiday') || 'standard';
  }

  // Bear stays constant across every theme as the mascot; the other four
  // treats swap to match the holiday.
  function candyTypes(){
    const h = currentCrushHoliday();
    if (h === 'christmas') return ['🐻', '🎄', '🎁', '⛄', '⭐'];
    if (h === 'halloween') return ['🐻', '🎃', '👻', '🦇', '🍬'];
    return ['🐻', '🍯', '🐟', '🍓', '🌰'];
  }

  function randomType(){
    return Math.floor(Math.random() * candyTypes().length);
  }

  function swapVals(a, b){
    const t = board[a]; board[a] = board[b]; board[b] = t;
  }

  // Fills the board avoiding any pre-existing 3-in-a-row so a fresh board
  // (or a reshuffle) never starts with a free match already sitting on it.
  function generateBoard(){
    const b = new Array(ROWS * COLS);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        let t, tries = 0;
        do {
          t = randomType();
          tries++;
        } while (tries < 25 && (
          (c >= 2 && b[idx(r, c - 1)] === t && b[idx(r, c - 2)] === t) ||
          (r >= 2 && b[idx(r - 1, c)] === t && b[idx(r - 2, c)] === t)
        ));
        b[idx(r, c)] = t;
      }
    }
    return b;
  }

  // Scans every row and column for runs of 3+ identical values and
  // returns the set of matched cell indices (both directions combined,
  // so an L/T-shaped match is treated as a single resolve).
  function findMatches(){
    const matched = new Set();
    for (let r = 0; r < ROWS; r++) {
      let runStart = 0;
      for (let c = 1; c <= COLS; c++) {
        const continues = c < COLS && board[idx(r, c)] === board[idx(r, runStart)];
        if (!continues) {
          if (c - runStart >= 3) {
            for (let k = runStart; k < c; k++) matched.add(idx(r, k));
          }
          runStart = c;
        }
      }
    }
    for (let c = 0; c < COLS; c++) {
      let runStart = 0;
      for (let r = 1; r <= ROWS; r++) {
        const continues = r < ROWS && board[idx(r, c)] === board[idx(runStart, c)];
        if (!continues) {
          if (r - runStart >= 3) {
            for (let k = runStart; k < r; k++) matched.add(idx(k, c));
          }
          runStart = r;
        }
      }
    }
    return matched;
  }

  // Drops remaining tiles in each column down to fill any gaps left by a
  // resolved match, then fills the newly-empty spots at the top with
  // fresh random tiles — the classic match-3 "gravity" step.
  function collapseColumns(){
    for (let c = 0; c < COLS; c++) {
      const stack = [];
      for (let r = ROWS - 1; r >= 0; r--) {
        if (board[idx(r, c)] !== null) stack.push(board[idx(r, c)]);
      }
      for (let r = ROWS - 1; r >= 0; r--) {
        board[idx(r, c)] = stack.length ? stack.shift() : randomType();
      }
    }
  }

  // Checks every possible adjacent swap to see if any would produce a
  // match — used to catch a stuck board and trigger a reshuffle instead
  // of leaving the person with no legal moves.
  function hasValidMove(){
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (c < COLS - 1) {
          swapVals(idx(r, c), idx(r, c + 1));
          const has = findMatches().size > 0;
          swapVals(idx(r, c), idx(r, c + 1));
          if (has) return true;
        }
        if (r < ROWS - 1) {
          swapVals(idx(r, c), idx(r + 1, c));
          const has = findMatches().size > 0;
          swapVals(idx(r, c), idx(r + 1, c));
          if (has) return true;
        }
      }
    }
    return false;
  }

  function renderBoard(allDropped){
    const types = candyTypes();
    gridEl.innerHTML = '';
    for (let i = 0; i < board.length; i++) {
      const tile = document.createElement('div');
      tile.className = 'crush-tile';
      if (selected === i) tile.classList.add('selected');
      if (allDropped) tile.classList.add('dropped');
      tile.textContent = types[board[i]] || '';
      tile.addEventListener('click', () => onTileClick(i));
      gridEl.appendChild(tile);
    }
  }

  function updateScoreDisplay(){
    scoreEl.textContent = Math.floor(scoreVal);
    if (scoreVal > bestScoreVal) {
      bestScoreVal = Math.floor(scoreVal);
      bestEl.textContent = bestScoreVal;
      try { storage.set('crushHighScore', String(bestScoreVal)); } catch (e) {}
    }
  }

  function flashInvalid(a, b){
    const tiles = gridEl.children;
    if (tiles[a]) tiles[a].classList.add('invalid');
    if (tiles[b]) tiles[b].classList.add('invalid');
  }

  function onTileClick(i){
    if (busy) return;
    if (selected === null) {
      selected = i;
      renderBoard();
      return;
    }
    if (selected === i) {
      selected = null;
      renderBoard();
      return;
    }
    const r1 = Math.floor(selected / COLS), c1 = selected % COLS;
    const r2 = Math.floor(i / COLS), c2 = i % COLS;
    const adjacent = Math.abs(r1 - r2) + Math.abs(c1 - c2) === 1;
    if (!adjacent) {
      selected = i;
      renderBoard();
      return;
    }
    const a = selected;
    selected = null;
    attemptSwap(a, i);
  }

  function attemptSwap(a, b){
    busy = true;
    swapVals(a, b);
    if (findMatches().size === 0) {
      // Doesn't make a match — show the attempted swap, shake it, then
      // revert, same as any real match-3.
      renderBoard();
      flashInvalid(a, b);
      swapVals(a, b);
      setTimeout(() => { renderBoard(); busy = false; }, 260);
      return;
    }
    renderBoard();
    comboMultiplier = 1;
    setTimeout(resolveStep, 120);
  }

  // The cascade loop: pop whatever's currently matched, collapse the
  // board, then check again — each additional cascade in the same chain
  // scores a little more than the last.
  function resolveStep(){
    const matches = findMatches();
    if (matches.size === 0) {
      if (!hasValidMove()) {
        hintEl.textContent = 'No moves left — reshuffling…';
        setTimeout(() => {
          board = generateBoard();
          renderBoard(true);
          hintEl.textContent = 'Match 3 or more bear treats in a row!';
          busy = false;
        }, 500);
      } else {
        busy = false;
      }
      return;
    }

    scoreVal += matches.size * 10 * comboMultiplier;
    comboMultiplier += 0.5;
    updateScoreDisplay();

    const tiles = gridEl.children;
    matches.forEach(i => { if (tiles[i]) tiles[i].classList.add('popping'); });

    setTimeout(() => {
      matches.forEach(i => { board[i] = null; });
      collapseColumns();
      renderBoard(true);
      setTimeout(resolveStep, 260);
    }, 220);
  }

  function restartBearCrush(){
    if (busy) return;
    board = generateBoard();
    scoreVal = 0;
    selected = null;
    comboMultiplier = 1;
    hintEl.textContent = 'Match 3 or more bear treats in a row!';
    renderBoard();
    updateScoreDisplay();
  }

  function setupBearCrushGame(){
    gridEl = document.getElementById('crushGrid');
    scoreEl = document.getElementById('crushScore');
    bestEl = document.getElementById('crushBestScore');
    hintEl = document.getElementById('crushHint');
    if (!gridEl) return;

    board = generateBoard();
    renderBoard();
    updateScoreDisplay();

    storage.get('crushHighScore').then(res => {
      if (res && res.value) {
        bestScoreVal = parseInt(res.value, 10) || 0;
        bestEl.textContent = bestScoreVal;
      }
    }).catch(() => {});
  }

  window.setupBearCrushGame = setupBearCrushGame;
  window.restartBearCrush = restartBearCrush;
  window.bearCrushOnHolidayChange = function(){
    if (gridEl) renderBoard();
  };
})();

// ---- Bear Quest: a small top-down "clear the room" action-adventure ----
// The bear moves around a walled arena with a d-pad (or arrow keys/WASD),
// swings a stick to defeat wandering/chasing critters, and each cleared
// room advances to the next wave with one more enemy. Three hearts, brief
// invincibility + knockback after a hit, best wave reached saved to
// storage the same way the other two games save their best score. Same
// self-contained IIFE pattern as Bear Run/Bear Crush above — only
// setupBearQuestGame() and bearQuestRefreshSize()/bearQuestOnHolidayChange()
// are exposed.
(function(){
  let wrap, canvas, ctx, overlay, overlayTitle, overlaySub, startBtn;
  let waveEl, heartsEl, bestWaveEl, attackBtn;
  let width = 0, height = 0;
  let state = 'idle'; // 'idle' | 'playing' | 'gameover'
  let bestWave = 1;
  let rafId = null;
  let lastFrameTime = null;
  let elapsed = 0;

  const ARENA_PAD = 16;
  const PLAYER_R = 12;
  const PLAYER_SPEED = 95;
  const ATTACK_DURATION = 0.24;
  const ATTACK_RANGE = 22;
  const ATTACK_HIT_R = 15;
  const INVULN_DURATION = 1.0;
  const CHASE_RADIUS = 85;
  const ENEMY_R = 11;

  const player = { x: 0, y: 0, dirX: 0, dirY: 1, attacking: false, attackTimer: 0, invuln: false, invulnTimer: 0 };
  let hearts = 3;
  const MAX_HEARTS = 3;
  let wave = 1;
  let enemies = [];
  let pickups = [];
  let hitThisSwing = null;
  let waveTransition = 0; // brief pause between clearing a room and the next one spawning

  const keysDown = {};
  const dpadDown = { up: false, down: false, left: false, right: false };

  function currentHoliday(){
    return document.documentElement.getAttribute('data-holiday') || 'standard';
  }

  function palette(){
    const h = currentHoliday();
    if (h === 'christmas') return { floorA:'#e7f4ea', floorB:'#d3ecd9', wall:'#1e7d4a', enemy:'❄️', pickup:'❤️' };
    if (h === 'halloween') return { floorA:'#2e1f3d', floorB:'#241831', wall:'#6b2fa0', enemy:'👻', pickup:'❤️' };
    return { floorA:'#dcefd2', floorB:'#cfe6c0', wall:'#4c7031', enemy:'🐝', pickup:'❤️' };
  }

  function resize(){
    if (!wrap || !canvas) return;
    const rect = wrap.getBoundingClientRect();
    width = Math.max(220, rect.width);
    height = 210;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (state !== 'playing') {
      player.x = width / 2;
      player.y = height / 2;
      drawStaticFrame();
    }
  }

  function clampToArena(x, y, r){
    return {
      x: Math.min(width - ARENA_PAD - r, Math.max(ARENA_PAD + r, x)),
      y: Math.min(height - ARENA_PAD - r, Math.max(ARENA_PAD + r, y)),
    };
  }

  function randomEdgeSpawn(){
    // Spawns roughly along the arena border so a fresh wave doesn't just
    // appear on top of the player standing in the middle.
    const side = Math.floor(Math.random() * 4);
    const pad = ARENA_PAD + ENEMY_R + 4;
    if (side === 0) return { x: pad + Math.random() * (width - pad * 2), y: pad };
    if (side === 1) return { x: pad + Math.random() * (width - pad * 2), y: height - pad };
    if (side === 2) return { x: pad, y: pad + Math.random() * (height - pad * 2) };
    return { x: width - pad, y: pad + Math.random() * (height - pad * 2) };
  }

  function spawnWave(n){
    enemies = [];
    for (let i = 0; i < n; i++) {
      const pos = randomEdgeSpawn();
      enemies.push({
        x: pos.x, y: pos.y,
        dx: 0, dy: 0,
        speed: 26 + Math.random() * 14,
        changeDirIn: Math.random() * 1.5,
        bob: Math.random() * Math.PI * 2,
        alive: true,
      });
    }
    if (hearts < MAX_HEARTS && Math.random() < 0.5) {
      const pos = { x: width / 2, y: height / 2 };
      pickups.push({ x: pos.x, y: pos.y, type: 'heart' });
    }
  }

  function resetGame(){
    hearts = MAX_HEARTS;
    wave = 1;
    player.x = width / 2;
    player.y = height / 2;
    player.dirX = 0;
    player.dirY = 1;
    player.attacking = false;
    player.attackTimer = 0;
    player.invuln = false;
    player.invulnTimer = 0;
    pickups = [];
    waveTransition = 0;
    spawnWave(3);
    updateHud();
  }

  function updateHud(){
    if (waveEl) waveEl.textContent = String(wave);
    if (bestWaveEl) bestWaveEl.textContent = String(bestWave);
    if (heartsEl) heartsEl.textContent = '❤️'.repeat(hearts) + '🖤'.repeat(MAX_HEARTS - hearts);
  }

  function startGame(){
    state = 'playing';
    overlay.classList.remove('show');
    resetGame();
    lastFrameTime = null;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  function gameOver(){
    state = 'gameover';
    if (wave > bestWave) {
      bestWave = wave;
      updateHud();
      try { storage.set('questBestWave', String(bestWave)); } catch (e) {}
    }
    overlayTitle.textContent = 'Caught!';
    overlaySub.textContent = `Reached Wave ${wave} — Best Wave ${bestWave}`;
    startBtn.textContent = 'Try Again';
    overlay.classList.add('show');
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    drawStaticFrame();
  }

  function triggerAttack(){
    if (state !== 'playing' || player.attacking) return;
    player.attacking = true;
    player.attackTimer = ATTACK_DURATION;
    hitThisSwing = new Set();
  }

  function moveVectorFromInput(){
    let mx = 0, my = 0;
    if (keysDown.up || dpadDown.up) my -= 1;
    if (keysDown.down || dpadDown.down) my += 1;
    if (keysDown.left || dpadDown.left) mx -= 1;
    if (keysDown.right || dpadDown.right) mx += 1;
    if (mx !== 0 && my !== 0) { mx *= 0.7071; my *= 0.7071; }
    return { mx, my };
  }

  function update(dt){
    elapsed += dt;

    if (waveTransition > 0) {
      waveTransition -= dt;
      if (waveTransition <= 0) {
        wave += 1;
        spawnWave(Math.min(3 + wave, 9));
        updateHud();
      }
    }

    // --- player movement ---
    const { mx, my } = moveVectorFromInput();
    if (mx !== 0 || my !== 0) {
      player.dirX = mx;
      player.dirY = my;
      const next = clampToArena(player.x + mx * PLAYER_SPEED * dt, player.y + my * PLAYER_SPEED * dt, PLAYER_R);
      player.x = next.x;
      player.y = next.y;
    }

    if (player.attacking) {
      player.attackTimer -= dt;
      if (player.attackTimer <= 0) { player.attacking = false; hitThisSwing = null; }
    }
    if (player.invuln) {
      player.invulnTimer -= dt;
      if (player.invulnTimer <= 0) player.invuln = false;
    }

    // --- attack hit detection ---
    if (player.attacking && hitThisSwing) {
      const ax = player.x + player.dirX * ATTACK_RANGE;
      const ay = player.y + player.dirY * ATTACK_RANGE;
      enemies.forEach(en => {
        if (!en.alive || hitThisSwing.has(en)) return;
        const d = Math.hypot(en.x - ax, en.y - ay);
        if (d < ENEMY_R + ATTACK_HIT_R) {
          en.alive = false;
          hitThisSwing.add(en);
        }
      });
    }

    // --- enemy AI ---
    enemies.forEach(en => {
      if (!en.alive) return;
      en.bob += dt * 6;
      const toPlayerX = player.x - en.x;
      const toPlayerY = player.y - en.y;
      const distToPlayer = Math.hypot(toPlayerX, toPlayerY);
      if (distToPlayer < CHASE_RADIUS && distToPlayer > 0.001) {
        en.dx = toPlayerX / distToPlayer;
        en.dy = toPlayerY / distToPlayer;
      } else {
        en.changeDirIn -= dt;
        if (en.changeDirIn <= 0) {
          const ang = Math.random() * Math.PI * 2;
          en.dx = Math.cos(ang);
          en.dy = Math.sin(ang);
          en.changeDirIn = 0.8 + Math.random() * 1.2;
        }
      }
      const next = clampToArena(en.x + en.dx * en.speed * dt, en.y + en.dy * en.speed * dt, ENEMY_R);
      en.x = next.x;
      en.y = next.y;

      if (!player.invuln) {
        const dp = Math.hypot(en.x - player.x, en.y - player.y);
        if (dp < ENEMY_R + PLAYER_R) {
          hearts -= 1;
          updateHud();
          player.invuln = true;
          player.invulnTimer = INVULN_DURATION;
          const kx = (player.x - en.x) || 1;
          const ky = (player.y - en.y) || 0;
          const kd = Math.hypot(kx, ky) || 1;
          const knock = clampToArena(player.x + (kx / kd) * 18, player.y + (ky / kd) * 18, PLAYER_R);
          player.x = knock.x;
          player.y = knock.y;
          if (hearts <= 0) { gameOver(); return; }
        }
      }
    });

    // --- pickups ---
    pickups = pickups.filter(p => {
      const d = Math.hypot(p.x - player.x, p.y - player.y);
      if (d < PLAYER_R + 12) {
        if (hearts < MAX_HEARTS) { hearts += 1; updateHud(); }
        return false;
      }
      return true;
    });

    // --- wave clear check ---
    if (state === 'playing' && waveTransition <= 0 && enemies.length > 0 && enemies.every(en => !en.alive)) {
      waveTransition = 0.9;
    }
  }

  function drawFloor(p){
    ctx.fillStyle = p.floorA;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = p.floorB;
    const tile = 26;
    for (let y = 0; y < height; y += tile) {
      for (let x = 0; x < width; x += tile) {
        if (((x / tile | 0) + (y / tile | 0)) % 2 === 0) ctx.fillRect(x, y, tile, tile);
      }
    }
    ctx.strokeStyle = p.wall;
    ctx.lineWidth = 4;
    ctx.strokeRect(ARENA_PAD / 2, ARENA_PAD / 2, width - ARENA_PAD, height - ARENA_PAD);
  }

  function drawBear(x, y, dirX, dirY, attacking, invuln, blink){
    if (invuln && blink) return; // blink out every other frame while invincible
    ctx.save();
    ctx.translate(x, y);
    // ears
    ctx.fillStyle = '#6b4423';
    ctx.beginPath(); ctx.arc(-8, -9, 5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(8, -9, 5, 0, Math.PI * 2); ctx.fill();
    // body
    ctx.fillStyle = '#8a5a34';
    ctx.beginPath(); ctx.arc(0, 0, PLAYER_R, 0, Math.PI * 2); ctx.fill();
    // snout, offset toward facing direction
    ctx.fillStyle = '#c9955f';
    ctx.beginPath(); ctx.ellipse(dirX * 5, dirY * 5 + 2, 6, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2a1c10';
    ctx.beginPath(); ctx.arc(dirX * 8, dirY * 8 + 2, 1.6, 0, Math.PI * 2); ctx.fill();
    // sword swing
    if (attacking) {
      ctx.strokeStyle = '#f2f2f2';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(dirX * 6, dirY * 6);
      ctx.lineTo(dirX * ATTACK_RANGE * 1.3, dirY * ATTACK_RANGE * 1.3);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawEmoji(emoji, x, y, size){
    ctx.font = size + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, x, y);
  }

  function drawStaticFrame(){
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    drawFloor(palette());
    drawBear(player.x, player.y, player.dirX, player.dirY, false, false, false);
  }

  function draw(){
    const p = palette();
    ctx.clearRect(0, 0, width, height);
    drawFloor(p);
    pickups.forEach(pk => drawEmoji(p.pickup, pk.x, pk.y, 16));
    enemies.forEach(en => {
      if (!en.alive) return;
      const bobY = Math.sin(en.bob) * 2;
      drawEmoji(p.enemy, en.x, en.y + bobY, 20);
    });
    const blink = Math.floor(elapsed * 10) % 2 === 0;
    drawBear(player.x, player.y, player.dirX, player.dirY, player.attacking, player.invuln, blink);
  }

  function loop(ts){
    if (state !== 'playing') return;
    if (lastFrameTime === null) lastFrameTime = ts;
    let dt = (ts - lastFrameTime) / 1000;
    lastFrameTime = ts;
    dt = Math.min(dt, 0.05);
    update(dt);
    if (state === 'playing') draw();
    rafId = requestAnimationFrame(loop);
  }

  function debounce(fn, ms){
    let t;
    return function(...args){ clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
  }

  function onKeydown(e){
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
    const map = { ArrowUp:'up', KeyW:'up', ArrowDown:'down', KeyS:'down', ArrowLeft:'left', KeyA:'left', ArrowRight:'right', KeyD:'right' };
    if (map[e.code]) { keysDown[map[e.code]] = true; e.preventDefault(); return; }
    if (e.code === 'Space' || e.code === 'KeyX') { e.preventDefault(); triggerAttack(); }
  }
  function onKeyup(e){
    const map = { ArrowUp:'up', KeyW:'up', ArrowDown:'down', KeyS:'down', ArrowLeft:'left', KeyA:'left', ArrowRight:'right', KeyD:'right' };
    if (map[e.code]) { keysDown[map[e.code]] = false; e.preventDefault(); }
  }

  function bindDpadButton(el){
    if (!el) return;
    const dir = el.getAttribute('data-dir');
    const press = (e) => { e.preventDefault(); dpadDown[dir] = true; el.classList.add('pressed'); };
    const release = (e) => { if (e) e.preventDefault(); dpadDown[dir] = false; el.classList.remove('pressed'); };
    el.addEventListener('pointerdown', press);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointerleave', release);
    el.addEventListener('pointercancel', release);
  }

  function setupBearQuestGame(){
    wrap = document.getElementById('questGameWrap');
    canvas = document.getElementById('questCanvas');
    if (!wrap || !canvas) return;
    ctx = canvas.getContext('2d');
    overlay = document.getElementById('questOverlay');
    overlayTitle = document.getElementById('questOverlayTitle');
    overlaySub = document.getElementById('questOverlaySub');
    startBtn = document.getElementById('questStartBtn');
    waveEl = document.getElementById('questWave');
    heartsEl = document.getElementById('questHearts');
    bestWaveEl = document.getElementById('questBestWave');
    attackBtn = document.getElementById('questAttackBtn');

    resize();
    window.addEventListener('resize', debounce(resize, 200));

    startBtn.addEventListener('click', startGame);
    document.querySelectorAll('#questControls .quest-dpad-btn').forEach(bindDpadButton);
    attackBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      attackBtn.classList.add('pressed');
      triggerAttack();
    });
    attackBtn.addEventListener('pointerup', () => attackBtn.classList.remove('pressed'));
    attackBtn.addEventListener('pointerleave', () => attackBtn.classList.remove('pressed'));
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('keyup', onKeyup);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
      } else if (state === 'playing' && !rafId) {
        lastFrameTime = null;
        rafId = requestAnimationFrame(loop);
      }
    });

    storage.get('questBestWave').then(res => {
      if (res && res.value) {
        bestWave = parseInt(res.value, 10) || 1;
        updateHud();
      }
    }).catch(() => {});
  }

  function restartBearQuest(){
    if (state === 'playing') return;
    startGame();
  }

  window.setupBearQuestGame = setupBearQuestGame;
  window.restartBearQuest = restartBearQuest;
  // The wrap sits inside a display:none section until the games toggle is
  // opened, so its very first resize() at setup time measures a
  // zero-width box. Re-running resize() once the section is actually
  // shown fixes the canvas up to the real card width.
  window.bearQuestRefreshSize = resize;
  window.bearQuestOnHolidayChange = function(){
    if (state !== 'playing') drawStaticFrame();
  };
})();

// ---- Bear Catch: a small explore/catch/battle adventure ----
// Same overworld pattern as Bear Quest (canvas + on-screen d-pad, no
// gravity/physics — just 4-directional movement against arena walls),
// but stepping into a grass patch can trigger a wild encounter, and
// walking into a ranger or the Elder Bear starts a battle. Battles are a
// DOM panel (HP bars + a short log + three buttons) layered over the
// canvas rather than drawn on it — much more legible at this size than a
// canvas-drawn battle screen would be. Progress (collection, trainers
// beaten, Bear King status, Cub's level) persists to storage the same way
// the other games' high scores do, under a single JSON key so it's one
// read/write instead of several.
(function(){
  let wrap, canvas, ctx, overlay, overlayTitle, overlaySub, startBtn;
  let levelEl, countEl, totalEl, bearKingBadgeEl, badgesEl;
  let dexBtn, dexPanel, dexListEl, dexCloseBtn;
  let godModeBtn;
  let dialogPanel, dialogNameEl, dialogTextEl, dialogCloseBtn;
  let trainerIntroPanel, trainerIntroSprite, trainerIntroName, trainerIntroQuote;
  let trainerIntroOpen = false;
  let trainerIntroTimer = null;
  let storePanel, storeMoneyEl, buyTrapBtn, buyPotionBtn, buyFullRestoreBtn, storeCloseBtn;
  let starterPanel, starterTextEl, starterOptionsEl, starterCloseBtn;
  let resetConfirmPanel, resetConfirmBtn, resetCancelBtn;
  let healConfirmPanel, healConfirmTextEl, healConfirmBtn, healConfirmCancelBtn;
  let bearSwitchPanel, bearSwitchOptionsEl, bearSwitchCloseBtn, battleSwitchBtn;
  let moneyEl, honeyTrapsEl, potionsEl;
  let battlePanel, battlePlayerName, battlePlayerHpFill, battlePlayerHpText;
  let battleEnemyName, battleEnemyHpFill, battleEnemyHpText;
  let battlePlayerSprite, battleEnemySprite, battleLogEl;
  let battleCatchBtn, battleRunBtn, battleAttackBtn;
  let width = 0, height = 0;
  let state = 'idle'; // 'idle' | 'overworld' | 'battle'
  let rafId = null;
  let lastFrameTime = null;
  let battleBusy = false;

  const ARENA_PAD = 16;
  const PLAYER_R = 12;
  const PLAYER_SPEED = 85;
  const NPC_R = 14;
  const ENCOUNTER_STEP = 34;
  const ENCOUNTER_CHANCE = 0.2;
  const EXIT_MARGIN = 6; // how close to an edge counts as "stepping through" to the next area
  const EXIT_GAP_HALF = 23; // must match half of drawFloor's wall gap — you can only step through at the arrow, not anywhere along the edge

  // Color-tinted reuses of the handful of real bear emoji let a handful
  // of sprites cover 18 distinct catchable variants without needing
  // custom art — `tint` is a canvas filter string applied only when
  // drawing that variant. Two are native to each of the 9 wilderness zones,
  // and stats climb steadily area-by-area so the game gets harder as you
  // go (the rarer half of each pair is always a notch tougher).
  const VARIANTS = [
    { id:'brown',   name:'Brown Bear',    emoji:'🐻',   weight:6, hp:9,  atk:2, level:2,  tint:null },
    { id:'black',   name:'Black Bear',    emoji:'🐻',   weight:5, hp:11, atk:3, level:3,  tint:'brightness(0.5)' },
    { id:'panda',   name:'Panda Bear',    emoji:'🐼',   weight:6, hp:11, atk:2, level:4,  tint:null },
    { id:'koala',   name:'Koala Bear',    emoji:'🐨',   weight:5, hp:13, atk:3, level:5,  tint:null },
    { id:'polar',   name:'Polar Bear',    emoji:'🐻‍❄️',  weight:5, hp:13, atk:3, level:6,  tint:null },
    { id:'moon',    name:'Moon Bear',     emoji:'🐨',   weight:4, hp:15, atk:4, level:7,  tint:'grayscale(1) brightness(1.3)' },
    { id:'sun',     name:'Sun Bear',      emoji:'🐻',   weight:4, hp:15, atk:3, level:8,  tint:'sepia(1) saturate(4) hue-rotate(-10deg) brightness(1.15)' },
    { id:'honey',   name:'Honey Bear',    emoji:'🐻',   weight:4, hp:17, atk:4, level:9,  tint:'sepia(0.8) hue-rotate(20deg) saturate(2) brightness(1.1)' },
    { id:'grizzly', name:'Grizzly Bear',  emoji:'🐻',   weight:3, hp:17, atk:4, level:10, tint:'sepia(0.6) saturate(2.5) hue-rotate(-15deg)' },
    { id:'night',   name:'Night Bear',    emoji:'🐻',   weight:3, hp:19, atk:5, level:11, tint:'brightness(0.35) hue-rotate(220deg) saturate(2)' },
    { id:'storm',   name:'Storm Bear',    emoji:'🐻',   weight:3, hp:19, atk:4, level:12, tint:'grayscale(0.6) brightness(0.7) contrast(1.4)' },
    { id:'ember',   name:'Ember Bear',    emoji:'🐻',   weight:3, hp:21, atk:5, level:13, tint:'sepia(1) hue-rotate(-30deg) saturate(3)' },
    { id:'coral',   name:'Coral Koala',   emoji:'🐨',   weight:2, hp:21, atk:5, level:14, tint:'sepia(0.7) hue-rotate(-50deg) saturate(2.2)' },
    { id:'jade',    name:'Jade Panda',    emoji:'🐼',   weight:2, hp:23, atk:6, level:15, tint:'hue-rotate(90deg) saturate(2) brightness(1.1)' },
    { id:'cloud',   name:'Cloud Bear',    emoji:'🐻‍❄️',  weight:2, hp:23, atk:5, level:16, tint:'brightness(1.4) saturate(0.3)' },
    { id:'frost',   name:'Frost Panda',   emoji:'🐼',   weight:2, hp:25, atk:6, level:17, tint:'brightness(1.3) hue-rotate(180deg) saturate(1.5)' },
    { id:'teddy',   name:'Teddy Bear',    emoji:'🧸',   weight:1, hp:25, atk:6, level:18, tint:null },
    { id:'royal',   name:'Royal Bear',    emoji:'🧸',   weight:1, hp:27, atk:7, level:19, tint:'hue-rotate(260deg) saturate(2.5) brightness(0.9)' },
    // Ultra-rare — never appears in the wild (weight:0, and it's not in any
    // Wild Area's variantIds pool); awarded once, directly, for beating
    // the Bear King.
    { id:'celestial', name:'Celestial Bear', emoji:'🐻', weight:0, hp:99, atk:20, level:99, tint:'hue-rotate(45deg) saturate(3) brightness(1.5) contrast(1.2)' },
    // God Mode only — never wild, never counted in the Dex total or the
    // "caught everything" check for the Celestial Bear. Its absurd hp/atk
    // bonus (added on top of the Cub's normal level-based stats) makes it
    // a guaranteed one- or two-hit win against literally anything in the
    // game, including the Bear King and Master Ronan.
    { id:'doombear', name:'DoomBear', emoji:'💀', weight:0, hp:9994, atk:9994, level:1, tint:'grayscale(1) brightness(0.5) saturate(3) contrast(1.6)', godOnly:true },
  ];
  function variantById(id){ return VARIANTS.find(v => v.id === id); }

  // Which two variants are native to each of the 9 wilderness zones, in order.
  const WILD_PAIRS = [
    ['brown','black'], ['panda','koala'], ['polar','moon'], ['sun','honey'],
    ['grizzly','night'], ['storm','ember'], ['coral','jade'], ['cloud','frost'],
    ['teddy','royal'],
  ];
  // Each zone now names two consecutive Wild Area sections: [approach, depths].
  const WILD_ZONE_NAMES = [
    ['Bear Woods', 'Deep Bear Woods'],
    ['Whispering Trail', 'Silent Hollow'],
    ['Icy Tundra', 'Frozen Expanse'],
    ['Sunny Meadow', 'Wildflower Field'],
    ['Misty Marsh', 'Fen of Echoes'],
    ['Rocky Pass', 'Boulder Ridge'],
    ['Autumn Grove', 'Amber Thicket'],
    ['Coral Shore', 'Tidepool Flats'],
    ['Cloudpeak Trail', 'Windswept Summit'],
  ];
  const CITY_NAMES = ['Maple Hollow','Rivertown','Frostpeak','Sandy Cove','Cedar Ridge','Stormwatch','Golden Vale','Shadow Falls','Summit City'];
  const GYM_LEADER_NAMES = ['Ranger Rosa','Scout Sam','Farmer Finn','Trainer Tara','Captain Cole','Miner Mika','Chef Chase','Diver Dana','Sage Skyler'];
  const GYM_LEADER_EMOJI = ['🧑‍🌾','🧙','🧑‍🌾','🧑‍🎓','🧑‍✈️','🧑‍🔬','🧑‍🍳','🧑‍🚀','🧙‍♀️'];
  const REGULAR_TRAINER_NAMES = ['Hiker Hana','Camper Jae','Backpacker Lou','Fisher Fay','Biker Bex','Artist Ana','Runner Rex','Gardener Gus','Baker Bea','Student Sid','Angler Amy','Skater Zane','Herder Hank','Diver Dee','Miner Milo','Chef Cody','Sailor Sana','Poet Priya'];
  const REGULAR_TRAINER_EMOJI = ['🧑','🧑‍🦱','🧑‍🦰','🧑‍🦳','🧑‍🦲','🧑‍🎤','🧑‍🎨','🧑‍💻'];
  const WILD_TRAINER_NAMES = ['Wanderer Wade','Ranger Nia','Trekker Milo','Scout Elle','Pathfinder Omar','Forager Tess','Guide Reo','Tracker Beth','Climber Finn'];
  const WILD_TRAINER_EMOJI = ['🧑‍🦱','🧑‍🦰','🧑‍🦳','🧑‍🦲','🧑‍🎤','🧑‍🎨','🧑‍🏫','🧑‍🍳','🧗'];
  // Each of the 9 wilderness zones is now two consecutive Wild Area
  // sections — a shallower approach, then a deeper stretch right before
  // the city — so a second roster of wandering trainers covers the
  // deeper half of each zone.
  const WILD_TRAINER_NAMES_B = ['Ranger Odell','Nomad Vera','Woodsman Kai','Prospector Lin','Bushwhacker Theo','Naturalist Ines','Sentinel Rook','Voyager Mabel','Alpinist Drew'];
  const WILD_TRAINER_EMOJI_B = ['🧑‍💻','🧑‍✈️','🧑‍🚀','🧑‍⚕️','🧑‍🎓','🧑‍🌾','🧑‍🚒','🧑‍🔧','🧑‍🏭'];
  // Lore NPCs sprinkled through every Wild Area section — two per
  // section, drawn from these two pools so the wilderness doesn't feel
  // empty between cities. The "tip" pool doubles as a nudge toward the
  // new Healing Center / Potion mechanics.
  const WILD_LORE_QUOTES = [
    "Watch your step from here on — the trail gets rougher.",
    "Seen bear tracks heading toward town all morning.",
    "This path was a game trail before travelers wore it smooth.",
    "You can hear the next town's bell if the wind's right.",
    "Old maps call this stretch 'the long walk,' and they're not wrong.",
    "Plenty of wild bears make their home in that tall grass.",
    "Lost travelers say this stretch loops back on itself. It doesn't. Probably.",
    "Rangers patrol this stretch at dawn — you just missed one.",
    "Further in, the trail forks — but it always finds its way to town.",
  ];
  const WILD_TIP_QUOTES = [
    "If your Cub's hurt, don't push on — every city has a free Healing Center now.",
    "Nurse Willow keeps a Healing Center in every city, no charge at all.",
    "Carry a Healing Potion if you can't make it back to a city in time.",
    "A hurt Cub is a slow Cub — patch up before your next fight.",
    "I always keep a Potion on hand out here, just in case.",
  ];
  const ELITE_NAMES = ['Elite Ivy','Elite Orin','Elite Zara','Elite Bram'];
  const ELITE_EMOJI = ['🧙‍♀️','🧙‍♂️','🧝‍♀️','🧝‍♂️'];

  // A line of dialogue for every trainer, shown before the fight starts.
  // Regular trainers cycle through a shared pool; gym leaders, the Elite
  // Four, and the Bear King each get one written specifically for them.
  const REGULAR_QUOTES = [
    "Think you can out-battle me?", "My bear's been itching for a fight!",
    "Let's see what you've got!", "I won't go easy on you!",
    "This won't take long...", "Ready or not, here we go!",
    "You picked the wrong trail to wander!", "Time to test your skills!",
  ];
  const GYM_QUOTES = [
    "You'll need more than luck to clear my Woods!",
    "I've scouted every trail here — I know every trick!",
    "Grown stronger than any crop on this farm!",
    "Top of my class, and it shows in battle!",
    "A Captain never backs down from a challenge!",
    "Dug deep in these mines — my bear's tough as ore!",
    "I'll serve you a battle you won't forget!",
    "Prepare to be swept away!",
    "The sages have foreseen your defeat!",
  ];
  const ELITE_QUOTES = [
    "Only the strongest make it this far.",
    "I've trained beyond what you can imagine.",
    "Let's see if you're truly ready for the Bear King.",
    "This is where most challengers fall.",
  ];

  // Reactions once a city's Gym Leader has been beaten, or once the
  // player has become Bear King — layered on top of each NPC's default
  // line via resolveDialogue(), so towns actually notice what you've done.
  const GYM_DEFEATED_TOWNSFOLK_QUOTES = [
    "You actually beat our Gym Leader? Incredible!",
    "Word's already spreading about you and that badge!",
    "My bear won't stop talking about your battle with the Gym Leader.",
    "Congrats on the badge — the whole town's talking about it!",
  ];
  const BEAR_KING_TOWNSFOLK_QUOTES = [
    "You're the Bear King?! I'm talking to royalty right now!",
    "All hail the new Bear King — my bear's practically bowing.",
    "I still can't believe the new Bear King just walked through here.",
    "Everyone in town's talking about you, Your Majesty.",
  ];
  const BEAR_KING_HISTORIAN_QUOTES = [
    "I'll be adding \"defeated the Bear King\" to your entry in our records.",
    "Local Cub Catcher Becomes Bear King — I'm updating the exhibit already.",
    "History being made, and I get to write it down. Thank you for that.",
  ];

  // Lore NPCs never battle — walking into one just shows a line of
  // dialogue about the world or that city's landmark, or a friendly
  // greeting from a wandering bear.
  const LORE_QUOTES = [
    "Maple Hollow's clocktower has kept perfect time for a hundred years.",
    "Rivertown's bridge was built from driftwood bear-paws found right here.",
    "Frostpeak's ice caves are said to connect all the way to the old Elder's cave.",
    "Sandy Cove's lighthouse guides the fishing boats home every night.",
    "Cedar Ridge's tallest cedar is said to be older than the mountains themselves.",
    "Stormwatch's spire was built to track the storms rolling in from the coast.",
    "Golden Vale's fields turn pure gold every single harvest season.",
    "Shadow Falls got its name from a mist that never quite seems to clear.",
    "Summit City sits so high, some say you can see the whole region from here.",
  ];
  const HISTORIAN_QUOTES = [
    "Maple Hollow was founded by three trappers who couldn't agree where to build separate cabins.",
    "Rivertown's founders floated in on rafts — half the town's tools still wash up from that first trip.",
    "Frostpeak's first residents thought the ice caves were haunted. Turns out it was just the wind.",
    "Sandy Cove used to be a pirate hideout, or so the old songs claim.",
    "Cedar Ridge's founding charter is carved into the base of the tallest cedar itself.",
    "Stormwatch was built by sailors who got tired of losing ships to storms they couldn't predict.",
    "Golden Vale's first harvest fed three neighboring towns through a brutal winter.",
    "Shadow Falls' founders named it before they realized the mist never lifts. No refunds.",
    "Summit City was built stone by stone, carried up by the very first Cub Catchers.",
  ];
  const NURSE_WILLOW_GREETING = "Welcome to the Healing Center! Let your Cub rest a moment — good as new.";
  // Every "friendly bear" is now a human townsfolk NPC who happens to have
  // a bear companion — no bear in a city actually talks. gymDefeated and
  // bearKing give each one a reaction once those things become true,
  // pulled from the shared pools above (indexed the same way as the
  // townsfolk themselves) via resolveDialogue().
  const TOWNSFOLK = [
    { name: 'Mira', emoji: '🧑‍🌾', dialogue: "My bear loves the sunshine here!" },
    { name: 'DeShawn', emoji: '🧑‍🦱', dialogue: "Have you tried the honey cakes at the market? My bear can't get enough." },
    { name: 'Priya', emoji: '🧑‍🦳', dialogue: "Good luck on your journey, little Cub Catcher!" },
    { name: 'Otis', emoji: '🧑‍🦲', dialogue: "The Gym Leader here is tougher than they look, trust me." },
    { name: 'Wren', emoji: '🧑‍🎤', dialogue: "I heard the Elite Four is no joke..." },
    { name: 'Beau', emoji: '🧑‍🎨', dialogue: "Safe travels, friend! My bear says hi too." },
  ];
  // A second human NPC for each of the three enterable buildings, so
  // nobody's building has just its one specialist standing alone.
  const STORE_REGULARS = [
    { name: 'Callum', emoji: '🧑‍🦰', dialogue: "Best honey in town, and my bear agrees.", bearKing: "Drinks are on me, Your Majesty! ...okay, maybe just a discount." },
    { name: 'Nadia', emoji: '🧑‍🦳', dialogue: "I come here every week — my bear practically lives at this counter.", bearKing: "The Bear King, shopping right next to me. Wild." },
    { name: 'Theo', emoji: '🧑‍🦲', dialogue: "Picked up extra Honey Traps. You can never have too many.", bearKing: "I'm telling my grandkids I once stood in line behind the Bear King." },
  ];
  const HEAL_PATIENTS = [
    { name: 'Sage', emoji: '🧑‍🦱', dialogue: "My bear picked a fight with a beehive. We're both resting up.", bearKing: "Bear King himself, right here in the waiting room. Wild." },
    { name: 'Imani', emoji: '🧑‍🎤', dialogue: "Nurse Willow patched my bear right up. Couldn't recommend her more.", bearKing: "Even the Bear King needs a check-up sometimes, huh?" },
    { name: 'Colt', emoji: '🧑‍🌾', dialogue: "Just a scrape. My bear's tougher than it looks.", bearKing: "Your Majesty! Sorry — habit. Congratulations, truly." },
  ];
  const ARCHIVE_ASSISTANTS = [
    { name: 'Junior Archivist Wren', emoji: '🧑‍🎓', dialogue: "Careful with the scrolls — some are older than the city itself.", bearKing: "\"Local Cub Catcher Becomes Bear King.\" Has a nice ring to it, don't you think?" },
    { name: 'Percy', emoji: '🧑‍💻', dialogue: "I'm cataloguing every Cub Catcher who's passed through. You'll be in here too.", bearKing: "I'm updating your entry right now. Bear King. That's a good line." },
    { name: 'Adaeze', emoji: '🧑‍🏫', dialogue: "The old maps in the back room predate the roads outside.", bearKing: "History in the making, and I got to meet the Bear King in person." },
  ];

  // Each Plaza gets its own wall/roof color scheme and a landmark emoji
  // tied to that city's lore line, so no two cities look alike even
  // though they share the same building layout.
  const CITY_BUILDING_PALETTES = [
    { wall:'#d99a5b', roof:'#8a3f2b' }, // Maple Hollow — warm maple
    { wall:'#8fb3d9', roof:'#3f6a8a' }, // Rivertown — river blue
    { wall:'#dbeeff', roof:'#5f8fb8' }, // Frostpeak — icy white/blue
    { wall:'#f2d38a', roof:'#c97b3f' }, // Sandy Cove — sandy gold
    { wall:'#a8c48a', roof:'#4f6b38' }, // Cedar Ridge — forest green
    { wall:'#8f9bb0', roof:'#3f4a63' }, // Stormwatch — storm gray-blue
    { wall:'#f0d060', roof:'#b8860b' }, // Golden Vale — golden fields
    { wall:'#9b8ab0', roof:'#4f3f66' }, // Shadow Falls — misty purple
    { wall:'#e8edf2', roof:'#7d90a8' }, // Summit City — snowy peak
  ];
  const CITY_LANDMARK_EMOJI = ['🕰️','🌉','🧊','🏖️','🌲','🌩️','🌾','🌫️','🏔️'];
  // A pair of flavor emoji per city landmark, used to give each Battle
  // Hall's interior its own decor instead of one generic gym layout.
  const GYM_THEME_DECOR = {
    '🕰️': ['🍁','🍂'], // Maple Hollow — autumn/clockwork
    '🌉': ['🌊','🐟'], // Rivertown — river life
    '🧊': ['❄️','🧊'], // Frostpeak — ice
    '🏖️': ['🐚','🌊'], // Sandy Cove — beach
    '🌲': ['🌲','🍄'], // Cedar Ridge — forest floor
    '🌩️': ['⚡','☁️'], // Stormwatch — storm
    '🌾': ['🌾','🌻'], // Golden Vale — farmland
    '🌫️': ['🌫️','🦇'], // Shadow Falls — misty and a little spooky
    '🏔️': ['🏔️','🚩'], // Summit City — high peaks
  };
  // One outdoor theme per city, keyed by its landmark emoji — a ground
  // wash tint, a signature backdrop flourish, and a set of ambient
  // particles scattered along the side edges (clear of every building
  // layout variant), so each town's Plaza reads as its own place at a
  // glance instead of a recolored template.
  const CITY_PLAZA_THEMES = {
    '🕰️': { ground:'rgba(217,154,91,0.16)' },  // Maple Hollow — autumn
    '🌉': { ground:'rgba(90,150,200,0.14)' },  // Rivertown — riverside
    '🧊': { ground:'rgba(219,238,255,0.4)' },  // Frostpeak — snowbound
    '🏖️': { ground:'rgba(242,211,138,0.28)' }, // Sandy Cove — beachfront
    '🌲': { ground:'rgba(168,196,138,0.2)' },  // Cedar Ridge — forest edge
    '🌩️': { ground:'rgba(60,70,90,0.26)' },    // Stormwatch — stormy skies
    '🌾': { ground:'rgba(240,208,96,0.22)' },  // Golden Vale — farmland
    '🌫️': { ground:'rgba(90,90,110,0.28)' },   // Shadow Falls — misty
    '🏔️': { ground:'rgba(232,237,242,0.4)' },  // Summit City — high peaks
  };


  // One theme per Elite Four chamber (Ivy/Orin/Zara/Bram), each a
  // different elemental glow with its own rune icon and flanking decor.
  const ELITE_THEMES = [
    { glow:'rgba(80,200,120,0.28)',  rune:'🌿', deco:['🍃','🌱'] }, // Ivy — nature
    { glow:'rgba(230,140,40,0.28)',  rune:'🔥', deco:['🔥','✨'] }, // Orin — fire
    { glow:'rgba(90,160,230,0.28)',  rune:'❄️', deco:['💠','❄️'] }, // Zara — ice
    { glow:'rgba(150,90,200,0.28)',  rune:'🌙', deco:['⭐','🌙'] }, // Bram — shadow
  ];

  // Generic position templates reused by every area of a given type — the
  // 32 sections are distinct in name, native creatures, and trainers. City/
  // Elite Four/Bear King trainer spots share one layout per type, but each
  // Wild Area gets its own distinct grass layout below so no two trails
  // look the same. Each City is actually two rooms: an outdoor Plaza (lore
  // NPCs, a friendly bear, a door into the Battle Hall, and the path
  // onward once its Gym Leader is beaten) and the Battle Hall itself
  // (the two regular trainers and the Gym Leader, plus a door back out).
  const WILD_LAYOUTS = [
    [ { xf:0.04, yf:0.48, wf:0.3,  hf:0.44 }, { xf:0.58, yf:0.06, wf:0.3,  hf:0.36 } ],                                    // Bear Woods — two woodland clearings
    [ { xf:0.05, yf:0.38, wf:0.9,  hf:0.22 } ],                                                                            // Whispering Trail — one long winding band
    [ { xf:0.05, yf:0.08, wf:0.24, hf:0.24 }, { xf:0.71, yf:0.08, wf:0.24, hf:0.24 }, { xf:0.05, yf:0.68, wf:0.24, hf:0.24 }, { xf:0.71, yf:0.68, wf:0.24, hf:0.24 } ], // Icy Tundra — scattered icy patches
    [ { xf:0.26, yf:0.26, wf:0.48, hf:0.48 } ],                                                                            // Sunny Meadow — one big central meadow
    [ { xf:0.04, yf:0.08, wf:0.18, hf:0.84 }, { xf:0.78, yf:0.08, wf:0.18, hf:0.84 } ],                                    // Misty Marsh — two tall marsh channels
    [ { xf:0.06, yf:0.06, wf:0.36, hf:0.22 }, { xf:0.58, yf:0.72, wf:0.36, hf:0.22 } ],                                    // Rocky Pass — diagonal ledges
    [ { xf:0.06, yf:0.1,  wf:0.24, hf:0.24 }, { xf:0.38, yf:0.4,  wf:0.24, hf:0.24 }, { xf:0.7,  yf:0.1,  wf:0.24, hf:0.24 } ], // Autumn Grove — three tree clusters
    [ { xf:0.04, yf:0.72, wf:0.92, hf:0.2 },  { xf:0.4,  yf:0.08, wf:0.2,  hf:0.2 } ],                                     // Coral Shore — shoreline band + tide pool
    [ { xf:0.4,  yf:0.06, wf:0.2,  hf:0.18 }, { xf:0.2,  yf:0.32, wf:0.2,  hf:0.18 }, { xf:0.6,  yf:0.32, wf:0.2,  hf:0.18 }, { xf:0.4, yf:0.58, wf:0.2, hf:0.18 } ], // Cloudpeak Trail — switchback climb
  ];
  // Part B of each zone (the deeper stretch right before the city) reuses
  // Part A's hand-laid-out grass zones mirrored left-to-right, so every
  // Wild Area section still has its own distinct trail without needing a
  // whole second set of hand-authored layouts.
  function mirrorLayout(zones){
    return zones.map(z => ({ xf: Math.max(0, 1 - z.xf - z.wf), yf: z.yf, wf: z.wf, hf: z.hf }));
  }
  const WILD_LORE_POS = [{ xf:0.12, yf:0.15 }, { xf:0.88, yf:0.85 }];
  // The Plaza itself only holds the Elder and two townsfolk out in the
  // open — the Shopkeeper, Nurse Willow, and the Historian now live
  // inside their own buildings, each reached through a door the same way
  // the Battle Hall is.
  const PLAZA_POS = {
    elder:{ xf:0.5, yf:0.83 },
    town1:{ xf:0.22, yf:0.58 },
    town2:{ xf:0.78, yf:0.58 },
  };
  const HALL_POS = { gym:{ xf:0.5, yf:0.2 }, t1:{ xf:0.22, yf:0.72 }, t2:{ xf:0.78, yf:0.72 }, door:{ xf:0.5, yf:0.94 } };
  // Generic interior layout shared by the Store/Healing Center/Archive —
  // two NPCs, and a single door back out to the Plaza.
  const ROOM_DOOR_POS = { xf:0.5, yf:0.94 };
  const ROOM_NPC_POS = [{ xf:0.35, yf:0.5 }, { xf:0.65, yf:0.5 }];
  const BEAR_KING_POS = { xf:0.5, yf:0.5 };
  const ROOM_DOOR_POS_CENTER = { xf:0.5, yf:0.5 }; // Master Ronan's spot in the ruins room
  const WILD_TRAINER_POS = [{ xf:0.5, yf:0.5 }];

  // ---- build the 32 sections: 9 zones, each contributing 2 Wild Areas
  // and 1 City, then 4 separate Elite Four chambers, then the Bear King's Chamber ----
  // Trainer levels climb by exactly 1 per fight in the fixed order the
  // player faces them: within zone i (0-indexed), Wild Area A is
  // 5i+1, Wild Area B is 5i+2, the two City trainers are 5i+3/5i+4, and
  // the Gym Leader is 5i+5 — so the next zone's Wild Area A (5(i+1)+1)
  // picks up right where this zone's Gym Leader left off.
  const WILD_AREAS = [];
  WILD_ZONE_NAMES.forEach((names, i) => {
    const pair = WILD_PAIRS[i];
    const layoutA = WILD_LAYOUTS[i];
    const layoutB = mirrorLayout(layoutA);
    [0, 1].forEach(sub => {
      const k = i * 2 + sub; // 0..17, global Wild Area index
      const name = names[sub];
      // Part A leans on the zone's common native variant, Part B (deeper,
      // right before the city) on its rarer, tougher one.
      const nativeVariant = variantById(pair[sub]);
      const wtLevel = 5 * i + 1 + sub;
      const wtStats = trainerStatsAt(wtLevel, sub === 0 ? 0.85 : 0.92, sub === 0 ? 0.9 : 0.98);
      const trainerName = sub === 0 ? WILD_TRAINER_NAMES[i] : WILD_TRAINER_NAMES_B[i];
      const trainerEmoji = sub === 0 ? WILD_TRAINER_EMOJI[i] : WILD_TRAINER_EMOJI_B[i];
      const wildTrainer = {
        id: 'wild' + (k + 1) + 't1', name: trainerName, emoji: trainerEmoji, role: 'regular',
        quote: REGULAR_QUOTES[k % REGULAR_QUOTES.length],
        moneyReward: 8 + k * 2,
        bear: { name: trainerName + "'s " + nativeVariant.name, emoji: nativeVariant.emoji, tint: nativeVariant.tint, hp: wtStats.hp, atk: wtStats.atk, level: wtLevel },
      };
      WILD_AREAS.push({
        id: 'wild' + (k + 1), type: 'wild', name, variantIds: pair,
        zoneIndex: i, zoneSub: sub,
        grassZones: sub === 0 ? layoutA : layoutB,
        trainers: [wildTrainer],
        loreNpcs: [
          { id: 'wild' + (k + 1) + 'lore', name: 'Trail Marker', emoji: '🪧', dialogue: WILD_LORE_QUOTES[k % WILD_LORE_QUOTES.length] },
          { id: 'wild' + (k + 1) + 'tip', name: 'Weary Traveler', emoji: '🚶', dialogue: WILD_TIP_QUOTES[k % WILD_TIP_QUOTES.length] },
        ],
      });
    });
  });

  const CITY_AREAS = [];   // the Plazas — these are the ones counted in the 32 sections
  const CITY_HALLS = [];   // the Battle Halls — reached only through a Plaza's door
  const CITY_ROOMS = [];   // the Store / Healing Center / Archive interiors — also reached only through a Plaza's door
  CITY_NAMES.forEach((name, i) => {
    const t1v = variantById(WILD_PAIRS[i][0]);
    const t2v = variantById(WILD_PAIRS[i][1]);
    const gymv = variantById(WILD_PAIRS[i][1]);
    const t1Level = 5 * i + 3, t2Level = 5 * i + 4, gymLevel = 5 * i + 5;
    const t1Stats = trainerStatsAt(t1Level, 1.0, 1.0);
    const t2Stats = trainerStatsAt(t2Level, 1.0, 1.0);
    const gymStats = trainerStatsAt(gymLevel, 1.25, 1.15);
    const gymLeader = {
      id: 'gym' + (i + 1), name: GYM_LEADER_NAMES[i], emoji: GYM_LEADER_EMOJI[i], role: 'gym',
      quote: GYM_QUOTES[i],
      moneyReward: 40 + i * 8,
      bear: { name: GYM_LEADER_NAMES[i] + "'s " + gymv.name, emoji: gymv.emoji, tint: gymv.tint, hp: gymStats.hp, atk: gymStats.atk, level: gymLevel },
    };
    const trainer1 = {
      id: 'city' + (i + 1) + 't1', name: REGULAR_TRAINER_NAMES[i * 2], emoji: REGULAR_TRAINER_EMOJI[(i * 2) % REGULAR_TRAINER_EMOJI.length], role: 'regular',
      quote: REGULAR_QUOTES[(i * 2) % REGULAR_QUOTES.length],
      moneyReward: 12 + i * 3,
      bear: { name: REGULAR_TRAINER_NAMES[i * 2] + "'s " + t1v.name, emoji: t1v.emoji, tint: t1v.tint, hp: t1Stats.hp, atk: t1Stats.atk, level: t1Level },
    };
    const trainer2 = {
      id: 'city' + (i + 1) + 't2', name: REGULAR_TRAINER_NAMES[i * 2 + 1], emoji: REGULAR_TRAINER_EMOJI[(i * 2 + 1) % REGULAR_TRAINER_EMOJI.length], role: 'regular',
      quote: REGULAR_QUOTES[(i * 2 + 1) % REGULAR_QUOTES.length],
      moneyReward: 12 + i * 3,
      bear: { name: REGULAR_TRAINER_NAMES[i * 2 + 1] + "'s " + t2v.name, emoji: t2v.emoji, tint: t2v.tint, hp: t2Stats.hp, atk: t2Stats.atk, level: t2Level },
    };
    const hallId = 'city' + (i + 1) + 'hall';
    const plazaId = 'city' + (i + 1);
    const shopId = 'city' + (i + 1) + 'shop';
    const healId = 'city' + (i + 1) + 'heal';
    const histId = 'city' + (i + 1) + 'hist';

    // Every Plaza needs a clear straight line at yf 0.5 (screen mid-
    // height) — that's exactly where the edge-to-edge walk between
    // sections passes through, so nothing can sit on it. The hall
    // building is the only one big enough to reach that line, so it's
    // pushed up into the top-center band (well clear of 0.5) and its xf
    // cycles across 3 spots for variety. The four corner buildings mirror
    // left-right every other city for a bit more variety too, without
    // risking any new overlaps since they never leave their own corners.
    const hallXf = [0.4, 0.5, 0.6][i % 3];
    const hallYf = 0.29, hallHf = 0.16;
    const hallDoorYf = hallYf + hallHf / 2; // building's bottom edge
    const cornerFlip = i % 2 === 1;
    const landmarkXf = cornerFlip ? 0.85 : 0.15;
    const shopXf = cornerFlip ? 0.15 : 0.85;
    const historianXf = cornerFlip ? 0.85 : 0.15;
    const healXf = cornerFlip ? 0.15 : 0.85;
    const cornerTopYf = 0.12, cornerBottomYf = 0.75, cornerHf = 0.14;
    const shopDoorYf = cornerTopYf + cornerHf / 2;
    const historianDoorYf = cornerBottomYf + cornerHf / 2;
    const healDoorYf = cornerBottomYf + cornerHf / 2;

    CITY_HALLS.push({
      id: hallId, type: 'cityhall', roomKind: 'gym', name: name + ' Battle Hall', cityName: name, plazaId,
      palette: CITY_BUILDING_PALETTES[i], landmarkEmoji: CITY_LANDMARK_EMOJI[i],
      gymLeader, trainers: [trainer1, trainer2],
      doors: [{ xf: HALL_POS.door.xf, yf: HALL_POS.door.yf, to: plazaId, enterXf: hallXf, enterYf: hallDoorYf + 0.14 }],
    });
    const town1 = TOWNSFOLK[i % TOWNSFOLK.length];
    const town2 = TOWNSFOLK[(i + 3) % TOWNSFOLK.length];
    const storeRegular = STORE_REGULARS[i % STORE_REGULARS.length];
    const healPatient = HEAL_PATIENTS[i % HEAL_PATIENTS.length];
    const archiveAssistant = ARCHIVE_ASSISTANTS[i % ARCHIVE_ASSISTANTS.length];
    const gymId = 'gym' + (i + 1);
    CITY_AREAS.push({
      id: plazaId, type: 'city', name, hallId,
      palette: CITY_BUILDING_PALETTES[i], landmarkEmoji: CITY_LANDMARK_EMOJI[i],
      buildings: [
        { xf: hallXf, yf: hallYf, wf: 0.34, hf: hallHf, hasDoor: true },
        { xf: landmarkXf, yf: cornerTopYf, wf: 0.18, hf: cornerHf, emoji: CITY_LANDMARK_EMOJI[i] },
        { xf: shopXf, yf: cornerTopYf, wf: 0.18, hf: cornerHf, emoji: '🏪', hasDoor: true },
        { xf: historianXf, yf: cornerBottomYf, wf: 0.18, hf: cornerHf, emoji: '🧑‍🏫', hasDoor: true },
        { xf: healXf, yf: cornerBottomYf, wf: 0.18, hf: cornerHf, emoji: '🏥', hasDoor: true },
      ],
      loreNpcs: [
        { id: plazaId + 'lore', name: name + ' Elder', emoji: '🧓', dialogue: LORE_QUOTES[i], gymId,
          gymDefeatedDialogue: `Word is you beat ${GYM_LEADER_NAMES[i]} for the badge — well done!`,
          bearKingDialogue: `All of ${name} is proud to say the new Bear King passed through here!` },
        { id: plazaId + 'town1', name: town1.name, emoji: town1.emoji, dialogue: town1.dialogue, gymId,
          gymDefeatedDialogue: GYM_DEFEATED_TOWNSFOLK_QUOTES[i % GYM_DEFEATED_TOWNSFOLK_QUOTES.length],
          bearKingDialogue: BEAR_KING_TOWNSFOLK_QUOTES[i % BEAR_KING_TOWNSFOLK_QUOTES.length] },
        { id: plazaId + 'town2', name: town2.name, emoji: town2.emoji, dialogue: town2.dialogue, gymId,
          gymDefeatedDialogue: GYM_DEFEATED_TOWNSFOLK_QUOTES[(i + 2) % GYM_DEFEATED_TOWNSFOLK_QUOTES.length],
          bearKingDialogue: BEAR_KING_TOWNSFOLK_QUOTES[(i + 2) % BEAR_KING_TOWNSFOLK_QUOTES.length] },
      ],
      doors: [
        { xf: hallXf, yf: hallDoorYf, to: hallId, enterXf: HALL_POS.door.xf, enterYf: HALL_POS.door.yf - 0.14 },
        { xf: shopXf, yf: shopDoorYf, to: shopId, enterXf: ROOM_DOOR_POS.xf, enterYf: ROOM_DOOR_POS.yf - 0.1 },
        { xf: historianXf, yf: historianDoorYf, to: histId, enterXf: ROOM_DOOR_POS.xf, enterYf: ROOM_DOOR_POS.yf - 0.1 },
        { xf: healXf, yf: healDoorYf, to: healId, enterXf: ROOM_DOOR_POS.xf, enterYf: ROOM_DOOR_POS.yf - 0.1 },
      ],
    });
    CITY_ROOMS.push({
      id: shopId, type: 'cityroom', roomKind: 'shop', name: name + ' General Store', cityName: name, plazaId,
      palette: CITY_BUILDING_PALETTES[i],
      loreNpcs: [
        { id: shopId + 'keeper', name: 'Shopkeeper', emoji: '🦫', special: 'shop', dialogue: "Welcome! Honey Traps and Healing Potions for sale." },
        { id: shopId + 'regular', name: storeRegular.name, emoji: storeRegular.emoji, dialogue: storeRegular.dialogue, bearKingDialogue: storeRegular.bearKing },
      ],
      doors: [{ xf: ROOM_DOOR_POS.xf, yf: ROOM_DOOR_POS.yf, to: plazaId, enterXf: shopXf, enterYf: shopDoorYf + 0.1 }],
    });
    CITY_ROOMS.push({
      id: healId, type: 'cityroom', roomKind: 'heal', name: name + ' Healing Center', cityName: name, plazaId,
      palette: CITY_BUILDING_PALETTES[i],
      loreNpcs: [
        { id: healId + 'willow', name: 'Nurse Willow', emoji: '👩‍⚕️', special: 'heal', dialogue: NURSE_WILLOW_GREETING },
        { id: healId + 'patient', name: healPatient.name, emoji: healPatient.emoji, dialogue: healPatient.dialogue, bearKingDialogue: healPatient.bearKing },
      ],
      doors: [{ xf: ROOM_DOOR_POS.xf, yf: ROOM_DOOR_POS.yf, to: plazaId, enterXf: healXf, enterYf: healDoorYf + 0.1 }],
    });
    CITY_ROOMS.push({
      id: histId, type: 'cityroom', roomKind: 'archive', name: name + ' Archive', cityName: name, plazaId,
      palette: CITY_BUILDING_PALETTES[i],
      loreNpcs: [
        { id: histId + 'historian', name: name + ' Historian', emoji: '🧑‍🏫', dialogue: HISTORIAN_QUOTES[i], bearKingDialogue: BEAR_KING_HISTORIAN_QUOTES[i % BEAR_KING_HISTORIAN_QUOTES.length] },
        { id: histId + 'assistant', name: archiveAssistant.name, emoji: archiveAssistant.emoji, dialogue: archiveAssistant.dialogue, bearKingDialogue: archiveAssistant.bearKing },
      ],
      doors: [{ xf: ROOM_DOOR_POS.xf, yf: ROOM_DOOR_POS.yf, to: plazaId, enterXf: historianXf, enterYf: historianDoorYf + 0.1 }],
    });
  });

  // Elite Four — 4 separate chambers now, one trainer each, walked
  // through in sequence just like a Wild Area pair, rather than one room
  // holding all four at once.
  const ELITE_ACE_POOL = VARIANTS.filter(v => !v.godOnly);
  const ELITE_TRAINERS = ELITE_NAMES.map((name, i) => {
    const v = ELITE_ACE_POOL[ELITE_ACE_POOL.length - 1 - i];
    const level = 46 + i; // Cub is level 46 the first time it can reach Elite 1 (9 zones * 5 wins each + 1)
    const stats = trainerStatsAt(level, 1.4, 1.25);
    return {
      id: 'elite' + (i + 1), name, emoji: ELITE_EMOJI[i], role: 'elite',
      quote: ELITE_QUOTES[i],
      moneyReward: 100 + i * 15,
      bear: { name: name + "'s Ace", emoji: v.emoji, tint: v.tint, hp: stats.hp, atk: stats.atk, level },
    };
  });
  const ELITE_ROOM_POS = { xf: 0.5, yf: 0.5 };
  const ELITE_AREAS = ELITE_TRAINERS.map((trainer, i) => ({
    id: 'elite' + (i + 1), type: 'elite', roomKind: 'elite', eliteIndex: i, name: 'Elite Chamber: ' + trainer.name, trainers: [trainer],
  }));

  const BEAR_KING_LEVEL = 50;
  const bearKingStats = trainerStatsAt(BEAR_KING_LEVEL, 1.6, 1.35);
  const BEAR_KING_TRAINER = {
    id: 'bearking', name: 'The Bear King', emoji: '👑', role: 'bearking',
    quote: "So you've made it all this way... let's finish this!",
    moneyReward: 400,
    bear: { name: "The King's Ancient Bear", emoji: '🧸', tint: 'hue-rotate(260deg) saturate(3) brightness(0.8)', hp: bearKingStats.hp, atk: bearKingStats.atk, level: BEAR_KING_LEVEL },
  };
  const BEAR_KING_AREA = { id: 'bearking', type: 'bearking', roomKind: 'bearking', name: "The Bear King's Chamber", trainers: [BEAR_KING_TRAINER] };

  const HOMETOWN_AREA = {
    id: 'hometown', type: 'hometown', name: 'Bear Hollow',
    buildings: [
      { xf:0.3, yf:0.24, wf:0.24, hf:0.18, emoji:'🔬', palette:{ wall:'#8fb3d9', roof:'#3f6a8a' }, hasDoor:true },  // the Lab
      { xf:0.7, yf:0.24, wf:0.24, hf:0.18, emoji:'🏠', palette:{ wall:'#d99a5b', roof:'#8a3f2b' }, hasDoor:true },  // home
    ],
    // Nobody stands out in the open anymore — the Professor and Mom are
    // each inside their own building, reached through a door.
    loreNpcs: [],
    doors: [
      { xf: 0.3, yf: 0.33, to: 'hometownlab', enterXf: ROOM_DOOR_POS.xf, enterYf: ROOM_DOOR_POS.yf - 0.1 },
      { xf: 0.7, yf: 0.33, to: 'hometownhome', enterXf: ROOM_DOOR_POS.xf, enterYf: ROOM_DOOR_POS.yf - 0.1 },
    ],
  };
  // The Outskirts — a separate section to the west of Bear Hollow, reached
  // by walking off the town's left edge. The old abandoned castle lives
  // out here, ringed by its own perimeter wall. The gate in that wall is
  // a real physical barrier (see resolvePerimeterCollision) — closed
  // until the player actually has the Celestial Bear, at which point it
  // opens and the courtyard (and the castle's own front door) becomes
  // walkable.
  const HOMETOWN_OUTSKIRTS_AREA = {
    id: 'hometownoutskirts', type: 'outskirts', name: 'The Outskirts',
    buildings: [
      { xf:0.5, yf:0.26, wf:0.28, hf:0.19, emoji:'🏰', palette:{ wall:'#6b6b6b', roof:'#2e2e35' }, hasDoor:true }, // the old abandoned castle — sized so its roof peak clears the wall's top edge
    ],
    // The wall ringing the castle grounds, with a gate-width gap at the
    // bottom center. Drawn by drawPerimeterWall() and physically blocked
    // by resolvePerimeterCollision() while requiresCelestial is true and
    // the Celestial Bear hasn't been caught yet.
    perimeter: { left:0.2, right:0.8, top:0.03, bottom:0.5, gateXf:0.5, gateWidth:0.16, color:'#55555c', requiresCelestial: true },
    // The moat sits between the gate and the castle itself — a real
    // stretch of water you cross via the bridge once past the gate.
    // Purely visual (the walkway already runs straight through it).
    moat: { top:0.4, bottom:0.46, bridgeWidth:0.09 },
    loreNpcs: [],
    doors: [
      { xf: 0.5, yf: 0.355, to: 'hometownruins', enterXf: ROOM_DOOR_POS.xf, enterYf: ROOM_DOOR_POS.yf - 0.1 }, // the castle's own front door
    ],
  };
  const HOMETOWN_ROOMS = [
    {
      id: 'hometownlab', type: 'cityroom', roomKind: 'lab', name: 'Bear Professor Hazel\'s Lab', plazaId: 'hometown',
      palette: { wall:'#8fb3d9', roof:'#3f6a8a' },
      loreNpcs: [
        // The Professor explains the whole point of the adventure up
        // front — catch every variant, beat every Gym Leader and the
        // Elite Four, then dethrone the Bear King — and gets one more
        // proud line once the player's actually found the Celestial Bear.
        { id: 'professor', name: 'Bear Professor Hazel', emoji: '🧑‍🔬', special: 'starter',
          dialogue: "Welcome, Cub Catcher! Before you head out, pick a bear to partner with. Here's the whole quest: catch all 18 wild bear variants, beat every Gym Leader and the Elite Four, then defeat the Bear King and become the new Bear King yourself!",
          afterDialogue: "Remember the quest: catch all 18 variants, beat every Gym Leader, and dethrone the Bear King! I believe in you. Take good care of each other out there!",
          celestialDialogue: "The Celestial Bear... you actually did it. Every variant, and the crown too. There's an old friend of mine who'd love to test you properly now — but I'll let you find him yourself." },
      ],
      doors: [{ xf: ROOM_DOOR_POS.xf, yf: ROOM_DOOR_POS.yf, to: 'hometown', enterXf: 0.3, enterYf: 0.33 + 0.1 }],
    },
    {
      id: 'hometownhome', type: 'cityroom', roomKind: 'home', name: 'Home', plazaId: 'hometown',
      palette: { wall:'#d99a5b', roof:'#8a3f2b' },
      loreNpcs: [
        { id: 'mom', name: 'Mom', emoji: '👩',
          dialogue: "Be safe out there, sweetie — and don't forget to write! Oh, and stay away from that old castle at the edge of town — it's abandoned, and not safe.",
          noStarterDialogue: "Go say hi to Professor Hazel over at the Lab — she's got a bear waiting for you! Your adventure can't start without one.",
          celestialDialogue: "That old castle's gate finally creaked open, hasn't it? I always heard Ronan was holed up in there, waiting for someone strong enough. That's you now.",
          bearKingDialogue: "I heard the news — my little Cub Catcher is the new Bear King! I have never been prouder." },
      ],
      doors: [{ xf: ROOM_DOOR_POS.xf, yf: ROOM_DOOR_POS.yf, to: 'hometown', enterXf: 0.7, enterYf: 0.33 + 0.1 }],
    },
    {
      id: 'hometownruins', type: 'ruins', roomKind: 'ruins', name: 'The Abandoned Castle', plazaId: 'hometownoutskirts',
      palette: { wall:'#5a5a5a', roof:'#333333' },
      doors: [{ xf: ROOM_DOOR_POS.xf, yf: ROOM_DOOR_POS.yf, to: 'hometownoutskirts', enterXf: 0.5, enterYf: 0.355 + 0.1 }],
    },
  ];
  const STARTER_IDS = ['brown', 'panda', 'koala'];

  // Master Ronan — the true final challenge, holed up in the abandoned
  // castle out in the Outskirts. Only reachable once the player actually
  // has the Celestial Bear (the gate itself stays locked until then), and
  // it's the toughest fight in the game.
  const MASTER_LEVEL = 51;
  const masterStats = trainerStatsAt(MASTER_LEVEL, 1.9, 1.5);
  const MASTER_TRAINER = {
    id: 'master', name: 'Master Ronan', emoji: '🥷', role: 'master',
    quote: "So you've become the Bear King and found the Celestial Bear... let's see if that was skill, or luck.",
    moneyReward: 500,
    bear: { name: "Ronan's Apex Bear", emoji: '🐻', tint: 'hue-rotate(320deg) saturate(3) brightness(0.85) contrast(1.3)', hp: masterStats.hp, atk: masterStats.atk, level: MASTER_LEVEL },
  };

  const AREAS = {};
  AREAS.hometown = HOMETOWN_AREA;
  AREAS.hometownoutskirts = HOMETOWN_OUTSKIRTS_AREA;
  HOMETOWN_ROOMS.forEach(a => { AREAS[a.id] = a; });
  WILD_AREAS.forEach(a => { AREAS[a.id] = a; });
  CITY_AREAS.forEach(a => { AREAS[a.id] = a; });
  CITY_HALLS.forEach(a => { AREAS[a.id] = a; });
  CITY_ROOMS.forEach(a => { AREAS[a.id] = a; });
  ELITE_AREAS.forEach(a => { AREAS[a.id] = a; });
  AREAS.bearking = BEAR_KING_AREA;

  // Only the Plazas (not their Battle Halls) count as one of the 29
  // numbered sections — halls are reached only through their Plaza's door.
  // Bear Hollow (the starting town) sits before all of it and isn't
  // numbered either — you can only ever move forward out of it. Each of
  // the 9 zones contributes 2 Wild Area sections before its City. The
  // Elite Four are 4 separate chambers walked through in sequence, then
  // the Bear King's Chamber.
  const AREA_ORDER = [];
  for (let i = 0; i < 9; i++) {
    AREA_ORDER.push('wild' + (2 * i + 1));
    AREA_ORDER.push('wild' + (2 * i + 2));
    AREA_ORDER.push('city' + (i + 1));
  }
  AREA_ORDER.push('elite1', 'elite2', 'elite3', 'elite4', 'bearking');

  function nextAreaId(id){
    if (id === 'hometown') return 'wild1';
    if (id === 'hometownoutskirts') return 'hometown';
    const i = AREA_ORDER.indexOf(id); return (i >= 0 && i < AREA_ORDER.length - 1) ? AREA_ORDER[i + 1] : null;
  }
  function prevAreaId(id){
    if (id === 'wild1') return 'hometown';
    if (id === 'hometown') return 'hometownoutskirts';
    const i = AREA_ORDER.indexOf(id); return i > 0 ? AREA_ORDER[i - 1] : null;
  }

  // The forward path out of Bear Hollow needs a starter chosen; out of a
  // Wild Area it's always open; out of a City Plaza it needs that city's
  // Gym Leader beaten (the Gym Leader itself lives in the Battle Hall,
  // reached through the Plaza's door); out of the Elite Four hall it
  // needs that chamber's own Elite trainer beaten. The Bear King's Chamber is the end.
  function isForwardUnlocked(areaId){
    const area = AREAS[areaId];
    if (area.type === 'hometown') return !!starterVariantId;
    if (area.type === 'city') return !!trainersDefeated[AREAS[area.hallId].gymLeader.id];
    if (area.type === 'elite') return !!trainersDefeated[area.trainers[0].id];
    return true;
  }

  function areaTrainers(area){
    if (area.type === 'wild') return area.trainers || [];
    if (area.type === 'ruins') return trainersDefeated[MASTER_TRAINER.id] ? [] : [MASTER_TRAINER];
    if (area.type === 'cityhall') return [area.gymLeader, ...area.trainers];
    if (area.type === 'elite' || area.type === 'bearking') return area.trainers;
    return [];
  }
  function trainerPositions(area){
    if (area.type === 'wild') return WILD_TRAINER_POS;
    if (area.type === 'ruins') return [ROOM_DOOR_POS_CENTER];
    if (area.type === 'cityhall') return [HALL_POS.gym, HALL_POS.t1, HALL_POS.t2];
    if (area.type === 'elite') return [ELITE_ROOM_POS];
    if (area.type === 'bearking') return [BEAR_KING_POS];
    return [];
  }
  function areaLoreNpcs(area){
    if (area.type === 'city' || area.type === 'wild' || area.type === 'cityroom') return area.loreNpcs || [];
    return [];
  }
  function loreNpcPositions(area){
    if (area.type === 'city') return [PLAZA_POS.elder, PLAZA_POS.town1, PLAZA_POS.town2];
    if (area.type === 'wild') return WILD_LORE_POS;
    if (area.type === 'cityroom') return ROOM_NPC_POS;
    return [];
  }

  const PLAYER_START = { xf:0.5, yf:0.62 };

  const player = { x:0, y:0, dirX:0, dirY:1 };
  const dpadDown = { up:false, down:false, left:false, right:false };
  let grassStepDist = 0;
  let currentArea = 'hometown';

  let cub = { level:1, maxHp:20, hp:20, atk:4 };
  let collection = {};        // { variantId: true }
  let bearHp = {};            // { variantId: currentHp } — each caught bear keeps its own HP now
  let trainersDefeated = {};  // { trainerId: true }
  let beatBearKing = false;
  let godModeOn = false;      // set by activateGodMode(); suppresses wild encounters entirely
  let money = 0;
  let honeyTraps = 5;
  let healingPotions = 1;
  let fullRestores = 0;
  let starterVariantId = null;
  let activeBearId = null; // which caught bear currently leads/battles — its own HP, plus a stat bonus

  let battleKind = null;      // 'wild' | 'trainer'
  let battleVariant = null;
  let battleTrainerId = null;
  let battleTrainerRole = null; // 'regular' | 'gym' | 'elite' | 'bearking' | 'master'
  let battleMoneyReward = 0;
  let battleEnemy = null;     // { name, emoji, maxHp, hp, atk }
  let battleEnemyTint = null;
  let dexOpen = false;
  let dialogOpen = false;
  let dialogNpcX = 0, dialogNpcY = 0;
  // A brief rising-hearts/sparkle animation drawn over the player whenever
  // the Cub is healed in the overworld (Nurse Willow, or a Potion/Full
  // Restore used outside of battle).
  let healEffectStart = 0;
  let healEffectX = 0, healEffectY = 0;
  const HEAL_EFFECT_DURATION = 900;
  function triggerHealEffect(x, y){
    healEffectStart = performance.now();
    healEffectX = x; healEffectY = y;
  }
  function drawHealEffect(){
    if (!healEffectStart) return;
    const elapsed = performance.now() - healEffectStart;
    if (elapsed > HEAL_EFFECT_DURATION) { healEffectStart = 0; return; }
    const t = elapsed / HEAL_EFFECT_DURATION;
    const rise = t * 26;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - t);
    drawEmoji('💚', healEffectX - 10, healEffectY - 22 - rise, 15);
    drawEmoji('✨', healEffectX + 10, healEffectY - 14 - rise * 0.7, 13);
    drawEmoji('💫', healEffectX, healEffectY - 30 - rise * 1.3, 13);
    ctx.restore();
    // Keep animating even if nothing else would otherwise trigger a redraw
    // (e.g. the player is standing still while a dialog is open).
    if (state === 'overworld' && !rafId) { rafId = requestAnimationFrame(loop); }
  }

  function currentHoliday(){
    return document.documentElement.getAttribute('data-holiday') || 'standard';
  }

  function palette(){
    const h = currentHoliday();
    if (h === 'christmas') return { path:'#eaf4f0', grass:'#8fcbb0', wall:'#1e7d4a' };
    if (h === 'halloween') return { path:'#241831', grass:'#4a2f63', wall:'#6b2fa0' };
    return { path:'#e8dcc8', grass:'#5a9e52', wall:'#3d8fae' };
  }

  function randInt(min, max){ return Math.floor(min + Math.random() * (max - min + 1)); }

  function statsForLevel(level){
    return { maxHp: 20 + (level - 1) * 6, atk: 4 + Math.round((level - 1) * 1.5) };
  }

  // Every trainer's level below is set to the Cub's *actual* level at the
  // point in the game you'd realistically face them (every trainer win
  // grants exactly one Cub level, so this is derived directly from the
  // fixed order of fights), then a role multiplier is applied on top —
  // regular trainers are a fair same-level fight, gym leaders/Elite Four/
  // Bear King/Master are progressively harder than a same-level match
  // rather than trailing behind the Cub's own growth.
  function trainerStatsAt(level, hpMult, atkMult){
    const base = statsForLevel(level);
    return { hp: Math.max(4, Math.round(base.maxHp * hpMult)), atk: Math.max(2, Math.round(base.atk * atkMult)) };
  }

  // Every caught bear now has its own HP, remembered across switches —
  // only the level (and therefore max HP/attack) is shared. bearHp maps
  // variantId -> current HP; getBearMaxHp/getBearAtk compute a given
  // bear's stats at the Cub's current shared level plus that variant's
  // own bonus, so different bears can have different max HP.
  function getBearMaxHp(variantId){
    const base = statsForLevel(cub.level);
    const v = variantId ? variantById(variantId) : null;
    return v ? base.maxHp + v.hp : base.maxHp;
  }
  function getBearAtk(variantId){
    const base = statsForLevel(cub.level);
    const v = variantId ? variantById(variantId) : null;
    return v ? base.atk + Math.floor(v.atk / 2) : base.atk;
  }
  // A freshly caught (or the starter's) bear always starts at full HP.
  function initBearHp(variantId){
    bearHp[variantId] = getBearMaxHp(variantId);
  }
  // Refreshes cub.maxHp/atk/hp to reflect whichever bear is currently
  // active, WITHOUT healing it — each bear keeps whatever HP it's got
  // until it's actually healed (Nurse Willow, a Potion, or fully caught
  // fresh). This is what fixes the old "switch away and back = free
  // full heal" bug.
  function syncActiveCubStats(){
    cub.maxHp = getBearMaxHp(activeBearId);
    cub.atk = getBearAtk(activeBearId);
    if (activeBearId) {
      if (bearHp[activeBearId] === undefined) initBearHp(activeBearId);
      cub.hp = Math.min(bearHp[activeBearId], cub.maxHp);
    } else {
      cub.hp = cub.maxHp;
    }
  }
  // Applies incoming battle damage to whichever bear is currently active,
  // keeping bearHp and the displayed cub.hp in sync.
  function applyDamageToActive(dmg){
    const cur = bearHp[activeBearId] !== undefined ? bearHp[activeBearId] : cub.maxHp;
    bearHp[activeBearId] = Math.max(0, cur - dmg);
    cub.hp = bearHp[activeBearId];
  }

  function pickWildVariant(area){
    const opts = area.variantIds.map(id => variantById(id));
    const total = opts.reduce((s, v) => s + v.weight, 0);
    let r = Math.random() * total;
    for (const v of opts) { if (r < v.weight) return v; r -= v.weight; }
    return opts[0];
  }

  function px(f, dim){ return f * (dim === 'w' ? width : height); }
  function grassRectPx(z){ return { x: px(z.xf,'w'), y: px(z.yf,'h'), w: px(z.wf,'w'), h: px(z.hf,'h') }; }
  function inRect(x, y, r){ return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }

  function resize(){
    if (!wrap || !canvas) return;
    const rect = wrap.getBoundingClientRect();
    width = Math.max(220, rect.width);
    height = 320;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (state !== 'overworld') {
      player.x = px(PLAYER_START.xf, 'w');
      player.y = px(PLAYER_START.yf, 'h');
      drawStaticFrame();
    }
  }

  function clampToArena(x, y, r){
    return {
      x: Math.min(width - ARENA_PAD - r, Math.max(ARENA_PAD + r, x)),
      y: Math.min(height - ARENA_PAD - r, Math.max(ARENA_PAD + r, y)),
    };
  }

  // Buildings block the player the same way the outer walls do — you
  // can't walk onto or through one — except for a doorway-width notch at
  // its bottom-center, which is where a hasDoor building's actual door
  // trigger circle lives. Without that notch the player could never
  // reach the door; without the rest of the block being solid at all, a
  // Plaza's own door-exit could spawn the player back on top of a
  // building's roof, right back inside another door's collision circle —
  // which is what caused the enter/exit loop this fixes.
  function buildingBlocksPoint(b, x, y){
    const cx = px(b.xf, 'w');
    const bottom = px(b.yf, 'h') + px(b.hf, 'h') / 2;
    const wPx = px(b.wf, 'w');
    const hPx = px(b.hf, 'h');
    const top = bottom - hPx;
    const left = cx - wPx / 2 - PLAYER_R;
    const right = cx + wPx / 2 + PLAYER_R;
    const topPad = top - PLAYER_R;
    const bottomPad = bottom + PLAYER_R * 0.2;
    if (x < left || x > right || y < topPad || y > bottomPad) return false;
    if (b.hasDoor) {
      const notchHalf = NPC_R + PLAYER_R;
      if (Math.abs(x - cx) <= notchHalf && y >= bottom - hPx * 0.35) return false;
    }
    return true;
  }
  function resolveBuildingCollision(area, curX, curY, nextX, nextY){
    if (!area.buildings || !area.buildings.length) return { x: nextX, y: nextY };
    const blocked = (x, y) => area.buildings.some(b => buildingBlocksPoint(b, x, y));
    if (!blocked(nextX, nextY)) return { x: nextX, y: nextY };
    // Slide along whichever single axis is still clear, so brushing past a
    // building's corner doesn't just stop the player dead.
    if (!blocked(curX, nextY)) return { x: curX, y: nextY };
    if (!blocked(nextX, curY)) return { x: nextX, y: curY };
    return { x: curX, y: curY };
  }

  // A perimeter wall (see the Outskirts' castle grounds) blocks the
  // player like a building's outline, except its bottom edge has a
  // gate-width gap — passable once unlocked, solid (no gap at all) while
  // requiresCelestial is true and the Celestial Bear hasn't been caught.
  function perimeterBlocksPoint(wall, x, y){
    const left = px(wall.left, 'w') - PLAYER_R, right = px(wall.right, 'w') + PLAYER_R;
    const top = px(wall.top, 'h') - PLAYER_R, bottom = px(wall.bottom, 'h');
    const thick = 8 + PLAYER_R;
    if (x < left || x > right || y < top - PLAYER_R || y > bottom + PLAYER_R) return false;
    // Top and side walls always block.
    if (y <= top + thick) return true;
    if (x <= left + thick || x >= right - thick) return true;
    // Bottom wall (the gate) — solid unless unlocked, in which case
    // there's a gap around gateXf.
    if (y >= bottom - thick) {
      const unlocked = !wall.requiresCelestial || collection['celestial'];
      if (!unlocked) return true;
      const gateX = px(wall.gateXf, 'w'), gateHalf = px(wall.gateWidth, 'w') / 2;
      return Math.abs(x - gateX) > gateHalf;
    }
    return false;
  }
  function resolvePerimeterCollision(area, curX, curY, nextX, nextY){
    if (!area.perimeter) return { x: nextX, y: nextY };
    const wall = area.perimeter;
    const blocked = (x, y) => perimeterBlocksPoint(wall, x, y);
    if (!blocked(nextX, nextY)) return { x: nextX, y: nextY };
    if (!blocked(curX, nextY)) return { x: curX, y: nextY };
    if (!blocked(nextX, curY)) return { x: nextX, y: curY };
    return { x: curX, y: curY };
  }

  function updateHud(){
    if (levelEl) levelEl.textContent = String(cub.level);
    if (countEl) countEl.textContent = String(Object.keys(collection).filter(id => { const v = variantById(id); return v && !v.godOnly; }).length);
    if (totalEl) totalEl.textContent = String(VARIANTS.filter(v => !v.godOnly).length);
    if (bearKingBadgeEl) bearKingBadgeEl.style.display = beatBearKing ? 'inline' : 'none';
    if (badgesEl) {
      const badgeCount = CITY_HALLS.filter(h => trainersDefeated[h.gymLeader.id]).length;
      badgesEl.textContent = badgeCount + '/' + CITY_HALLS.length;
    }
    if (moneyEl) moneyEl.textContent = String(money);
    if (honeyTrapsEl) honeyTrapsEl.textContent = String(honeyTraps);
    if (potionsEl) potionsEl.textContent = String(healingPotions);
    renderDexPanel();
  }

  function renderDexPanel(){
    if (!dexListEl) return;
    dexListEl.innerHTML = '';
    VARIANTS.forEach(v => {
      if (v.godOnly) return;
      const caught = !!collection[v.id];
      const row = document.createElement('div');
      row.className = 'dex-row-item';
      const icon = document.createElement('span');
      icon.className = 'dex-row-icon';
      icon.textContent = caught ? v.emoji : '❔';
      icon.style.filter = (caught && v.tint) ? v.tint : (caught ? '' : 'grayscale(1)');
      icon.style.opacity = caught ? '1' : '0.4';
      const label = document.createElement('span');
      label.className = 'dex-row-label';
      label.textContent = caught ? v.name : '???';
      const status = document.createElement('span');
      status.className = 'dex-row-status';
      status.textContent = caught ? '✅' : '';
      row.appendChild(icon); row.appendChild(label); row.appendChild(status);
      dexListEl.appendChild(row);
    });
  }

  function saveProgress(){
    const payload = {
      level: cub.level,
      bearHp: { ...bearHp },
      collection: Object.keys(collection),
      trainersDefeated: Object.keys(trainersDefeated),
      beatBearKing,
      currentArea,
      money,
      honeyTraps,
      healingPotions,
      fullRestores,
      starterVariantId,
      activeBearId,
    };
    storage.set('catchSave', JSON.stringify(payload)).catch(() => {});
  }

  async function loadProgress(){
    let savedArea = null;
    let savedHp = null; // only present in older saves, before per-bear HP existed
    let savedBearHp = null;
    try {
      const res = await storage.get('catchSave');
      if (res && res.value) {
        const data = JSON.parse(res.value);
        if (data && typeof data === 'object') {
          if (data.level) cub.level = data.level;
          if (typeof data.hp === 'number') savedHp = data.hp;
          if (data.bearHp && typeof data.bearHp === 'object') savedBearHp = data.bearHp;
          if (Array.isArray(data.collection)) data.collection.forEach(id => { collection[id] = true; });
          if (Array.isArray(data.trainersDefeated)) data.trainersDefeated.forEach(id => { trainersDefeated[id] = true; });
          if (data.champion || data.beatBearKing) beatBearKing = true;
          if (typeof data.money === 'number') money = data.money;
          if (typeof data.honeyTraps === 'number') honeyTraps = data.honeyTraps;
          if (typeof data.healingPotions === 'number') healingPotions = data.healingPotions;
          if (typeof data.fullRestores === 'number') fullRestores = data.fullRestores;
          if (data.starterVariantId && variantById(data.starterVariantId)) starterVariantId = data.starterVariantId;
          if (data.activeBearId && variantById(data.activeBearId)) activeBearId = data.activeBearId;
          if (data.currentArea && AREAS[data.currentArea]) savedArea = data.currentArea;
        }
      }
    } catch (e) {}
    if (savedArea) currentArea = savedArea;
    // Older saves (or a fresh choice with no explicit lead set yet) default
    // the lead bear to the starter.
    if (!activeBearId && starterVariantId) activeBearId = starterVariantId;
    // Rebuild each caught bear's HP: prefer the new per-bear record, fall
    // back to the old single shared-HP field for whichever bear was
    // active on an older save, and default anyone else to full.
    Object.keys(collection).forEach(id => {
      if (savedBearHp && typeof savedBearHp[id] === 'number') {
        bearHp[id] = savedBearHp[id];
      } else if (id === activeBearId && savedHp !== null) {
        bearHp[id] = Math.min(getBearMaxHp(id), Math.max(1, savedHp));
      } else {
        bearHp[id] = getBearMaxHp(id);
      }
    });
    syncActiveCubStats();
    updateHud();
  }

  // ---- overworld ----

  function startAdventure(){
    state = 'overworld';
    overlay.classList.remove('show');
    player.x = px(PLAYER_START.xf, 'w');
    player.y = px(PLAYER_START.yf, 'h');
    player.dirX = 0; player.dirY = 1;
    lastFrameTime = null;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  // Resetting is destructive, so it's confirmed first — via an in-app
  // panel rather than the browser's native confirm(), since sandboxed
  // preview iframes commonly block confirm()/alert()/prompt() and make it
  // silently return false, which would make the reset button look like it
  // does nothing at all.
  let resetConfirmOpen = false;
  function openResetConfirm(){
    if (state === 'battle') return;
    resetConfirmOpen = true;
    resetConfirmPanel.classList.add('show');
  }
  function closeResetConfirm(){
    resetConfirmOpen = false;
    resetConfirmPanel.classList.remove('show');
  }
  function confirmReset(){
    cub = { level: 1, maxHp: 20, hp: 20, atk: 4 };
    collection = {};
    bearHp = {};
    trainersDefeated = {};
    beatBearKing = false;
    godModeOn = false;
    updateGodModeButton();
    honeyTraps = 5;
    healingPotions = 1;
    fullRestores = 0;
    starterVariantId = null;
    activeBearId = null;
    currentArea = 'hometown';
    player.x = px(PLAYER_START.xf, 'w');
    player.y = px(PLAYER_START.yf, 'h');
    resetConfirmOpen = false;
    resetConfirmPanel.classList.remove('show');
    saveProgress();
    updateHud();
    if (state === 'overworld') draw();
  }

  function moveVectorFromInput(){
    let mx = 0, my = 0;
    if (dpadDown.up) my -= 1;
    if (dpadDown.down) my += 1;
    if (dpadDown.left) mx -= 1;
    if (dpadDown.right) mx += 1;
    if (mx !== 0 && my !== 0) { mx *= 0.7071; my *= 0.7071; }
    return { mx, my };
  }

  function goToArea(nextId, enterFromSide, enterXf, enterYf){
    currentArea = nextId;
    grassStepDist = 0;
    if (enterXf !== undefined && enterYf !== undefined) {
      player.x = px(enterXf, 'w');
      player.y = px(Math.min(0.94, Math.max(0.06, enterYf)), 'h');
    } else if (enterFromSide === 'left') {
      player.x = ARENA_PAD + PLAYER_R + EXIT_MARGIN + 6;
    } else if (enterFromSide === 'right') {
      player.x = width - ARENA_PAD - PLAYER_R - EXIT_MARGIN - 6;
    }
    saveProgress();
  }

  function updateOverworld(dt){
    if (dexOpen || dialogOpen || storeOpen || starterOpen || resetConfirmOpen || bearSwitchOpen || healConfirmOpen || trainerIntroOpen) return;
    const area = AREAS[currentArea];
    const { mx, my } = moveVectorFromInput();
    if (mx !== 0 || my !== 0) {
      player.dirX = mx; player.dirY = my;
      let next = clampToArena(player.x + mx * PLAYER_SPEED * dt, player.y + my * PLAYER_SPEED * dt, PLAYER_R);
      next = resolveBuildingCollision(area, player.x, player.y, next.x, next.y);
      next = resolvePerimeterCollision(area, player.x, player.y, next.x, next.y);
      player.x = next.x; player.y = next.y;

      // Walking into an edge with a path opening steps through to the
      // next/previous of the 32 sections, Pokemon-route style, entering
      // from the matching opposite edge rather than scrolling one big
      // continuous map. Forward progress can be gated (gym leader / all
      // four Elite trainers not yet beaten); backward never is.
      const nextId = nextAreaId(currentArea);
      const prevId = prevAreaId(currentArea);
      const atExitGap = Math.abs(player.y - height / 2) <= EXIT_GAP_HALF;
      if (nextId && mx > 0 && atExitGap && player.x >= width - ARENA_PAD - PLAYER_R - EXIT_MARGIN) {
        if (isForwardUnlocked(currentArea)) { goToArea(nextId, 'left'); return; }
      }
      if (prevId && mx < 0 && atExitGap && player.x <= ARENA_PAD + PLAYER_R + EXIT_MARGIN) {
        goToArea(prevId, 'right');
        return;
      }

      if (area.type === 'wild' && !godModeOn) {
        const inGrass = area.grassZones.some(z => inRect(player.x, player.y, grassRectPx(z)));
        if (inGrass) {
          grassStepDist += PLAYER_SPEED * dt;
          if (grassStepDist >= ENCOUNTER_STEP) {
            grassStepDist = 0;
            if (Math.random() < ENCOUNTER_CHANCE) {
              startBattle('wild', pickWildVariant(area));
              return;
            }
          }
        } else {
          grassStepDist = 0;
        }
      }
    }

    // Doors — walking onto one triggers the transition directly, no A
    // button needed (buildings themselves stay solid — see
    // resolveBuildingCollision/perimeter collision above, which already
    // ran before this). A door can also be locked behind the Celestial
    // Bear (the gate to the abandoned castle in the Outskirts) — walking
    // into one of those before then just shows a message.
    if (area.doors) {
      for (const door of area.doors) {
        const dx = px(door.xf, 'w'), dy = px(door.yf, 'h');
        if (Math.hypot(player.x - dx, player.y - dy) < PLAYER_R + NPC_R) {
          if (door.requiresCelestial && !collection['celestial']) {
            showDialog({ emoji: '🔒', name: 'Old Gate', dialogue: "The gate won't budge. Mom did say to stay away from this place..." }, dx, dy);
            return;
          }
          goToArea(door.to, null, door.enterXf, door.enterYf);
          return;
        }
      }
    }
  }

  // Facing check used by interact() below — true if (tx,ty) is close
  // enough to the player AND roughly in front of wherever they're
  // currently facing (player.dirX/dirY, last non-zero movement
  // direction), rather than just anywhere within arm's reach.
  function isFacingTarget(tx, ty){
    const dx = tx - player.x, dy = ty - player.y;
    const dist = Math.hypot(dx, dy);
    if (dist > PLAYER_R + NPC_R + 8) return false;
    if (dist < 0.001) return true;
    const dirX = player.dirX || 0, dirY = player.dirY || 1;
    return (dx / dist) * dirX + (dy / dist) * dirY > 0.35;
  }

  // The 🅰️ button — trainers and lore NPCs don't trigger on simple
  // contact; the player has to be facing one and press this to start the
  // battle/conversation. Doors are the exception — walking onto one still
  // triggers it directly (see updateOverworld). Trainers take priority
  // over lore NPCs.
  function interact(){
    if (state !== 'overworld') return;
    if (dexOpen || dialogOpen || storeOpen || starterOpen || resetConfirmOpen || bearSwitchOpen || healConfirmOpen || trainerIntroOpen) return;
    const area = AREAS[currentArea];

    // Trainers — only ones belonging to the current section, and a Gym
    // Leader can't be challenged until both regular trainers in that
    // Battle Hall are beaten first.
    const trainers = areaTrainers(area);
    const positions = trainerPositions(area);
    for (let i = 0; i < trainers.length; i++) {
      const t = trainers[i];
      if (trainersDefeated[t.id]) continue;
      if (t.role === 'gym' && !isGymUnlocked(area)) continue;
      const pos = positions[i];
      const tx = px(pos.xf, 'w'), ty = px(pos.yf, 'h');
      if (isFacingTarget(tx, ty)) { beginTrainerBattle(t); return; }
    }

    // Lore NPCs (Plaza/Hometown/Wild) — never battle. Most show a line of
    // context-aware dialogue via resolveDialogue(); the Professor and the
    // Shopkeeper/Nurse Willow have their own special flows instead.
    const loreNpcs = areaLoreNpcs(area);
    const lorePositions = loreNpcPositions(area);
    for (let i = 0; i < loreNpcs.length; i++) {
      const npc = loreNpcs[i];
      const pos = lorePositions[i];
      const tx = px(pos.xf, 'w'), ty = px(pos.yf, 'h');
      if (isFacingTarget(tx, ty)) {
        if (npc.special === 'shop') { openStore(tx, ty); return; }
        if (npc.special === 'heal') { visitHealingCenter(npc, tx, ty); return; }
        if (npc.special === 'starter') {
          if (!starterVariantId) { openStarterPicker(npc, tx, ty); return; }
          if (collection['celestial'] && npc.celestialDialogue) { showDialog({ ...npc, dialogue: npc.celestialDialogue }, tx, ty); return; }
          showDialog({ ...npc, dialogue: npc.afterDialogue }, tx, ty); return;
        }
        showDialog({ ...npc, dialogue: resolveDialogue(npc) }, tx, ty);
        return;
      }
    }
  }

  // Trainer battles now flash a portrait + their line for a beat before
  // the actual battle screen opens, instead of going straight to the
  // battle log. Wild encounters are unaffected — they still start
  // immediately, since there's no trainer/quote to show.
  function beginTrainerBattle(t){
    showTrainerIntro(t, () => startBattle('trainer', t));
  }
  function trainerRoleTag(role){
    return role === 'gym' ? ' (Gym Leader)' : role === 'elite' ? ' (Elite Four)' : role === 'bearking' ? ' (Bear King)' : role === 'master' ? ' (Master Trainer)' : '';
  }
  function showTrainerIntro(t, onDone){
    trainerIntroOpen = true;
    trainerIntroSprite.textContent = t.emoji;
    trainerIntroName.textContent = t.name + trainerRoleTag(t.role);
    trainerIntroQuote.textContent = '"' + t.quote + '"';
    trainerIntroPanel.classList.add('show');
    if (trainerIntroTimer) clearTimeout(trainerIntroTimer);
    trainerIntroTimer = setTimeout(() => {
      trainerIntroPanel.classList.remove('show');
      trainerIntroOpen = false;
      trainerIntroTimer = null;
      onDone();
    }, 1300);
  }

  // A Gym Leader can only be challenged once both regular trainers in
  // their Battle Hall have been beaten — pass the Hall itself (not the
  // Plaza) in.
  function isGymUnlocked(hallArea){
    return hallArea.trainers.every(rt => trainersDefeated[rt.id]);
  }


  // The player is a human trainer (catching the bears, not one of them) —
  // a simple cap/head/backpack/body sprite in the same size/position
  // system the old bear sprite used, so no call sites need to change.
  function drawBear(x, y, dirX, dirY, size){
    ctx.save();
    ctx.translate(x, y);
    // backpack, peeking out on the side opposite the facing direction
    ctx.fillStyle = '#7a4a2a';
    ctx.beginPath();
    ctx.ellipse(-dirX * size * 0.32, size * 0.05 - dirY * size * 0.1, size * 0.32, size * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    // body
    ctx.fillStyle = '#3a6ea5';
    ctx.beginPath();
    ctx.ellipse(0, size * 0.22, size * 0.6, size * 0.68, 0, 0, Math.PI * 2);
    ctx.fill();
    // head
    ctx.fillStyle = '#e8b98a';
    ctx.beginPath();
    ctx.arc(0, -size * 0.5, size * 0.46, 0, Math.PI * 2);
    ctx.fill();
    // cap, facing the direction of travel
    ctx.fillStyle = '#c0392b';
    ctx.beginPath();
    ctx.arc(0, -size * 0.66, size * 0.44, Math.PI, 0);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(dirX * size * 0.3, -size * 0.62 + dirY * size * 0.1, size * 0.5, size * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawEmoji(emoji, x, y, size, tint){
    ctx.save();
    if (tint) ctx.filter = tint;
    ctx.font = size + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, x, y);
    ctx.restore();
  }

  function drawFloor(p){
    const area = AREAS[currentArea];
    ctx.fillStyle = p.path;
    ctx.fillRect(0, 0, width, height);
    if (area.type === 'wild') {
      drawWildBackdrop(area);
      ctx.fillStyle = p.grass;
      area.grassZones.forEach(z => {
        const r = grassRectPx(z);
        ctx.globalAlpha = 0.6;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.globalAlpha = 1;
      });
    }
    if (area.type === 'city') drawPlazaTheme(area);
    if (area.type === 'hometown') drawHometownBackdrop();
    if (area.type === 'outskirts') drawCastleBackdrop();
    if (area.perimeter) drawPerimeterWall(area);
    if (area.moat) drawMoat(area);
    if (area.type === 'city' || area.type === 'hometown' || area.type === 'outskirts') drawCityBuildings(area);
    if (area.type === 'cityroom' || area.type === 'ruins' || area.type === 'cityhall' || area.type === 'elite' || area.type === 'bearking') drawRoomInterior(area);
    // Wall border, with a gap left open on any edge this section leads
    // through (plus a little ">"/"<"/lock hint) so it reads as a path
    // onward rather than just a dead wall. A locked forward path (gym
    // leader or Elite Four not yet beaten) shows 🔒 instead of ▶.
    const nextId = nextAreaId(currentArea);
    const prevId = prevAreaId(currentArea);
    const forwardOk = nextId ? isForwardUnlocked(currentArea) : false;
    const gapH = EXIT_GAP_HALF * 2;
    ctx.strokeStyle = p.wall;
    ctx.lineWidth = 4;
    ctx.beginPath();
    const left = ARENA_PAD / 2, top = ARENA_PAD / 2, right = width - ARENA_PAD / 2, bottom = height - ARENA_PAD / 2;
    ctx.moveTo(left, top); ctx.lineTo(right, top);
    ctx.lineTo(right, height / 2 - (nextId ? gapH / 2 : 0));
    if (nextId) { ctx.moveTo(right, height / 2 + gapH / 2); }
    ctx.lineTo(right, bottom);
    ctx.lineTo(left, bottom);
    ctx.lineTo(left, height / 2 + (prevId ? gapH / 2 : 0));
    if (prevId) { ctx.moveTo(left, height / 2 - gapH / 2); }
    ctx.lineTo(left, top);
    ctx.stroke();
    if (nextId) drawEmoji(forwardOk ? '▶' : '🔒', right - 4, height / 2, 14);
    if (prevId) drawEmoji('◀', left + 4, height / 2, 14);

    let labelText;
    if (area.type === 'cityhall' || area.type === 'cityroom') {
      const plazaNum = AREA_ORDER.indexOf(area.plazaId) + 1;
      labelText = `📍 ${plazaNum}/${AREA_ORDER.length} ${area.name}`;
    } else if (area.type === 'hometown') {
      labelText = `🏠 ${area.name}`;
    } else if (area.type === 'outskirts') {
      labelText = `🏰 ${area.name}`;
    } else {
      const sectionNum = AREA_ORDER.indexOf(currentArea) + 1;
      labelText = `📍 ${sectionNum}/${AREA_ORDER.length} ${area.name}`;
    }
    drawAreaLabel(labelText);
  }

  // The area-name label in the top-left corner, on a little wooden
  // signpost backdrop so it stays readable over any floor color/theme
  // instead of just floating semi-transparent text on the scene.
  function drawAreaLabel(text){
    ctx.font = '700 11px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    const padX = 6, padY = 4;
    const x = ARENA_PAD, y = height - 4;
    const textW = ctx.measureText(text).width;
    const boxX = x - padX, boxY = y - 11 - padY, boxW = textW + padX * 2, boxH = 11 + padY * 2;
    // Wood plank backdrop.
    ctx.fillStyle = '#8a6238';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = '#4a3018';
    ctx.lineWidth = 2;
    ctx.strokeRect(boxX, boxY, boxW, boxH);
    // A couple of grain lines so it reads as wood rather than a flat chip.
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      const gy = boxY + (boxH / 3) * i;
      ctx.beginPath(); ctx.moveTo(boxX + 3, gy); ctx.lineTo(boxX + boxW - 3, gy); ctx.stroke();
    }
    ctx.fillStyle = '#fdf1d8';
    ctx.fillText(text, x, y);
  }

  // A stone perimeter wall fully ringing a building, with a real gate
  // structure — two door panels that sit shut (and barred) in the gap
  // while requiresCelestial is true and the Celestial Bear hasn't been
  // caught, or swung open flat against the wall once it has. Used for
  // the castle grounds in the Outskirts.
  function drawPerimeterWall(area){
    const wall = area.perimeter;
    const left = px(wall.left, 'w'), right = px(wall.right, 'w');
    const top = px(wall.top, 'h'), bottom = px(wall.bottom, 'h');
    const gateX = px(wall.gateXf, 'w');
    const gateHalf = px(wall.gateWidth, 'w') / 2;
    const unlocked = !wall.requiresCelestial || collection['celestial'];
    // The wall itself. When locked it's a complete, solid rectangle; when
    // unlocked the bottom edge has a real gap at the gate so the opening
    // is unambiguous, not just implied by the panels drawn over it.
    ctx.strokeStyle = wall.color;
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (unlocked) {
      ctx.moveTo(gateX - gateHalf, bottom);
      ctx.lineTo(left, bottom);
      ctx.lineTo(left, top);
      ctx.lineTo(right, top);
      ctx.lineTo(right, bottom);
      ctx.lineTo(gateX + gateHalf, bottom);
    } else {
      ctx.rect(left, top, right - left, bottom - top);
    }
    ctx.stroke();
    // Gate posts flanking the opening.
    ctx.fillStyle = wall.color;
    ctx.fillRect(gateX - gateHalf - 3, bottom - 18, 6, 18);
    ctx.fillRect(gateX + gateHalf - 3, bottom - 18, 6, 18);
    if (unlocked) {
      // Open — the two door panels swung flat against the wall on
      // either side of the posts, clearly a gate rather than just a gap.
      ctx.fillStyle = wall.color;
      ctx.fillRect(gateX - gateHalf - 3 - (gateHalf * 0.9), bottom - 5, gateHalf * 0.9, 5);
      ctx.fillRect(gateX + gateHalf + 3, bottom - 5, gateHalf * 0.9, 5);
      return;
    }
    // Closed — two solid door panels filling the gap, plus crossed bars
    // and a lock icon so it's unmistakably shut.
    ctx.fillStyle = wall.color;
    ctx.fillRect(gateX - gateHalf, bottom - 18, gateHalf - 1, 18);
    ctx.fillRect(gateX + 1, bottom - 18, gateHalf - 1, 18);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
    ctx.strokeRect(gateX - gateHalf, bottom - 18, gateHalf - 1, 18);
    ctx.strokeRect(gateX + 1, bottom - 18, gateHalf - 1, 18);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(gateX - gateHalf, bottom - 3); ctx.lineTo(gateX + gateHalf, bottom - 15);
    ctx.moveTo(gateX - gateHalf, bottom - 15); ctx.lineTo(gateX + gateHalf, bottom - 3);
    ctx.stroke();
    drawEmoji('🔒', gateX, bottom - 26, 16);
  }

  // A stretch of water between the gate and the building it's guarding,
  // crossed by a single wooden bridge lined up with the gate — purely
  // scenic (the walkway already runs straight along the bridge line).
  function drawMoat(area){
    const moat = area.moat, wall = area.perimeter;
    if (!moat || !wall) return;
    const t = performance.now() / 1000;
    const top = px(moat.top, 'h'), bottom = px(moat.bottom, 'h');
    const left = px(wall.left, 'w') + 6, right = px(wall.right, 'w') - 6;
    ctx.fillStyle = '#3f7fae';
    ctx.fillRect(left, top, right - left, bottom - top);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1.5;
    for (let row = 0; row < 2; row++) {
      const y = top + (bottom - top) * (0.3 + row * 0.4);
      const phase = (t * 26 + row * 15) % 24;
      ctx.beginPath();
      for (let x = left - 24 + phase; x <= right; x += 14) ctx.moveTo(x, y), ctx.quadraticCurveTo(x + 7, y - 2, x + 14, y);
      ctx.stroke();
    }
    const bridgeHalf = px(moat.bridgeWidth, 'w') / 2;
    const gateX = px(wall.gateXf, 'w');
    ctx.fillStyle = '#8a5a34';
    ctx.fillRect(gateX - bridgeHalf, top, bridgeHalf * 2, bottom - top);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
    for (let by = top + 4; by < bottom; by += 6) {
      ctx.beginPath(); ctx.moveTo(gateX - bridgeHalf, by); ctx.lineTo(gateX + bridgeHalf, by); ctx.stroke();
    }
    ctx.strokeStyle = '#5c4020'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(gateX - bridgeHalf, top); ctx.lineTo(gateX - bridgeHalf, bottom); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(gateX + bridgeHalf, top); ctx.lineTo(gateX + bridgeHalf, bottom); ctx.stroke();
  }

  // Each city Plaza's signature look — a tinted ground wash, one
  // backdrop flourish specific to that town (a river's edge, distant
  // peaks, drifting fog...), and ambient particles along the side edges.
  // Drawn before the buildings so nothing sits on top of them.
  function drawPlazaTheme(area){
    const theme = CITY_PLAZA_THEMES[area.landmarkEmoji];
    if (!theme) return;
    ctx.fillStyle = theme.ground;
    ctx.fillRect(0, 0, width, height);
    drawTownBackdrop(area.landmarkEmoji);
  }

  // A full scenic backdrop band across the top of the Plaza, clipped to
  // that band and drawn before the buildings so it reads as scenery
  // sitting behind the town rather than on top of it — real trees for
  // Maple Hollow, an actual river + bridge for Rivertown, snow-capped
  // peaks for Frostpeak, a beach for Sandy Cove, and so on for every city.
  function drawTownBackdrop(landmarkEmoji){
    const bandH = height * 0.17;
    const t = performance.now() / 1000;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, bandH);
    ctx.clip();
    if (landmarkEmoji === '🕰️') {
      // Maple Hollow — a real tree line along the skyline, swaying gently.
      for (let i = 0; i < 6; i++) {
        const cx = (i + 0.5) * (width / 6);
        const sway = Math.sin(t * 1.2 + i * 1.3) * 3;
        ctx.fillStyle = '#8a5a34';
        ctx.fillRect(cx - 3, bandH * 0.5, 6, bandH * 0.55);
        ctx.fillStyle = i % 2 === 0 ? '#c9793f' : '#d9a23f';
        ctx.beginPath(); ctx.arc(cx + sway, bandH * 0.42, 17, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx - 12 + sway, bandH * 0.5, 12, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + 12 + sway, bandH * 0.5, 12, 0, Math.PI * 2); ctx.fill();
      }
    } else if (landmarkEmoji === '🌉') {
      // Rivertown — an actual river with moving waves, plus a small bridge.
      ctx.fillStyle = '#4f7fae';
      ctx.fillRect(0, bandH * 0.3, width, bandH * 0.7);
      ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 2;
      for (let row = 0; row < 3; row++) {
        const y = bandH * (0.5 + row * 0.16);
        const phase = t * 40 + row * 20;
        ctx.beginPath();
        for (let x = -30; x <= width + 20; x += 18) {
          const sx = ((x + phase) % (width + 40)) - 20;
          ctx.moveTo(sx, y); ctx.quadraticCurveTo(sx + 9, y - 4, sx + 18, y);
        }
        ctx.stroke();
      }
      ctx.strokeStyle = '#6b4a28'; ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(width * 0.22, bandH * 0.5);
      ctx.quadraticCurveTo(width * 0.5, bandH * 0.05, width * 0.78, bandH * 0.5);
      ctx.stroke();
      ctx.lineWidth = 2;
      for (let x = 0.28; x <= 0.72; x += 0.11) {
        const bt = (x - 0.22) / 0.56;
        const y = bandH * 0.5 - Math.sin(bt * Math.PI) * bandH * 0.42;
        ctx.beginPath(); ctx.moveTo(width * x, y); ctx.lineTo(width * x, y + 8); ctx.stroke();
      }
    } else if (landmarkEmoji === '🧊') {
      // Frostpeak — icy, snow-capped mountains with drifting snow.
      ctx.fillStyle = '#a9c9de';
      ctx.beginPath();
      ctx.moveTo(0, bandH); ctx.lineTo(0, bandH * 0.35);
      ctx.lineTo(width * 0.16, bandH * 0.88); ctx.lineTo(width * 0.32, bandH * 0.12);
      ctx.lineTo(width * 0.52, bandH * 0.72); ctx.lineTo(width * 0.7, bandH * 0.04);
      ctx.lineTo(width * 0.86, bandH * 0.78); ctx.lineTo(width, bandH * 0.25);
      ctx.lineTo(width, bandH); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffffff';
      [[width * 0.32, bandH * 0.12], [width * 0.7, bandH * 0.04]].forEach(([px_, py_]) => {
        ctx.beginPath();
        ctx.moveTo(px_ - 10, py_ + 14); ctx.lineTo(px_, py_); ctx.lineTo(px_ + 10, py_ + 14);
        ctx.lineTo(px_ + 4, py_ + 10); ctx.lineTo(px_, py_ + 15); ctx.lineTo(px_ - 4, py_ + 10);
        ctx.closePath(); ctx.fill();
      });
      // Softly swirling snowflakes drifting down across the mountains.
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      for (let i = 0; i < 8; i++) {
        const phase = t * 0.5 + i * 0.9;
        const fx = 0.5 + Math.sin(phase) * 0.46;
        const fy = (phase * 0.09) % 1;
        ctx.beginPath(); ctx.arc(width * fx, bandH * fy, 1.6, 0, Math.PI * 2); ctx.fill();
      }
    } else if (landmarkEmoji === '🏖️') {
      // Sandy Cove — a real beach: moving ocean, sun, sand, and a palm tree.
      ctx.fillStyle = '#8fd0e0';
      ctx.fillRect(0, bandH * 0.15, width, bandH * 0.55);
      ctx.fillStyle = '#f2d38a';
      ctx.fillRect(0, bandH * 0.68, width, bandH * 0.32);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, bandH * 0.68);
      for (let x = 0; x <= width; x += 14) ctx.lineTo(x, bandH * 0.68 + Math.sin(x * 0.2 + t * 2.5) * 2.5);
      ctx.stroke();
      ctx.fillStyle = '#ffd95e';
      ctx.beginPath(); ctx.arc(width * 0.84, bandH * 0.28, 13, 0, Math.PI * 2); ctx.fill();
      const palmSway = Math.sin(t * 1.4) * 3;
      ctx.strokeStyle = '#8a5a34'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(width * 0.14, bandH); ctx.quadraticCurveTo(width * 0.09, bandH * 0.55, width * 0.16, bandH * 0.4); ctx.stroke();
      ctx.fillStyle = '#4f8a3a';
      [[-9, -3], [9, -3], [0, -11]].forEach(([dx, dy]) => {
        ctx.beginPath(); ctx.ellipse(width * 0.16 + dx + palmSway, bandH * 0.4 + dy, 11, 6, 0.5, 0, Math.PI * 2); ctx.fill();
      });
    } else if (landmarkEmoji === '🌲') {
      // Cedar Ridge — a dense pine forest, swaying in the wind.
      for (let i = 0; i < 7; i++) {
        const cx = (i + 0.5) * (width / 7);
        const sway = Math.sin(t * 0.9 + i * 1.1) * 2;
        const h = bandH * (0.55 + (i % 2) * 0.18);
        ctx.fillStyle = i % 2 === 0 ? '#3f6b38' : '#4f7d44';
        ctx.beginPath(); ctx.moveTo(cx + sway, bandH - h); ctx.lineTo(cx - 15, bandH * 0.72); ctx.lineTo(cx + 15, bandH * 0.72); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(cx + sway * 0.6, bandH - h * 0.6); ctx.lineTo(cx - 11, bandH); ctx.lineTo(cx + 11, bandH); ctx.closePath(); ctx.fill();
      }
    } else if (landmarkEmoji === '🌩️') {
      // Stormwatch — a dark, roiling storm sky with lightning.
      ctx.fillStyle = 'rgba(45,52,68,0.9)';
      ctx.fillRect(0, 0, width, bandH);
      ctx.fillStyle = '#5a6478';
      [[0.16, 0.35, 34], [0.42, 0.2, 40], [0.68, 0.32, 36], [0.9, 0.22, 28]].forEach(([fx, fy, r]) => {
        ctx.beginPath(); ctx.ellipse(width * fx, bandH * fy, r, r * 0.42, 0, 0, Math.PI * 2); ctx.fill();
      });
      ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(width * 0.5, bandH * 0.32);
      ctx.lineTo(width * 0.45, bandH * 0.6); ctx.lineTo(width * 0.52, bandH * 0.6);
      ctx.lineTo(width * 0.47, bandH * 0.92);
      ctx.stroke();
    } else if (landmarkEmoji === '🌾') {
      // Golden Vale — rolling wheat-field hills under a warm sun.
      ctx.fillStyle = '#ffd95e';
      ctx.beginPath(); ctx.arc(width * 0.15, bandH * 0.22, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#d9a63f';
      ctx.beginPath();
      ctx.moveTo(0, bandH);
      ctx.quadraticCurveTo(width * 0.22, bandH * 0.35, width * 0.48, bandH * 0.62);
      ctx.quadraticCurveTo(width * 0.72, bandH * 0.9, width, bandH * 0.42);
      ctx.lineTo(width, bandH); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5;
      for (let x = 0; x < width; x += 10) {
        ctx.beginPath(); ctx.moveTo(x, bandH); ctx.lineTo(x + 3, bandH * 0.8); ctx.stroke();
      }
    } else if (landmarkEmoji === '🌫️') {
      // Shadow Falls — an actual waterfall cascading through the mist.
      ctx.fillStyle = 'rgba(120,130,150,0.55)';
      ctx.fillRect(width * 0.4, 0, width * 0.2, bandH);
      ctx.strokeStyle = 'rgba(230,235,245,0.6)'; ctx.lineWidth = 2;
      for (let x = width * 0.42; x < width * 0.58; x += 6) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x - 3, bandH); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(210,215,230,0.55)';
      [[0.28, 0.78], [0.5, 0.9], [0.72, 0.78]].forEach(([fx, fy]) => {
        ctx.beginPath(); ctx.ellipse(width * fx, bandH * fy, 30, 11, 0, 0, Math.PI * 2); ctx.fill();
      });
    } else if (landmarkEmoji === '🏔️') {
      // Summit City — the highest peaks in the game, flags planted.
      ctx.fillStyle = '#c8d2dd';
      ctx.beginPath();
      ctx.moveTo(0, bandH);
      ctx.lineTo(width * 0.18, bandH * 0.1); ctx.lineTo(width * 0.34, bandH);
      ctx.lineTo(width * 0.55, bandH * 0.05); ctx.lineTo(width * 0.75, bandH * 0.8);
      ctx.lineTo(width, bandH * 0.15); ctx.lineTo(width, bandH);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#c8222c';
      [[width * 0.18, bandH * 0.1], [width * 0.55, bandH * 0.05]].forEach(([px_, py_]) => {
        ctx.fillRect(px_, py_ - 10, 2, 10);
        ctx.beginPath(); ctx.moveTo(px_ + 2, py_ - 10); ctx.lineTo(px_ + 9, py_ - 7); ctx.lineTo(px_ + 2, py_ - 4); ctx.closePath(); ctx.fill();
      });
    }
    ctx.restore();
  }

  // Bear Hollow's own backdrop — soft green hills, a sun, and two gently
  // swaying trees. Not tied to a landmark emoji since it's the one town
  // that isn't part of the numbered 9.
  function drawHometownBackdrop(){
    const bandH = height * 0.17;
    const t = performance.now() / 1000;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, width, bandH); ctx.clip();
    ctx.fillStyle = '#9fd08a';
    ctx.beginPath();
    ctx.moveTo(0, bandH);
    ctx.quadraticCurveTo(width * 0.3, bandH * 0.4, width * 0.55, bandH * 0.7);
    ctx.quadraticCurveTo(width * 0.8, bandH * 0.95, width, bandH * 0.55);
    ctx.lineTo(width, bandH); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffd95e';
    ctx.beginPath(); ctx.arc(width * 0.86, bandH * 0.22, 12, 0, Math.PI * 2); ctx.fill();
    [0.14, 0.68].forEach((fx, i) => {
      const sway = Math.sin(t * 1.2 + i * 2) * 3;
      const cx = width * fx;
      ctx.fillStyle = '#8a5a34'; ctx.fillRect(cx - 3, bandH * 0.55, 6, bandH * 0.45);
      ctx.fillStyle = '#4f8a44';
      ctx.beginPath(); ctx.arc(cx + sway, bandH * 0.45, 15, 0, Math.PI * 2); ctx.fill();
    });
    ctx.restore();
  }

  // The Outskirts' backdrop — a dim, misty sky with a couple of twisted
  // dead trees swaying, matching the abandoned-castle mood. Fog drifts
  // slowly across.
  function drawCastleBackdrop(){
    const bandH = height * 0.17;
    const t = performance.now() / 1000;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, width, bandH); ctx.clip();
    // A dark night sky behind the castle grounds.
    ctx.fillStyle = '#2b2b3a';
    ctx.fillRect(0, 0, width, bandH);
    // A pale, clearly-visible full moon with a couple of craters.
    const moonX = width * 0.68, moonY = bandH * 0.28;
    ctx.fillStyle = '#e8e6d8';
    ctx.beginPath(); ctx.arc(moonX, moonY, 15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(170,168,150,0.5)';
    ctx.beginPath(); ctx.arc(moonX - 5, moonY - 4, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(moonX + 4, moonY + 5, 2, 0, Math.PI * 2); ctx.fill();
    // Two clearly-shaped dead, twisted trees flanking the grounds.
    const drawDeadTree = (cx, sway) => {
      ctx.strokeStyle = '#17171f';
      ctx.lineCap = 'round';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(cx, bandH); ctx.lineTo(cx + sway * 0.3, bandH * 0.42); ctx.stroke();
      ctx.lineWidth = 2.5;
      [
        [cx + sway * 0.3, bandH * 0.42, cx - 14 + sway, bandH * 0.2],
        [cx + sway * 0.3, bandH * 0.42, cx + 12 + sway, bandH * 0.16],
        [cx + sway * 0.5, bandH * 0.62, cx - 11 + sway, bandH * 0.4],
      ].forEach(([x1, y1, x2, y2]) => {
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      });
    };
    drawDeadTree(width * 0.13, Math.sin(t * 0.7) * 2);
    drawDeadTree(width * 0.9, Math.sin(t * 0.7 + 2) * 2);
    // Slow drifting fog low across the grounds.
    ctx.fillStyle = 'rgba(150,150,165,0.32)';
    for (let i = 0; i < 3; i++) {
      const fx = ((t * 0.015 + i * 0.34) % 1);
      ctx.beginPath(); ctx.ellipse(width * fx, bandH * (0.6 + i * 0.1), 34, 10, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // One scenic theme per wilderness zone (9 total), each drawn twice
  // (mirrored for the deeper "Part B" section of the same zone) so all
  // 18 Wild Area sections get a distinct, animated backdrop instead of
  // an empty band above the grass.
  function drawWildBackdrop(area){
    if (area.zoneIndex === undefined) return;
    const bandH = height * 0.17;
    const t = performance.now() / 1000;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, width, bandH); ctx.clip();
    if (area.zoneSub === 1) { ctx.translate(width, 0); ctx.scale(-1, 1); }
    switch (area.zoneIndex) {
      case 0: // Bear Woods — forest, swaying trees
        for (let i = 0; i < 6; i++) {
          const cx = (i + 0.5) * (width / 6);
          const sway = Math.sin(t * 1.3 + i) * 4;
          ctx.fillStyle = '#5c3a20'; ctx.fillRect(cx - 3, bandH * 0.5, 6, bandH * 0.55);
          ctx.fillStyle = i % 2 === 0 ? '#3f7a3a' : '#4f8a44';
          ctx.beginPath(); ctx.arc(cx + sway, bandH * 0.4, 16, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(cx - 12 + sway, bandH * 0.5, 11, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(cx + 12 + sway, bandH * 0.5, 11, 0, Math.PI * 2); ctx.fill();
        }
        break;
      case 1: // Whispering Trail — soft hills with drifting fog
        ctx.fillStyle = '#8fae7a';
        ctx.beginPath();
        ctx.moveTo(0, bandH);
        ctx.quadraticCurveTo(width * 0.3, bandH * 0.5, width * 0.6, bandH * 0.75);
        ctx.quadraticCurveTo(width * 0.85, bandH * 0.95, width, bandH * 0.6);
        ctx.lineTo(width, bandH); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(230,230,235,0.4)';
        for (let i = 0; i < 3; i++) {
          const fx = ((t * 0.025 + i * 0.33) % 1);
          ctx.beginPath(); ctx.ellipse(width * fx, bandH * (0.3 + i * 0.15), 34, 10, 0, 0, Math.PI * 2); ctx.fill();
        }
        break;
      case 2: // Icy Tundra — snowy peaks with swirling snow
        ctx.fillStyle = '#d7e8f2';
        ctx.beginPath();
        ctx.moveTo(0, bandH); ctx.lineTo(width * 0.2, bandH * 0.2); ctx.lineTo(width * 0.45, bandH * 0.8);
        ctx.lineTo(width * 0.7, bandH * 0.15); ctx.lineTo(width, bandH * 0.55);
        ctx.lineTo(width, bandH); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        for (let i = 0; i < 10; i++) {
          const phase = t * 0.6 + i;
          const fx = 0.5 + Math.sin(phase) * 0.42;
          const fy = (phase * 0.1) % 1;
          ctx.beginPath(); ctx.arc(width * fx, bandH * fy, 2, 0, Math.PI * 2); ctx.fill();
        }
        break;
      case 3: // Sunny Meadow — wildflowers under a bright sun
        ctx.fillStyle = '#ffd95e'; ctx.beginPath(); ctx.arc(width * 0.85, bandH * 0.2, 12, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#8fc76b';
        ctx.beginPath(); ctx.moveTo(0, bandH); ctx.quadraticCurveTo(width * 0.5, bandH * 0.5, width, bandH * 0.85); ctx.lineTo(width, bandH); ctx.closePath(); ctx.fill();
        const flowerColors = ['#ff6f91', '#ffd95e', '#6fb2ff'];
        for (let i = 0; i < 8; i++) {
          const fx = (i + 0.5) / 8;
          const bob = Math.sin(t * 2 + i) * 1.5;
          ctx.fillStyle = flowerColors[i % 3];
          ctx.beginPath(); ctx.arc(width * fx, bandH * (0.78 + (i % 2) * 0.08) + bob, 3, 0, Math.PI * 2); ctx.fill();
        }
        break;
      case 4: // Misty Marsh — murky water, reeds, and fog
        ctx.fillStyle = '#5e6b4a';
        ctx.fillRect(0, bandH * 0.55, width, bandH * 0.45);
        ctx.strokeStyle = '#3f5c34'; ctx.lineWidth = 2;
        for (let i = 0; i < 6; i++) {
          const cx = (i + 0.5) * (width / 6);
          const sway = Math.sin(t * 1.5 + i) * 2;
          ctx.beginPath(); ctx.moveTo(cx, bandH); ctx.lineTo(cx - 4 + sway, bandH * 0.5); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(cx, bandH); ctx.lineTo(cx + 4 + sway, bandH * 0.45); ctx.stroke();
        }
        ctx.fillStyle = 'rgba(210,215,205,0.35)';
        [[0.25, 0.35], [0.6, 0.3], [0.85, 0.4]].forEach(([fx, fy]) => {
          ctx.beginPath(); ctx.ellipse(width * fx, bandH * fy, 28, 9, 0, 0, Math.PI * 2); ctx.fill();
        });
        break;
      case 5: // Rocky Pass — jagged boulder silhouette
        ctx.fillStyle = '#8a8478';
        ctx.beginPath();
        ctx.moveTo(0, bandH); ctx.lineTo(0, bandH * 0.6); ctx.lineTo(width * 0.14, bandH * 0.3);
        ctx.lineTo(width * 0.28, bandH * 0.65); ctx.lineTo(width * 0.45, bandH * 0.2);
        ctx.lineTo(width * 0.6, bandH * 0.7); ctx.lineTo(width * 0.78, bandH * 0.25);
        ctx.lineTo(width * 0.92, bandH * 0.6); ctx.lineTo(width, bandH * 0.4);
        ctx.lineTo(width, bandH); ctx.closePath(); ctx.fill();
        break;
      case 6: // Autumn Grove — swaying autumn-colored trees
        for (let i = 0; i < 6; i++) {
          const cx = (i + 0.5) * (width / 6);
          const sway = Math.sin(t * 1.1 + i * 1.5) * 4;
          ctx.fillStyle = '#7a5232'; ctx.fillRect(cx - 3, bandH * 0.5, 6, bandH * 0.55);
          ctx.fillStyle = ['#c9793f', '#d9a23f', '#b8452f'][i % 3];
          ctx.beginPath(); ctx.arc(cx + sway, bandH * 0.4, 16, 0, Math.PI * 2); ctx.fill();
        }
        break;
      case 7: // Coral Shore — an animated tide against a coral reef
        ctx.fillStyle = '#5fc2c7'; ctx.fillRect(0, bandH * 0.25, width, bandH * 0.75);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2;
        for (let row = 0; row < 3; row++) {
          const y = bandH * (0.4 + row * 0.18);
          const phase = t * 2 + row;
          ctx.beginPath();
          for (let x = -20; x <= width; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.1 + phase) * 3);
          ctx.stroke();
        }
        ctx.fillStyle = '#ff6f91';
        [0.2, 0.5, 0.8].forEach(fx => { ctx.beginPath(); ctx.arc(width * fx, bandH * 0.85, 5, 0, Math.PI * 2); ctx.fill(); });
        break;
      case 8: // Cloudpeak Trail — tall peaks with drifting clouds
        ctx.fillStyle = '#aab6c4';
        ctx.beginPath();
        ctx.moveTo(0, bandH); ctx.lineTo(width * 0.25, bandH * 0.05); ctx.lineTo(width * 0.5, bandH * 0.6);
        ctx.lineTo(width * 0.75, bandH * 0.02); ctx.lineTo(width, bandH * 0.5);
        ctx.lineTo(width, bandH); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        for (let i = 0; i < 2; i++) {
          const fx = ((t * 0.03 + i * 0.5) % 1.3) - 0.15;
          ctx.beginPath(); ctx.ellipse(width * fx, bandH * (0.2 + i * 0.15), 26, 8, 0, 0, Math.PI * 2); ctx.fill();
        }
        break;
    }
    ctx.restore();
  }

  // Plaza/Bear Hollow buildings — simple wall+roof shapes, plus an emoji
  // marker, so a room reads as an actual place rather than empty floor
  // with NPCs standing in it. Each building may set its own `palette` (so
  // e.g. Bear Hollow's Lab and Home look different); otherwise falls back
  // to the area's shared palette (all 9 city Plazas use one scheme).
  function drawCityBuildings(area){
    const pal = area.palette;
    area.buildings.forEach(b => {
      const bp = b.palette || pal;
      const cx = px(b.xf, 'w');
      const bottom = px(b.yf, 'h') + px(b.hf, 'h') / 2;
      const wPx = px(b.wf, 'w');
      const hPx = px(b.hf, 'h');
      const top = bottom - hPx;
      const left = cx - wPx / 2;
      ctx.fillStyle = bp.roof;
      ctx.beginPath();
      ctx.moveTo(left - 5, top);
      ctx.lineTo(cx, top - hPx * 0.4);
      ctx.lineTo(left + wPx + 5, top);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = bp.wall;
      ctx.fillRect(left, top, wPx, hPx);
      ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(left, top, wPx, hPx);
      if (b.emoji) drawEmoji(b.emoji, cx, top + hPx * 0.4, 15);
    });
  }

  // A small backdrop band across the top of the simpler interior rooms
  // (Store/Healing Center/Archive/Lab/Home/the ruins) — a tinted wash
  // plus one distinguishing shape, drawn before the room's own furniture
  // so nothing sits on top of it. Gym/Elite/Bear King rooms already have
  // their own full bespoke look and aren't touched here.
  function drawRoomBackdrop(kind, pal){
    const bandH = height * 0.14;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, width, bandH); ctx.clip();
    if (kind === 'shop') {
      // A striped shop awning across the top.
      ctx.fillStyle = 'rgba(217,154,91,0.22)';
      ctx.fillRect(0, 0, width, bandH);
      const stripeW = width / 8;
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 === 0 ? pal.roof : pal.wall;
        ctx.fillRect(i * stripeW, 0, stripeW, bandH * 0.4);
      }
      ctx.fillStyle = pal.wall;
      for (let i = 0; i < 8; i++) {
        ctx.beginPath();
        ctx.moveTo(i * stripeW, bandH * 0.4);
        ctx.lineTo(i * stripeW + stripeW / 2, bandH * 0.56);
        ctx.lineTo(i * stripeW + stripeW, bandH * 0.4);
        ctx.closePath(); ctx.fill();
      }
    } else if (kind === 'heal') {
      // A bright window with a sun and the healing-center cross banner.
      ctx.fillStyle = 'rgba(200,225,255,0.35)';
      ctx.fillRect(0, 0, width, bandH);
      ctx.fillStyle = '#ffd95e';
      ctx.beginPath(); ctx.arc(width * 0.15, bandH * 0.4, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c8222c';
      ctx.fillRect(width * 0.85 - 9, bandH * 0.28, 18, 6);
      ctx.fillRect(width * 0.85 - 3, bandH * 0.2, 6, 20);
    } else if (kind === 'archive') {
      // A tall window onto a starry night sky, fitting the scholar's tower.
      ctx.fillStyle = 'rgba(30,25,50,0.45)';
      ctx.fillRect(0, 0, width, bandH);
      ctx.fillStyle = 'rgba(232,230,216,0.85)';
      for (let i = 0; i < 6; i++) {
        ctx.beginPath(); ctx.arc(width * ((i + 0.5) / 6), bandH * (0.2 + (i % 2) * 0.3), 1.4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.beginPath(); ctx.arc(width * 0.8, bandH * 0.35, 10, 0, Math.PI * 2); ctx.fill();
    } else if (kind === 'lab') {
      // A rack of bubbling equipment glowing against the back wall.
      ctx.fillStyle = 'rgba(90,160,220,0.22)';
      ctx.fillRect(0, 0, width, bandH);
      ctx.strokeStyle = 'rgba(120,200,230,0.6)'; ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const cx = width * (0.25 + i * 0.25);
        ctx.beginPath(); ctx.moveTo(cx, bandH * 0.9); ctx.lineTo(cx, bandH * 0.4); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, bandH * 0.32, 6, 0, Math.PI * 2); ctx.stroke();
      }
    } else if (kind === 'home') {
      // A cozy window onto the green hills outside.
      ctx.fillStyle = '#9fd08a';
      ctx.fillRect(0, bandH * 0.45, width, bandH * 0.55);
      ctx.fillStyle = '#ffd95e';
      ctx.beginPath(); ctx.arc(width * 0.82, bandH * 0.26, 10, 0, Math.PI * 2); ctx.fill();
    } else if (kind === 'ruins') {
      // A cracked window onto a pale moon — the one hint of light in here.
      ctx.fillStyle = 'rgba(35,35,48,0.5)';
      ctx.fillRect(0, 0, width, bandH);
      ctx.fillStyle = '#c8c6d8';
      ctx.beginPath(); ctx.arc(width * 0.5, bandH * 0.4, 11, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // Each of the three enterable buildings (Store/Healing Center/Archive)
  // gets its own furnishings, drawn with the same city palette used on
  // its outside — so no two rooms feel like the same empty box, and each
  // city's version still reads as belonging to that city.
  function drawRoomInterior(area){
    const pal = area.palette || { wall:'#8a5a34', roof:'#5c3a20' };
    const kind = area.roomKind;
    drawRoomBackdrop(kind, pal);
    if (kind === 'shop') {
      // Shelves of goods along the back wall
      for (let i = 0; i < 3; i++) {
        const sx = width * 0.18 + i * (width * 0.24);
        const sy = height * 0.18;
        ctx.fillStyle = pal.roof;
        ctx.fillRect(sx, sy, width * 0.16, 10);
        ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 1;
        ctx.strokeRect(sx, sy, width * 0.16, 10);
        drawEmoji(i % 2 === 0 ? '🍯' : '🪤', sx + width * 0.08, sy - 8, 13);
      }
      // Sales counter up front
      const counterW = width * 0.5, counterH = 24;
      const counterX = width / 2 - counterW / 2, counterY = height * 0.6;
      ctx.fillStyle = pal.wall;
      ctx.fillRect(counterX, counterY, counterW, counterH);
      ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 1.5;
      ctx.strokeRect(counterX, counterY, counterW, counterH);
      drawEmoji('💰', counterX + counterW - 16, counterY + counterH / 2, 13);
    } else if (kind === 'heal') {
      // Two patient beds
      [0.22, 0.78].forEach(xf => {
        const bx = width * xf - 30, by = height * 0.26;
        ctx.fillStyle = '#fdfaf3';
        ctx.fillRect(bx, by, 60, 34);
        ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 1.2;
        ctx.strokeRect(bx, by, 60, 34);
        ctx.fillStyle = '#cfe3ff';
        ctx.beginPath();
        ctx.ellipse(bx + 13, by + 9, 11, 7, 0, 0, Math.PI * 2);
        ctx.fill();
      });
      drawEmoji('➕', width / 2, height * 0.18, 20);
      // Reception desk
      ctx.fillStyle = pal.roof;
      ctx.fillRect(width * 0.32, height * 0.6, width * 0.36, 22);
      ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 1.5;
      ctx.strokeRect(width * 0.32, height * 0.6, width * 0.36, 22);
    } else if (kind === 'archive') {
      // Bookshelves along the back wall
      for (let i = 0; i < 3; i++) {
        const sx = width * 0.16 + i * (width * 0.25);
        ctx.fillStyle = pal.roof;
        ctx.fillRect(sx, height * 0.12, width * 0.17, 56);
        ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 1;
        ctx.strokeRect(sx, height * 0.12, width * 0.17, 56);
        drawEmoji('📚', sx + width * 0.085, height * 0.16, 15);
      }
      // Reading table in the middle
      ctx.fillStyle = pal.wall;
      ctx.beginPath();
      ctx.ellipse(width / 2, height * 0.62, width * 0.15, 13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 1.2;
      ctx.stroke();
      drawEmoji('📜', width / 2, height * 0.62, 15);
    } else if (kind === 'lab') {
      // Lab bench with beakers along the back wall
      const benchW = width * 0.6, benchH = 20;
      const benchX = width / 2 - benchW / 2, benchY = height * 0.16;
      ctx.fillStyle = pal.roof;
      ctx.fillRect(benchX, benchY, benchW, benchH);
      ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 1.2;
      ctx.strokeRect(benchX, benchY, benchW, benchH);
      drawEmoji('🧪', benchX + benchW * 0.25, benchY - 8, 14);
      drawEmoji('🔬', benchX + benchW * 0.5, benchY - 8, 15);
      drawEmoji('📋', benchX + benchW * 0.75, benchY - 8, 13);
      // A bookshelf of research notes off to the side
      ctx.fillStyle = pal.wall;
      ctx.fillRect(width * 0.1, height * 0.5, width * 0.16, 50);
      ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 1;
      ctx.strokeRect(width * 0.1, height * 0.5, width * 0.16, 50);
      drawEmoji('📖', width * 0.18, height * 0.5 + 10, 13);
    } else if (kind === 'home') {
      // A cozy rug and a fireplace
      ctx.fillStyle = '#c96f4a';
      ctx.beginPath();
      ctx.ellipse(width / 2, height * 0.62, width * 0.22, 20, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = pal.wall;
      ctx.fillRect(width * 0.36, height * 0.14, width * 0.28, 46);
      ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 1.2;
      ctx.strokeRect(width * 0.36, height * 0.14, width * 0.28, 46);
      drawEmoji('🔥', width / 2, height * 0.14 + 23, 18);
      drawEmoji('🖼️', width * 0.15, height * 0.2, 15);
      drawEmoji('🪴', width * 0.85, height * 0.2, 16);
    } else if (kind === 'ruins') {
      // Dusty, cobwebbed, and dim — nothing like the rest of Bear Hollow
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(0, 0, width, height);
      drawEmoji('🕸️', width * 0.12, height * 0.12, 20);
      drawEmoji('🕸️', width * 0.88, height * 0.12, 20);
      ctx.fillStyle = '#3a3a3a';
      ctx.fillRect(width * 0.15, height * 0.6, width * 0.18, 16);
      ctx.fillRect(width * 0.67, height * 0.55, width * 0.2, 14);
      drawEmoji('🕯️', width * 0.5, height * 0.72, 16);
    } else if (kind === 'gym') {
      // Every Battle Hall gets a banner matching its city's own landmark
      // icon from the Plaza above, pennants either side of it, a floor
      // arena mat in the city's own colors, a trophy case tucked in the
      // corner (clear of the door-to-leader walking path), and a pair of
      // theme-appropriate decorations flanking the arena — so no two Gym
      // Leaders fight in the same-looking room.
      ctx.fillStyle = pal.wall;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.ellipse(width / 2, height * 0.5, width * 0.34, height * 0.24, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = pal.roof;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(width / 2, height * 0.5, width * 0.34, height * 0.24, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = pal.roof;
      ctx.fillRect(width * 0.3, height * 0.08, width * 0.4, 34);
      ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 1.5;
      ctx.strokeRect(width * 0.3, height * 0.08, width * 0.4, 34);
      drawEmoji(area.landmarkEmoji || '🏳️', width / 2, height * 0.08 + 17, 22);
      // Small pennants either side of the banner.
      ctx.fillStyle = pal.wall;
      [width * 0.22, width * 0.78].forEach(px_ => {
        ctx.beginPath();
        ctx.moveTo(px_, height * 0.08);
        ctx.lineTo(px_ + 8, height * 0.08 + 9);
        ctx.lineTo(px_, height * 0.08 + 18);
        ctx.closePath();
        ctx.fill();
      });
      ctx.fillStyle = pal.wall;
      ctx.fillRect(width * 0.08, height * 0.8, width * 0.22, 16);
      ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 1;
      ctx.strokeRect(width * 0.08, height * 0.8, width * 0.22, 16);
      drawEmoji('🏆', width * 0.19, height * 0.8 + 8, 13);
      const deco = GYM_THEME_DECOR[area.landmarkEmoji] || ['✨', '✨'];
      drawEmoji(deco[0], width * 0.14, height * 0.42, 20);
      drawEmoji(deco[1], width * 0.86, height * 0.42, 20);
      drawEmoji(deco[0], width * 0.14, height * 0.62, 15);
      drawEmoji(deco[1], width * 0.86, height * 0.62, 15);
    } else if (kind === 'elite') {
      // A colored glow + double rune circle under the trainer's spot,
      // unique to each of the four chambers, plus scattered particles and
      // a matching pair of decorations.
      const theme = ELITE_THEMES[area.eliteIndex] || ELITE_THEMES[0];
      ctx.fillStyle = theme.glow;
      ctx.beginPath(); ctx.ellipse(width / 2, height / 2, width * 0.44, height * 0.42, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(width / 2, height / 2, 26, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(width / 2, height / 2, 40, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.arc(width / 2, height / 2, 52, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      // A scattering of small particle dots picking up the theme color.
      const dots = [[0.28,0.2],[0.72,0.22],[0.22,0.65],[0.78,0.68],[0.5,0.85],[0.35,0.5],[0.65,0.5]];
      ctx.fillStyle = theme.glow.replace('0.28', '0.8');
      dots.forEach(([dxf, dyf]) => {
        ctx.beginPath(); ctx.arc(width * dxf, height * dyf, 2, 0, Math.PI * 2); ctx.fill();
      });
      drawEmoji(theme.rune, width / 2, height * 0.15, 20);
      drawEmoji(theme.deco[0], width * 0.16, height * 0.3, 18);
      drawEmoji(theme.deco[1], width * 0.84, height * 0.3, 18);
      drawEmoji(theme.deco[0], width * 0.16, height * 0.72, 15);
      drawEmoji(theme.deco[1], width * 0.84, height * 0.72, 15);
    } else if (kind === 'bearking') {
      // A grand golden throne room — pillars flanking the King's Ancient
      // Bear, and a warm glow across the whole chamber.
      ctx.fillStyle = 'rgba(255,215,0,0.14)';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#7a5a1e';
      ctx.fillRect(width * 0.1, height * 0.12, 9, height * 0.68);
      ctx.fillRect(width * 0.9 - 9, height * 0.12, 9, height * 0.68);
      drawEmoji('🏵️', width * 0.1 + 4, height * 0.1, 14);
      drawEmoji('🏵️', width * 0.9 - 4, height * 0.1, 14);
      drawEmoji('👑', width / 2, height * 0.16, 26);
      drawEmoji('✨', width * 0.32, height * 0.5, 14);
      drawEmoji('✨', width * 0.68, height * 0.5, 14);
    }
  }

  function drawNpcs(){
    const area = AREAS[currentArea];
    const trainers = areaTrainers(area);
    const positions = trainerPositions(area);
    const gymLocked = area.type === 'cityhall' && !isGymUnlocked(area);
    trainers.forEach((t, i) => {
      const pos = positions[i];
      const tx = px(pos.xf, 'w'), ty = px(pos.yf, 'h');
      const defeated = trainersDefeated[t.id];
      const locked = t.role === 'gym' && gymLocked && !defeated;
      ctx.globalAlpha = defeated ? 0.45 : (locked ? 0.55 : 1);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath(); ctx.arc(tx, ty, NPC_R, 0, Math.PI * 2); ctx.fill();
      drawEmoji(t.emoji, tx, ty, 18);
      ctx.globalAlpha = 1;
      if (defeated) drawEmoji('✅', tx + 12, ty - 12, 12);
      else if (locked) drawEmoji('🔒', tx + 12, ty - 12, 12);
      else if (t.role === 'gym') drawEmoji('🥇', tx - 12, ty - 12, 11);
      else if (t.role === 'bearking') drawEmoji('👑', tx - 14, ty - 14, 13);
      else if (t.role === 'master') drawEmoji('💀', tx - 14, ty - 14, 13);
    });

    // Lore NPCs (Plaza only) — friendly, no battle indicator, just a
    // gentle glow so they read as approachable rather than a fight.
    const loreNpcs = areaLoreNpcs(area);
    const lorePositions = loreNpcPositions(area);
    loreNpcs.forEach((npc, i) => {
      const pos = lorePositions[i];
      const tx = px(pos.xf, 'w'), ty = px(pos.yf, 'h');
      ctx.fillStyle = 'rgba(255,224,130,0.3)';
      ctx.beginPath(); ctx.arc(tx, ty, NPC_R, 0, Math.PI * 2); ctx.fill();
      drawEmoji(npc.emoji, tx, ty, 18);
      drawEmoji('💬', tx + 12, ty - 12, 11);
    });

    // Doors (Plaza <-> Battle Hall, or any door gated behind the Celestial Bear)
    if (area.doors) {
      area.doors.forEach(door => {
        const dx = px(door.xf, 'w'), dy = px(door.yf, 'h');
        const locked = door.requiresCelestial && !collection['celestial'];
        ctx.fillStyle = locked ? 'rgba(40,40,40,0.5)' : 'rgba(120,80,40,0.4)';
        ctx.beginPath(); ctx.arc(dx, dy, NPC_R + 2, 0, Math.PI * 2); ctx.fill();
        drawEmoji(locked ? '🔒' : '🚪', dx, dy, 20);
      });
    }
  }

  function drawStaticFrame(){
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    drawFloor(palette());
    drawNpcs();
    drawBear(player.x, player.y, player.dirX, player.dirY, PLAYER_R);
    drawHealEffect();
  }

  function draw(){
    ctx.clearRect(0, 0, width, height);
    drawFloor(palette());
    drawNpcs();
    drawBear(player.x, player.y, player.dirX, player.dirY, PLAYER_R);
    drawHealEffect();
  }

  function loop(ts){
    if (state !== 'overworld') return;
    if (lastFrameTime === null) lastFrameTime = ts;
    let dt = (ts - lastFrameTime) / 1000;
    lastFrameTime = ts;
    dt = Math.min(dt, 0.05);
    updateOverworld(dt);
    if (state === 'overworld') draw();
    rafId = requestAnimationFrame(loop);
  }

  // ---- battle ----

  function renderBattleUI(){
    battlePlayerName.textContent = `Cub Lv.${cub.level}`;
    battlePlayerHpFill.style.width = Math.max(0, (cub.hp / cub.maxHp) * 100) + '%';
    battlePlayerHpText.textContent = `${Math.max(0, cub.hp)}/${cub.maxHp}`;
    const lead = activeBearId ? variantById(activeBearId) : null;
    battlePlayerSprite.textContent = lead ? lead.emoji : '🐻';
    battlePlayerSprite.style.filter = lead ? (lead.tint || '') : '';

    battleEnemyName.textContent = battleEnemy.name + (battleEnemy.level ? ` Lv.${battleEnemy.level}` : '');
    battleEnemyHpFill.style.width = Math.max(0, (battleEnemy.hp / battleEnemy.maxHp) * 100) + '%';
    battleEnemyHpText.textContent = `${Math.max(0, battleEnemy.hp)}/${battleEnemy.maxHp}`;
    battleEnemySprite.textContent = battleEnemy.emoji;
    battleEnemySprite.style.filter = battleEnemyTint || '';
  }

  function log(msg){ battleLogEl.textContent = msg; }

  function setActionsEnabled(enabled){
    battleAttackBtn.disabled = !enabled;
    battleCatchBtn.disabled = !enabled || battleKind !== 'wild' || honeyTraps <= 0;
    battleRunBtn.disabled = !enabled || battleKind !== 'wild';
    if (battleSwitchBtn) {
      const canSwitchBear = Object.keys(collection).some(id => id !== activeBearId && (bearHp[id] || 0) > 0);
      const canUsePotion = (healingPotions > 0 || fullRestores > 0) && cub.hp < cub.maxHp;
      battleSwitchBtn.disabled = !enabled || (!canSwitchBear && !canUsePotion);
    }
  }

  function flashSprite(el){
    el.classList.remove('hit');
    void el.offsetWidth;
    el.classList.add('hit');
  }

  // A generic one-shot CSS animation trigger for battle sprites — used for
  // the heal glow and the catch animation, same restart-safe pattern as
  // flashSprite above.
  function playSpriteEffect(el, className, durationMs){
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
    setTimeout(() => el.classList.remove(className), durationMs);
  }

  function startBattle(kind, payload){
    state = 'battle';
    battleKind = kind;
    battleVariant = null;
    battleTrainerId = null;
    battleTrainerRole = null;
    battleEnemyTint = null;

    if (kind === 'wild') {
      battleVariant = payload;
      battleEnemy = { name: payload.name, emoji: payload.emoji, maxHp: payload.hp, hp: payload.hp, atk: payload.atk, level: payload.level };
      battleEnemyTint = payload.tint || null;
      log(`A wild ${payload.name} appeared!`);
    } else {
      battleTrainerId = payload.id;
      battleTrainerRole = payload.role;
      battleMoneyReward = payload.moneyReward || 0;
      const b = payload.bear;
      battleEnemy = { name: b.name, emoji: b.emoji, maxHp: b.hp, hp: b.hp, atk: b.atk, level: b.level };
      battleEnemyTint = b.tint || null;
      const roleTag = payload.role === 'gym' ? ' (Gym Leader)' : payload.role === 'elite' ? ' (Elite Four)' : payload.role === 'bearking' ? ' (Bear King)' : payload.role === 'master' ? ' (Master Trainer)' : '';
      log(`${payload.name}${roleTag} sends out ${b.name}!`);
    }

    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    renderBattleUI();
    setActionsEnabled(true);
    battlePanel.classList.add('show');
  }

  function endBattle(){
    battlePanel.classList.remove('show');
    battleBusy = false;
    battleKind = null;
    battleEnemy = null;
    state = 'overworld';
    lastFrameTime = null;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  function levelUp(){
    cub.level += 1;
    // Leveling up still raises max HP/attack for whichever bear is
    // active, but no longer tops it off — healing now only happens at a
    // Healing Center or from a healing item.
    syncActiveCubStats();
  }

  function onVictory(){
    if (battleKind === 'wild') {
      log(`The ${battleEnemy.name} was defeated!`);
      setTimeout(endBattle, 1100);
      return;
    }
    trainersDefeated[battleTrainerId] = true;
    levelUp();
    money += battleMoneyReward;
    let gotCelestial = false;
    let collectedAllForCelestial = true;
    if (battleTrainerRole === 'bearking' && !beatBearKing) {
      beatBearKing = true;
      // The Bear King only hands over the ultra-rare Celestial Bear if
      // you've also caught all 18 other variants — beating him alone
      // isn't enough.
      collectedAllForCelestial = VARIANTS.filter(v => v.id !== 'celestial' && !v.godOnly).every(v => collection[v.id]);
      if (collectedAllForCelestial && !collection['celestial']) {
        gotCelestial = true;
        collection['celestial'] = true;
        initBearHp('celestial');
      }
    }
    saveProgress();
    updateHud();
    const coinTag = battleMoneyReward > 0 ? ` (+${battleMoneyReward}💰)` : '';
    if (battleTrainerRole === 'bearking') {
      let bearKingTag;
      if (gotCelestial) {
        bearKingTag = ' Since you\'ve caught all 18 bear variants too, the old king gifts you an ultra-rare Celestial Bear! 🌟 Head back to Bear Hollow — Professor Hazel has one more challenge for you...';
      } else {
        bearKingTag = ' The old king tips his crown to you, but the ultra-rare Celestial Bear only goes to a Cub Catcher who\'s also caught all 18 bear variants — keep catching!';
      }
      log(`You defeated the Bear King — YOU ARE THE NEW BEAR KING! 👑${coinTag}${bearKingTag}`);
      setTimeout(endBattle, gotCelestial ? 3400 : 2600);
    } else if (battleTrainerRole === 'master') {
      log(`You defeated Master Ronan — the hardest trainer in the game! Cub leveled up to ${cub.level}!${coinTag}`);
      setTimeout(endBattle, 1800);
    } else if (battleTrainerRole === 'elite') {
      log(`You defeated ${battleEnemy.name.split("'s")[0]}'s Elite trainer! Cub leveled up to ${cub.level}!${coinTag}`);
      setTimeout(endBattle, 1400);
    } else if (battleTrainerRole === 'gym') {
      log(`You earned a badge! Cub leveled up to ${cub.level}!${coinTag}`);
      setTimeout(endBattle, 1400);
    } else {
      log(`You won! Cub leveled up to ${cub.level}!${coinTag}`);
      setTimeout(endBattle, 1200);
    }
  }

  // A single bear fainting no longer ends the battle by itself — if
  // there's another bear left with HP, the player is forced to switch to
  // it (the enemy doesn't get a free extra hit, since the hit that just
  // landed is what caused the faint). The battle only truly ends in
  // defeat once every caught bear has fainted.
  // Finds the Healing Center for the city nearest to wherever the player
  // currently is — walking backward through the fixed section order to
  // the most recent City reached. This is what a whiteout sends the
  // player back to, regardless of whether they've actually stepped inside
  // that city's Healing Center yet.
  function nearestHealRoomId(){
    let idx = AREA_ORDER.indexOf(currentArea);
    if (idx === -1) {
      const area = AREAS[currentArea];
      if (area && area.plazaId) idx = AREA_ORDER.indexOf(area.plazaId);
    }
    if (idx === -1 || idx === undefined) return null;
    for (let i = idx; i >= 0; i--) {
      const id = AREA_ORDER[i];
      if (AREAS[id] && AREAS[id].type === 'city') return id + 'heal';
    }
    return null;
  }

  function handleFaint(){
    const faintedName = variantById(activeBearId) ? variantById(activeBearId).name : 'Your bear';
    const remaining = Object.keys(collection).filter(id => (bearHp[id] || 0) > 0);
    saveProgress();
    updateHud();
    if (remaining.length > 0) {
      log(`${faintedName} fainted! Choose your next bear.`);
      openForcedSwitch();
    } else {
      partyWhiteout(faintedName);
    }
  }

  // Every bear has fainted — Pokemon-Center-whiteout style: the whole
  // party is healed back to full and the player wakes up at the Healing
  // Center of the nearest city (Bear Hollow if no city's been reached yet).
  function partyWhiteout(faintedName){
    Object.keys(collection).forEach(id => { bearHp[id] = getBearMaxHp(id); });
    syncActiveCubStats();
    const healRoomId = nearestHealRoomId();
    if (healRoomId && AREAS[healRoomId]) {
      goToArea(healRoomId, null, ROOM_DOOR_POS.xf, ROOM_DOOR_POS.yf - 0.1);
    } else {
      goToArea('hometown', null, PLAYER_START.xf, PLAYER_START.yf);
    }
    saveProgress();
    updateHud();
    log(`${faintedName} fainted, and your whole team is out of action! Nurse Willow rushed in and healed everyone back up.`);
    setTimeout(endBattle, 1700);
  }

  function enemyTurn(){
    const dmg = Math.max(1, randInt(battleEnemy.atk - 1, battleEnemy.atk + 2));
    applyDamageToActive(dmg);
    renderBattleUI();
    flashSprite(battlePlayerSprite);
    log(`${battleEnemy.name} hit you for ${dmg}!`);
    setTimeout(() => {
      if (cub.hp <= 0) { handleFaint(); return; }
      battleBusy = false;
      setActionsEnabled(true);
    }, 700);
  }

  function resolveAttack(){
    const dmg = Math.max(1, randInt(cub.atk - 1, cub.atk + 2));
    battleEnemy.hp -= dmg;
    renderBattleUI();
    flashSprite(battleEnemySprite);
    log(`You hit ${battleEnemy.name} for ${dmg}!`);
    setTimeout(() => {
      if (battleEnemy.hp <= 0) { onVictory(); return; }
      enemyTurn();
    }, 700);
  }

  function resolveCatch(){
    if (honeyTraps <= 0) {
      log("You're out of Honey Traps! Visit a city Store to buy more.");
      battleBusy = false;
      setActionsEnabled(true);
      return;
    }
    honeyTraps -= 1;
    updateHud();
    log('You threw a honey trap...');
    const hpPct = battleEnemy.hp / battleEnemy.maxHp;
    const chance = Math.min(0.98, Math.max(0.65, 0.97 - 0.32 * hpPct));
    setTimeout(() => {
      if (Math.random() < chance) {
        collection[battleVariant.id] = true;
        initBearHp(battleVariant.id);
        let bonusLog = '';
        // If the Bear King was already beaten but the collection wasn't
        // complete at the time, finishing it now still earns the
        // Celestial Bear — it just arrives the moment the set is done.
        if (beatBearKing && !collection['celestial'] && VARIANTS.filter(v => v.id !== 'celestial' && !v.godOnly).every(v => collection[v.id])) {
          collection['celestial'] = true;
          initBearHp('celestial');
          bonusLog = ' You\'ve caught all 18 variants — the Celestial Bear is now yours too! 🌟 Head back to Bear Hollow — Professor Hazel has one more challenge for you...';
        }
        saveProgress();
        updateHud();
        log(`Gotcha! ${battleVariant.name} was caught!${bonusLog}`);
        playSpriteEffect(battleEnemySprite, 'caught', 900);
        setTimeout(endBattle, bonusLog ? 2600 : 1300);
      } else {
        saveProgress();
        log('It broke free!');
        setTimeout(enemyTurn, 500);
      }
    }, 700);
  }

  function resolveRun(){
    log('Got away safely!');
    setTimeout(endBattle, 700);
  }

  function battleAction(action){
    if (battleBusy || state !== 'battle') return;
    battleBusy = true;
    setActionsEnabled(false);
    if (action === 'attack') resolveAttack();
    else if (action === 'catch' && battleKind === 'wild') resolveCatch();
    else if (action === 'run' && battleKind === 'wild') resolveRun();
    else { battleBusy = false; setActionsEnabled(true); }
  }

  // ---- setup ----

  function debounce(fn, ms){
    let t;
    return function(...args){ clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
  }

  function bindDpadButton(el){
    if (!el) return;
    const dir = el.getAttribute('data-dir');
    const press = (e) => { e.preventDefault(); dpadDown[dir] = true; el.classList.add('pressed'); };
    const release = (e) => { if (e) e.preventDefault(); dpadDown[dir] = false; el.classList.remove('pressed'); };
    el.addEventListener('pointerdown', press);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointerleave', release);
    el.addEventListener('pointercancel', release);
  }

  async function setupBearCatchGame(){
    wrap = document.getElementById('catchGameWrap');
    canvas = document.getElementById('catchCanvas');
    if (!wrap || !canvas) return;
    ctx = canvas.getContext('2d');
    overlay = document.getElementById('catchOverlay');
    overlayTitle = document.getElementById('catchOverlayTitle');
    overlaySub = document.getElementById('catchOverlaySub');
    startBtn = document.getElementById('catchStartBtn');
    levelEl = document.getElementById('catchLevel');
    countEl = document.getElementById('catchCount');
    totalEl = document.getElementById('catchTotal');
    bearKingBadgeEl = document.getElementById('catchBearKingBadge');
    badgesEl = document.getElementById('catchBadges');
    dexBtn = document.getElementById('catchDexBtn');
    godModeBtn = document.getElementById('catchGodModeBtn');
    dexPanel = document.getElementById('catchDexPanel');
    dexListEl = document.getElementById('catchDexList');
    dexCloseBtn = document.getElementById('catchDexCloseBtn');
    dialogPanel = document.getElementById('catchDialogPanel');
    dialogNameEl = document.getElementById('catchDialogName');
    dialogTextEl = document.getElementById('catchDialogText');
    dialogCloseBtn = document.getElementById('catchDialogCloseBtn');
    trainerIntroPanel = document.getElementById('catchTrainerIntroPanel');
    trainerIntroSprite = document.getElementById('trainerIntroSprite');
    trainerIntroName = document.getElementById('trainerIntroName');
    trainerIntroQuote = document.getElementById('trainerIntroQuote');
    storePanel = document.getElementById('catchStorePanel');
    storeMoneyEl = document.getElementById('catchStoreMoney');
    buyTrapBtn = document.getElementById('catchBuyTrapBtn');
    buyPotionBtn = document.getElementById('catchBuyPotionBtn');
    buyFullRestoreBtn = document.getElementById('catchBuyFullRestoreBtn');
    storeCloseBtn = document.getElementById('catchStoreCloseBtn');
    starterPanel = document.getElementById('catchStarterPanel');
    starterTextEl = document.getElementById('catchStarterText');
    starterOptionsEl = document.getElementById('catchStarterOptions');
    starterCloseBtn = document.getElementById('catchStarterCloseBtn');
    resetConfirmPanel = document.getElementById('catchResetConfirmPanel');
    resetConfirmBtn = document.getElementById('catchResetConfirmBtn');
    resetCancelBtn = document.getElementById('catchResetCancelBtn');
    healConfirmPanel = document.getElementById('catchHealConfirmPanel');
    healConfirmTextEl = document.getElementById('catchHealConfirmText');
    healConfirmBtn = document.getElementById('catchHealConfirmBtn');
    healConfirmCancelBtn = document.getElementById('catchHealConfirmCancelBtn');
    bearSwitchPanel = document.getElementById('catchBearSwitchPanel');
    bearSwitchOptionsEl = document.getElementById('catchBearSwitchOptions');
    bearSwitchCloseBtn = document.getElementById('catchBearSwitchCloseBtn');
    battleSwitchBtn = document.getElementById('battleSwitchBtn');
    moneyEl = document.getElementById('catchMoney');
    honeyTrapsEl = document.getElementById('catchHoneyTraps');
    potionsEl = document.getElementById('catchPotions');

    battlePanel = document.getElementById('catchBattlePanel');
    battlePlayerName = document.getElementById('battlePlayerName');
    battlePlayerHpFill = document.getElementById('battlePlayerHpFill');
    battlePlayerHpText = document.getElementById('battlePlayerHpText');
    battleEnemyName = document.getElementById('battleEnemyName');
    battleEnemyHpFill = document.getElementById('battleEnemyHpFill');
    battleEnemyHpText = document.getElementById('battleEnemyHpText');
    battlePlayerSprite = document.getElementById('battlePlayerSprite');
    battleEnemySprite = document.getElementById('battleEnemySprite');
    battleLogEl = document.getElementById('battleLog');
    battleCatchBtn = document.getElementById('battleCatchBtn');
    battleRunBtn = document.getElementById('battleRunBtn');
    battleAttackBtn = document.getElementById('battleAttackBtn');

    await loadProgress();
    resize();
    window.addEventListener('resize', debounce(resize, 200));

    startBtn.addEventListener('click', startAdventure);
    document.querySelectorAll('#catchControls .quest-dpad-btn').forEach(bindDpadButton);
    const interactBtn = document.getElementById('catchInteractBtn');
    if (interactBtn) {
      interactBtn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        interactBtn.classList.add('pressed');
        interact();
      });
      interactBtn.addEventListener('pointerup', () => interactBtn.classList.remove('pressed'));
      interactBtn.addEventListener('pointerleave', () => interactBtn.classList.remove('pressed'));
    }
    if (dexCloseBtn) dexCloseBtn.addEventListener('click', toggleCatchDex);
    if (dialogCloseBtn) dialogCloseBtn.addEventListener('click', closeDialog);
    if (storeCloseBtn) storeCloseBtn.addEventListener('click', closeStore);
    if (buyTrapBtn) buyTrapBtn.addEventListener('click', buyHoneyTrap);
    if (buyPotionBtn) buyPotionBtn.addEventListener('click', buyHealingPotion);
    if (buyFullRestoreBtn) buyFullRestoreBtn.addEventListener('click', buyFullRestore);
    if (starterCloseBtn) starterCloseBtn.addEventListener('click', closeStarterPicker);
    if (resetConfirmBtn) resetConfirmBtn.addEventListener('click', confirmReset);
    if (resetCancelBtn) resetCancelBtn.addEventListener('click', closeResetConfirm);
    if (healConfirmBtn) healConfirmBtn.addEventListener('click', confirmHeal);
    if (healConfirmCancelBtn) healConfirmCancelBtn.addEventListener('click', cancelHeal);
    if (bearSwitchCloseBtn) bearSwitchCloseBtn.addEventListener('click', closeBearSwitch);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
      } else if (state === 'overworld' && !rafId) {
        lastFrameTime = null;
        rafId = requestAnimationFrame(loop);
      }
    });
  }

  // The dex is available any time (even before starting an adventure) so
  // the person can check how many of the 18 variants exist and which
  // they've already caught without having to be mid-session.
  function toggleCatchDex(){
    if (state === 'battle') return;
    dexOpen = !dexOpen;
    if (dexOpen) {
      renderDexPanel();
      dexPanel.classList.add('show');
    } else {
      dexPanel.classList.remove('show');
    }
  }

  // Testing shortcut — not part of the normal game loop. First press
  // instantly hands over one of every regular variant (so the Dex is
  // otherwise complete) and switches the active lead to DoomBear, a
  // hidden god-mode-only variant with an absurd stat bonus that one- or
  // two-hits anything — regular trainers, Gym Leaders, the Elite Four,
  // the Bear King, and Master Ronan alike — and turns off wild
  // encounters. It does NOT hand over the Celestial Bear directly;
  // that's still earned the normal way (beat the Bear King with every
  // other variant already caught), which DoomBear just makes fast to
  // reach. Pressing again just toggles the encounter suppression back
  // off — everything already granted stays granted. The button itself
  // shows a pressed/glowing state whenever godModeOn is true, so it's
  // obvious at a glance whether it's on.
  function activateGodMode(){
    if (state !== 'overworld' || dexOpen || dialogOpen || storeOpen || starterOpen || resetConfirmOpen || bearSwitchOpen || healConfirmOpen || trainerIntroOpen) return;
    if (godModeOn) {
      godModeOn = false;
      updateGodModeButton();
      showDialog({ emoji: '⚡', name: 'God Mode', dialogue: "God Mode off — wild encounters are back on. DoomBear and everything already caught are still yours." }, player.x, player.y);
      return;
    }
    if (!starterVariantId) { starterVariantId = VARIANTS[0].id; collection[VARIANTS[0].id] = true; }
    VARIANTS.forEach(v => {
      if (v.godOnly || v.id === 'celestial') return;
      if (!collection[v.id]) collection[v.id] = true;
      initBearHp(v.id);
    });
    collection['doombear'] = true;
    activeBearId = 'doombear';
    initBearHp('doombear');
    godModeOn = true;
    updateGodModeButton();
    syncActiveCubStats();
    updateHud();
    saveProgress();
    showDialog({ emoji: '⚡', name: 'God Mode', dialogue: "DoomBear is ready, every regular variant is in the Dex, and wild encounters are off so you can move fast. Beat the Bear King to claim the Celestial Bear, then the castle gate in the Outskirts is yours to walk through." }, player.x, player.y);
  }

  function updateGodModeButton(){
    if (godModeBtn) godModeBtn.classList.toggle('active', godModeOn);
  }

  // Lore NPC dialogue — a simple message panel over the canvas, dismissed
  // by tapping Continue. Movement is paused (see the dialogOpen guard at
  // the top of updateOverworld) while it's showing. Closing it also nudges
  // the player just outside the NPC's collision circle — otherwise, since
  // the collision check runs every frame regardless of movement, the very
  // next frame would see the player still standing on the NPC and reopen
  // the dialogue immediately, softlocking the screen. The Store and
  // Starter Picker panels share this same nudge-away-on-close need.
  function nudgePlayerAway(npcX, npcY){
    const dx = player.x - npcX, dy = player.y - npcY;
    const dist = Math.hypot(dx, dy);
    const clearR = PLAYER_R + NPC_R + 6;
    if (dist < clearR) {
      const ux = dist > 0.001 ? dx / dist : 0;
      const uy = dist > 0.001 ? dy / dist : 1;
      const moved = clampToArena(npcX + ux * clearR, npcY + uy * clearR, PLAYER_R);
      player.x = moved.x; player.y = moved.y;
    }
    if (state === 'overworld') draw();
  }
  // Context-aware dialogue: an NPC's line changes based on what the
  // player has actually done. Priority is most-exciting-news-first — if
  // you're Bear King, that's what everyone wants to talk about, even
  // over a freshly-earned Gym badge. A "no starter yet" override (used by
  // Mom) takes precedence over everything, since nothing else matters
  // until the adventure has actually begun.
  function resolveDialogue(npc){
    if (!starterVariantId && npc.noStarterDialogue) return npc.noStarterDialogue;
    if (collection['celestial'] && npc.celestialDialogue) return npc.celestialDialogue;
    if (beatBearKing && npc.bearKingDialogue) return npc.bearKingDialogue;
    if (npc.gymId && trainersDefeated[npc.gymId] && npc.gymDefeatedDialogue) return npc.gymDefeatedDialogue;
    return npc.dialogue;
  }
  function showDialog(npc, tx, ty){
    dialogOpen = true;
    dialogNpcX = tx; dialogNpcY = ty;
    dialogNameEl.textContent = npc.emoji + ' ' + npc.name;
    dialogTextEl.textContent = '"' + npc.dialogue + '"';
    dialogPanel.classList.add('show');
  }
  function closeDialog(){
    dialogOpen = false;
    dialogPanel.classList.remove('show');
    nudgePlayerAway(dialogNpcX, dialogNpcY);
  }

  // Healing Center — Nurse Willow, one per city Plaza, now inside her own
  // building. This is the only free full heal in the game; battles
  // themselves no longer heal at all, and healing here always asks first
  // rather than happening automatically on contact.
  let healConfirmOpen = false;
  let healConfirmNpc = null;
  let healNpcX = 0, healNpcY = 0;
  function visitHealingCenter(npc, tx, ty){
    healConfirmOpen = true;
    healConfirmNpc = npc;
    healNpcX = tx; healNpcY = ty;
    const anyHurt = Object.keys(collection).some(id => (bearHp[id] !== undefined ? bearHp[id] : getBearMaxHp(id)) < getBearMaxHp(id));
    healConfirmTextEl.textContent = anyHurt
      ? "Let me heal your whole team back to full — sound good?"
      : "Your team looks healthy to me! Want me to check over them anyway?";
    healConfirmPanel.classList.add('show');
  }
  function confirmHeal(){
    const wasHurt = Object.keys(collection).some(id => (bearHp[id] !== undefined ? bearHp[id] : getBearMaxHp(id)) < getBearMaxHp(id));
    // A visit to any Healing Center heals the whole party, not just
    // whoever's currently leading.
    Object.keys(collection).forEach(id => { bearHp[id] = getBearMaxHp(id); });
    syncActiveCubStats();
    saveProgress();
    updateHud();
    healConfirmOpen = false;
    healConfirmPanel.classList.remove('show');
    if (wasHurt) triggerHealEffect(player.x, player.y);
    showDialog({ ...healConfirmNpc, dialogue: wasHurt ? "All done! Your whole team is good as new." : "You're all set — take care out there!" }, healNpcX, healNpcY);
  }
  function cancelHeal(){
    healConfirmOpen = false;
    healConfirmPanel.classList.remove('show');
    nudgePlayerAway(healNpcX, healNpcY);
  }

  // Store — sells Honey Traps, Healing Potions, and (once the 3rd Gym
  // Badge is earned) Full Restores. Healing Potions fully heal early on;
  // after the 3rd Gym Badge they only restore half, and Full Restores —
  // pricier — become the new way to fully heal on the go.
  const HONEY_TRAP_PRICE = 15;
  const HEALING_POTION_PRICE = 20;
  const FULL_RESTORE_PRICE = 45;
  const FULL_RESTORE_UNLOCK_GYM_ID = 'gym3';
  function fullRestoreUnlocked(){ return !!trainersDefeated[FULL_RESTORE_UNLOCK_GYM_ID]; }
  let storeOpen = false;
  let storeNpcX = 0, storeNpcY = 0;
  function openStore(tx, ty){
    storeOpen = true;
    storeNpcX = tx; storeNpcY = ty;
    updateStorePanel();
    storePanel.classList.add('show');
  }
  function updateStorePanel(){
    if (storeMoneyEl) storeMoneyEl.textContent = `💰 ${money} coins — 🍯 ${honeyTraps} Honey Traps — 🧪 ${healingPotions} Potions — 💫 ${fullRestores} Full Restores`;
    if (buyTrapBtn) buyTrapBtn.disabled = money < HONEY_TRAP_PRICE;
    if (buyPotionBtn) {
      buyPotionBtn.textContent = fullRestoreUnlocked()
        ? `🧪 Buy Healing Potion — ${HEALING_POTION_PRICE}💰 (Half Heal)`
        : `🧪 Buy Healing Potion — ${HEALING_POTION_PRICE}💰 (Full Heal)`;
      buyPotionBtn.disabled = money < HEALING_POTION_PRICE;
    }
    if (buyFullRestoreBtn) {
      if (!fullRestoreUnlocked()) {
        buyFullRestoreBtn.textContent = '🔒 Full Restore — unlocks after the 3rd Gym Badge';
        buyFullRestoreBtn.disabled = true;
      } else {
        buyFullRestoreBtn.textContent = `💫 Buy Full Restore — ${FULL_RESTORE_PRICE}💰 (Full Heal)`;
        buyFullRestoreBtn.disabled = money < FULL_RESTORE_PRICE;
      }
    }
  }
  function buyHoneyTrap(){
    if (money < HONEY_TRAP_PRICE) return;
    money -= HONEY_TRAP_PRICE;
    honeyTraps += 1;
    saveProgress();
    updateHud();
    updateStorePanel();
  }
  function buyHealingPotion(){
    if (money < HEALING_POTION_PRICE) return;
    money -= HEALING_POTION_PRICE;
    healingPotions += 1;
    saveProgress();
    updateHud();
    updateStorePanel();
  }
  function buyFullRestore(){
    if (!fullRestoreUnlocked() || money < FULL_RESTORE_PRICE) return;
    money -= FULL_RESTORE_PRICE;
    fullRestores += 1;
    saveProgress();
    updateHud();
    updateStorePanel();
  }
  function closeStore(){
    storeOpen = false;
    storePanel.classList.remove('show');
    nudgePlayerAway(storeNpcX, storeNpcY);
  }

  // Starter Picker — Bear Professor Hazel's one-time choice of partner
  // bear. Purely cosmetic (picks the Cub's battle sprite/tint); the Cub's
  // stats always come from its level, same as before.
  let starterOpen = false;
  let starterNpcX = 0, starterNpcY = 0;
  function openStarterPicker(npc, tx, ty){
    starterOpen = true;
    starterNpcX = tx; starterNpcY = ty;
    starterTextEl.textContent = npc.dialogue;
    renderStarterOptions();
    starterPanel.classList.add('show');
  }
  function renderStarterOptions(){
    if (!starterOptionsEl) return;
    starterOptionsEl.innerHTML = '';
    STARTER_IDS.forEach(id => {
      const v = variantById(id);
      const btn = document.createElement('button');
      btn.className = 'battle-action-btn';
      btn.textContent = `${v.emoji} ${v.name}`;
      btn.addEventListener('click', () => chooseStarter(id));
      starterOptionsEl.appendChild(btn);
    });
  }
  function chooseStarter(id){
    starterVariantId = id;
    activeBearId = id;
    collection[id] = true;
    initBearHp(id);
    syncActiveCubStats();
    starterOpen = false;
    starterPanel.classList.remove('show');
    saveProgress();
    updateHud();
    nudgePlayerAway(starterNpcX, starterNpcY);
  }
  function closeStarterPicker(){
    starterOpen = false;
    starterPanel.classList.remove('show');
    nudgePlayerAway(starterNpcX, starterNpcY);
  }

  // Bear Switch — pick which caught bear leads. Usable from the overworld
  // any time (just sets the default for your next battle), voluntarily
  // mid-battle (costs your turn, same as a real swap — the enemy gets a
  // free hit in response), or as a forced switch right after a faint
  // (no extra hit, since the hit that caused the faint already landed).
  // Switching never heals anyone — each bear keeps whatever HP it has.
  let bearSwitchOpen = false;
  let bearSwitchInBattle = false;
  let forcedSwitch = false;
  function openBearSwitch(inBattle){
    if (inBattle && (battleBusy || state !== 'battle')) return;
    if (!inBattle && state === 'battle') return;
    bearSwitchInBattle = inBattle;
    bearSwitchOpen = true;
    forcedSwitch = false;
    if (bearSwitchCloseBtn) bearSwitchCloseBtn.style.display = '';
    renderBearSwitchOptions();
    bearSwitchPanel.classList.add('show');
    if (inBattle) setActionsEnabled(false);
  }
  // Called after a bear faints mid-battle, when at least one other bear
  // still has HP — the player must pick one to continue.
  function openForcedSwitch(){
    bearSwitchInBattle = true;
    bearSwitchOpen = true;
    forcedSwitch = true;
    if (bearSwitchCloseBtn) bearSwitchCloseBtn.style.display = 'none';
    renderBearSwitchOptions();
    bearSwitchPanel.classList.add('show');
    setActionsEnabled(false);
  }
  const POTION_HEAL_FRACTION = 0.5; // once Healing Potions are downgraded, they restore half of max HP (rounded, 8 minimum)
  function renderBearSwitchOptions(){
    if (!bearSwitchOptionsEl) return;
    bearSwitchOptionsEl.innerHTML = '';

    const hpLine = document.createElement('div');
    hpLine.className = 'battle-log';
    hpLine.style.minHeight = '0';
    hpLine.textContent = forcedSwitch
      ? `💥 ${variantById(activeBearId) ? variantById(activeBearId).name : 'Your bear'} fainted! Choose your next bear.`
      : `❤️ Cub HP: ${Math.max(0, cub.hp)}/${cub.maxHp}`;
    bearSwitchOptionsEl.appendChild(hpLine);

    // Healing items aren't offered during a forced switch — they heal
    // whoever's currently leading, and the bear that just fainted is the
    // one leading right now, so it'd effectively act as a free revive.
    if (!forcedSwitch) {
      const potionFull = !fullRestoreUnlocked();
      const potionBtn = document.createElement('button');
      potionBtn.className = 'battle-action-btn';
      potionBtn.textContent = `🧪 Use Healing Potion (${healingPotions}) — ${potionFull ? 'Full Heal' : 'Half Heal'}`;
      potionBtn.disabled = healingPotions <= 0 || cub.hp >= cub.maxHp;
      potionBtn.addEventListener('click', useHealingPotion);
      bearSwitchOptionsEl.appendChild(potionBtn);

      if (fullRestoreUnlocked() || fullRestores > 0) {
        const restoreBtn = document.createElement('button');
        restoreBtn.className = 'battle-action-btn';
        restoreBtn.textContent = `💫 Use Full Restore (${fullRestores}) — Full Heal`;
        restoreBtn.disabled = fullRestores <= 0 || cub.hp >= cub.maxHp;
        restoreBtn.addEventListener('click', useFullRestore);
        bearSwitchOptionsEl.appendChild(restoreBtn);
      }
    }

    const caughtIds = Object.keys(collection);
    if (caughtIds.length === 0) {
      const p = document.createElement('div');
      p.className = 'battle-log';
      p.textContent = "You haven't caught any bears yet!";
      bearSwitchOptionsEl.appendChild(p);
      return;
    }
    caughtIds.forEach(id => {
      const v = variantById(id);
      if (!v) return;
      const maxHp = getBearMaxHp(id);
      const hp = bearHp[id] !== undefined ? bearHp[id] : maxHp;
      const fainted = hp <= 0;
      const btn = document.createElement('button');
      btn.className = 'battle-action-btn';
      let label = `${v.emoji} ${v.name} (${Math.max(0, hp)}/${maxHp} HP)`;
      if (activeBearId === id && !forcedSwitch) label += ' (Leading)';
      if (fainted) label += ' — Fainted';
      btn.textContent = label;
      btn.disabled = fainted || (activeBearId === id && !forcedSwitch);
      btn.addEventListener('click', () => selectActiveBear(id));
      bearSwitchOptionsEl.appendChild(btn);
    });
  }
  function selectActiveBear(id){
    const wasInBattle = bearSwitchInBattle;
    const wasForced = forcedSwitch;
    activeBearId = id;
    bearSwitchOpen = false;
    forcedSwitch = false;
    if (bearSwitchCloseBtn) bearSwitchCloseBtn.style.display = '';
    bearSwitchPanel.classList.remove('show');
    // No auto-heal here — this bear keeps whatever HP it already had.
    syncActiveCubStats();
    saveProgress();
    updateHud();
    if (wasInBattle) {
      renderBattleUI();
      log(`Go, ${variantById(id).name}!`);
      if (wasForced) {
        // The enemy already landed the hit that caused the faint —
        // switching in doesn't cost another one.
        battleBusy = false;
        setActionsEnabled(true);
      } else {
        battleBusy = true;
        setActionsEnabled(false);
        setTimeout(enemyTurn, 700);
      }
    } else if (state === 'overworld') {
      draw();
    }
  }
  // Using a heal item from the overworld is free and instant; using it
  // mid-battle heals the active bear but costs the turn, same as a real
  // Switch — the enemy gets a free hit in response.
  function applyHealItem(healAmt, msg){
    const wasInBattle = bearSwitchInBattle;
    bearHp[activeBearId] = Math.min(cub.maxHp, (bearHp[activeBearId] || 0) + healAmt);
    cub.hp = bearHp[activeBearId];
    bearSwitchOpen = false;
    bearSwitchPanel.classList.remove('show');
    saveProgress();
    updateHud();
    if (wasInBattle) {
      renderBattleUI();
      playSpriteEffect(battlePlayerSprite, 'heal-glow', 900);
      log(msg);
      battleBusy = true;
      setActionsEnabled(false);
      setTimeout(enemyTurn, 700);
    } else if (state === 'overworld') {
      triggerHealEffect(player.x, player.y);
      draw();
    }
  }
  function useHealingPotion(){
    if (healingPotions <= 0 || cub.hp >= cub.maxHp) return;
    // Potions fully heal until the 3rd Gym Badge — after that they only
    // restore half, and Full Restores take over as the full-heal item.
    const healAmt = fullRestoreUnlocked() ? Math.max(8, Math.round(cub.maxHp * POTION_HEAL_FRACTION)) : cub.maxHp;
    healingPotions -= 1;
    applyHealItem(healAmt, `You used a Healing Potion! Restored ${healAmt} HP.`);
  }
  function useFullRestore(){
    if (fullRestores <= 0 || cub.hp >= cub.maxHp) return;
    const healAmt = cub.maxHp - cub.hp;
    fullRestores -= 1;
    applyHealItem(healAmt, `You used a Full Restore! Cub's HP is completely restored.`);
  }
  function closeBearSwitch(){
    if (forcedSwitch) return; // a forced switch has no way out but picking a bear
    const wasInBattle = bearSwitchInBattle;
    bearSwitchOpen = false;
    bearSwitchPanel.classList.remove('show');
    if (wasInBattle) setActionsEnabled(true);
  }

  window.setupBearCatchGame = setupBearCatchGame;
  window.returnToCampBearCatch = openResetConfirm;
  window.openBearSwitchOverworld = function(){ openBearSwitch(false); };
  window.openBearSwitchBattle = function(){ openBearSwitch(true); };
  window.battleAction = battleAction;
  window.toggleCatchDex = toggleCatchDex;
  window.activateGodMode = activateGodMode;
  // The wrap sits inside a display:none section until the games toggle is
  // opened, so its very first resize() at setup time measures a
  // zero-width box. Re-running resize() once the section is actually
  // shown fixes the canvas up to the real card width.
  window.bearCatchRefreshSize = resize;
  window.bearCatchOnHolidayChange = function(){
    if (state !== 'overworld') drawStaticFrame();
  };
})();

window.classicReady=(async function init(){
  await window.BearDen.ready;
  window.BearDenDebtPayments=await import('./debt-payments.mjs?v=paid-cycle1');
  window.BearDenCarDebt=await import('./car-debt.mjs?v=car-debt1');
  window.BearDenTaxes=await import('./tax-ui.mjs?v=tracker-401k1');window.BearDenTaxes.mount();
  applyThemeButtonIcon(); // reflect whatever the early <head> script already applied
  applyThemeBackground(document.documentElement.getAttribute('data-theme') === 'dark');
  applyHolidayMenuState();
  setupHeroBear();
  setupPaycheckBears();
  setupBearRunnerGame();
  setupBearCrushGame();
  setupBearQuestGame();
  setupBearCatchGame();
  setupNotes();
  let savedState = await loadAppState();
  if (!savedState) {
    savedState = await migrateLegacyKeys();
  }
  renderDebtTimingSettings();
  bonusControlsEnabled=savedState?savedState.bonusControlsEnabled!==false:false;
  document.getElementById('bonusControlsToggle').checked=bonusControlsEnabled;
  payoffControlsEnabled=savedState?.payoffControlsEnabled===true;
  document.getElementById('payoffControlsToggle').checked=payoffControlsEnabled;
  budgetSetupVersion=Number(savedState?.budgetSetupVersion)||0;
  if(window.BearDen.isNew&&!budgetSetupVersion&&!budgetItems.length){budgetItems=starterBudgetItems();budgetItemIdCounter=3;budgetSetupVersion=1;}
  if(budgetSetupVersion<2){
    const removed=budgetItems.filter(item=>item.kind==='household-bills'||item.label==='Fixed Bills');
    budgetItems=budgetItems.filter(item=>!removed.includes(item));
    for(const item of removed)delete budgetItemOverrides[item.id];
    budgetSetupVersion=2;
  }
  renderBudgetItems();
  if (savedState) {
    ['takeHome','startDate','hourlyRate','hoursPerCheck'].forEach(id => {
      if (savedState[id] !== undefined && document.getElementById(id)) {
        document.getElementById(id).value = savedState[id];
      }
    });
    window.BearDenTaxes.restore(savedState.taxSettings||{});
    if (savedState.payoffMethod) currentPayoffMethod = savedState.payoffMethod;
    updateIncomeEstimateDisplay();
    updatePayoffMethodExplain();
  }
  calculate(true);
  window.BearDen.loaded=true;
})();

function confirmTrackerReset(){if(confirm('Reset income, budget, manually added bills and debts, and restart setup? This replaces saved planner data and cannot be undone. Bank and Gmail connections stay connected.'))return resetAll();}
function prepareClassicImport(){clearTimeout(saveDebounceTimer);}
function addConnectedBill(bill,date){
 const start=document.getElementById('startDate').value;
 if(!start||!date||date<start)throw Error('Choose a date on or after your first paycheck.');
 const n=Math.floor((Date.parse(date+'T12:00:00Z')-Date.parse(start+'T12:00:00Z'))/86400000/14)+1;
 extraExpenses[n]??=[];extraExpenses[n].push({id:++extraExpenseIdCounter,label:bill.name,amount:bill.amount/100});calculate();return n;
}

// Read-only snapshot for the Income overview; the original payoff engine remains authoritative.
window.getDebtPlan=()=>({state:gatherAppState(),syncedDebtBalances:window.syncedDebtBalances||{},syncedDebtTerms:window.syncedDebtTerms||{},schedule:lastSchedule.map(r=>({...r,date:r.date.getFullYear()+'-'+String(r.date.getMonth()+1).padStart(2,'0')+'-'+String(r.date.getDate()).padStart(2,'0')}))});

// Save deletion and its account links together, then update the visible plan.
window.deleteDebtAccounts=async function(ids,nextPlanner){
 await window.classicReady;
 const {removeDebtsFromState}=await import('./account-removal.mjs?v=delete-accounts1');
 clearTimeout(saveDebounceTimer);window.captureDebtHistory();
 const next=removeDebtsFromState(gatherAppState(),ids);
 try{await storage.setMany({'app-state':JSON.stringify(next),'income-planner':JSON.stringify(nextPlanner)});}
 catch(error){queueSaveAppState();throw error;}
 cardsData=next.cards;accountPaymentOverrides=next.accountPaymentOverrides||{};
 paycheckSlices=next.paycheckSlices||{};paycheckSquashes=next.paycheckSquashes||{};extraExpenses=next.extraExpenses||{};
 window.debtPaymentHistory=next.debtPaymentHistory||{};window.debtInterestHistory=next.debtInterestHistory||{};
 for(const id of ids){if(window.syncedDebtBalances)delete window.syncedDebtBalances[id];if(window.syncedDebtTerms)delete window.syncedDebtTerms[id];}
 currentDetailAccountIdx=null;calculate();clearTimeout(saveDebounceTimer);
};

// Account creation uses the same payoff state as the original tracker.
window.saveDebtAccount=async function(data){
 await window.classicReady;
 const name=String(data.name||'').trim(),balance=Number(data.balance),apr=Number(data.apr),monthly=Number(data.minimum);
 if(!name||name.length>100||![balance,apr,monthly].every(Number.isFinite)||balance<0||balance>1e9||monthly<0||monthly>1e9||apr<0||apr>100)throw Error('Enter a name, balance, APR, and payment amount.');
 const dueDate=String(data.dueDate||'');if(dueDate&&!window.BearDenDebtPayments.validDueDate(dueDate))throw Error('Enter a valid payment due date.');
 const oldCards=structuredClone(cardsData),oldCounter=cardIdCounter;
 let card=data.id===null||data.id===undefined?null:cardsData.find(c=>String(c.id)===String(data.id));
 if(data.id!==null&&data.id!==undefined&&!card)throw Error('That debt no longer exists.');
 window.captureDebtHistory();
 const payment=window.BearDenDebtPayments.monthlyPaymentSettings(card,monthly);
 const lastPositiveMonthlyMinimum=monthly>0?monthly:card&&window.BearDenDebtPayments.monthlyMinimum(card)>0?window.BearDenDebtPayments.monthlyMinimum(card):card?.lastPositiveMonthlyMinimum;
 if(!card){cardIdCounter=Math.max(cardIdCounter,...cardsData.map(c=>Number(c.id)||0))+1;card={id:cardIdCounter};cardsData.push(card);}
 Object.assign(card,{name,balance,apr,dueDate,...payment,lastPositiveMonthlyMinimum,debtKind:['credit-card','car-loan','loan','other'].includes(data.debtKind)?data.debtKind:'other'});
 const syncInputs=()=>cardsData.forEach(c=>{for(const [prefix,key]of [['bal','balance'],['apr','apr'],['monthlyMin','monthlyMinimum']]){const input=document.getElementById(prefix+'_'+c.id);if(input)input.value=prefix==='monthlyMin'?window.BearDenDebtPayments.monthlyMinimum(c):c[key];}});
 try{syncInputs();calculate();clearTimeout(saveDebounceTimer);await storage.set(APP_STATE_KEY,JSON.stringify(gatherAppState()));setStorageStatus('Saved');return card.id;}
 catch(e){cardsData=oldCards;cardIdCounter=oldCounter;syncInputs();calculate();clearTimeout(saveDebounceTimer);throw e;}
};

window.applyIncomePreset=async function(preset){
 await window.classicReady;
 if(!Number.isFinite(preset.hourlyRate)||preset.hourlyRate<0||!Number.isFinite(preset.hoursPerCheck)||preset.hoursPerCheck<0||!Number.isSafeInteger(preset.amount)||preset.amount<=0)throw Error('Income preset is unavailable.');
 const fields=['hourlyRate','hoursPerCheck','takeHome'],before=fields.map(id=>document.getElementById(id).value),values=[preset.hourlyRate,preset.hoursPerCheck,(preset.amount/100).toFixed(2)];
 try{fields.forEach((id,i)=>document.getElementById(id).value=values[i]);updateIncomeEstimateDisplay();calculate();clearTimeout(saveDebounceTimer);await storage.set(APP_STATE_KEY,JSON.stringify(gatherAppState()));setStorageStatus('Income saved');}
 catch(e){fields.forEach((id,i)=>document.getElementById(id).value=before[i]);updateIncomeEstimateDisplay();calculate();clearTimeout(saveDebounceTimer);throw e;}
};

window.showDebtAccountHistory=function(id){
 const index=cardsData.findIndex(c=>String(c.id)===String(id));if(index<0)return;
 currentDetailAccountIdx=index;paymentHistoryExpanded=true;paymentHistoryShowAll=false;renderSpendingTracker();
 document.getElementById('debtHistoryDialog').showModal();
};

window.flushBearDenState=async()=>{clearTimeout(saveDebounceTimer);calculate();clearTimeout(saveDebounceTimer);await storage.set(APP_STATE_KEY,JSON.stringify(gatherAppState()));};

function renderPaycheckBillsBalance(details){
 const box=details.querySelector('.paycheck-shared-balances'),balance=window.sharedBillsForPaycheck?.(details.dataset.paycheckDate);
 if(!box)return;
 if(!balance){box.textContent='Bills account balance is loading.';return;}
 const known=balance.currentBalance!==null,projected=balance.projectedBalance!==null;
 box.innerHTML=`<div><span>Bills account balance</span><strong>${known?money(balance.currentBalance/100):'Unavailable'}</strong><small>${bdEscape(balance.accountName)} · Latest synced balance</small></div><div class="${projected&&balance.projectedBalance<0?'is-negative':''}"><span>Left after bills</span><strong>${projected?money(balance.projectedBalance/100):'—'}</strong><small>${balance.historical?'Past pay period':projected?'Projected through '+fmtDate(new Date(balance.end+'T00:00:00')):'Connect your bills account to see the projection'}</small></div>${projected?'<p>Includes scheduled contributions and unpaid bills through the day before your next payday.</p>':''}`;
}
document.addEventListener('toggle',event=>{
 const details=event.target;
 if(details.matches?.('.paycheck-shared-details')&&details.open)renderPaycheckBillsBalance(details);
},true);

// Accounts publishes bill inputs; a stable signature prevents render/recalculate loops.
let paycheckBillSignature;
window.setPaycheckBills=(signature,resolve,sharedForecast)=>{
 if(signature===paycheckBillSignature)return false;
 paycheckBillSignature=signature;window.accountBillsForPaycheck=resolve;window.sharedBillsForPaycheck=sharedForecast;calculate();return true;
};

document.getElementById('payoffControlsToggle').onchange=async e=>{
 const before=payoffControlsEnabled;payoffControlsEnabled=e.target.checked;e.target.disabled=true;
 try{calculate();clearTimeout(saveDebounceTimer);await storage.set(APP_STATE_KEY,JSON.stringify(gatherAppState()));document.getElementById('featureSettingsStatus').textContent='Slice / Squash preference saved.';}
 catch(error){payoffControlsEnabled=before;e.target.checked=before;calculate();clearTimeout(saveDebounceTimer);document.getElementById('featureSettingsStatus').textContent=error.message;}
 finally{e.target.disabled=false;}
};

document.getElementById('bonusControlsToggle').onchange=async e=>{
 const before=bonusControlsEnabled;bonusControlsEnabled=e.target.checked;bonusInputOpenForPaycheck=null;e.target.disabled=true;
 try{calculate();clearTimeout(saveDebounceTimer);await storage.set(APP_STATE_KEY,JSON.stringify(gatherAppState()));document.getElementById('featureSettingsStatus').textContent='Bonus preference saved.';}
 catch(error){bonusControlsEnabled=before;e.target.checked=before;calculate();clearTimeout(saveDebounceTimer);document.getElementById('featureSettingsStatus').textContent=error.message;}
 finally{e.target.disabled=false;}
};

window.setCarDebtForecast=loans=>{
 if(JSON.stringify(loans)===JSON.stringify(window.carDebtForecast||[]))return false;
 window.carDebtForecast=loans;calculate();return true;
};

window.setSyncedDebtBalances=snapshots=>{
 const signature=JSON.stringify(snapshots);
 if(signature===JSON.stringify(window.syncedDebtBalances||{}))return false;
 window.syncedDebtBalances=snapshots;calculate();return true;
};



window.captureDebtHistory=()=>{
 window.debtPaymentHistory??={};window.debtInterestHistory??={};
 for(const row of lastSchedule)if(checkedPaychecks[row.paycheck]){
  window.debtPaymentHistory[row.paycheck]??=Object.fromEntries(cardsData.map((c,i)=>[c.id,row.payments[i]]));
  window.debtInterestHistory[row.paycheck]??=Object.fromEntries(cardsData.map((c,i)=>[c.id,row.interestByAccount?.[i]||0]));
 }
};
window.setSyncedDebtTerms=function(terms){
 if(JSON.stringify(terms)===JSON.stringify(window.syncedDebtTerms||{}))return false;
 window.captureDebtHistory();window.syncedDebtTerms=terms;calculate();return true;
};
function renderDebtTimingSettings(){
 const settings=window.BearDenDebtPayments.paymentTiming(window.debtPaymentSettings);
 document.getElementById('debtPaymentTiming').value=settings.mode;
 document.getElementById('debtPaymentLeadDays').value=settings.leadDays;
 document.getElementById('debtTimingBuffer').hidden=settings.mode!=='due-date';
}
async function saveDebtTimingSettings(){
 const before=structuredClone(window.debtPaymentSettings||{}),history=structuredClone(window.debtPaymentHistory||{}),status=document.getElementById('featureSettingsStatus');
 window.debtPaymentHistory??={};
 for(const row of lastSchedule)if(checkedPaychecks[row.paycheck]&&!window.debtPaymentHistory[row.paycheck])window.debtPaymentHistory[row.paycheck]=Object.fromEntries(cardsData.map((c,i)=>[c.id,row.payments[i]]));
 window.debtPaymentSettings=window.BearDenDebtPayments.paymentTiming({mode:document.getElementById('debtPaymentTiming').value,leadDays:document.getElementById('debtPaymentLeadDays').value});
 try{renderDebtTimingSettings();await window.flushBearDenState();status.textContent='Debt payment timing saved.';}
 catch(error){window.debtPaymentSettings=before;window.debtPaymentHistory=history;renderDebtTimingSettings();calculate();clearTimeout(saveDebounceTimer);status.textContent=error.message;}
}
for(const id of ['debtPaymentTiming','debtPaymentLeadDays'])document.getElementById(id).onchange=saveDebtTimingSettings;
let addingDebtPaycheck=null;
document.addEventListener('click',event=>{
 const button=event.target.closest('[data-add-debt-payment]');if(!button)return;
 const row=lastSchedule.find(r=>r.paycheck===Number(button.dataset.addDebtPayment));if(!row||checkedPaychecks[row.paycheck])return;
 addingDebtPaycheck=row.paycheck;const form=document.getElementById('addDebtPaymentForm');form.reset();
 form.elements.debtId.innerHTML=cardsData.map((c,i)=>row.balancesBefore[i]>0?'<option value="'+c.id+'">'+bdEscape(c.name)+'</option>':'').join('');
 document.getElementById('addDebtPaymentNote').textContent='Paycheck '+row.paycheck+' · '+fmtDate(row.date)+'. Enter an extra amount above this debt’s planned payment. This only changes your plan; it does not send a payment.';
 document.getElementById('addDebtPaymentError').textContent='';document.getElementById('addDebtPaymentDialog').showModal();
});
document.getElementById('closeAddDebtPayment').onclick=()=>document.getElementById('addDebtPaymentDialog').close();
document.getElementById('addDebtPaymentForm').onsubmit=async event=>{
 event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type=submit]'),status=document.getElementById('addDebtPaymentError');
 const row=lastSchedule.find(r=>r.paycheck===addingDebtPaycheck),index=cardsData.findIndex(c=>String(c.id)===form.elements.debtId.value),extra=Number(form.elements.amount.value);
 if(!row||index<0||checkedPaychecks[addingDebtPaycheck]){status.textContent='This paycheck changed. Close and reopen it.';return;}
 if(!Number.isFinite(extra)||extra<=0){status.textContent='Enter an amount greater than zero.';return;}
 const card=cardsData[index],owed=row.balancesBefore[index]+row.interestByAccount[index],payment=Math.round((row.payments[index]+extra)*100)/100;
 if(payment>owed+.005){status.textContent='That exceeds the remaining balance for this paycheck.';return;}
 const before=structuredClone(accountPaymentOverrides),slices=structuredClone(paycheckSlices),squashes=structuredClone(paycheckSquashes);
 button.disabled=true;try{
  // Freeze other allocations on this check so adding a payment cannot silently reduce another debt.
  for(const [i,c]of cardsData.entries()){accountPaymentOverrides[c.id]??={};accountPaymentOverrides[c.id][row.paycheck]=i===index?payment:row.payments[i];}
  delete paycheckSlices[row.paycheck];delete paycheckSquashes[row.paycheck];calculate();clearTimeout(saveDebounceTimer);
  if(lastSchedule.find(r=>r.paycheck===row.paycheck)?.cashAfterDebt<-.005)throw Error('Not enough money remains on this paycheck. Lower the extra payment or adjust your budget.');
  await storage.set(APP_STATE_KEY,JSON.stringify(gatherAppState()));document.getElementById('addDebtPaymentDialog').close();
 }catch(error){accountPaymentOverrides=before;paycheckSlices=slices;paycheckSquashes=squashes;calculate();clearTimeout(saveDebounceTimer);status.textContent=error.message;}finally{button.disabled=false;}
};

