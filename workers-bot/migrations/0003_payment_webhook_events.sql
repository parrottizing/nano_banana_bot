CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  stage TEXT NOT NULL,
  event_type TEXT,
  payment_id TEXT,
  http_status INTEGER,
  reason TEXT,
  telegram_user_id INTEGER,
  package_id TEXT,
  amount INTEGER,
  currency TEXT,
  balance_added INTEGER,
  payload_json TEXT,
  verified_json TEXT,
  request_meta_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_payment_created
  ON payment_webhook_events(payment_id, created_at);

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_stage_created
  ON payment_webhook_events(stage, created_at);
