# BearDen

A personal finance app for debt payoff, paycheck budgets, bills, savings, and connected bank accounts.

[Open BearDen](https://bearden.kurtismharrison.workers.dev)

**Accounts** puts the payment calendar first, recent transactions next, and separate recurring-bill and debt collections below. **Add Account** offers a recurring bill (amount, category, due date, frequency) or a debt (starting balance, APR, per-paycheck minimum). The Income tab contains bank balances, income configuration, and the bill forecast; personal-spending charts live in Trackers. Budget configuration lives in Accounts. The Trackers cards have no Income or Accounts configuration buttons. Withholding estimates are editable private settings; existing take-home amounts and saved bonuses are preserved, and new bonuses accept after-tax amounts unless a bonus withholding estimate is entered.

**Add Account → Debt → Connect credit card with Plaid** uses Liabilities and Transactions. Existing bank connections can be reused in the same form. Connected debt cards show balances, credit utilization, APRs, statements, and posted payments. Schedule the issuer’s minimum and due date, supply clearly labeled estimates for missing fields, or match an existing tracker debt to avoid duplication. Payoff-plan balances remain separate from live issuer balances. Pending transactions and refunds are not treated as card payments.

**Baby Bear mode** is an owner-only income shortcut in Settings. It refills the hourly rate, hours, and take-home pay from an encrypted income snapshot when explicitly requested. The first valid saved income seeds the snapshot; later temporary edits do not replace it. No personal income figures are embedded in the source. It never imports debts, bills, budgets, or accounts, and leaves paycheck overrides, bonuses, and the existing start date intact. Papa Bear mode and the old account-preset import are retired. Existing saved accounts remain intact; bonuses are available without a mode.

Background sync rotates between institutions, checks balances/transactions about every six hours, and fetches Liabilities about daily. Manual card refresh targets the selected institution. Tokens remain encrypted server-side; errors retain the last successful details. All loaded outgoing transactions from the last 30 days appear in a collapsible, scrollable list. Personal spending is tracked separately and is not projected into the bill forecast.

Run `npm test` with Node 24 or newer. Tests cover card fields, payment classification, additional consent, private-data boundaries, forecast accounting, recurring-bill/debt separation, and the income-only preset. Mobile browser checks cover account creation, Plaid cancellation/return, existing-data preservation, and keyboard navigation.
