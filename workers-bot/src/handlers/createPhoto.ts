import {
  checkBalance,
  clearUserState,
  getOrCreateUser,
  getUser,
  getUserImageCount,
  getUserState,
  logConversation,
  markImageCountPromptSeen,
  setUserImageCount,
  setUserState,
  shouldShowImageCountPrompt,
  upsertMediaGroup,
  markMediaGroupQueued,
} from "../db/repositories";
import { MAX_IMAGE_SIZE_BYTES, MAX_IMAGES, TOKEN_COSTS } from "../types/domain";
import type { Env } from "../types/env";
import { TelegramClient } from "../telegram/client";
import type { TelegramMessage } from "../types/telegram";
import { enqueueJob, makeJobId } from "../services/jobs";

export const CTR_ENHANCEMENT_PROMPT = `\nКРИТИЧЕСКИ ВАЖНО: Пользователь хочет улучшить CTR (кликабельность) для маркетплейса (Wildberries, Ozon, Яндекс.Маркет).\n\nПРИМЕНЯЙ СТРАТЕГИЮ "УМНОГО МИНИМАЛИЗМА" (2025):\n\n• Товар должен занимать минимум 60-70% площади изображения\n• Только 1-2 крупных тезиса\n• Соотношение сторон строго 3:4\n• Без указания цены на изображении\n• Чистая, контрастная композиция`;

export async function createPhotoEntry(env: Env, telegram: TelegramClient, userId: number, chatId: number): Promise<void> {
  await getOrCreateUser(env.DB, userId);

  if (await shouldShowImageCountPrompt(env.DB, userId)) {
    await telegram.sendMessage(
      chatId,
      "🎨 *Сколько изображений создавать за раз?*\n\n" +
        "• 1 вариант — 25 токенов\n" +
        "• 2 варианта — 50 токенов\n" +
        "• 4 варианта — 100 токенов ⭐\n\n" +
        "_💡 Изменить можно в любой момент_",
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "1️⃣", callback_data: "set_image_count_1" },
              { text: "2️⃣", callback_data: "set_image_count_2" },
              { text: "4️⃣ ⭐", callback_data: "set_image_count_4" },
            ],
          ],
        },
      },
    );
    return;
  }

  await setUserState(env.DB, userId, "create_photo", "awaiting_photo_input", { images: [] });
  const user = await getUser(env.DB, userId);
  const imageCount = await getUserImageCount(env.DB, userId);
  const cost = TOKEN_COSTS.create_photo * imageCount;

  await logConversation(env.DB, {
    telegramUserId: userId,
    feature: "create_photo",
    messageType: "button_click",
    content: "create_photo",
  });

  await telegram.sendMessage(
    chatId,
    "🎨 *Создание фото*\n\n" +
      "Отправьте описание изображения, которое хотите создать или отредактировать.\n\n" +
      `📸 _Вариантов: ${imageCount}_\n` +
      `💰 _Стоимость: ${cost} токенов_\n` +
      `🎫 _Ваш баланс: ${user?.balance ?? 0} токенов_`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[{ text: "⚙️ Изменить кол-во вариантов", callback_data: "change_image_count" }]],
      },
    },
  );
}

export async function handleSetImageCount(
  env: Env,
  telegram: TelegramClient,
  userId: number,
  chatId: number,
  count: 1 | 2 | 4,
): Promise<void> {
  await setUserImageCount(env.DB, userId, count);
  await markImageCountPromptSeen(env.DB, userId);
  await telegram.sendMessage(chatId, `✅ Установлено: ${count} вариант(ов)`);
  await createPhotoEntry(env, telegram, userId, chatId);
}

export async function showChangeImageCountMenu(
  env: Env,
  telegram: TelegramClient,
  userId: number,
  chatId: number,
): Promise<void> {
  const current = await getUserImageCount(env.DB, userId);
  const label = (value: number, text: string) => `${text}${current === value ? " ✓" : ""}`;

  await telegram.sendMessage(
    chatId,
    "⚙️ *Количество изображений*\n\n" +
      `Сейчас: *${current}* вариант(ов)\n\n` +
      "• 1 вариант — 25 токенов\n" +
      "• 2 варианта — 50 токенов\n" +
      "• 4 варианта — 100 токенов",
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: label(1, "1️⃣"), callback_data: "set_image_count_1" },
            { text: label(2, "2️⃣"), callback_data: "set_image_count_2" },
            { text: label(4, "4️⃣ ⭐"), callback_data: "set_image_count_4" },
          ],
          [{ text: "🔙 Назад", callback_data: "create_photo" }],
        ],
      },
    },
  );
}

