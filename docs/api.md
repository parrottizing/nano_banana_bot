# 📚 API Reference

Internal API documentation for Nano Banana Bot modules.

---

## Database Module (`database/db.py`)

### Constants

```python
DB_PATH = Path(__file__).parent.parent / "bot_data.db"

TOKEN_COSTS = {
    "create_photo": 25,
    "analyze_ctr": 10,
}

DEFAULT_BALANCE = 50
```

---

### Database Functions

#### `init_db()`
Initialize the database schema. Creates tables if they don't exist.

```python
init_db()
```

Called automatically on bot startup via `post_init`.

---

#### `get_connection()`
Get a database connection with row factory enabled.

```python
conn = get_connection()
# Returns: sqlite3.Connection with Row factory
```

---

### User Functions

#### `get_or_create_user(telegram_user_id, username, first_name)`
Get existing user or create new one with default balance.

```python
user = get_or_create_user(
    telegram_user_id=12345,
    username="john_doe",
    first_name="John"
)
# Returns: dict with user data
# {
#     "telegram_user_id": 12345,
#     "username": "john_doe",
#     "first_name": "John",
#     "balance": 50,
#     "created_at": "2024-01-01 12:00:00",
#     "last_active": "2024-01-01 12:00:00"
# }
```

---

#### `get_user(telegram_user_id)`
Get user by Telegram ID.

```python
user = get_user(12345)
# Returns: dict or None if not found
```

---

#### `update_user_balance(telegram_user_id, amount)`
Add or subtract from user balance.

```python
# Add 10 tokens
new_balance = update_user_balance(12345, 10)

# Subtract 5 tokens
new_balance = update_user_balance(12345, -5)

# Returns: int (new balance)
```

---

#### `check_balance(telegram_user_id, required)`
Check if user has sufficient balance.

```python
has_enough = check_balance(12345, TOKEN_COSTS["create_photo"])
# Returns: bool
```

---

#### `deduct_balance(telegram_user_id, feature)`
Deduct tokens for a specific feature.

```python
new_balance = deduct_balance(12345, "create_photo")
# Returns: int (new balance after deduction)
```

---

### State Management Functions

#### `get_user_state(telegram_user_id)`
Get current state for a user.

```python
state = get_user_state(12345)
# Returns: dict or None
# {
#     "telegram_user_id": 12345,
#     "feature": "create_photo",
#     "state": "awaiting_photo_input",
#     "state_data": {"images": []},  # Parsed from JSON
#     "updated_at": "2024-01-01 12:00:00"
# }
```

---

#### `set_user_state(telegram_user_id, feature, state, state_data)`
Set or update user's current state (UPSERT operation).

```python
set_user_state(
    telegram_user_id=12345,
    feature="create_photo",
    state="awaiting_photo_input",
    state_data={"images": []}
)
```

---

#### `clear_user_state(telegram_user_id)`
Remove user's state after completing operation.

```python
clear_user_state(12345)
```

---

### Logging Functions

#### `log_conversation(...)`
Log a conversation entry for analytics.

```python
log_conversation(
    telegram_user_id=12345,
    feature="create_photo",           # or "analyze_ctr"
    message_type="user_prompt",       # See types below
    content="Create a sunset image",
    image_count=0,
    tokens_used=10,
    success=True,
    metadata={"extra": "data"}        # Optional, stored as JSON
)
```

**Message Types:**
| Type | Description |
|------|-------------|
| `command` | Bot command used |
| `button_click` | Inline button pressed |
| `user_prompt` | User's text input |
| `user_image` | User sent image |
| `bot_response` | Bot's text response |
| `bot_image_generated` | Bot generated image |
| `bot_text_response` | Text-only response |
| `error` | Error occurred |

---

## Handlers Module

### Create Photo Handler (`handlers/create_photo.py`)

#### Constants

```python
MODEL_NAME = "gemini-3-pro-image-preview"
MAX_IMAGES = 5
MAX_IMAGE_SIZE_MB = 7
PHOTO_LOADING_EMOJIS = ["🤔", "💡", "🎨"]
ANIMATION_STEP_DELAY = 2.9  # seconds
```

---

#### `create_photo_handler(update, context)`
Entry point for image generation feature.

```python
# Called by:
# - /create_photo command
# - "Создать фото" button click

await create_photo_handler(update, context)
```

**Behavior:**
1. Sets user state to `create_photo / awaiting_photo_input`
2. Logs button click
3. Displays prompt with balance info

---

#### `handle_create_photo_image(update, context) -> bool`
Handle incoming photos in create_photo mode.

```python
handled = await handle_create_photo_image(update, context)
# Returns: True if handled, False if not in correct state
```

**Requirements:**
- User must be in `create_photo / awaiting_photo_input` state
- Photo must have a caption (the prompt)
- User must have sufficient balance

---

#### `handle_photo_prompt(update, context) -> bool`
Handle incoming text prompts in create_photo mode.

```python
handled = await handle_photo_prompt(update, context)
# Returns: True if handled, False if not in correct state
```

---

#### `run_loading_animation(context, chat_id)` (async)
Internal coroutine for animated loading indicator.

