import {
  CLASSIFIER_MODEL,
  IMAGE_MODEL,
  TEXT_MODEL,
} from "../types/domain";
import type { Env } from "../types/env";
import type {
  LaoZhangGenerateImageRequest,
  LaoZhangGenerateTextRequest,
} from "../types/providers";

const BASE_URL = "https://api.laozhang.ai/v1beta/models";
const OPENAI_IMAGES_BASE_URL = "https://api.laozhang.ai/v1/images";
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

function toBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

function buildParts(prompt: string, imageBase64?: string[]): Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> {
  const parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [{ text: prompt }];
  if (imageBase64) {
    for (const image of imageBase64) {
      parts.push({
        inline_data: {
          mime_type: "image/jpeg",
          data: image,
        },
      });
    }
  }
  return parts;
}

function parseTimeoutMs(rawValue: string | undefined): number {
  if (!rawValue) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }

  return Math.floor(parsed);
}

function isOpenAiImageModel(model: string): boolean {
  return model.startsWith("gpt-image-");
}

function getImageApiKey(env: Env, model: string): string {
  return isOpenAiImageModel(model)
    ? env.LAOZHANG_PER_USE_API_KEY
    : env.LAOZHANG_PER_REQUEST_API_KEY;
}

function toOpenAiImageSize(aspectRatio: string | undefined): string {
  if (aspectRatio === "3:4" || aspectRatio === "9:16") {
    return "1024x1536";
  }
  if (aspectRatio === "16:9" || aspectRatio === "4:3") {
    return "1536x1024";
  }
  if (aspectRatio === "1:1") {
    return "1024x1024";
  }
  return "auto";
}

async function request<T>(url: string, apiKey: string, payload: unknown, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;

  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    if ((error instanceof DOMException && error.name === "AbortError") || (error instanceof Error && error.name === "AbortError")) {
      throw new Error(`LaoZhang request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LaoZhang request failed ${res.status}: ${text}`);
  }

  return (await res.json()) as T;
}

async function requestFormData<T>(url: string, apiKey: string, formData: FormData, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;

  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
      signal: controller.signal,
    });
  } catch (error) {
    if ((error instanceof DOMException && error.name === "AbortError") || (error instanceof Error && error.name === "AbortError")) {
      throw new Error(`LaoZhang request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LaoZhang request failed ${res.status}: ${text}`);
  }

  return (await res.json()) as T;
}

export class LaoZhangService {
  constructor(private readonly env: Env) {}

  private getRequestTimeoutMs(): number {
    return parseTimeoutMs(this.env.LAOZHANG_HTTP_TIMEOUT_MS);
  }

  arrayBufferToBase64(buffer: ArrayBuffer): string {
    return toBase64(buffer);
  }

  async generateImage(req: LaoZhangGenerateImageRequest): Promise<string | null> {
    const model = req.model ?? IMAGE_MODEL;
    const apiKey = getImageApiKey(this.env, model);

    if (isOpenAiImageModel(model)) {
      if (req.imageBase64?.length) {
        const formData = new FormData();
        formData.append("model", model);
        formData.append("prompt", req.prompt);
        formData.append("input_fidelity", "high");
        formData.append("response_format", "b64_json");

        for (const [index, image] of req.imageBase64.entries()) {
          formData.append("image[]", base64ToBlob(image, "image/jpeg"), `reference-${index + 1}.jpg`);
        }

        const result = await requestFormData<Record<string, unknown>>(
          `${OPENAI_IMAGES_BASE_URL}/edits`,
          apiKey,
          formData,
          this.getRequestTimeoutMs(),
        );

        const imageData = (result as any)?.data?.[0]?.b64_json ?? null;
        return typeof imageData === "string" ? imageData : null;
      }

      const payload = {
        model,
        prompt: req.prompt,
        n: 1,
        size: toOpenAiImageSize(req.aspectRatio),
        quality: "auto",
        output_format: "png",
        response_format: "b64_json",
      };

      const result = await request<Record<string, unknown>>(
        `${OPENAI_IMAGES_BASE_URL}/generations`,
        apiKey,
        payload,
        this.getRequestTimeoutMs(),
      );

      const imageData = (result as any)?.data?.[0]?.b64_json ?? null;
      return typeof imageData === "string" ? imageData : null;
    }

    const payload = {
      contents: [{ parts: buildParts(req.prompt, req.imageBase64) }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: {
          aspectRatio: req.aspectRatio ?? "3:4",
          imageSize: req.imageSize ?? "2K",
        },
      },
    };

    const result = await request<Record<string, unknown>>(
      `${BASE_URL}/${model}:generateContent`,
      apiKey,
      payload,
      this.getRequestTimeoutMs(),
    );

    const imageData =
      (result as any)?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data ?? null;
    return typeof imageData === "string" ? imageData : null;
  }

  async generateText(req: LaoZhangGenerateTextRequest): Promise<string | null> {
    const payload: Record<string, unknown> = {
      contents: [{ parts: buildParts(req.prompt, req.imageBase64) }],
      generationConfig: {
        responseModalities: ["TEXT"],
      },
    };

    const generationConfig = payload.generationConfig as Record<string, unknown>;
    if (typeof req.temperature === "number") {
      generationConfig.temperature = req.temperature;
    }
    if (typeof req.maxOutputTokens === "number") {
      generationConfig.maxOutputTokens = req.maxOutputTokens;
    }

    const result = await request<Record<string, unknown>>(
      `${BASE_URL}/${req.model ?? TEXT_MODEL}:generateContent`,
      this.env.LAOZHANG_PER_USE_API_KEY,
      payload,
      this.getRequestTimeoutMs(),
    );

    const text = (result as any)?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
    return typeof text === "string" ? text : null;
  }

  async classifyCtrIntent(prompt: string): Promise<boolean> {
    const classifierPrompt = `Analyze the following user request and determine if the user wants to improve CTR (Click-Through Rate) for their product, advertisement, or marketplace listing.\n\nUser request: "${prompt}"\n\nAnswer with ONLY "yes" or "no".`;

    const answer = await this.generateText({
      prompt: classifierPrompt,
      model: CLASSIFIER_MODEL,
      temperature: 0,
      maxOutputTokens: 10,
    });

    return (answer ?? "").trim().toLowerCase().startsWith("yes");
  }
}

export { IMAGE_MODEL, TEXT_MODEL };
