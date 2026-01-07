import os
import logging
from dotenv import load_dotenv
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ApplicationBuilder, ContextTypes, CommandHandler, MessageHandler, filters, CallbackQueryHandler
import google.generativeai as genai

# Import handlers
from handlers import create_photo_handler, handle_photo_prompt
from handlers import analyze_ctr_handler, handle_ctr_data

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
    """Handle /start command - show main menu"""
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
    """Route button callbacks to appropriate handlers"""
    query = update.callback_query
    
    if query.data == "create_photo":
        await create_photo_handler(update, context)
    elif query.data == "analyze_ctr":
        await analyze_ctr_handler(update, context)

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Route text messages to appropriate handlers based on user state"""
    
    # Try photo handler first
    if await handle_photo_prompt(update, context):
        return
    
    # Try CTR handler
    if await handle_ctr_data(update, context):
        return
    
    # Default: show menu hint
    await context.bot.send_message(
        chat_id=update.effective_chat.id,
        text="👆 Используйте /start для открытия меню."
    )

if __name__ == '__main__':
    if not TELEGRAM_TOKEN:
        print("Error: TELEGRAM_BOT_TOKEN not found check your .env file.")
        exit(1)
        
    application = ApplicationBuilder().token(TELEGRAM_TOKEN).build()
    
    start_handler = CommandHandler('start', start)
    callback_handler = CallbackQueryHandler(button_callback)
    message_handler = MessageHandler(filters.TEXT & (~filters.COMMAND), handle_message)
    
    application.add_handler(start_handler)
    application.add_handler(callback_handler)
    application.add_handler(message_handler)
    
    print("Bot is running...")
    application.run_polling()
