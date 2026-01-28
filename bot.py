import os
import logging
from dotenv import load_dotenv
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, BotCommand
from telegram.ext import ApplicationBuilder, ContextTypes, CommandHandler, MessageHandler, filters, CallbackQueryHandler
import google.generativeai as genai

# Import handlers
from handlers import create_photo_handler, handle_photo_prompt, handle_create_photo_image
from handlers import analyze_ctr_handler, handle_ctr_photo, handle_ctr_text
from handlers import start_ctr_improvement
from handlers import handle_image_count_selection, show_change_image_count_menu

# Import database
from database import init_db, get_or_create_user, log_conversation, clear_user_state, TOKEN_COSTS

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

SUPPORT_USERNAME = "your_tech_support"  # Support contact username (without @)

async def setup_bot_commands(application):
    """Set up bot menu button commands"""
    commands = [
        BotCommand("start", "🏠 Главное меню"),
        BotCommand("create_photo", "🎨 Создать фото"),
        BotCommand("analyze_ctr", "📊 Анализ CTR"),
        BotCommand("balance", "💰 Ваш баланс"),
        BotCommand("support", "🆘 Поддержка"),
    ]
    await application.bot.set_my_commands(commands)

async def support(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /support command - redirect to support contact"""
    # Clear any pending feature state
    clear_user_state(update.effective_user.id)
    
    support_url = f"https://t.me/{SUPPORT_USERNAME}"
    keyboard = [
        [InlineKeyboardButton("💬 Написать в поддержку", url=support_url)],
        [InlineKeyboardButton("🏠 В главное меню", callback_data="main_menu")]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    await context.bot.send_message(
        chat_id=update.effective_chat.id,
        text=(
            "🆘 *Поддержка*\n\n"
            "📝 Опишите проблему подробно — так мы поможем быстрее\n"
            "🤝 Будем рады вашей обратной связи!"
        ),
        reply_markup=reply_markup,
        parse_mode="Markdown"
    )

async def show_balance(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show user's current token balance"""
    user = update.effective_user
    
    # Get user from database
    db_user = get_or_create_user(user.id, user.username, user.first_name)
    balance = db_user["balance"]
    
    keyboard = [
        [InlineKeyboardButton("💳 Купить токены", callback_data="buy_tokens")],
        [InlineKeyboardButton("🏠 В главное меню", callback_data="main_menu")]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    await context.bot.send_message(
        chat_id=update.effective_chat.id,
        text=(
            f"💰 *Ваш баланс*\n\n"
            f"🎫 У вас *{balance}* токенов\n\n"
            f"📝 Стоимость операций:\n"
            f"• Создание фото — {TOKEN_COSTS['create_photo']} токенов\n"
            f"• Анализ CTR — {TOKEN_COSTS['analyze_ctr']} токенов"
        ),
        reply_markup=reply_markup,
        parse_mode="Markdown"
    )

async def show_buy_tokens_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show token purchase menu with different price options"""
    keyboard = [
        [InlineKeyboardButton("💰 100₽ → 100 токенов", callback_data="buy_100")],
        [InlineKeyboardButton("💰 300₽ → 325 токенов", callback_data="buy_300")],
        [InlineKeyboardButton("💰 1000₽ → 1100 токенов", callback_data="buy_1000")],
        [InlineKeyboardButton("💰 3000₽ → 3500 токенов", callback_data="buy_3000")],
        [InlineKeyboardButton("💰 5000₽ → 6000 токенов", callback_data="buy_5000")],
        [InlineKeyboardButton("🔙 Назад", callback_data="balance")]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    await context.bot.send_message(
        chat_id=update.effective_chat.id,
        text=(
            "💳 *Покупка токенов*\n\n"
            "🎨 Генерация изображения — 25 токенов\n\n"
            "Выберите подходящий пакет:\n\n"
            "• 100₽ — 100 токенов\n"
            "• 300₽ — 325 токенов (+25 бонус)\n"
            "• 1000₽ — 1100 токенов (+100 бонус)\n"
            "• 3000₽ — 3500 токенов (+500 бонус)\n"
            "• 5000₽ — 6000 токенов (+1000 бонус)"
        ),
        reply_markup=reply_markup,
        parse_mode="Markdown"
    )

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /start command - show main menu"""
    user = update.effective_user
    
    # Clear any pending feature state
    clear_user_state(user.id)
    
    # Get or create user in database
    db_user = get_or_create_user(user.id, user.username, user.first_name)
    
    # Log the start command
    log_conversation(user.id, "start", "command", "/start")
    
    # Create welcome message (balance now shown at feature entry)
    welcome_text = (
        f"Привет, {user.first_name}! 👋\n\n"
        f"Я помогу сделать карточки товаров привлекательнее."
    )
    
    # Create inline keyboard with menu buttons
    keyboard = [
        [
            InlineKeyboardButton("🎨 Создать фото", callback_data="create_photo"),
            InlineKeyboardButton("📊 Анализ CTR", callback_data="analyze_ctr"),
        ],
        [
            InlineKeyboardButton("💰 Баланс", callback_data="balance"),
            InlineKeyboardButton("🆘 Поддержка", callback_data="support"),
        ]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    # Send banner image with welcome message and menu
    banner_path = os.path.join(os.path.dirname(__file__), "assets", "menu_banner.png")
    with open(banner_path, "rb") as banner_file:
        await context.bot.send_photo(
            chat_id=update.effective_chat.id,
            photo=banner_file,
            caption=welcome_text,
            reply_markup=reply_markup
        )

async def button_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Route button callbacks to appropriate handlers"""
    query = update.callback_query
    
    if query.data == "create_photo":
        await create_photo_handler(update, context)
    elif query.data == "analyze_ctr":
        await analyze_ctr_handler(update, context)
    elif query.data == "improve_ctr":
        await start_ctr_improvement(update, context)
    elif query.data.startswith("set_image_count_"):
        await handle_image_count_selection(update, context)
    elif query.data == "change_image_count":
        await show_change_image_count_menu(update, context)
    elif query.data == "balance":
        await query.answer()
        await show_balance(update, context)
    elif query.data == "buy_tokens":
        await query.answer()
        await show_buy_tokens_menu(update, context)
    elif query.data.startswith("buy_"):
        # Handle token purchase buttons (functionality to be added later)
        await query.answer("🚧 Оплата скоро будет доступна!", show_alert=True)
    elif query.data == "support":
        await query.answer()
        await support(update, context)
    elif query.data == "main_menu":
        await query.answer()
        await start(update, context)

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Route text messages to appropriate handlers based on user state"""
    
    # Try photo prompt handler first
    if await handle_photo_prompt(update, context):
        return
    
    # Try CTR text handler (reminds user to send image)
    if await handle_ctr_text(update, context):
        return
    
    # Default: show menu hint
    await context.bot.send_message(
        chat_id=update.effective_chat.id,
        text="👆 Используйте /start для открытия меню."
    )


async def handle_photo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Route photo messages to appropriate handlers based on user state"""
    
    # Try create_photo handler first
    if await handle_create_photo_image(update, context):
        return
    
    # Try CTR photo handler
    if await handle_ctr_photo(update, context):
        return
    
    # Default: show menu hint for unhandled photos
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
    support_cmd_handler = CommandHandler('support', support)
    balance_cmd_handler = CommandHandler('balance', show_balance)
    create_photo_cmd_handler = CommandHandler('create_photo', lambda update, context: create_photo_handler(update, context))
    analyze_ctr_cmd_handler = CommandHandler('analyze_ctr', lambda update, context: analyze_ctr_handler(update, context))
    callback_handler = CallbackQueryHandler(button_callback)
    message_handler = MessageHandler(filters.TEXT & (~filters.COMMAND), handle_message)
    photo_handler = MessageHandler(filters.PHOTO, handle_photo)
    
    application.add_handler(start_handler)
    application.add_handler(support_cmd_handler)
    application.add_handler(balance_cmd_handler)
    application.add_handler(create_photo_cmd_handler)
    application.add_handler(analyze_ctr_cmd_handler)
    application.add_handler(callback_handler)
    application.add_handler(message_handler)
    application.add_handler(photo_handler)
    
    # Set up bot menu commands after initialization
    async def post_init(app):
        # Initialize database
        init_db()
        await setup_bot_commands(app)
    
    application.post_init = post_init
    
    print("Bot is running...")
    application.run_polling()
