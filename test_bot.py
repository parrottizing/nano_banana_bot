"""
Automated tests for the Telegram bot.
Tests all commands and inline keyboard buttons.
"""
import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch, mock_open
from telegram import Update, User, Chat, Message, CallbackQuery, PhotoSize, File
from telegram.ext import ContextTypes
import io
from PIL import Image

# Import the handlers we want to test
from bot import start, button_callback
from handlers.create_photo import create_photo_handler, handle_photo_prompt
from handlers.analyze_ctr import analyze_ctr_handler


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
        return context
    
    @pytest.mark.asyncio
    async def test_start_command(self, mock_update, mock_context):
        """Test /start command displays main menu"""
        print("\n🧪 Testing /start command...")
        
        # Mock the banner file
        with patch('builtins.open', mock_open(read_data=b'fake_image_data')):
            with patch('os.path.join', return_value='/fake/path/menu_banner.png'):
                await start(mock_update, mock_context)
        
        # Verify that send_photo was called with the welcome message
        mock_context.bot.send_photo.assert_called_once()
        call_args = mock_context.bot.send_photo.call_args
        
        # Check that it was sent to the correct chat
        assert call_args.kwargs['chat_id'] == 12345
        
        # Check that the caption contains user information
        caption = call_args.kwargs['caption']
        assert "TestUser" in caption
        assert "testuser" in caption
        assert "Баланс" in caption
        
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
    async def test_create_photo_text_prompt(self, mock_update, mock_context):
        """Test sending text prompt after clicking 'Создать фото'"""
        print("\n🧪 Testing text prompt in photo creation mode...")
        
        # First, enter photo creation mode
        await create_photo_handler(mock_update, mock_context)
        
        # Now send a text prompt
        mock_update.message.text = "красивый закат над океаном"
        
        # Mock the Gemini API
        with patch('handlers.create_photo.analyze_user_intent') as mock_intent:
            mock_intent.return_value = {
                'wants_ctr_improvement': False,
                'is_screenshot': False
            }
            
            with patch('handlers.create_photo.genai.GenerativeModel') as mock_model:
                mock_response = MagicMock()
                mock_response.parts = []
                mock_response.text = None
                mock_model.return_value.generate_content_async = AsyncMock(return_value=mock_response)
                
                result = await handle_photo_prompt(mock_update, mock_context)
        
        # Verify the handler processed the message
        assert result == True
        
        # Verify processing message was sent
        assert mock_context.bot.send_message.called
        
        print("✅ Text prompt handling works correctly!")


class TestBotStateManagement:
    """Test that user states are managed correctly"""
    
    @pytest.mark.asyncio
    async def test_user_state_isolation(self):
        """Test that different users have isolated states"""
        print("\n🧪 Testing user state isolation...")
        
        from handlers.create_photo import user_states
        
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
        
        # User 1 enters photo creation mode
        await create_photo_handler(user1_update, context)
        assert 111 in user_states
        assert user_states[111]["mode"] == "awaiting_photo_input"
        
        # User 2 enters photo creation mode
        await create_photo_handler(user2_update, context)
        assert 222 in user_states
        assert user_states[222]["mode"] == "awaiting_photo_input"
        
        # Both users should have independent states
        assert user_states[111]["mode"] == "awaiting_photo_input"
        assert user_states[222]["mode"] == "awaiting_photo_input"
        
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
