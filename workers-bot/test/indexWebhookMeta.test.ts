import { beforeEach, describe, expect, it, vi } from "vitest";

const paymentHandlerMocks = vi.hoisted(() => ({
  handleYooKassaWebhook: vi.fn(),
  reconcileRecentPaymentsForUser: vi.fn(),
}));

vi.mock("../src/handlers/payments", () => paymentHandlerMocks);

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

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

describe("yookassa webhook route metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    paymentHandlerMocks.handleYooKassaWebhook.mockResolvedValue(new Response("ok", { status: 200 }));
  });

  it("passes webhook_http trigger and request metadata into payment handler", async () => {
    const { default: worker } = await import("../src/index");
    const env = makeEnv();
    const payload = { event: "payment.succeeded", object: { id: "pay-1", status: "succeeded" } };

    const req = new Request("https://example.com/webhooks/yookassa", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-Id": "req-123",
        "CF-Ray": "ray-abc",
        "CF-Connecting-IP": "127.0.0.1",
        "User-Agent": "test-agent",
      },
      body: JSON.stringify(payload),
    });

    const res = await worker.fetch(req, env as any, ctx);
    expect(res.status).toBe(200);
    expect(paymentHandlerMocks.handleYooKassaWebhook).toHaveBeenCalledWith(
      env,
      payload,
      {
        trigger: "webhook_http",
        requestId: "req-123",
        cfRay: "ray-abc",
        cfConnectingIp: "127.0.0.1",
        userAgent: "test-agent",
      },
    );
  });
});
