// Forecast-only interest state. Amounts are dollars; APR inputs are percentages.
// Dates are calendar dates. Accrual covers [state.asOfDate, toDate), so a payment
// at toDate changes that day's interest basis. Never write this state to a bank
// balance, and never recreate it at each payday: unpaid interest is distinct
// from principal for methods that do not compound it.
const DAY = 86400000;
const EPSILON = 1e-9;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const nonnegative = value => Math.max(0, finite(value));
const cents = value => Math.round((value + Number.EPSILON) * 100) / 100;

export const INTEREST_PROFILES = Object.freeze({
  generic: Object.freeze({ label: 'General daily estimate', method: 'daily-simple', minimumInterest: 0, minimumProfileId: 'saved' }),
  'capital-one': Object.freeze({ label: 'Capital One · daily compounding', method: 'daily-compound', minimumInterest: 0, minimumProfileId: 'saved' }),
  'credit-one': Object.freeze({ label: 'Credit One · monthly average balance', method: 'monthly-adb', minimumInterest: 1, excludeUnpaidInterest: true, minimumProfileId: 'credit-one' }),
  milestone: Object.freeze({ label: 'Milestone · monthly average balance', method: 'monthly-adb', minimumInterest: 1, excludeUnpaidInterest: false, minimumProfileId: 'milestone' }),
  indigo: Object.freeze({ label: 'Indigo · monthly average balance', method: 'monthly-adb', minimumInterest: 1, excludeUnpaidInterest: false, minimumProfileId: 'saved' }),
  'elga-card': Object.freeze({ label: 'ELGA card · monthly average balance', method: 'monthly-adb', minimumInterest: 0, excludeUnpaidInterest: true, excludeLateFees: true, minimumProfileId: 'elga-card' }),
  affirm: Object.freeze({ label: 'Affirm · daily simple loan interest', method: 'daily-simple', minimumInterest: 0, minimumProfileId: 'installment' }),
  'daily-simple': Object.freeze({ label: 'Loan · daily simple interest', method: 'daily-simple', minimumInterest: 0, minimumProfileId: 'installment' }),
});

export function validInterestDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value + 'T12:00:00Z'))
    && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
}
const stamp = date => Date.parse(date + 'T12:00:00Z');
const dateString = value => new Date(value).toISOString().slice(0, 10);
const nextDay = date => dateString(stamp(date) + DAY);
function closingDate(year, month, closingDay) {
  const first = new Date(Date.UTC(year, month, 1, 12));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12)).getUTCDate();
  return dateString(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(closingDay || last, last), 12));
}
export function interestCycleForDate(date, closingDay = null) {
  if (!validInterestDate(date)) throw new TypeError('A valid interest date is required.');
  const d = new Date(stamp(date));
  let month = d.getUTCMonth();
  const year = d.getUTCFullYear();
  if (date > closingDate(year, month, closingDay)) month++;
  const end = closingDate(year, month, closingDay);
  const start = nextDay(closingDate(year, month - 1, closingDay));
  return { start, end, days: Math.round((stamp(end) - stamp(start)) / DAY) + 1 };
}

