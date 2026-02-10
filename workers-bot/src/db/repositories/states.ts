import { parseJson } from "./utils";

export interface UserStateRow {
  telegram_user_id: number;
  feature: string;
  state: string;
  state_data_json: string | null;
  updated_at: string;
}

export interface UserState {
  telegram_user_id: number;
  feature: string;
  state: string;
  state_data: Record<string, unknown>;
  updated_at: string;
}

export async function getUserState(db: D1Database, telegramUserId: number): Promise<UserState | null> {
  const row = await db
    .prepare("SELECT * FROM user_states WHERE telegram_user_id = ?")
    .bind(telegramUserId)
    .first<UserStateRow>();

  if (!row) {
    return null;
  }

  return {
    telegram_user_id: row.telegram_user_id,
    feature: row.feature,
    state: row.state,
    state_data: parseJson(row.state_data_json, {}),
    updated_at: row.updated_at,
  };
}

export async function setUserState(
  db: D1Database,
  telegramUserId: number,
  feature: string,
  state: string,
  stateData: Record<string, unknown> = {},
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO user_states (telegram_user_id, feature, state, state_data_json, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(telegram_user_id) DO UPDATE SET
         feature = excluded.feature,
         state = excluded.state,
         state_data_json = excluded.state_data_json,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(telegramUserId, feature, state, JSON.stringify(stateData))
    .run();
}

export async function clearUserState(db: D1Database, telegramUserId: number): Promise<void> {
  await db.prepare("DELETE FROM user_states WHERE telegram_user_id = ?").bind(telegramUserId).run();
}
