# BearDen

A personal finance app for debt payoff, paycheck budgets, bills, savings, and connected bank accounts.

[Open BearDen](https://bearden.kurtismharrison.workers.dev)

Credit cards can be connected in Settings with Plaid Liabilities and Transactions. Use **Enable card details** on an existing bank connection to reuse it, or **Connect credit card** for a new issuer. Plaid must enable both products for the app and support them for the institution; no plan upgrade is performed by BearDen.

Linked cards show balances, credit utilization, APRs, statements, and posted payments. **Add to Bills** tracks the current minimum and due date; missing details accept a clearly labeled manual estimate. Match an existing tracker debt or replace a manually tracked bill to avoid duplication. Card purchases stay in spending history; card payments are separate. A reported payment is not assumed to satisfy the current statement minimum.

Baby Bear and other tracker debt payments appear in the bill calendar on their planned payday, covered by the existing paycheck allocation. Matching a connected card replaces those calendar entries with its reported due date while preserving the debt plan. The live card balance is displayed separately from the payoff plan’s starting balance.

Background sync rotates between institutions, checks balances/transactions about every six hours, and fetches Liabilities about daily. Manual card refresh targets the selected institution. Tokens remain encrypted server-side; errors retain the last successful details. Transactions show all loaded outgoing entries from the last 30 days in a collapsible, scrollable list.

Run `npm test` with Node 24 or newer. Tests cover nullable card fields, payment classification, existing-connection consent, encrypted/public data boundaries, bill deduplication, forecast accounting, and Worker request limits.
