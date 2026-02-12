import { afterEach, describe, expect, it, vi } from "vitest";
import { YooKassaService } from "../src/services/yookassa";

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

describe("YooKassa payload", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses provided receipt email in payment payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "payment-id",
        confirmation: { confirmation_url: "https://pay.example/100" },
      }),
    });

    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const service = new YooKassaService(makeEnv() as any);
    await service.createSbpPayment("100", 1337, "buyer@example.com");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(requestInit.body));

    expect(body.receipt.customer.email).toBe("buyer@example.com");
  });
});
