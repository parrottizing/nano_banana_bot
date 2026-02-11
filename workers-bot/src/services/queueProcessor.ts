import {
  clearUserState,
  getMediaGroup,
  getUserImageCount,
  logConversation,
  markJobDone,
  markJobFailed,
  markJobRunning,
  markMediaGroupCollecting,
  markMediaGroupProcessingIfAvailable,
  markMediaGroupProcessed,
  setUserState,
  updateUserBalance,
} from "../db/repositories";
import type { Env } from "../types/env";
import type {
  AnalyzeCtrJobPayload,
  CreatePhotoJobPayload,
  FlushMediaGroupJobPayload,
  ImproveCtrJobPayload,
  JobPayload,
} from "../types/jobs";
import { TelegramClient } from "../telegram/client";
import { LaoZhangService, TEXT_MODEL } from "./laozhang";
import { enqueueJob, makeJobId } from "./jobs";
import {
  ANIMATION_STEP_DELAY_MS,
  getEmojiHoldDelayMs,
  getInitialEmojiDelayMs,
} from "./loadingAnimation";
import { CTR_ANALYSIS_PROMPT } from "../handlers/analyzeCtr";
import { buildImprovementPrompt } from "../handlers/improveCtr";
import { CTR_ENHANCEMENT_PROMPT } from "../handlers/createPhoto";
import { TOKEN_COSTS } from "../types/domain";

