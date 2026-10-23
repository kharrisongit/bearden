# BearDen

A separate household finance app: cash, bills, paydays, debt, and savings in one responsive dashboard. The existing BearBudgeter repository is untouched.

## What works in this first version

- Manual accounts, recurring bills, weekly/biweekly/monthly take-home pay, and one-time bonuses.
- Date-by-date cash forecasting (30 days to one year), including shortfalls before payday and overdue one-time bills.
- Monthly debt minimums, estimated interest, Snowball, Avalanche, Squasher with an explicit Squash button, and Cushion Cascade.
- Savings goals and per-payday contributions. Future bills and minimums are reserved before savings and extra debt suggestions.
- Editable plans, paid-bill markers, JSON backup/import, device-only mode, and isolated sample data.
- Server-side Plaid Link, token exchange, accounts, paginated transaction sync, and connection removal.
- Owner-only Google sign-in; optional Gmail read-only consent; selected-sender email scanning and a bill review inbox.
- Background sync every six hours while the server is running. Each sender is scanned for messages from the last 90 days. Repeated message IDs are skipped.
- Encrypted server records, HttpOnly session cookies, OAuth state/PKCE, origin checks, optimistic save revision checks, and no third-party analytics.

**Live connections are not configured or verified yet.** The code has automated tests for planning, parsing, sync pagination, and access controls. Real bank and Gmail testing requires your credentials, consent, and a deployed server.

## Run locally

Install Node.js 24 or newer. No npm packages are required.

```sh
npm test
npm start
```

Open `http://localhost:3000`. Without server credentials, BearDen runs in manual browser-storage mode. Settings → Explore demo shows sample finances without overwriting your plan.

## Setup

### 1. Host the server

The connected version serves the dashboard and API from the **same HTTPS origin**. This avoids relying on third-party cookies on iPhone/Safari. Connect this GitHub repository to a Node or Docker host with automatic deploys from `main`.

- Runtime: Node 24; command: `node server.mjs`; health check: `/health`.
- Use one always-on instance and a **persistent writable disk** mounted at `DATA_DIR`.
- Never put the SQLite database on an ephemeral disk. It would disappear on redeploy.
- Never run multiple instances against separate local databases.
- Set `NODE_ENV=production` and the environment variables in `.env.example` through the host's secret/environment settings. Do not commit the populated `.env`.
- Generate `DATA_KEY` once using the command in `.env.example`. Retain the same key across redeploys; back it up separately. Losing it makes encrypted data unreadable.
- Set `APP_URL` to the public HTTPS origin, with no path, and `ALLOWED_EMAIL` to your Google account address. Only that verified account can access the server data.
- The included `render.yaml` describes a paid starter service with a 1 GB persistent disk. Review the host's charges before deploying it. Nothing has been provisioned by adding this file.

Render's free web service does not provide the always-on, persistent-disk setup required here. A different host with those capabilities also works.

### 2. Configure Google sign-in and Gmail

1. In Google Cloud, create a project and enable the Gmail API.
2. Configure the OAuth consent screen for your personal app. Begin with your account as a test user.
3. Create an OAuth client of type **Web application**. Register the exact redirect URI:
   `https://YOUR-HOST/auth/google/callback`
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `ALLOWED_EMAIL` on the host.
5. Open BearDen, sign in with Google, then choose Connect Gmail. Sign-in alone requests only identity/email; Gmail permission is requested separately.
6. In Settings, paste the **full From email address** from each real bill email. Start with Consumers Energy. Sender addresses are deliberately not guessed.
7. Choose Sync connections. Review imported candidates before adding them as bills.

Gmail's read-only scope covers the mailbox; BearDen enforces selected senders in both the query and exact From-address comparison. It cannot send, edit, or delete email. It stores the refresh token, message IDs, a short snippet, and extracted candidates; it does not retain full bodies or download attachments. Bill emails are never sent to an AI provider.

Google OAuth apps in Testing generally get seven-day refresh tokens for Gmail. Complete the appropriate personal-use production configuration before expecting unattended ongoing syncing. Personal-use verification exceptions may apply, but this app does not bypass Google's requirements. Reconnect when consent is revoked or expired. Disconnect Gmail revokes the Google grant, which can also affect other granted scopes for this OAuth client.

### 3. Configure Plaid

