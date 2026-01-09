# 🍌 Nano Banana Bot

A powerful Telegram bot for AI-powered image generation and CTR (Click-Through Rate) analysis, specifically designed for optimizing marketplace product cards on platforms like Wildberries, Ozon, and Yandex Market.

![Python](https://img.shields.io/badge/python-3.10+-blue.svg)
![Telegram Bot API](https://img.shields.io/badge/Telegram%20Bot%20API-latest-blue.svg)
![Google AI](https://img.shields.io/badge/Google%20AI-Gemini%203-orange.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

---

## ✨ Features

### 🎨 Image Generation
- Generate product images using **Gemini 3 Pro Image Preview**
- Support for text-only prompts or image + text combinations
- Upload up to 5 reference images (max 7MB each)
- Automatic CTR optimization when marketplace-related intent is detected
- Animated loading indicators during processing

### 📊 CTR Analysis
- Analyze product card images for CTR potential
- Receive detailed scoring (1-10) and recommendations
- Get actionable improvement suggestions
- One-click CTR improvement using AI-generated optimized images

### 🎯 Smart Intent Detection
- Uses **Gemma 3 12B** classifier to detect user intent
- Automatically applies CTR optimization prompts when relevant
- Contextual prompt enhancement based on best practices

### 💰 Token Economy
- Built-in balance system for fair usage
- New users receive **50 free tokens**
- Transparent token costs per operation
- Balance tracking and display

---

## 📋 Requirements

- Python 3.10+
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- Google AI API Key (for Gemini access)

---

## 🚀 Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/nano_banana_bot.git
cd nano_banana_bot
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Configure Environment

Create a `.env` file in the project root:

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
GOOGLE_API_KEY=your_google_ai_api_key_here
```

### 4. Run the Bot

```bash
python bot.py
```

You should see: `Bot is running...`

---

## 🎮 Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | 🏠 Open main menu with feature buttons |
| `/create_photo` | 🎨 Start image generation mode |
| `/analyze_ctr` | 📊 Analyze a product card for CTR |
| `/balance` | 💰 Check your current token balance |
| `/support` | 🆘 Get support contact |

### Main Menu Interface

When you start the bot, you'll see an interactive menu with buttons:
- **🎨 Создать фото** — Generate or edit images
- **📊 Анализ CTR** — Analyze product cards
- **💰 Баланс** — Check token balance
- **🆘 Поддержка** — Contact support

---

## 💎 Token Costs

| Operation | Token Cost |
|-----------|------------|
| Image Generation | 10 tokens |
| CTR Analysis | 5 tokens |
| Text-only Response (fallback) | 1 token |

New users start with **50 tokens**.

---

## 📁 Project Structure

```
nano_banana_bot/
├── bot.py                 # Main bot entry point, command handlers
├── requirements.txt       # Python dependencies
├── bot_data.db           # SQLite database (auto-created)
├── .env                  # Environment variables (create this)
├── .gitignore            # Git ignore rules
│
├── handlers/             # Feature handlers
│   ├── __init__.py       # Package exports
│   ├── create_photo.py   # Image generation handler
│   ├── analyze_ctr.py    # CTR analysis handler
│   ├── improve_ctr.py    # CTR improvement handler
│   └── prompt_classifier.py  # Intent classification with Gemma 3
│
├── database/             # Database layer
│   ├── __init__.py       # Package exports
│   └── db.py             # SQLite operations, user/state management
│
├── assets/               # Static assets
│   └── menu_banner.png   # Main menu banner image
│
├── docs/                 # Documentation
│   ├── architecture.md   # System architecture
│   └── api.md            # Internal API reference
│
└── test_bot.py           # Automated tests
```

---

## 🏗️ Architecture Overview

### Core Components

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Telegram   │────▶│   bot.py     │────▶│   Handlers      │
│   User      │◀────│  (routing)   │◀────│   (features)    │
└─────────────┘     └──────────────┘     └────────┬────────┘
                                                  │
                    ┌─────────────────────────────┼─────────────────────────────┐
                    ▼                             ▼                             ▼
           ┌────────────────┐          ┌──────────────────┐          ┌──────────────────┐
           │   Database     │          │  Gemini 3 Pro    │          │   Gemma 3 12B    │
           │   (SQLite)     │          │ (image gen)      │          │  (classifier)    │
           └────────────────┘          └──────────────────┘          └──────────────────┘
```

### Data Flow

1. **User Input** → Telegram sends update to bot
2. **Routing** → `bot.py` routes to appropriate handler based on command/state
3. **State Check** → Handler checks user state in database
4. **Processing** → Handler uses AI models (Gemini/Gemma) for generation/analysis
5. **Response** → Results sent back to user via Telegram API
6. **Logging** → Conversation logged to database

### Database Schema

**users** — User accounts and balances
| Column | Type | Description |
|--------|------|-------------|
| telegram_user_id | INTEGER | Primary key, Telegram user ID |
| username | TEXT | Telegram username |
| first_name | TEXT | User's first name |
| balance | INTEGER | Token balance (default: 50) |
| created_at | TIMESTAMP | Account creation time |
| last_active | TIMESTAMP | Last activity time |

**conversations** — Conversation history
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment ID |
| telegram_user_id | INTEGER | Foreign key to users |
| timestamp | TIMESTAMP | Message timestamp |
| feature | TEXT | Feature used (create_photo, analyze_ctr) |
| message_type | TEXT | Type (user_text, user_image, bot_response, etc.) |
| content | TEXT | Message content |
| image_count | INTEGER | Number of images |
| tokens_used | INTEGER | Tokens consumed |
| success | INTEGER | Success flag (0/1) |
| metadata | TEXT | JSON metadata |

**user_states** — Current user state for multi-step interactions
| Column | Type | Description |
|--------|------|-------------|
| telegram_user_id | INTEGER | Primary key, Telegram user ID |
| feature | TEXT | Active feature |
| state | TEXT | Current state (e.g., awaiting_photo_input) |
| state_data | TEXT | JSON state data |
| updated_at | TIMESTAMP | Last update time |

---

## 🧪 Testing

Run the test suite:

```bash
pytest test_bot.py -v
```

The tests cover:
- All bot commands (`/start`, `/create_photo`, `/analyze_ctr`, `/support`)
- Inline keyboard button handling
- User state isolation
- Message routing

---

## 🔧 Configuration Details

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | ✅ Yes | Your Telegram bot token from @BotFather |
| `GOOGLE_API_KEY` | ✅ Yes | Google AI API key for Gemini access |

### Customization

Edit in `bot.py`:
- `SUPPORT_USERNAME` — Change the support contact username

Edit in `database/db.py`:
- `TOKEN_COSTS` — Adjust token costs per operation
- `DEFAULT_BALANCE` — Change starting balance for new users

Edit in `handlers/create_photo.py`:
- `MAX_IMAGES` — Maximum images per generation request (default: 5)
- `MAX_IMAGE_SIZE_MB` — Maximum image size in MB (default: 7)
- `CTR_ENHANCEMENT_PROMPT` — The CTR optimization prompt template

---

## 🔐 Security Notes

- Never commit your `.env` file to version control
- Keep your API keys private
- The bot uses SQLite for local storage — consider encryption for production
- User data is stored locally in `bot_data.db`

---

## 📝 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📞 Support

For questions or issues, contact the support team or open a GitHub issue.

---

Made with 🍌 and ❤️
