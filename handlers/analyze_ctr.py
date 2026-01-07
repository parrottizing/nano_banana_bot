"""
Handler for CTR analysis feature.
Handles the "Анализ CTR" menu option.
"""
import logging
from telegram import Update
from telegram.ext import ContextTypes
import google.generativeai as genai

MODEL_NAME = "gemini-3-pro-image-preview"

# Store user states for conversation flow
user_states = {}

async def analyze_ctr_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Called when user clicks 'Анализ CTR' button"""
    query = update.callback_query
    await query.answer()
    
    user_id = update.effective_user.id
    user_states[user_id] = "awaiting_ctr_data"
    
    await query.message.reply_text(
        "📊 *Анализ CTR*\n\n"
        "Отправьте данные для анализа CTR.\n"
        "Вы можете отправить:\n"
        "• Текстовое описание рекламной кампании\n"
        "• Статистику показов и кликов\n"
        "• Скриншот рекламного кабинета",
        parse_mode="Markdown"
    )

async def handle_ctr_data(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    """
    Handle incoming text when user is in CTR analysis mode.
    Returns True if the message was handled, False otherwise.
    """
    user_id = update.effective_user.id
    
    if user_states.get(user_id) != "awaiting_ctr_data":
        return False
    
    user_data = update.message.text
    chat_id = update.effective_chat.id
    
    # Clear the state
    user_states.pop(user_id, None)
    
    await context.bot.send_message(
        chat_id=chat_id, 
        text="📊 Анализирую данные CTR..."
    )
    
    try:
        model = genai.GenerativeModel(MODEL_NAME)
        
        # Create a prompt for CTR analysis
        analysis_prompt = f"""Проанализируй следующие данные о CTR (Click-Through Rate) рекламной кампании. 
Дай рекомендации по улучшению показателей.

Данные от пользователя:
{user_data}

Пожалуйста, предоставь:
1. Анализ текущих показателей
2. Сравнение с отраслевыми стандартами
3. Конкретные рекомендации по улучшению CTR
4. Возможные причины низкого/высокого CTR"""

        logging.info(f"[AnalyzeCTR] Analyzing CTR data")
        
        response = await model.generate_content_async(analysis_prompt)
        
        if response.text:
            await context.bot.send_message(
                chat_id=chat_id, 
                text=f"📊 *Результат анализа CTR:*\n\n{response.text}",
                parse_mode="Markdown"
            )
        else:
            await context.bot.send_message(
                chat_id=chat_id, 
                text="❌ Не удалось проанализировать данные. Попробуйте отправить больше информации."
            )
        
    except Exception as e:
        logging.error(f"[AnalyzeCTR] Error: {e}", exc_info=True)
        await context.bot.send_message(chat_id=chat_id, text=f"❌ Ошибка: {e}")
    
    return True
