import {
  PAYMENT_CURRENCY,
  PAYMENT_PACKAGES,
  PAYMENT_START_PARAMETER,
  PAYMENT_TITLE,
} from "../types/domain";
import type { Env } from "../types/env";

function base64Credentials(shopId: string, secret: string): string {
  return btoa(`${shopId}:${secret}`);
}

function yookassaBase(env: Env): string {
  return (env.YOOKASSA_API_BASE_URL ?? "https://api.yookassa.ru/v3").replace(/\/$/, "");
}

function telegramReturnUrl(env: Env, userId: number): string {
  const username = env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "");
  if (!username) {
    return "https://t.me";
  }

  const bridgeBase = env.PAYMENT_RETURN_BASE_URL?.replace(/\/$/, "");
  if (!bridgeBase) {
    return `https://t.me/${username}`;
  }

  const query = new URLSearchParams({
    bot: username,
    uid: String(userId),
  });
  return `${bridgeBase}/payments/telegram-return?${query.toString()}`;
}

function buildPaymentPayload(env: Env, packageId: string, userId: number, receiptEmail: string): Record<string, unknown> {
  const packageInfo = PAYMENT_PACKAGES[packageId];
  if (!packageInfo) {
    throw new Error(`Unknown package id: ${packageId}`);
  }

  return {
    amount: {
      value: packageInfo.rub.toFixed(2),
      currency: PAYMENT_CURRENCY,
    },
    capture: true,
    payment_method_data: { type: "sbp" },
    confirmation: {
      type: "redirect",
      return_url: telegramReturnUrl(env, userId),
    },
    description: PAYMENT_TITLE,
    metadata: {
      package_id: packageId,
      telegram_user_id: String(userId),
    },
    receipt: {
      customer: {
        email: receiptEmail,
      },
      items: [
        {
          description: PAYMENT_TITLE,
          quantity: "1.00",
          amount: {
            value: packageInfo.rub.toFixed(2),
            currency: PAYMENT_CURRENCY,
          },
          vat_code: Number(env.YOOKASSA_RECEIPT_VAT_CODE ?? "1"),
          payment_mode: env.YOOKASSA_RECEIPT_PAYMENT_MODE ?? "full_prepayment",
          payment_subject: env.YOOKASSA_RECEIPT_PAYMENT_SUBJECT ?? "service",
        },
      ],
    },
  };
}

function randomIdempotenceKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface YooKassaPaymentCreateResult {
  id: string;
  confirmation: {
    confirmation_url?: string;
  };
}

export class YooKassaService {
  constructor(private readonly env: Env) {}

  hasCredentials(): boolean {
    return Boolean(this.env.YOOKASSA_SHOP_ID && this.env.YOOKASSA_SECRET_KEY);
  }

  buildPayloadMarker(packageId: string, userId: number): string {
    return `${PAYMENT_START_PARAMETER}:${packageId}:${userId}:${randomIdempotenceKey()}`;
  }

  async createSbpPayment(packageId: string, userId: number, receiptEmail: string): Promise<YooKassaPaymentCreateResult> {
    if (!this.hasCredentials()) {
      throw new Error("YooKassa credentials are missing");
    }

    const res = await fetch(`${yookassaBase(this.env)}/payments`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${base64Credentials(this.env.YOOKASSA_SHOP_ID, this.env.YOOKASSA_SECRET_KEY)}`,
        "Content-Type": "application/json",
        "Idempotence-Key": randomIdempotenceKey(),
      },
      body: JSON.stringify(buildPaymentPayload(this.env, packageId, userId, receiptEmail)),
    });

    const body = (await res.json()) as YooKassaPaymentCreateResult;
    if (!res.ok) {
      throw new Error(`YooKassa create payment failed (${res.status}): ${JSON.stringify(body)}`);
    }

    return body;
  }

  async getPayment(paymentId: string): Promise<Record<string, unknown>> {
    if (!this.hasCredentials()) {
      throw new Error("YooKassa credentials are missing");
    }

    const res = await fetch(`${yookassaBase(this.env)}/payments/${paymentId}`, {
      headers: {
        Authorization: `Basic ${base64Credentials(this.env.YOOKASSA_SHOP_ID, this.env.YOOKASSA_SECRET_KEY)}`,
      },
    });
    const body = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(`YooKassa get payment failed (${res.status}): ${JSON.stringify(body)}`);
    }
    return body;
  }
}
