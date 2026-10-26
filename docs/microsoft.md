# Microsoft sign-in and Hotmail / Outlook bill scanning

BearDen supports personal Microsoft accounts (Hotmail, Outlook.com and Live).
The user signs in with Microsoft directly. No Google account is required.
Microsoft sign-in creates a separate private profile, even when a Google profile
uses the same email address. Sign out first to start a new Microsoft profile;
connecting an inbox under Settings attaches that inbox to the current profile.

## One-time application setup

1. Open [Microsoft Entra app registrations](https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) and choose **New registration**. Name it BearDen. Select **Personal Microsoft accounts only** as the supported account type (or the option including both organizational and personal accounts). This implementation signs in personal accounts using the `consumers` authority.
2. Add a **Web** redirect URI, exactly:
   `https://bearden.kurtismharrison.workers.dev/auth/microsoft/callback`
   For another deployment use its `APP_URL` origin followed by `/auth/microsoft/callback`.
3. Under **API permissions**, add Microsoft Graph **Delegated** permissions:
   `User.Read` and `Mail.Read`. The authorization request also includes the
   OpenID identity scopes; `offline_access` is requested only when connecting
   an inbox. Do not add application permissions, Mail.Send or Mail.ReadWrite.
4. Under **Certificates & secrets**, create a client secret. Copy its **Value**
   (not the secret ID), and copy the **Application (client) ID** from Overview.
5. In Cloudflare → Workers & Pages → **bearden** → Settings → Variables and
   Secrets, add `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET` as secrets.
   Deploy the configuration. Keep the existing `APP_URL`, `DATA_KEY`, D1 binding,
   `ALLOWED_EMAIL` and Google credentials unchanged. Never post the secret in
   chat or commit it to GitHub. For local Node hosting, use these variables in
   an untracked `.env` file, with a separately registered localhost Web callback.
6. Reload BearDen. Choose **Sign in with Microsoft (Hotmail / Outlook)**. Then
   **Settings → Email accounts → Add Hotmail / Outlook account** and approve
   read-only access to start bill scanning. The same controls appear in setup.

The Microsoft buttons are enabled only when both Microsoft credentials and
private storage are configured. Google Cloud's test-user list applies to Google
OAuth; it does not enable or restrict this separate Microsoft flow. Microsoft
may enforce its own registration/consent policies. An Entra tenant and permission
to register applications are needed for the app owner, not each BearDen user.

## Behavior and limits

- Sign-in requests profile access only; reading mail requires separate consent.
- Each profile can connect up to five Microsoft inboxes in addition to Gmail.
- Microsoft Graph searches recent bill/payment mail (last 180 days, up to the
  service's 1,000-result search limit), with bounded batches and manual search.
  It reads message text, not attachments. Scanned amounts/dates use the same
  bill and payment parser and review controls as Gmail.
- Refresh tokens are encrypted in the profile's existing vault and rotated when
  Microsoft returns replacements. Access tokens and raw bodies are not stored
  or exposed in public state. Only parsed bill/payment fields are cached.
- Disconnect removes BearDen's stored refresh token and parsed mail for that
  inbox. It does not revoke unrelated Microsoft sessions. Users can also remove
  BearDen's consent through their Microsoft account's app permissions.
- OAuth state is single-use, time-limited and browser-bound, with PKCE. Connecting
  an inbox is also bound to the current BearDen session. Profile identity uses
  authenticated Graph `/me` IDs, never an email match or an unverified ID token.

## Validation

Automated tests cover private Microsoft profiles, state/PKCE, session binding,
permission denial, Gmail compatibility, read-only scanning, token rotation,
message selection, pagination, HTML mail, and disconnect. A real Microsoft
sign-in and consent check is still required after the deployment secrets are set.

References: [Register an app](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app),
[authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow),
[Graph delegated mail access](https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0),
[message search](https://learn.microsoft.com/en-us/graph/search-query-parameter).
