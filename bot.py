import os
import logging
import uuid
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Optional, Dict, Any
import aiohttp
from dotenv import load_dotenv
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, BotCommand
from telegram.ext import ApplicationBuilder, ContextTypes, CommandHandler, MessageHandler, filters, CallbackQueryHandler

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
LAOZHANG_PER_REQUEST_API_KEY = os.getenv("LAOZHANG_PER_REQUEST_API_KEY")
LAOZHANG_PER_USE_API_KEY = os.getenv("LAOZHANG_PER_USE_API_KEY")

# Validate API key
if not (LAOZHANG_PER_REQUEST_API_KEY or LAOZHANG_PER_USE_API_KEY):
    logging.warning(
        "LaoZhang API keys not found. Set LAOZHANG_PER_REQUEST_API_KEY and "
        "LAOZHANG_PER_USE_API_KEY."
    )

SUPPORT_USERNAME = "your_tech_support"  # Support contact username (without @)

# Payments (YooKassa API, SBP only)
YOOKASSA_SHOP_ID = os.getenv("YOOKASSA_SHOP_ID")
YOOKASSA_SECRET_KEY = os.getenv("YOOKASSA_SECRET_KEY")
YOOKASSA_API_BASE_URL = os.getenv("YOOKASSA_API_BASE_URL", "https://api.yookassa.ru/v3").rstrip("/")
TELEGRAM_BOT_USERNAME = os.getenv("TELEGRAM_BOT_USERNAME")
YOOKASSA_RECEIPT_EMAIL = os.getenv("YOOKASSA_RECEIPT_EMAIL")
YOOKASSA_RECEIPT_VAT_CODE = int(os.getenv("YOOKASSA_RECEIPT_VAT_CODE", "1"))
YOOKASSA_RECEIPT_PAYMENT_MODE = os.getenv("YOOKASSA_RECEIPT_PAYMENT_MODE", "full_prepayment")
YOOKASSA_RECEIPT_PAYMENT_SUBJECT = os.getenv("YOOKASSA_RECEIPT_PAYMENT_SUBJECT", "service")

PAYMENT_TITLE = "Пополнение баланса"
PAYMENT_CURRENCY = "RUB"
PAYMENT_START_PARAMETER = "balance_topup"
SBP_CHECK_CALLBACK_PREFIX = "check_sbp:"

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


def _build_payment_payload(package_id: str, user_id: int) -> str:
    return f"{PAYMENT_START_PARAMETER}:{package_id}:{user_id}:{uuid.uuid4().hex}"


def _get_package_id_by_amount(amount_kopecks: int) -> Optional[str]:
    for package_id, package in PAYMENT_PACKAGES.items():
        if package["rub"] * 100 == amount_kopecks:
            return package_id
    return None


def _has_yookassa_api_credentials() -> bool:
    return bool(YOOKASSA_SHOP_ID and YOOKASSA_SECRET_KEY)


def _build_receipt(package_id: str) -> Optional[Dict[str, Any]]:
    """
    Build receipt payload for shops with YooKassa fiscalization enabled.
    """
    if not YOOKASSA_RECEIPT_EMAIL:
        return None

    package = PAYMENT_PACKAGES.get(package_id)
    if not package:
        return None

    amount_value = f"{package['rub']:.2f}"
    return {
        "customer": {
            "email": YOOKASSA_RECEIPT_EMAIL,
        },
        "items": [
            {
                "description": f"Пополнение баланса: {package['balance']} токенов",
                "quantity": "1.00",
                "amount": {
                    "value": amount_value,
                    "currency": PAYMENT_CURRENCY,
                },
                "vat_code": YOOKASSA_RECEIPT_VAT_CODE,
                "payment_mode": YOOKASSA_RECEIPT_PAYMENT_MODE,
                "payment_subject": YOOKASSA_RECEIPT_PAYMENT_SUBJECT,
            }
        ],
    }


