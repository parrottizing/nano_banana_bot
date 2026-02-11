import { describe, expect, it } from "vitest";
import {
  ANIMATION_STEP_DELAY_MS,
  getEmojiHoldDelayMs,
  getInitialEmojiDelayMs,
} from "../src/services/loadingAnimation";

describe("loading animation timing", () => {
  it("keeps the first emoji for 2x the base step", () => {
    expect(getEmojiHoldDelayMs(0)).toBe(ANIMATION_STEP_DELAY_MS * 2);
    expect(getEmojiHoldDelayMs(1)).toBe(ANIMATION_STEP_DELAY_MS);
    expect(getEmojiHoldDelayMs(2)).toBe(ANIMATION_STEP_DELAY_MS);
  });

  it("accounts for queue wait while preserving total first-emoji hold", () => {
    const nowMs = 10_000;
    const sentAtMs = nowMs - 1_500;
    expect(getInitialEmojiDelayMs(sentAtMs, nowMs)).toBe((ANIMATION_STEP_DELAY_MS * 2) - 1_500);
  });

  it("immediately advances if queue wait already exceeded the first hold", () => {
    const nowMs = 20_000;
    const sentAtMs = nowMs - (ANIMATION_STEP_DELAY_MS * 2 + 200);
    expect(getInitialEmojiDelayMs(sentAtMs, nowMs)).toBe(0);
  });
});
