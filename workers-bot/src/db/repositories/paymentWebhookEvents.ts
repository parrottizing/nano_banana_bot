export interface PaymentWebhookEventLogInput {
  stage: string;
  eventType?: string | null;
  paymentId?: string | null;
  httpStatus?: number | null;
  reason?: string | null;
  telegramUserId?: number | null;
  packageId?: string | null;
  amount?: number | null;
  currency?: string | null;
  balanceAdded?: number | null;
  payload?: Record<string, unknown> | null;
  verified?: Record<string, unknown> | null;
  requestMeta?: Record<string, unknown> | null;
}

export async function logPaymentWebhookEvent(db: D1Database, input: PaymentWebhookEventLogInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO payment_webhook_events (
        stage,
        event_type,
        payment_id,
        http_status,
        reason,
        telegram_user_id,
        package_id,
        amount,
        currency,
        balance_added,
        payload_json,
        verified_json,
        request_meta_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.stage,
      input.eventType ?? null,
      input.paymentId ?? null,
      input.httpStatus ?? null,
      input.reason ?? null,
      input.telegramUserId ?? null,
      input.packageId ?? null,
      input.amount ?? null,
      input.currency ?? null,
      input.balanceAdded ?? null,
      input.payload ? JSON.stringify(input.payload) : null,
      input.verified ? JSON.stringify(input.verified) : null,
      input.requestMeta ? JSON.stringify(input.requestMeta) : null,
    )
    .run();
}
