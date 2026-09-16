# AdPilot

AI-driven Meta (Facebook and Instagram) ads automation with hard budget control. Single tenant. Runs on your own infrastructure and manages several brands from one Business Manager. Nothing goes live without a human approval. Spend can never exceed the configured caps.

## Safety first: dry run is the default

`DRY_RUN=true` is the default. In dry run every intended Meta write is logged to `audit_log` (with the full request body) and never sent. The whole pipeline, from brief to "launch", runs end to end and produces fake ids.

Only the literal value `DRY_RUN=false` turns real writes on. Two more gates apply even then:

- Rule 9: on boot the worker checks the token's granted scopes. Without `ads_management` real writes stay disabled.
- Rule 8: nothing calls a Meta write endpoint until the campaign row has `approved_by` and `approved_at`.

## Layout

```
apps/worker        Hono API plus monitor loop (TypeScript, Docker on Contabo)
apps/dashboard     Next.js review and reporting UI (Vercel)
packages/meta      thin Graph API client with retry, rate limit handling, DRY_RUN and spend_cap guard
packages/rules     pure budget rule functions plus unit tests (the point of the project)
packages/creative  Claude prompts, Playwright renderer, fal.ai client, Airtable queue reader
packages/db        Supabase client and row types
templates/         HTML ad templates per brand (_default is copied for new brands)
supabase/          migrations
scripts/           verify-meta.ts, seed-brands.ts, add-brand.ts
n8n/               workflow exports: monitor cron, daily summary, notify fan-out, Slack /adkill, brief webhook
```

## Setup

1. **Meta** (section 4 of the spec). Create a Business app, add Marketing API, create an admin System User, assign all ad accounts and pages, generate a token with `ads_management, ads_read, business_management, pages_read_engagement, pages_manage_ads, instagram_basic`. Set an account-level `spend_cap` in Ads Manager on every account. The code reads it and never writes it.
2. Copy `.env.example` to `.env` and fill in the values.
3. `pnpm install`
4. `pnpm verify-meta` reads `/me/adaccounts` and pages, prints scopes and spend caps. Fix anything it flags before continuing.
5. Apply `supabase/migrations/0001_init.sql` to your Supabase project (SQL editor or `supabase db push`). Row level security is on; only the service role key is used, from the worker and scripts.
6. `pnpm seed-brands` inserts CallCrewHQ, ClearCyprus and GreaseTrapQuotes as inactive. Meta ids come from env (`CALLCREWHQ_AD_ACCOUNT_ID` and so on, see the script header).
7. `pnpm test` runs the rule tests.
8. `pnpm dev:worker` and `pnpm dev:dashboard`. Or `docker compose up -d` for the worker on the VPS.
9. Import the `n8n/*.json` workflows, set the `ADPILOT_WORKER_URL`, `ADPILOT_API_KEY`, `ADPILOT_EMAIL_TO` and `ADPILOT_EMAIL_FROM` variables, attach an SMTP credential, and put the notify webhook URL into `N8N_NOTIFY_WEBHOOK_URL`.
10. Activate a brand from the dashboard Brands page when its ids are real and verify-meta passes.

## Core workflow

1. **Brief in**: dashboard form, `POST /brief`, or the n8n brief webhook (weekly per brand).
2. **Strategy**: one Claude call with brand config, stripped landing page and any queued Airtable concepts. Strict JSON. Claude recommends a budget; the rules clamp it.
3. **Creatives**: three primary texts, two headlines, a description, a CTA and an image spec per creative. Images render with Playwright from `templates/<brand>/*.html` at 1080x1080 and 1080x1920, or via fal.ai plus the brand's `photo-overlay.html`. Stored with status `draft`. Nothing is uploaded yet.
4. **Approval**: email with a link to the dashboard. Approve, reject, regenerate copy or image per creative. Then "Approve and launch".
5. **Publish** (idempotent, each step logged): upload images, create campaign (PAUSED, CBO daily budget in cents), ad sets per angle, creatives with UTM links, ads. Validation read, then flip everything to ACTIVE. Any failure leaves everything PAUSED and notifies.
6. **Monitor** every 3 hours via `GET /monitor`: insights snapshots, spend ledger, rules, creative rotation. Daily summary at 08:00 Cyprus time via `GET /report/daily`.

