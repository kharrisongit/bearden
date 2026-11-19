import test from 'node:test';
import assert from 'node:assert/strict';
import {simulateMonthlyPayoff} from '../public/monthly-payoff.mjs';

// Synthetic accounts only: verify financial boundaries without private data.
const card = (id, balance, extra = {}) => ({id, name: 'Debt ' + id, balance, apr: 0, monthlyMinimum: 30,
  interestRules: {profileId: 'daily-simple', balanceBasis: 'principal'}, ...extra});
const plan = (cards, monthlyBudget, extra = {}) => simulateMonthlyPayoff({cards, monthlyBudget, startDate: '2026-01-01', ...extra});
const freeze = value => {if (value && typeof value === 'object') {Object.freeze(value); Object.values(value).forEach(freeze);} return value;};

test('minimums come first, payoff surplus rolls over in the same month, and the final budget is capped', () => {
  const cards = freeze([card('a', 100), card('b', 300), card('c', 500)]);
  const before = JSON.stringify(cards);
  const result = plan(cards, 350, {method: 'snowball'});
  assert.equal(result.status, 'paid-off');
  assert.equal(result.months, 3);
  assert.equal(result.totalPaid, 900);
  assert.equal(result.totalInterest, 0);
  assert.equal(result.rows[0].minimumTotal, 90);
  assert.deepEqual(result.rows[0].payments.map(p => p.payment), [100, 220, 30]);
  assert.equal(result.rows.at(-1).paymentTotal, 200);
  for (const row of result.rows) {
    assert.ok(row.paymentTotal <= 350);
    assert.equal(Math.round(row.payments.reduce((n, p) => n + p.payment, 0) * 100), Math.round(row.paymentTotal * 100));
    assert.ok(row.payments.every(p => p.payment >= p.minimum && p.balanceAfter >= 0));
  }
  assert.equal(JSON.stringify(cards), before);
});

test('avalanche and snowball choose different extra-payment targets deterministically', () => {
  const cards = [card('small', 100, {apr: 10, monthlyMinimum: 20}), card('large', 1000, {apr: 30})];
  const avalanche = plan(cards, 150), snowball = plan(cards, 150, {method: 'snowball'});
  assert.equal(avalanche.rows[0].payments[0].extra, 0);
  assert.equal(avalanche.rows[0].payments[1].extra, 100);
  assert.ok(snowball.rows[0].payments[0].extra > 80);
  assert.equal(snowball.rows[0].payments[0].balanceAfter, 0);
  assert.ok(avalanche.totalInterest < snowball.totalInterest);
  assert.deepEqual(plan(cards, 150), avalanche);
});

test('interest uses elapsed days and a synced future APR starts on its effective date', () => {
  const fixed = plan([card('a', 1000, {apr: 36.5})], 2000);
  assert.equal(fixed.totalInterest, 31);
  assert.equal(fixed.totalPaid, 1031);
  const changed = plan([card('a', 1000, {apr: 36.5, terms: {date: '2026-01-16', apr: 73}})], 2000);
  assert.equal(changed.totalInterest, 47); // 15 days at $1/day, then 16 at $2/day.
  assert.equal(changed.months, 1);
});

test('an underfunded budget does not silently allocate below minimums or publish complete totals', () => {
  const result = plan([card('a', 100), card('b', 200)], 50);
  assert.equal(result.status, 'insufficient-budget');
  assert.equal(result.minimumRequired, 60);
  assert.equal(result.shortfall, 10);
  assert.equal(result.failureMonth, 1);
  assert.equal(result.rows.length, 0);
  assert.equal(result.totalInterest, null);
  assert.equal(result.totalPaid, null);
  assert.equal(plan([card('tiny', 10, {monthlyMinimum: 100})], 10).totalPaid, 10);
});

test('a current reviewed statement due inside month one wins, then future minimum formulas apply', () => {
  const result = plan([card('a', 500, {monthlyMinimum: 10, dueDate: '2026-01-15',
    minimumRules: {profileId: 'credit-one'},
    termsSource: {fields: {monthlyMinimum: {asOf: '2026-01-01', statementDueDate: '2026-01-15'}}},
  })], 20);
  assert.equal(result.rows[0].minimumTotal, 10);
  assert.equal(result.rows[0].date, '2026-02-01');
  assert.equal(result.rows[0].payments[0].dueDate, '2026-01-15');
  assert.equal(result.status, 'insufficient-budget');
  assert.equal(result.failureMonth, 2);
  assert.equal(result.minimumRequired, 30);
});

