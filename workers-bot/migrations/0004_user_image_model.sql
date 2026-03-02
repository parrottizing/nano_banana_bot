PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN image_model TEXT NOT NULL DEFAULT 'nano_flash';
