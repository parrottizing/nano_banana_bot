import os
import logging
import uuid
from typing import Optional, Dict, Any
from dotenv import load_dotenv
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, BotCommand, LabeledPrice
from telegram.ext import ApplicationBuilder, ContextTypes, CommandHandler, MessageHandler, filters, CallbackQueryHandler, PreCheckoutQueryHandler

# Import handlers
from handlers import create_photo_handler, handle_photo_prompt, handle_create_photo_image
from handlers import analyze_ctr_handler, handle_ctr_photo, handle_ctr_text
from handlers import start_ctr_improvement
from handlers import handle_image_count_selection, show_change_image_count_menu

# Import database
from database import (
    init_db,
    get_or_create_user,
    log_conversation,
    clear_user_state,
    TOKEN_COSTS,
    apply_successful_payment,
)

load_dotenv()

# Configure logging
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)

TELEGRAM_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
LAOZHANG_API_KEY = os.getenv("LAOZHANG_API_KEY")

# Validate API key
if not LAOZHANG_API_KEY:
    logging.warning("LAOZHANG_API_KEY not found in environment variables.")

SUPPORT_USERNAME = "your_tech_support"  # Support contact username (without @)

# Payments (YooKassa via Telegram Payments)
PAYMENTS_MODE = os.getenv("PAYMENTS_MODE", "test").lower()
YOOKASSA_PROVIDER_TOKEN_TEST = os.getenv("YOOKASSA_PROVIDER_TOKEN_TEST")
YOOKASSA_PROVIDER_TOKEN_LIVE = os.getenv("YOOKASSA_PROVIDER_TOKEN_LIVE")

PAYMENT_TITLE = "Пополнение баланса"
PAYMENT_DESCRIPTION = "Пополнение баланса для генерации и редактирования изображений."
PAYMENT_LABEL = "К оплате"
PAYMENT_CURRENCY = "RUB"
PAYMENT_START_PARAMETER = "balance_topup"

PAYMENT_PACKAGES = {
    "100": {"rub": 100, "balance": 100},
    "300": {"rub": 300, "balance": 325},
    "1000": {"rub": 1000, "balance": 1100},
    "3000": {"rub": 3000, "balance": 3500},
    "5000": {"rub": 5000, "balance": 6000},
}

CALLBACK_TO_PACKAGE_ID = {
    "buy_100": "100",
    "buy_300": "300",
    "buy_1000": "1000",
    "buy_3000": "3000",
    "buy_5000": "5000",
}

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


def _get_provider_token() -> Optional[str]:
    if PAYMENTS_MODE == "live":
        return YOOKASSA_PROVIDER_TOKEN_LIVE or YOOKASSA_PROVIDER_TOKEN_TEST
    return YOOKASSA_PROVIDER_TOKEN_TEST or YOOKASSA_PROVIDER_TOKEN_LIVE


def _build_payment_payload(package_id: str, user_id: int) -> str:
    return f"{PAYMENT_START_PARAMETER}:{package_id}:{user_id}:{uuid.uuid4().hex}"


def _parse_payment_payload(payload: str) -> Optional[Dict[str, Any]]:
    parts = payload.split(":")
    if len(parts) != 4:
        return None
    if parts[0] != PAYMENT_START_PARAMETER:
        return None
    try:
        user_id = int(parts[2])
    except ValueError:
        return None
    return {"package_id": parts[1], "user_id": user_id, "nonce": parts[3]}


def _get_package_id_by_amount(amount_kopecks: int) -> Optional[str]:
    for package_id, package in PAYMENT_PACKAGES.items():
        if package["rub"] * 100 == amount_kopecks:
            return package_id
    return None


async def send_balance_invoice(update: Update, context: ContextTypes.DEFAULT_TYPE, package_id: str) -> None:
    provider_token = _get_provider_token()
    if not provider_token:
        logging.error("Provider token is missing. Set YOOKASSA_PROVIDER_TOKEN_TEST/LIVE.")
        await context.bot.send_message(
            chat_id=update.effective_chat.id,
            text="❌ Оплата временно недоступна. Напишите в поддержку."
        )
        return

    package = PAYMENT_PACKAGES.get(package_id)
    if not package:
        await context.bot.send_message(
            chat_id=update.effective_chat.id,
            text="❌ Не удалось найти пакет для оплаты. Напишите в поддержку."
        )
        return

    payload = _build_payment_payload(package_id, update.effective_user.id)
    prices = [LabeledPrice(PAYMENT_LABEL, package["rub"] * 100)]

    await context.bot.send_invoice(
        chat_id=update.effective_chat.id,
        title=PAYMENT_TITLE,
        description=PAYMENT_DESCRIPTION,
        payload=payload,
        provider_token=provider_token,
        currency=PAYMENT_CURRENCY,
        prices=prices,
        start_parameter=PAYMENT_START_PARAMETER
    )


