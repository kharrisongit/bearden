// Ship this manifest with each user-visible update. Never put private report text here.
export const APP_RELEASE = Object.freeze({
  id: '2026-11-04-rent-confirmation-timestamps-1',
  title: 'Rent payment confirmation fixed',
  notes: [
    'Posted rent payments now move to Paid when the bank and rent portal balances confirm them.',
    'Existing linked payments are rechecked automatically when you reopen BearDen.'
  ],
  fixedReportIds: []
});
