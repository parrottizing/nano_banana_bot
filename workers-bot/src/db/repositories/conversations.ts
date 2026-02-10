export interface LogConversationInput {
  telegramUserId: number;
  feature: string;
  messageType: string;
  content?: string;
  imageCount?: number;
  tokensUsed?: number;
  success?: boolean;
  metadata?: Record<string, unknown>;
}

export async function logConversation(db: D1Database, input: LogConversationInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO conversations
      (telegram_user_id, feature, message_type, content, image_count, tokens_used, success, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.telegramUserId,
      input.feature,
      input.messageType,
      input.content ?? null,
      input.imageCount ?? 0,
      input.tokensUsed ?? 0,
      input.success === false ? 0 : 1,
      input.metadata ? JSON.stringify(input.metadata) : null,
    )
    .run();
}
