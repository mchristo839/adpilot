# Getting started (Mario's checklist)

What is already done for you:

- Code is on GitHub: `mchristo839/adpilot`, branch `claude/funny-cerf-1z4dqd`.
- Supabase schema is applied to the **lead-getter** project (`https://ztpkbgngcnapbvyfeanb.supabase.co`). The eight AdPilot tables sit in its `public` schema with row level security on. Nothing else in that project was touched.
- Four n8n workflows exist on `n8n.utomat.com` in your personal project, using your Gmail credential to email `mario@utomat.com`:
  - **AdPilot notify (email)**: published. Production URL `https://n8n.utomat.com/webhook/adpilot-notify`.
  - **AdPilot monitor every 3h**, **AdPilot daily summary 08:00 Cyprus**, **AdPilot brief webhook**: created, not yet published. Each needs the worker URL and an API key credential (steps 4 and 6).

What you do, in order. Steps 1 to 3 take the longest and gate everything else.

## 1. Meta (about 30 minutes)

1. In the Business Manager that owns the three ad accounts, go to business.facebook.com > Settings > Apps > Add > Create new app. Type: Business. Name it "AdPilot".
2. In the app dashboard, add the **Marketing API** product. Leave the app in Development mode.
3. Business Settings > Users > **System Users** > Add. Name "adpilot", role Admin.
4. On that system user: **Assign assets**. Add all three ad accounts (full control) and all three Pages (full control).
5. **Generate new token** for the AdPilot app with scopes `ads_management`, `ads_read`, `business_management`, `pages_read_engagement`, `pages_manage_ads`, `instagram_basic`. Copy the token once, it is not shown again.
6. Write down for each brand: ad account id (`act_...`, from Ads Manager URL), Page id (Page > About), Instagram actor id (Business Settings > Instagram accounts) and Pixel id (Events Manager). CallCrewHQ can leave the pixel blank for now.
7. Ads Manager > Account settings: set a **spend cap** on each account (for example 400 USD, 400 EUR, 300 AUD). This is the outer safety net the code never touches.
8. Note the Business Manager id (Business Settings > Business info).

## 2. Secrets you have to paste

Copy `.env.example` to `.env` on the machine that runs the worker and fill:

| Variable | Where it comes from |
|---|---|
| `META_SYSTEM_TOKEN`, `META_BUSINESS_ID` | step 1 |
| `CALLCREWHQ_AD_ACCOUNT_ID`, `CALLCREWHQ_PAGE_ID`, `CALLCREWHQ_IG_ID`, `CALLCREWHQ_PIXEL_ID` and the same for `CLEARCYPRUS_` and `GREASETRAPQUOTES_` | step 1.6 (used by `pnpm seed-brands`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard > lead-getter > Project Settings > API keys > service_role. `SUPABASE_URL` is already filled in |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `FAL_KEY` | fal.ai dashboard (only needed for photo creatives, template creatives work without it) |
| `AIRTABLE_TOKEN` | airtable.com/create/tokens with read scope on base `appZxzHV1ywNbLKtS` (ClearCyprus creative queue) |
| `WORKER_API_KEY` | make one up: `openssl rand -hex 24`. n8n and the dashboard send it as `x-api-key` |
| `N8N_NOTIFY_WEBHOOK_URL` | already filled: `https://n8n.utomat.com/webhook/adpilot-notify` |
| `DASHBOARD_URL`, `STORAGE_PUBLIC_URL` | your dashboard URL and `https://<worker host>/files` once deployed |
| `DRY_RUN` | leave `true` until you have run one dry-run campaign end to end |

## 3. First run on your laptop

```
git clone https://github.com/mchristo839/adpilot && cd adpilot
git checkout claude/funny-cerf-1z4dqd
pnpm install
pnpm verify-meta        # must print all three accounts and writes_allowed=true
pnpm seed-brands        # inserts the three brands, inactive
pnpm test               # 59 tests
pnpm dev:worker         # http://localhost:8787/health
pnpm dev:dashboard      # http://localhost:3000
```

Then in the dashboard, Brands page: check the ids, tick **Active** on GreaseTrapQuotes, save. New brief: GreaseTrapQuotes, 7 days, 70 AUD. Wait 1 to 3 minutes, review the creatives, approve some, click Approve and launch. In dry run this writes the whole Meta call sequence to `audit_log` without sending anything. Check the Audit rows in Supabase.

## 4. Worker on Contabo

```
git clone https://github.com/mchristo839/adpilot /opt/adpilot && cd /opt/adpilot
git checkout claude/funny-cerf-1z4dqd
cp .env.example .env && nano .env      # same values as step 2
docker compose up -d --build
curl localhost:8787/health
```

Put it behind your existing reverse proxy as `https://adpilot.<your domain>` pointing at `127.0.0.1:8787`. Example Caddy line:

```
adpilot.utomat.com { reverse_proxy 127.0.0.1:8787 }
```

Rendered images live in the `adpilot-storage` Docker volume and are served at `/files/...` for dashboard previews.

## 5. Dashboard on Vercel

Vercel refused to let me create the project through the API (permission error), so do it in the UI: vercel.com > Add New > Project > import `mchristo839/adpilot`. Settings: Root Directory `apps/dashboard`, framework Next.js, production branch `claude/funny-cerf-1z4dqd` (or merge to `main` first). Environment variables: `WORKER_URL=https://adpilot.<your domain>` and `WORKER_API_KEY=<same key as the worker>`. Deploy. Add Vercel password protection or keep the URL private, the dashboard has no login of its own.

## 6. Finish the n8n workflows (5 minutes)

Open each of the three unpublished workflows on n8n.utomat.com:

1. Click the HTTP Request node. Set the URL (`https://adpilot.<domain>/monitor`, `/report/daily`, `/brief`).
2. Credential: create one **Custom Auth (templated)** credential named "AdPilot Worker x-api-key" with template `{"headers":{"x-api-key":"{{api_key}}"}}` and `api_key` = your `WORKER_API_KEY`. Reuse it on all three nodes.
3. Daily summary: workflow Settings > Timezone > Asia/Nicosia.
4. Publish each one.

## 7. Go live, one brand at a time

1. Run a full dry-run campaign on GreaseTrapQuotes (step 3). Check `audit_log` shows the campaign, ad sets, creatives and ads with `dry_run=true`.
2. Set `DRY_RUN=false` in the worker `.env`, restart the container. `/health` shows `dry_run:false` and `writes_allowed:true`.
3. New brief: GreaseTrapQuotes, 10 AUD per day, 7 days. Approve. Check Ads Manager shows the campaign ACTIVE with the right budget.
4. Let the monitor run for two days. Read the 08:00 email.
5. Test the kill switch from the dashboard button. Everything pauses within seconds. Reactivate in Ads Manager if you want to continue.
6. Activate ClearCyprus, then CallCrewHQ.

## Notes

- CallCrewHQ runs the traffic objective (landing page views) until you have a working "demo booked" pixel event. When you do: Brands page, set Lead event to the event name, switch default objective to OUTCOME_LEADS, set max CPA 40.
- Caps: CallCrewHQ 15 USD/day, 300/month. ClearCyprus 15 EUR/day, 300/month, max CPA 15. GreaseTrapQuotes 10 AUD/day, 200/month, max CPA 1.50. All editable on the Brands page, every change is audited.
- Adding a brand: `pnpm add-brand --slug <slug>` or the Brands page form. New brands start inactive.
