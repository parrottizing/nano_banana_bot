import { describe, expect, it } from "vitest";
import { DEFAULT_IMAGE_MODEL_KEY, parseImageModelKey } from "../src/types/domain";

describe("parseImageModelKey", () => {
  it("returns nano_pro for saved pro model", () => {
    expect(parseImageModelKey("nano_pro")).toBe("nano_pro");
  });

  it("returns nano_flash for saved flash model", () => {
    expect(parseImageModelKey("nano_flash")).toBe("nano_flash");
  });

  it("falls back to default for unknown values", () => {
    expect(parseImageModelKey("unknown_model")).toBe(DEFAULT_IMAGE_MODEL_KEY);
  });
});
