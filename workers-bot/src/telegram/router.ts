import {
  clearUserState,
  getOrCreateUser,
  getUser,
  logConversation,
} from "../db/repositories";
import { TOKEN_COSTS } from "../types/domain";
import type { Env } from "../types/env";
import type { TelegramUpdate } from "../types/telegram";
import { TelegramClient } from "./client";
import {
  createPhotoEntry,
  handleCreatePhotoImage,
  handleCreatePhotoText,
  handleSetImageCount,
  handleSetImageModel,
  showChangeImageCountMenu,
  showChangeImageModelMenu,
} from "../handlers/createPhoto";
import {
  analyzeCtrEntry,
  handleAnalyzeCtrPhoto,
  handleAnalyzeCtrText,
} from "../handlers/analyzeCtr";
import { startImproveCtr } from "../handlers/improveCtr";
import {
  handleReceiptEmailNonText,
  handleReceiptEmailText,
  sendPackagePaymentLink,
  startBuyTokensFlow,
} from "../handlers/payments";
import { DEFAULT_MENU_BANNER_BASE64 } from "../assets/menuBannerBase64";

function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "🎨 Создать фото", callback_data: "create_photo" },
        { text: "📊 Анализ CTR", callback_data: "analyze_ctr" },
      ],
      [
        { text: "💰 Баланс", callback_data: "balance" },
        { text: "🆘 Поддержка", callback_data: "support" },
      ],
    ],
  };
}

export async function showStart(env: Env, telegram: TelegramClient, userId: number, chatId: number, firstName?: string): Promise<void> {
  await clearUserState(env.DB, userId);
  await getOrCreateUser(env.DB, userId);

  await logConversation(env.DB, {
    telegramUserId: userId,
    feature: "start",
    messageType: "command",
    content: "/start",
  });

  const welcomeText = `Привет, ${firstName ?? "друг"}! 👋\n\nЯ помогу сделать карточки товаров привлекательнее.`;

  if (env.MENU_BANNER_URL) {
    await telegram.sendPhoto(chatId, env.MENU_BANNER_URL, {
      caption: welcomeText,
      reply_markup: mainMenuKeyboard(),
    }, true);
    return;
  }

  await telegram.sendPhoto(chatId, DEFAULT_MENU_BANNER_BASE64, {
    caption: welcomeText,
    reply_markup: mainMenuKeyboard(),
  });

  return;
}

export async function showSupport(env: Env, telegram: TelegramClient, userId: number, chatId: number): Promise<void> {
  await clearUserState(env.DB, userId);
  await telegram.sendMessage(
    chatId,
    "🆘 *Поддержка*\n\n📝 Опишите проблему подробно — так мы поможем быстрее\n🤝 Будем рады вашей обратной связи!",
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "💬 Написать в поддержку", url: `https://t.me/${env.SUPPORT_USERNAME}` }],
          [{ text: "🏠 В главное меню", callback_data: "main_menu" }],
        ],
      },
    },
  );
}

export async function showBalance(env: Env, telegram: TelegramClient, userId: number, chatId: number): Promise<void> {
  const user = await getOrCreateUser(env.DB, userId);

  await telegram.sendMessage(
    chatId,
    "💰 *Ваш баланс*\n\n" +
      `🎫 У вас *${user.balance}* токенов\n\n` +
      "📝 Стоимость операций:\n" +
      `• Создание фото — ${TOKEN_COSTS.create_photo} токенов\n` +
      `• Анализ CTR — ${TOKEN_COSTS.analyze_ctr} токенов`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "💳 Пополнить баланс", callback_data: "buy_tokens" }],
          [{ text: "🏠 В главное меню", callback_data: "main_menu" }],
        ],
      },
    },
  );
}

