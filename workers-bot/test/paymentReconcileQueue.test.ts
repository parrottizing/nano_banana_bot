import { beforeEach, describe, expect, it, vi } from "vitest";

const repoMocks = vi.hoisted(() => ({
  clearUserState: vi.fn(),
  getMediaGroup: vi.fn(),
  getUserImageCount: vi.fn(),
  logConversation: vi.fn(),
  markJobDone: vi.fn(),
  markJobFailed: vi.fn(),
  markJobRunning: vi.fn(),
  markMediaGroupCollecting: vi.fn(),
  markMediaGroupProcessingIfAvailable: vi.fn(),
  markMediaGroupProcessed: vi.fn(),
  setUserState: vi.fn(),
  updateUserBalance: vi.fn(),
}));

const paymentHandlerMocks = vi.hoisted(() => ({
  handleYooKassaWebhook: vi.fn(),
}));

vi.mock("../src/db/repositories", () => repoMocks);
vi.mock("../src/handlers/payments", () => paymentHandlerMocks);

import { processQueueMessage } from "../src/services/queueProcessor";

function makeEnv() {
  return {
    DB: {} as D1Database,
    BOT_JOBS: {
      send: async () => {},
      sendBatch: async () => {},
    } as unknown as Queue,
  };
}

describe("payment reconcile queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repoMocks.markJobRunning.mockResolvedValue(undefined);
    repoMocks.markJobDone.mockResolvedValue(undefined);
    repoMocks.markJobFailed.mockResolvedValue(undefined);
    paymentHandlerMocks.handleYooKassaWebhook.mockResolvedValue(new Response("ok", { status: 200 }));
  });

  it("retries across queued attempts and eventually credits", async () => {
    const env = makeEnv();
    paymentHandlerMocks.handleYooKassaWebhook
      .mockResolvedValueOnce(new Response("retry", { status: 409 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    await processQueueMessage(env as any, {
      id: "reconcile-1",
      type: "PAYMENT_RECONCILE_JOB",
      telegramUserId: 101,
      chatId: 202,
      paymentIds: ["pay-1"],
    });
    await processQueueMessage(env as any, {
      id: "reconcile-2",
      type: "PAYMENT_RECONCILE_JOB",
      telegramUserId: 101,
      chatId: 202,
      paymentIds: ["pay-1"],
    });

    expect(paymentHandlerMocks.handleYooKassaWebhook).toHaveBeenNthCalledWith(
      1,
      env,
      { event: "payment.succeeded", object: { id: "pay-1", status: "succeeded" } },
      { trigger: "auto_reconcile_queue", requestId: "queue:reconcile-1:pay-1" },
    );
    expect(paymentHandlerMocks.handleYooKassaWebhook).toHaveBeenNthCalledWith(
      2,
      env,
      { event: "payment.succeeded", object: { id: "pay-1", status: "succeeded" } },
      { trigger: "auto_reconcile_queue", requestId: "queue:reconcile-2:pay-1" },
    );
    expect(repoMocks.markJobDone).toHaveBeenCalledTimes(2);
    expect(repoMocks.markJobFailed).not.toHaveBeenCalled();
  });

  it("handles canceled/pending style responses without failing the job", async () => {
    const env = makeEnv();
    paymentHandlerMocks.handleYooKassaWebhook.mockResolvedValue(new Response("retry", { status: 409 }));

    await processQueueMessage(env as any, {
      id: "reconcile-canceled",
      type: "PAYMENT_RECONCILE_JOB",
      telegramUserId: 303,
      chatId: 404,
      paymentIds: ["pay-canceled"],
    });

    expect(paymentHandlerMocks.handleYooKassaWebhook).toHaveBeenCalledTimes(1);
    expect(repoMocks.markJobDone).toHaveBeenCalledTimes(1);
    expect(repoMocks.markJobFailed).not.toHaveBeenCalled();
  });

  it("deduplicates repeated payment ids inside one reconcile job", async () => {
    const env = makeEnv();

    await processQueueMessage(env as any, {
      id: "reconcile-dupe",
      type: "PAYMENT_RECONCILE_JOB",
      telegramUserId: 505,
      chatId: 606,
      paymentIds: ["pay-1", "pay-1", "pay-2", "pay-2"],
    });

    const calledIds = paymentHandlerMocks.handleYooKassaWebhook.mock.calls.map((call: any[]) => call[1].object.id);
    expect(calledIds).toEqual(["pay-1", "pay-2"]);
    expect(repoMocks.markJobDone).toHaveBeenCalledTimes(1);
    expect(repoMocks.markJobFailed).not.toHaveBeenCalled();
  });
});
