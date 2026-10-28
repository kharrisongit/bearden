import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scenarioForecast, paydayEvents, forecastThrough, forecastTimeline, forecastBalanceOn,
} from '../public/income-model.mjs';

const start = '2026-10-28';
const household = {
  enabled: true, personalAccountId: 'plaid-own', billsAccountId: 'plaid-shared',
  personalAmount: 75500, spouseAmount: 75500,
  spouseStartDate: '2026-11-06', spouseRepeat: 'biweekly',
};
const accounts = [
  { id: 'plaid-own', type: 'depository', currency: 'USD', balance: 5872, include: true },
  { id: 'plaid-shared', type: 'depository', currency: 'USD', balance: 50000, include: true },
  { id: 'plaid-unrelated', type: 'depository', currency: 'USD', balance: 99999999, include: true },
];

function fixture() {
  const budgetItems = [
    { id: 1, label: 'Car Fuel', amount: 100 },
    { id: 2, label: 'Groceries', amount: 100 },
    { id: 3, label: 'Personal spending', amount: 25 },
  ];
  return {
    state: {
      startDate: '2026-11-06', takeHome: 1840.23, budgetItems,
      cards: [{ id: 1, name: 'Visa', balance: 10000, apr: 0, min: 25 }],
      checkedPaychecks: {},
    },
    schedule: [1, 2].map(paycheck => ({
      paycheck, date: paycheck === 1 ? '2026-11-06' : '2026-11-20',
      takeHomeThisCheck: 1840.23, bonusAmount: 0,
      budgetLineItemsThisCheck: structuredClone(budgetItems),
      accountBillsThisCheck: [{ id: 'household-contribution', name: 'Fixed Bills', amount: 75500, transfer: true }],
      extrasThisCheck: [], payments: [860.23], savingsByGoal: [],
    })),
  };
}

function personal(plan = fixture(), options = {}, bills = []) {
  return scenarioForecast(accounts, plan, bills, start, {
    household, scope: 'personal', length: 30, personalSpending: true, ...options,
  });
}

test('personal forecast retains spending money and deducts payday-funded Fixed Bills once', () => {
  const plan = fixture(), snapshot = structuredClone(plan);
  const result = personal(plan);
  // This fixture previously reproduced the screenshot's exact $3,680.46
  // income/outflow, -$696.28 low, and -$755 / +$755 payday pairs.
  assert.equal(result.opening, 5872);
  assert.equal(result.income, 368046);
  assert.equal(result.outgoing, 323046);
  assert.equal(result.endBalance, 50872);
  assert.equal(result.low, 5872);
  assert.deepEqual(result.rows.map(row => [row.name, row.delta, row.balance]), [
    ['Paycheck 1', 22500, 28372], ['Paycheck 2', 22500, 50872],
  ]);
  assert.ok(result.rows.every(row => row.fixedBillsTransfer === 75500));
  assert.equal(result.rows.reduce((sum, row) => sum + row.incoming, 0), result.income);
  assert.equal(result.rows.reduce((sum, row) => sum + row.outgoing, 0), result.outgoing);
  assert.equal(result.endBalance, result.opening + result.income - result.outgoing);
  assert.deepEqual(plan, snapshot);
});

test('full, minimum and no-debt modes preserve allowances and the same Fixed Bills obligation', () => {
  const plan = fixture();
  for (const [debtMode, perCheck, outgoing] of [
    ['full', 22500, 323046], ['minimum', 106023, 156000], ['none', 108523, 151000],
  ]) {
    const result = personal(plan, { debtMode });
    assert.deepEqual(result.rows.map(row => row.delta), [perCheck, perCheck], debtMode);
    assert.equal(result.income, 368046, debtMode);
    assert.equal(result.outgoing, outgoing, debtMode);
    assert.equal(result.endBalance, 5872 + 2 * perCheck, debtMode);
    assert.equal(result.low, 5872, debtMode);
  }
});

