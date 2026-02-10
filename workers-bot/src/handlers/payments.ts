import {
  logConversation,
  getOrCreateUser,
  applySuccessfulPayment,
} from "../db/repositories";
import {
  PAYMENT_CURRENCY,
  PAYMENT_PACKAGES,
  PAYMENT_PACKAGE_ORDER,
} from "../types/domain";
import type { Env } from "../types/env";
import { TelegramClient } from "../telegram/client";
import { YooKassaService } from "../services/yookassa";
import type { PaymentWebhookEvent } from "../types/providers";

export function buyTokensKeyboard(packageToUrl: Record<string, string>) {
  return {
    inline_keyboard: [
      ...PAYMENT_PACKAGE_ORDER.map((packageId) => {
        const packageInfo = PAYMENT_PACKAGES[packageId];
        return [{ text: `💰 ${packageInfo.rub}₽ → ${packageInfo.balance} токенов`, url: packageToUrl[packageId] }];
      }),
      [{ text: "🔙 Назад", callback_data: "balance" }],
    ],
  };
}

export async function showBuyTokensMenu(env: Env, telegram: TelegramClient, userId: number, chatId: number): Promise<void> {
  const yookassa = new YooKassaService(env);
  if (!yookassa.hasCredentials()) {
    await telegram.sendMessage(chatId, "❌ Оплата временно недоступна. Напишите в поддержку.");
    return;
  }

  const urlMap: Record<string, string> = {};
  for (const packageId of PAYMENT_PACKAGE_ORDER) {
    const payment = await yookassa.createSbpPayment(packageId, userId);
    const confirmationUrl = payment.confirmation?.confirmation_url;
    if (!payment.id || !confirmationUrl) {
      throw new Error(`YooKassa response missing id/confirmation_url for package ${packageId}`);
    }
    urlMap[packageId] = confirmationUrl;

    await logConversation(env.DB, {
      telegramUserId: userId,
      feature: "payment",
      messageType: "sbp_payment_created",
      content: `package=${packageId}`,
      metadata: { payment_id: payment.id },
    });
  }

  await telegram.sendMessage(
    chatId,
    "💳 *Покупка токенов*\n\n" +
      "🎨 Генерация изображения — 25 токенов\n\n" +
      "Выберите подходящий пакет:\n\n" +
      "• 100₽ — 100 токенов\n" +
      "• 300₽ — 325 токенов (+25 бонус)\n" +
      "• 1000₽ — 1100 токенов (+100 бонус)\n" +
      "• 3000₽ — 3500 токенов (+500 бонус)\n" +
      "• 5000₽ — 6000 токенов (+1000 бонус)",
    {
      parse_mode: "Markdown",
      reply_markup: buyTokensKeyboard(urlMap),
    },
  );
}

export async function sendPackagePaymentLink(
  env: Env,
  telegram: TelegramClient,
  userId: number,
  chatId: number,
  packageId: string,
): Promise<void> {
  const packageInfo = PAYMENT_PACKAGES[packageId];
  if (!packageInfo) {
    await telegram.sendMessage(chatId, "❌ Не удалось определить пакет для оплаты.");
    return;
  }

  const yookassa = new YooKassaService(env);
  if (!yookassa.hasCredentials()) {
    await telegram.sendMessage(chatId, "❌ Оплата временно недоступна. Напишите в поддержку.");
    return;
  }

  const payment = await yookassa.createSbpPayment(packageId, userId);
  const paymentId = payment.id;
  const confirmationUrl = payment.confirmation?.confirmation_url;
  if (!paymentId || !confirmationUrl) {
    throw new Error("YooKassa response missing id/confirmation_url");
  }

  await logConversation(env.DB, {
    telegramUserId: userId,
    feature: "payment",
    messageType: "sbp_payment_created",
    content: `package=${packageId}`,
    metadata: { payment_id: paymentId },
  });

  await telegram.sendMessage(
    chatId,
    `💳 *Оплата*\\n\\nПакет: *${packageInfo.rub}₽ → ${packageInfo.balance} токенов*`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "⚡ Оплатить", url: confirmationUrl }],
          [{ text: "🔙 Назад", callback_data: "buy_tokens" }],
        ],
      },
    },
  );
}

function amountToKopecks(value: string): number {
  return Math.round(Number(value) * 100);
}

function packageByAmountKopecks(amount: number): string | null {
  for (const [packageId, pkg] of Object.entries(PAYMENT_PACKAGES)) {
    if (pkg.rub * 100 === amount) {
      return packageId;
    }
  }
  return null;
}

export async function handleYooKassaWebhook(env: Env, payload: PaymentWebhookEvent): Promise<Response> {
  if (payload.event !== "payment.succeeded") {
    return new Response("ignored", { status: 200 });
  }

  const paymentId = payload.object?.id;
  if (!paymentId) {
    return new Response("bad request", { status: 400 });
  }

  const yookassa = new YooKassaService(env);
  const verified = await yookassa.getPayment(paymentId);
  const status = String((verified as any)?.status ?? "");
  if (status !== "succeeded") {
    return new Response("ignored", { status: 200 });
  }

  const metadata = ((verified as any)?.metadata ?? {}) as Record<string, string>;
  const packageId = metadata.package_id || null;
  const telegramUserId = Number(metadata.telegram_user_id);
  if (!packageId || !Number.isInteger(telegramUserId)) {
    return new Response("missing metadata", { status: 400 });
  }

  await getOrCreateUser(env.DB, telegramUserId);

  const amountObj = (verified as any)?.amount;
  const amountKopecks = amountToKopecks(String(amountObj?.value ?? "0"));
  const resolvedPackage = PAYMENT_PACKAGES[packageId] ? packageId : packageByAmountKopecks(amountKopecks);
  if (!resolvedPackage) {
    return new Response("unknown package", { status: 400 });
  }

  const balanceAdded = PAYMENT_PACKAGES[resolvedPackage].balance;
  const amount = amountKopecks || PAYMENT_PACKAGES[resolvedPackage].rub * 100;

  const newBalance = await applySuccessfulPayment(env.DB, {
    telegramUserId,
    providerPaymentChargeId: paymentId,
    telegramPaymentChargeId: `sbp:${paymentId}`,
    payload: `balance_topup:${resolvedPackage}:${telegramUserId}`,
    currency: String(amountObj?.currency ?? PAYMENT_CURRENCY),
    amount,
    balanceAdded,
    status: "paid",
  });

  const telegram = new TelegramClient(env);
  if (newBalance !== null) {
    await telegram.sendMessage(
      telegramUserId,
      `✅ Баланс пополнен на ${balanceAdded}. Текущий баланс: ${newBalance}.`,
    );

    await logConversation(env.DB, {
      telegramUserId,
      feature: "payment",
      messageType: "successful_sbp_payment",
      content: `package=${resolvedPackage}`,
      metadata: {
        provider_payment_charge_id: paymentId,
        total_amount: amount,
        currency: String(amountObj?.currency ?? PAYMENT_CURRENCY),
        balance_added: balanceAdded,
      },
    });
  }

  return new Response("ok", { status: 200 });
}