export function normalizeInterestRules(cardOrRules = {}) {
  const card = cardOrRules && typeof cardOrRules === 'object' ? cardOrRules : {};
  const raw = card.interestRules && typeof card.interestRules === 'object' ? card.interestRules : card;
  const requested = raw.profileId || card.interestProfile;
  const profileId = Object.hasOwn(INTEREST_PROFILES, requested) ? requested : 'generic';
  const profile = INTEREST_PROFILES[profileId];
  const day = Number(raw.closingDay);
  const grace = ['active', 'lost', 'unknown'].includes(raw.grace) ? raw.grace : 'unknown';
  const graceThrough = validInterestDate(raw.graceThrough) ? raw.graceThrough
    : grace === 'active' && validInterestDate(card.dueDate) ? card.dueDate : null;
  const basis = ['principal', 'scheduled-total', 'unknown'].includes(raw.balanceBasis)
    ? raw.balanceBasis : profileId === 'affirm' ? 'unknown' : 'principal';
  const fixedFees = Array.isArray(raw.fixedFees) ? raw.fixedFees.flatMap((fee, index) => {
    if (!fee || !validInterestDate(fee.date) || !Number.isFinite(Number(fee.amount)) || Number(fee.amount) <= 0) return [];
    return [{ id: String(fee.id ?? index), date: fee.date, amount: cents(nonnegative(fee.amount)),
      repeat: ['monthly', 'yearly'].includes(fee.repeat) ? fee.repeat : 'once',
      kind: fee.kind === 'late' ? 'late' : 'fee', name: String(fee.name || 'Scheduled fee').slice(0, 100) }];
  }) : [];
  const aprChanges = Array.isArray(raw.aprChanges) ? raw.aprChanges.filter(change => change
    && validInterestDate(change.date) && Number.isFinite(Number(change.apr)) && Number(change.apr) >= 0)
    .map(change => ({ date: change.date, apr: nonnegative(change.apr) })).sort((a, b) => a.date.localeCompare(b.date)) : [];
  return {
    ...profile, profileId, closingDay: Number.isInteger(day) && day >= 1 && day <= 31 ? day : null,
    grace, graceThrough, balanceBasis: basis,
    balanceType: ['cash', 'transfer'].includes(raw.balanceType) ? raw.balanceType : 'purchase',
    dayBasis: Number(raw.dayBasis) === 360 ? 360 : 365,
    minimumInterest: raw.minimumInterest != null && Number.isFinite(Number(raw.minimumInterest))
      ? nonnegative(raw.minimumInterest) : profile.minimumInterest,
    knownUnpaidInterest: nonnegative(raw.knownUnpaidInterest),
    knownExcludedFees: nonnegative(raw.knownExcludedFees),
    financeChargeCap: raw.financeChargeCap != null && Number.isFinite(Number(raw.financeChargeCap))
      ? nonnegative(raw.financeChargeCap) : null,
    fixedFees, aprChanges,
  };
}

function addNote(state, note) {
  if (!state.notes.includes(note)) state.notes.push(note);
  state.estimated = true;
}
function updateBalance(state) {
  state.balance = Math.max(0, state.principal + state.unpaidInterest + state.accruedInterest + state.excludedFees);
  return state.balance;
}
function addRuleNotes(state, rules) {
  if (rules.profileId === 'generic') addNote(state, 'Issuer calculation rules are unknown; daily simple interest is an estimate.');
  if (rules.method !== 'daily-simple' && !rules.closingDay) addNote(state, 'Statement closing day is unknown; calendar-month cycles are estimated.');
  if (rules.profileId === 'credit-one') addNote(state, 'Credit One payment allocation and fee timing are estimated; separately tracked unpaid interest is excluded.');
  if (rules.profileId === 'elga-card') addNote(state, 'ELGA balance categories and purchase eligibility are estimated from the supplied account balance.');
  if (rules.profileId === 'indigo') addNote(state, 'Indigo statement rounding may differ by a cent; this forecast rounds at statement close.');
  if (rules.profileId === 'affirm') addNote(state, 'Affirm uses a 365-day simple-interest estimate unless the individual loan specifies otherwise.');
  if (rules.profileId === 'affirm' && rules.financeChargeCap === null) addNote(state, 'The remaining loan finance-charge cap is unknown; no contract cap has been inferred.');
  if (rules.balanceBasis === 'scheduled-total') addNote(state, 'The balance includes scheduled interest; no extra interest is added to avoid counting it twice.');
  if (rules.balanceBasis === 'unknown') addNote(state, 'Confirm whether this balance is principal or a scheduled repayment total before adding interest.');
  if (rules.grace === 'unknown' && rules.method !== 'daily-simple') addNote(state, 'Grace eligibility is unknown; interest is estimated on the remaining balance.');
  if (rules.grace === 'active' && !rules.graceThrough) addNote(state, 'An active purchase grace period needs an expiry date; no indefinite interest exemption is assumed.');
  if (rules.grace === 'active' && rules.graceThrough) addNote(state, 'Purchase grace is protected through the specified date; any later grace-loss adjustment remains an estimate.');
}

