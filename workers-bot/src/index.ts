import { Hono } from "hono";
import { routeUpdate } from "./telegram/router";
import type { Env } from "./types/env";
import type { TelegramUpdate } from "./types/telegram";
import { handleYooKassaWebhook } from "./handlers/payments";
import { processQueueMessage } from "./services/queueProcessor";
import type { JobPayload } from "./types/jobs";

const app = new Hono<{ Bindings: Env }>();

app.get("/healthz", (c) => c.json({ ok: true, service: "nano-banana-workers-bot" }));

app.post("/telegram/webhook/:webhookSecret", async (c) => {
  const pathSecret = c.req.param("webhookSecret");
  if (pathSecret !== c.env.TELEGRAM_WEBHOOK_SECRET) {
    return c.text("forbidden", 403);
  }

  const headerSecret = c.req.header("X-Telegram-Bot-Api-Secret-Token");
  if (headerSecret !== c.env.TELEGRAM_WEBHOOK_HEADER_SECRET) {
    return c.text("forbidden", 403);
  }

  const update = (await c.req.json()) as TelegramUpdate;
  c.executionCtx.waitUntil(routeUpdate(c.env, update));
  return c.text("ok", 200);
});

app.post("/webhooks/yookassa", async (c) => {
  const payload = (await c.req.json()) as any;
  const response = await handleYooKassaWebhook(c.env, payload);
  return response;
});

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<JobPayload>, env: Env, _ctx: ExecutionContext): Promise<void> {
    for (const message of batch.messages) {
      try {
        await processQueueMessage(env, message.body);
        message.ack();
      } catch (error) {
        console.error("Queue job failed", { id: message.body?.id, error });
        message.retry();
      }
    }
  },
};
