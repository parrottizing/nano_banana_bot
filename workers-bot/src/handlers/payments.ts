import {
  clearUserState,
  getUserState,
  getOrCreateUser,
  logConversation,
  setUserReceiptEmail,
  setUserState,
  applySuccessfulPayment,
  findCreatedPaymentReference,
  listRecentPendingPaymentIds,
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

const RECEIPT_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidReceiptEmail(input: string): boolean {
  const normalized = input.trim();
  return normalized.length > 0 && RECEIPT_EMAIL_REGEX.test(normalized);
}

function normalizeReceiptEmail(input: string): string {
  return input.trim();
}

async function promptForReceiptEmail(
  env: Env,
  telegram: TelegramClient,
  userId: number,
  chatId: number,
): Promise<void> {
  await setUserState(env.DB, userId, "payment", "awaiting_receipt_email", {});
  await telegram.sendMessage(
    chatId,
    "📧 Для оплаты нужен email для отправки чека.\n\n" +
      "Отправьте email текстом в этом чате.\n" +
      "Пример: name@example.com",
  );
}

async function resolveReceiptEmailForPayment(
  env: Env,
  telegram: TelegramClient,
  userId: number,
  chatId: number,
  providedEmail?: string,
): Promise<string | null> {
  if (providedEmail && isValidReceiptEmail(providedEmail)) {
    return normalizeReceiptEmail(providedEmail);
  }

  const user = await getOrCreateUser(env.DB, userId);
  const savedEmail = user.receipt_email ? normalizeReceiptEmail(user.receipt_email) : "";
  if (savedEmail && isValidReceiptEmail(savedEmail)) {
    return savedEmail;
  }

  console.error("Missing receipt email in payment flow", { userId });
  await promptForReceiptEmail(env, telegram, userId, chatId);
  return null;
}

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

export async function startBuyTokensFlow(env: Env, telegram: TelegramClient, userId: number, chatId: number): Promise<void> {
  const user = await getOrCreateUser(env.DB, userId);
  const savedEmail = user.receipt_email ? normalizeReceiptEmail(user.receipt_email) : "";

  if (!savedEmail || !isValidReceiptEmail(savedEmail)) {
    await promptForReceiptEmail(env, telegram, userId, chatId);
    return;
  }

  await clearUserState(env.DB, userId);
  await showBuyTokensMenu(env, telegram, userId, chatId, savedEmail);
}

export async function handleReceiptEmailText(
  env: Env,
  telegram: TelegramClient,
  userId: number,
  chatId: number,
  text: string,
): Promise<boolean> {
  const state = await getUserState(env.DB, userId);
  if (!state || state.feature !== "payment" || state.state !== "awaiting_receipt_email") {
    return false;
  }

  const email = normalizeReceiptEmail(text);
  if (!isValidReceiptEmail(email)) {
    await telegram.sendMessage(chatId, "⚠️ Неверный формат email. Отправьте корректный email для чека.");
    return true;
  }

  await setUserReceiptEmail(env.DB, userId, email);
  await clearUserState(env.DB, userId);
  await telegram.sendMessage(chatId, `✅ Email для чека сохранен: ${email}`);
  await showBuyTokensMenu(env, telegram, userId, chatId, email);
  return true;
}

export async function handleReceiptEmailNonText(
  env: Env,
  telegram: TelegramClient,
  userId: number,
  chatId: number,
): Promise<boolean> {
  const state = await getUserState(env.DB, userId);
  if (!state || state.feature !== "payment" || state.state !== "awaiting_receipt_email") {
    return false;
  }

  await telegram.sendMessage(chatId, "Отправьте email текстом для чека.");
  return true;
}

export async function showBuyTokensMenu(
  env: Env,
  telegram: TelegramClient,
  userId: number,
  chatId: number,
  providedReceiptEmail?: string,
): Promise<void> {
  const yookassa = new YooKassaService(env);
  if (!yookassa.hasCredentials()) {
    await telegram.sendMessage(chatId, "❌ Оплата временно недоступна. Напишите в поддержку.");
    return;
  }

  const receiptEmail = await resolveReceiptEmailForPayment(env, telegram, userId, chatId, providedReceiptEmail);
  if (!receiptEmail) {
    return;
  }

  const urlMap: Record<string, string> = {};
  for (const packageId of PAYMENT_PACKAGE_ORDER) {
    const payment = await yookassa.createSbpPayment(packageId, userId, receiptEmail);
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

  const receiptEmail = await resolveReceiptEmailForPayment(env, telegram, userId, chatId);
  if (!receiptEmail) {
    return;
  }

  const payment = await yookassa.createSbpPayment(packageId, userId, receiptEmail);
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

interface ResolvedPaymentContext {
  telegramUserId: number;
  packageId: string;
  amount: number;
  currency: string;
  balanceAdded: number;
}

async function resolvePaymentContext(
  env: Env,
  payload: PaymentWebhookEvent,
  verified: Record<string, unknown>,
  paymentId: string,
): Promise<ResolvedPaymentContext | null> {
  const verifiedMetadata = ((verified as any)?.metadata ?? {}) as Record<string, string>;
  const payloadMetadata = (payload.object?.metadata ?? {}) as Record<string, string>;

  let packageId = verifiedMetadata.package_id || payloadMetadata.package_id || null;
  let telegramUserId = Number(verifiedMetadata.telegram_user_id ?? payloadMetadata.telegram_user_id ?? "");

  if (!packageId || !Number.isInteger(telegramUserId)) {
    const fallbackReference = await findCreatedPaymentReference(env.DB, paymentId);
    if (fallbackReference) {
      packageId ||= fallbackReference.packageId;
      if (!Number.isInteger(telegramUserId)) {
        telegramUserId = fallbackReference.telegramUserId;
      }
    }
  }

  if (!packageId || !Number.isInteger(telegramUserId)) {
    return null;
  }

  const amountSource = ((verified as any)?.amount ?? payload.object?.amount) as
    | { value?: string; currency?: string }
    | undefined;
  const amountKopecks = amountToKopecks(String(amountSource?.value ?? "0"));
  const resolvedPackage = PAYMENT_PACKAGES[packageId] ? packageId : packageByAmountKopecks(amountKopecks);
  if (!resolvedPackage) {
    return null;
  }

  const balanceAdded = PAYMENT_PACKAGES[resolvedPackage].balance;
  const amount = amountKopecks || PAYMENT_PACKAGES[resolvedPackage].rub * 100;
  const currency = String(amountSource?.currency ?? PAYMENT_CURRENCY);

  return {
    telegramUserId,
    packageId: resolvedPackage,
    amount,
    currency,
    balanceAdded,
  };
}

async function processSucceededPayment(
  env: Env,
  payload: PaymentWebhookEvent,
  paymentId: string,
  verified: Record<string, unknown>,
): Promise<"credited" | "already_credited" | "retry"> {
  const context = await resolvePaymentContext(env, payload, verified, paymentId);
  if (!context) {
    console.error("Unable to resolve YooKassa payment context", {
      paymentId,
      verifiedMetadata: (verified as any)?.metadata ?? null,
      payloadMetadata: payload.object?.metadata ?? null,
      payloadAmount: payload.object?.amount ?? null,
      verifiedAmount: (verified as any)?.amount ?? null,
    });
    return "retry";
  }

  await getOrCreateUser(env.DB, context.telegramUserId);

  const newBalance = await applySuccessfulPayment(env.DB, {
    telegramUserId: context.telegramUserId,
    providerPaymentChargeId: paymentId,
    telegramPaymentChargeId: `sbp:${paymentId}`,
    payload: `balance_topup:${context.packageId}:${context.telegramUserId}`,
    currency: context.currency,
    amount: context.amount,
    balanceAdded: context.balanceAdded,
    status: "paid",
  });

  if (newBalance === null) {
    return "already_credited";
  }

  await logConversation(env.DB, {
    telegramUserId: context.telegramUserId,
    feature: "payment",
    messageType: "successful_sbp_payment",
    content: `package=${context.packageId}`,
    metadata: {
      provider_payment_charge_id: paymentId,
      total_amount: context.amount,
      currency: context.currency,
      balance_added: context.balanceAdded,
    },
  });

  const telegram = new TelegramClient(env);
  try {
    await telegram.sendMessage(
      context.telegramUserId,
      `✅ Баланс пополнен на ${context.balanceAdded} токенов. Текущий баланс: ${newBalance}.`,
    );
  } catch (error) {
    console.error("Failed to notify user about successful payment", {
      telegramUserId: context.telegramUserId,
      paymentId,
      error,
    });
  }

  return "credited";
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
  let verified: Record<string, unknown>;
  try {
    verified = await yookassa.getPayment(paymentId);
  } catch (error) {
    console.error("YooKassa getPayment failed in webhook", { paymentId, error });
    return new Response("retry", { status: 502 });
  }

  const status = String((verified as any)?.status ?? payload.object?.status ?? "");
  if (status !== "succeeded") {
    console.warn("YooKassa webhook status is not succeeded yet", { paymentId, status });
    return new Response("retry", { status: 409 });
  }

  const result = await processSucceededPayment(env, payload, paymentId, verified);
  if (result === "retry") {
    return new Response("retry", { status: 409 });
  }

  return new Response("ok", { status: 200 });
}

export async function reconcileRecentPaymentsForUser(env: Env, telegramUserId: number, limit = 12): Promise<void> {
  const paymentIds = await listRecentPendingPaymentIds(env.DB, telegramUserId, limit);
  if (paymentIds.length === 0) {
    return;
  }

  for (const paymentId of paymentIds) {
    const syntheticPayload: PaymentWebhookEvent = {
      event: "payment.succeeded",
      object: {
        id: paymentId,
        status: "succeeded",
      },
    };
    await handleYooKassaWebhook(env, syntheticPayload);
  }
}
