export const ANIMATION_STEP_DELAY_MS = 2900;
const FIRST_EMOJI_DELAY_MULTIPLIER = 2;

function getFirstEmojiDelayMs(): number {
  return ANIMATION_STEP_DELAY_MS * FIRST_EMOJI_DELAY_MULTIPLIER;
}

export function getInitialEmojiDelayMs(initialMessageSentAtMs?: number, nowMs = Date.now()): number {
  const firstEmojiDelayMs = getFirstEmojiDelayMs();
  if (typeof initialMessageSentAtMs !== "number") {
    return firstEmojiDelayMs;
  }

  const elapsedMs = nowMs - initialMessageSentAtMs;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return firstEmojiDelayMs;
  }

  return Math.max(0, firstEmojiDelayMs - elapsedMs);
}

export function getEmojiHoldDelayMs(currentEmojiIndex: number): number {
  return currentEmojiIndex === 0 ? getFirstEmojiDelayMs() : ANIMATION_STEP_DELAY_MS;
}
