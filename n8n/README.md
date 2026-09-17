# n8n workflows

These four workflows already exist on n8n.utomat.com (created from this spec, using the Gmail credential). The JSON files here are a backup for re-import. Live ids: monitor `WQxlhrdg66XUcxAg`, daily summary `rhLRzA5iZcXD0rWo`, notify `BGFBxroJkmoFOKRc` (published), brief `i7EdkHwH5iSn4LGO`.

Import these JSON files into n8n (n8n.courseadvisor.ai). Approvals, alerts and summaries go by email. Set these n8n variables:

- `ADPILOT_WORKER_URL` (e.g. `https://adpilot.internal:8787`)
- `ADPILOT_API_KEY` (matches `WORKER_API_KEY` in the worker `.env`)
- `ADPILOT_EMAIL_TO` (Mario's inbox)
- `ADPILOT_EMAIL_FROM`

Attach an SMTP credential to every "Email" node after import.

| File | Trigger | What it does |
|---|---|---|
| `monitor-every-3h.json` | Cron `0 */3 * * *` | `GET /monitor`, emails you if any rule fired |
| `daily-summary-0800-cyprus.json` | Cron `0 8 * * *` in `Asia/Nicosia` | `GET /report/daily`, one email per brand |
| `notify-webhook.json` | Webhook `POST /webhook/adpilot-notify` | Emails worker notifications (approval needed, rule triggered, publish failed, kill). Put its URL in `N8N_NOTIFY_WEBHOOK_URL` |
| `slack-kill-command.json` | Webhook `POST /webhook/adpilot-kill` (Slack slash command `/adkill`) | Optional. Calls `POST /kill` with `brand=all` or the slash command argument. The dashboard button is the primary kill switch |
| (live only) AdPilot weekly briefs | Schedule Monday 09:00 Cyprus | `GET /brands`, then `POST /brief` per active brand with 7 x daily cap as the run budget |
| `brief-webhook.json` | Webhook `POST /webhook/adpilot-brief` | Forwards a brief JSON to `POST /brief` (use for weekly scheduled briefs) |

Test the kill switch monthly from the dashboard button (or `/adkill` if you wire the Slack command).
