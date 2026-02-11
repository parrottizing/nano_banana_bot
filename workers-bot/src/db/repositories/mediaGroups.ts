import { parseJson } from "./utils";

export interface MediaGroupRow {
  media_group_id: string;
  telegram_user_id: number;
  chat_id: number;
  caption: string | null;
  photo_file_ids_json: string;
  status: string;
  updated_at: string;
  created_at: string;
}

export interface MediaGroup {
  mediaGroupId: string;
  telegramUserId: number;
  chatId: number;
  caption: string | null;
  fileIds: string[];
  status: string;
  updatedAt: string;
}

export async function upsertMediaGroup(
  db: D1Database,
  input: {
    mediaGroupId: string;
    telegramUserId: number;
    chatId: number;
    caption: string | null;
    appendFileId: string;
  },
): Promise<MediaGroup> {
  await db
    .prepare(
      `INSERT INTO media_groups (
        media_group_id,
        telegram_user_id,
        chat_id,
        caption,
        photo_file_ids_json,
        status,
        updated_at
      ) VALUES (?, ?, ?, ?, json_array(?), 'collecting', CURRENT_TIMESTAMP)
      ON CONFLICT(media_group_id) DO UPDATE SET
        caption = COALESCE(media_groups.caption, excluded.caption),
        photo_file_ids_json = CASE
          WHEN EXISTS (
            SELECT 1
            FROM json_each(media_groups.photo_file_ids_json)
            WHERE json_each.value = json_extract(excluded.photo_file_ids_json, '$[0]')
          ) THEN media_groups.photo_file_ids_json
          ELSE json_insert(
            media_groups.photo_file_ids_json,
            '$[#]',
            json_extract(excluded.photo_file_ids_json, '$[0]')
          )
        END,
        status = 'collecting',
        updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      input.mediaGroupId,
      input.telegramUserId,
      input.chatId,
      input.caption,
      input.appendFileId,
    )
    .run();

  const group = await getMediaGroup(db, input.mediaGroupId);
  if (!group) {
    throw new Error(`Failed to read media group after upsert: ${input.mediaGroupId}`);
  }
  return group;
}

export async function getMediaGroup(db: D1Database, mediaGroupId: string): Promise<MediaGroup | null> {
  const row = await db
    .prepare("SELECT * FROM media_groups WHERE media_group_id = ?")
    .bind(mediaGroupId)
    .first<MediaGroupRow>();
  if (!row) {
    return null;
  }
  return {
    mediaGroupId: row.media_group_id,
    telegramUserId: row.telegram_user_id,
    chatId: row.chat_id,
    caption: row.caption,
    fileIds: parseJson<string[]>(row.photo_file_ids_json, []),
    status: row.status,
    updatedAt: row.updated_at,
  };
}

export async function markMediaGroupProcessingIfAvailable(
  db: D1Database,
  mediaGroupId: string,
  staleAfterSeconds = 120,
): Promise<boolean> {
  const staleWindow = `-${Math.max(1, Math.floor(staleAfterSeconds))} seconds`;
  const result = await db
    .prepare(
      `UPDATE media_groups
       SET status = 'processing', updated_at = CURRENT_TIMESTAMP
       WHERE media_group_id = ?
         AND (
           status = 'collecting'
           OR (status = 'processing' AND updated_at <= datetime('now', ?))
         )`,
    )
    .bind(mediaGroupId, staleWindow)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function markMediaGroupCollecting(db: D1Database, mediaGroupId: string): Promise<void> {
  await db
    .prepare("UPDATE media_groups SET status = 'collecting', updated_at = CURRENT_TIMESTAMP WHERE media_group_id = ?")
    .bind(mediaGroupId)
    .run();
}

export async function markMediaGroupProcessed(db: D1Database, mediaGroupId: string): Promise<void> {
  await db
    .prepare("UPDATE media_groups SET status = 'processed', updated_at = CURRENT_TIMESTAMP WHERE media_group_id = ?")
    .bind(mediaGroupId)
    .run();
}
