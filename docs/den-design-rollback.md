# Wallet design and rollback

The default Wallet layout uses a full-screen stack of destination cards, navy
Dashboard trackers, light Income / Bills / Debt summaries, and distinct white
bill, debt and paycheck cards. All financial calculations, storage, integrations,
account editors, forecasts, calendars, games and notes still use the original
application. There is no financial-data migration.

The complete editable paycheck schedule stays after the Income, Bills, Savings,
and Debt trackers on Dashboard. Wallet's Savings destination scrolls to those
goals; Your Den opens Tools, Settings and Connections. The original tab IDs and
public navigation function remain available to existing in-app actions.

## Switch layouts on a device

Open **Wallet → Your Den → Settings → Design → Original design**. Select
**Wallet — modern cards** in the same control to return. The device-only choice
uses the existing `bearden:design` key, independently of financial preferences.
Income's existing toolbar is moved back to its original location when switching.
Color, light/dark and holiday preferences remain available in Settings.

## Backup before the Wallet change

- Repository: `kharrisongit/bearden`
- Branch: `backup/pre-wallet-redesign-2026-10-29`
- Commit: `4e2cd4a5042c40baa81a95a5055926c68639fdb2`

This immutable source backup contains the prior Den design, not users' financial
records. For a deployment-wide rollback, revert the commit titled
`Implement Wallet UI across BearDen while preserving existing workflows` and let
the existing Cloudflare deployment run. Prefer a normal revert over resetting
`main` so subsequent work remains intact.

The earlier original-design backup is also retained at
`backup/pre-den-redesign-2026-10-28`, commit
`e097e975ecf569d5990fc0c7447d8a1cb2210952`.

## Presentation boundaries

`public/den-design.css` scopes the layout to `data-layout="den"`.
`public/den-design.js` manages the wallet, device preference, and read-only
summaries from the existing dashboard/paycheck outputs. It does not persist a
second copy of the financial plan. `public/tabs.js` adds presentation-only date
stamps and bill recurrence/funding labels using existing bill records; its data
and editor paths are unchanged. All added content is hidden in Original design.

Wallet figures are current computed summaries. Savings charts are labeled as
projections, and no data or example amounts from concept images are hard-coded.
The standalone total cards and unavailable-balance notices remain intact.

## Verification

`test-ui/den-design.spec.mjs` covers 320 / 390 / 1280 px, light/dark layouts,
all destinations, keyboard focus, short screens, live summary values, bill
paid/undo actions, bill/debt editors, savings editing, paycheck amount changes,
creditor quickviews, completion persisted across reload, and layout rollback
without altering financial data. Existing browser suites continue to use
`test-ui/original-design.fixture.mjs`; the full unit suite checks the shared
financial engines and integrations.
