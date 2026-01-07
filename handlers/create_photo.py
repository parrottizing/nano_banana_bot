"""
Handler for photo creation feature.
Handles the "Создать фото" menu option.
"""
import logging
import io
from telegram import Update
from telegram.ext import ContextTypes
import google.generativeai as genai

MODEL_NAME = "gemini-3-pro-image-preview"

# Store user states for conversation flow
user_states = {}

async def create_photo_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Called when user clicks 'Создать фото' button"""
    query = update.callback_query
    await query.answer()
    
    user_id = update.effective_user.id
    user_states[user_id] = "awaiting_photo_prompt"
    
    await query.message.reply_text(
        "🎨 *Создание фото*\n\n"
        "Отправьте описание изображения, которое хотите создать.\n"
        "Например: _'Красивый закат над горами с отражением в озере'_",
        parse_mode="Markdown"
    )

async def handle_photo_prompt(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    """
    Handle incoming text when user is in photo creation mode.
    Returns True if the message was handled, False otherwise.
    """
    user_id = update.effective_user.id
    
    if user_states.get(user_id) != "awaiting_photo_prompt":
        return False
    
    user_prompt = update.message.text
    chat_id = update.effective_chat.id
    
    # Clear the state
    user_states.pop(user_id, None)
    
    await context.bot.send_message(
        chat_id=chat_id, 
        text=f"🎨 Генерирую изображение...\nМодель: {MODEL_NAME}"
    )
    
    try:
        model = genai.GenerativeModel(MODEL_NAME)
        logging.info(f"[CreatePhoto] Generating image with prompt: {user_prompt}")
        
        response = await model.generate_content_async(user_prompt)
        
        has_content = False

        # Check for image parts
        if hasattr(response, 'parts'):
            for part in response.parts:
                if hasattr(part, 'inline_data') and part.inline_data:
                    logging.info(f"[CreatePhoto] Found image with mime_type: {part.inline_data.mime_type}")
                    image_data = part.inline_data.data
                    
                    await context.bot.send_photo(
                        chat_id=chat_id, 
                        photo=io.BytesIO(image_data),
                        caption=f"🎨 Ваше изображение готово!\n\nПромпт: _{user_prompt}_",
                        parse_mode="Markdown"
                    )
                    has_content = True

        # Check for text response
        try:
            if response.text:
                await context.bot.send_message(chat_id=chat_id, text=response.text)
                has_content = True
        except ValueError:
            pass

        if not has_content:
            await context.bot.send_message(
                chat_id=chat_id, 
                text="❌ Не удалось сгенерировать изображение. Попробуйте другой запрос."
            )
        
    except Exception as e:
        logging.error(f"[CreatePhoto] Error: {e}", exc_info=True)
        await context.bot.send_message(chat_id=chat_id, text=f"❌ Ошибка: {e}")
    
    return True