test('a zero-due statement lasts one cycle, uses a saved future fallback, and never hides missing future minimums', () => {
  const source = card('a', 500, {monthlyMinimum: 0, lastPositiveMonthlyMinimum: 40, dueDate: '2026-01-31',
    terms: {date: '2026-01-28', dueDate: '2026-01-31', monthlyMinimum: 0, currentCycleMinimum: true,
      currentCycleThrough: '2026-01-31', cycleMinimums: {'2026-01-31': {amount: 0}}}});
  const result = plan([source], 15, {startDate: '2026-01-28'});
  assert.equal(result.rows[0].minimumTotal, 0);
  assert.equal(result.rows[0].payments[0].dueDate, '2026-01-31');
  assert.equal(result.failureMonth, 2);
  assert.equal(result.minimumRequired, 40);
  const unknown = plan([{...source, lastPositiveMonthlyMinimum: undefined}], 15, {startDate: '2026-01-28'});
  assert.equal(unknown.status, 'missing-details');
  assert.equal(unknown.failureMonth, 2);
  assert.equal(unknown.totalInterest, null);
  const paidBeforeNextStatement = plan([{...source, balance: 10, lastPositiveMonthlyMinimum: undefined}], 15, {startDate: '2026-01-28'});
  assert.equal(paidBeforeNextStatement.status, 'paid-off');
});

test('scheduled fees are separate and precomputed loan interest is not added twice', () => {
  const fees = plan([card('a', 100, {interestRules: {profileId: 'daily-simple', fixedFees: [{id: 'fee', date: '2026-01-15', amount: 12, repeat: 'once'}]}})], 200);
  assert.equal(fees.totalInterest, 0);
  assert.equal(fees.totalFees, 12);
  assert.equal(fees.totalPaid, 112);
  const inclusive = plan([card('b', 100, {apr: 36.5, interestRules: {profileId: 'affirm', balanceBasis: 'scheduled-total'}})], 200);
  assert.equal(inclusive.totalPaid, 100);
  assert.equal(inclusive.totalInterest, 0);
  assert.match(inclusive.notes.join(' '), /does not itemize interest already included/);
  const unknown = plan([card('b', 100, {interestRules: {profileId: 'affirm', balanceBasis: 'unknown'}})], 200);
  assert.equal(unknown.status, 'missing-details');
  assert.equal(unknown.totalInterest, null);
});

test('monthly dates retain their original anchor through leap February', () => {
  const result = plan([card('a', 100, {monthlyMinimum: 10})], 10, {startDate: '2028-01-31'});
  assert.deepEqual(result.rows.slice(0, 3).map(row => row.date), ['2028-02-29', '2028-03-31', '2028-04-30']);
  assert.equal(result.months, 10);
});

test('non-amortizing and horizon outcomes keep complete estimates unknown and respect future improvements', () => {
  const growing = card('a', 1000, {apr: 36.5, monthlyMinimum: 1});
  const stuck = plan([growing], 5);
  assert.equal(stuck.status, 'not-amortizing');
  assert.equal(stuck.months, null);
  assert.equal(stuck.totalInterest, null);
  assert.equal(stuck.rows.length, 12);
  const bounded = plan([card('a', 1000, {monthlyMinimum: 1})], 1, {maxMonths: 3});
  assert.equal(bounded.status, 'horizon');
  assert.equal(bounded.totalPaid, null);
  assert.equal(bounded.paidToDate, 3);
  const future = plan([{...growing, interestRules: {...growing.interestRules, aprChanges: [{date: '2028-01-01', apr: 0}]}}], 5, {maxMonths: 12});
  assert.equal(future.status, 'horizon');
});

test('empty debt, invalid inputs, unknown APR and fractional-cent payoffs are explicit', () => {
  const empty = plan([], 0);
  assert.equal(empty.status, 'no-debt');
  assert.equal(empty.months, 0);
  assert.equal(empty.totalInterest, 0);
  for (const value of [-1, NaN, Infinity, '', null]) assert.equal(plan([card('a', 10)], value).status, 'invalid');
  assert.equal(plan([card('a', 10), card('a', 20)], 50).status, 'invalid');
  assert.equal(plan([card('a', 10, {apr: null})], 50).status, 'missing-details');
  const tiny = plan([card('a', 0.01, {apr: 36.5, monthlyMinimum: 0})], 0.01);
  assert.equal(tiny.status, 'paid-off');
  assert.equal(tiny.totalPaid, 0.01);
  assert.equal(tiny.remainingBalance, 0);
});
