import worker from "../src/index";
import { describe, expect, it } from "vitest";

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

describe("worker routes", () => {
  it("returns health response", async () => {
    const res = await worker.fetch(new Request("https://example.com/healthz"), makeEnv(), ctx);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
  });

  it("rejects telegram webhook with invalid path secret", async () => {
    const req = new Request("https://example.com/telegram/webhook/wrong", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": "header-secret",
      },
      body: JSON.stringify({ update_id: 1 }),
    });

    const res = await worker.fetch(req, makeEnv(), ctx);
    expect(res.status).toBe(403);
  });

  it("rejects telegram webhook with invalid header secret", async () => {
    const req = new Request("https://example.com/telegram/webhook/path-secret", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": "wrong",
      },
      body: JSON.stringify({ update_id: 1 }),
    });

    const res = await worker.fetch(req, makeEnv(), ctx);
    expect(res.status).toBe(403);
  });
});
