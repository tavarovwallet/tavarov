# Tavarov owner dashboard

The dashboard lives at `/admin/` on the wallet Pages project. Protect the dashboard and `/api/admin/stats` with one Cloudflare Access application that allows only the owner's email. Leave `POST /api/admin/events` outside the login gate so the wallet can report anonymous web events. Use the canonical wallet host, not a public Pages preview, to collect web events.

In the wallet Pages production environment, bind a D1 database as `ADMIN_STATS`, load `schema.sql`, and configure `ADMIN_STATS_START` as an ISO 8601 timestamp. Set `ADMIN_STATS_SALT` to a stable random secret. Set `ADMIN_OWNER_EMAIL`, `ADMIN_ACCESS_TEAM` (the team slug), and `ADMIN_ACCESS_AUD` (the Access application audience). The stats API validates the signed Access assertion and owner email. It rejects requests if auth is unconfigured.

The production deployment needs to use the current `www` and `functions` source together. The older `deploy-web` copy is not this source. Verify the published privacy notice describes anonymous web event collection before activating it.

Counts begin at the configured launch date. Confirmed API, Telegram, and web till invoices are separated into live and test. The dashboard counts first and second paid invoices for each pseudonymous merchant ID since launch. Legacy payment links and payments that originated before launch do not count. The timestamp is when the server observed confirmation. Ordinary wallet transfers are browser-reported submissions, not final confirmations. Browser-reported counters are estimates and contain no address, amount, transaction hash, or recovery material. To show visits and referral hosts in the dashboard, set `ADMIN_CF_ACCOUNT` and a server-side read-only `ADMIN_CF_ANALYTICS_TOKEN` scoped to that account. With no credentials or a failed query, the interface links to Cloudflare Web Analytics. Campaign-level UTM attribution is not yet collected.

Before enabling collection, verify access using the owner sign-in and an unauthenticated request. Confirm the wallet can create and send with telemetry disabled and that a repeated invoice confirmation produces only one event.

## Release and rollback

- Run `node tools/admin-stats/check.mjs` on Node 24 and compile the Pages Functions before deploy.
- On 2026-11-16, verified the wallet project's production deployment as `b4c760d7-868d-40ea-8397-2f2444b19aa0` and the marketing site's as `4d066883-9301-433c-8a96-5a225879b69c`. Re-read canonical deployment IDs immediately before future releases. These are the pre-feature points, not mandates to overwrite a newer deployment.
- Use Pages → Deployments → Rollback for the selected previous production deployment if wallet or checkout smoke checks fail after release. Verify the canonical ID and repeat checks for the wallet, payment page, merchant API auth and till. A preview branch is independent and does not change the production alias.
- A Pages rollback restores published code. An Access policy and D1 binding are independently configured. To stop new statistics writes, disable `ADMIN_STATS_START` (or remove the stats binding) and verify writes are disabled. Keep the database until a decision is made about its data; rolling back does not delete it.

Apply `history.sql` after the base schema. Run `node tools/admin-stats/sync-history.mjs` with an authorized Wrangler session to import retained invoice rows without replacing newer states. The date filter uses invoice creation time. Use `--traffic-only` to refresh the optional Web Analytics fallback snapshot. The dashboard shows the timestamp of a fallback snapshot.
