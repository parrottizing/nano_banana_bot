"""
Handler for photo creation feature.
Handles the "Создать фото" menu option with support for text and image inputs.
"""
import logging
import io
from telegram import Update
from telegram.ext import ContextTypes
import google.generativeai as genai
from google.genai import types

MODEL_NAME = "gemini-3-pro-image-preview"
MAX_IMAGES = 5
MAX_IMAGE_SIZE_MB = 7

# Store user states for conversation flow
user_states = {}

async def create_photo_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Called when user clicks 'Создать фото' button"""
    query = update.callback_query
    await query.answer()
    
    user_id = update.effective_user.id
    user_states[user_id] = {
        "mode": "awaiting_photo_input",
        "images": []
    }
    
    await query.message.reply_text(
        "🎨 *Создание фото*\n\n"
        "📝 *Вариант 1:* Отправьте текстовое описание\n"
        "Например: _'Красивый закат над горами с отражением в озере'_\n\n"
        "🖼 *Вариант 2:* Отправьте до 5 изображений с текстом в подписи\n"
        "Например: добавьте фото кота с подписью _'добавь шляпу этому коту'_",
        parse_mode="Markdown"
    )

async def handle_create_photo_image(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    """
    Handle incoming images when user is in photo creation mode.
    Returns True if the message was handled, False otherwise.
    """
    user_id = update.effective_user.id
    
    # Check if user is in photo creation mode
    if user_id not in user_states or user_states[user_id].get("mode") != "awaiting_photo_input":
        return False
    
    # Check if image has caption
    caption = update.message.caption
    if not caption:
        await context.bot.send_message(
            chat_id=update.effective_chat.id,
            text="⚠️ Пожалуйста, отправьте изображение с текстовым описанием в подписи.\n\n"
                 "Например: добавьте подпись _'добавь шляпу этому коту'_ к вашему фото.",
            parse_mode="Markdown"
        )
        return True
    
    # Check image limit
    current_images = user_states[user_id].get("images", [])
    if len(current_images) >= MAX_IMAGES:
        await context.bot.send_message(
            chat_id=update.effective_chat.id,
            text=f"⚠️ Достигнут лимит изображений ({MAX_IMAGES}). Обрабатываю..."
        )
        # Process with current images
        await _process_image_generation(update, context, caption, current_images)
        user_states.pop(user_id, None)
        return True
    
    try:
        # Get the largest photo size
        photo = update.message.photo[-1]
        
        # Check file size (Telegram gives size in bytes)
        file_size_mb = photo.file_size / (1024 * 1024) if photo.file_size else 0
        if file_size_mb > MAX_IMAGE_SIZE_MB:
            await context.bot.send_message(
                chat_id=update.effective_chat.id,
                text=f"⚠️ Изображение слишком большое ({file_size_mb:.1f}MB). Максимум {MAX_IMAGE_SIZE_MB}MB."
            )
            return True
        
        # Download the image
        file = await photo.get_file()
        image_bytes = await file.download_as_bytearray()
        
        # Store image data
        image_part = types.Part.from_bytes(
            data=bytes(image_bytes),
            mime_type='image/jpeg'
        )
        
        current_images.append(image_part)
        user_states[user_id]["images"] = current_images
        
        logging.info(f"[CreatePhoto] User {user_id} added image {len(current_images)}/{MAX_IMAGES}")
        
        # Process immediately with the caption
        await _process_image_generation(update, context, caption, current_images)
        user_states.pop(user_id, None)
        
    except Exception as e:
        logging.error(f"[CreatePhoto] Error downloading image: {e}", exc_info=True)
        await context.bot.send_message(
            chat_id=update.effective_chat.id,
            text=f"❌ Ошибка при загрузке изображения: {e}"
        )
    
    return True

async def handle_photo_prompt(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    """
    Handle incoming text when user is in photo creation mode.
    Returns True if the message was handled, False otherwise.
    """
    user_id = update.effective_user.id
    
    # Check if user is in photo creation mode
    if user_id not in user_states or user_states[user_id].get("mode") != "awaiting_photo_input":
        return False
    
    user_prompt = update.message.text
    chat_id = update.effective_chat.id
    
    # Get any images the user might have sent
    user_images = user_states[user_id].get("images", [])
    
    # Clear the state
    user_states.pop(user_id, None)
    
    # Process with text only or text + images
    await _process_image_generation(update, context, user_prompt, user_images)
    
    return True

async def _process_image_generation(update: Update, context: ContextTypes.DEFAULT_TYPE, 
                                   prompt: str, images: list):
    """
    Internal function to process image generation with optional image inputs.
    
    Args:
        update: Telegram update
        context: Telegram context
        prompt: Text prompt from user
        images: List of image Parts (can be empty)
    """
    chat_id = update.effective_chat.id
    
    # Send processing message
    processing_msg = "🎨 Генерирую изображение..."
    if images:
        img_count = len(images)
        if img_count == 1:
            processing_msg = "🎨 Обрабатываю изображение..."
        elif img_count < 5:
            processing_msg = f"🎨 Обрабатываю {img_count} изображения..."
        else:
            processing_msg = f"🎨 Обрабатываю {img_count} изображений..."
    
    await context.bot.send_message(
        chat_id=chat_id, 
        text=processing_msg
    )
    
    try:
        model = genai.GenerativeModel(MODEL_NAME)
        logging.info(f"[CreatePhoto] Generating with prompt: {prompt}, images: {len(images)}")
        
        # Build the content parts for multimodal input
        content_parts = []
        
        # Add images first (if any)
        content_parts.extend(images)
        
        # Add text prompt
        content_parts.append(prompt)
        
        # Generate content
        response = await model.generate_content_async(content_parts)
        
        has_content = False

        # Check for image parts
        if hasattr(response, 'parts'):
            for part in response.parts:
                if hasattr(part, 'inline_data') and part.inline_data:
                    logging.info(f"[CreatePhoto] Found image with mime_type: {part.inline_data.mime_type}")
                    image_data = part.inline_data.data
                    
                    caption_text = "🎨 Ваше изображение готово!\n\n"
                    if images:
                        caption_text += f"📸 Исходных изображений: {len(images)}\n"
                    caption_text += f"Промпт: _{prompt}_"
                    
                    await context.bot.send_photo(
                        chat_id=chat_id, 
                        photo=io.BytesIO(image_data),
                        caption=caption_text,
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
                text="❌ Не удалось сгенерировать изображение."
            )
        
    except Exception as e:
        logging.error(f"[CreatePhoto] Error: {e}", exc_info=True)
        await context.bot.send_message(chat_id=chat_id, text=f"❌ Ошибка: {e}")
