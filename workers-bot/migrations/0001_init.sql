PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  telegram_user_id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  balance INTEGER NOT NULL DEFAULT 50,
  image_count INTEGER NOT NULL DEFAULT 1,
  image_model TEXT NOT NULL DEFAULT 'nano_flash',
  has_seen_image_count_prompt INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_active TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_states (
  telegram_user_id INTEGER PRIMARY KEY,
  feature TEXT NOT NULL,
  state TEXT NOT NULL,
  state_data_json TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (telegram_user_id) REFERENCES users(telegram_user_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id INTEGER NOT NULL,
  timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  feature TEXT,
  message_type TEXT,
  content TEXT,
  image_count INTEGER NOT NULL DEFAULT 0,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  success INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT,
  FOREIGN KEY (telegram_user_id) REFERENCES users(telegram_user_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id INTEGER NOT NULL,
  provider_payment_charge_id TEXT UNIQUE,
  telegram_payment_charge_id TEXT UNIQUE,
  payload TEXT,
  currency TEXT,
  amount INTEGER,
  balance_added INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'paid',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (telegram_user_id) REFERENCES users(telegram_user_id)
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  telegram_user_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS media_groups (
  media_group_id TEXT PRIMARY KEY,
  telegram_user_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  caption TEXT,
  photo_file_ids_json TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_timestamp
  ON conversations(telegram_user_id, timestamp);

CREATE INDEX IF NOT EXISTS idx_user_states_updated_at
  ON user_states(updated_at);

CREATE INDEX IF NOT EXISTS idx_payments_user_created_at
  ON payments(telegram_user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_jobs_status_created_at
  ON jobs(status, created_at);

CREATE INDEX IF NOT EXISTS idx_media_groups_status_updated_at
  ON media_groups(status, updated_at);
