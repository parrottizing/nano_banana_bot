import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMAGE_MODEL_KEY,
  parseImageModelKey,
  resolveImageModelKeyForRequest,
} from "../src/types/domain";

describe("parseImageModelKey", () => {
  it("returns nano_pro for saved pro model", () => {
    expect(parseImageModelKey("nano_pro")).toBe("nano_pro");
  });

  it("returns nano_flash for saved flash model", () => {
    expect(parseImageModelKey("nano_flash")).toBe("nano_flash");
  });

  it("returns chatgpt_image_1_5 for saved GPT image model", () => {
    expect(parseImageModelKey("chatgpt_image_1_5")).toBe("chatgpt_image_1_5");
  });

  it("falls back to default for unknown values", () => {
    expect(parseImageModelKey("unknown_model")).toBe(DEFAULT_IMAGE_MODEL_KEY);
  });
});

describe("resolveImageModelKeyForRequest", () => {
  it("keeps gpt-image selection for text-only generation", () => {
    expect(resolveImageModelKeyForRequest("chatgpt_image_1_5")).toBe("chatgpt_image_1_5");
  });

  it("keeps gpt-image selection for reference-image generation", () => {
    expect(
      resolveImageModelKeyForRequest("chatgpt_image_1_5", { requiresReferenceImages: true }),
    ).toBe("chatgpt_image_1_5");
  });
});
