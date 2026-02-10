"""
Automated tests for the Telegram bot.
Tests all commands and inline keyboard buttons.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch, mock_open
from telegram import Update, User, Chat, Message, CallbackQuery
from telegram.ext import ContextTypes

# Import the handlers we want to test
from bot import start, button_callback, show_buy_tokens_menu
from handlers.create_photo import create_photo_handler, handle_photo_prompt
from handlers.analyze_ctr import analyze_ctr_handler


@pytest.fixture(autouse=True)
def isolated_test_db(tmp_path, monkeypatch):
    """Use isolated SQLite DB per test."""
    test_db_path = tmp_path / "bot_data.db"
    monkeypatch.setattr("database.db.DB_PATH", test_db_path)
    from database import init_db
    init_db()
    yield


class TestBotCommands:
    """Test all bot commands"""
    
    @pytest.fixture
    def mock_update(self):
        """Create a mock Update object for commands"""
        update = MagicMock(spec=Update)
        update.effective_user = User(id=12345, first_name="TestUser", is_bot=False, username="testuser")
        update.effective_chat = Chat(id=12345, type="private")
        update.message = MagicMock(spec=Message)
        update.message.reply_text = AsyncMock()
        update.callback_query = None  # No callback query for direct commands
        return update
    
    @pytest.fixture
    def mock_callback_update(self):
        """Create a mock Update object for inline button callbacks"""
        update = MagicMock(spec=Update)
        update.effective_user = User(id=12345, first_name="TestUser", is_bot=False, username="testuser")
        update.effective_chat = Chat(id=12345, type="private")
        
        # Create callback query
        update.callback_query = MagicMock(spec=CallbackQuery)
        update.callback_query.answer = AsyncMock()
        update.callback_query.message = MagicMock(spec=Message)
        update.callback_query.message.reply_text = AsyncMock()
        
        return update
    
    @pytest.fixture
    def mock_context(self):
        """Create a mock Context object"""
        context = MagicMock(spec=ContextTypes.DEFAULT_TYPE)
        context.bot = MagicMock()
        context.bot.send_message = AsyncMock()
        context.bot.send_photo = AsyncMock()
        context.user_data = {}  # Add user_data for database-based state
        return context
    
    @pytest.mark.asyncio
    async def test_start_command(self, mock_update, mock_context):
        """Test /start command displays main menu"""
        print("\n🧪 Testing /start command...")
        
        # Mock the banner file
        with patch('builtins.open', mock_open(read_data=b'fake_image_data')):
            await start(mock_update, mock_context)
        
        # Verify that send_photo was called with the welcome message
        mock_context.bot.send_photo.assert_called_once()
        call_args = mock_context.bot.send_photo.call_args
        
        # Check that it was sent to the correct chat
        assert call_args.kwargs['chat_id'] == 12345
        
        # Check that the caption contains user information
        caption = call_args.kwargs['caption']
        assert "TestUser" in caption
        assert "Я помогу" in caption
        
        # Check that the inline keyboard is present
        reply_markup = call_args.kwargs['reply_markup']
        assert reply_markup is not None
        
        print("✅ /start command works correctly!")
    
    @pytest.mark.asyncio
    async def test_create_photo_command(self, mock_update, mock_context):
        """Test /create_photo command from menu"""
        print("\n🧪 Testing /create_photo command...")
        
        await create_photo_handler(mock_update, mock_context)
        
        # Verify that reply_text was called on the message (not callback_query)
        mock_update.message.reply_text.assert_called_once()
        call_args = mock_update.message.reply_text.call_args
        
        # Check the message content
        message_text = call_args.args[0]
        assert "Создание фото" in message_text
        assert "Отправьте описание" in message_text
        
        print("✅ /create_photo command works correctly!")
    
    @pytest.mark.asyncio
    async def test_analyze_ctr_command(self, mock_update, mock_context):
        """Test /analyze_ctr command from menu"""
        print("\n🧪 Testing /analyze_ctr command...")
        
        await analyze_ctr_handler(mock_update, mock_context)
        
        # Verify that reply_text was called on the message (not callback_query)
        mock_update.message.reply_text.assert_called_once()
        call_args = mock_update.message.reply_text.call_args
        
        # Check the message content
        message_text = call_args.args[0]
        assert "Анализ CTR" in message_text
        assert "Отправьте фото" in message_text
        
        print("✅ /analyze_ctr command works correctly!")
    
    @pytest.mark.asyncio
    async def test_create_photo_button(self, mock_callback_update, mock_context):
        """Test 'Создать фото' inline button from /start menu"""
        print("\n🧪 Testing 'Создать фото' button...")
        
        # Set the callback data
        mock_callback_update.callback_query.data = "create_photo"
        
        await button_callback(mock_callback_update, mock_context)
        
        # Verify callback was answered
        mock_callback_update.callback_query.answer.assert_called_once()
        
        # Verify the message was sent
        mock_callback_update.callback_query.message.reply_text.assert_called_once()
        call_args = mock_callback_update.callback_query.message.reply_text.call_args
        
        # Check the message content
        message_text = call_args.args[0]
        assert "Создание фото" in message_text
        
        print("✅ 'Создать фото' button works correctly!")
    
    @pytest.mark.asyncio
    async def test_analyze_ctr_button(self, mock_callback_update, mock_context):
        """Test 'Анализ CTR' inline button from /start menu"""
        print("\n🧪 Testing 'Анализ CTR' button...")
        
        # Set the callback data
        mock_callback_update.callback_query.data = "analyze_ctr"
        
        await button_callback(mock_callback_update, mock_context)
        
        # Verify callback was answered
        mock_callback_update.callback_query.answer.assert_called_once()
        
        # Verify the message was sent
        mock_callback_update.callback_query.message.reply_text.assert_called_once()
        call_args = mock_callback_update.callback_query.message.reply_text.call_args
        
        # Check the message content
        message_text = call_args.args[0]
        assert "Анализ CTR" in message_text
        
        print("✅ 'Анализ CTR' button works correctly!")
    
    @pytest.mark.asyncio
    async def test_support_command(self, mock_update, mock_context):
        """Test /support command displays support message with button"""
        print("\n🧪 Testing /support command...")
        
        from bot import support
        
        await support(mock_update, mock_context)
        
        # Verify that send_message was called
        mock_context.bot.send_message.assert_called_once()
        call_args = mock_context.bot.send_message.call_args
        
        # Check that it was sent to the correct chat
        assert call_args.kwargs['chat_id'] == 12345
        
        # Check that the message contains support text
        message_text = call_args.kwargs['text']
        assert "Поддержка" in message_text
        
        # Check that the inline keyboard is present with URL button
        reply_markup = call_args.kwargs['reply_markup']
        assert reply_markup is not None
        
        # Verify the button has a URL (not callback_data)
        button = reply_markup.inline_keyboard[0][0]
        assert button.url is not None
        assert "t.me" in button.url
        
        print("✅ /support command works correctly!")
    
    @pytest.mark.asyncio
    async def test_start_menu_has_support_button(self, mock_update, mock_context):
        """Test that /start menu includes Support button"""
        print("\n🧪 Testing Support button in /start menu...")
        
        # Mock the banner file
        with patch('builtins.open', mock_open(read_data=b'fake_image_data')):
            await start(mock_update, mock_context)
        
        # Get the inline keyboard from the call
        call_args = mock_context.bot.send_photo.call_args
        reply_markup = call_args.kwargs['reply_markup']
        
        # Find the support button
        support_button_found = False
        for row in reply_markup.inline_keyboard:
            for button in row:
                if "Поддержка" in button.text:
                    support_button_found = True
                    assert button.callback_data == "support"
                    break
        
        assert support_button_found, "Support button not found in main menu"
        
        print("✅ Support button present in /start menu!")
    
    @pytest.mark.asyncio
    async def test_create_photo_text_prompt(self, mock_update, mock_context):
        """Test sending text prompt after clicking 'Создать фото'"""
        print("\n🧪 Testing text prompt in photo creation mode...")
        
        # First, enter photo creation mode
        await create_photo_handler(mock_update, mock_context)
        
        # Now send a text prompt
        mock_update.message.text = "красивый закат над океаном"
        
        # Mock balance + generation pipeline (avoid API/network in tests)
        with patch('handlers.create_photo.check_balance', return_value=True):
            with patch('handlers.create_photo._process_image_generation', new=AsyncMock()) as mock_process:
                result = await handle_photo_prompt(mock_update, mock_context)
        
        # Verify the handler processed the message
        assert result == True
        mock_process.assert_called_once()
        
        # Verify processing message was sent
        assert not mock_context.bot.send_message.called
        
        print("✅ Text prompt handling works correctly!")

    @pytest.mark.asyncio
    async def test_buy_package_creates_sbp_link(self, mock_callback_update, mock_context):
        """Test that package selection creates SBP payment link."""
        print("\n🧪 Testing SBP payment link creation...")

        from bot import SBP_CHECK_CALLBACK_PREFIX
        mock_callback_update.callback_query.data = "buy_100"

        with patch("bot._has_yookassa_api_credentials", return_value=True):
            with patch(
                "bot._create_sbp_payment",
                new=AsyncMock(
                    return_value={
                        "id": "payment_test_1",
                        "confirmation": {"confirmation_url": "https://pay.test/sbp"},
                    }
                ),
            ):
                await button_callback(mock_callback_update, mock_context)

        mock_context.bot.send_message.assert_called_once()
        call_args = mock_context.bot.send_message.call_args
        message_text = call_args.kwargs["text"]
        assert "Оплата" in message_text

        reply_markup = call_args.kwargs["reply_markup"]
        pay_button = reply_markup.inline_keyboard[0][0]
        status_button = reply_markup.inline_keyboard[1][0]
        assert pay_button.url == "https://pay.test/sbp"
        assert status_button.callback_data == f"{SBP_CHECK_CALLBACK_PREFIX}payment_test_1"

        print("✅ SBP payment link creation works correctly!")

    @pytest.mark.asyncio
    async def test_buy_tokens_menu_has_url_payment_buttons(self, mock_update, mock_context):
        """Test that token package buttons are URL buttons for direct payment."""
        print("\n🧪 Testing buy tokens menu URL payment buttons...")

        mocked_payments = [
            {
                "id": f"payment_test_{package_id}",
                "confirmation": {"confirmation_url": f"https://pay.test/sbp/{package_id}"},
            }
            for package_id in ("100", "300", "1000", "3000", "5000")
        ]

        with patch("bot._has_yookassa_api_credentials", return_value=True):
            with patch("bot.YOOKASSA_RECEIPT_EMAIL", "test@example.com"):
                with patch("bot._create_sbp_payment", new=AsyncMock(side_effect=mocked_payments)):
                    await show_buy_tokens_menu(mock_update, mock_context)

        mock_context.bot.send_message.assert_called_once()
        call_args = mock_context.bot.send_message.call_args
        message_text = call_args.kwargs["text"]
        assert "Кнопка пакета сразу открывает оплату" in message_text

        reply_markup = call_args.kwargs["reply_markup"]
        first_row = reply_markup.inline_keyboard[0]
        pay_button = first_row[0]
        check_button = first_row[1]
        assert pay_button.url == "https://pay.test/sbp/100"
        assert check_button.callback_data == "check_sbp:payment_test_100"

        back_button = reply_markup.inline_keyboard[-1][0]
        assert back_button.callback_data == "balance"

        print("✅ Buy tokens menu uses URL payment buttons correctly!")

    @pytest.mark.asyncio
    async def test_sbp_status_success_credits_balance(self, mock_callback_update, mock_context):
        """Test that successful SBP status check credits balance."""
        print("\n🧪 Testing SBP payment status success flow...")

        mock_callback_update.callback_query.data = "check_sbp:payment_test_2"
        sbp_payment_data = {
            "id": "payment_test_2",
            "status": "succeeded",
            "amount": {"value": "100.00", "currency": "RUB"},
            "metadata": {"package_id": "100", "telegram_user_id": "12345"},
        }

        with patch("bot._get_sbp_payment", new=AsyncMock(return_value=sbp_payment_data)):
            with patch("bot.apply_successful_payment", return_value=150) as mock_apply:
                await button_callback(mock_callback_update, mock_context)

        mock_apply.assert_called_once()
        call_args = mock_context.bot.send_message.call_args
        assert "Баланс пополнен" in call_args.kwargs["text"]

        print("✅ SBP payment status success flow works correctly!")

    @pytest.mark.asyncio
    async def test_buy_package_shows_yookassa_error_details(self, mock_callback_update, mock_context):
        """Test that YooKassa error details are shown to speed up debugging."""
        print("\n🧪 Testing YooKassa detailed error propagation...")

        mock_callback_update.callback_query.data = "buy_100"
        with patch("bot._has_yookassa_api_credentials", return_value=True):
            with patch(
                "bot._create_sbp_payment",
                new=AsyncMock(return_value={"error": "ошибка чека (receipt)"}),
            ):
                await button_callback(mock_callback_update, mock_context)

        mock_context.bot.send_message.assert_called_once()
        message_text = mock_context.bot.send_message.call_args.kwargs["text"]
        assert "ошибка чека" in message_text

        print("✅ YooKassa detailed error propagation works correctly!")


class TestBotStateManagement:
    """Test that user states are managed correctly"""
    
    @pytest.mark.asyncio
    async def test_user_state_isolation(self):
        """Test that different users have isolated states in database"""
        print("\n🧪 Testing user state isolation (database-based)...")
        
        from database import get_user_state, clear_user_state
        
        # Clear any existing states
        clear_user_state(111)
        clear_user_state(222)
        
        # Simulate two different users
        user1_update = MagicMock(spec=Update)
        user1_update.effective_user = User(id=111, first_name="User1", is_bot=False)
        user1_update.effective_chat = Chat(id=111, type="private")
        user1_update.message = MagicMock(spec=Message)
        user1_update.message.reply_text = AsyncMock()
        user1_update.callback_query = None
        
        user2_update = MagicMock(spec=Update)
        user2_update.effective_user = User(id=222, first_name="User2", is_bot=False)
        user2_update.effective_chat = Chat(id=222, type="private")
        user2_update.message = MagicMock(spec=Message)
        user2_update.message.reply_text = AsyncMock()
        user2_update.callback_query = None
        
        context = MagicMock(spec=ContextTypes.DEFAULT_TYPE)
        context.user_data = {}
        
        # User 1 enters photo creation mode
        await create_photo_handler(user1_update, context)
        state1 = get_user_state(111)
        assert state1 is not None
        assert state1["feature"] == "create_photo"
        assert state1["state"] == "awaiting_photo_input"
        
        # User 2 enters photo creation mode
        await create_photo_handler(user2_update, context)
        state2 = get_user_state(222)
        assert state2 is not None
        assert state2["feature"] == "create_photo"
        assert state2["state"] == "awaiting_photo_input"
        
        # Both users should still have their independent states
        state1_check = get_user_state(111)
        state2_check = get_user_state(222)
        assert state1_check["state"] == "awaiting_photo_input"
        assert state2_check["state"] == "awaiting_photo_input"
        
        # Cleanup
        clear_user_state(111)
        clear_user_state(222)
        
        print("✅ User state isolation works correctly!")


def run_tests():
    """Run all tests and print summary"""
    print("=" * 70)
    print("🤖 TELEGRAM BOT AUTOMATED TESTS")
    print("=" * 70)
    
    # Run pytest with verbose output
    pytest.main([
        __file__,
        "-v",
        "--tb=short",
        "-s"  # Show print statements
    ])


if __name__ == "__main__":
    run_tests()
