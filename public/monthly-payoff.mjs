import {
  createInterestState, accrueInterest, applyInterestPayment,
  estimateMinimumPayment, normalizeInterestRules, validInterestDate,
} from './debt-interest.mjs';
import {effectiveDebtTerms, monthlyMinimum} from './debt-payments.mjs';

// Scenario-only model. All public money values are dollars; only allocation
// uses integer cents. Never persist these projected balances as account data.
const cents = value => Math.round((value + Number.EPSILON) * 100);
const money = value => cents(value) / 100;
const number = value => typeof value === 'number' && Number.isFinite(value);
const amount = value => number(value) && value >= 0 && Number.isSafeInteger(cents(value));
const sum = values => values.reduce((total, value) => total + value, 0);
const atMonth = (date, offset, day = Number(date.slice(8))) => {
  const base = new Date(date + 'T12:00:00Z');
  const first = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + offset, 1, 12));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, last), 12)).toISOString().slice(0, 10);
};
const issue = (card, code, message) => ({id: card?.id ?? null, name: card?.name || '', code, message});

function normalizedTerms(card) {
  if (!card.terms || typeof card.terms !== 'object') return null;
  const terms = {...card.terms};
  if (!(terms.forecastMonthlyMinimum > 0) && card.lastPositiveMonthlyMinimum > 0) {
    terms.forecastMonthlyMinimum = card.lastPositiveMonthlyMinimum;
  }
  return terms;
}

// The first projected month reserves the next actual due cycle, even when its
// due date is earlier than the modeled payment date. Each subsequent month
// advances that cycle once. Projection dates are not an executable due-date
// schedule; short-month clamping must never repeat a zero-due statement.
function dueCycle(card, terms, startDate, month) {
  const source = card.termsSource?.fields ? card.termsSource.fields.monthlyMinimum : card.termsSource;
  const statementDueDate = source?.statementDueDate || (source ? card.termsSource?.statementDueDate : null);
  const anchor = [terms?.dueDate, card.dueDate, statementDueDate].find(validInterestDate);
  if (!validInterestDate(anchor)) return null;
  const day = Number(anchor.slice(8));
  let first = atMonth(startDate, 0, day);
  if (first < startDate) first = atMonth(startDate, 1, day);
  return atMonth(first, month - 1, day);
}

function cycleMinimum(card, terms, balance, startDate, month, paymentDate) {
  const dueDate = dueCycle(card, terms, startDate, month);
  const referenceDate = dueDate || paymentDate;
  const effective = effectiveDebtTerms(card, terms, referenceDate);
  const cycles = {...card.cycleMinimums, ...terms?.cycleMinimums};
  const override = dueDate && cycles[dueDate];
  if (override && amount(override.amount)) return {amount: Math.min(balance, override.amount), dueDate};

  const through = terms?.currentCycleThrough || terms?.dueDate || terms?.date;
  const currentReported = !!terms?.currentCycleMinimum && validInterestDate(terms.date)
    && validInterestDate(through) && referenceDate >= terms.date && referenceDate <= through;
  const source = card.termsSource?.fields ? card.termsSource.fields.monthlyMinimum : card.termsSource;
  const statementDueDate = source?.statementDueDate || (source ? card.termsSource?.statementDueDate : null);
  const currentReviewed = validInterestDate(statementDueDate) && referenceDate <= statementDueDate;
  const profile = effective.minimumRules?.profileId || normalizeInterestRules(effective).minimumProfileId;
  const formula = ['credit-one', 'milestone', 'elga-card'].includes(profile);

  if (formula && !currentReported && !currentReviewed) {
    return {amount: estimateMinimumPayment(effective, balance), dueDate};
  }
  const savedMinimum = number(effective.monthlyMinimum) ? effective.monthlyMinimum
    : number(effective.min) ? effective.min * 26 / 12 : null;
  if (effective.missingFutureMinimum || !amount(savedMinimum)) {
    return {error: issue(card, 'missing-minimum', card.name + ': add a monthly minimum or future minimum estimate.'), dueDate};
  }
  return {amount: Math.min(balance, monthlyMinimum(effective)), dueDate};
}

function accrueTo(state, card, terms, date) {
  // A future provider APR takes effect on its source date, not retroactively
  // over the entire first monthly interval.
  if (validInterestDate(terms?.date) && terms.date > state.asOfDate && terms.date < date) {
    accrueInterest(state, effectiveDebtTerms(card, terms, state.asOfDate), terms.date);
  }
  accrueInterest(state, effectiveDebtTerms(card, terms, state.asOfDate), date);
}