def _amount_value_to_kopecks(amount_value: Any) -> Optional[int]:
    try:
        return int((Decimal(str(amount_value)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    except (InvalidOperation, TypeError, ValueError):
        return None


def _get_sbp_return_url() -> str:
    if TELEGRAM_BOT_USERNAME:
        username = TELEGRAM_BOT_USERNAME.lstrip("@")
        return f"https://t.me/{username}?start=sbp_return"
    return "https://t.me"


def _format_yookassa_error(data: Dict[str, Any]) -> str:
    code = data.get("code")
    parameter = data.get("parameter")
    description = data.get("description") or "Неизвестная ошибка YooKassa"
    if code == "invalid_request" and parameter == "receipt":
        return (
            "ошибка чека (receipt). Проверьте YOOKASSA_RECEIPT_EMAIL и настройки "
            "чека (54-ФЗ) в YooKassa."
        )
    return f"{description} (code={code}, parameter={parameter})"


async def _create_sbp_payment(package_id: str, user_id: int) -> Optional[Dict[str, Any]]:
    package = PAYMENT_PACKAGES.get(package_id)
    if not package or not _has_yookassa_api_credentials():
        return None

    receipt = _build_receipt(package_id)
    if receipt is None:
        logging.error(
            "YooKassa receipt email is missing. Set YOOKASSA_RECEIPT_EMAIL for fiscalized payments."
        )
        return {
            "error": (
                "не задан YOOKASSA_RECEIPT_EMAIL. Для вашего магазина требуется "
                "передавать данные чека (receipt)."
            )
        }

    payload = {
        "amount": {
            "value": f"{package['rub']:.2f}",
            "currency": PAYMENT_CURRENCY,
        },
        "capture": True,
        "payment_method_data": {"type": "sbp"},
        "confirmation": {
            "type": "redirect",
            "return_url": _get_sbp_return_url(),
        },
        "description": f"{PAYMENT_TITLE}: {package['balance']} токенов",
        "metadata": {
            "package_id": package_id,
            "telegram_user_id": str(user_id),
        },
        "receipt": receipt,
    }

    try:
        timeout = aiohttp.ClientTimeout(total=20)
        auth = aiohttp.BasicAuth(YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY)
        headers = {"Idempotence-Key": uuid.uuid4().hex}
        async with aiohttp.ClientSession(auth=auth, timeout=timeout) as session:
            async with session.post(
                f"{YOOKASSA_API_BASE_URL}/payments",
                json=payload,
                headers=headers,
            ) as response:
                data = await response.json(content_type=None)
                if response.status not in (200, 201):
                    logging.error("Failed to create SBP payment: status=%s body=%s", response.status, data)
                    return {"error": _format_yookassa_error(data), "raw_error": data}
                return data
    except Exception:
        logging.exception("Failed to create SBP payment.")
        return {"error": "сетевая ошибка при обращении к YooKassa"}


async def _get_sbp_payment(payment_id: str) -> Optional[Dict[str, Any]]:
    if not payment_id or not _has_yookassa_api_credentials():
        return None

    try:
        timeout = aiohttp.ClientTimeout(total=20)
        auth = aiohttp.BasicAuth(YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY)
        async with aiohttp.ClientSession(auth=auth, timeout=timeout) as session:
            async with session.get(f"{YOOKASSA_API_BASE_URL}/payments/{payment_id}") as response:
                data = await response.json(content_type=None)
                if response.status != 200:
                    logging.error("Failed to fetch SBP payment: status=%s body=%s", response.status, data)
                    return None
                return data
    except Exception:
        logging.exception("Failed to fetch SBP payment status.")
        return None


def _get_package_id_from_sbp_payment(payment_data: Dict[str, Any]) -> Optional[str]:
    metadata = payment_data.get("metadata") or {}
    metadata_package_id = metadata.get("package_id")
    if metadata_package_id in PAYMENT_PACKAGES:
        return metadata_package_id

    amount = payment_data.get("amount") or {}
    amount_kopecks = _amount_value_to_kopecks(amount.get("value"))
    if amount_kopecks is None:
        return None
    return _get_package_id_by_amount(amount_kopecks)


def _get_owner_id_from_sbp_payment(payment_data: Dict[str, Any]) -> Optional[int]:
    metadata = payment_data.get("metadata") or {}
    raw_user_id = metadata.get("telegram_user_id")
    try:
        return int(raw_user_id)
    except (TypeError, ValueError):
        return None


async def send_sbp_payment_link(update: Update, context: ContextTypes.DEFAULT_TYPE, package_id: str) -> None:
    get_or_create_user(
        update.effective_user.id,
        update.effective_user.username,
        update.effective_user.first_name,
    )

    if not _has_yookassa_api_credentials():
        logging.error("YooKassa API credentials are missing. Set YOOKASSA_SHOP_ID and YOOKASSA_SECRET_KEY.")
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

    payment_data = await _create_sbp_payment(package_id, update.effective_user.id)
    if not payment_data:
        await context.bot.send_message(
            chat_id=update.effective_chat.id,
            text="❌ Не удалось создать платеж. Попробуйте еще раз или напишите в поддержку."
        )
        return

    if payment_data.get("error"):
        await context.bot.send_message(
            chat_id=update.effective_chat.id,
            text=f"❌ Не удалось создать платеж: {payment_data['error']}"
        )
        return

    payment_id = payment_data.get("id")
    confirmation = payment_data.get("confirmation") or {}
    confirmation_url = confirmation.get("confirmation_url")

    if not payment_id or not confirmation_url:
        logging.error("SBP payment payload missing id/confirmation_url: %s", payment_data)
        await context.bot.send_message(
            chat_id=update.effective_chat.id,
            text="❌ Не удалось получить ссылку на оплату. Попробуйте еще раз или напишите в поддержку."
        )
        return

    keyboard = [
        [InlineKeyboardButton("⚡ Оплатить", url=confirmation_url)],
        [InlineKeyboardButton("🔄 Проверить оплату", callback_data=f"{SBP_CHECK_CALLBACK_PREFIX}{payment_id}")],
        [InlineKeyboardButton("🔙 Назад", callback_data="buy_tokens")],
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)

    await context.bot.send_message(
        chat_id=update.effective_chat.id,
        text=(
            f"💳 *Оплата*\n\n"
            f"Пакет: *{package['rub']}₽ → {package['balance']} токенов*\n\n"
            "1) Нажмите кнопку оплаты\n"
            "2) Подтвердите платеж\n"
            "3) Вернитесь в чат и нажмите «Проверить оплату»"
        ),
        reply_markup=reply_markup,
        parse_mode="Markdown"
    )

    log_conversation(
        update.effective_user.id,
        "payment",
        "sbp_payment_created",
        content=f"package={package_id}",
        metadata={"payment_id": payment_id},
    )


async def handle_sbp_status_check(update: Update, context: ContextTypes.DEFAULT_TYPE, payment_id: str) -> None:
    user = update.effective_user
    get_or_create_user(user.id, user.username, user.first_name)

    payment_data = await _get_sbp_payment(payment_id)
    if not payment_data:
        await context.bot.send_message(
            chat_id=update.effective_chat.id,
            text="❌ Не удалось проверить статус платежа. Попробуйте снова через 10–15 секунд."
        )
        return

    owner_id = _get_owner_id_from_sbp_payment(payment_data)
    if owner_id != user.id:
        await context.bot.send_message(
            chat_id=update.effective_chat.id,
            text="❌ Этот платеж не найден для вашего аккаунта."
        )
        return

    payment_status = payment_data.get("status")
    if payment_status != "succeeded":
        if payment_status == "canceled":
            await context.bot.send_message(
                chat_id=update.effective_chat.id,
                text="❌ Платеж отменен. Нажмите «Купить токены» и попробуйте снова."
            )
        else:
            await context.bot.send_message(
                chat_id=update.effective_chat.id,
                text="⏳ Платеж еще не подтвержден. Если уже оплатили, попробуйте снова через несколько секунд."
            )
        return

    package_id = _get_package_id_from_sbp_payment(payment_data)
    if not package_id:
        await context.bot.send_message(
            chat_id=update.effective_chat.id,
            text="✅ Оплата прошла, но пакет не определился. Напишите в поддержку."
        )
        return

    amount_info = payment_data.get("amount") or {}
    amount_kopecks = _amount_value_to_kopecks(amount_info.get("value"))
    if amount_kopecks is None:
        amount_kopecks = PAYMENT_PACKAGES[package_id]["rub"] * 100

    payment_id = payment_data.get("id")
    if not payment_id:
        await context.bot.send_message(
            chat_id=update.effective_chat.id,
            text="❌ Не удалось подтвердить ID платежа. Напишите в поддержку."
        )
        return

    balance_added = PAYMENT_PACKAGES[package_id]["balance"]
    new_balance = apply_successful_payment(
        telegram_user_id=user.id,
        provider_payment_charge_id=payment_id,
        telegram_payment_charge_id=f"sbp:{payment_id}",
        payload=_build_payment_payload(package_id, user.id),
        currency=amount_info.get("currency", PAYMENT_CURRENCY),
        amount=amount_kopecks,
        balance_added=balance_added,
        status="paid",
    )

    if new_balance is None:
        current_user = get_or_create_user(user.id, user.username, user.first_name)
        await context.bot.send_message(
            chat_id=update.effective_chat.id,
            text=f"✅ Платеж уже обработан. Текущий баланс: {current_user['balance']}."
        )
        return

    await context.bot.send_message(
        chat_id=update.effective_chat.id,
        text=f"✅ Баланс пополнен на {balance_added}. Текущий баланс: {new_balance}."
    )
    log_conversation(
        user.id,
        "payment",
        "successful_sbp_payment",
        content=f"package={package_id}",
        metadata={
            "provider_payment_charge_id": payment_id,
            "total_amount": amount_kopecks,
            "currency": amount_info.get("currency", PAYMENT_CURRENCY),
            "balance_added": balance_added,
        },
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
        [InlineKeyboardButton("💳 Пополнить баланс", callback_data="buy_tokens")],
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
    """Show SBP-only token purchase menu with package options."""
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
            "• 5000₽ — 6000 токенов (+1000 бонус)\n\n"
            "После выбора вы получите кнопку для оплаты."
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
        await send_sbp_payment_link(update, context, package_id)
    elif query.data.startswith(SBP_CHECK_CALLBACK_PREFIX):
        await query.answer("Проверяю оплату...")
        payment_id = query.data[len(SBP_CHECK_CALLBACK_PREFIX):]
        if not payment_id:
            await context.bot.send_message(
                chat_id=update.effective_chat.id,
                text="❌ Некорректный ID платежа. Попробуйте оплатить снова."
            )
            return
        await handle_sbp_status_check(update, context, payment_id)
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
