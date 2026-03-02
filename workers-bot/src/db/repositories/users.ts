import {
  DEFAULT_BALANCE,
  DEFAULT_IMAGE_MODEL_KEY,
  type ImageModelKey,
  parseImageModelKey,
} from "../../types/domain";

export interface UserRow {
  telegram_user_id: number;
  username: string | null;
  first_name: string | null;
  balance: number;
  image_count: number;
  image_model: string;
  has_seen_image_count_prompt: number;
  receipt_email: string | null;
  created_at: string;
  last_active: string;
}

export async function getUser(db: D1Database, telegramUserId: number): Promise<UserRow | null> {
  const row = await db
    .prepare("SELECT * FROM users WHERE telegram_user_id = ?")
    .bind(telegramUserId)
    .first<UserRow>();
  return row ?? null;
}

export async function getOrCreateUser(
  db: D1Database,
  telegramUserId: number,
  username?: string,
  firstName?: string,
): Promise<UserRow> {
  await db
    .prepare(
      `INSERT INTO users (telegram_user_id, username, first_name, balance, image_model)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(telegram_user_id) DO UPDATE SET
         username = COALESCE(excluded.username, users.username),
         first_name = COALESCE(excluded.first_name, users.first_name),
         last_active = CURRENT_TIMESTAMP`,
    )
    .bind(telegramUserId, username ?? null, firstName ?? null, DEFAULT_BALANCE, DEFAULT_IMAGE_MODEL_KEY)
    .run();

  const user = await getUser(db, telegramUserId);
  if (!user) {
    throw new Error("Failed to load user after upsert");
  }
  return user;
}

export async function updateUserBalance(db: D1Database, telegramUserId: number, amount: number): Promise<number> {
  await db
    .prepare("UPDATE users SET balance = balance + ?, last_active = CURRENT_TIMESTAMP WHERE telegram_user_id = ?")
    .bind(amount, telegramUserId)
    .run();
  const row = await db
    .prepare("SELECT balance FROM users WHERE telegram_user_id = ?")
    .bind(telegramUserId)
    .first<{ balance: number }>();
  return row?.balance ?? 0;
}

export async function setUserReceiptEmail(db: D1Database, telegramUserId: number, email: string): Promise<void> {
  await db
    .prepare("UPDATE users SET receipt_email = ?, last_active = CURRENT_TIMESTAMP WHERE telegram_user_id = ?")
    .bind(email.trim(), telegramUserId)
    .run();
}

export async function checkBalance(db: D1Database, telegramUserId: number, required: number): Promise<boolean> {
  const row = await db
    .prepare("SELECT balance FROM users WHERE telegram_user_id = ?")
    .bind(telegramUserId)
    .first<{ balance: number }>();
  return (row?.balance ?? 0) >= required;
}

export async function setUserImageCount(db: D1Database, telegramUserId: number, count: 1 | 2 | 4): Promise<void> {
  await db
    .prepare("UPDATE users SET image_count = ?, last_active = CURRENT_TIMESTAMP WHERE telegram_user_id = ?")
    .bind(count, telegramUserId)
    .run();
}

export async function getUserImageCount(db: D1Database, telegramUserId: number): Promise<1 | 2 | 4> {
  const row = await db
    .prepare("SELECT image_count FROM users WHERE telegram_user_id = ?")
    .bind(telegramUserId)
    .first<{ image_count: number }>();
  const count = row?.image_count ?? 1;
  if (count === 2 || count === 4) {
    return count;
  }
  return 1;
}

export async function setUserImageModel(db: D1Database, telegramUserId: number, model: ImageModelKey): Promise<void> {
  await db
    .prepare("UPDATE users SET image_model = ?, last_active = CURRENT_TIMESTAMP WHERE telegram_user_id = ?")
    .bind(model, telegramUserId)
    .run();
}

export async function getUserImageModel(db: D1Database, telegramUserId: number): Promise<ImageModelKey> {
  const row = await db
    .prepare("SELECT image_model FROM users WHERE telegram_user_id = ?")
    .bind(telegramUserId)
    .first<{ image_model: string | null }>();
  if (!row) {
    return DEFAULT_IMAGE_MODEL_KEY;
  }
  return parseImageModelKey(row.image_model);
}

export async function shouldShowImageCountPrompt(db: D1Database, telegramUserId: number): Promise<boolean> {
  const row = await db
    .prepare("SELECT has_seen_image_count_prompt, balance FROM users WHERE telegram_user_id = ?")
    .bind(telegramUserId)
    .first<{ has_seen_image_count_prompt: number; balance: number }>();
  if (!row) {
    return false;
  }
  return row.has_seen_image_count_prompt === 0 && row.balance > DEFAULT_BALANCE;
}

export async function markImageCountPromptSeen(db: D1Database, telegramUserId: number): Promise<void> {
  await db
    .prepare(
      "UPDATE users SET has_seen_image_count_prompt = 1, last_active = CURRENT_TIMESTAMP WHERE telegram_user_id = ?",
    )
    .bind(telegramUserId)
    .run();
}