```python
# Usage (with cancellation):
animation_task = asyncio.create_task(run_loading_animation(context, chat_id))
try:
    # ... do work ...
finally:
    animation_task.cancel()
    try:
        await animation_task
    except asyncio.CancelledError:
        pass
```

---

### Analyze CTR Handler (`handlers/analyze_ctr.py`)

#### Constants

```python
MODEL_NAME = "gemini-3-flash-preview"
CTR_LOADING_EMOJIS = ["🔍", "✍️", "📝"]
ANIMATION_STEP_DELAY = 2.9  # seconds
```

---

#### `analyze_ctr_handler(update, context)`
Entry point for CTR analysis feature.

```python
await analyze_ctr_handler(update, context)
```

**Behavior:**
1. Sets user state to `analyze_ctr / awaiting_ctr_image`
2. Logs button click
3. Prompts user to send product image

---

#### `handle_ctr_photo(update, context) -> bool`
Handle incoming photos for CTR analysis.

```python
handled = await handle_ctr_photo(update, context)
# Returns: True if handled, False if not in correct state
```

**Behavior:**
1. Downloads and processes image
2. Sends to Gemini for analysis
3. Stores results for potential improvement
4. Displays analysis with "Improve" button

---

#### `handle_ctr_text(update, context) -> bool`
Handle text when expecting image - reminds user to send photo.

```python
handled = await handle_ctr_text(update, context)
# Returns: True if handled, False if not in correct state
```

---

#### `safe_send_message(bot, chat_id, text, parse_mode, reply_markup)`
Send message with Markdown fallback.

```python
await safe_send_message(
    bot=context.bot,
    chat_id=12345,
    text="*Bold* text",
    parse_mode="Markdown",
    reply_markup=keyboard
)
```

Falls back to plain text if Markdown parsing fails.

---

### Improve CTR Handler (`handlers/improve_ctr.py`)

#### `start_ctr_improvement(update, context)`
Handle "Improve CTR" button click.

```python
await start_ctr_improvement(update, context)
```

**Behavior:**
1. Retrieves stored analysis data from user state
2. Downloads original image
3. Builds improvement prompt from recommendations
4. Triggers image generation with optimizations

---

#### `_build_improvement_prompt(recommendations) -> str`
Build generation prompt from CTR recommendations.

```python
prompt = _build_improvement_prompt(ctr_analysis_text)
# Returns: str with formatted improvement instructions
```

Extracts only the "💡 КОНКРЕТНЫЕ РЕКОМЕНДАЦИИ" section.

---

### Prompt Classifier (`handlers/prompt_classifier.py`)

#### Constants

```python
CLASSIFIER_MODEL = "gemma-3-12b-it"
CLASSIFICATION_TEMPERATURE = 0  # Deterministic
```

---

#### `analyze_user_intent(prompt, images) -> dict`
Analyze user intent for CTR optimization.

```python
intent = await analyze_user_intent(
    prompt="Create a product card for my shoes",
    images=[pil_image_1, pil_image_2]
)
# Returns:
# {
#     "wants_ctr_improvement": True,
#     "raw_ctr_response": "yes"
# }
```

**Important:** Returns `False` for all checks if no images provided.

---

## Main Bot (`bot.py`)

### Commands

#### `start(update, context)`
Display main menu with banner image.

---

#### `support(update, context)`
Display support information with contact button.

---

#### `show_balance(update, context)`
Display user's token balance and costs.

---

### Routing

#### `button_callback(update, context)`
Route inline button callbacks.

| callback_data | Action |
|---------------|--------|
| `create_photo` | → `create_photo_handler()` |
| `analyze_ctr` | → `analyze_ctr_handler()` |
| `improve_ctr` | → `start_ctr_improvement()` |
| `balance` | → `show_balance()` |
| `buy_tokens` | Shows "coming soon" alert |
| `support` | → `support()` |
| `main_menu` | → `start()` |

---

#### `handle_message(update, context)`
Route text messages based on user state.

**Priority:**
1. `handle_photo_prompt()` (create_photo mode)
2. `handle_ctr_text()` (analyze_ctr mode)
3. Default: Menu hint

---

#### `handle_photo(update, context)`
Route photo messages based on user state.

**Priority:**
1. `handle_create_photo_image()` (create_photo mode)
2. `handle_ctr_photo()` (analyze_ctr mode)
3. Default: Menu hint

---

### Initialization

#### `setup_bot_commands(application)`
Set up bot menu commands visible in Telegram.

```python
commands = [
    BotCommand("start", "🏠 Главное меню"),
    BotCommand("create_photo", "🎨 Создать фото"),
    BotCommand("analyze_ctr", "📊 Анализ CTR"),
    BotCommand("balance", "💰 Ваш баланс"),
    BotCommand("support", "🆘 Поддержка"),
]
```

---

## Error Codes

| Error | Cause | Resolution |
|-------|-------|------------|
| Insufficient tokens | Balance < cost | Top up balance |
| Image too large | File > 7MB | Use smaller image |
| No caption | Image sent without text | Resend with caption |
| State not found | Clicked old button | Start new operation |
| API error | Gemini/Telegram issue | Retry later |
