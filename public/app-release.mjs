// Ship this manifest with each user-visible update. Never put private report text here.
export const APP_RELEASE = Object.freeze({
  id: '2026-11-03-account-payment-reconciliation-1',
  title: 'Account sync and payment confirmation fixes',
  notes: [
    'Removed Lunch Flow accounts leave the active list, and verified reconnects retain account settings and links.',
    'Rent and insurance payments match posted bank activity more reliably and update bill cards and trackers.'
  ],
  fixedReportIds: []
});
