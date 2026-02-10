import { insertJob } from "../db/repositories";
import type { Env } from "../types/env";
import type { JobPayload } from "../types/jobs";

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function makeJobId(prefix: string): string {
  return `${prefix}_${randomId()}`;
}

export async function enqueueJob(env: Env, payload: JobPayload): Promise<void> {
  await insertJob(env.DB, payload);
  await env.BOT_JOBS.send(payload);
}
