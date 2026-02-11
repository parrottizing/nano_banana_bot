import { updateUserBalance } from "./users";

export interface ApplyPaymentInput {
  telegramUserId: number;
  providerPaymentChargeId: string;
  telegramPaymentChargeId: string;
  payload: string;
  currency: string;
  amount: number;
  balanceAdded: number;
  status?: string;
}

export interface CreatedPaymentReference {
  telegramUserId: number;
  packageId: string;
}

interface PendingPaymentIdRow {
  payment_id: string | null;
}

function parsePackageIdFromContent(content: string | null | undefined): string | null {
  if (!content) {
    return null;
  }
  const match = content.match(/\bpackage=([a-zA-Z0-9_-]+)\b/);
  return match?.[1] ?? null;
}

export async function applySuccessfulPayment(db: D1Database, input: ApplyPaymentInput): Promise<number | null> {
  const existing = await db
    .prepare("SELECT id FROM payments WHERE provider_payment_charge_id = ?")
    .bind(input.providerPaymentChargeId)
    .first<{ id: number }>();
  if (existing) {
    return null;
  }

  await db
    .prepare(
      `INSERT INTO payments (
        telegram_user_id,
        provider_payment_charge_id,
        telegram_payment_charge_id,
        payload,
        currency,
        amount,
        balance_added,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.telegramUserId,
      input.providerPaymentChargeId,
      input.telegramPaymentChargeId,
      input.payload,
      input.currency,
      input.amount,
      input.balanceAdded,
      input.status ?? "paid",
    )
    .run();

  return await updateUserBalance(db, input.telegramUserId, input.balanceAdded);
}

export async function findCreatedPaymentReference(
  db: D1Database,
  providerPaymentChargeId: string,
): Promise<CreatedPaymentReference | null> {
  const row = await db
    .prepare(
      `SELECT telegram_user_id, content
       FROM conversations
       WHERE feature = 'payment'
         AND message_type = 'sbp_payment_created'
         AND json_extract(metadata_json, '$.payment_id') = ?
       ORDER BY id DESC
       LIMIT 1`,
    )
    .bind(providerPaymentChargeId)
    .first<{ telegram_user_id: number; content: string | null }>();

  if (!row) {
    return null;
  }

  const packageId = parsePackageIdFromContent(row.content);
  if (!packageId) {
    return null;
  }

  return {
    telegramUserId: row.telegram_user_id,
    packageId,
  };
}

export async function listRecentPendingPaymentIds(
  db: D1Database,
  telegramUserId: number,
  limit = 12,
): Promise<string[]> {
  const safeLimit = Math.max(1, Math.min(limit, 20));
  const rows = await db
    .prepare(
      `SELECT DISTINCT json_extract(c.metadata_json, '$.payment_id') AS payment_id
       FROM conversations c
       WHERE c.telegram_user_id = ?
         AND c.feature = 'payment'
         AND c.message_type = 'sbp_payment_created'
         AND c.timestamp >= datetime('now', '-1 day')
         AND json_extract(c.metadata_json, '$.payment_id') IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM payments p
           WHERE p.provider_payment_charge_id = json_extract(c.metadata_json, '$.payment_id')
         )
       ORDER BY c.id DESC
       LIMIT ?`,
    )
    .bind(telegramUserId, safeLimit)
    .all<PendingPaymentIdRow>();

  return (rows.results ?? [])
    .map((row) => row.payment_id)
    .filter((value): value is string => Boolean(value));
}
