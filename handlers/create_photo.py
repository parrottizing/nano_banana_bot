"""
Handler for photo creation feature.
Handles the "Создать фото" menu option with support for text and image inputs.
"""
import logging
import io
from PIL import Image
from telegram import Update
from telegram.ext import ContextTypes
import google.generativeai as genai
from .prompt_classifier import analyze_user_intent

MODEL_NAME = "gemini-3-pro-image-preview"
MAX_IMAGES = 5
MAX_IMAGE_SIZE_MB = 7

# CTR optimization prompt enhancement (based on marketplace best practices 2025)
CTR_ENHANCEMENT_PROMPT = """
КРИТИЧЕСКИ ВАЖНО: Пользователь хочет улучшить CTR (кликабельность) для маркетплейса (Wildberries, Ozon, Яндекс.Маркет).

ПРИМЕНЯЙ СТРАТЕГИЮ "УМНОГО МИНИМАЛИЗМА" (2025):

**ВИЗУАЛЬНАЯ ИЕРАРХИЯ:**
• Товар должен занимать минимум 60-70% площади изображения
• Чистый нейтральный/белый фон для выделения среди конкурентов
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

# Screenshot-specific prompt enhancement  
SCREENSHOT_ENHANCEMENT_PROMPT = """
КРИТИЧЕСКИ ВАЖНО: Это скриншот страницы маркетплейса с элементами интерфейса.

ЗАДАЧА: Извлечь чистое профессиональное изображение товара для создания оптимальной карточки.

**ЧТО НУЖНО УДАЛИТЬ:**
• Навигационные панели (верхняя/нижняя)
• Кнопки интерфейса ("Купить", "В корзину", "Избранное")
• Фильтры и меню маркетплейса
• Логотипы маркетплейса (Wildberries, Ozon, Яндекс.Маркет и др.)
• URL-адреса и элементы браузера
• Блоки с отзывами и рейтингами
• Информационные плашки ("Новинка", "Хит", промо-баннеры)
• Другие товары в рекомендациях

**ЧТО НУЖНО СОХРАНИТЬ/УЛУЧШИТЬ:**
• Само изображение товара в максимальном качестве
• Важную информацию о товаре (если она интегрирована в изображение)
• Композицию товара, но улучшить её для профессионального вида

**КАК ОБРАБОТАТЬ:**
• Создать чистый белый/нейтральный фон
• Разместить товар по центру с правильным соотношением 3:4
• Обеспечить высокое разрешение (минимум 1000x1000px)
• Улучшить контраст и резкость товара
• Убедиться, что товар занимает 60-70% площади изображения

ЦЕЛЬ: Преобразовать скриншот в профессиональное изображение товарной карточки, готовое для загрузки на маркетплейс.
"""

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
        "🎨 *Создание фото*\\n\\n"
        "Отправьте описание изображения, которое хотите создать или отредактировать.\\n"
        "Например: _'Красивый закат над горами с отражением в озере'_",
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
            text="⚠️ Пожалуйста, отправьте изображение с текстовым описанием в подписи.\\n\\n"
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
        
        # Open with PIL to ensure proper format
        image = Image.open(io.BytesIO(image_bytes))
        
        # Store PIL Image object (compatible with google.generativeai)
        current_images.append(image)
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
        images: List of PIL Image objects (can be empty)
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
        # Analyze user intent using Gemma 3 12B classifier
        intent = await analyze_user_intent(prompt, images)
        
        logging.info(f"[CreatePhoto] Intent analysis: CTR={intent['wants_ctr_improvement']}, "
                    f"Screenshot={intent['is_screenshot']}")
        
        # Build enhanced prompt based on classification
        enhanced_prompt = prompt
        
        if intent['wants_ctr_improvement']:
            enhanced_prompt += CTR_ENHANCEMENT_PROMPT
            logging.info("[CreatePhoto] Added CTR optimization enhancement")
        
        if intent['is_screenshot']:
            enhanced_prompt += SCREENSHOT_ENHANCEMENT_PROMPT
            logging.info("[CreatePhoto] Added screenshot processing enhancement")
        
        model = genai.GenerativeModel(MODEL_NAME)
        logging.info(f"[CreatePhoto] Generating with prompt: {prompt}, images: {len(images)}")
        
        # Build the content for multimodal input
        # For google.generativeai, we pass images and text directly in a list
        if images:
            # Multi-modal: images + enhanced text
            content = images + [enhanced_prompt]
        else:
            # Text-only
            content = enhanced_prompt
        
        # Generate content
        response = await model.generate_content_async(content)
        
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
                    
                    # Send as photo for quick preview (Telegram will compress)
                    await context.bot.send_photo(
                        chat_id=chat_id, 
                        photo=io.BytesIO(image_data),
                        caption=caption_text,
                        parse_mode="Markdown"
                    )
                    
                    # Send as document for full quality
                    await context.bot.send_document(
                        chat_id=chat_id,
                        document=io.BytesIO(image_data),
                        filename="generated_image.png",
                        caption="📥 Изображение в оригинальном качестве"
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
