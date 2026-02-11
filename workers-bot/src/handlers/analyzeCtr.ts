import {
  checkBalance,
  clearUserState,
  getOrCreateUser,
  getUser,
  getUserState,
  logConversation,
  setUserState,
} from "../db/repositories";
import { TOKEN_COSTS } from "../types/domain";
import type { Env } from "../types/env";
import { TelegramClient } from "../telegram/client";
import type { TelegramMessage } from "../types/telegram";
import { enqueueJob, makeJobId } from "../services/jobs";

export const CTR_ANALYSIS_PROMPT = `Ты эксперт по маркетплейсам (Wildberries, Ozon, Яндекс.Маркет) и визуальному дизайну карточек товаров.\n\nПроанализируй эту карточку товара или скриншот с маркетплейса и оцени её потенциал для высокого CTR (кликабельности).\n\nДай детальный анализ по критериям и рекомендации.\n\nНЕ начинай с приветствий.`;

export async function analyzeCtrEntry(env: Env, telegram: TelegramClient, userId: number, chatId: number): Promise<void> {
  await getOrCreateUser(env.DB, userId);
  await setUserState(env.DB, userId, "analyze_ctr", "awaiting_ctr_image", {});

  const user = await getUser(env.DB, userId);

  await logConversation(env.DB, {
    telegramUserId: userId,
    feature: "analyze_ctr",
    messageType: "button_click",
    content: "analyze_ctr",
  });

  await telegram.sendMessage(
    chatId,
    "📊 *Анализ CTR карточки товара*\n\n" +
      "📸 Отправьте фото карточки товара или скриншот с маркетплейса.\n\n" +
      `_Стоимость: ${TOKEN_COSTS.analyze_ctr} токенов_\n` +
      `_Ваш баланс: ${user?.balance ?? 0} токенов_`,
    { parse_mode: "Markdown" },
  );
}

export async function handleAnalyzeCtrText(
  env: Env,
  telegram: TelegramClient,
  userId: number,
  chatId: number,
): Promise<boolean> {
  const state = await getUserState(env.DB, userId);
  if (!state || state.feature !== "analyze_ctr" || state.state !== "awaiting_ctr_image") {
    return false;
  }

  await telegram.sendMessage(
    chatId,
    "📸 Пожалуйста, отправьте *фото* карточки товара, а не текст.\n\nЯ анализирую только изображения.",
    { parse_mode: "Markdown" },
  );
  return true;
}

export async function handleAnalyzeCtrPhoto(
  env: Env,
  telegram: TelegramClient,
  userId: number,
  chatId: number,
  message: TelegramMessage,
): Promise<boolean> {
  const state = await getUserState(env.DB, userId);
  if (!state || state.feature !== "analyze_ctr" || state.state !== "awaiting_ctr_image") {
    return false;
  }

  if (!(await checkBalance(env.DB, userId, TOKEN_COSTS.analyze_ctr))) {
    await telegram.sendMessage(
      chatId,
      `❌ Недостаточно токенов! Требуется: ${TOKEN_COSTS.analyze_ctr}\nПополните баланс для продолжения.`,
    );
    await clearUserState(env.DB, userId);
    return true;
  }

  const fileId = message.photo?.[message.photo.length - 1]?.file_id;
  if (!fileId) {
    await telegram.sendMessage(chatId, "⚠️ Не удалось прочитать изображение.");
    return true;
  }

  await clearUserState(env.DB, userId);

  await logConversation(env.DB, {
    telegramUserId: userId,
    feature: "analyze_ctr",
    messageType: "user_image",
    content: "CTR analysis request",
    imageCount: 1,
  });

  const loadingMessage = await telegram.sendMessage(chatId, "🔍");
  await enqueueJob(env, {
    id: makeJobId("analyze_ctr"),
    type: "ANALYZE_CTR_JOB",
    telegramUserId: userId,
    chatId,
    fileId,
    loadingMessageId: loadingMessage.message_id,
    loadingMessageSentAtMs: Date.now(),
  });
  return true;
}
