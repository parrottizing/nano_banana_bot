import { describe, expect, it } from "vitest";
import {
  CTR_ANALYSIS_PROMPT,
  normalizeCtrAnalysisForTelegram,
  stripCtrMarkdownForPlainText,
} from "../src/handlers/analyzeCtr";

describe("CTR analysis formatting", () => {
  it("keeps Telegram-safe instructions in prompt", () => {
    expect(CTR_ANALYSIS_PROMPT).toContain("НЕ используй # для заголовков");
    expect(CTR_ANALYSIS_PROMPT).toContain("НЕ используй ** (двойные звёздочки)");
    expect(CTR_ANALYSIS_PROMPT).toContain("НЕ используй --- для разделителей");
  });

  it("normalizes markdown-style output to Telegram-friendly markup", () => {
    const source = [
      "### Блок заголовка",
      "**Жирный текст**",
      "* Второй пункт",
      "- Первый пункт",
      "---",
      "#### Итог",
    ].join("\n");

    const output = normalizeCtrAnalysisForTelegram(source);

    expect(output).toContain("*Блок заголовка*");
    expect(output).toContain("*Жирный текст*");
    expect(output).toContain("• Первый пункт");
    expect(output).toContain("• Второй пункт");
    expect(output).toContain("*Итог*");
    expect(output).not.toContain("#");
    expect(output).not.toContain("**");
    expect(output).not.toContain("---");
  });

  it("strips markdown markers for plain-text fallback", () => {
    const source = [
      "### Заголовок",
      "**Жирный** и _курсив_",
      "* Пункт A",
      "- Пункт B",
      "----",
    ].join("\n");

    const output = stripCtrMarkdownForPlainText(source);
    expect(output).toContain("Заголовок");
    expect(output).toContain("Жирный и курсив");
    expect(output).toContain("• Пункт A");
    expect(output).toContain("• Пункт B");
    expect(output).not.toContain("#");
    expect(output).not.toContain("**");
    expect(output).not.toContain("_");
    expect(output).not.toContain("----");
  });
});
