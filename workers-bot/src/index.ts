import { Hono } from "hono";
import { routeUpdate } from "./telegram/router";
import type { Env } from "./types/env";
import type { TelegramUpdate } from "./types/telegram";
import { handleYooKassaWebhook } from "./handlers/payments";
import { processQueueMessage } from "./services/queueProcessor";
import type { JobPayload } from "./types/jobs";
import { TelegramClient } from "./telegram/client";

const app = new Hono<{ Bindings: Env }>();
const MAX_QUEUE_RETRIES = 3;
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function parseErrorStatus(error: unknown): number | null {
  if (!(error instanceof Error)) {
    return null;
  }
  const match = error.message.match(/\b(\d{3})\b/);
  if (!match) {
    return null;
  }
  const status = Number(match[1]);
  return Number.isFinite(status) ? status : null;
}

function isRetryableQueueError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const status = parseErrorStatus(error);
  if (status !== null) {
    return RETRYABLE_STATUSES.has(status);
  }

  const normalized = error.message.toLowerCase();
  return normalized.includes("timeout") || normalized.includes("temporar") || normalized.includes("fetch");
}

async function notifyQueueFailure(env: Env, payload: JobPayload, error: unknown): Promise<void> {
  const telegram = new TelegramClient(env);
  const reason = error instanceof Error ? error.message : String(error);

  let text = "❌ Не удалось выполнить задачу. Попробуйте снова чуть позже.";
  if (payload.type === "CREATE_PHOTO_JOB" || payload.type === "IMPROVE_CTR_JOB") {
    text = "❌ Не удалось сгенерировать изображение. Попробуйте снова чуть позже.";
  } else if (payload.type === "ANALYZE_CTR_JOB") {
    text = "❌ Не удалось выполнить анализ CTR. Попробуйте снова чуть позже.";
  }

  console.error("Final queue failure", { id: payload.id, type: payload.type, reason });
  await telegram.sendMessage(payload.chatId, text);
}

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
        const retryable = isRetryableQueueError(error);
        const attempts = message.attempts ?? 1;

        console.error("Queue job failed", { id: message.body?.id, attempts, retryable, error });
        if (retryable && attempts < MAX_QUEUE_RETRIES) {
          const delaySeconds = Math.min(30 * (2 ** (attempts - 1)), 300);
          message.retry({ delaySeconds });
          continue;
        }

        await notifyQueueFailure(env, message.body, error);
        message.ack();
      }
    }
  },
};
