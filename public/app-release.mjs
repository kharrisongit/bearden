// Ship this manifest with each user-visible update. Never put private report text here.
export const APP_RELEASE = Object.freeze({
  id: '2026-11-06-payment-reconciliation-1',
  title: 'Payment tracking across email and bank accounts',
  notes: [
    'Debt cards show one current payment status. Linked receipts can match posted withdrawals even when the bank changes its payment description.',
    'Payment credits on linked credit cards and loans can confirm settlement alongside refreshed balances. Bills apply a matched withdrawal to the cycle identified by its receipt.'
  ],
  fixedReportIds: []
});
