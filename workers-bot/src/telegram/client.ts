import type { Env } from "../types/env";
import type { TelegramFileResponse, TelegramMessage } from "../types/telegram";

const DEFAULT_TELEGRAM_TIMEOUT_MS = 45_000;

function telegramUrl(token: string, method: string): string {
  return `https://api.telegram.org/bot${token}/${method}`;
}

function telegramFileUrl(token: string, path: string): string {
  return `https://api.telegram.org/file/bot${token}/${path}`;
}

function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type });
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
}

export class TelegramClient {
  constructor(private readonly env: Env) {}

  private getTimeoutMs(): number {
    const raw = this.env.TELEGRAM_HTTP_TIMEOUT_MS;
    if (!raw) {
      return DEFAULT_TELEGRAM_TIMEOUT_MS;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_TELEGRAM_TIMEOUT_MS;
    }
    return Math.floor(parsed);
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutMs = this.getTimeoutMs();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (
        (error instanceof DOMException && error.name === "AbortError")
        || (error instanceof Error && error.name === "AbortError")
      ) {
        throw new Error(`Telegram request timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async callJson<T>(method: string, payload: unknown): Promise<T> {
    const res = await this.fetchWithTimeout(telegramUrl(this.env.TELEGRAM_BOT_TOKEN, method), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const body = (await res.json()) as TelegramApiResponse<T>;
    if (!res.ok || !body.ok) {
      throw new Error(`Telegram ${method} failed: ${res.status} ${body.description ?? "unknown"}`);
    }
    return body.result;
  }

  private async callFormData<T>(method: string, formData: FormData): Promise<T> {
    const res = await this.fetchWithTimeout(telegramUrl(this.env.TELEGRAM_BOT_TOKEN, method), {
      method: "POST",
      body: formData,
    });

    const body = (await res.json()) as TelegramApiResponse<T>;
    if (!res.ok || !body.ok) {
      throw new Error(`Telegram ${method} failed: ${res.status} ${body.description ?? "unknown"}`);
    }
    return body.result;
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await this.callJson("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text,
    });
  }

  async sendMessage(chatId: number, text: string, extra: Record<string, unknown> = {}): Promise<TelegramMessage> {
    return this.callJson("sendMessage", {
      chat_id: chatId,
      text,
      ...extra,
    });
  }

  async editMessageText(chatId: number, messageId: number, text: string, extra: Record<string, unknown> = {}): Promise<void> {
    await this.callJson("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      ...extra,
    });
  }

  async deleteMessage(chatId: number, messageId: number): Promise<void> {
    await this.callJson("deleteMessage", {
      chat_id: chatId,
      message_id: messageId,
    });
  }

  async sendChatAction(chatId: number, action: "typing" | "upload_photo" = "typing"): Promise<void> {
    await this.callJson("sendChatAction", {
      chat_id: chatId,
      action,
    });
  }

  async sendPhoto(chatId: number, photo: string, extra: Record<string, unknown> = {}, isUrl = false): Promise<void> {
    if (isUrl) {
      await this.callJson("sendPhoto", {
        chat_id: chatId,
        photo,
        ...extra,
      });
      return;
    }

    const formData = new FormData();
    formData.append("chat_id", String(chatId));
    formData.append("photo", base64ToBlob(photo, "image/png"), "image.png");

    for (const [key, value] of Object.entries(extra)) {
      formData.append(key, typeof value === "string" ? value : JSON.stringify(value));
    }

    await this.callFormData("sendPhoto", formData);
  }

  async sendMediaGroup(chatId: number, media: Array<Record<string, unknown>>): Promise<void> {
    const formData = new FormData();
    const normalized = media.map((entry, idx) => {
      const mediaValue = String(entry.media ?? "");
      if (!mediaValue.startsWith("data:")) {
        return entry;
      }

      const [meta, data] = mediaValue.split(",", 2);
      const isImage = meta.includes("image");
      const fieldName = `file_${idx}`;
      formData.append(fieldName, base64ToBlob(data, isImage ? "image/png" : "application/octet-stream"),
        isImage ? `image_${idx + 1}.png` : `file_${idx + 1}.bin`);

      return {
        ...entry,
        media: `attach://${fieldName}`,
      };
    });

    formData.append("chat_id", String(chatId));
    formData.append("media", JSON.stringify(normalized));
    await this.callFormData("sendMediaGroup", formData);
  }

  async sendDocument(chatId: number, documentBase64: string, filename: string, caption?: string): Promise<void> {
    const formData = new FormData();
    formData.append("chat_id", String(chatId));
    formData.append("document", base64ToBlob(documentBase64, "application/octet-stream"), filename);
    if (caption) {
      formData.append("caption", caption);
    }
    await this.callFormData("sendDocument", formData);
  }

  async getFile(fileId: string): Promise<TelegramFileResponse> {
    const result = await this.callJson<{ file_path: string }>("getFile", { file_id: fileId });
    return {
      ok: true,
      result,
    };
  }

  async downloadFileAsArrayBuffer(fileId: string): Promise<ArrayBuffer> {
    const file = await this.getFile(fileId);
    if (!file.ok || !file.result.file_path) {
      throw new Error(`Failed to resolve Telegram file path for ${fileId}`);
    }

    const res = await this.fetchWithTimeout(
      telegramFileUrl(this.env.TELEGRAM_BOT_TOKEN, file.result.file_path),
      { method: "GET" },
    );
    if (!res.ok) {
      throw new Error(`Failed to download Telegram file: ${res.status}`);
    }
    return res.arrayBuffer();
  }
}