async def handle_precheckout_query(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.pre_checkout_query
    payload_data = _parse_payment_payload(query.invoice_payload)

    if not payload_data or payload_data["user_id"] != query.from_user.id:
        await query.answer(
            ok=False,
            error_message="Неверные параметры платежа. Попробуйте ещё раз или обратитесь в поддержку."
        )
        return

    package = PAYMENT_PACKAGES.get(payload_data["package_id"])
    if not package:
        await query.answer(
            ok=False,
            error_message="Пакет оплаты не найден. Попробуйте ещё раз или обратитесь в поддержку."
        )
        return

    expected_amount = package["rub"] * 100
    if query.currency != PAYMENT_CURRENCY or query.total_amount != expected_amount:
        await query.answer(
            ok=False,
            error_message="Сумма платежа не совпадает. Попробуйте ещё раз."
        )
        return

    await query.answer(ok=True)


async def handle_successful_payment(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    message = update.message
    payment = message.successful_payment
    user = update.effective_user

    payload_data = _parse_payment_payload(payment.invoice_payload)
    package_id = None
    if payload_data and payload_data.get("package_id") in PAYMENT_PACKAGES:
        package_id = payload_data["package_id"]
    else:
        package_id = _get_package_id_by_amount(payment.total_amount)

    get_or_create_user(user.id, user.username, user.first_name)

    if not package_id:
        new_balance = apply_successful_payment(
            telegram_user_id=user.id,
            provider_payment_charge_id=payment.provider_payment_charge_id,
            telegram_payment_charge_id=payment.telegram_payment_charge_id,
            payload=payment.invoice_payload,
            currency=payment.currency,
            amount=payment.total_amount,
            balance_added=0,
            status="paid_unmapped"
        )
        await message.reply_text(
            "✅ Платёж получен, но не удалось определить пакет пополнения. Напишите в поддержку."
        )
        if new_balance is not None:
            log_conversation(
                user.id,
                "payment",
                "successful_payment",
                content="unmapped",
                metadata={
                    "provider_payment_charge_id": payment.provider_payment_charge_id,
                    "telegram_payment_charge_id": payment.telegram_payment_charge_id,
                    "total_amount": payment.total_amount,
                    "currency": payment.currency,
                }
            )
        return

    balance_added = PAYMENT_PACKAGES[package_id]["balance"]
    new_balance = apply_successful_payment(
        telegram_user_id=user.id,
        provider_payment_charge_id=payment.provider_payment_charge_id,
        telegram_payment_charge_id=payment.telegram_payment_charge_id,
        payload=payment.invoice_payload,
        currency=payment.currency,
        amount=payment.total_amount,
        balance_added=balance_added,
        status="paid"
    )

    if new_balance is None:
        await message.reply_text("✅ Платёж уже обработан. Баланс не изменён.")
        return

    await message.reply_text(
        f"✅ Баланс пополнен на {balance_added}. Текущий баланс: {new_balance}."
    )
    log_conversation(
        user.id,
        "payment",
        "successful_payment",
        content=f"package={package_id}",
        metadata={
            "provider_payment_charge_id": payment.provider_payment_charge_id,
            "telegram_payment_charge_id": payment.telegram_payment_charge_id,
            "total_amount": payment.total_amount,
            "currency": payment.currency,
            "balance_added": balance_added,
        }
    )

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
        await query.answer()
        package_id = CALLBACK_TO_PACKAGE_ID.get(query.data)
        if not package_id:
            await context.bot.send_message(
                chat_id=update.effective_chat.id,
                text="❌ Не удалось определить пакет для оплаты. Напишите в поддержку."
            )
            return
        await send_balance_invoice(update, context, package_id)
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
    precheckout_handler = PreCheckoutQueryHandler(handle_precheckout_query)
    successful_payment_handler = MessageHandler(filters.SUCCESSFUL_PAYMENT, handle_successful_payment)
    message_handler = MessageHandler(filters.TEXT & (~filters.COMMAND), handle_message)
    photo_handler = MessageHandler(filters.PHOTO, handle_photo)
    
    application.add_handler(start_handler)
    application.add_handler(support_cmd_handler)
    application.add_handler(balance_cmd_handler)
    application.add_handler(create_photo_cmd_handler)
    application.add_handler(analyze_ctr_cmd_handler)
    application.add_handler(callback_handler)
    application.add_handler(precheckout_handler)
    application.add_handler(successful_payment_handler)
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
