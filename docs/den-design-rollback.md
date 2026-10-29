# Den design and rollback

The design trial adds detailed tracker cards, a floating Overview / Den / Plan
dock, and a modal fan of section shortcuts. Existing financial calculations,
storage, accounts, integrations and editors continue to power both layouts.

## Switch layouts immediately

Open **Den → Settings → Design → Original design**. Choose **Den** in the same
control to try the new layout again. The selection is remembered on the device
under `bearden:design`; it is independent of financial and color preferences.

## Backup before this change

- Repository: `kharrisongit/bearden`
- Branch: `backup/pre-den-redesign-2026-10-28`
- Commit: `e097e975ecf569d5990fc0c7447d8a1cb2210952`

This backup includes the compact forecast PDF export. It contains source code,
not users' financial records. Do not move the backup branch forward.

For a deployment-wide rollback, revert the commit titled
`Add reversible Den dashboard and fan navigation` on `main`, then let the
existing Cloudflare deployment run. Prefer a normal revert over resetting the
branch so later work and history remain intact. No data migration is needed.

## Implementation and checks

`public/den-design.css` is scoped to `data-layout="den"`. The original CSS and
navigation remain available. `public/den-design.js` adds the presentation and
device preference. The existing dashboard emits its computed upcoming-payday
and contribution data; savings projections use the existing paycheck schedule.
Graphs are labeled as projections, not bank transaction history.

`test-ui/den-design.spec.mjs` checks the new default, all destinations, small and
large screens, light/dark modes, savings editing, and persistent rollback without
financial changes. Existing browser suites explicitly select the original
layout through `test-ui/original-design.fixture.mjs` to preserve its coverage.
