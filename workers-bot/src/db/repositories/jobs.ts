import type { JobPayload, JobType } from "../../types/jobs";

export async function insertJob(db: D1Database, payload: JobPayload): Promise<void> {
  await db
    .prepare(
      `INSERT OR REPLACE INTO jobs (id, job_type, telegram_user_id, chat_id, status, payload_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
    .bind(payload.id, payload.type, payload.telegramUserId, payload.chatId, "queued", JSON.stringify(payload))
    .run();
}

export async function markJobRunning(db: D1Database, id: string): Promise<void> {
  await db
    .prepare("UPDATE jobs SET status = 'running', error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(id)
    .run();
}

export async function markJobDone(db: D1Database, id: string): Promise<void> {
  await db
    .prepare("UPDATE jobs SET status = 'done', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(id)
    .run();
}

export async function markJobFailed(db: D1Database, id: string, error: string): Promise<void> {
  await db
    .prepare("UPDATE jobs SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(error, id)
    .run();
}

export async function listJobsByStatus(db: D1Database, status: string): Promise<Array<{ id: string; job_type: JobType }>> {
  const res = await db
    .prepare("SELECT id, job_type FROM jobs WHERE status = ? ORDER BY created_at DESC")
    .bind(status)
    .all<{ id: string; job_type: JobType }>();
  return res.results;
}
