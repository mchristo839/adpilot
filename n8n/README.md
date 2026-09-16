# n8n workflows

Import these JSON files into n8n (n8n.courseadvisor.ai). Each expects two credentials or variables:

- `ADPILOT_WORKER_URL` (e.g. `https://adpilot.internal:8787`)
- `ADPILOT_API_KEY` (matches `WORKER_API_KEY` in the worker `.env`)

Set them as n8n variables or edit the HTTP Request nodes.

| File | Trigger | What it does |
|---|---|---|
| `monitor-every-3h.json` | Cron `0 */3 * * *` | `GET /monitor`, posts a Slack message if any rule fired |
| `daily-summary-0800-cyprus.json` | Cron `0 8 * * *` in `Asia/Nicosia` | `GET /report/daily`, posts one Slack message per brand |
| `notify-webhook.json` | Webhook `POST /webhook/adpilot-notify` | Fans out worker notifications to Slack (and email if you add a node). Put its URL in `N8N_NOTIFY_WEBHOOK_URL` |
| `slack-kill-command.json` | Webhook `POST /webhook/adpilot-kill` (Slack slash command `/adkill`) | Calls `POST /kill` with `brand=all` or the slash command argument |
| `brief-webhook.json` | Webhook `POST /webhook/adpilot-brief` | Forwards a brief JSON to `POST /brief` (use for weekly scheduled briefs) |

Slack: create a slash command `/adkill` pointing at the kill webhook URL. Test it monthly.
