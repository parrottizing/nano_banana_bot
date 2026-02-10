import { describe, expect, it } from "vitest";
import { buildImprovementPrompt } from "../src/handlers/improveCtr";

describe("buildImprovementPrompt", () => {
  it("prioritizes recommendations section when 💡 exists", () => {
    const source = "text before\n💡 КОНКРЕТНЫЕ РЕКОМЕНДАЦИИ:\n1. Foo";
    const prompt = buildImprovementPrompt(source);

    expect(prompt).toContain("💡 КОНКРЕТНЫЕ РЕКОМЕНДАЦИИ");
    expect(prompt).not.toContain("text before");
  });

  it("uses full text when recommendations section is absent", () => {
    const source = "Use cleaner composition and stronger contrast";
    const prompt = buildImprovementPrompt(source);
    expect(prompt).toContain(source);
  });
});