## Budget rules (packages/rules)

| # | Rule | Where enforced |
|---|---|---|
| 1 | Account `spend_cap` read every run, never written | `checkAccountSpendCap`, `assertNoSpendCapWrite` inside every Meta write |
| 2 | Monthly cap per brand, projection pauses the brand | `checkMonthlyCap` in the monitor |
| 3 | Sum of active daily budgets never above `daily_cap` | `checkDailyCap` at brief, at approval |
| 4 | Automated increases max 20 percent per 24h, never above daily cap | `clampBudgetChange` |
| 5 | CPA guard: 3-day CPA above max with 5+ results, or 3x max CPA with zero results | `checkCpaGuard` in the monitor |
| 6 | Runaway: today's spend above 1.5x daily budget pauses the campaign | `checkRunaway`, first rule in the monitor |
| 7 | Kill switch: `POST /kill {brand:"all"}` pauses everything in one request | `planKill`, dashboard button, optional Slack `/adkill` |
| 8 | Approval required for launches and increases; automation only pauses or reduces | `assertApproved`, `clampBudgetChange` |
| 9 | Token scope check on boot | `checkTokenScopes`, `MetaClient.assertWriteScopes` |
| 10 | Dry run default on | `isDryRun`, `MetaClient.write` |

Seed caps: CallCrewHQ USD 15/day, 300/month, CPA guard off until a lead event exists (it runs OUTCOME_TRAFFIC with landing page views for now). ClearCyprus EUR 15/day, 300/month, max CPA 15. GreaseTrapQuotes AUD 10/day, 200/month, max CPA 1.50 per click.

## API (worker, header `x-api-key`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/brief` | create a draft campaign, run strategy and creative generation |
| GET | `/campaigns`, `/campaigns/:id` | list, full draft with creatives and preview URLs |
| POST | `/campaigns/:id/creatives/:cid/regenerate` | `{ part: "copy" \| "image" }` |
| POST | `/campaigns/:id/creatives/:cid/status` | `{ status: "approved" \| "rejected" \| "draft" }` |
| POST | `/campaigns/:id/approve` | `{ creative_ids: [] }` publishes to Meta |
| POST | `/campaigns/:id/discard` | discard a draft |
| GET | `/monitor` | run the monitor loop for all active brands |
| POST | `/kill` | `{ brand: "all" \| "<id or slug>" }` |
| GET | `/report/daily?brand=` | daily summary payload; `&send=true` also pushes to the notify webhook |
| GET | `/brands`, POST `/brands`, PATCH `/brands/:id` | brand config; cap changes are audited |
| GET | `/audit` | recent audit log |
| GET | `/health` | mode and scope status, no auth |

## Adding a brand

`pnpm add-brand --slug <slug>` asks for every field, validates the ad account, page and pixel against Meta using the System User token, inserts the row with `active=false`, and copies `templates/_default/` to `templates/<slug>/`. The dashboard Brands page does the same with a form. New brands default to daily 10, monthly 200, no max CPA (CPA guard off until set). No brand names live in code outside seed data and templates.

## Build order and rollout

Follow section 10 of the spec: verify-meta, migrations and seed, read-only monitoring and daily summary first (zero write risk), rules with tests, then write endpoints behind dry run, creative pipeline, dashboard, one real campaign on GreaseTrapQuotes at 10 AUD per day, then rotation and CPA guard, then kill switch and the other brands.

## Out of scope for v1

Video creatives, lookalike and custom audience upload, landing page A/B tests, multi-user access, Google or TikTok ads, automated budget increases beyond the 20 percent rule.