1. Create or use your Plaid developer account. Start with Sandbox.
2. Set `PLAID_CLIENT_ID`, `PLAID_SECRET`, and `PLAID_ENV=sandbox` on the host.
3. Register `https://YOUR-HOST/plaid-return` in the Plaid dashboard and set `PLAID_REDIRECT_URI` to that exact URL for OAuth bank flows.
4. Sign in to BearDen and choose Connect bank. Test with Sandbox first. Sandbox is visibly labeled in the app.
5. After checking your account's real-data eligibility and bank support, switch the secret and environment to Production. Remove Sandbox connections first; tokens cannot be reused across environments.

Only USD depository checking accounts are automatically included in bill cash. Credit/loan balances are not spendable cash. Savings accounts and other imported accounts are excluded by default. Plaid balance data may be cached; "synced" is the time BearDen fetched it, not a guarantee that the bank has refreshed it. No balance-refresh add-on or money-transfer product is used.

### 4. Move a manual plan to the server

Export a backup before signing in. Signed-in server data is separate from browser-only data. After sign-in, import that backup to populate the server plan. Backups contain financial information; keep them private. A save conflict deliberately stops an overwrite: export unsaved changes, reload the latest server plan, then reapply/import the intended changes.

## GitHub Pages (manual mode)

The root `index.html` opens the dashboard in `public/`. If your GitHub plan supports Pages for this repository, select **Deploy from a branch → main → / (root)**. Pages cannot run the backend or background sync. A private repository does not automatically mean a private Pages website, and GitHub Free requires a public repository for Pages. This project has not changed the repository's visibility or enabled Pages.

For the connected app, use the server URL instead. GitHub remains the source of truth and your hosting provider can redeploy automatically after pushes.

## Planning rules and current limits

- All currency calculations use integer US cents. Amounts entered for pay and bonuses are **net/take-home**, not gross or tax estimates.
- Forecasts start from the entered/current cash snapshot; existing bank transactions are not deducted again.
- On the same date, bills precede deposits. Each payday reserves bills and debt minimums through the next payday, including that date, before suggesting allocations.
- Add groceries and other everyday spending as recurring bills/budget items. Expenses missing from the plan are not predicted.
- Planned debt/savings allocations are **suggestions**, not transfers. Update balances after real payments, and mark bills paid only after the cash snapshot reflects them.
- Squasher's half-balance suggestions apply to balances remaining after earlier scheduled minimums; future minimums stay reserved. It can deliberately leave surplus unallocated. Cushion Cascade uses the configured cushion × intensity (1.5 / 1 / 0.5) plus retained bonus money.
- Debt interest is a daily-simple estimate through the last forecast event, not a lender payoff quote. Minimums and APRs are manually maintained; Plaid Liabilities is not implemented.
- Email parsing is conservative: explicit amount-due labels and complete numeric/month-name due dates. Ambiguous fields, yearless dates, PDF-only bills, and links to provider portals require manual entry. Every candidate requires review; Gmail never silently overwrites a bill. Check for an existing bill for the same period before accepting reminders.
- Transactions are displayed, but automatic payment matching is **not yet implemented**. Duplicate payments are avoided by the cash-snapshot approach and explicit paid markers, not inferred from merchant names.
- Full BearBudgeter parity is not claimed: profile modes, its games/themes, gross bonus tax estimates, frozen completed-paycheck snapshots, arbitrary per-check overrides, and legacy backup migration remain separate future work. The four payoff strategies and core savings planning are included in the new engine.
- Email sync is polling, not instant push. It runs without a browser only while the host is awake. Sync failures appear in the connection status.
- This is a single-household, single-owner app. No automatic payments, transaction categorization, shared logins, or external alert delivery.

## Verification

```sh
npm test
```

Tests cover month-end recurrence, before-payday shortfalls, same-day ordering, paid/overdue bills, reserved obligations, capped minimums, strategy priority, savings limits, one-time bonuses, Squasher, Cushion Cascade, import validation, conservative email parsing, transaction pagination retries, idempotent pending/posted updates, and private endpoint protection.

## Provider references

- [Plaid Quickstart](https://plaid.com/docs/quickstart/)
- [Plaid Transactions Sync](https://plaid.com/docs/api/products/transactions/)
- [Google OAuth server flow](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Gmail message listing](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list)
- [GitHub Pages availability](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)
- [Render persistent disks](https://render.com/docs/disks)
