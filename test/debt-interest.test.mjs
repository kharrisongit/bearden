import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INTEREST_PROFILES, normalizeInterestRules, interestCycleForDate,
  createInterestState, accrueInterest, applyInterestPayment, estimateMinimumPayment,
} from '../public/debt-interest.mjs';

// Synthetic balances only. These cases verify documented calculation rules and
// accounting boundaries, not the contents of anyone's uploaded statements.
const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const account = (profileId, extras = {}) => ({ apr: 24, monthlyMinimum: 45,
  interestRules: { profileId, closingDay: 31, grace: 'lost', ...extras } });

test('daily compounding uses elapsed calendar days and preserves fractional cents', () => {
  const card = { ...account('capital-one'), apr: 36.5 };
  const state = createInterestState(card, 1000, '2028-02-01');
  assert.equal(accrueInterest(state, card, '2028-02-01').interest, 0);
  const result = accrueInterest(state, card, '2028-02-11');
  close(result.interest, 1000 * (1.001 ** 10 - 1));
  close(result.balance, 1000 * 1.001 ** 10);
});

test('irrelevant intermediate events cannot change interest or statement rounding', () => {
  for (const profileId of ['capital-one', 'credit-one', 'milestone', 'indigo', 'elga-card', 'daily-simple']) {
    const card = account(profileId, { knownUnpaidInterest: 12.50 });
    const whole = createInterestState(card, 900, '2026-01-03');
    const split = createInterestState(card, 900, '2026-01-03');
    accrueInterest(whole, card, '2026-01-20');
    accrueInterest(split, card, '2026-01-09');
    accrueInterest(split, card, '2026-01-20');
    applyInterestPayment(whole, 123.45);
    applyInterestPayment(split, 123.45);
    accrueInterest(whole, card, '2026-03-05');
    for (const date of ['2026-01-30', '2026-02-01', '2026-02-17', '2026-03-01', '2026-03-05']) accrueInterest(split, card, date);
    close(split.balance, whole.balance);
    close(split.totalInterest, whole.totalInterest);
  }
});

test('daily simple loan interest remains separate from principal after a partial interest payment', () => {
  const card = { ...account('daily-simple'), apr: 36.5 };
  const state = createInterestState(card, 1000, '2026-01-01');
  close(accrueInterest(state, card, '2026-01-11').interest, 10);
  assert.equal(applyInterestPayment(state, 5), 5);
  assert.equal(state.principal, 1000);
  close(accrueInterest(state, card, '2026-01-21').interest, 10);
  close(state.balance, 1015);
});

test('monthly average balance uses actual cycle length and payments before that day accrues', () => {
  const card = account('milestone');
  const state = createInterestState(card, 1000, '2026-01-01');
  accrueInterest(state, card, '2026-01-16');
  applyInterestPayment(state, 300);
  accrueInterest(state, card, '2026-02-01');
  // 15 days at $1,000 and 16 days at $700, at a 2% monthly rate.
  close(state.totalInterest, 16.90);
  close(state.balance, 716.90);
  close(state.principal, 700);
});

test('monthly profiles distinguish prior billed interest from current-cycle accrual', () => {
  const excludedCard = account('credit-one', { knownUnpaidInterest: 50 });
  const excluded = createInterestState(excludedCard, 1000, '2026-01-01');
  accrueInterest(excluded, excludedCard, '2026-03-01');
  close(excluded.totalInterest, 38); // $950 principal × 2% for each cycle.
  const includedCard = account('milestone', { knownUnpaidInterest: 50 });
  const included = createInterestState(includedCard, 1000, '2026-01-01');
  accrueInterest(included, includedCard, '2026-03-01');
  close(included.totalInterest, 40.40); // $1,000 × 2%, then $1,020 × 2%.
});

test('a minimum interest charge is reserved once per statement and survives an early payoff', () => {
  const card = account('credit-one');
  const state = createInterestState(card, 10, '2026-01-01');
  accrueInterest(state, card, '2026-01-02');
  close(state.balance, 11);
  close(applyInterestPayment(state, 11), 11);
  accrueInterest(state, card, '2026-03-01');
  close(state.balance, 0);
  close(state.totalInterest, 1);
  const zeroRate = { ...card, apr: 0 };
  const zero = createInterestState(zeroRate, 10, '2026-01-01');
  close(accrueInterest(zero, zeroRate, '2026-03-01').interest, 0);
});

test('monthly minimum interest does not compound before statement close', () => {
  const card = account('milestone');
  const state = createInterestState(card, 20, '2026-01-01');
  accrueInterest(state, card, '2026-02-01');
  close(state.balance, 21);
  accrueInterest(state, card, '2026-03-01');
  close(state.balance, 22);
  close(state.totalInterest, 2);
});

test('closing-day calendars clamp short months without drifting and include leap days', () => {
  assert.deepEqual(interestCycleForDate('2028-02-29', 31), { start: '2028-02-01', end: '2028-02-29', days: 29 });
  assert.deepEqual(interestCycleForDate('2028-03-01', 31), { start: '2028-03-01', end: '2028-03-31', days: 31 });
  assert.deepEqual(interestCycleForDate('2026-02-17', 16), { start: '2026-02-17', end: '2026-03-16', days: 28 });
});

test('missing closing-day/history assumptions are visible and never add interest before the balance date', () => {
  const card = account('credit-one', { closingDay: null });
  const state = createInterestState(card, 500, '2026-01-20');
  const result = accrueInterest(state, card, '2026-01-20');
  assert.equal(result.balance, 500);
  assert.equal(result.interest, 0);
  assert.equal(result.estimated, true);
  assert.match(result.notes.join(' '), /closing day is unknown/);
  assert.match(result.notes.join(' '), /earlier unbilled interest is not reconstructed/);
});

