import { afterEach, describe, expect, it, vi } from "vitest";
import { LaoZhangService } from "../src/services/laozhang";

function makeEnv() {
  return {
    DB: {} as D1Database,
    BOT_JOBS: {
      send: async () => {},
      sendBatch: async () => {},
    } as unknown as Queue,
    TELEGRAM_BOT_TOKEN: "token",
    TELEGRAM_WEBHOOK_SECRET: "path-secret",
    TELEGRAM_WEBHOOK_HEADER_SECRET: "header-secret",
    LAOZHANG_PER_REQUEST_API_KEY: "request-key",
    LAOZHANG_PER_USE_API_KEY: "use-key",
    YOOKASSA_SHOP_ID: "shop",
    YOOKASSA_SECRET_KEY: "secret",
    SUPPORT_USERNAME: "support_user",
  };
}

describe("LaoZhangService.generateImage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses Gemini generateContent payload for Nano Banana models", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ inlineData: { data: "gemini-image" } }] } }],
      }),
    });

    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const service = new LaoZhangService(makeEnv() as any);
    const image = await service.generateImage({
      prompt: "Generate a marketplace card",
      aspectRatio: "3:4",
      imageSize: "2K",
      model: "gemini-3.1-flash-image-preview",
    });

    expect(image).toBe("gemini-image");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.laozhang.ai/v1beta/models/gemini-3.1-flash-image-preview:generateContent");
    expect(requestInit.headers).toMatchObject({
      Authorization: "Bearer request-key",
      "Content-Type": "application/json",
    });

    const body = JSON.parse(String(requestInit.body));
    expect(body).toMatchObject({
      contents: [{ parts: [{ text: "Generate a marketplace card" }] }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: {
          aspectRatio: "3:4",
          imageSize: "2K",
        },
      },
    });
  });

  it("uses OpenAI-compatible Images API payload for gpt-image-1.5", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ b64_json: "openai-image" }],
      }),
    });

    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const service = new LaoZhangService(makeEnv() as any);
    const image = await service.generateImage({
      prompt: "Create a product hero shot",
      aspectRatio: "3:4",
      model: "gpt-image-1.5",
    });

    expect(image).toBe("openai-image");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.laozhang.ai/v1/images/generations");
    expect(requestInit.headers).toMatchObject({
      Authorization: "Bearer use-key",
      "Content-Type": "application/json",
    });

    const body = JSON.parse(String(requestInit.body));
    expect(body).toMatchObject({
      model: "gpt-image-1.5",
      prompt: "Create a product hero shot",
      n: 1,
      size: "1024x1536",
      quality: "auto",
      output_format: "png",
      response_format: "b64_json",
    });
  });

  it("uses OpenAI-compatible Images edit API for gpt-image-1.5 reference-image editing", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ b64_json: "edited-image" }],
      }),
    });

    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const service = new LaoZhangService(makeEnv() as any);
    const image = await service.generateImage({
      prompt: "Edit this image",
      imageBase64: ["aGVsbG8=", "d29ybGQ="],
      model: "gpt-image-1.5",
    });

    expect(image).toBe("edited-image");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.laozhang.ai/v1/images/edits");
    expect(requestInit.headers).toMatchObject({
      Authorization: "Bearer use-key",
    });

    const body = requestInit.body;
    expect(body).toBeInstanceOf(FormData);

    const formData = body as FormData;
    expect(formData.get("model")).toBe("gpt-image-1.5");
    expect(formData.get("prompt")).toBe("Edit this image");
    expect(formData.get("input_fidelity")).toBe("high");
    expect(formData.get("response_format")).toBe("b64_json");
    expect(formData.getAll("image[]")).toHaveLength(2);
  });
});
