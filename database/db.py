"""
SQLite database module for user data, balance tracking, and conversation logging.
"""
import sqlite3
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any

# Database file path (in the same directory as the bot)
DB_PATH = Path(__file__).parent.parent / "bot_data.db"

# Token costs for operations
TOKEN_COSTS = {
    "create_photo": 10,
    "analyze_ctr": 5,
}

# Default balance for new users
DEFAULT_BALANCE = 50


def get_connection() -> sqlite3.Connection:
    """Get a database connection with row factory."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Initialize the database schema. Called on bot startup."""
    conn = get_connection()
    cursor = conn.cursor()
    
    # Users table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            telegram_user_id INTEGER PRIMARY KEY,
            username TEXT,
            first_name TEXT,
            balance INTEGER DEFAULT 50,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # Conversations table (full logging)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_user_id INTEGER NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            feature TEXT,
            message_type TEXT,
            content TEXT,
            image_count INTEGER DEFAULT 0,
            tokens_used INTEGER DEFAULT 0,
            success INTEGER DEFAULT 1,
            metadata TEXT,
            FOREIGN KEY (telegram_user_id) REFERENCES users(telegram_user_id)
        )
    """)
    
    # User state table (replaces in-memory dicts)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_states (
            telegram_user_id INTEGER PRIMARY KEY,
            feature TEXT,
            state TEXT,
            state_data TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (telegram_user_id) REFERENCES users(telegram_user_id)
        )
    """)
    
    conn.commit()
    conn.close()
    logging.info(f"[Database] Initialized at {DB_PATH}")


# ==================== USER FUNCTIONS ====================

def get_or_create_user(telegram_user_id: int, username: str = None, first_name: str = None) -> Dict[str, Any]:
    """
    Get or create a user record.
    Updates username/first_name and last_active if user exists.
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    # Try to get existing user
    cursor.execute("SELECT * FROM users WHERE telegram_user_id = ?", (telegram_user_id,))
    row = cursor.fetchone()
    
    if row:
        # Update last_active and user info
        cursor.execute("""
            UPDATE users 
            SET last_active = CURRENT_TIMESTAMP, 
                username = COALESCE(?, username),
                first_name = COALESCE(?, first_name)
            WHERE telegram_user_id = ?
        """, (username, first_name, telegram_user_id))
        conn.commit()
        
        # Fetch updated row
        cursor.execute("SELECT * FROM users WHERE telegram_user_id = ?", (telegram_user_id,))
        row = cursor.fetchone()
    else:
        # Create new user
        cursor.execute("""
            INSERT INTO users (telegram_user_id, username, first_name, balance)
            VALUES (?, ?, ?, ?)
        """, (telegram_user_id, username, first_name, DEFAULT_BALANCE))
        conn.commit()
        
        cursor.execute("SELECT * FROM users WHERE telegram_user_id = ?", (telegram_user_id,))
        row = cursor.fetchone()
        logging.info(f"[Database] Created new user {telegram_user_id} with {DEFAULT_BALANCE} tokens")
    
    conn.close()
    return dict(row)


def get_user(telegram_user_id: int) -> Optional[Dict[str, Any]]:
    """Get a user by ID, returns None if not found."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE telegram_user_id = ?", (telegram_user_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def update_user_balance(telegram_user_id: int, amount: int) -> int:
    """
    Update user balance by adding amount (can be negative to subtract).
    Returns the new balance.
    """
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE users 
        SET balance = balance + ?
        WHERE telegram_user_id = ?
    """, (amount, telegram_user_id))
    conn.commit()
    
    cursor.execute("SELECT balance FROM users WHERE telegram_user_id = ?", (telegram_user_id,))
    row = cursor.fetchone()
    conn.close()
    return row["balance"] if row else 0


def check_balance(telegram_user_id: int, required: int) -> bool:
    """Check if user has enough balance."""
    user = get_user(telegram_user_id)
    if not user:
        return False
    return user["balance"] >= required


def deduct_balance(telegram_user_id: int, feature: str) -> int:
    """
    Deduct tokens for a specific feature operation.
    Returns the new balance.
    """
    cost = TOKEN_COSTS.get(feature, 0)
    return update_user_balance(telegram_user_id, -cost)


# ==================== CONVERSATION LOGGING ====================

def log_conversation(
    telegram_user_id: int,
    feature: str,
    message_type: str,
    content: str = None,
    image_count: int = 0,
    tokens_used: int = 0,
    success: bool = True,
    metadata: Dict = None
):
    """
    Log a conversation entry.
    
    Args:
        telegram_user_id: Telegram user ID
        feature: 'create_photo' or 'analyze_ctr'
        message_type: 'user_text', 'user_image', 'bot_response', 'button_click', 'error'
        content: The message content (prompt, response, etc.)
        image_count: Number of images (if applicable)
        tokens_used: How many tokens this operation used
        success: Whether the operation succeeded
        metadata: Additional data as dict (will be JSON serialized)
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute("""
        INSERT INTO conversations 
        (telegram_user_id, feature, message_type, content, image_count, tokens_used, success, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        telegram_user_id,
        feature,
        message_type,
        content,
        image_count,
        tokens_used,
        1 if success else 0,
        json.dumps(metadata) if metadata else None
    ))
    
    conn.commit()
    conn.close()
    logging.debug(f"[Database] Logged {message_type} for user {telegram_user_id}")


# ==================== STATE MANAGEMENT ====================

def get_user_state(telegram_user_id: int) -> Optional[Dict[str, Any]]:
    """
    Get the current state for a user.
    Returns None if user has no active state.
    """
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM user_states WHERE telegram_user_id = ?", (telegram_user_id,))
    row = cursor.fetchone()
    conn.close()
    
    if not row:
        return None
    
    result = dict(row)
    # Parse state_data from JSON
    if result.get("state_data"):
        try:
            result["state_data"] = json.loads(result["state_data"])
        except json.JSONDecodeError:
            result["state_data"] = {}
    else:
        result["state_data"] = {}
    
    return result


def set_user_state(telegram_user_id: int, feature: str, state: str, state_data: Dict = None):
    """
    Set or update the user's current state.
    Uses UPSERT to create or update.
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    state_data_json = json.dumps(state_data) if state_data else None
    
    cursor.execute("""
        INSERT INTO user_states (telegram_user_id, feature, state, state_data, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(telegram_user_id) DO UPDATE SET
            feature = excluded.feature,
            state = excluded.state,
            state_data = excluded.state_data,
            updated_at = CURRENT_TIMESTAMP
    """, (telegram_user_id, feature, state, state_data_json))
    
    conn.commit()
    conn.close()
    logging.debug(f"[Database] Set state for user {telegram_user_id}: {feature}/{state}")


def clear_user_state(telegram_user_id: int):
    """Clear the user's state (after completing an operation)."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM user_states WHERE telegram_user_id = ?", (telegram_user_id,))
    conn.commit()
    conn.close()
    logging.debug(f"[Database] Cleared state for user {telegram_user_id}")
