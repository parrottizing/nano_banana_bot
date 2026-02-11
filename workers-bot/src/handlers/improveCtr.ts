import {
  checkBalance,
  clearUserState,
  getUser,
  getUserState,
  logConversation,
  setUserState,
} from "../db/repositories";
import { TOKEN_COSTS } from "../types/domain";
import type { Env } from "../types/env";
import { TelegramClient } from "../telegram/client";
import { enqueueJob, makeJobId } from "../services/jobs";

export function buildImprovementPrompt(recommendations: string): string {
  const idx = recommendations.indexOf("💡");
  const section = idx >= 0 ? recommendations.slice(idx) : recommendations;

  return (
    "Улучши эту карточку товара для маркетплейса, применяя следующие рекомендации:\n\n" +
    `${section}\n\n` +
    "Создай профессиональное изображение товара с высоким CTR потенциалом. " +
    "Соотношение сторон 3:4 (вертикальное). " +
    "Товар должен занимать 60-70% изображения."
  );
}

export async function startImproveCtr(env: Env, telegram: TelegramClient, userId: number, chatId: number): Promise<void> {
  const state = await getUserState(env.DB, userId);
  if (!state || state.feature !== "ctr_improvement") {
    await telegram.sendMessage(chatId, "❌ Данные анализа не найдены. Пожалуйста, сначала проведите анализ CTR.");
    return;
  }
  if (state.state === "improving") {
    await telegram.sendMessage(chatId, "⏳ Улучшение уже выполняется. Подождите немного.");
    return;
  }
  if (state.state !== "ready_to_improve") {
    await telegram.sendMessage(chatId, "❌ Данные анализа не найдены. Пожалуйста, сначала проведите анализ CTR.");
    return;
  }

  const stateData = state.state_data;
  const sourceFileId = String(stateData.image_file_id ?? "");
  const recommendations = String(stateData.recommendations ?? "");

  if (!sourceFileId) {
    await telegram.sendMessage(chatId, "❌ Изображение не найдено. Проведите анализ CTR заново.");
    await clearUserState(env.DB, userId);
    return;
  }

  if (!(await checkBalance(env.DB, userId, TOKEN_COSTS.create_photo))) {
    const user = await getUser(env.DB, userId);
    await telegram.sendMessage(
      chatId,
      "❌ Недостаточно токенов для создания изображения!\n\n" +
        `Требуется: ${TOKEN_COSTS.create_photo} токенов\n` +
        `Ваш баланс: ${user?.balance ?? 0} токенов`,
    );
    return;
  }

  await setUserState(env.DB, userId, "ctr_improvement", "improving", {
    image_file_id: sourceFileId,
    recommendations,
  });
  await logConversation(env.DB, {
    telegramUserId: userId,
    feature: "improve_ctr",
    messageType: "button_click",
    content: "improve_ctr",
  });

  try {
    const loadingMessage = await telegram.sendMessage(chatId, "🤔");
    await enqueueJob(env, {
      id: makeJobId("improve_ctr"),
      type: "IMPROVE_CTR_JOB",
      telegramUserId: userId,
      chatId,
      sourceFileId,
      recommendations,
      loadingMessageId: loadingMessage.message_id,
      loadingMessageSentAtMs: Date.now(),
    });
  } catch (error) {
    await setUserState(env.DB, userId, "ctr_improvement", "ready_to_improve", {
      image_file_id: sourceFileId,
      recommendations,
    });
    await telegram.sendMessage(chatId, "❌ Не удалось запустить улучшение. Попробуйте снова.");
    await logConversation(env.DB, {
      telegramUserId: userId,
      feature: "improve_ctr",
      messageType: "error",
      content: error instanceof Error ? error.message : String(error),
      success: false,
    });
  }
}
