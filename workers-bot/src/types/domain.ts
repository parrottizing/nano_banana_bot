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

export type ImageModelKey = "nano_pro" | "nano_flash";

export interface ImageModelOption {
  key: ImageModelKey;
  modelId: string;
  title: string;
  description: string;
  buttonLabel: string;
}

export const IMAGE_MODEL_OPTIONS: Record<ImageModelKey, ImageModelOption> = {
  nano_pro: {
    key: "nano_pro",
    modelId: "gemini-3-pro-image-preview",
    title: "Nano Banana Pro",
    description: "Максимальное качество",
    buttonLabel: "🎯 Точнее в мелочах — Nano Banana Pro",
  },
  nano_flash: {
    key: "nano_flash",
    modelId: "gemini-3.1-flash-image-preview",
    title: "Nano Banana 2",
    description: "Быстрее генерация",
    buttonLabel: "⚡ Быстрее — Nano Banana 2",
  },
};

export const DEFAULT_IMAGE_MODEL_KEY: ImageModelKey = "nano_flash";
export const IMAGE_MODEL = IMAGE_MODEL_OPTIONS[DEFAULT_IMAGE_MODEL_KEY].modelId;
export const TEXT_MODEL = "gemini-3-flash-preview";
export const CLASSIFIER_MODEL = "gemini-3-flash-preview";

export function parseImageModelKey(raw: string | null | undefined): ImageModelKey {
  return raw === "nano_flash" ? raw : DEFAULT_IMAGE_MODEL_KEY;
}

export function getImageModelOption(key: ImageModelKey): ImageModelOption {
  return IMAGE_MODEL_OPTIONS[key];
}

export function getImageModelId(key: ImageModelKey): string {
  return IMAGE_MODEL_OPTIONS[key].modelId;
}

export const JOB_TYPES: JobType[] = [
  "CREATE_PHOTO_JOB",
  "ANALYZE_CTR_JOB",
  "IMPROVE_CTR_JOB",
  "FLUSH_MEDIA_GROUP_JOB",
  "PAYMENT_RECONCILE_JOB",
];
