import os
import logging
import asyncio
from dotenv import load_dotenv
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ApplicationBuilder, ContextTypes, CommandHandler, MessageHandler, filters, CallbackQueryHandler
import google.generativeai as genai

load_dotenv()

# Configure logging
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)

TELEGRAM_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")

# Configure Google GenAI
if GOOGLE_API_KEY:
    genai.configure(api_key=GOOGLE_API_KEY)
else:
    logging.warning("GOOGLE_API_KEY not found in environment variables.")

MODEL_NAME = "gemini-3-pro-image-preview"

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    
    # Create welcome message
    welcome_text = (
        f"👤 Имя: {user.first_name}"
        + (f" (@{user.username})" if user.username else "") + "\n"
        f"💰 Баланс: 50 токенов\n"
        f"⚡ Модель: {MODEL_NAME}\n\n"
        f"👇 Выберите раздел в меню ниже."
    )
    
    # Create inline keyboard with two buttons
    keyboard = [
        [
            InlineKeyboardButton("🎨 Создать фото", callback_data="create_photo"),
            InlineKeyboardButton("📊 Анализ CTR", callback_data="analyze_ctr"),
        ]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    await context.bot.send_message(
        chat_id=update.effective_chat.id,
        text=welcome_text,
        reply_markup=reply_markup
    )

async def button_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle button callbacks"""
    query = update.callback_query
    await query.answer()
    
    if query.data == "create_photo":
        await query.message.reply_text("🎨 Отправьте описание для генерации фото:")
    elif query.data == "analyze_ctr":
        await query.message.reply_text("📊 Отправьте данные для анализа CTR:")

async def generate(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_prompt = update.message.text
    chat_id = update.effective_chat.id
    
    await context.bot.send_message(chat_id=chat_id, text=f"Generating with {MODEL_NAME}...")
    
    try:
        model = genai.GenerativeModel(MODEL_NAME)
        logging.info(f"Requesting content from model: {MODEL_NAME} with prompt: {user_prompt}")
        
        # Use async generation to avoid blocking
        response = await model.generate_content_async(user_prompt)
        
        logging.info("Response received from API.")
        
        has_content = False

        # Check for parts which might be images
        if hasattr(response, 'parts'):
            logging.info(f"Response has {len(response.parts)} parts.")
            for part in response.parts:
                # Check for inline_data (images)
                if hasattr(part, 'inline_data') and part.inline_data:
                    logging.info(f"Found inline_data with mime_type: {part.inline_data.mime_type}")
                    import io
                    # Decode the image data
                    image_data = part.inline_data.data
                    
                    # Send to Telegram
                    await context.bot.send_photo(
                        chat_id=chat_id, 
                        photo=io.BytesIO(image_data),
                        caption=f"Generated with {MODEL_NAME}"
                    )
                    has_content = True

        # Check for regular text
        try:
            if response.text:
                logging.info("Text response found.")
                await context.bot.send_message(chat_id=chat_id, text=response.text)
                has_content = True
        except ValueError:
            # response.text raises ValueError if the response contains no text (e.g. only images)
            logging.info("No text content found (caught ValueError accessing response.text).")

        if not has_content:
             logging.warning("Response had no handled content (no text, no images).")
             await context.bot.send_message(chat_id=chat_id, text="Model returned an empty response.")
        
    except Exception as e:
        logging.error(f"Error generating content: {e}", exc_info=True)
        await context.bot.send_message(chat_id=chat_id, text=f"Error: {e}")

if __name__ == '__main__':
    if not TELEGRAM_TOKEN:
        print("Error: TELEGRAM_BOT_TOKEN not found check your .env file.")
        exit(1)
        
    application = ApplicationBuilder().token(TELEGRAM_TOKEN).build()
    
    start_handler = CommandHandler('start', start)
    callback_handler = CallbackQueryHandler(button_callback)
    generate_handler = MessageHandler(filters.TEXT & (~filters.COMMAND), generate)
    
    application.add_handler(start_handler)
    application.add_handler(callback_handler)
    application.add_handler(generate_handler)
    
    print("Bot is running...")
    application.run_polling()
