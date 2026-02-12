import { beforeEach, describe, expect, it, vi } from "vitest";

const repoMocks = vi.hoisted(() => ({
  clearUserState: vi.fn(),
  getUserState: vi.fn(),
  getOrCreateUser: vi.fn(),
  setUserReceiptEmail: vi.fn(),
  setUserState: vi.fn(),
  logConversation: vi.fn(),
  applySuccessfulPayment: vi.fn(),
  findCreatedPaymentReference: vi.fn(),
  listRecentPendingPaymentIds: vi.fn(),
}));

const yookassaMocks = vi.hoisted(() => ({
  hasCredentials: vi.fn(),
  createSbpPayment: vi.fn(),
  getPayment: vi.fn(),
}));

vi.mock("../src/db/repositories", () => repoMocks);

vi.mock("../src/services/yookassa", () => ({
  YooKassaService: vi.fn().mockImplementation(() => ({
    hasCredentials: yookassaMocks.hasCredentials,
    createSbpPayment: yookassaMocks.createSbpPayment,
    getPayment: yookassaMocks.getPayment,
  })),
}));

import { handleReceiptEmailText, isValidReceiptEmail, startBuyTokensFlow } from "../src/handlers/payments";

function makeEnv() {
  return {
    DB: {} as D1Database,
    BOT_JOBS: {
      send: async () => {},
      sendBatch: async () => {},
    } as unknown as Queue,
    TELEGRAM_BOT_TOKEN: "token",
    TELEGRAM_WEBHOOK_SECRET: "path-secret",
    TELEGRAM_WEBHOOK_HEADER_SECRET: "header-secret",
    LAOZHANG_PER_REQUEST_API_KEY: "x",
    LAOZHANG_PER_USE_API_KEY: "y",
    YOOKASSA_SHOP_ID: "shop",
    YOOKASSA_SECRET_KEY: "secret",
    SUPPORT_USERNAME: "support_user",
  };
}

function makeUser(overrides: Partial<{ receipt_email: string | null }> = {}) {
  return {
    telegram_user_id: 1,
    username: null,
    first_name: null,
    balance: 50,
    image_count: 1,
    has_seen_image_count_prompt: 0,
    receipt_email: null,
    created_at: "2026-01-01T00:00:00.000Z",
    last_active: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("payment receipt email flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repoMocks.getUserState.mockResolvedValue(null);
    repoMocks.getOrCreateUser.mockResolvedValue(makeUser());
    yookassaMocks.hasCredentials.mockReturnValue(true);
    yookassaMocks.createSbpPayment.mockImplementation(async (packageId: string) => ({
      id: `payment-${packageId}`,
      confirmation: { confirmation_url: `https://pay.example/${packageId}` },
    }));
  });

  it("validates receipt email format", () => {
    expect(isValidReceiptEmail("buyer@example.com")).toBe(true);
    expect(isValidReceiptEmail("buyer+1@example.co")).toBe(true);
    expect(isValidReceiptEmail("bad-email")).toBe(false);
    expect(isValidReceiptEmail("missing@domain")).toBe(false);
  });

  it("prompts for email before payment menu when user has no saved email", async () => {
    const env = makeEnv();
    const telegram = { sendMessage: vi.fn().mockResolvedValue({}) } as any;

    repoMocks.getOrCreateUser.mockResolvedValue(makeUser({ receipt_email: null }));

    await startBuyTokensFlow(env as any, telegram, 101, 202);

    expect(repoMocks.setUserState).toHaveBeenCalledWith(env.DB, 101, "payment", "awaiting_receipt_email", {});
    expect(telegram.sendMessage).toHaveBeenCalledWith(202, expect.stringContaining("Для оплаты нужен email"));
    expect(yookassaMocks.createSbpPayment).not.toHaveBeenCalled();
  });

  it("saves valid email and builds payment payloads using that email", async () => {
    const env = makeEnv();
    const telegram = { sendMessage: vi.fn().mockResolvedValue({}) } as any;

    repoMocks.getUserState.mockResolvedValue({
      telegram_user_id: 101,
      feature: "payment",
      state: "awaiting_receipt_email",
      state_data: {},
      updated_at: "2026-01-01T00:00:00.000Z",
    });

    const handled = await handleReceiptEmailText(env as any, telegram, 101, 202, "buyer@example.com");

    expect(handled).toBe(true);
    expect(repoMocks.setUserReceiptEmail).toHaveBeenCalledWith(env.DB, 101, "buyer@example.com");
    expect(repoMocks.clearUserState).toHaveBeenCalledWith(env.DB, 101);
    expect(yookassaMocks.createSbpPayment).toHaveBeenCalledWith("100", 101, "buyer@example.com");
    expect(telegram.sendMessage.mock.calls.some((call: any[]) =>
      call[0] === 202 && typeof call[1] === "string" && call[1].includes("Покупка токенов"))).toBe(true);
  });

  it("keeps waiting state when email is invalid", async () => {
    const env = makeEnv();
    const telegram = { sendMessage: vi.fn().mockResolvedValue({}) } as any;

    repoMocks.getUserState.mockResolvedValue({
      telegram_user_id: 55,
      feature: "payment",
      state: "awaiting_receipt_email",
      state_data: {},
      updated_at: "2026-01-01T00:00:00.000Z",
    });

    const handled = await handleReceiptEmailText(env as any, telegram, 55, 77, "not-an-email");

    expect(handled).toBe(true);
    expect(repoMocks.setUserReceiptEmail).not.toHaveBeenCalled();
    expect(yookassaMocks.createSbpPayment).not.toHaveBeenCalled();
    expect(telegram.sendMessage).toHaveBeenCalledWith(77, expect.stringContaining("Неверный формат email"));
  });
});
