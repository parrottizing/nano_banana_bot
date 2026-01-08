"""
Handler for CTR analysis feature.
Analyzes product card images to provide recommendations for improving CTR.
"""
import logging
import io
from telegram import Update
from telegram.ext import ContextTypes
import google.generativeai as genai
from PIL import Image
from telegram.error import BadRequest

MODEL_NAME = "gemini-3-flash-preview"


async def safe_send_message(bot, chat_id: int, text: str, parse_mode: str = "Markdown"):
    """
    Safely send a message with fallback to plain text if Markdown parsing fails.
    This handles cases where AI-generated content has malformed Markdown entities.
    """
    try:
        await bot.send_message(chat_id=chat_id, text=text, parse_mode=parse_mode)
    except BadRequest as e:
        if "Can't parse entities" in str(e):
            # Fallback to plain text if Markdown parsing fails
            logging.warning(f"[AnalyzeCTR] Markdown parsing failed, sending as plain text: {e}")
            await bot.send_message(chat_id=chat_id, text=text, parse_mode=None)
        else:
            raise

# Store user states for conversation flow
user_states = {}

CTR_ANALYSIS_PROMPT = """Ты эксперт по маркетплейсам (Wildberries, Ozon, Яндекс.Маркет) и визуальному дизайну карточек товаров.

Проанализируй эту карточку товара или скриншот с маркетплейса и оцени её потенциал для высокого CTR (кликабельности).

Дай детальный анализ по следующим критериям:

📊 ОБЩАЯ ОЦЕНКА CTR: X/10

🎯 ЧТО РАБОТАЕТ ХОРОШО:
• [перечисли сильные стороны карточки]

⚠️ ЧТО НУЖНО УЛУЧШИТЬ:
• [перечисли слабые места]

💡 КОНКРЕТНЫЕ РЕКОМЕНДАЦИИ:
1. [рекомендация 1]
2. [рекомендация 2]
3. [рекомендация 3]

Оценивай:
• Читаемость и размер заголовка/названия товара
• Видимость и презентация самого товара
• Цветовая гамма и контраст
• Наличие УТП (скидки, бесплатная доставка, и т.д.)
• Качество изображения
• Соответствие трендам маркетплейсов
• Информативность (цена, цвета, размеры)

Будь конкретным и практичным в рекомендациях.

ВАЖНО - Правила форматирования для Telegram:
• Используй *одинарные звёздочки* для жирного текста
• Используй _нижние подчёркивания_ для курсива  
• НЕ используй ** (двойные звёздочки)
• НЕ используй # для заголовков
• НЕ используй --- для разделителей
• НЕ используй - для списков, используй • или числа
• Эмодзи можно использовать свободно"""


async def analyze_ctr_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Called when user clicks 'Анализ CTR' button or uses /analyze_ctr command"""
    user_id = update.effective_user.id
    user_states[user_id] = "awaiting_ctr_image"
    
    message_text = (
        "📊 *Анализ CTR карточки товара*\n\n"
        "📸 Отправьте фото карточки товара или скриншот с маркетплейса.\n\n"
    )
    
    # Check if this is a callback query (inline button) or a command
    if update.callback_query:
        query = update.callback_query
        await query.answer()
        await query.message.reply_text(message_text, parse_mode="Markdown")
    else:
        # This is a direct command (from menu or typed)
        await update.message.reply_text(message_text, parse_mode="Markdown")


async def handle_ctr_photo(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    """
    Handle incoming photo when user is in CTR analysis mode.
    Returns True if the message was handled, False otherwise.
    """
    user_id = update.effective_user.id
    
    if user_states.get(user_id) != "awaiting_ctr_image":
        return False
    
    chat_id = update.effective_chat.id
    
    # Clear the state
    user_states.pop(user_id, None)
    
    # Get the photo (largest size available)
    photo = update.message.photo[-1]
    
    await context.bot.send_message(
        chat_id=chat_id, 
        text="📊 Анализирую карточку товара..."
    )
    
    try:
        # Download the photo
        file = await context.bot.get_file(photo.file_id)
        photo_bytes = await file.download_as_bytearray()
        
        # Open as PIL Image for Gemini
        image = Image.open(io.BytesIO(photo_bytes))
        
        model = genai.GenerativeModel(MODEL_NAME)
        
        logging.info(f"[AnalyzeCTR] Analyzing product card image")
        
        # Send image + prompt to Gemini
        response = await model.generate_content_async([CTR_ANALYSIS_PROMPT, image])
        
        if response.text:
            # Split long messages if needed (Telegram limit is 4096 chars)
            result_text = f"📊 *Результат анализа CTR:*\n\n{response.text}"
            
            if len(result_text) > 4096:
                # Split into chunks
                for i in range(0, len(result_text), 4096):
                    chunk = result_text[i:i+4096]
                    await safe_send_message(context.bot, chat_id, chunk, parse_mode="Markdown")
            else:
                await safe_send_message(context.bot, chat_id, result_text, parse_mode="Markdown")
        else:
            await context.bot.send_message(
                chat_id=chat_id, 
                text="❌ Не удалось проанализировать изображение. Попробуйте другое фото."
            )
        
    except Exception as e:
        logging.error(f"[AnalyzeCTR] Error: {e}", exc_info=True)
        await context.bot.send_message(chat_id=chat_id, text=f"❌ Ошибка: {e}")
    
    return True


async def handle_ctr_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    """
    Handle text message when user is in CTR analysis mode - remind them to send an image.
    Returns True if the message was handled, False otherwise.
    """
    user_id = update.effective_user.id
    
    if user_states.get(user_id) != "awaiting_ctr_image":
        return False
    
    await context.bot.send_message(
        chat_id=update.effective_chat.id,
        text="📸 Пожалуйста, отправьте *фото* карточки товара, а не текст.\n\n"
             "Я анализирую только изображения.",
        parse_mode="Markdown"
    )
    
    return True