function aprAt(card, terms, date) {
  const effective = effectiveDebtTerms(card, terms, date);
  let apr = effective.apr;
  for (const change of normalizeInterestRules(effective).aprChanges) {
    if (change.date <= date) apr = change.apr;
  }
  return apr;
}

/** A fixed total monthly debt budget, with all minimums reserved before extra. */
export function simulateMonthlyPayoff({cards = [], monthlyBudget, startDate, method = 'avalanche', maxMonths = 360} = {}) {
  const notes = new Set([
    'This is a monthly estimate with no new borrowing or purchases.',
    'Payments are modeled one month after the balance date, then monthly. These dates are not payment due dates; pay each account by its actual due date.',
    'The same monthly budget continues as debts are paid off. Future statement minimums are estimated from saved amounts and rules.',
  ]);
  const result = {status: 'invalid', months: null, payoffDate: null, totalInterest: null, totalFees: null,
    totalPaid: null, accruedInterest: 0, accruedFees: 0, paidToDate: 0, totalBalance: 0, remainingBalance: 0,
    minimumRequired: 0, initialMinimum: 0, shortfall: 0, failureMonth: null, failureDate: null,
    rows: [], debts: [], issues: [], notes: []};
  const finish = status => ({...result, status, notes: [...notes]});
  if (!Array.isArray(cards) || !amount(monthlyBudget) || !validInterestDate(startDate)
      || !['avalanche', 'snowball'].includes(method) || !Number.isInteger(maxMonths) || maxMonths < 1 || maxMonths > 1200) {
    result.issues.push(issue(null, 'invalid-input', 'Enter a valid monthly budget, balance date, and payoff method.'));
    return finish('invalid');
  }
  const ids = new Set();
  const active = [];
  for (const [index, raw] of cards.entries()) {
    if (!raw || typeof raw !== 'object' || raw.id == null || ids.has(String(raw.id)) || !amount(raw.balance)) {
      result.issues.push(issue(raw, 'invalid-debt', 'Each debt needs a unique ID and a valid nonnegative balance.'));
      continue;
    }
    ids.add(String(raw.id));
    if (cents(raw.balance) === 0) continue;
    const card = {...raw, name: String(raw.name || 'Debt ' + (index + 1)), balance: money(raw.balance)};
    const terms = normalizedTerms(card);
    const effective = effectiveDebtTerms(card, terms, startDate);
    const rules = normalizeInterestRules(effective);
    if (rules.balanceBasis === 'unknown') result.issues.push(issue(card, 'unknown-balance-basis', card.name + ': confirm whether the balance is principal or includes scheduled interest.'));
    if (!number(effective.apr) || effective.apr < 0 || effective.apr > 100) result.issues.push(issue(card, 'missing-apr', card.name + ': add a valid APR (enter 0 for an interest-free debt).'));
    active.push({card, terms, rules});
  }
  result.totalBalance = sum(active.map(({card}) => cents(card.balance))) / 100;
  result.remainingBalance = result.totalBalance;
  if (result.issues.length) return finish(result.issues.some(item => item.code === 'invalid-debt') ? 'invalid' : 'missing-details');
  if (!active.length) {
    Object.assign(result, {months: 0, payoffDate: startDate, totalInterest: 0, totalFees: 0, totalPaid: 0});
    return finish('no-debt');
  }
  const ledgers = active.map(({card, terms}) => createInterestState(effectiveDebtTerms(card, terms, startDate), card.balance, startDate));
  result.debts = active.map(({card}) => ({id: card.id, name: card.name, startingBalance: card.balance, balance: card.balance,
    payoffMonth: null, payoffDate: null, interest: 0, fees: 0, totalPaid: 0}));
  if (active.some(({rules}) => rules.balanceBasis === 'scheduled-total')) notes.add('Interest already included in a scheduled repayment balance stays in the starting balance. The interest estimate reports additional interest only; it does not itemize interest already included.');
  if (active.some(({rules}) => rules.fixedFees.length)) notes.add('Saved scheduled fees are included until each debt is paid off; fees after payoff are not modeled.');
  const budget = cents(monthlyBudget);
  let paid = 0, previousInterest = 0, previousFees = 0;
  const refresh = () => {
    for (const [i, state] of ledgers.entries()) {
      Object.assign(result.debts[i], {balance: money(state.balance), interest: money(state.totalInterest), fees: money(state.totalFees)});
      for (const note of state.notes) notes.add(note);
    }
    result.remainingBalance = sum(ledgers.map(state => cents(state.balance))) / 100;
    result.accruedInterest = sum(ledgers.map(state => cents(state.totalInterest))) / 100;
    result.accruedFees = sum(ledgers.map(state => cents(state.totalFees))) / 100;
    result.paidToDate = paid / 100;
  };
  // Only identify failure to amortize when every remaining account fails to
  // shrink over a year, and no future rate/cap/grace/fee change can improve it.
  const stableRules = active.every(({card, terms, rules}) => !rules.aprChanges.length && !rules.fixedFees.length
    && rules.financeChargeCap === null && !rules.graceThrough && !(validInterestDate(terms?.date) && terms.date > startDate));

  for (let month = 1; month <= maxMonths; month++) {
    const date = atMonth(startDate, month);
    for (const [i, {card, terms}] of active.entries()) if (result.debts[i].payoffMonth === null) accrueTo(ledgers[i], card, terms, date);
    refresh();
    if (ledgers.some(state => !Number.isSafeInteger(cents(state.balance)))) {
      result.issues.push(issue(null, 'projection-limit', 'The projected balance exceeds the supported calculation range.'));
      return finish('horizon');
    }
    const requirements = active.map(({card, terms}, i) => result.debts[i].payoffMonth !== null ? {amount: 0, dueDate: null}
      : cycleMinimum(card, terms, ledgers[i].balance, startDate, month, date));
    const missing = requirements.flatMap(required => required.error ? [required.error] : []);
    if (missing.length) {
      Object.assign(result, {issues: missing, failureMonth: month, failureDate: date});
      return finish('missing-details');
    }
    const owed = ledgers.map(state => Math.max(0, cents(state.balance)));
    const minimums = requirements.map((required, i) => Math.min(owed[i], Math.max(0, cents(required.amount))));
    const required = sum(minimums);
    if (month === 1) result.initialMinimum = result.minimumRequired = required / 100;
    if (required > budget) {
      Object.assign(result, {minimumRequired: required / 100, shortfall: (required - budget) / 100, failureMonth: month, failureDate: date});
      return finish('insufficient-budget');
    }
    const payments = [...minimums];
    let extra = budget - required;
    const order = active.map((_, i) => i).sort((a, b) => {
      const balanceOrder = (owed[a] - minimums[a]) - (owed[b] - minimums[b]);
      const rateOrder = aprAt(active[b].card, active[b].terms, date) - aprAt(active[a].card, active[a].terms, date);
      return (method === 'avalanche' ? rateOrder || balanceOrder : balanceOrder || rateOrder)
        || String(active[a].card.id).localeCompare(String(active[b].card.id));
    });
    for (const i of order) {
      const payment = Math.min(extra, owed[i] - payments[i]);
      payments[i] += payment;
      extra -= payment;
    }
    for (const [i, state] of ledgers.entries()) {
      if (result.debts[i].payoffMonth !== null) continue;
      applyInterestPayment(state, payments[i] >= owed[i] ? state.balance : payments[i] / 100);
      result.debts[i].totalPaid = money(result.debts[i].totalPaid + payments[i] / 100);
      if (cents(state.balance) === 0) Object.assign(result.debts[i], {payoffMonth: month, payoffDate: date});
    }
    const paidThisMonth = sum(payments);
    paid += paidThisMonth;
    refresh();
    const interest = cents(result.accruedInterest), fees = cents(result.accruedFees);
    result.rows.push({month, date, minimumTotal: required / 100, paymentTotal: paidThisMonth / 100,
      remainingBalance: result.remainingBalance, interest: (interest - previousInterest) / 100, fees: (fees - previousFees) / 100,
      payments: active.map(({card}, i) => ({id: card.id, name: card.name, dueDate: requirements[i].dueDate,
        minimum: minimums[i] / 100, extra: (payments[i] - minimums[i]) / 100, payment: payments[i] / 100, balanceAfter: result.debts[i].balance}))});
    previousInterest = interest;
    previousFees = fees;
    if (result.debts.every(debt => debt.payoffMonth !== null)) {
      Object.assign(result, {months: month, payoffDate: date, totalInterest: result.accruedInterest,
        totalFees: result.accruedFees, totalPaid: result.paidToDate});
      return finish('paid-off');
    }
    if (budget === 0 || stableRules && month >= 12 && result.debts.every((debt, i) => {
      if (debt.payoffMonth !== null) return debt.payoffMonth <= month - 12;
      const prior = month === 12 ? active[i].card.balance : result.rows[month - 13].payments[i].balanceAfter;
      return cents(debt.balance) >= cents(prior);
    })) {
      result.issues.push(issue(null, 'not-amortizing', 'This budget does not reduce the remaining debts under the saved payment and interest rules.'));
      return finish('not-amortizing');
    }
  }
  result.issues.push(issue(null, 'horizon', 'The debts are not paid off within ' + maxMonths + ' projected months. Increase the budget to compare a shorter plan.'));
  return finish('horizon');
}