const PHOTO_LOADING_EMOJIS = ["🤔", "💡", "🎨"] as const;
const CTR_LOADING_EMOJIS = ["🔍", "✍️", "📝"] as const;
const IMPROVE_LOADING_EMOJIS = PHOTO_LOADING_EMOJIS;
const TELEGRAM_MESSAGE_LIMIT = 4096;
const MEDIA_GROUP_SETTLE_WINDOW_MS = 3500;
const MEDIA_GROUP_RETRY_DELAY_SECONDS = 2;
const MEDIA_GROUP_STALE_PROCESSING_SECONDS = 120;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseSqlTimestampMs(timestamp: string): number | null {
  const normalized = timestamp.includes("T")
    ? timestamp
    : `${timestamp.replace(" ", "T")}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function isMessageNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const text = error.message.toLowerCase();
  return text.includes("message to edit not found") || text.includes("message to delete not found");
}

function isMessageUnchangedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.toLowerCase().includes("message is not modified");
}

async function startLoadingAnimation(
  telegram: TelegramClient,
  chatId: number,
  options?: {
    initialMessageId?: number;
    initialMessageSentAtMs?: number;
    emojis?: readonly string[];
    chatAction?: "typing" | "upload_photo";
  },
): Promise<() => Promise<void>> {
  const emojis = options?.emojis && options.emojis.length > 0 ? options.emojis : PHOTO_LOADING_EMOJIS;
  const chatAction = options?.chatAction ?? "typing";
  let messageId = options?.initialMessageId;
  let initialMessageSentAtMs = options?.initialMessageSentAtMs;
  if (messageId) {
    try {
      // Validate that the message still exists after queue retries.
      await telegram.editMessageText(chatId, messageId, emojis[0]);
    } catch (error) {
      if (isMessageNotFoundError(error)) {
        const message = await telegram.sendMessage(chatId, emojis[0]);
        messageId = message.message_id;
        initialMessageSentAtMs = Date.now();
      } else if (!isMessageUnchangedError(error)) {
        console.warn("Failed to reuse loading message, keeping existing message", { chatId, messageId, error });
      }
    }
  } else {
    const message = await telegram.sendMessage(chatId, emojis[0]);
    messageId = message.message_id;
    initialMessageSentAtMs = Date.now();
  }

  let stopped = false;
  let emojiIndex = 0;
  let delayBeforeNextStepMs = getInitialEmojiDelayMs(initialMessageSentAtMs);

  const loop = (async () => {
    while (!stopped) {
      if (delayBeforeNextStepMs > 0) {
        await sleep(delayBeforeNextStepMs);
      }
      if (stopped) {
        break;
      }

      emojiIndex = (emojiIndex + 1) % emojis.length;
      let emojiDisplayed = false;
      try {
        await telegram.editMessageText(chatId, messageId, emojis[emojiIndex]);
        emojiDisplayed = true;
      } catch (error) {
        if (isMessageNotFoundError(error)) {
          try {
            const message = await telegram.sendMessage(chatId, emojis[emojiIndex]);
            messageId = message.message_id;
            emojiDisplayed = true;
          } catch (createError) {
            console.warn("Failed to recreate loading message", { chatId, createError });
          }
        } else {
          console.warn("Failed to update loading emoji", { chatId, messageId, error });
        }
      }

      if (emojiDisplayed) {
        try {
          await telegram.sendChatAction(chatId, chatAction);
        } catch (error) {
          console.warn("Failed to send chat action", { chatId, error });
        }
      }

      delayBeforeNextStepMs = emojiDisplayed ? getEmojiHoldDelayMs(emojiIndex) : ANIMATION_STEP_DELAY_MS;
    }
  })();

  return async () => {
    stopped = true;
    await loop;
    if (typeof messageId !== "number") {
      return;
    }
    try {
      await telegram.deleteMessage(chatId, messageId);
    } catch (error) {
      console.warn("Failed to delete loading message", { chatId, messageId, error });
    }
  };
}

function isMarkdownParseError(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes("can't parse entities");
}

async function sendMessageWithMarkdownFallback(
  telegram: TelegramClient,
  chatId: number,
  text: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  try {
    await telegram.sendMessage(chatId, text, { parse_mode: "Markdown", ...extra });
  } catch (error) {
    if (!isMarkdownParseError(error)) {
      throw error;
    }
    await telegram.sendMessage(chatId, text, extra);
  }
}

async function sendLongMessageWithMarkdownFallback(
  telegram: TelegramClient,
  chatId: number,
  text: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  if (text.length <= TELEGRAM_MESSAGE_LIMIT) {
    await sendMessageWithMarkdownFallback(telegram, chatId, text, extra);
    return;
  }

  for (let offset = 0; offset < text.length; offset += TELEGRAM_MESSAGE_LIMIT) {
    const chunk = text.slice(offset, offset + TELEGRAM_MESSAGE_LIMIT);
    const isLastChunk = offset + TELEGRAM_MESSAGE_LIMIT >= text.length;
    await sendMessageWithMarkdownFallback(
      telegram,
      chatId,
      chunk,
      isLastChunk ? extra : {},
    );
  }
}

async function fileIdsToBase64(telegram: TelegramClient, laozhang: LaoZhangService, fileIds: string[]): Promise<string[]> {
  const images: string[] = [];
  for (const fileId of fileIds) {
    const buffer = await telegram.downloadFileAsArrayBuffer(fileId);
    images.push(laozhang.arrayBufferToBase64(buffer));
  }
  return images;
}

async function sendGeneratedImages(
  telegram: TelegramClient,
  chatId: number,
  imagesBase64: string[],
): Promise<void> {
  if (imagesBase64.length === 1) {
    await telegram.sendPhoto(chatId, imagesBase64[0], { caption: "🎨 Ваше изображение готово!" });
    await telegram.sendDocument(chatId, imagesBase64[0], "generated_image.png", "📥 Изображение в оригинальном качестве");
    return;
  }

  await telegram.sendMediaGroup(
    chatId,
    imagesBase64.map((img, i) => ({
      type: "photo",
      media: `data:image/png;base64,${img}`,
      caption: i === 0 ? "🎨 Ваше изображение готово!" : undefined,
    })),
  );

  await telegram.sendMediaGroup(
    chatId,
    imagesBase64.map((img, i) => ({
      type: "document",
      media: `data:application/octet-stream;base64,${img}`,
      caption: i === 0 ? "📥 Изображение в оригинальном качестве" : undefined,
    })),
  );
}

async function generateImagesInParallel(
  laozhang: LaoZhangService,
  prompt: string,
  inputImages: string[],
  targetCount: number,
): Promise<string[]> {
  const tasks = Array.from({ length: targetCount }, (_, index) =>
    laozhang
      .generateImage({
        prompt,
        imageBase64: inputImages.length ? inputImages : undefined,
        aspectRatio: "3:4",
        imageSize: "2K",
      })
      .then((image) => ({ index, image }))
      .catch((error) => {
        console.error("Image generation attempt failed", { index, error });
        return { index, image: null as string | null };
      }),
  );

  const results = await Promise.all(tasks);
  return results
    .sort((a, b) => a.index - b.index)
    .map((item) => item.image)
    .filter((image): image is string => Boolean(image));
}

async function processCreatePhoto(env: Env, payload: CreatePhotoJobPayload): Promise<void> {
  const telegram = new TelegramClient(env);
  const laozhang = new LaoZhangService(env);
  let stopLoadingAnimation: (() => Promise<void>) | null = null;

  try {
    stopLoadingAnimation = await startLoadingAnimation(telegram, payload.chatId, {
      initialMessageId: payload.loadingMessageId,
      initialMessageSentAtMs: payload.loadingMessageSentAtMs,
      emojis: PHOTO_LOADING_EMOJIS,
      chatAction: "upload_photo",
    });

    const inputImages = await fileIdsToBase64(telegram, laozhang, payload.fileIds);
    let wantsCtr = false;
    if (inputImages.length > 0) {
      try {
        wantsCtr = await laozhang.classifyCtrIntent(payload.prompt);
      } catch (error) {
        console.error("CTR intent classification failed, continuing without enhancement", { error });
      }
    }

    let prompt = payload.prompt;
    if (wantsCtr) {
      prompt += CTR_ENHANCEMENT_PROMPT;
    }

    const targetCount = await getUserImageCount(env.DB, payload.telegramUserId);
    const outputs = await generateImagesInParallel(laozhang, prompt, inputImages, targetCount);

    if (stopLoadingAnimation) {
      await stopLoadingAnimation();
      stopLoadingAnimation = null;
    }

    if (!outputs.length) {
      await telegram.sendMessage(
        payload.chatId,
        "❌ Не удалось сгенерировать изображения. Попробуйте снова чуть позже.",
      );
      await logConversation(env.DB, {
        telegramUserId: payload.telegramUserId,
        feature: "create_photo",
        messageType: "error",
        content: "no generated images",
        success: false,
      });
      return;
    }

    await sendGeneratedImages(telegram, payload.chatId, outputs);
    if (outputs.length < targetCount) {
      await telegram.sendMessage(
        payload.chatId,
        `⚠️ Получилось сгенерировать ${outputs.length} из ${targetCount} вариантов. Попробуйте повторить для остальных.`,
      );
    }

    const actualCost = TOKEN_COSTS.create_photo * outputs.length;
    await updateUserBalance(env.DB, payload.telegramUserId, -actualCost);

    await logConversation(env.DB, {
      telegramUserId: payload.telegramUserId,
      feature: "create_photo",
      messageType: "bot_image_generated",
      content: payload.prompt,
      imageCount: outputs.length,
      tokensUsed: actualCost,
      success: true,
    });
  } finally {
    if (stopLoadingAnimation) {
      await stopLoadingAnimation();
    }
  }
}

async function processAnalyzeCtr(env: Env, payload: AnalyzeCtrJobPayload): Promise<void> {
  const telegram = new TelegramClient(env);
  const laozhang = new LaoZhangService(env);
  let stopLoadingAnimation: (() => Promise<void>) | null = null;

  try {
    stopLoadingAnimation = await startLoadingAnimation(telegram, payload.chatId, {
      initialMessageId: payload.loadingMessageId,
      initialMessageSentAtMs: payload.loadingMessageSentAtMs,
      emojis: CTR_LOADING_EMOJIS,
      chatAction: "typing",
    });

    const [imageBase64] = await fileIdsToBase64(telegram, laozhang, [payload.fileId]);
    const analysis = await laozhang.generateText({
      prompt: CTR_ANALYSIS_PROMPT,
      imageBase64: [imageBase64],
      model: TEXT_MODEL,
    });

    if (stopLoadingAnimation) {
      await stopLoadingAnimation();
      stopLoadingAnimation = null;
    }

    if (!analysis) {
      await telegram.sendMessage(payload.chatId, "❌ Не удалось проанализировать изображение. Попробуйте другое фото.");
      await logConversation(env.DB, {
        telegramUserId: payload.telegramUserId,
        feature: "analyze_ctr",
        messageType: "error",
        content: "empty ctr analysis",
        success: false,
      });
      return;
    }

    const resultText = `📊 *Результат анализа CTR:*\n\n${analysis}`;
    await sendLongMessageWithMarkdownFallback(
      telegram,
      payload.chatId,
      resultText,
      {
        reply_markup: {
          inline_keyboard: [[{ text: "🚀 Улучшить CTR с Nano Banana", callback_data: "improve_ctr" }]],
        },
      },
    );

    await setUserState(env.DB, payload.telegramUserId, "ctr_improvement", "ready_to_improve", {
      image_file_id: payload.fileId,
      recommendations: analysis,
    });

    await updateUserBalance(env.DB, payload.telegramUserId, -TOKEN_COSTS.analyze_ctr);

    await logConversation(env.DB, {
      telegramUserId: payload.telegramUserId,
      feature: "analyze_ctr",
      messageType: "bot_response",
      content: resultText,
      tokensUsed: TOKEN_COSTS.analyze_ctr,
      success: true,
    });
  } finally {
    if (stopLoadingAnimation) {
      await stopLoadingAnimation();
    }
  }
}

async function processImproveCtr(env: Env, payload: ImproveCtrJobPayload): Promise<void> {
  const telegram = new TelegramClient(env);
  const laozhang = new LaoZhangService(env);
  let stopLoadingAnimation: (() => Promise<void>) | null = null;

  try {
    stopLoadingAnimation = await startLoadingAnimation(telegram, payload.chatId, {
      initialMessageId: payload.loadingMessageId,
      initialMessageSentAtMs: payload.loadingMessageSentAtMs,
      emojis: IMPROVE_LOADING_EMOJIS,
      chatAction: "upload_photo",
    });

    const [imageBase64] = await fileIdsToBase64(telegram, laozhang, [payload.sourceFileId]);
    const prompt = buildImprovementPrompt(payload.recommendations);

    const image = await laozhang.generateImage({
      prompt,
      imageBase64: [imageBase64],
      aspectRatio: "3:4",
      imageSize: "2K",
    });

    if (stopLoadingAnimation) {
      await stopLoadingAnimation();
      stopLoadingAnimation = null;
    }

    if (!image) {
      await telegram.sendMessage(payload.chatId, "❌ Ошибка при улучшении изображения.");
      await logConversation(env.DB, {
        telegramUserId: payload.telegramUserId,
        feature: "improve_ctr",
        messageType: "error",
        content: "image generation failed",
        success: false,
      });
      return;
    }

    await sendGeneratedImages(telegram, payload.chatId, [image]);
    await updateUserBalance(env.DB, payload.telegramUserId, -TOKEN_COSTS.create_photo);

    await logConversation(env.DB, {
      telegramUserId: payload.telegramUserId,
      feature: "improve_ctr",
      messageType: "bot_image_generated",
      content: "improved image generated",
      imageCount: 1,
      tokensUsed: TOKEN_COSTS.create_photo,
      success: true,
    });
  } finally {
    if (stopLoadingAnimation) {
      await stopLoadingAnimation();
    }
  }
}

async function processFlushMediaGroup(env: Env, payload: FlushMediaGroupJobPayload): Promise<void> {
  const telegram = new TelegramClient(env);

  let mediaGroup = await getMediaGroup(env.DB, payload.mediaGroupId);
  if (!mediaGroup) {
    return;
  }

  if (!mediaGroup.caption) {
    await telegram.sendMessage(
      payload.chatId,
      "⚠️ Пожалуйста, добавьте описание к вашим изображениям. Отправьте изображения снова с подписью.",
    );
    await clearUserState(env.DB, payload.telegramUserId);
    await markMediaGroupProcessed(env.DB, payload.mediaGroupId);
    return;
  }

  const updatedAtMs = parseSqlTimestampMs(mediaGroup.updatedAt);
  if (updatedAtMs !== null && Date.now() - updatedAtMs < MEDIA_GROUP_SETTLE_WINDOW_MS) {
    await enqueueJob(env, {
      id: makeJobId("flush_media_group"),
      type: "FLUSH_MEDIA_GROUP_JOB",
      telegramUserId: payload.telegramUserId,
      chatId: payload.chatId,
      mediaGroupId: payload.mediaGroupId,
    }, {
      delaySeconds: MEDIA_GROUP_RETRY_DELAY_SECONDS,
    });
    return;
  }

  const claimed = await markMediaGroupProcessingIfAvailable(
    env.DB,
    payload.mediaGroupId,
    MEDIA_GROUP_STALE_PROCESSING_SECONDS,
  );
  if (!claimed) {
    mediaGroup = await getMediaGroup(env.DB, payload.mediaGroupId);
    if (mediaGroup?.status === "processing") {
      await enqueueJob(env, {
        id: makeJobId("flush_media_group"),
        type: "FLUSH_MEDIA_GROUP_JOB",
        telegramUserId: payload.telegramUserId,
        chatId: payload.chatId,
        mediaGroupId: payload.mediaGroupId,
      }, {
        delaySeconds: MEDIA_GROUP_RETRY_DELAY_SECONDS,
      });
    }
    return;
  }

  let loadingMessageId: number | undefined;

  try {
    const loadingMessage = await telegram.sendMessage(payload.chatId, PHOTO_LOADING_EMOJIS[0]);
    loadingMessageId = loadingMessage.message_id;

    await enqueueJob(env, {
      id: makeJobId("create_photo"),
      type: "CREATE_PHOTO_JOB",
      telegramUserId: payload.telegramUserId,
      chatId: payload.chatId,
      prompt: mediaGroup.caption,
      fileIds: mediaGroup.fileIds,
      loadingMessageId,
      loadingMessageSentAtMs: Date.now(),
    });

    await markMediaGroupProcessed(env.DB, payload.mediaGroupId);
  } catch (error) {
    await markMediaGroupCollecting(env.DB, payload.mediaGroupId);
    if (typeof loadingMessageId === "number") {
      try {
        await telegram.deleteMessage(payload.chatId, loadingMessageId);
      } catch (deleteError) {
        console.warn("Failed to delete media-group loading message", { chatId: payload.chatId, loadingMessageId, deleteError });
      }
    }
    throw error;
  }
}

export async function processQueueMessage(env: Env, payload: JobPayload): Promise<void> {
  await markJobRunning(env.DB, payload.id);
  try {
    switch (payload.type) {
      case "CREATE_PHOTO_JOB":
        await processCreatePhoto(env, payload);
        break;
      case "ANALYZE_CTR_JOB":
        await processAnalyzeCtr(env, payload);
        break;
      case "IMPROVE_CTR_JOB":
        await processImproveCtr(env, payload);
        break;
      case "FLUSH_MEDIA_GROUP_JOB":
        await processFlushMediaGroup(env, payload);
        break;
    }
    await markJobDone(env.DB, payload.id);
  } catch (error) {
    await markJobFailed(env.DB, payload.id, error instanceof Error ? error.message : String(error));
    throw error;
  }
}