test('allowance labels and legacy names stay available while actual extras, savings and obligations still leave checking', () => {
  const plan = fixture();
  plan.schedule[0] = {
    ...plan.schedule[0], takeHomeThisCheck: 2000,
    budgetLineItemsThisCheck: [
      { label: 'Car Fuel', amount: 100 }, { label: 'Groceries', amount: 100 },
      { name: 'Personal spending', amount: 75 }, { label: 'Housing insurance', amount: 40 },
    ],
    extrasThisCheck: [{ label: 'Groceries top-up', amount: 25 }, { name: 'Unexpected gas repair', amount: 30 }],
    payments: [600], savingsByGoal: [{ contribution: 80 }],
  };
  const [payday] = paydayEvents(plan, '2026-11-06', '2026-11-06', { retainPersonalBudget: true });
  assert.equal(payday.allocations, 77500); // $40 obligations + $55 actual extras + $600 debt + $80 savings.
  const result = personal(plan, { length: 9 });
  assert.equal(result.rows[0].delta, 47000); // $2,000 less those allocations and $755 Fixed Bills.
  assert.equal(result.outgoing, 153000);
  assert.equal(result.endBalance, 52872);
  const [ordinaryPayday] = paydayEvents(plan, '2026-11-06', '2026-11-06');
  assert.equal(ordinaryPayday.allocations, 105000);
});

test('paydays beyond the stored schedule retain allowances and honor overrides, bonuses and actual extras', () => {
  const plan = fixture();
  plan.schedule = [];
  plan.state.takeHome = 1800;
  plan.state.paycheckOverrides = { 1: 2100 };
  plan.state.appliedBonuses = { 2: 300 };
  plan.state.budgetItems = [
    { id: 1, label: 'Groceries', amount: 100 }, { id: 2, label: 'Housing insurance', amount: 50 },
  ];
  plan.state.budgetItemOverrides = { 1: { 1: 200 }, 2: { 1: 75, 2: 80 } };
  plan.state.extraExpenses = {
    1: [{ label: 'Groceries top-up', amount: 20 }],
    2: [{ label: 'Unexpected fuel purchase', amount: 50 }],
  };
  const result = personal(plan, { debtMode: 'none' });
  assert.equal(result.income, 420000);
  assert.deepEqual(result.rows.map(row => row.delta), [125000, 121500]);
  assert.equal(result.outgoing, 173500);
  assert.equal(result.endBalance, 252372);
});

test('already-received transfers and checked paychecks are not deducted again', () => {
  const received = personal(fixture(), {
    household: { ...household, received: { 'own-transfer:2026-11-06': true } },
  });
  assert.deepEqual(received.rows.filter(row => row.type === 'income').map(row => row.delta), [98000, 22500]);
  assert.equal(received.outgoing, 247546);
  assert.equal(received.rows.find(row => row.type === 'transfer').delta, 0);

  const plan = fixture();
  plan.state.checkedPaychecks[1] = true;
  const checked = personal(plan);
  assert.deepEqual(checked.rows.map(row => [row.date, row.delta]), [['2026-11-20', 22500]]);
  assert.equal(checked.income, 184023);
  assert.equal(checked.outgoing, 161523);
  assert.equal(checked.endBalance, 28372);
});

test('only a posted transfer pair prevents another deduction from personal checking', () => {
  const credit = {
    transaction_id: 'transfer-in', account_id: 'shared', amount: -755,
    currency: 'USD', date: '2026-11-06', category: 'TRANSFER_IN', pending: false,
  };
  const debit = { ...credit, transaction_id: 'transfer-out', account_id: 'own', amount: 755, category: 'TRANSFER_OUT' };
  const run = transactions => scenarioForecast(accounts, fixture(), [], '2026-11-06', {
    household, scope: 'personal', personalSpending: true, length: 0, transactions,
  });
  const posted = run([credit, debit]);
  assert.equal(posted.rows.find(row => row.type === 'income').delta, 98000);
  assert.equal(posted.rows.find(row => row.type === 'transfer').bankMatched, true);
  assert.equal(posted.outgoing, 86023);
  for (const transactions of [[credit], [credit, { ...debit, pending: true }]]) {
    const unconfirmed = run(transactions);
    assert.equal(unconfirmed.rows.find(row => row.type === 'income').delta, 22500);
    assert.equal(unconfirmed.outgoing, 161523);
  }
});

