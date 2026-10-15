# KYVO

**TRAIN SMARTER. GET STRONGER.**

KYVO is a mobile-first fitness subscription web app built around one screen: the **Daily Plan**. Each day it tells the user what to train, what to eat, their calorie and protein targets, a checklist, and an end-of-day summary. Initial market: Australia (AUD pricing).

- Server: Node.js 22 + TypeScript, no framework, PostgreSQL with Row Level Security.
- Client: TypeScript single-page app (no framework) served from `/app`, plus server-rendered landing and legal pages.
- Payments: Stripe Checkout, Customer Portal and signed webhooks.
- Full delivery report, acceptance checklist and known limitations: [`docs/DELIVERY-REPORT.md`](docs/DELIVERY-REPORT.md).

---

## 1. Requirements

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22.5 or newer | ES modules, built-in test runner, `--env-file` |
| PostgreSQL | 14 or newer | Local install, Docker, or Supabase Postgres |
| npm packages | see `package.json` | Dev-only: `typescript`, `@types/node`, `eslint`, `playwright`. The app has **no runtime npm dependencies**. |

## 2. Local setup

```bash
npm install                       # dev tools only
cp .env.example .env              # then edit values (see section 3)

# 1. Create a database (example uses a local Postgres superuser).
createdb kyvo_dev

# 2. Build.
npm run build

# 3. Migrate with the OWNER connection. This creates the schema, the RLS policies
#    and a NOLOGIN role called kyvo_app that the app server will use.
DATABASE_ADMIN_URL=postgres://postgres:PASSWORD@127.0.0.1:5432/kyvo_dev npm run db:migrate

# 4. Let kyvo_app log in (pick your own password; it goes in DATABASE_URL).
psql postgres://postgres:PASSWORD@127.0.0.1:5432/kyvo_dev -c "alter role kyvo_app login password 'kyvo_app_dev'"

# 5. Load content: 170 exercises, exercise media, 93 foods, 39 recipes.
DATABASE_ADMIN_URL=postgres://postgres:PASSWORD@127.0.0.1:5432/kyvo_dev npm run db:seed

# 6. Run.
node --env-file=.env dist/src/server/main.js
# open http://localhost:3000  (landing)  and  http://localhost:3000/app  (the app)
```

Migrations and the seed are idempotent; re-run them after pulling new versions.

### Making someone an admin

Admin rights are **never** granted from an email address (emails are not verified). After the person has registered:

```bash
DATABASE_ADMIN_URL=postgres://... node dist/src/server/cli/make-admin.js person@example.com
```

The admin dashboard is at `/app#/admin` and every `/api/admin/*` route checks the role on the server.

## 3. Environment variables

All variables are listed with comments in [`.env.example`](.env.example). The server reads `process.env`; use `node --env-file=.env` locally or your host's settings in production.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Runtime connection as `kyvo_app` (non-owner, so RLS applies). |
| `DATABASE_ADMIN_URL` | for migrate, seed and make-admin | Owner connection. Do not set it on the app server. |
| `DATABASE_SSL` | hosted DBs | `require` for Supabase and most hosts. |
| `APP_BASE_URL` | yes in production | Public URL, used for Stripe return links. |
| `PORT` | no | Default 3000. |
| `NODE_ENV` | production | `production` turns on secure cookies and refuses a live Stripe key without a webhook secret. |
| `SESSION_DAYS` | no | Session length, default 30. |
| `AUTH_RATE_LIMIT` | no | Sign-in/sign-up attempts per IP and per email per 15 minutes, default 10. |
| `STRIPE_SECRET_KEY` | for payments | `sk_test_...` first. Without it, upgrade buttons explain that payments are not configured. |
| `STRIPE_WEBHOOK_SECRET` | for payments | `whsec_...` from the webhook endpoint. |
| `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL` | for payments | Stripe Price ids for A$9.99/month and A$79.99/year. |
| `STORAGE_DRIVER` | no | `local` (default) or `supabase`. |
| `STORAGE_DIR` | local driver | Directory for progress photos, default `./storage`. Must be persistent and backed up. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET` | supabase driver | Private bucket for photos. |
| `TIKTOK_PIXEL_ID` | no | Pixel loads only on public pages, only after consent. |
| `TEST_DATABASE_URL`, `TEST_DATABASE_ADMIN_URL` | tests | Default to a local `kyvo_test` database on port 5433. |

`GET /api/health` reports whether the database, Stripe and storage are configured.

## 4. Stripe

Use **test mode** until every check below passes.

1. In the Stripe dashboard (test mode), create a product "KYVO Premium" with two recurring prices in **AUD**: A$9.99 monthly and A$79.99 yearly. Put their ids in `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_ANNUAL`.
2. Add a webhook endpoint: `https://YOUR-DOMAIN/api/stripe/webhook`, with these events:
   - `checkout.session.completed`
   - `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`
   - `invoice.paid`, `invoice.payment_failed`
3. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
4. Turn on the Customer Portal (Settings, Billing, Customer portal) and allow cancellation and payment-method updates.
5. Decide GST handling with an accountant (Stripe Tax or tax-inclusive prices). The app shows prices as entered and makes no GST claim.
6. Local webhook testing: `stripe listen --forward-to localhost:3000/api/stripe/webhook` and use the printed `whsec_` value.

