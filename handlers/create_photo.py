"""
Handler for photo creation feature.
Handles the "Создать фото" menu option with support for text and image inputs.
"""
import logging
import io
import asyncio
from PIL import Image
from telegram import Update
from telegram.ext import ContextTypes
from .laozhang_client import generate_image as laozhang_generate_image
from .prompt_classifier import analyze_user_intent
from database import (
    get_user_state, set_user_state, clear_user_state,
    log_conversation, check_balance, deduct_balance,
    update_user_balance, TOKEN_COSTS, get_user,
    get_user_image_count, set_user_image_count,
    should_show_image_count_prompt, mark_image_count_prompt_seen
)
from telegram import InlineKeyboardButton, InlineKeyboardMarkup

# Model is now configured in laozhang_client.py
MAX_IMAGES = 5
MAX_IMAGE_SIZE_MB = 7

# Animation configuration
PHOTO_LOADING_EMOJIS = ["🤔", "💡", "🎨"]
ANIMATION_STEP_DELAY = 2.9  # Seconds between emoji changes

# Media group (album) configuration
MEDIA_GROUP_TIMEOUT = 1.5  # Seconds to wait for more images in album

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
                text=PHOTO_LOADING_EMOJIS[0]
            )
            
            # Step 2: Cycle through rest of emojis
            for emoji in PHOTO_LOADING_EMOJIS[1:]:
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

# CTR optimization prompt enhancement (based on marketplace best practices 2025)
CTR_ENHANCEMENT_PROMPT = """
КРИТИЧЕСКИ ВАЖНО: Пользователь хочет улучшить CTR (кликабельность) для маркетплейса (Wildberries, Ozon, Яндекс.Маркет).

ПРИМЕНЯЙ СТРАТЕГИЮ "УМНОГО МИНИМАЛИЗМА" (2025):

**ВИЗУАЛЬНАЯ ИЕРАРХИЯ:**
• Товар должен занимать минимум 60-70% площади изображения
• Товар в центре композиции с максимальной читаемостью деталей
• Высокий контраст между товаром и фоном

**ТИПОГРАФИКА И ТЕКСТ:**
• Только 1-2 КРУПНЫХ тезиса (жирный шрифт без засечек)
• Читаемость на мобильных устройствах (80%+ трафика)
• Используй ФАКТЫ вместо субъективных оценок: "5000 продаж", "Рейтинг 4.9" вместо "Лучший"
• НЕ размещай текст в слепых зонах: верхние углы, нижняя часть (там интерфейс WB)

**ЦВЕТОВАЯ СТРАТЕГИЯ:**
• Ограниченная палитра: основной цвет бренда + 1 акцентный цвет
• Избегай кислотных/кричащих цветов (устаревший тренд)
• Цвета должны вызывать доверие и премиальность

**ТЕХНИЧЕСКИЕ ТРЕБОВАНИЯ:**
• Соотношение сторон: строго 3:4 (вертикальная ориентация)
• Высокое разрешение для возможности зума (минимум 1000x1000px)
• Товар занимает НЕ МЕНЕЕ 20% площади (требование WB)

**ПСИХОЛОГИЯ ВОСПРИЯТИЯ:**
• Фокус на ключевых преимуществах товара (материал, технология, УТП)
• Визуализация выгоды для клиента (не просто "водонепроницаемый", а "защита в дождь до -30°C")
• Акцент на 1-2 главных характеристиках, которые решают проблему покупателя

**ЗАПРЕЩЕНО:**
• Размытые/перегруженные композиции
• Множество мелких надписей и значков ("ХИТ", "СКИДКА" и т.п.)
• Указание цены на изображении
• Перекрытие товара избыточной графикой
• Субъективные превосходные степени без подтверждения

ЦЕЛЬ: Создать изображение, которое мгновенно привлекает внимание, передает суть товара за 0.5 секунды просмотра и вызывает желание кликнуть для изучения деталей.
"""