test('personal and shared ledgers conserve money without using unrelated accounts or spouse pay as personal income', () => {
  const bills = [
    { id: 'rent', name: 'Rent', type: 'bill', date: '2026-11-10', amount: 150000, shared: true, covered: false },
    { id: 'phone', name: 'Personal phone', type: 'bill', date: '2026-11-12', amount: 2000, shared: false, covered: false },
  ];
  const plan = fixture();
  const run = scope => personal(plan, { scope }, bills);
  const own = run('personal'), shared = run('shared'), combined = run('combined');
  assert.equal(own.endBalance, 48872);
  assert.equal(shared.opening, 50000);
  assert.equal(shared.income, 302000);
  assert.equal(shared.outgoing, 150000);
  assert.equal(shared.endBalance, 202000);
  assert.equal(combined.endBalance, 250872);
  assert.equal(combined.endBalance, own.endBalance + shared.endBalance);
  assert.ok(!own.rows.some(row => row.type === 'contribution' || row.id === 'rent'));
  assert.ok(!shared.rows.some(row => row.type === 'income' || row.id === 'phone'));
});

test('real shortages remain visible when a paycheck cannot fund obligations or an actual bill is due first', () => {
  const plan = fixture();
  plan.schedule[0] = { ...plan.schedule[0], takeHomeThisCheck: 600, payments: [200] };
  const underfunded = personal(plan, { length: 9 });
  assert.equal(underfunded.rows[0].delta, -35500);
  assert.equal(underfunded.endBalance, -29628);
  assert.equal(underfunded.low, -29628);

  for (const date of ['2026-11-05', '2026-11-06']) {
    const bill = { id: 'bill', name: 'Actual bill', type: 'bill', date, amount: 10000, covered: false };
    const result = personal(fixture(), {}, [bill]);
    assert.equal(result.rows[0].id, 'bill');
    assert.equal(result.rows[0].balance, -4128);
    assert.equal(result.low, -4128);
  }

  const noIncome = { state: { startDate: '2026-11-06', takeHome: 0 }, schedule: [] };
  const transferOnly = personal(noIncome, { length: 9 });
  assert.equal(transferOnly.endBalance, -69628);
  assert.equal(transferOnly.rows[0].type, 'transfer');
});

test('selected-day totals and graph match the consolidated personal paycheck ledger', () => {
  const result = personal();
  const before = forecastThrough(result, '2026-11-05');
  assert.equal(before.rows.length, 0);
  assert.equal(before.endBalance, 5872);
  assert.equal(before.income, 0);
  const first = forecastThrough(result, '2026-11-06');
  assert.equal(first.rows.length, 1);
  assert.equal(first.income, 184023);
  assert.equal(first.outgoing, 161523);
  assert.equal(first.endBalance, 28372);
  assert.equal(first.low, 5872);
  assert.equal(forecastBalanceOn(forecastTimeline(result, start), first.end), first.endBalance);
  assert.deepEqual(forecastThrough(result, '2026-11-19').rows, first.rows);
  assert.deepEqual(forecastThrough(result, result.end), result);
});

test('personal forecasts without a shared account still retain allowances and pay their ordinary budget bills', () => {
  const plan = fixture();
  for (const row of plan.schedule) row.budgetLineItemsThisCheck.push({ label: 'Fixed Bills', amount: 755 });
  const result = scenarioForecast([accounts[0]], plan, [], start, { personalSpending: true });
  assert.deepEqual(result.rows.map(row => row.delta), [22500, 22500]);
  assert.equal(result.endBalance, 50872);
  assert.equal(result.outgoing, 323046);
});
