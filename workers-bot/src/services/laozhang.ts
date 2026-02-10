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

function toBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
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

async function request<T>(url: string, apiKey: string, payload: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LaoZhang request failed ${res.status}: ${text}`);
  }

  return (await res.json()) as T;
}

export class LaoZhangService {
  constructor(private readonly env: Env) {}

  arrayBufferToBase64(buffer: ArrayBuffer): string {
    return toBase64(buffer);
  }

  async generateImage(req: LaoZhangGenerateImageRequest): Promise<string | null> {
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
      `${BASE_URL}/${req.model ?? IMAGE_MODEL}:generateContent`,
      this.env.LAOZHANG_PER_REQUEST_API_KEY,
      payload,
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
