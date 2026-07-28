import { describe, it, expect, vi } from "vitest";
import { sendOnce, type ClaimStore, type StepSendKey } from "./prospection-idempotence";

const key: StepSendKey = { leadId: 1, campaignId: 10, stepOrder: 2, userId: "u1", channel: "email" };

function fakeStore(claimResult: boolean): ClaimStore & {
  claim: ReturnType<typeof vi.fn>; markSent: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn>;
} {
  return {
    claim: vi.fn().mockResolvedValue(claimResult),
    markSent: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
  } as any;
}

describe("sendOnce", () => {
  it("réservation refusée : n'envoie RIEN et renvoie skipped", async () => {
    const store = fakeStore(false);
    const attempt = vi.fn();

    const result = await sendOnce(store, key, attempt as any);

    expect(attempt).not.toHaveBeenCalled();
    expect(result).toEqual({ action: "skipped" });
    expect(store.markSent).not.toHaveBeenCalled();
    expect(store.release).not.toHaveBeenCalled();
  });

  it("réservation obtenue + envoi réussi : marque la réservation envoyée", async () => {
    const store = fakeStore(true);
    const attempt = vi.fn().mockResolvedValue({ ok: true, status: "sent" });

    const result = await sendOnce(store, key, attempt);

    expect(attempt).toHaveBeenCalledTimes(1);
    expect(store.markSent).toHaveBeenCalledWith(key, "sent");
    expect(store.release).not.toHaveBeenCalled();
    expect(result).toEqual({ action: "sent", status: "sent" });
  });

  it("brouillon : marque la réservation en draft", async () => {
    const store = fakeStore(true);
    const attempt = vi.fn().mockResolvedValue({ ok: true, status: "draft" });

    const result = await sendOnce(store, key, attempt);

    expect(store.markSent).toHaveBeenCalledWith(key, "draft");
    expect(result).toEqual({ action: "sent", status: "draft" });
  });

  it("échec franc du fournisseur : libère la réservation pour permettre un retry", async () => {
    const store = fakeStore(true);
    const attempt = vi.fn().mockResolvedValue({ ok: false });

    const result = await sendOnce(store, key, attempt);

    expect(store.release).toHaveBeenCalledWith(key);
    expect(store.markSent).not.toHaveBeenCalled();
    expect(result).toEqual({ action: "failed" });
  });

  it("exception pendant l'envoi : NE libère PAS (issue inconnue) et propage", async () => {
    const store = fakeStore(true);
    const attempt = vi.fn().mockRejectedValue(new Error("ECONNRESET"));

    await expect(sendOnce(store, key, attempt)).rejects.toThrow("ECONNRESET");

    expect(store.release).not.toHaveBeenCalled();
    expect(store.markSent).not.toHaveBeenCalled();
  });
});
