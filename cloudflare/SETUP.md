# Free BearDen hosting

Use **Cloudflare Workers Free + D1 Free**. The app, private API, database, and scheduled work live under one `workers.dev` address. No paid Render service, custom domain, always-on computer, or paid Cloudflare plan is needed for this design.

This is code ready for account setup, not an already provisioned service. Live Plaid/Gmail authorization and runtime quota testing remain required.

## What we can reuse from Ember

Ember's `js/cloud-saves.js` uses Firebase Google Authentication and Firestore (`lastdragonridergame`). Its save synchronization is browser-triggered. BearDen can reuse the same familiar Google sign-in experience and revision/conflict approach, but must keep its own OAuth client, database, and secrets. No Ember configuration, game saves, Firebase rules, or credentials have been changed or copied into BearDen.

Firebase's free browser authentication/database pattern alone does not run background Plaid/Gmail work. Firebase Cloud Functions requires the billing-enabled Blaze plan. Cloudflare supplies the server-side component without enabling a paid plan.

## Setup in your browser

### 1. Create the free database

1. Sign up/sign in at [Cloudflare](https://dash.cloudflare.com/sign-up). Stay on **Workers Free**.
2. Open **Storage & databases → D1 SQL Database → Create database**. Name it `bearden`.
3. Copy its database ID. This ID is not a secret. Replace `REPLACE_WITH_D1_DATABASE_ID` in the repo's `wrangler.jsonc` with it, or give the ID to your coding assistant to update that one setting.
4. Open the database's **Console** and run the contents of [`schema.sql`](schema.sql). The statements only create tables/indexes if missing; they do not delete data.

### 2. Deploy from GitHub

1. Open **Workers & Pages → Create application → connect/import Git repository**. Choose the private `kharrisongit/bearden` repo and authorize Cloudflare's GitHub connection for that repo.
2. Worker name: **bearden**. Production branch: **main**. Root: repository root.
3. No frontend build command is required. Deploy command: `npx wrangler@4.152.0 deploy`.
4. Deploy. Copy the assigned `https://bearden.YOUR-SUBDOMAIN.workers.dev` URL. The dashboard can work in manual mode before secrets are configured.
5. Subsequent pushes to `main` can deploy automatically through this Git connection.

### 3. Enter private server settings

In the Worker, open **Settings → Variables and Secrets** and use **Secret** for the following values. Do not add them to GitHub files or paste them into chat.

| Secret | Value |
|---|---|
| `APP_URL` | The exact HTTPS Worker origin, no trailing path |
| `ALLOWED_EMAIL` | Your Google account's email address |
| `DATA_KEY` | 32 cryptographically random bytes, base64 encoded; generate once and retain |
| `GOOGLE_CLIENT_ID` | Web application OAuth client ID from Google Cloud |
| `GOOGLE_CLIENT_SECRET` | That OAuth client's secret |
| `PLAID_CLIENT_ID` | Your Plaid client ID |
| `PLAID_SECRET` | Sandbox secret initially; Production secret only when eligible |
| `PLAID_REDIRECT_URI` | Your Worker origin plus `/plaid-return` |

`PLAID_ENV` is already `sandbox` in `wrangler.jsonc`. Update that file to `production` when ready for real bank data, then reconnect using Production credentials. Keeping the variable in the repo prevents a later deployment from silently reverting a dashboard-only change.

On your phone, open **your own deployed Worker URL + `/setup-key.html`**. Tap Generate, copy the key, and paste it into the Cloudflare secret field. The generator uses your browser’s cryptographic random generator, does not store the key, and makes no network calls. Save a private copy in your password manager.

Alternatively, generate `DATA_KEY` using a trusted local terminal:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Keep a private copy of the key separate from database backups. It is required to decrypt stored tokens and financial records after redeploys.

Add these as **runtime secrets**, not build logs or public browser variables. The deployment configuration deliberately contains no secrets. Set up production secrets only on the intended production Worker, not temporary preview deployments.

### 4. Google setup

1. Use a separate Google Cloud project for BearDen, enable the Gmail API, and configure the OAuth consent screen.
2. Create a **Web application** OAuth client. Register the exact redirect URL: `https://YOUR-WORKER/auth/google/callback`.
3. Start with your account as a test user. Sign in to BearDen, then choose Connect Gmail to grant read-only access separately from basic sign-in.
4. In BearDen, use Sync connections. Gmail automatically searches all senders for bill-related emails and adds clear upcoming bills; no sender list is needed.
5. For ongoing unattended sync, resolve Google's seven-day refresh-token limitation for apps left in Testing. Configure production/personal-use eligibility as appropriate; this code cannot bypass Google's policy.

The existing Google account can be reused. The game project's Firebase API key cannot replace the OAuth client secret or Gmail consent. BearDen needs its own authorization.

### 5. Plaid setup

1. Register `https://YOUR-WORKER/plaid-return` in the Plaid dashboard's allowed redirect URIs.
2. Connect a Sandbox bank first. Use Sync connections to start a small batch. Initial history may require multiple batches.
3. Verify your Plaid account's free Trial/real-data eligibility and ELGA support before switching to Production. Free Cloudflare hosting does not make every Plaid product or institution free/available.
4. Remove Sandbox connections before switching environments. Sandbox and Production access tokens are not interchangeable.

## Automatic work and limits

- A single Cron Trigger runs every 15 minutes, even with the browser closed. Propagation of new schedules can take several minutes.
- A trigger processes one bank page or up to three emails. Connected sources are normally refreshed approximately every six hours; backlogs continue in later batches. Manual Sync runs one additional batch.
- Plaid initial history requests 30 days; processing keeps up to 200 recent transactions per bank and 1,000 total. This is a recent-activity dashboard, not a permanent transaction archive.
- Gmail searches bill-related emails from all senders in the last 90 days. Clear upcoming bills are added automatically; unclear, past-due and card statements need review. At most 100 pending candidates are retained; review/dismiss them to allow more. Accepted candidates leave the queue when the plan saves. Full message bodies and attachments are not stored.
- A database lock prevents concurrent scheduled work and saves from overwriting one another. A busy save reports an error; reload/retry after sync completes. Revision checks protect against stale tabs.
- The personal adapter supports up to 10 bank connections, and a 250 KB plan. Free CPU, request, and database limits still apply; live runtime checks are required. Exceeding Free limits can interrupt service. Do not upgrade to a paid plan merely to finish setup.
- Worker secrets encrypt the private D1 records. Google refresh tokens and Plaid access tokens never go to the browser. The same owner-only sign-in and CSRF protections apply.
- The Node SQLite database and Cloudflare D1 use separate encrypted stores; moving hosting requires exporting/importing the plan and reconnecting providers. They are not binary-compatible database backups.
- No paid resources have been created. The old Render deployment configuration was removed to avoid accidental paid setup.

## Verification

`npm test` covers the original planner plus Worker authorization, encryption, OAuth state/PKCE, owner restrictions, D1 locking, save revisions, paginated bank staging, automatic bill discovery and reminder deduplication, and bounded Gmail batches. A Wrangler dry-run checks that the Worker and assets bundle successfully. Provider responses in automated tests are simulated; no live credentials are included.

## Official references

- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [D1 free allowances](https://developers.cloudflare.com/d1/platform/pricing/)
- [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [GitHub auto-deploy configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Create D1 through the dashboard](https://developers.cloudflare.com/d1/get-started/)
- [Firebase function billing](https://firebase.google.com/docs/functions/faq-and-troubleshooting)