export function createInterestState(card = {}, balance = 0, asOfDate) {
  if (!validInterestDate(asOfDate)) throw new TypeError('A valid balance as-of date is required.');
  const rules = normalizeInterestRules(card);
  const opening = nonnegative(balance);
  const unpaidInterest = Math.min(opening, rules.knownUnpaidInterest);
  const excludedFees = Math.min(opening - unpaidInterest, rules.knownExcludedFees);
  const state = {
    version: 1, asOfDate, startDate: asOfDate, rules,
    principal: opening - unpaidInterest - excludedFees,
    unpaidInterest, excludedFees, accruedInterest: 0, balance: opening,
    totalInterest: 0, totalFees: 0, totalPaid: 0, financeInterestUsed: 0,
    cycleAccrued: 0, cycleRecognized: 0, cyclePaidInterest: 0, cycleKey: null,
    appliedFees: {}, notes: [], estimated: false,
  };
  addRuleNotes(state, rules);
  if (rules.method !== 'daily-simple' && interestCycleForDate(asOfDate, rules.closingDay).start !== asOfDate) {
    addNote(state, 'The first statement cycle starts from the supplied balance date; earlier unbilled interest is not reconstructed.');
  }
  return state;
}

function feeFallsOn(fee, date) {
  if (date < fee.date) return false;
  if (fee.repeat === 'once') return date === fee.date;
  const base = new Date(stamp(fee.date)), d = new Date(stamp(date));
  if (fee.repeat === 'yearly' && base.getUTCMonth() !== d.getUTCMonth()) return false;
  return date === closingDate(d.getUTCFullYear(), d.getUTCMonth(), base.getUTCDate());
}
function addDatedFees(state, rules, date) {
  // Only explicitly dated fees are considered. They can still apply to an open
  // account with a zero balance; issuer names never create a fee schedule.
  for (const fee of rules.fixedFees) {
    const key = fee.id + ':' + date;
    if (!state.appliedFees[key] && feeFallsOn(fee, date)) {
      if (rules.excludeLateFees && fee.kind === 'late') state.excludedFees += fee.amount;
      else state.principal += fee.amount;
      state.totalFees += fee.amount;
      state.appliedFees[key] = true;
    }
  }
}
function applicableApr(card, rules, date) {
  let apr = nonnegative(card.apr);
  for (const change of rules.aprChanges) {
    if (change.date > date) break;
    apr = change.apr;
  }
  return apr / 100;
}
function mayAccrue(rules, date) {
  if (rules.balanceBasis !== 'principal') return false;
  return !(rules.balanceType === 'purchase' && rules.grace === 'active'
    && rules.graceThrough && date <= rules.graceThrough);
}
function cappedInterest(state, rules, amount) {
  return rules.financeChargeCap === null ? amount
    : Math.min(amount, Math.max(0, rules.financeChargeCap - state.financeInterestUsed
      + Math.max(0, state.cycleRecognized - state.cycleAccrued)));
}
function postCycleInterest(state, rules) {
  if (state.cycleAccrued <= EPSILON) {
    state.cycleAccrued = 0;
    state.cycleRecognized = 0;
    state.cyclePaidInterest = 0;
    return;
  }
  const raw = state.cycleAccrued;
  let charge = Math.max(cents(raw), rules.minimumInterest);
  if (rules.financeChargeCap !== null) {
    charge = Math.min(charge, Math.max(0, rules.financeChargeCap - (state.financeInterestUsed - state.cycleRecognized)));
  }
  const correction = charge - state.cycleRecognized;
  state.totalInterest += correction;
  state.financeInterestUsed += correction;
  // Payments can cover unbilled interest before closing. They do not erase the
  // accrued cycle charge or cause its minimum to be charged a second time.
  const unpaid = Math.max(0, charge - state.cyclePaidInterest);
  const overpayment = Math.max(0, state.cyclePaidInterest - charge);
  state.unpaidInterest += unpaid;
  state.principal = Math.max(0, state.principal - overpayment);
  state.accruedInterest = 0;
  state.cycleAccrued = 0;
  state.cycleRecognized = 0;
  state.cyclePaidInterest = 0;
}