export async function handleCreatePhotoText(
  env: Env,
  telegram: TelegramClient,
  userId: number,
  chatId: number,
  text: string,
): Promise<boolean> {
  const state = await getUserState(env.DB, userId);
  if (!state || state.feature !== "create_photo" || state.state !== "awaiting_photo_input") {
    return false;
  }

  const imageCount = await getUserImageCount(env.DB, userId);
  const cost = TOKEN_COSTS.create_photo * imageCount;
  if (!(await checkBalance(env.DB, userId, cost))) {
    await telegram.sendMessage(
      chatId,
      `❌ Недостаточно токенов! Требуется: ${cost} (${imageCount} вариантов)\nПополните баланс для продолжения.`,
    );
    await clearUserState(env.DB, userId);
    return true;
  }

  await clearUserState(env.DB, userId);

  await enqueueJob(env, {
    id: makeJobId("create_photo"),
    type: "CREATE_PHOTO_JOB",
    telegramUserId: userId,
    chatId,
    prompt: text,
    fileIds: [],
  });

  await telegram.sendMessage(chatId, "🤔 Генерирую изображение...");
  return true;
}

async function validatePhotoFileSize(telegram: TelegramClient, message: TelegramMessage): Promise<string | null> {
  const photo = message.photo?.[message.photo.length - 1];
  if (!photo) {
    return null;
  }

  if (photo.file_size && photo.file_size > MAX_IMAGE_SIZE_BYTES) {
    return "too_large";
  }

  return photo.file_id;
}

export async function handleCreatePhotoImage(
  env: Env,
  telegram: TelegramClient,
  userId: number,
  chatId: number,
  message: TelegramMessage,
): Promise<boolean> {
  const state = await getUserState(env.DB, userId);
  if (!state || state.feature !== "create_photo" || state.state !== "awaiting_photo_input") {
    return false;
  }

  const fileId = await validatePhotoFileSize(telegram, message);
  if (fileId === "too_large") {
    await telegram.sendMessage(chatId, "⚠️ Изображение слишком большое. Максимум 7MB.");
    return true;
  }
  if (!fileId) {
    await telegram.sendMessage(chatId, "⚠️ Не удалось прочитать изображение.");
    return true;
  }

  const imageCount = await getUserImageCount(env.DB, userId);
  const cost = TOKEN_COSTS.create_photo * imageCount;
  if (!(await checkBalance(env.DB, userId, cost))) {
    await telegram.sendMessage(
      chatId,
      `❌ Недостаточно токенов! Требуется: ${cost} (${imageCount} вариантов)\nПополните баланс для продолжения.`,
    );
    await clearUserState(env.DB, userId);
    return true;
  }

  if (message.media_group_id) {
    const group = await upsertMediaGroup(env.DB, {
      mediaGroupId: message.media_group_id,
      telegramUserId: userId,
      chatId,
      caption: message.caption ?? null,
      appendFileId: fileId,
    });

    if (group.fileIds.length > MAX_IMAGES) {
      await telegram.sendMessage(chatId, `⚠️ Можно использовать максимум ${MAX_IMAGES} изображений.`);
      return true;
    }

    await markMediaGroupQueued(env.DB, group.mediaGroupId);
    await enqueueJob(env, {
      id: makeJobId("flush_media_group"),
      type: "FLUSH_MEDIA_GROUP_JOB",
      telegramUserId: userId,
      chatId,
      mediaGroupId: group.mediaGroupId,
    });

    return true;
  }

  if (!message.caption) {
    await telegram.sendMessage(
      chatId,
      "⚠️ Пожалуйста, отправьте изображение с текстовым описанием в подписи.",
      { parse_mode: "Markdown" },
    );
    return true;
  }

  await clearUserState(env.DB, userId);

  await enqueueJob(env, {
    id: makeJobId("create_photo"),
    type: "CREATE_PHOTO_JOB",
    telegramUserId: userId,
    chatId,
    prompt: message.caption,
    fileIds: [fileId],
  });

  await telegram.sendMessage(chatId, "🤔 Генерирую изображение...");
  return true;
}
