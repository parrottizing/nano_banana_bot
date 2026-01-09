"""
Handler for CTR analysis feature.
Analyzes product card images to provide recommendations for improving CTR.
"""
import logging
import io
import asyncio
from telegram import Update
from telegram.ext import ContextTypes
import google.generativeai as genai
from PIL import Image
from telegram.error import BadRequest
from database import (
    get_user_state, set_user_state, clear_user_state,
    log_conversation, check_balance, deduct_balance,
    TOKEN_COSTS
)

MODEL_NAME = "gemini-3-flash-preview"

# Animation configuration
CTR_LOADING_EMOJIS = ["🔍", "✍️", "📝"]
ANIMATION_STEP_DELAY = 2.9  # Seconds between emoji changes

async def run_loading_animation(context: ContextTypes.DEFAULT_TYPE, chat_id: int):
    """
    Runs a cycling loading animation that sends, edits, and deletes messages.
    Expected to be cancelled when processing is complete.
    """
    try:
        while True:
            # Step 1: Send initial message
            msg = await context.bot.send_message(
                chat_id=chat_id, 
                text=CTR_LOADING_EMOJIS[0]
            )
            
            # Step 2: Cycle through rest of emojis
            for emoji in CTR_LOADING_EMOJIS[1:]:
                await asyncio.sleep(ANIMATION_STEP_DELAY)
                try:
                    await context.bot.edit_message_text(
                        chat_id=chat_id,
                        message_id=msg.message_id,
                        text=emoji
                    )
                except Exception:
                    # Ignore edit errors (e.g. if message was deleted)
                    pass
            
            # Step 3: Wait a bit before deleting (cycle complete)
            await asyncio.sleep(ANIMATION_STEP_DELAY)
            
            # Step 4: Delete message
            try:
                await context.bot.delete_message(
                    chat_id=chat_id,
                    message_id=msg.message_id
                )
            except Exception:
                pass
                
            # Loop continues immediately to send next message
            
    except asyncio.CancelledError:
        # Cleanup when cancelled: try to delete the last message
        try:
            if 'msg' in locals():
                await context.bot.delete_message(
                    chat_id=chat_id, 
                    message_id=msg.message_id
                )
        except Exception:
            pass
        raise


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
    
    # Set user state in database
    set_user_state(user_id, "analyze_ctr", "awaiting_ctr_image", {})
    
    # Log the button click
    log_conversation(user_id, "analyze_ctr", "button_click", "analyze_ctr")
    
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
    
    # Check if user is in CTR analysis mode (using database)
    state = get_user_state(user_id)
    if not state or state.get("feature") != "analyze_ctr" or state.get("state") != "awaiting_ctr_image":
        return False
    
    chat_id = update.effective_chat.id
    
    # Check balance before processing
    if not check_balance(user_id, TOKEN_COSTS["analyze_ctr"]):
        await context.bot.send_message(
            chat_id=chat_id,
            text=f"❌ Недостаточно токенов! Требуется: {TOKEN_COSTS['analyze_ctr']}\n"
                 "Пополните баланс для продолжения."
        )
        clear_user_state(user_id)
        return True
    
    # Clear the state
    clear_user_state(user_id)
    
    # Log the user's image submission
    log_conversation(user_id, "analyze_ctr", "user_image", "CTR analysis request", image_count=1)
    
    # Get the photo (largest size available)
    photo = update.message.photo[-1]
    
    # Start animation task
    animation_task = asyncio.create_task(run_loading_animation(context, chat_id))
    
    try:
        # Download the photo
        file = await context.bot.get_file(photo.file_id)
        photo_bytes = await file.download_as_bytearray()
        
        # Open as PIL Image for Gemini
        image = Image.open(io.BytesIO(photo_bytes))
        
        model = genai.GenerativeModel(MODEL_NAME)
        
        logging.info(f"[AnalyzeCTR] Analyzing product card image for user {user_id}")
        
        # Send image + prompt to Gemini
        response = await model.generate_content_async([CTR_ANALYSIS_PROMPT, image])
        
        # Stop animation before sending results
        animation_task.cancel()
        try:
            await animation_task
        except asyncio.CancelledError:
            pass
        
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
            
            # Deduct balance and log successful analysis
            new_balance = deduct_balance(user_id, "analyze_ctr")
            log_conversation(
                user_id, "analyze_ctr", "bot_response", result_text,
                tokens_used=TOKEN_COSTS["analyze_ctr"],
                success=True
            )
            logging.info(f"[AnalyzeCTR] Deducted {TOKEN_COSTS['analyze_ctr']} tokens from user {user_id}, new balance: {new_balance}")
        else:
            await context.bot.send_message(
                chat_id=chat_id, 
                text="❌ Не удалось проанализировать изображение. Попробуйте другое фото."
            )
            log_conversation(user_id, "analyze_ctr", "error", "Empty response from model", success=False)
        
    except Exception as e:
        # Ensure animation is stopped on error
        if not animation_task.done():
            animation_task.cancel()
            try:
                await animation_task
            except asyncio.CancelledError:
                pass
                
        logging.error(f"[AnalyzeCTR] Error: {e}", exc_info=True)
        await context.bot.send_message(chat_id=chat_id, text=f"❌ Ошибка: {e}")
        log_conversation(user_id, "analyze_ctr", "error", str(e), success=False)
    
    return True


async def handle_ctr_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    """
    Handle text message when user is in CTR analysis mode - remind them to send an image.
    Returns True if the message was handled, False otherwise.
    """
    user_id = update.effective_user.id
    
    # Check if user is in CTR analysis mode (using database)
    state = get_user_state(user_id)
    if not state or state.get("feature") != "analyze_ctr" or state.get("state") != "awaiting_ctr_image":
        return False
    
    await context.bot.send_message(
        chat_id=update.effective_chat.id,
        text="📸 Пожалуйста, отправьте *фото* карточки товара, а не текст.\n\n"
             "Я анализирую только изображения.",
        parse_mode="Markdown"
    )
    
    return True
