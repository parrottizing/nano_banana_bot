export interface LaoZhangGenerateImageRequest {
  prompt: string;
  imageBase64?: string[];
  aspectRatio?: string;
  imageSize?: string;
  model?: string;
}

export interface LaoZhangGenerateTextRequest {
  prompt: string;
  imageBase64?: string[];
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface PaymentWebhookEvent {
  event: string;
  object: {
    id: string;
    status: string;
    amount?: {
      value: string;
      currency: string;
    };
    metadata?: Record<string, string>;
  };
}
