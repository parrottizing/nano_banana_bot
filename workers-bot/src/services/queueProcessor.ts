import {
  clearUserState,
  getMediaGroup,
  getUserImageCount,
  logConversation,
  markJobDone,
  markJobFailed,
  markJobRunning,
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
import { CTR_ANALYSIS_PROMPT } from "../handlers/analyzeCtr";
import { buildImprovementPrompt } from "../handlers/improveCtr";
import { CTR_ENHANCEMENT_PROMPT } from "../handlers/createPhoto";
import { TOKEN_COSTS } from "../types/domain";

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

async function processCreatePhoto(env: Env, payload: CreatePhotoJobPayload): Promise<void> {
  const telegram = new TelegramClient(env);
  const laozhang = new LaoZhangService(env);

  const inputImages = await fileIdsToBase64(telegram, laozhang, payload.fileIds);
  const wantsCtr = inputImages.length > 0 ? await laozhang.classifyCtrIntent(payload.prompt) : false;

  let prompt = payload.prompt;
  if (wantsCtr) {
    prompt += CTR_ENHANCEMENT_PROMPT;
  }

  const targetCount = await getUserImageCount(env.DB, payload.telegramUserId);

  const outputs: string[] = [];
  for (let i = 0; i < targetCount; i += 1) {
    const image = await laozhang.generateImage({
      prompt,
      imageBase64: inputImages.length ? inputImages : undefined,
      aspectRatio: "3:4",
      imageSize: "2K",
    });
    if (image) {
      outputs.push(image);
    }
  }

  if (!outputs.length) {
    await telegram.sendMessage(payload.chatId, "❌ Не удалось сгенерировать изображения.");
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
}

async function processAnalyzeCtr(env: Env, payload: AnalyzeCtrJobPayload): Promise<void> {
  const telegram = new TelegramClient(env);
  const laozhang = new LaoZhangService(env);

  const [imageBase64] = await fileIdsToBase64(telegram, laozhang, [payload.fileId]);
  const analysis = await laozhang.generateText({
    prompt: CTR_ANALYSIS_PROMPT,
    imageBase64: [imageBase64],
    model: TEXT_MODEL,
  });

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
  await telegram.sendMessage(payload.chatId, resultText, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [[{ text: "🚀 Улучшить CTR с Nano Banana", callback_data: "improve_ctr" }]],
    },
  });

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
}

async function processImproveCtr(env: Env, payload: ImproveCtrJobPayload): Promise<void> {
  const telegram = new TelegramClient(env);
  const laozhang = new LaoZhangService(env);

  const [imageBase64] = await fileIdsToBase64(telegram, laozhang, [payload.sourceFileId]);
  const prompt = buildImprovementPrompt(payload.recommendations);

  const image = await laozhang.generateImage({
    prompt,
    imageBase64: [imageBase64],
    aspectRatio: "3:4",
    imageSize: "2K",
  });

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
}

async function processFlushMediaGroup(env: Env, payload: FlushMediaGroupJobPayload): Promise<void> {
  const telegram = new TelegramClient(env);

  const mediaGroup = await getMediaGroup(env.DB, payload.mediaGroupId);
  if (!mediaGroup || mediaGroup.status === "processed") {
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

  await markMediaGroupProcessed(env.DB, payload.mediaGroupId);

  await processCreatePhoto(env, {
    id: payload.id,
    type: "CREATE_PHOTO_JOB",
    telegramUserId: payload.telegramUserId,
    chatId: payload.chatId,
    prompt: mediaGroup.caption,
    fileIds: mediaGroup.fileIds,
  });
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
