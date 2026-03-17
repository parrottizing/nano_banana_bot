import type { JobType } from "./jobs";

export const TOKEN_COSTS = {
  create_photo: 25,
  analyze_ctr: 10,
} as const;

export const DEFAULT_BALANCE = 50;

export const PAYMENT_START_PARAMETER = "balance_topup";
export const PAYMENT_TITLE = "Пополнение баланса";
export const PAYMENT_CURRENCY = "RUB";

export const PAYMENT_PACKAGES: Record<string, { rub: number; balance: number }> = {
  "100": { rub: 100, balance: 100 },
  "300": { rub: 300, balance: 325 },
  "1000": { rub: 1000, balance: 1100 },
  "3000": { rub: 3000, balance: 3500 },
  "5000": { rub: 5000, balance: 6000 },
};

export const PAYMENT_PACKAGE_ORDER = ["100", "300", "1000", "3000", "5000"];

export const MAX_IMAGES = 6;
export const MAX_IMAGE_SIZE_BYTES = 7 * 1024 * 1024;

export type ImageModelKey = "nano_pro" | "nano_flash" | "chatgpt_image_1_5";
export type ImageModelApiFamily = "gemini_generate_content" | "openai_images";

export interface ImageModelOption {
  key: ImageModelKey;
  modelId: string;
  title: string;
  description: string;
  buttonLabel: string;
  apiFamily: ImageModelApiFamily;
  supportsReferenceImages: boolean;
}

export const IMAGE_MODEL_OPTIONS: Record<ImageModelKey, ImageModelOption> = {
  nano_pro: {
    key: "nano_pro",
    modelId: "gemini-3-pro-image-preview",
    title: "Nano Banana Pro",
    description: "Максимальное качество",
    buttonLabel: "🎯 Точнее в мелочах — Nano Banana Pro",
    apiFamily: "gemini_generate_content",
    supportsReferenceImages: true,
  },
  nano_flash: {
    key: "nano_flash",
    modelId: "gemini-3.1-flash-image-preview",
    title: "Nano Banana 2",
    description: "Быстрее генерация",
    buttonLabel: "⚡ Быстрее — Nano Banana 2",
    apiFamily: "gemini_generate_content",
    supportsReferenceImages: true,
  },
  chatgpt_image_1_5: {
    key: "chatgpt_image_1_5",
    modelId: "gpt-image-1.5",
    title: "ChatGPT-image-1.5",
    description: "Текст и редактирование по референсам через OpenAI-compatible API",
    buttonLabel: "🖼️ ChatGPT-image-1.5",
    apiFamily: "openai_images",
    supportsReferenceImages: true,
  },
};

export const DEFAULT_IMAGE_MODEL_KEY: ImageModelKey = "nano_flash";
export const IMAGE_MODEL = IMAGE_MODEL_OPTIONS[DEFAULT_IMAGE_MODEL_KEY].modelId;
export const TEXT_MODEL = "gemini-3-flash-preview";
export const CLASSIFIER_MODEL = "gemini-3-flash-preview";

export function parseImageModelKey(raw: string | null | undefined): ImageModelKey {
  if (raw === "nano_pro" || raw === "nano_flash" || raw === "chatgpt_image_1_5") {
    return raw;
  }
  return DEFAULT_IMAGE_MODEL_KEY;
}

export function getImageModelOption(key: ImageModelKey): ImageModelOption {
  return IMAGE_MODEL_OPTIONS[key];
}

export function getImageModelId(key: ImageModelKey): string {
  return IMAGE_MODEL_OPTIONS[key].modelId;
}

export function resolveImageModelKeyForRequest(
  key: ImageModelKey,
  options?: { requiresReferenceImages?: boolean },
): ImageModelKey {
  if (options?.requiresReferenceImages && !IMAGE_MODEL_OPTIONS[key].supportsReferenceImages) {
    return DEFAULT_IMAGE_MODEL_KEY;
  }
  return key;
}

export const JOB_TYPES: JobType[] = [
  "CREATE_PHOTO_JOB",
  "ANALYZE_CTR_JOB",
  "IMPROVE_CTR_JOB",
  "FLUSH_MEDIA_GROUP_JOB",
  "PAYMENT_RECONCILE_JOB",
];