async def create_photo_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Called when user clicks 'Создать фото' button or uses /create_photo command"""
    user_id = update.effective_user.id
    
    # Check if user should see one-time image count selection prompt
    if should_show_image_count_prompt(user_id):
        await _show_image_count_selection(update, context, user_id)
        return
    
    # Set user state in database
    set_user_state(user_id, "create_photo", "awaiting_photo_input", {"images": []})
    
    # Log the button click
    log_conversation(user_id, "create_photo", "button_click", "create_photo")
    
    # Get user data for display
    user = get_user(user_id)
    balance = user['balance'] if user else 0
    image_count = get_user_image_count(user_id)
    cost = TOKEN_COSTS["create_photo"] * image_count
    
    message_text = (
        "🎨 *Создание фото*\n\n"
        "Отправьте описание изображения, которое хотите создать или отредактировать.\n\n"
        f"📸 _Вариантов: {image_count}_\n"
        f"💰 _Стоимость: {cost} токенов_\n"
        f"🎫 _Ваш баланс: {balance} токенов_"
    )
    
    # Add button to change image count setting
    keyboard = [[InlineKeyboardButton("⚙️ Изменить кол-во вариантов", callback_data="change_image_count")]]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    # Check if this is a callback query (inline button) or a command
    if update.callback_query:
        query = update.callback_query
        await query.answer()
        await query.message.reply_text(message_text, parse_mode="Markdown", reply_markup=reply_markup)
    else:
        # This is a direct command (from menu or typed)
        await update.message.reply_text(message_text, parse_mode="Markdown", reply_markup=reply_markup)


async def _show_image_count_selection(update: Update, context: ContextTypes.DEFAULT_TYPE, user_id: int):
    """
    Show the one-time image count selection prompt.
    This is displayed once when user first buys tokens.
    """
    message_text = (
        "🎨 *Сколько изображений создавать за раз?*\n\n"
        "AI-генерация — творческий процесс. Чем больше вариантов, "
        "тем выше шанс найти идеальный результат.\n\n"
        "• 1 вариант — 25 токенов\n"
        "• 2 варианта — 50 токенов\n"
        "• 4 варианта — 100 токенов ⭐\n\n"
        "_💡 Изменить можно в любой момент_"
    )
    
    keyboard = [
        [
            InlineKeyboardButton("1️⃣", callback_data="set_image_count_1"),
            InlineKeyboardButton("2️⃣", callback_data="set_image_count_2"),
            InlineKeyboardButton("4️⃣ ⭐", callback_data="set_image_count_4"),
        ]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    if update.callback_query:
        query = update.callback_query
        await query.answer()
        await query.message.reply_text(message_text, parse_mode="Markdown", reply_markup=reply_markup)
    else:
        await update.message.reply_text(message_text, parse_mode="Markdown", reply_markup=reply_markup)


async def handle_image_count_selection(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """
    Handle image count selection from inline buttons.
    Called for callbacks: set_image_count_1, set_image_count_2, set_image_count_4
    """
    query = update.callback_query
    user_id = update.effective_user.id
    
    # Parse the selected count from callback data
    count_str = query.data.replace("set_image_count_", "")
    count = int(count_str)
    
    # Save the preference
    set_user_image_count(user_id, count)
    mark_image_count_prompt_seen(user_id)
    
    await query.answer(f"✅ Установлено: {count} вариант(ов)")
    
    # Now proceed to create_photo flow
    await create_photo_handler(update, context)


async def show_change_image_count_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """
    Show menu to change image count setting (accessible anytime).
    """
    query = update.callback_query
    user_id = update.effective_user.id
    current_count = get_user_image_count(user_id)
    
    await query.answer()
    
    # Build labels with checkmark for current selection
    labels = {
        1: "1️⃣" + (" ✓" if current_count == 1 else ""),
        2: "2️⃣" + (" ✓" if current_count == 2 else ""),
        4: "4️⃣ ⭐" + (" ✓" if current_count == 4 else ""),
    }
    
    message_text = (
        "⚙️ *Количество изображений*\n\n"
        f"Сейчас: *{current_count}* вариант(ов)\n\n"
        "• 1 вариант — 25 токенов\n"
        "• 2 варианта — 50 токенов\n"
        "• 4 варианта — 100 токенов\n\n"
        "_Больше вариантов = выше шанс на идеальный результат_"
    )
    
    keyboard = [
        [
            InlineKeyboardButton(labels[1], callback_data="set_image_count_1"),
            InlineKeyboardButton(labels[2], callback_data="set_image_count_2"),
            InlineKeyboardButton(labels[4], callback_data="set_image_count_4"),
        ],
        [InlineKeyboardButton("🔙 Назад", callback_data="create_photo")]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    await query.message.reply_text(message_text, parse_mode="Markdown", reply_markup=reply_markup)

async def _collect_media_group_image(update: Update, context: ContextTypes.DEFAULT_TYPE, 
                                     media_group_id: str, caption: str | None) -> bool:
    """
    Collect images from a media group (album) and schedule delayed processing.
    Returns True if image was collected successfully.
    """
    user_id = update.effective_user.id
    chat_id = update.effective_chat.id
    group_key = f"media_group_{media_group_id}"
    timer_key = f"{group_key}_timer"
    
    # Cancel previous timer if exists (more images arriving)
    if timer_key in context.user_data and context.user_data[timer_key]:
        context.user_data[timer_key].cancel()
        context.user_data[timer_key] = None
    
    try:
        # Get the largest photo size
        photo = update.message.photo[-1]
        
        # Check file size
        file_size_mb = photo.file_size / (1024 * 1024) if photo.file_size else 0
        if file_size_mb > MAX_IMAGE_SIZE_MB:
            logging.warning(f"[CreatePhoto] Skipping large image ({file_size_mb:.1f}MB) in media group")
            return False
        
        # Download the image
        file = await photo.get_file()
        image_bytes = await file.download_as_bytearray()
        image = Image.open(io.BytesIO(image_bytes))
        
        # Initialize group storage if needed
        if group_key not in context.user_data:
            context.user_data[group_key] = {"images": [], "caption": None, "update": update}
        
        # Check limit
        if len(context.user_data[group_key]["images"]) >= MAX_IMAGES:
            logging.warning(f"[CreatePhoto] Media group reached limit ({MAX_IMAGES})")
            return False
        
        # Add image to collection
        context.user_data[group_key]["images"].append(image)
        
        # Store caption from first image that has one
        if caption and not context.user_data[group_key]["caption"]:
            context.user_data[group_key]["caption"] = caption
        
        # Keep reference to latest update for processing
        context.user_data[group_key]["update"] = update
        
        logging.info(f"[CreatePhoto] Collected image {len(context.user_data[group_key]['images'])}/{MAX_IMAGES} "
                    f"for media group {media_group_id}")
        
        # Schedule processing after timeout
        async def process_after_timeout():
            try:
                await asyncio.sleep(MEDIA_GROUP_TIMEOUT)
                await _process_collected_media_group(context, user_id, chat_id, group_key)
            except asyncio.CancelledError:
                pass  # Timer was cancelled, more images coming
        
        task = asyncio.create_task(process_after_timeout())
        context.user_data[timer_key] = task
        
        return True
        
    except Exception as e:
        logging.error(f"[CreatePhoto] Error collecting media group image: {e}", exc_info=True)
        return False


async def _process_collected_media_group(context: ContextTypes.DEFAULT_TYPE, 
                                         user_id: int, chat_id: int, group_key: str):
    """
    Process all collected images from a media group after timeout.
    """
    timer_key = f"{group_key}_timer"
    
    # Get collected data
    group_data = context.user_data.get(group_key)
    if not group_data:
        logging.warning(f"[CreatePhoto] No data found for {group_key}")
        return
    
    images = group_data.get("images", [])
    caption = group_data.get("caption")
    update = group_data.get("update")
    
    # Cleanup
    context.user_data.pop(group_key, None)
    context.user_data.pop(timer_key, None)
    
    if not images:
        logging.warning(f"[CreatePhoto] No images in media group {group_key}")
        return
    
    if not caption:
        await context.bot.send_message(
            chat_id=chat_id,
            text="⚠️ Пожалуйста, добавьте описание к вашим изображениям.\n\n"
                 "Отправьте изображения снова с подписью.",
            parse_mode="Markdown"
        )
        clear_user_state(user_id)
        return
    
    logging.info(f"[CreatePhoto] Processing media group with {len(images)} images")
    
    # Check balance
    image_count = get_user_image_count(user_id)
    total_cost = TOKEN_COSTS["create_photo"] * image_count
    if not check_balance(user_id, total_cost):
        await context.bot.send_message(
            chat_id=chat_id,
            text=f"❌ Недостаточно токенов! Требуется: {total_cost} ({image_count} вариантов)\n"
                 "Пополните баланс для продолжения."
        )
        clear_user_state(user_id)
        return
    
    # Process all images together
    await _process_image_generation(update, context, caption, images)
    clear_user_state(user_id)


async def handle_create_photo_image(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    """
    Handle incoming images when user is in photo creation mode.
    Supports both single images and media groups (albums) with up to MAX_IMAGES images.
    Returns True if the message was handled, False otherwise.
    """
    user_id = update.effective_user.id
    
    # Check if user is in photo creation mode (using database)
    state = get_user_state(user_id)
    if not state or state.get("feature") != "create_photo" or state.get("state") != "awaiting_photo_input":
        return False
    
    caption = update.message.caption
    media_group_id = update.message.media_group_id
    
    # Handle media group (album) - collect images and process after timeout
    if media_group_id:
        await _collect_media_group_image(update, context, media_group_id, caption)
        return True
    
    # Single image - require caption
    if not caption:
        await context.bot.send_message(
            chat_id=update.effective_chat.id,
            text="⚠️ Пожалуйста, отправьте изображение с текстовым описанием в подписи.\n\n"
                 "Например: добавьте подпись _'добавь шляпу этому коту'_ к вашему фото.",
            parse_mode="Markdown"
        )
        return True
    
    # Check balance before processing (cost depends on image count setting)
    image_count = get_user_image_count(user_id)
    total_cost = TOKEN_COSTS["create_photo"] * image_count
    if not check_balance(user_id, total_cost):
        await context.bot.send_message(
            chat_id=update.effective_chat.id,
            text=f"❌ Недостаточно токенов! Требуется: {total_cost} ({image_count} вариантов)\n"
                 "Пополните баланс для продолжения."
        )
        clear_user_state(user_id)
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
        
        # Open with PIL to ensure proper format
        image = Image.open(io.BytesIO(image_bytes))
        
        logging.info(f"[CreatePhoto] User {user_id} sent single image with caption")
        
        # Process immediately with single image
        await _process_image_generation(update, context, caption, [image])
        clear_user_state(user_id)
        
    except Exception as e:
        logging.error(f"[CreatePhoto] Error downloading image: {e}", exc_info=True)
        await context.bot.send_message(
            chat_id=update.effective_chat.id,
            text=f"❌ Ошибка при загрузке изображения: {e}"
        )
        log_conversation(user_id, "create_photo", "error", str(e), success=False)
    
    return True


async def handle_photo_prompt(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    """
    Handle incoming text when user is in photo creation mode.
    Returns True if the message was handled, False otherwise.
    """
    user_id = update.effective_user.id
    
    # Check if user is in photo creation mode (using database)
    state = get_user_state(user_id)
    if not state or state.get("feature") != "create_photo" or state.get("state") != "awaiting_photo_input":
        return False
    
    # Check balance before processing (cost depends on image count setting)
    image_count = get_user_image_count(user_id)
    total_cost = TOKEN_COSTS["create_photo"] * image_count
    if not check_balance(user_id, total_cost):
        await context.bot.send_message(
            chat_id=update.effective_chat.id,
            text=f"❌ Недостаточно токенов! Требуется: {total_cost} ({image_count} вариантов)\n"
                 "Пополните баланс для продолжения."
        )
        clear_user_state(user_id)
        return True
    
    user_prompt = update.message.text
    chat_id = update.effective_chat.id
    
    # Get any images the user might have sent (from context.user_data)
    user_images = context.user_data.get("pending_images", [])
    
    # Clear the state
    clear_user_state(user_id)
    context.user_data.pop("pending_images", None)
    
    # Process with text only or text + images
    await _process_image_generation(update, context, user_prompt, user_images)
    
    return True

async def _generate_single_image(prompt: str, images: list, index: int):
    """
    Generate a single image using LaoZhang API. Returns (index, image_data) or (index, None) on failure.
    """
    try:
        image_data = await laozhang_generate_image(
            prompt=prompt,
            images=images if images else None,
            aspect_ratio="3:4",  # Vertical for marketplace cards
            image_size="2K"
        )
        if image_data:
            return (index, image_data)
    except Exception as e:
        logging.error(f"[CreatePhoto] Error generating image {index+1}: {e}")
    return (index, None)


async def _process_image_generation(update: Update, context: ContextTypes.DEFAULT_TYPE, 
                                   prompt: str, images: list):
    """
    Internal function to process image generation with optional image inputs.
    Generates N images in parallel, then sends as grouped media.
    """
    from telegram import InputMediaPhoto, InputMediaDocument
    
    chat_id = update.effective_chat.id
    user_id = update.effective_user.id
    
    # Get user's image count setting
    target_image_count = get_user_image_count(user_id)
    
    # Log the user's prompt
    log_conversation(
        user_id, "create_photo", "user_prompt", prompt,
        image_count=len(images)
    )
    
    # Start animation task
    animation_task = asyncio.create_task(run_loading_animation(context, chat_id))
    
    try:
        # Analyze user intent using Gemma 3 12B classifier
        intent = await analyze_user_intent(prompt, images)
        
        logging.info(f"[CreatePhoto] Intent analysis: CTR={intent['wants_ctr_improvement']}")
        
        # Build enhanced prompt based on classification
        enhanced_prompt = prompt
        if intent['wants_ctr_improvement']:
            enhanced_prompt += CTR_ENHANCEMENT_PROMPT
            logging.info("[CreatePhoto] Added CTR optimization enhancement")
        
        logging.info(f"[CreatePhoto] Generating {target_image_count} images in parallel")
        
        # Generate all images in parallel using LaoZhang API
        tasks = [_generate_single_image(enhanced_prompt, images, i) for i in range(target_image_count)]
        results = await asyncio.gather(*tasks)
        
        # Collect successful images (preserving order)
        generated_images = [(idx, data) for idx, data in sorted(results) if data is not None]
        generated_count = len(generated_images)
        
        # Stop animation
        animation_task.cancel()
        try:
            await animation_task
        except asyncio.CancelledError:
            pass
        
        if generated_count > 0:
            # Send all images as one media group (previews)
            if generated_count == 1:
                # Single image - send normally
                await context.bot.send_photo(
                    chat_id=chat_id,
                    photo=io.BytesIO(generated_images[0][1]),
                    caption="🎨 Ваше изображение готово!"
                )
                await context.bot.send_document(
                    chat_id=chat_id,
                    document=io.BytesIO(generated_images[0][1]),
                    filename="generated_image.png",
                    caption="📥 Изображение в оригинальном качестве"
                )
            else:
                # Multiple images - send as media groups
                photo_media = [
                    InputMediaPhoto(
                        media=io.BytesIO(data),
                        caption="🎨 Ваше изображение готово!" if i == 0 else None
                    )
                    for i, (idx, data) in enumerate(generated_images)
                ]
                await context.bot.send_media_group(chat_id=chat_id, media=photo_media)
                
                # Send documents as media group
                doc_media = [
                    InputMediaDocument(
                        media=io.BytesIO(data),
                        filename=f"image_{idx+1}.png",
                        caption="📥 Изображение в оригинальном качестве" if i == 0 else None
                    )
                    for i, (idx, data) in enumerate(generated_images)
                ]
                await context.bot.send_media_group(chat_id=chat_id, media=doc_media)
            
            # Deduct balance
            actual_cost = TOKEN_COSTS["create_photo"] * generated_count
            new_balance = update_user_balance(user_id, -actual_cost)
            
            log_conversation(
                user_id, "create_photo", "bot_image_generated", prompt,
                image_count=generated_count,
                tokens_used=actual_cost,
                success=True
            )
            logging.info(f"[CreatePhoto] Generated {generated_count}/{target_image_count} images. Deducted {actual_cost} tokens")
            

        else:
            await context.bot.send_message(chat_id=chat_id, text="❌ Не удалось сгенерировать изображения.")
        
    except Exception as e:
        if not animation_task.done():
            animation_task.cancel()
            try:
                await animation_task
            except asyncio.CancelledError:
                pass
                
        logging.error(f"[CreatePhoto] Error: {e}", exc_info=True)
        await context.bot.send_message(chat_id=chat_id, text=f"❌ Ошибка: {e}")
        
        log_conversation(
            user_id, "create_photo", "error", str(e),
            image_count=len(images),
            success=False
        )
