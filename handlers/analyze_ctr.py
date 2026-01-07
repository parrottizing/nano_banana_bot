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

MODEL_NAME = "gemini-3-flash-preview"

# Store user states for conversation flow
user_states = {}

CTR_ANALYSIS_PROMPT = """Ты эксперт по маркетплейсам (Wildberries, Ozon, Яндекс.Маркет) и визуальному дизайну карточек товаров.

Проанализируй эту карточку товара или скриншот с маркетплейса и оцени её потенциал для высокого CTR (кликабельности).

Дай детальный анализ по следующим критериям:

📊 **ОБЩАЯ ОЦЕНКА CTR**: X/10

🎯 **ЧТО РАБОТАЕТ ХОРОШО:**
- [перечисли сильные стороны карточки]

⚠️ **ЧТО НУЖНО УЛУЧШИТЬ:**
- [перечисли слабые места]

💡 **КОНКРЕТНЫЕ РЕКОМЕНДАЦИИ:**
1. [рекомендация 1]
2. [рекомендация 2]
3. [рекомендация 3]

Оценивай:
- Читаемость и размер заголовка/названия товара
- Видимость и презентация самого товара
- Цветовая гамма и контраст
- Наличие УТП (скидки, бесплатная доставка, и т.д.)
- Качество изображения
- Соответствие трендам маркетплейсов
- Информативность (цена, цвета, размеры)

Будь конкретным и практичным в рекомендациях."""


async def analyze_ctr_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Called when user clicks 'Анализ CTR' button"""
    query = update.callback_query
    await query.answer()
    
    user_id = update.effective_user.id
    user_states[user_id] = "awaiting_ctr_image"
    
    await query.message.reply_text(
        "📊 *Анализ CTR карточки товара*\n\n"
        "📸 Отправьте фото карточки товара или скриншот с маркетплейса.\n\n"
        "Я проанализирую:\n"
        "• Визуальную привлекательность\n"
        "• Читаемость заголовка\n"
        "• Качество презентации товара\n"
        "• И дам рекомендации по улучшению CTR",
        parse_mode="Markdown"
    )


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
                    await context.bot.send_message(
                        chat_id=chat_id, 
                        text=chunk,
                        parse_mode="Markdown"
                    )
            else:
                await context.bot.send_message(
                    chat_id=chat_id, 
                    text=result_text,
                    parse_mode="Markdown"
                )
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
