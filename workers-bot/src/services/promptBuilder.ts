import { CTR_ENHANCEMENT_PROMPT } from "../handlers/createPhoto";

const ANTI_WATERMARK_GUARD = [
  "КРИТИЧЕСКИ ВАЖНО ДЛЯ КАЧЕСТВА:",
  "Не добавляй водяные знаки, стоковые отметки, подписи, случайные логотипы или текстовые оверлеи.",
  "Запрещены диагональные и угловые надписи поверх изображения.",
  "Сохраняй реальный брендинг товара только если он является частью самого продукта или явно запрошен пользователем.",
].join("\n");

const ANTI_WATERMARK_GUARD_MARKER = "КРИТИЧЕСКИ ВАЖНО ДЛЯ КАЧЕСТВА:";
const CTR_PROMPT_MARKER = "КРИТИЧЕСКИ ВАЖНО: Пользователь хочет улучшить CTR";

function appendSection(base: string, section: string): string {
  const trimmedBase = base.trimEnd();
  return trimmedBase.length > 0 ? `${trimmedBase}\n\n${section}` : section;
}

export function applyAntiWatermarkGuard(prompt: string): string {
  if (prompt.includes(ANTI_WATERMARK_GUARD_MARKER)) {
    return prompt;
  }
  return appendSection(prompt, ANTI_WATERMARK_GUARD);
}

export function buildCreatePhotoPrompt(prompt: string, wantsCtr: boolean): string {
  let result = prompt;
  if (wantsCtr && !result.includes(CTR_PROMPT_MARKER)) {
    result = appendSection(result, CTR_ENHANCEMENT_PROMPT.trim());
  }
  return applyAntiWatermarkGuard(result);
}

