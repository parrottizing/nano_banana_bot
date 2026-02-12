# Nano Banana Workers Bot

Cloudflare Workers + D1 implementation of the Nano Banana Telegram bot.

## Endpoints

- `POST /telegram/webhook/:webhookSecret`
- `POST /webhooks/yookassa`
- `GET /healthz`

## Setup

1. Install dependencies:
   - `npm install`
2. Create D1 database and queue, then update `wrangler.toml` placeholders.
3. Apply migration:
   - `wrangler d1 execute nano-banana-bot --file=./migrations/0001_init.sql`
   - `wrangler d1 execute nano-banana-bot --file=./migrations/0002_user_receipt_email.sql`
   - `wrangler d1 execute nano-banana-bot --file=./migrations/0003_payment_webhook_events.sql`
4. Set secrets:
   - `wrangler secret put TELEGRAM_BOT_TOKEN`
   - `wrangler secret put TELEGRAM_WEBHOOK_SECRET`
   - `wrangler secret put TELEGRAM_WEBHOOK_HEADER_SECRET`
   - `wrangler secret put LAOZHANG_PER_REQUEST_API_KEY`
   - `wrangler secret put LAOZHANG_PER_USE_API_KEY`
   - `wrangler secret put YOOKASSA_SHOP_ID`
   - `wrangler secret put YOOKASSA_SECRET_KEY`
   - `wrangler secret put SUPPORT_USERNAME`
5. Run locally:
   - `npm run dev`
6. In YooKassa dashboard, configure webhook event `payment.succeeded` to:
   - `https://nano-banana-workers-bot.ripstik007.workers.dev/webhooks/yookassa`

## Notes

- Payments are webhook-confirmed (`payment.succeeded`) and idempotent via unique provider charge ID.
- Webhook observability is stored in `payment_webhook_events` (includes trigger source, stage, status, reason, payload snapshot).
- Automatic backup reconciliation runs from queue after payment-link creation at `5s`, `15s`, and `30s` (`trigger = auto_reconcile_queue`).
- Receipt email is collected from each user before creating payment links and reused for future payments.
- Long-running AI work runs through Cloudflare Queue consumer.
- Existing Python bot code remains untouched for rollback.

## Webhook Diagnostics

Use this query to find payments that were auto-recovered (credited by queue reconcile without a prior HTTP webhook hit):

```sql
SELECT p.provider_payment_charge_id AS payment_id,
       p.telegram_user_id,
       p.created_at AS credited_at
FROM payments p
WHERE EXISTS (
  SELECT 1
  FROM payment_webhook_events e
  WHERE e.payment_id = p.provider_payment_charge_id
    AND e.stage = 'credited'
    AND json_extract(e.request_meta_json, '$.trigger') = 'auto_reconcile_queue'
)
AND NOT EXISTS (
  SELECT 1
  FROM payment_webhook_events e
  WHERE e.payment_id = p.provider_payment_charge_id
    AND json_extract(e.request_meta_json, '$.trigger') = 'webhook_http'
)
ORDER BY p.created_at DESC;
```