How it works: Premium is granted **only** from the `kyvo.subscriptions` table, which only verified webhooks write. Each event id is stored in `kyvo.billing_events` so duplicates are ignored, and older events never overwrite newer subscription state. A cancelled-at-period-end subscription keeps Premium until the period ends; `past_due` keeps it for a 3-day grace period; `unpaid`, `canceled` and `incomplete` end it.

Test checklist before going live (card `4242 4242 4242 4242`; failure `4000 0000 0000 0341`):
- Subscribe monthly and annually; Premium appears after the webhook arrives.
- Cancel in the portal; Premium remains until the period end.
- Failed renewal (use a test clock) shows the payment-problem notice.
- Delete the account; the Stripe subscription is cancelled.
- Re-send an event from the dashboard; nothing changes.

Then switch to live keys and a live webhook endpoint.

## 5. Progress photo storage

Photos are private: they are served only through `/api/photos/:id/image`, which checks the signed-in owner. Uploads must be JPEG, PNG or WebP (checked from the file bytes) and 5 MB or smaller.

- `local`: one server with a persistent disk (e.g. a Render/Railway volume, a VPS). Back the directory up.
- `supabase`: create a **private** bucket named `progress-photos` and set the three `SUPABASE_*` variables. The driver uses the Storage REST API with the service-role key on the server only. **It has not been tested against a real Supabase project yet.**

## 6. Deployment

Any Node 22 host works (Render, Railway, Fly.io, a VPS). Example:

1. Create a Postgres database (Supabase, Neon, RDS, or your host's managed Postgres).
2. Build command: `npm ci && npm run build`. Start command: `node dist/src/server/main.js`.
3. Set the variables from section 3 (with `NODE_ENV=production` and `APP_BASE_URL`).
4. Run `npm run db:migrate`, the `alter role` step and `npm run db:seed` once from a machine with `DATABASE_ADMIN_URL`, then `make-admin` for the operator.
5. Serve over HTTPS only (session cookies are `Secure` in production). Put the app behind the host's TLS.
6. Configure the Stripe webhook against the production URL (section 4).
7. Rate limiting is held in memory per process. Run a single instance, or add a shared limiter (e.g. at the proxy or with Redis) before scaling out.

### Backups

- Database: enable your provider's daily backups and point-in-time recovery; test a restore before launch.
- Photos: back up `STORAGE_DIR` or rely on Supabase Storage's durability plus a periodic export.
- Account deletion removes the user's rows and photo files; backups age out under your retention policy (state this in the privacy policy).

## 7. Commands

| Command | What it does |
|---|---|
| `npm run build` | Compiles server, client and tests into `dist/`. |
| `npm run typecheck` | TypeScript checks for server and client. |
| `npm run lint` | Strict typecheck (unused code), build, then ESLint over the compiled output and scripts. |
| `npm test` | Unit, integration and end-to-end tests (needs the test database and Playwright's Chromium). |
| `npm run db:migrate` / `npm run db:seed` | Database setup (needs `DATABASE_ADMIN_URL`). |
| `npm run preview` | Builds the self-contained browser preview into `dist/preview` (in-memory demo data, no server). |

### Running tests

```bash
createdb kyvo_test
# kyvo_app must be able to log in (migrations create it; set its password once):
psql .../kyvo_test -c "alter role kyvo_app login password 'kyvo_app_dev'"
export TEST_DATABASE_ADMIN_URL=postgres://postgres:PASSWORD@127.0.0.1:5432/kyvo_test
export TEST_DATABASE_URL=postgres://kyvo_app:kyvo_app_dev@127.0.0.1:5432/kyvo_test
npm run build && npm test
```

Tests migrate and seed the test database themselves and use a local mock of the Stripe API. End-to-end tests drive Chromium at phone size through Playwright.

## 8. Troubleshooting

| Symptom | Likely cause |
|---|---|
| `permission denied for schema kyvo` | `DATABASE_URL` is not `kyvo_app`, or migrations ran against a different database. |
| `password authentication failed for user "kyvo_app"` | The `alter role kyvo_app login password ...` step was skipped. |
| Premium page says payments are not switched on | `STRIPE_SECRET_KEY` or a price id is missing (`/api/health` shows `stripeConfigured`). |
| Paid but still Free | Webhook not reaching `/api/stripe/webhook`, or wrong `STRIPE_WEBHOOK_SECRET`. Check the admin dashboard's billing events and the Stripe dashboard's delivery log. |
| `429 Too many attempts` | Auth rate limit; wait 15 minutes or raise `AUTH_RATE_LIMIT`. |
| No exercises or recipes | `npm run db:seed` was not run. |

## 9. Project layout

```
src/core/      Pure logic shared by server, client and preview: targets, Daily Plan, meals, workouts, progression, plans
src/server/    HTTP server, routes (app.ts), services, Postgres client, CLI commands
src/client/    The SPA: screens, API client, preview (demo/) build
db/migrations/ Schema, RLS policies, grants
data/          Exercises, exercise media, foods, recipes (seed content)
public/        CSS, icons, manifest, local demo clips, data/figures.json (movement illustrations),
               data/photos.json + media/photos/ (Wikimedia Commons photos with credits)
scripts/figures/  Generator for the movement illustrations (python3 scripts/figures/build_figures.py)
legal/         Draft privacy policy, terms, subscription terms, disclaimer, contact (need legal review)
content/       TikTok content ideas
docs/          Delivery report, legal review checklist
tests/         unit/, integration/, e2e/
```