test('grace requires explicit bounded eligibility and never exempts cash advances', () => {
  const card = { ...account('capital-one', { grace: 'active', graceThrough: '2026-01-15' }), apr: 36.5 };
  const state = createInterestState(card, 1000, '2026-01-01');
  close(accrueInterest(state, card, '2026-01-16').interest, 0);
  close(accrueInterest(state, card, '2026-01-17').interest, 1);
  const cashCard = { ...card, interestRules: { ...card.interestRules, balanceType: 'cash' } };
  const cash = createInterestState(cashCard, 1000, '2026-01-01');
  close(accrueInterest(cash, cashCard, '2026-01-02').interest, 1);
  const unbounded = account('capital-one', { grace: 'active' });
  assert.ok(accrueInterest(createInterestState(unbounded, 1000, '2026-01-01'), unbounded, '2026-01-02').interest > 0);
});

test('Affirm requires a known principal basis and does not guess an account APR', () => {
  assert.equal(normalizeInterestRules({ interestRules: { profileId: 'affirm' } }).balanceBasis, 'unknown');
  for (const balanceBasis of ['unknown', 'scheduled-total']) {
    const card = { apr: 30, interestRules: { profileId: 'affirm', balanceBasis } };
    const state = createInterestState(card, 600, '2026-01-01');
    const result = accrueInterest(state, card, '2027-01-01');
    assert.equal(result.interest, 0);
    assert.equal(result.balance, 600);
    assert.equal(result.estimated, true);
  }
  const noApr = { interestRules: { profileId: 'affirm', balanceBasis: 'principal' } };
  assert.equal(accrueInterest(createInterestState(noApr, 600, '2026-01-01'), noApr, '2026-02-01').interest, 0);
});

test('the finance-charge cap limits new loan interest independently of payments', () => {
  const card = { apr: 36.5, interestRules: { profileId: 'affirm', balanceBasis: 'principal', financeChargeCap: 5 } };
  const state = createInterestState(card, 1000, '2026-01-01');
  close(accrueInterest(state, card, '2026-01-21').interest, 5);
  applyInterestPayment(state, 3);
  close(accrueInterest(state, card, '2026-02-01').interest, 0);
  close(state.balance, 1002);
});

test('explicit rate changes apply on their effective date without changing old accrual', () => {
  const card = { apr: 12, interestRules: { profileId: 'milestone', closingDay: 31, grace: 'lost', aprChanges: [{ date: '2026-01-16', apr: 24 }] } };
  const state = createInterestState(card, 1000, '2026-01-01');
  accrueInterest(state, card, '2026-02-01');
  close(state.totalInterest, 15.16);
});

test('only explicitly dated fees are added, once, including short-month repeat dates', () => {
  const card = { apr: 0, interestRules: { profileId: 'credit-one', closingDay: 31,
    fixedFees: [{ id: 'explicit-fee', date: '2026-01-31', amount: 7, repeat: 'monthly' }] } };
  const state = createInterestState(card, 0, '2026-01-01');
  assert.equal(accrueInterest(state, card, '2026-01-31').fees, 0);
  assert.equal(accrueInterest(state, card, '2026-02-01').fees, 7);
  assert.equal(accrueInterest(state, card, '2026-02-01').fees, 0);
  assert.equal(accrueInterest(state, card, '2026-03-01').fees, 7);
  assert.equal(state.balance, 14);
  const defaultCard = account('credit-one');
  assert.equal(accrueInterest(createInterestState(defaultCard, 100, '2026-01-01'), defaultCard, '2027-01-01').fees, 0);
});

test('minimum formulas preserve documented rounding and cap payment at the debt', () => {
  assert.equal(estimateMinimumPayment({ minimumRules: { profileId: 'credit-one' } }, 611.11), 31);
  assert.equal(estimateMinimumPayment({ minimumRules: { profileId: 'credit-one' } }, 200, { lateFee: 5, pastDue: 10 }), 45);
  assert.equal(estimateMinimumPayment({ minimumRules: { profileId: 'milestone' } }, 811), 41);
  assert.equal(estimateMinimumPayment({ minimumRules: { profileId: 'elga-card' } }, 2200.25), 44.01);
  assert.equal(estimateMinimumPayment({ minimumRules: { profileId: 'credit-one' } }, 12.34), 12.34);
  assert.equal(estimateMinimumPayment({ monthlyMinimum: 43, minimumRules: { profileId: 'saved' } }, 100), 43);
  assert.equal(estimateMinimumPayment({ monthlyMinimum: 43, minimumRules: { profileId: 'installment' } }, 20), 20);
  assert.equal(estimateMinimumPayment({ min: 30 }, 100), 65);
});

test('invalid dates fail safely and forecast operations never mutate account inputs', () => {
  const card = account('capital-one');
  const original = JSON.stringify(card);
  assert.throws(() => createInterestState(card, 1000, '2026-02-30'));
  const state = createInterestState(card, 1000, '2026-01-10');
  assert.throws(() => accrueInterest(state, card, '2026-01-09'));
  accrueInterest(state, card, '2026-01-20');
  applyInterestPayment(state, 100);
  assert.equal(JSON.stringify(card), original);
  assert.equal(INTEREST_PROFILES['capital-one'].method, 'daily-compound');
});
