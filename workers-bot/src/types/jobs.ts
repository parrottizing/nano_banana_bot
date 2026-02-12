export type JobType =
  | "CREATE_PHOTO_JOB"
  | "ANALYZE_CTR_JOB"
  | "IMPROVE_CTR_JOB"
  | "FLUSH_MEDIA_GROUP_JOB"
  | "PAYMENT_RECONCILE_JOB";

export interface BaseJobPayload {
  id: string;
  type: JobType;
  telegramUserId: number;
  chatId: number;
}

export interface CreatePhotoJobPayload extends BaseJobPayload {
  type: "CREATE_PHOTO_JOB";
  prompt: string;
  fileIds: string[];
  loadingMessageId?: number;
  loadingMessageSentAtMs?: number;
}

export interface AnalyzeCtrJobPayload extends BaseJobPayload {
  type: "ANALYZE_CTR_JOB";
  fileId: string;
  loadingMessageId?: number;
  loadingMessageSentAtMs?: number;
}

export interface ImproveCtrJobPayload extends BaseJobPayload {
  type: "IMPROVE_CTR_JOB";
  sourceFileId: string;
  recommendations: string;
  loadingMessageId?: number;
  loadingMessageSentAtMs?: number;
}

export interface FlushMediaGroupJobPayload extends BaseJobPayload {
  type: "FLUSH_MEDIA_GROUP_JOB";
  mediaGroupId: string;
}

export interface PaymentReconcileJobPayload extends BaseJobPayload {
  type: "PAYMENT_RECONCILE_JOB";
  paymentIds: string[];
}

export type JobPayload =
  | CreatePhotoJobPayload
  | AnalyzeCtrJobPayload
  | ImproveCtrJobPayload
  | FlushMediaGroupJobPayload
  | PaymentReconcileJobPayload;
