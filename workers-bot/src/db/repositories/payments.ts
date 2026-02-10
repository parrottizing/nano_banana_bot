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
