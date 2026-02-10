export type JobType =
  | "CREATE_PHOTO_JOB"
  | "ANALYZE_CTR_JOB"
  | "IMPROVE_CTR_JOB"
  | "FLUSH_MEDIA_GROUP_JOB";

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
}

export interface AnalyzeCtrJobPayload extends BaseJobPayload {
  type: "ANALYZE_CTR_JOB";
  fileId: string;
}

export interface ImproveCtrJobPayload extends BaseJobPayload {
  type: "IMPROVE_CTR_JOB";
  sourceFileId: string;
  recommendations: string;
}

export interface FlushMediaGroupJobPayload extends BaseJobPayload {
  type: "FLUSH_MEDIA_GROUP_JOB";
  mediaGroupId: string;
}

export type JobPayload =
  | CreatePhotoJobPayload
  | AnalyzeCtrJobPayload
  | ImproveCtrJobPayload
  | FlushMediaGroupJobPayload;
