import { describe, expect, it } from "vitest";
import {
  applyAntiWatermarkGuard,
  buildCreatePhotoPrompt,
} from "../src/services/promptBuilder";

const WATERMARK_MARKER = "КРИТИЧЕСКИ ВАЖНО ДЛЯ КАЧЕСТВА:";
const CTR_MARKER = "КРИТИЧЕСКИ ВАЖНО: Пользователь хочет улучшить CTR";

function markerCount(value: string, marker: string): number {
  return value.split(marker).length - 1;
}

describe("promptBuilder", () => {
  it("appends anti-watermark guard once", () => {
    const output = applyAntiWatermarkGuard("Создай карточку товара для маркетплейса");
    expect(output).toContain(WATERMARK_MARKER);
    expect(markerCount(output, WATERMARK_MARKER)).toBe(1);
  });

  it("does not duplicate anti-watermark guard when already present", () => {
    const once = applyAntiWatermarkGuard("Создай фото");
    const twice = applyAntiWatermarkGuard(once);
    expect(twice).toBe(once);
    expect(markerCount(twice, WATERMARK_MARKER)).toBe(1);
  });

  it("adds CTR enhancement only when wantsCtr=true", () => {
    const withCtr = buildCreatePhotoPrompt("Сделай визуал товара", true);
    const withoutCtr = buildCreatePhotoPrompt("Сделай визуал товара", false);

    expect(withCtr).toContain(CTR_MARKER);
    expect(withoutCtr).not.toContain(CTR_MARKER);
    expect(withCtr).toContain(WATERMARK_MARKER);
    expect(withoutCtr).toContain(WATERMARK_MARKER);
  });
});