export async function routeUpdate(env: Env, update: TelegramUpdate): Promise<void> {
  const telegram = new TelegramClient(env);
  const fallbackChatId = update.callback_query?.message?.chat.id ?? update.message?.chat.id;

  try {

    if (update.callback_query) {
      const query = update.callback_query;
      const callback = query.data ?? "";
      const userId = query.from.id;
      const chatId = query.message?.chat.id;
      if (!chatId) {
        return;
      }

      await getOrCreateUser(env.DB, userId, query.from.username, query.from.first_name);
      await telegram.answerCallbackQuery(query.id);

      switch (callback) {
        case "create_photo":
          await createPhotoEntry(env, telegram, userId, chatId);
          return;
        case "analyze_ctr":
          await analyzeCtrEntry(env, telegram, userId, chatId);
          return;
        case "improve_ctr":
          await startImproveCtr(env, telegram, userId, chatId);
          return;
        case "change_image_count":
          await showChangeImageCountMenu(env, telegram, userId, chatId);
          return;
        case "change_image_model":
          await showChangeImageModelMenu(env, telegram, userId, chatId);
          return;
        case "set_image_count_1":
          await handleSetImageCount(env, telegram, userId, chatId, 1);
          return;
        case "set_image_count_2":
          await handleSetImageCount(env, telegram, userId, chatId, 2);
          return;
        case "set_image_count_4":
          await handleSetImageCount(env, telegram, userId, chatId, 4);
          return;
        case "set_image_model_nano_pro":
          await handleSetImageModel(env, telegram, userId, chatId, "nano_pro");
          return;
        case "set_image_model_nano_flash":
          await handleSetImageModel(env, telegram, userId, chatId, "nano_flash");
          return;
        case "set_image_model_chatgpt_image_1_5":
          await handleSetImageModel(env, telegram, userId, chatId, "chatgpt_image_1_5");
          return;
        case "balance":
          await showBalance(env, telegram, userId, chatId);
          return;
        case "buy_tokens":
          await startBuyTokensFlow(env, telegram, userId, chatId);
          return;
        case "support":
          await showSupport(env, telegram, userId, chatId);
          return;
        case "main_menu":
          await showStart(env, telegram, userId, chatId, query.from.first_name);
          return;
        default:
          if (callback.startsWith("buy_")) {
            const packageId = callback.replace("buy_", "");
            await sendPackagePaymentLink(env, telegram, userId, chatId, packageId);
            return;
          }
          await telegram.sendMessage(chatId, "❌ Неизвестная команда.");
          return;
      }
    }

    if (!update.message) {
      return;
    }

    const message = update.message;
    const text = message.text;
    const userId = message.from?.id;
    const chatId = message.chat.id;
    if (!userId) {
      return;
    }

    await getOrCreateUser(env.DB, userId, message.from?.username, message.from?.first_name);

    if (typeof text === "string") {
      const startMatch = text.match(/^\/start(?:\s+(.+))?$/);
      if (startMatch) {
        const startPayload = startMatch[1]?.trim();
        if (startPayload === "sbp_return") {
          return;
        }
        await showStart(env, telegram, userId, chatId, message.from?.first_name);
        return;
      }
    }
    if (text === "/support") {
      await showSupport(env, telegram, userId, chatId);
      return;
    }
    if (text === "/balance") {
      await showBalance(env, telegram, userId, chatId);
      return;
    }
    if (text === "/create_photo") {
      await createPhotoEntry(env, telegram, userId, chatId);
      return;
    }
    if (text === "/analyze_ctr") {
      await analyzeCtrEntry(env, telegram, userId, chatId);
      return;
    }

    if (typeof text === "string" && text.length > 0) {
      if (await handleReceiptEmailText(env, telegram, userId, chatId, text)) {
        return;
      }
    }

    if (message.photo?.length) {
      if (await handleReceiptEmailNonText(env, telegram, userId, chatId)) {
        return;
      }
      if (await handleCreatePhotoImage(env, telegram, userId, chatId, message)) {
        return;
      }
      if (await handleAnalyzeCtrPhoto(env, telegram, userId, chatId, message)) {
        return;
      }
      await telegram.sendMessage(chatId, "👆 Используйте /start для открытия меню.");
      return;
    }

    if (typeof text === "string" && text.length > 0) {
      if (await handleCreatePhotoText(env, telegram, userId, chatId, text)) {
        return;
      }
      if (await handleAnalyzeCtrText(env, telegram, userId, chatId)) {
        return;
      }
      await telegram.sendMessage(chatId, "👆 Используйте /start для открытия меню.");
      return;
    }

    if (await handleReceiptEmailNonText(env, telegram, userId, chatId)) {
      return;
    }

    const user = await getUser(env.DB, userId);
    if (!user) {
      await telegram.sendMessage(chatId, "👆 Используйте /start для открытия меню.");
    }
  } catch (error) {
    console.error("Failed to process Telegram update", error);
    if (fallbackChatId) {
      await telegram.sendMessage(fallbackChatId, "❌ Произошла ошибка. Попробуйте еще раз.");
    }
  }
}