export function accrueInterest(state, card = {}, toDate) {
  if (!state || !validInterestDate(state.asOfDate) || !validInterestDate(toDate)) throw new TypeError('Valid interest state and dates are required.');
  if (toDate < state.asOfDate) throw new RangeError('Interest cannot accrue backwards.');
  if ((stamp(toDate) - stamp(state.asOfDate)) / DAY > 366 * 100) throw new RangeError('Interest projection exceeds 100 years.');
  const rules = normalizeInterestRules(card);
  addRuleNotes(state, rules);
  state.rules = rules;
  const beforeInterest = state.totalInterest, beforeFees = state.totalFees;
  for (let date = state.asOfDate; date < toDate; date = nextDay(date)) {
    addDatedFees(state, rules, date);
    const cycle = rules.method === 'daily-simple' ? null : interestCycleForDate(date, rules.closingDay);
    if (cycle) state.cycleKey = cycle.end;
    let basis = state.principal;
    if (rules.method === 'daily-compound') basis += state.unpaidInterest + Math.max(0, state.cycleAccrued - state.cyclePaidInterest);
    else if (rules.method === 'monthly-adb' && !rules.excludeUnpaidInterest) basis += state.unpaidInterest;
    const rate = applicableApr(card, rules, date);
    const period = rules.method === 'monthly-adb' ? 12 * cycle.days : rules.dayBasis;
    const add = mayAccrue(rules, date) ? cappedInterest(state, rules, Math.max(0, basis) * rate / period) : 0;
    if (cycle) {
      state.cycleAccrued += add;
      let recognized = state.cycleAccrued > EPSILON ? Math.max(state.cycleAccrued, rules.minimumInterest) : 0;
      if (rules.financeChargeCap !== null) recognized = Math.min(recognized,
        Math.max(0, rules.financeChargeCap - (state.financeInterestUsed - state.cycleRecognized)));
      const change = recognized - state.cycleRecognized;
      state.totalInterest += change;
      state.financeInterestUsed += change;
      state.cycleRecognized = recognized;
      state.accruedInterest = Math.max(0, recognized - state.cyclePaidInterest);
    } else {
      state.accruedInterest += add;
      state.totalInterest += add;
      state.financeInterestUsed += add;
    }
    if (cycle && date === cycle.end) postCycleInterest(state, rules);
  }
  state.asOfDate = toDate;
  return { interest: state.totalInterest - beforeInterest, fees: state.totalFees - beforeFees,
    balance: updateBalance(state), notes: [...state.notes], estimated: state.estimated };
}

export function applyInterestPayment(state, payment) {
  if (!state || !Number.isFinite(state.principal)) throw new TypeError('Valid interest state is required.');
  let remaining = Math.min(nonnegative(payment), updateBalance(state));
  const applied = remaining;
  // Loans cover accrued interest before principal. Card payments cover billed
  // interest and fees, then principal; unbilled cycle interest is covered only
  // by an estimated full payoff. Within-rate allocation is an estimate where
  // the issuer's account-specific allocation has not been supplied.
  const order = state.rules.method === 'daily-simple'
    ? ['unpaidInterest', 'accruedInterest', 'excludedFees', 'principal']
    : ['unpaidInterest', 'excludedFees', 'principal', 'accruedInterest'];
  for (const field of order) {
    const amount = Math.min(remaining, state[field]);
    state[field] -= amount;
    remaining -= amount;
    if (field === 'accruedInterest' && state.rules.method !== 'daily-simple') state.cyclePaidInterest += amount;
  }
  state.totalPaid += applied;
  updateBalance(state);
  return applied;
}

// Account-specific minimum formulas estimate future statements only. Imported
// current statement minimums remain authoritative in the calling payment model.
export function estimateMinimumPayment(card = {}, balance = 0, options = {}) {
  const owed = nonnegative(balance);
  if (owed <= EPSILON) return 0;
  const rules = normalizeInterestRules(card);
  const minimumRules = card.minimumRules || {};
  const profileId = minimumRules.profileId || rules.minimumProfileId || 'saved';
  const lateFee = nonnegative(options.lateFee ?? minimumRules.lateFee);
  const pastDue = nonnegative(options.pastDue ?? minimumRules.pastDue);
  const overLimit = nonnegative(options.overLimit ?? minimumRules.overLimit);
  const saved = Number.isFinite(Number(card.monthlyMinimum)) ? nonnegative(card.monthlyMinimum)
    : Number.isFinite(Number(card.minimum)) ? nonnegative(card.minimum) : nonnegative(card.min) * 26 / 12;
  let minimum = saved;
  if (profileId === 'credit-one') minimum = Math.max(Math.ceil(owed * 0.05 - EPSILON), 30) + lateFee + pastDue;
  else if (profileId === 'milestone') minimum = Math.max(Math.round(owed * 0.05), 40) + pastDue;
  else if (profileId === 'elga-card') minimum = Math.max(owed * 0.02, 25) + pastDue + overLimit;
  return cents(Math.min(owed, Math.max(0, minimum)));
}
