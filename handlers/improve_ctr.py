"""
Handler for CTR improvement feature.
Uses CTR analysis recommendations to generate an improved product card image.
"""
import logging
import io
from PIL import Image
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes
from database import (
    get_user_state, set_user_state, clear_user_state,
    log_conversation, check_balance, deduct_balance,
    TOKEN_COSTS, get_user
)
from .create_photo import _process_image_generation, run_loading_animation


async def start_ctr_improvement(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """
    Handle the 'Improve CTR with Nano Banana' button click.
    Retrieves stored image and recommendations, then starts image generation.
    """
    query = update.callback_query
    await query.answer()
    
    user_id = update.effective_user.id
    chat_id = update.effective_chat.id
    
    # Get stored CTR analysis data from user state
    state = get_user_state(user_id)
    
    if not state or state.get("feature") != "ctr_improvement":
        await context.bot.send_message(
            chat_id=chat_id,
            text="❌ Данные анализа не найдены. Пожалуйста, сначала проведите анализ CTR."
        )
        return
    
    state_data = state.get("state_data", {})
    image_file_id = state_data.get("image_file_id")
    recommendations = state_data.get("recommendations", "")
    
    if not image_file_id:
        await context.bot.send_message(
            chat_id=chat_id,
            text="❌ Изображение не найдено. Пожалуйста, проведите анализ CTR заново."
        )
        clear_user_state(user_id)
        return
    
    # Check balance before processing
    if not check_balance(user_id, TOKEN_COSTS["create_photo"]):
        user = get_user(user_id)
        balance = user['balance'] if user else 0
        await context.bot.send_message(
            chat_id=chat_id,
            text=f"❌ Недостаточно токенов для создания изображения!\n\n"
                 f"Требуется: {TOKEN_COSTS['create_photo']} токенов\n"
                 f"Ваш баланс: {balance} токенов"
        )
        return
    
    # Log the improvement request
    log_conversation(user_id, "improve_ctr", "button_click", "improve_ctr")
    
    # Clear the stored state
    clear_user_state(user_id)
    
    # Send processing message
    await context.bot.send_message(
        chat_id=chat_id,
        text="🚀 *Улучшаем карточку товара"
  
        parse_mode="Markdown"
    )
    
    try:
        # Download the original image using file_id
        file = await context.bot.get_file(image_file_id)
        photo_bytes = await file.download_as_bytearray()
        
        # Open as PIL Image
        image = Image.open(io.BytesIO(photo_bytes))
        
        # Build the prompt using recommendations
        improvement_prompt = _build_improvement_prompt(recommendations)
        
        logging.info(f"[ImproveCTR] Starting improvement for user {user_id}")
        logging.info(f"[ImproveCTR] Prompt: {improvement_prompt[:200]}...")
        
        # Use the existing image generation logic with the original image
        await _process_image_generation(
            update, context, 
            prompt=improvement_prompt, 
            images=[image]
        )
        
    except Exception as e:
        logging.error(f"[ImproveCTR] Error: {e}", exc_info=True)
        await context.bot.send_message(
            chat_id=chat_id,
            text=f"❌ Ошибка при улучшении изображения: {e}"
        )
        log_conversation(user_id, "improve_ctr", "error", str(e), success=False)


def _build_improvement_prompt(recommendations: str) -> str:
    """
    Build an image generation prompt based on CTR analysis recommendations.
    Extracts only the 💡 КОНКРЕТНЫЕ РЕКОМЕНДАЦИИ section.
    """
    # Extract only the recommendations section (starting with 💡)
    recommendations_section = ""
    
    if "💡" in recommendations:
        # Find the start of recommendations section
        start_idx = recommendations.find("💡")
        recommendations_section = recommendations[start_idx:]
    else:
        # Fallback: use the whole text if section not found
        recommendations_section = recommendations
    
    prompt = (
        "Улучши эту карточку товара для маркетплейса, применяя следующие рекомендации:\n\n"
        f"{recommendations_section}\n\n"
        "Создай профессиональное изображение товара с высоким CTR потенциалом. "
        "Соотношение сторон 3:4 (вертикальное). "
        "Товар должен занимать 60-70% изображения, быть в центре композиции. "
        "Используй чистый, профессиональный фон. "
        "Добавь максимум 1-2 крупных тезиса, если это уместно."
    )
    
    return prompt
