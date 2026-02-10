import { TOKEN_COSTS } from "../types/domain";

export function mainMenuKeyboard() {
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

export function supportKeyboard(username: string) {
  return {
    inline_keyboard: [
      [{ text: "💬 Написать в поддержку", url: `https://t.me/${username}` }],
      [{ text: "🏠 В главное меню", callback_data: "main_menu" }],
    ],
  };
}

export function balanceKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "💳 Пополнить баланс", callback_data: "buy_tokens" }],
      [{ text: "🏠 В главное меню", callback_data: "main_menu" }],
    ],
  };
}

export function createPhotoMessage(balance: number, imageCount: number): string {
  const cost = TOKEN_COSTS.create_photo * imageCount;
  return (
    "🎨 *Создание фото*\n\n" +
    "Отправьте описание изображения, которое хотите создать или отредактировать.\n\n" +
    `📸 _Вариантов: ${imageCount}_\n` +
    `💰 _Стоимость: ${cost} токенов_\n` +
    `🎫 _Ваш баланс: ${balance} токенов_`
  );
}

export function imageCountKeyboard(current?: number) {
  const withCheck = (value: number, label: string) => `${label}${current === value ? " ✓" : ""}`;
  return {
    inline_keyboard: [
      [
        { text: withCheck(1, "1️⃣"), callback_data: "set_image_count_1" },
        { text: withCheck(2, "2️⃣"), callback_data: "set_image_count_2" },
        { text: withCheck(4, "4️⃣ ⭐"), callback_data: "set_image_count_4" },
      ],
      [{ text: "🔙 Назад", callback_data: "create_photo" }],
    ],
  };
}

export function parseMarkdownOrPlain(text: string): { text: string; parse_mode: string } {
  return { text, parse_mode: "Markdown" };
}
