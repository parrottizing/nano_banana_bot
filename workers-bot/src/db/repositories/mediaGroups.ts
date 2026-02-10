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
  const existing = await db
    .prepare("SELECT * FROM media_groups WHERE media_group_id = ?")
    .bind(input.mediaGroupId)
    .first<MediaGroupRow>();

  const existingFileIds = parseJson<string[]>(existing?.photo_file_ids_json, []);
  if (!existingFileIds.includes(input.appendFileId)) {
    existingFileIds.push(input.appendFileId);
  }

  const caption = existing?.caption ?? input.caption;

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
      ) VALUES (?, ?, ?, ?, ?, 'collecting', CURRENT_TIMESTAMP)
      ON CONFLICT(media_group_id) DO UPDATE SET
        caption = COALESCE(media_groups.caption, excluded.caption),
        photo_file_ids_json = excluded.photo_file_ids_json,
        updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      input.mediaGroupId,
      input.telegramUserId,
      input.chatId,
      caption,
      JSON.stringify(existingFileIds),
    )
    .run();

  return {
    mediaGroupId: input.mediaGroupId,
    telegramUserId: input.telegramUserId,
    chatId: input.chatId,
    caption,
    fileIds: existingFileIds,
    status: "collecting",
  };
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
  };
}

export async function markMediaGroupQueued(db: D1Database, mediaGroupId: string): Promise<void> {
  await db
    .prepare("UPDATE media_groups SET status = 'queued', updated_at = CURRENT_TIMESTAMP WHERE media_group_id = ?")
    .bind(mediaGroupId)
    .run();
}

export async function markMediaGroupProcessed(db: D1Database, mediaGroupId: string): Promise<void> {
  await db
    .prepare("UPDATE media_groups SET status = 'processed', updated_at = CURRENT_TIMESTAMP WHERE media_group_id = ?")
    .bind(mediaGroupId)
    .run();
}
