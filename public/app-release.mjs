// Ship this manifest with each user-visible update. Never put private report text here.
export const APP_RELEASE = Object.freeze({
  id: '2026-11-04-hidden-bank-accounts-1',
  title: 'Account visibility across BearDen',
  notes: [
    'Hiding a bank account in Settings also hides its transactions, balances, and provider details throughout BearDen.',
    'Plaid connection alerts now follow the accounts you choose to show.'
  ],
  fixedReportIds: []
});
