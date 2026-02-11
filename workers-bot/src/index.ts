import { Hono } from "hono";
import { routeUpdate } from "./telegram/router";
import type { Env } from "./types/env";
import type { TelegramUpdate } from "./types/telegram";
import { handleYooKassaWebhook } from "./handlers/payments";
import { processQueueMessage } from "./services/queueProcessor";
import type { JobPayload } from "./types/jobs";
import { TelegramClient } from "./telegram/client";
import { setUserState } from "./db/repositories";

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

function cleanBotUsername(input: string | undefined): string | null {
  if (!input) {
    return null;
  }
  const cleaned = input.replace(/^@/, "").trim();
  return cleaned || null;
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
  if (payload.type === "IMPROVE_CTR_JOB") {
    text += "\n\nНажмите «Улучшить CTR с Nano Banana» еще раз.";
  }

  if (payload.type === "IMPROVE_CTR_JOB") {
    await setUserState(env.DB, payload.telegramUserId, "ctr_improvement", "ready_to_improve", {
      image_file_id: payload.sourceFileId,
      recommendations: payload.recommendations,
    });
  }

  console.error("Final queue failure", { id: payload.id, type: payload.type, reason });
  try {
    await telegram.sendMessage(payload.chatId, text);
  } catch (notifyError) {
    console.error("Failed to notify user about queue failure", {
      id: payload.id,
      type: payload.type,
      notifyError,
    });
  }
}

async function notifyQueueRetry(
  env: Env,
  payload: JobPayload,
  attempts: number,
  error: unknown,
): Promise<void> {
  const telegram = new TelegramClient(env);
  const reason = error instanceof Error ? error.message : String(error);
  const nextAttempt = attempts + 1;

  let text = `⚠️ Временная ошибка. Повторяем автоматически (попытка ${nextAttempt} из ${MAX_QUEUE_RETRIES}).`;
  if (payload.type === "CREATE_PHOTO_JOB" || payload.type === "IMPROVE_CTR_JOB") {
    text = `⚠️ Временная ошибка генерации. Повторяем автоматически (попытка ${nextAttempt} из ${MAX_QUEUE_RETRIES}).`;
  } else if (payload.type === "ANALYZE_CTR_JOB") {
    text = `⚠️ Временная ошибка анализа CTR. Повторяем автоматически (попытка ${nextAttempt} из ${MAX_QUEUE_RETRIES}).`;
  }

  try {
    await telegram.sendMessage(payload.chatId, text);
  } catch (notifyError) {
    console.error("Failed to notify user about queue retry", {
      id: payload.id,
      type: payload.type,
      reason,
      notifyError,
    });
  }
}

app.get("/healthz", (c) => c.json({ ok: true, service: "nano-banana-workers-bot" }));

app.get("/payments/telegram-return", (c) => {
  const username = cleanBotUsername(c.req.query("bot"));
  if (!username) {
    return c.redirect("https://t.me", 302);
  }

  const startParam = c.req.query("start")?.trim() || "sbp_return";
  const encodedStartParam = encodeURIComponent(startParam);
  const tgUrl = `tg://resolve?domain=${encodeURIComponent(username)}&start=${encodedStartParam}`;
  const fallbackUrl = `https://t.me/${encodeURIComponent(username)}?start=${encodedStartParam}`;

  return c.html(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Opening Telegram</title>
    <meta http-equiv="refresh" content="2;url=${fallbackUrl}" />
  </head>
  <body>
    <p>Opening Telegram...</p>
    <script>
      window.location.replace("${tgUrl}");
      setTimeout(function () {
        window.location.replace("${fallbackUrl}");
      }, 1200);
    </script>
  </body>
</html>`);
});

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
          await notifyQueueRetry(env, message.body, attempts, error);
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
