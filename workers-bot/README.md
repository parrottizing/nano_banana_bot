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

## Notes

- Payments are webhook-confirmed (`payment.succeeded`) and idempotent via unique provider charge ID.
- Receipt email is collected from each user before creating payment links and reused for future payments.
- Long-running AI work runs through Cloudflare Queue consumer.
- Existing Python bot code remains untouched for rollback.
